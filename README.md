# The Current Chart Show Sync

Scrapes [The Current's](https://www.thecurrent.org/) weekly [Chart Show](https://www.thecurrent.org/programs/chart-show) top 20 and syncs it to a Spotify playlist. Also tracks the [Chart Show Hall of Fame](https://www.thecurrent.org/feature/2013/03/28/chart-show-hall-of-fame) — songs retired after 10+ weeks on the chart.

Runs on a schedule via Docker + [supercronic](https://github.com/aptible/supercronic).

## Setup

### 1. Create a Spotify App

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Create an app with redirect URI: `http://127.0.0.1:8888/callback`
3. Note your Client ID and Client Secret

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. Set `SPOTIFY_PLAYLIST_ID` and `SPOTIFY_HOF_PLAYLIST_ID` to existing playlist IDs, or leave them blank to create new playlists automatically.

### 3. Authorize with Spotify

```bash
npm install
npm run authorize
```

This starts a local server and opens Spotify's OAuth flow in your browser. The refresh token is saved to `.env` automatically.

### 4. Test

```bash
npm start
```

This scrapes the latest chart and updates your Spotify playlist.

## Docker

Build and run with Docker Compose:

```bash
docker compose build
docker compose up -d
```

The container runs `supercronic` which executes the sync every Friday at 2pm Central (configured in `crontab`).

```bash
# View logs
docker compose logs -f

# Manual test run
docker compose exec chart-show node src/index.js
```

## Deployment (Synology NAS)

A GitHub Actions workflow builds and pushes the image to GHCR on every push to `main`. The NAS just pulls the prebuilt `linux/amd64` image — no source code or build tools needed.

### Initial setup

```bash
# On the NAS
mkdir -p /volume1/docker/chart-show && cd /volume1/docker/chart-show

# Get the prod compose file
curl -fsSLO https://raw.githubusercontent.com/rarneson/the-current-chart-show-sync/main/docker-compose.prod.yml

# Add your .env (with Spotify credentials + tokens)
nano .env

# Pull and start
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Updating

```bash
cd /volume1/docker/chart-show
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## How It Works

1. Uses Puppeteer (headless Chrome) to scrape the chart — the site returns 403 to plain HTTP requests
2. Searches Spotify for each track by artist + title
3. Replaces the weekly playlist contents with the matched tracks
4. Checks the Hall of Fame page for new inductees and appends them to a separate playlist
5. Tracks state in `.env` (`LAST_EPISODE_URL`, `LAST_HOF_SONG_COUNT`) to avoid duplicate updates
