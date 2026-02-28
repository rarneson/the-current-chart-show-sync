require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getSpotifyClient } = require('./auth');
const { launchBrowser, scrapeChart, scrapeHallOfFame } = require('./scraper');
const { searchTrack, ensurePlaylist, updatePlaylist, addToPlaylist } = require('./spotify');

const ENV_PATH = path.resolve(__dirname, '..', '.env');

/**
 * Persist a key=value pair into the .env file and process.env.
 */
function saveEnvVar(key, value) {
  let envContent = fs.readFileSync(ENV_PATH, 'utf-8');
  if (envContent.includes(`${key}=`)) {
    envContent = envContent.replace(
      new RegExp(`${key}=.*`),
      `${key}=${value}`
    );
  } else {
    envContent += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, envContent.trim() + '\n');
  process.env[key] = value;
}

/**
 * Search Spotify for a list of songs, returning found URIs and not-found songs.
 */
async function searchSongs(spotifyApi, songs, { label = '' } = {}) {
  const trackUris = [];
  const notFound = [];

  for (const song of songs) {
    const uri = await searchTrack(spotifyApi, song.artist, song.title);
    if (uri) {
      trackUris.push(uri);
      const prefix = song.rank ? `#${song.rank} ` : '';
      console.log(`  ${prefix}${song.artist} - ${song.title} ✓`);
    } else {
      notFound.push(song);
      const prefix = song.rank ? `#${song.rank} ` : '';
      console.log(`  ${prefix}${song.artist} - ${song.title} ✗ NOT FOUND`);
    }
  }

  console.log(`\nMatched ${trackUris.length}/${songs.length} tracks${label ? ` (${label})` : ''}.`);

  if (notFound.length > 0) {
    console.log('\nCould not find on Spotify:');
    notFound.forEach((s) => {
      const prefix = s.rank ? `#${s.rank} ` : '';
      console.log(`  ${prefix}${s.artist} - ${s.title}`);
    });
  }

  return { trackUris, notFound };
}

async function syncWeeklyChart(page, spotifyApi) {
  console.log('--- Scraping The Current Chart Show ---\n');
  const { songs, chartDate, episodeUrl } = await scrapeChart(page);

  console.log(`\nChart: ${chartDate || 'unknown date'}`);
  console.log(`Source: ${episodeUrl}\n`);

  // Check if this episode was already synced
  if (episodeUrl === process.env.LAST_EPISODE_URL) {
    console.log('Weekly playlist is already up to date for this episode. Skipping.\n');
    return;
  }

  console.log('--- Searching for chart tracks on Spotify ---\n');
  const { trackUris } = await searchSongs(spotifyApi, songs, { label: 'weekly chart' });

  if (trackUris.length === 0) {
    console.error('\nNo tracks found — aborting weekly playlist update.');
    return;
  }

  console.log('\n--- Updating weekly Spotify playlist ---\n');
  const playlistId = await ensurePlaylist(spotifyApi);
  await updatePlaylist(spotifyApi, playlistId, trackUris);

  saveEnvVar('LAST_EPISODE_URL', episodeUrl);

  console.log(`Weekly playlist updated with ${trackUris.length} tracks.`);
  console.log(`https://open.spotify.com/playlist/${playlistId}\n`);
}

async function syncHallOfFame(page, spotifyApi) {
  console.log('--- Checking Hall of Fame ---\n');

  const lastCount = parseInt(process.env.LAST_HOF_SONG_COUNT, 10) || 0;

  if (lastCount === 0) {
    console.log('LAST_HOF_SONG_COUNT is not set — skipping Hall of Fame sync.\n');
    return;
  }

  const { songs } = await scrapeHallOfFame(page);

  if (songs.length === lastCount) {
    console.log(
      `Hall of Fame is already up to date (${songs.length} songs). Skipping.\n`
    );
    return;
  }

  const newCount = songs.length - lastCount;
  console.log(
    `Hall of Fame has ${newCount} new song(s) (${lastCount} → ${songs.length}).\n`
  );

  const playlistId = await ensurePlaylist(spotifyApi, {
    envKey: 'SPOTIFY_HOF_PLAYLIST_ID',
    name: "The Current's Chart Show Hall of Fame",
    description:
      'Songs retired from The Current (MPR) Chart Show after 10+ weeks on the chart, auto-updated.',
  });

  // New inductees are at the top of the page — prepend them to the playlist
  const songsToProcess = songs.slice(0, newCount);

  console.log('--- Searching & adding new Hall of Fame tracks ---\n');
  let found = 0;
  let notFound = 0;

  for (let i = 0; i < songsToProcess.length; i++) {
    const song = songsToProcess[i];
    const uri = await searchTrack(spotifyApi, song.artist, song.title);
    if (uri) {
      await addToPlaylist(spotifyApi, playlistId, [uri], found);
      found++;
      console.log(`  [${i + 1}/${songsToProcess.length}] ${song.artist} - ${song.title} ✓`);
    } else {
      notFound++;
      console.log(`  [${i + 1}/${songsToProcess.length}] ${song.artist} - ${song.title} ✗ NOT FOUND`);
    }
  }

  console.log(`\nMatched ${found}/${songsToProcess.length} tracks (Hall of Fame).`);
  if (notFound > 0) {
    console.log(`${notFound} tracks could not be found on Spotify.`);
  }

  saveEnvVar('LAST_HOF_SONG_COUNT', String(songs.length));

  console.log(`\nHall of Fame playlist updated with ${found} new tracks.`);
  console.log(`https://open.spotify.com/playlist/${playlistId}\n`);
}

async function main() {
  const { browser, page } = await launchBrowser();

  try {
    // Authenticate with Spotify
    console.log('--- Authenticating with Spotify ---\n');
    const spotifyApi = await getSpotifyClient();
    console.log('Authenticated.\n');

    // 1. Weekly chart sync
    await syncWeeklyChart(page, spotifyApi);

    // 2. Hall of Fame sync
    await syncHallOfFame(page, spotifyApi);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
