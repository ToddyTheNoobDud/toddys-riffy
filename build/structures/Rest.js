const { fetch: undiciFetch, Response } = require("undici");
const nodeUtil = require("node:util");

class Rest {
  constructor(riffy, options) {
    this.riffy = riffy;
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
    const headers = new Headers({
      "Content-Type": "application/json",
      Authorization: this.password,
    });

    const requestOptions = {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    };

    let response;
    try {
      response = await undiciFetch(`${this.url}${endpoint}`, requestOptions);
      this.calls++;
    } catch (e) {
      throw new Error(`Error making Node Request (likely caused by Network Issue): ${method} ${this.url}${endpoint}`, { cause: e });
    }

    const data = await this.parseResponse(response);
    this.riffy.emit("apiResponse", endpoint, response);
    this.logRequest(method, endpoint, body, response, data);

    return includeHeaders ? { data, headers: response.headers } : data;
  }

  logRequest(method, endpoint, body, response, data) {
    this.riffy.emit(
      "debug",
      `[Rest] ${method} ${endpoint.startsWith("/") ? endpoint : `/${endpoint}`} ${body ? `body: ${JSON.stringify(body)}` : ""} -> \n Status Code: ${response.status} (${response.statusText}) \n Response(body): ${JSON.stringify(data)} \n Headers: ${nodeUtil.inspect(response.headers)}`
    );
  }

  async getPlayers() {
    return this.makeRequest("GET", `/${this.version}/sessions/${this.sessionId}/players`);
  }

  async updatePlayer(options) {
    let { data: requestBody } = options;

    if (
      (requestBody.track && requestBody.track.encoded && requestBody.track.identifier) ||
      (requestBody.encodedTrack && requestBody.identifier)
    ) {
      throw new Error(`encoded And identifier are mutually exclusive in Update Player Endpoint`);
    }

    if (this.version === "v3" && options.data?.track) {
      const { track, ...otherRequestData } = requestBody;
      requestBody = { ...otherRequestData };
      Object.assign(
        options.data,
        track.encoded !== undefined ? { encodedTrack: track.encoded } : { identifier: track.identifier }
      );
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

  /**
   * @description Parses The Process Request and Performs necessary Checks
   * @param {Response} req
   * @returns {object | null}
   */
  async parseResponse(req) {
    if (req.status === 204) {
      return null;
    }
    try {
      const contentType = req.headers.get("Content-Type");
      return await req[contentType.includes("text/plain") ? "text" : "json"]();
    } catch (e) {
      this.riffy.emit("debug", `[Rest - Error] There was an Error for ${new URL(req.url).pathname} ${e}`);
      return null;
    }
  }
}

module.exports = { Rest };
