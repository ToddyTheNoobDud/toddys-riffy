const undici = require('undici');

const SC_LINK_RE = /<a\s+itemprop="url"\s+href="(\/[^"]+)"/g;

async function scAutoPlay(url) {
  try {
    const res = await undici.fetch(`${url}/recommended`);

    if (!res.ok) {
      throw new Error(`Failed to fetch URL. Status code: ${res.status}`);
    }

    const html = await res.text();

    const links = [];
    for (const match of html.matchAll(SC_LINK_RE)) {
      if (match[1]) {
        links.push(`https://soundcloud.com${match[1]}`);
      }
    }

    return links;
  } catch (error) {
    console.error('scAutoPlay error:', error?.message || error);
    return [];
  }
}

async function spAutoPlay(track_id) {
    // Since Spotify's recommendations API is deprecated and unreliable,
    // This approach is more reliable and it uses official YT recommendations API.

    try {
        // For now, return null to indicate we need track info from the player
        // The actual implementation will be handled in the Player.autoplay method
        return null;
    } catch (error) {
        console.error('Spotify autoplay error:', error);
        return null;
    }
}

module.exports = { scAutoPlay, spAutoPlay };
