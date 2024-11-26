const Websocket = require("ws");
const { Rest } = require("./Rest");
const { Track } = require("./Track");

class Node {
    /**
     * @param {import("./toddysriffy").toddysriffy} toddysriffy 
     * @param {} node 
     * @param {Object} options
     */
    constructor(toddysriffy, node, options) {
        this.toddysriffy = toddysriffy;
        this.name = node.name || node.host;
        this.host = node.host || "localhost";
        this.port = node.port || 2333;
        this.password = node.password || "youshallnotpass";
        this.restVersion = options.restVersion;
        this.secure = node.secure || false;
        this.sessionId = node.sessionId || null;
        this.rest = new Rest(toddysriffy, this);
        this.wsUrl = `ws${this.secure ? "s" : ""}://${this.host}:${this.port}${options.restVersion === "v4" ? "/v4/websocket" : ""}`;
        this.restUrl = `http${this.secure ? "s" : ""}://${this.host}:${this.port}`;
        this.ws = null;
        this.regions = node.regions;
        this.info = null;
        this.stats = this.initializeStats();
        this.connected = false;
        this.resumeKey = options.resumeKey || null;
        this.resumeTimeout = options.resumeTimeout || 60;
        this.autoResume = options.autoResume || false;
        this.reconnectTimeout = options.reconnectTimeout || 5000;
        this.reconnectTries = options.reconnectTries || 3;
        this.reconnectAttempted = 1;
        this.lastStats = Date.now();
    }

    initializeStats() {
        return {
            players: 0,
            playingPlayers: 0,
            uptime: 0,
            memory: {
                free: 0,
                used: 0,
                allocated: 0,
                reservable: 0,
            },
            cpu: {
                cores: 0,
                systemLoad: 0,
                lavalinkLoad: 0,
            },
            frameStats: {
                sent: 0,
                nulled: 0,
                deficit: 0,
            },
        };
    }

    lyrics = {
        checkAvailable: async (eitherOne = true, ...plugins) => {
            if (!this.sessionId) throw new Error(`Node (${this.name}) is not Ready/Connected.`);
            if (!plugins.length) plugins = ["lavalyrics-plugin", "java-lyrics-plugin", "lyrics"];
            const missingPlugins = plugins.filter(plugin => !this.info.plugins.some(p => p.name === plugin));
            if (eitherOne && missingPlugins.length === plugins.length) {
                throw new RangeError(`Node (${this.name}) is missing plugins: ${missingPlugins.join(", ")} (required for Lyrics)`);
            } else if (!eitherOne && missingPlugins.length) {
                throw new RangeError(`Node (${this.name}) is missing plugins: ${missingPlugins.join(", ")} (required for Lyrics)`);
            }
            return true;
        },
        get: async (trackOrEncodedTrackStr, skipTrackSource = false) => {
            if (!(await this.lyrics.checkAvailable(false, "lavalyrics-plugin"))) return null;
            if (!(trackOrEncodedTrackStr instanceof Track) && typeof trackOrEncodedTrackStr !== "string") {
                throw new TypeError(`Expected \`Track\` or \`string\` for \`trackOrEncodedTrackStr\` in "lyrics.get" but got \`${typeof trackOrEncodedTrackStr}\``);
            }
            const encodedTrackStr = typeof trackOrEncodedTrackStr === "string" ? trackOrEncodedTrackStr : trackOrEncodedTrackStr.track;
            return await this.rest.makeRequest("GET", `/v4/lyrics?skipTrackSource=${skipTrackSource}&track=${encodedTrackStr}`);
        },
        getCurrentTrack: async (guildId, skipTrackSource = false, plugin) => {
            const DEFAULT_PLUGIN = "lavalyrics-plugin";
            if (!(await this.lyrics.checkAvailable())) return null;
            let requestURL = `/v4/sessions/${this.sessionId}/players/${guildId}/track/lyrics?skipTrackSource=${skipTrackSource}&plugin=${plugin || DEFAULT_PLUGIN}`;
            if (!plugin && (this.info.plugins.some(p => p.name === "java-lyrics-plugin") || this.info.plugins.some(p => p.name === "lyrics")) && !this.info.plugins.some(p => p.name === DEFAULT_PLUGIN)) {
                requestURL = requestURL.replace('track/lyrics', 'lyrics');
            }
            return await this.rest.makeRequest("GET", requestURL);
        }
    };

    async fetchInfo(options = { restVersion: this.restVersion, includeHeaders: false }) {
        return await this.rest.makeRequest("GET", `/${options.restVersion || this.restVersion}/info`, null, options.includeHeaders);
    }

    async connect() {
        if (this.ws) this.ws.close();
        this.toddysriffy.emit('debug', this.name, `Checking Node Version`);
        const headers = {
            "Authorization": this.password,
            "User-Id": this.toddysriffy.clientId,
            "Client-Name": `toddysriffy/${this.toddysriffy.version}`,
        };
        if (this.restVersion === "v4" && this.sessionId) {
            headers["Session-Id"] = this.sessionId;
        } else if (this.resumeKey) {
            headers["Resume-Key"] = this.resumeKey;
        }
        this.ws = new Websocket(this.wsUrl, { headers });
        this.ws.on("open", this.open.bind(this));
        this.ws.on("error", this.error.bind(this));
        this.ws.on("message", this.message.bind(this));
        this.ws.on("close", this.close.bind(this));
    }

    async open() {
        if (this.reconnectAttempt) clearTimeout(this.reconnectAttempt);
        this.connected = true;
        this.toddysriffy.emit('debug', this.name, `Connection with Lavalink established on ${this.wsUrl}`);
        this.info = await this.fetchInfo().catch(e => {
            console.error(`Node (${this.name}) Failed to fetch info (${this.restVersion}/info) on WS-OPEN: ${e}`);
            return null;
        });
        if (!this.info && !this.options.bypassChecks.nodeFetchInfo) {
            throw new Error(`Node (${this.name} - URL: ${this.restUrl}) Failed to fetch info on WS-OPEN`);
        }
        if (this.autoResume) {
            for (const player of this.toddysriffy.players.values()) {
                if (player.node === this) {
                    player.restart();
                }
            }
        }
    }

    error(event) {
        if (!event) return;
        this.toddysriffy.emit("nodeError", this, event);
    }

    message(msg) {
        if (Array.isArray(msg)) msg = Buffer.concat(msg);
        else if (msg instanceof ArrayBuffer) msg = Buffer.from(msg);
        const payload = JSON.parse(msg.toString());
        if (!payload.op) return;
        this.toddysriffy.emit("raw", "Node", payload);
        this.toddysriffy.emit("debug", this.name, `Lavalink Node Update: ${JSON.stringify(payload)}`);
        if (payload.op === "stats") {
            this.stats = { ...payload };
            this.lastStats = Date.now();
        }
        if (payload.op === "ready") {
            if (this.sessionId !== payload.sessionId) {
                this.rest.setSessionId(payload.sessionId);
                this.sessionId = payload.sessionId;
            }
            this.toddysriffy.emit("nodeConnect", this);
            this.toddysriffy.emit("debug", this.name, `Ready Payload received ${JSON.stringify(payload)}`);
            const resumeData = this.restVersion === "v4" ? { resuming: true, timeout: this.resumeTimeout } : { resumingKey: this.resumeKey, timeout: this.resumeTimeout };
            if (this.sessionId) {
                this.rest.makeRequest(`PATCH`, `/${this.rest.version}/sessions/${this.sessionId}`, resumeData);
                this.toddysriffy.emit("debug", this.name, `Resuming configured on Lavalink`);
            }
        }
        const player = this.toddysriffy.players.get(payload.guildId);
        if (payload.guildId && player) player.emit(payload.op, payload);
    }

    close(event, reason) {
        this.toddysriffy.emit("nodeDisconnect", this, { event, reason });
        this.toddysriffy.emit("debug", `Connection with Lavalink closed with Error code: ${event || "Unknown code"}, reason: ${reason || "Unknown reason"}`);
        this.connected = false;
        this.reconnect();
    }

    reconnect() {
        this.reconnectAttempt = setTimeout(() => {
            if (this.reconnectAttempted >= this.reconnectTries) {
                const error = new Error(`Unable to connect with ${this.name} node after ${this.reconnectTries} attempts.`);
                this.toddysriffy.emit("nodeError", this, error);
                return this.destroy();
            }
            this.ws?.removeAllListeners();
            this.ws = null;
            this.toddysriffy.emit("nodeReconnect", this);
            this.connect();
            this.reconnectAttempted++;
        }, this.reconnectTimeout);
    }

    destroy(clean = false) {
        if (clean) {
            this.cleanup();
            return;
        }
        if (!this.connected) return;
        this.toddysriffy.players.forEach(player => {
            if (player.node !== this) return;
            player.destroy();
        });
        this.ws?.close(1000, "destroy");
        this.cleanup();
    }

    cleanup() {
        this.ws?.removeAllListeners();
        this.ws = null;
        clearTimeout(this.reconnectAttempt);
        this.toddysriffy.emit("nodeDestroy", this);
        this.toddysriffy.nodes.delete(this.name);
        this.connected = false;
    }

    disconnect() {
        if (!this.connected) return;
        this.toddysriffy.players.forEach(player => {
            if (player.node === this) {
                player.move();
            }
        });
        this.ws.close(1000, "destroy");
        this.cleanup();
    }

    get penalties() {
        if (!this.connected) return 0;
        let penalties = this.stats.players || 0;
        if (this.stats.cpu && this.stats.cpu.systemLoad) {
            penalties += Math.round(Math.pow(1.05, 100 * this.stats.cpu.systemLoad) * 10 - 10);
        }
        if (this.stats.frameStats) {
            penalties += this.stats.frameStats.deficit || 0;
            penalties += (this.stats.frameStats.nulled || 0) * 2;
        }
        return penalties;
    }
}

module.exports = { Node };
