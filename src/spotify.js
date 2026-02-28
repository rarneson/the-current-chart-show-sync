const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '..', '.env');

/**
 * Search Spotify for a track by artist and title.
 * Returns the track URI or null if not found.
 */

async function searchTrack(spotifyApi, artist, title) {
  // Strip "feat." suffixes from the title for a cleaner search
  const cleanTitle = title.replace(/\s*feat\.?\s+.*/i, '');
  const query = `track:${cleanTitle} artist:${artist}`;

  try {
    const data = await spotifyApi.searchTracks(query, { limit: 5 });
    const tracks = data.body.tracks.items;

    if (tracks.length > 0) {
      return tracks[0].uri;
    }

    // Fallback: try a simpler query without field filters
    const fallbackData = await spotifyApi.searchTracks(
      `${artist} ${cleanTitle}`,
      { limit: 5 }
    );
    const fallbackTracks = fallbackData.body.tracks.items;

    if (fallbackTracks.length > 0) {
      return fallbackTracks[0].uri;
    }

    return null;
  } catch (err) {
    if (err.statusCode === 429) {
      throw new Error('Spotify rate limit hit — try again later.');
    }
    console.error(`  Search error for "${artist} - ${title}": ${err.statusCode || ''} ${err.message}`);
    return null;
  }
}

/**
 * Ensure a playlist exists. Creates one if the env var identified by `envKey`
 * is not set. Returns the playlist ID.
 *
 * @param {object} spotifyApi  - authenticated spotify-web-api-node instance
 * @param {object} opts
 * @param {string} opts.envKey       - env var that stores the playlist ID
 * @param {string} opts.name         - playlist name (used when creating)
 * @param {string} opts.description  - playlist description (used when creating)
 */
async function ensurePlaylist(spotifyApi, {
  envKey = 'SPOTIFY_PLAYLIST_ID',
  name = "The Current's Chart Show Top 20",
  description = 'Weekly top 20 from The Current (MPR) Chart Show, auto-updated.',
} = {}) {
  if (process.env[envKey]) {
    // Verify the playlist still exists
    try {
      await spotifyApi.getPlaylist(process.env[envKey], {
        fields: 'id',
      });
      return process.env[envKey];
    } catch (err) {
      if (err.statusCode === 429) {
        throw new Error('Spotify rate limit hit — try again later.');
      }

      // For Hall of Fame, never auto-create — just fail
      if (envKey === 'SPOTIFY_HOF_PLAYLIST_ID') {
        console.error(`Hall of Fame playlist ID is invalid: ${err.statusCode || ''} ${err.message}`);
        throw new Error('SPOTIFY_HOF_PLAYLIST_ID is invalid. Please check the playlist ID in .env');
      }

      console.warn(
        `Saved playlist ID (${envKey}) is invalid, creating a new one...`,
        err.statusCode || '', err.message
      );
    }
  }

  // Create a new private playlist
  const playlist = await spotifyApi.createPlaylist(name, {
    description,
    public: false,
  });

  const playlistId = playlist.body.id;

  // Save the playlist ID to .env
  let envContent = '';
  if (fs.existsSync(ENV_PATH)) {
    envContent = fs.readFileSync(ENV_PATH, 'utf-8');
  }

  if (envContent.includes(`${envKey}=`)) {
    envContent = envContent.replace(
      new RegExp(`${envKey}=.*`),
      `${envKey}=${playlistId}`
    );
  } else {
    envContent += `\n${envKey}=${playlistId}`;
  }

  fs.writeFileSync(ENV_PATH, envContent.trim() + '\n');
  process.env[envKey] = playlistId;

  console.log(`Created new playlist: ${playlistId}`);
  return playlistId;
}

/**
 * Replace all tracks in the playlist with the given URIs.
 * Uses PUT /playlists/{id}/items to atomically replace.
 */
async function updatePlaylist(spotifyApi, playlistId, trackUris) {
  const token = spotifyApi.getAccessToken();
  const res = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}/items`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: trackUris }),
    }
  );

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Spotify rate limit hit — try again later.');
    }
    const body = await res.text();
    throw new Error(`Spotify PUT /items failed (${res.status}): ${body}`);
  }
}

/**
 * Add tracks to a playlist.
 * Uses POST /playlists/{id}/items.
 * @param {number} [position] - Insert at this index (0 = beginning). Omit to append.
 */
async function addToPlaylist(spotifyApi, playlistId, trackUris, position) {
  const token = spotifyApi.getAccessToken();
  const payload = { uris: trackUris };
  if (position !== undefined) {
    payload.position = position;
  }
  const res = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}/items`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Spotify rate limit hit — try again later.');
    }
    const body = await res.text();
    throw new Error(`Spotify POST /items failed (${res.status}): ${body}`);
  }
}

module.exports = { searchTrack, ensurePlaylist, updatePlaylist, addToPlaylist };
