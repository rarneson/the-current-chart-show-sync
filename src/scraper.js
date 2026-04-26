const puppeteer = require('puppeteer');
const tesseract = require('node-tesseract-ocr');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHART_SHOW_URL = 'https://www.thecurrent.org/programs/chart-show';
const HOF_URL =
  'https://www.thecurrent.org/feature/2013/03/28/chart-show-hall-of-fame';

/**
 * Launch a headless browser and return { browser, page } with a realistic user agent.
 * Caller is responsible for closing the browser when done.
 */
async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  return { browser, page };
}

/**
 * Parse Tesseract output into [{rank, artist, title}, ...].
 *
 * The chart graphic Tesseract is fed has the layout:
 *   <header lines>
 *   Artist Name
 *   "Song Title"
 *   Artist Name
 *   "Song Title"
 *   ...
 *
 * Tesseract drops the stylized red rank digits, so rank is derived from order.
 * Titles are wrapped in smart quotes (U+201C / U+201D), occasionally regular
 * straight quotes when OCR slips.
 */
function parseChartText(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const titleRegex = /^[“”"](.+?)[“”"]$/;
  const songs = [];
  let pendingArtist = null;
  let rank = 0;

  for (const line of lines) {
    // Drop chart header lines.
    if (/top\s+\d+\s+voted/i.test(line)) continue;
    if (/chart\s+show/i.test(line) && !pendingArtist) continue;

    const titleMatch = line.match(titleRegex);
    if (titleMatch) {
      if (pendingArtist) {
        rank += 1;
        songs.push({ rank, artist: pendingArtist, title: titleMatch[1] });
        pendingArtist = null;
      }
      continue;
    }

    // Anything else: treat as an artist line. If we already had one pending
    // (no title arrived between two artist lines), the latest wins — better
    // to drop a malformed entry than emit a bogus one.
    pendingArtist = line;
  }

  return songs;
}

/**
 * Validate the parsed chart. Throws on anything suspicious so cron fails loudly
 * instead of pushing garbage to the Spotify playlist.
 */
function validateSongs(songs) {
  if (songs.length < 5) {
    throw new Error(`Only ${songs.length} song(s) parsed — chart layout may have changed`);
  }
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    if (s.rank !== i + 1) {
      throw new Error(`Non-consecutive rank at index ${i}: expected ${i + 1}, got ${s.rank}`);
    }
    if (!s.artist || !s.title) {
      throw new Error(`Empty artist/title at rank ${s.rank}`);
    }
  }
}

/**
 * Fetch a chart-graphic URL, OCR it with Tesseract, and return
 * [{rank, artist, title}, ...] in chart order.
 *
 * The Current publishes a CMYK JPEG. Modern Tesseract/leptonica reads CMYK
 * directly, so we don't pre-convert — every conversion library tested
 * (sharp/libvips with various ICC profile guesses) made OCR markedly worse.
 */
async function extractSongsFromImage(imageUrl) {
  const resp = await fetch(imageUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch chart image: ${resp.status} ${resp.statusText}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());

  const tmpPath = path.join(os.tmpdir(), `chartshow-${process.pid}-${Date.now()}.jpg`);
  await fs.promises.writeFile(tmpPath, buffer);

  try {
    const text = await tesseract.recognize(tmpPath, { lang: 'eng' });
    const songs = parseChartText(text);
    validateSongs(songs);
    return songs;
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

/**
 * Scrape the most recent Chart Show top 20.
 * If `page` is provided it will be reused; otherwise a new browser is launched
 * (and closed before returning).
 */
async function scrapeChart(page) {
  let browser;
  if (!page) {
    ({ browser, page } = await launchBrowser());
  }

  try {
    // Navigate to the chart show program page
    console.log('Navigating to Chart Show page...');
    await page.goto(CHART_SHOW_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Find the first (most recent) episode link from the teaser grid.
    // Exclude the static Hall of Fame page (2013) but keep regular weekly
    // episodes whose URL slugs happen to mention "hall-of-fame".
    const episodeUrl = await page.evaluate(() => {
      const teaserLinks = Array.from(
        document.querySelectorAll('a[class*="teaser"]')
      );
      const episode = teaserLinks.find(
        (a) =>
          a.href.includes('/feature/') &&
          a.href.includes('chart-show') &&
          !a.href.includes('/2013/')
      );
      return episode ? episode.href : null;
    });

    if (!episodeUrl) {
      throw new Error('Could not find the most recent Chart Show episode link');
    }

    console.log(`Found latest episode: ${episodeUrl}`);

    // Navigate to the episode detail page
    await page.goto(episodeUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extract the chart date from the page
    const chartDate = await page.evaluate(() => {
      const datePattern = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/;
      // Search all <p> and <time> elements for a date
      for (const el of document.querySelectorAll('p, time, span')) {
        const text = el.textContent.trim();
        const match = text.match(datePattern);
        if (match) return match[0];
      }
      return null;
    });

    if (chartDate) {
      console.log(`Chart date: ${chartDate}`);
    }

    // The chart is now published as a JPEG graphic, not an HTML table.
    // Find the chart image URL on the episode page, then OCR it with Claude vision.
    const imageUrl = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const match = imgs.find(
        (img) => /apmcdn\.org/.test(img.src) && /chart-show/i.test(img.src)
      );
      return match ? match.src : null;
    });

    if (!imageUrl) {
      throw new Error('Could not find a chart image on the episode page');
    }

    console.log(`Chart image: ${imageUrl}`);

    const songs = await extractSongsFromImage(imageUrl);

    if (songs.length === 0) {
      throw new Error('Vision extraction returned no songs');
    }

    songs.sort((a, b) => a.rank - b.rank);

    console.log(`Extracted ${songs.length} songs from chart image`);

    return { songs, chartDate, episodeUrl };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Scrape the Chart Show Hall of Fame page.
 * Structure: <h3> = artist name, followed by <p> with song title in smart quotes.
 * If `page` is provided it will be reused; otherwise a new browser is launched.
 */
async function scrapeHallOfFame(page) {
  let browser;
  if (!page) {
    ({ browser, page } = await launchBrowser());
  }

  try {
    console.log('Navigating to Hall of Fame page...');
    await page.goto(HOF_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    const songs = await page.evaluate(() => {
      const article = document.querySelector('article');
      if (!article) return [];

      const elements = article.querySelectorAll('h3, p');
      const results = [];
      let currentArtist = null;

      for (const el of elements) {
        if (el.tagName === 'H3') {
          currentArtist = el.textContent.trim();
        } else if (el.tagName === 'P' && currentArtist) {
          const text = el.textContent.trim();
          // Song titles are wrapped in smart quotes or regular quotes
          const match = text.match(/[\u201c""](.+?)[\u201d""]/);
          if (match) {
            results.push({ artist: currentArtist, title: match[1] });
          }
        }
      }

      return results;
    });

    if (songs.length === 0) {
      throw new Error('Could not extract any songs from the Hall of Fame page');
    }

    console.log(`Scraped ${songs.length} songs from the Hall of Fame`);

    return { songs };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  launchBrowser,
  scrapeChart,
  scrapeHallOfFame,
  extractSongsFromImage,
  parseChartText,
};
