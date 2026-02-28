const SpotifyWebApi = require('spotify-web-api-node');

const SCOPES = ['playlist-modify-private', 'playlist-modify-public'];

function createSpotifyApi() {
  return new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
  });
}

async function getSpotifyClient() {
  const api = createSpotifyApi();
  api.setRefreshToken(process.env.SPOTIFY_REFRESH_TOKEN);

  const data = await api.refreshAccessToken();
  api.setAccessToken(data.body.access_token);

  return api;
}

module.exports = { createSpotifyApi, getSpotifyClient, SCOPES };
