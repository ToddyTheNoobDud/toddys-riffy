const { fetch: undiciFetch } = require("undici");
const nodeUtil = require("node:util");

class Rest {
    constructor(toddysriffy, options) {
        this.toddysriffy = toddysriffy;
        this.url = `http${options.secure ? "s" : ""}://${options.host}:${options.port}`;
        this.sessionId = options.sessionId;
        this.password = options.password;
        this.version = options.restVersion;
        this.calls = 0;
    }

    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }

    async makeRequest(method, endpoint, body = null, includeHeaders = false) {
        const headers = {
            "Content-Type": "application/json",
            Authorization: this.password,
        };

        const requestOptions = {
            method,
            headers,
            body: body ? JSON.stringify(body) : null,
        };

        try {
            const response = await undiciFetch(`${this.url}${endpoint}`, requestOptions);
            this.calls++;
            const data = await this.parseResponse(response);
            this.toddysriffy.emit("apiResponse", endpoint, response);
            this.logRequest(method, endpoint, response, data);
            return includeHeaders ? { data, headers: response.headers } : data;
        } catch (e) {
            throw new Error(`Error making Node Request: ${method} ${this.url}${endpoint}`, { cause: e });
        }
    }

    logRequest(method, endpoint, response, data) {
        this.toddysriffy.emit(
            "debug",
            `[Rest] ${method} ${endpoint} -> Status Code: ${response.status} (${response.statusText}) Response: ${JSON.stringify(data)}`
        );
    }

    async getPlayers() {
        return this.makeRequest("GET", `/${this.version}/sessions/${this.sessionId}/players`);
    }

    async updatePlayer(options) {
        let { data: requestBody } = options;

        // Ensure mutual exclusivity of encoded and identifier
        if ((requestBody.track && requestBody.track.encoded && requestBody.track.identifier) || (requestBody.encodedTrack && requestBody.identifier)) {
            throw new Error(`encoded and identifier are mutually exclusive in Update Player Endpoint`);
        }

        if (this.version === "v3" && options.data?.track) {
            const { track, ...otherRequestData } = requestBody;
            requestBody = { ...otherRequestData };
            Object.assign(options.data, track.encoded !== undefined ? { encodedTrack: track.encoded } : { identifier: track.identifier });
        }

        return this.makeRequest("PATCH", `/${this.version}/sessions/${this.sessionId}/players/${options.guildId}?noReplace=false`, options.data);
    }

    async destroyPlayer(guildId) {
        return this.makeRequest("DELETE", `/${this.version}/sessions/${this.sessionId}/players/${guildId}`);
    }

    async getTracks(identifier) {
        return this.makeRequest("GET", `/${this.version}/loadtracks?identifier=${encodeURIComponent(identifier)}`);
    }

    async decodeTrack(track, node) {
        if (!node) node = this.leastUsedNodes[0];
        return this.makeRequest("GET", `/${this.version}/decodetrack?encodedTrack=${encodeURIComponent(track)}`);
    }

    async decodeTracks(tracks) {
        return this.makeRequest("POST", `/${this.version}/decodetracks`, tracks);
    }

    async getStats() {
        return this.makeRequest("GET", `/${this.version}/stats`);
    }

    async getInfo() {
        return this.makeRequest("GET", `/${this.version}/info`);
    }

    async getRoutePlannerStatus() {
        return this.makeRequest("GET", `/${this.version}/routeplanner/status`);
    }

    async getRoutePlannerAddress(address) {
        return this.makeRequest("POST", `/${this.version}/routeplanner/free/address`, { address });
    }

    async parseResponse(req) {
        if (req.status === 204) return null;
        try {
            const contentType = req.headers.get("Content-Type");
            return await req[contentType.includes("text/plain") ? "text" : "json"]();
        } catch (e) {
            this.toddysriffy.emit("debug", `[Rest - Error] ${new URL(req.url).pathname} ${e}`);
            return null;
        }
    }
}

module.exports = { Rest };
