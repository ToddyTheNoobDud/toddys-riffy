const { EventEmitter } = require("events");
const { Connection } = require("./Connection");
const { Filters } = require("./Filters");
const { Queue } = require("./Queue");
const { spAutoPlay, scAutoPlay } = require('../functions/autoPlay');

class Player extends EventEmitter {
    constructor(riffy, node, options) {
        super();
        this.riffy = riffy;
        this.node = node;
        this.guildId = options.guildId;
        this.textChannel = options.textChannel;
        this.voiceChannel = options.voiceChannel;
        this.connection = new Connection(this);
        this.filters = new Filters(this);
        this.mute = options.mute ?? false;
        this.deaf = options.deaf ?? false;
        this.volume = options.defaultVolume ?? 100;
        this.loop = options.loop ?? "none";
        this.data = new Map(); // Use Map for better performance
        this.queue = new Queue();
        this.position = 0;
        this.current = null;
        this.previousTracks = [];
        this.playing = false;
        this.paused = false;
        this.connected = false;
        this.timestamp = 0;
        this.ping = 0;
        this.isAutoplay = false;

        this.on("playerUpdate", (packet) => {
            const { state } = packet;
            this.connected = state.connected;
            this.position = state.position;
            this.ping = state.ping;
            this.timestamp = state.time;
            this.riffy.emit("playerUpdate", this, packet);
        });

        this.on("event", (data) => {
            this.handleEvent(data);
        });
    }

    get previous() {
        return this.previousTracks[0];
    }

    addToPreviousTrack(track) {
        const maxHistory = this.riffy.options.multipleTrackHistory ?? 1;
        if (this.previousTracks.length >= maxHistory) {
            this.previousTracks.pop(); // Keep only the last played track
        }
        this.previousTracks.unshift(track);
    }

    async play() {
        if (!this.connected) throw new Error("Player connection is not initiated. Kindly use Riffy.createConnection() and establish a connection.");
        if (!this.queue.length) return;

        this.current = this.queue.shift();
        if (!this.current.track) {
            this.current = await this.current.resolve(this.riffy);
        }

        this.playing = true;
        this.position = 0;
        const { track } = this.current;

        this.node.rest.updatePlayer({
            guildId: this.guildId,
            data: { track: { encoded: track } },
        });

        return this;
    }

    async autoplay(player) {
        if (player === null || player === false) {
            this.isAutoplay = false;
            return this;
        }

        this.isAutoplay = true;

        if (!player.previous) return this;

        const { sourceName, identifier, uri } = player.previous.info;
        let data, response;

        try {
            switch (sourceName) {
                case "youtube":
                    data = `https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}`;
                    response = await this.riffy.resolve({ query: data, source: "ytmsearch", requester: player.previous.info.requester });
                    break;
                case "soundcloud":
                    data = await scAutoPlay(uri);
                    response = await this.riffy.resolve({ query: data, source: "scsearch", requester: player.previous.info.requester });
                    break;
                case "spotify":
                    data = await spAutoPlay(identifier);
                    response = await this.riffy.resolve({ query: `https://open.spotify.com/track/${data}`, requester: player.previous.info.requester });
                    break;
                default:
                    return this.stop();
            }

            if (!response || !response.tracks || ["error", "empty", "LOAD_FAILED", "NO_MATCHES"].includes(response.loadType)) {
                return this.stop();
            }

            const track = response.tracks[Math.floor(Math.random() * response.tracks.length)];
            this.queue.push(track);
            this.play();
        } catch (e) {
            console.error(e);
            return this.stop();
        }

        return this;
    }

    connect(options = this) {
        const { guildId, voiceChannel, deaf = true, mute = false } = options;
        this.send({
            guild_id: guildId,
            channel_id: voiceChannel,
            self_deaf: deaf,
            self_mute: mute,
        });
        this.connected = true;
        this.riffy.emit("debug", this.guildId, `Player has informed the Discord Gateway to establish voice connectivity in ${voiceChannel} voice channel.`);
    }

    stop() {
        this.position = 0;
        this.playing = false;
        this.node.rest.updatePlayer({
            guildId: this.guildId,
            data: { track: { encoded: null } },
        });
        return this;
    }

    pause(toggle = true) {
        this.node.rest.updatePlayer({
            guildId: this.guildId,
            data: { paused: toggle },
        });
        this.playing = !toggle;
        this.paused = toggle;
        return this;
    }

    seek(position) {
        const trackLength = this.current?.info?.length || 0;
        this.position = Math.max(0, Math.min(trackLength, position));
        this.node.rest.updatePlayer({ guildId: this.guildId, data: { position: this.position } });
    }

    setVolume(volume) {
        if (volume < 0 || volume > 1000) {
            throw new Error("[Volume] Volume must be between 0 to 1000");
        }
        this.node.rest.updatePlayer({ guildId: this.guildId, data: { volume } });
        this.volume = volume;
        return this;
    }

    setLoop(mode) {
        if (!["none", "track", "queue"].includes(mode)) {
            throw new Error("setLoop arguments must be 'none', 'track', or 'queue'");
        }
        this.loop = mode;
        return this;
    }

    setTextChannel(channel) {
        if (typeof channel !== "string") throw new TypeError("Channel must be a non-empty string.");
        this.textChannel = channel;
        return this;
    }

    setVoiceChannel(channel, options) {
        if (typeof channel !== "string") throw new TypeError("Channel must be a non-empty string.");
        if (this.connected && channel === this.voiceChannel) {
            throw new ReferenceError(`Player is already connected to ${channel}`);
        }
        this.voiceChannel = channel;
        if (options) {
            this.mute = options.mute ?? this.mute;
            this.deaf = options.deaf ?? this.deaf;
        }
        this.connect({
            deaf: this.deaf,
            guildId: this.guildId,
            voiceChannel: this.voiceChannel,
            textChannel: this.textChannel,
            mute: this.mute,
        });
        return this;
    }

    disconnect() {
        if (!this.voiceChannel) return;
        this.connected = false;
        this.send({
            guild_id: this.guildId,
            channel_id: null,
            self_mute: false,
            self_deaf: false,
        });
        this.voiceChannel = null;
        return this;
    }

    destroy() {
        this.disconnect();
        this.node.rest.destroyPlayer(this.guildId);
        this.riffy.emit("playerDisconnect", this);
        this.riffy.emit("debug", this.guildId, "Destroyed the player");
        this.riffy.players.delete(this.guildId);
    }

    async handleEvent(payload) {
        const player = this.riffy.players.get(payload.guildId);
        if (!player) return;

        const track = this.current;

        switch (payload.type) {
            case "TrackStartEvent":
                this.trackStart(player, track, payload);
                break;
            case "TrackEndEvent":
                this.trackEnd(player, track, payload);
                break;
            case "TrackExceptionEvent":
                this.trackError(player, track, payload);
                break;
            case "TrackStuckEvent":
                this.trackStuck(player, track, payload);
                break;
            case "WebSocketClosedEvent":
                this.socketClosed(player, payload);
                break;
            default:
                this.riffy.emit("nodeError", this, new Error(`Node encountered an unknown event: '${payload.type}'`));
                break;
        }
    }

    trackStart(player, track, payload) {
        this.playing = true;
        this.paused = false;
        this.riffy.emit("trackStart", player, track, payload);
    }

    trackEnd(player, track, payload) {
        this.addToPreviousTrack(track);
        const previousTrack = this.previous;

        if (payload.reason.toLowerCase() === "replaced") {
            return this.riffy.emit("trackEnd", player, track, payload);
        }

        if (["loadfailed", "cleanup"].includes(payload.reason.replace("_", "").toLowerCase())) {
            if (player.queue.length === 0) {
                this.playing = false;
                return this.riffy.emit("queueEnd", player);
            }
            this.riffy.emit("trackEnd", player, track, payload);
            return player.play();
        }

        if (this.loop === "track") {
            player.queue.unshift(previousTrack);
            this.riffy.emit("trackEnd", player, track, payload);
            return player.play();
        } else if (this.loop === "queue") {
            player.queue.push(previousTrack);
            this.riffy.emit("trackEnd", player, track, payload);
            return player.play();
        }

        if (player.queue.length === 0) {
            this.playing = false;
            return this.riffy.emit("queueEnd", player);
        } else {
            this.riffy.emit("trackEnd", player, track, payload);
            return player.play();
        }
    }

    trackError(player, track, payload) {
        this.riffy.emit("trackError", player, track, payload);
        this.stop();
    }

    trackStuck(player, track, payload) {
        this.riffy.emit("trackStuck", player, track, payload);
        this.stop();
    }

    socketClosed(player, payload) {
        if ([4015, 4009].includes(payload.code)) {
            this.send({
                guild_id: payload.guildId,
                channel_id: this.voiceChannel,
                self_mute: this.mute,
                self_deaf: this.deaf,
            });
        }
        this.riffy.emit("socketClosed", player, payload);
        this.pause(true);
        this.riffy.emit("debug", this.guildId, "Player paused, channel deleted, or client was kicked");
    }

    send(data) {
        this.riffy.send({ op: 4, d: data });
    }

    set(key, value) {
        this.data.set(key, value);
    }

    get(key) {
        return this.data.get(key);
    }

    /**
     * @description clears all custom data set on the player
     */ 
    clearData() {
        this.data.clear();
        return this;
    }
}

module.exports = { Player };
