const puppeteer = require('puppeteer');

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

    // Extract the top 20 from the chart table
    const songs = await page.evaluate(() => {
      const table = document.querySelector('table.chartshow');
      if (!table) return [];

      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const results = [];

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 5) continue;

        const rank = parseInt(cells[0].textContent.trim(), 10);
        if (isNaN(rank)) continue; // Skip header-like rows

        const artist = cells[3].textContent.trim();
        const title = cells[4].textContent.trim();

        if (artist && title) {
          results.push({ rank, artist, title });
        }
      }

      return results;
    });

    if (songs.length === 0) {
      throw new Error('Could not extract any songs from the chart table');
    }

    // Sort by rank ascending (should already be, but ensure it)
    songs.sort((a, b) => a.rank - b.rank);

    console.log(`Scraped ${songs.length} songs from the chart`);

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

module.exports = { launchBrowser, scrapeChart, scrapeHallOfFame };
