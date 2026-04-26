require('dotenv').config();
const { scrapeChart } = require('../src/scraper');

async function main() {
  const t0 = Date.now();
  const { songs, chartDate, episodeUrl } = await scrapeChart();
  const ms = Date.now() - t0;
  console.log(`\nEpisode: ${episodeUrl}`);
  console.log(`Date:    ${chartDate || 'unknown'}`);
  console.log(`Got ${songs.length} songs in ${ms}ms:\n`);
  for (const s of songs) {
    console.log(`  #${s.rank}  ${s.artist} - ${s.title}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
