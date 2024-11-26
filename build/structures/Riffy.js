const { EventEmitter } = require("events");
const { Node } = require("./Node");
const { Player } = require("./Player");
const { Track } = require("./Track");
const { version: pkgVersion } = require("../../package.json");
const versions = ["v3", "v4"];

class ToddysRiffy extends EventEmitter {
    constructor(client, nodes, options) {
        super();
        if (!client) throw new Error("Client is required to initialize ToddysRiffy");
        if (!Array.isArray(nodes) || nodes.length === 0) {
            throw new Error(`Nodes are required & must be a non-empty array (Received ${typeof nodes}) to initialize ToddysRiffy`);
        }
        if (typeof options.send !== "function") {
            throw new Error("Send function is required to initialize ToddysRiffy");
        }

        this.client = client;
        this.nodes = nodes;
        this.nodeMap = new Map();
        this.players = new Map();
        this.options = options;
        this.clientId = null;
        this.initiated = false;
        this.send = options.send;
        this.defaultSearchPlatform = options.defaultSearchPlatform || "ytmsearch";
        this.restVersion = options.restVersion || "v3";

        // Package Version Of ToddysRiffy
        this.version = pkgVersion;

        if (!versions.includes(this.restVersion)) {
            throw new RangeError(`${this.restVersion} is not a valid version`);
        }
    }

    get leastUsedNodes() {
        return [...this.nodeMap.values()]
            .filter(node => node.connected)
            .sort((a, b) => a.rest.calls - b.rest.calls);
    }

    init(clientId) {
        if (this.initiated) return this;
        this.clientId = clientId;
        this.nodes.forEach(node => this.createNode(node));
        this.initiated = true;

        // Load plugins if they exist
        this.plugins?.forEach(plugin => plugin.load(this));
    }

    createNode(options) {
        const node = new Node(this, options, this.options);
        this.nodeMap.set(options.name || options.host, node);
        node.connect();
        this.emit("nodeCreate", node);
        return node;
    }

    destroyNode(identifier) {
        const node = this.nodeMap.get(identifier);
        if (!node) return;
        node.disconnect();
        this.nodeMap.delete(identifier);
        this.emit("nodeDestroy", node);
    }

    updateVoiceState(packet) {
        if (!["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(packet.t)) return;
        const player = this.players.get(packet.d.guild_id);
        if (!player) return;

        if (packet.t === "VOICE_SERVER_UPDATE") {
            player.connection.setServerUpdate(packet.d);
        } else if (packet.t === "VOICE_STATE_UPDATE" && packet.d.user_id === this.clientId) {
            player.connection.setStateUpdate(packet.d);
        }
    }

    fetchRegion(region) {
        return [...this.nodeMap.values()]
            .filter(node => node.connected && node.regions?.includes(region?.toLowerCase()))
            .sort((a, b) => {
                const aLoad = a.stats.cpu ? (a.stats.cpu.systemLoad / a.stats.cpu.cores) * 100 : 0;
                const bLoad = b.stats.cpu ? (b.stats.cpu.systemLoad / b.stats.cpu.cores) * 100 : 0;
                return aLoad - bLoad;
            });
    }

    createConnection(options) {
        if (!this.initiated) throw new Error("You have to initialize ToddysRiffy in your ready event");
        const player = this.players.get(options.guildId);
        if (player) return player;

        if (this.leastUsedNodes.length === 0) throw new Error("No nodes are available");
        
        const regionNode = options.region ? this.fetchRegion(options.region)[0] : null;
        const node = regionNode ? this.nodeMap.get(regionNode.name) : this.nodeMap.get(this.leastUsedNodes[0].name);
        
        if (!node) throw new Error("No nodes are available");
        return this.createPlayer(node, options);
    }

    createPlayer(node, options) {
        const player = new Player(this, node, options);
        this.players.set(options.guildId, player);
        player.connect(options);
        this.emit("playerCreate", player);
        return player;
    }

    destroyPlayer(guildId) {
        const player = this.players.get(guildId);
        if (!player) return;
        player.destroy();
        this.players.delete(guildId);
        this.emit("playerDestroy", player);
    }

    removeConnection(guildId) {
        this.players.get(guildId)?.destroy();
        this.players.delete(guildId);
    }

    async resolve({ query, source, requester, node }) {
        if (!this.initiated) throw new Error("You have to initialize ToddysRiffy in your ready event");
        if (node && (typeof node !== "string" && !(node instanceof Node))) {
            throw new Error(`'node' property must either be a node identifier/name ('string') or an Node/Node Class, but received: ${typeof node}`);
        }

        const sources = source || this.defaultSearchPlatform;
        const requestNode = (node && typeof node === 'string' ? this.nodeMap.get(node) : node) || this.leastUsedNodes[0];
        if (!requestNode) throw new Error("No nodes are available.");
        
        const regex = /^https?:\/\//;
        const identifier = regex.test(query) ? query : `${sources}:${query}`;
        
        let response = await requestNode.rest.makeRequest(`GET`, `/${requestNode.rest.version}/loadtracks?identifier=${encodeURIComponent(identifier)}`);

        // For resolving identifiers - Only works in Spotify and Youtube
        if (response.loadType === "empty" || response.loadType === "NO_MATCHES") {
            response = await this.resolveIdentifier(query, requestNode);
        }

        const tracks = this.processResponseTracks(response, requester, requestNode);
        const playlistInfo = this.processPlaylistInfo(response);
        const loadType = response.loadType ?? null;
        const pluginInfo = response.pluginInfo ?? {};

        return {
            loadType,
            exception: this.getException(response),
            playlistInfo,
            pluginInfo,
            tracks,
        };
    }

    async resolveIdentifier(query, requestNode) {
        const identifiers = [
            `https://open.spotify.com/track/${query}`,
            `https://www.youtube.com/watch?v=${query}`,
        ];

        for (const identifier of identifiers) {
            const response = await requestNode.rest.makeRequest(`GET`, `/${requestNode.rest.version}/loadtracks?identifier=${encodeURIComponent(identifier)}`);
            if (response.loadType !== "empty" && response.loadType !== "NO_MATCHES") {
                return response;
            }
        }
        return { loadType: "empty", data: [] };
    }

    processResponseTracks(response, requester, requestNode) {
        if (requestNode.rest.version === "v4") {
            if (response.loadType === "track") {
                return response.data ? [new Track(response.data, requester, requestNode)] : [];
            } else if (response.loadType === "playlist") {
                return response.data?.tracks ? response.data.tracks.map(track => new Track(track, requester, requestNode)) : [];
            } else if (response.loadType === "search") {
                return response.data ? response.data.map(track => new Track(track, requester, requestNode)) : [];
            }
        } else {
            return response?.tracks ? response.tracks.map(track => new Track(track, requester, requestNode)) : [];
        }
    }

    processPlaylistInfo(response) {
        return response.loadType === "playlist" ? response.data?.info ?? null : response.playlistInfo ?? null;
    }

    getException(response) {
        return response.loadType === "error" ? response.data : response.loadType === "LOAD_FAILED" ? response.exception : null;
    }

    get(guildId) {
        const player = this.players.get(guildId);
        if (!player) throw new Error(`Player not found for ${guildId} guildId`);
        return player;
    }
}

module.exports = { ToddysRiffy };
