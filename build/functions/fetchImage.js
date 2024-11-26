const undici = require("undici");

async function getImageUrl(info) {
    const urlMap = {
        spotify: `https://open.spotify.com/oembed?url=${info.uri}`,
        soundcloud: `https://soundcloud.com/oembed?format=json&url=${info.uri}`,
        youtube: [
            `https://img.youtube.com/vi/${info.identifier}/maxresdefault.jpg`,
            `https://img.youtube.com/vi/${info.identifier}/hqdefault.jpg`,
            `https://img.youtube.com/vi/${info.identifier}/mqdefault.jpg`,
            `https://img.youtube.com/vi/${info.identifier}/default.jpg`
        ]
    };

    if (info.sourceName in urlMap) {
        try {
            if (info.sourceName === "youtube") {
                for (const url of urlMap.youtube) {
                    const response = await undici.fetch(url);
                    if (response.ok) return url;
                }
            } else {
                const res = await undici.fetch(urlMap[info.sourceName]);
                const json = await res.json();
                return json.thumbnail_url;
            }
        } catch (error) {
            return null;
        }
    }

    return null;
}

module.exports = { getImageUrl };
