const { getImageUrl } = require("../functions/fetchImage");
const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

class Track {
    constructor(data, requester, node) {
        this.rawData = data;
        this.track = data.encoded;
        this.info = {
            identifier: data.info.identifier,
            seekable: data.info.isSeekable,
            author: data.info.author,
            length: data.info.length,
            stream: data.info.isStream,
            position: data.info.position,
            title: data.info.title,
            uri: data.info.uri,
            requester,
            sourceName: data.info.sourceName,
            isrc: data.info?.isrc || null,
            _cachedThumbnail: data.info.thumbnail ?? null,
        };
        this.node = node; // Store node reference to avoid passing it around
    }

    get thumbnail() {
        // Return cached thumbnail if available
        if (this.info._cachedThumbnail) return this.info._cachedThumbnail;

        // Check if thumbnail is available in the data
        const { thumbnail, artworkUrl } = this.rawData.info;
        if (thumbnail) return thumbnail;

        // Generate thumbnail URL based on node version
        this.info._cachedThumbnail = this.node.rest.version === "v4" 
            ? artworkUrl || getImageUrl(this) 
            : getImageUrl(this);
        
        return this.info._cachedThumbnail;
    }

    async resolve(toddysriffy) {
        const { author, title, length } = this.info;
        const query = [author, title].filter(Boolean).join(" - ");
        // Attempt to resolve the track
        try {
            const result = await toddysriffy.resolve({ query, source: toddysriffy.options.defaultSearchPlatform, requester: this.info.requester });
            if (!result || !result.tracks.length) return;

            const officialAudio = this.findOfficialAudio(result.tracks, author, title);
            if (officialAudio) {
                this.updateTrack(officialAudio);
                return this;
            }

            if (length) {
                const sameDurationTrack = this.findSimilarDurationTrack(result.tracks, length);
                if (sameDurationTrack) {
                    this.updateTrack(sameDurationTrack);
                    return this;
                }
            }

            // Fallback to the first track if no match is found
            this.updateTrack(result.tracks[0]);
            return this;
        } catch (error) {
            console.error("Error resolving track:", error);
            return null; // or handle the error as needed
        }
    }

    findOfficialAudio(tracks, author, title) {
        const authorRegexes = [
            new RegExp(`^${escapeRegExp(author)}$`, "i"),
            new RegExp(`^${escapeRegExp(`${author} - Topic`)}$`, "i")
        ];
        const titleRegex = new RegExp(`^${escapeRegExp(title)}$`, "i");
        return tracks.find(track => 
            authorRegexes.some(regex => regex.test(track.info.author)) ||
            titleRegex.test(track.info.title)
        );
    }

    findSimilarDurationTrack(tracks, length) {
        const lengthRange = [length - 2000, length + 2000];
        return tracks.find(track => 
            track.info.length >= lengthRange[0] && track.info.length <= lengthRange[1]
        );
    }

    updateTrack(track) {
        this.info.identifier = track.info.identifier;
        this.track = track.track;
    }
}

module.exports = { Track };
