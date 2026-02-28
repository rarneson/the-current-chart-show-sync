require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createSpotifyApi, SCOPES } = require('../src/auth');

const app = express();
const PORT = 8888;

const spotifyApi = createSpotifyApi();
const authorizeURL = spotifyApi.createAuthorizeURL(SCOPES, 'chart-show-auth');

app.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    res.send(`Authorization failed: ${error}`);
    console.error('Authorization failed:', error);
    process.exit(1);
  }

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const refreshToken = data.body.refresh_token;

    // Update .env file with the refresh token
    const envPath = path.resolve(__dirname, '..', '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    if (envContent.includes('SPOTIFY_REFRESH_TOKEN=')) {
      envContent = envContent.replace(
        /SPOTIFY_REFRESH_TOKEN=.*/,
        `SPOTIFY_REFRESH_TOKEN=${refreshToken}`
      );
    } else {
      envContent += `\nSPOTIFY_REFRESH_TOKEN=${refreshToken}`;
    }

    fs.writeFileSync(envPath, envContent.trim() + '\n');

    res.send('Authorization successful! You can close this tab.');
    console.log('Refresh token saved to .env');
    console.log('Authorization complete. You can now run: npm start');

    // Give the response time to send before exiting
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    res.send('Error exchanging authorization code.');
    console.error('Token exchange failed:', err.message);
    process.exit(1);
  }
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`\nOpen this URL in your browser to authorize:\n\n  ${authorizeURL}\n`);
  console.log(`Waiting for callback on http://127.0.0.1:${PORT}/callback ...\n`);
});

// Shut down gracefully on SIGINT
process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
