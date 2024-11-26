class Connection {
    /**
     * @param {import("../index").Player} player 
     */
    constructor(player) {
        this.player = player;
        this.sessionId = null;
        this.voice = {
            sessionId: null,
            endpoint: null,
            token: null,
        };
        this.region = null;
        this.selfDeaf = false;
        this.selfMute = false;
        this.voiceChannel = player.voiceChannel;
    }

    setServerUpdate(data) {
        const { endpoint, token } = data;
        if (!endpoint) {
            throw new Error(`Missing 'endpoint' property in VOICE_SERVER_UPDATE packet/payload. Wait for some time or disconnect the bot from the voice channel and try again.`);
        }

        const previousVoiceRegion = this.region;
        this.voice.endpoint = endpoint;
        this.voice.token = token;
        this.region = endpoint.split(".")[0].replace(/[0-9]/g, "") || null;

        if (previousVoiceRegion !== this.region) {
            this.player.riffy.emit("debug", `[Player ${this.player.guildId} - CONNECTION] Voice region changed from ${previousVoiceRegion || 'unknown'} to ${this.region}. Updating node's voice data.`);
        }

        if (this.player.paused) {
            this.player.riffy.emit("debug", this.player.node.name, `Unpaused ${this.player.guildId} player, expecting it was paused while the player moved to ${this.voiceChannel}.`);
            this.player.pause(false);
        }

        this.updatePlayerVoiceData();
    }

    setStateUpdate(data) {
        const { session_id: sessionId, channel_id: channelId, self_deaf: selfDeaf, self_mute: selfMute } = data;

        this.player.riffy.emit("debug", `[Player ${this.player.guildId} - CONNECTION] Received Voice State Update: ${channelId !== null ? `Connected to ${this.voiceChannel}` : `Disconnected from ${this.voiceChannel}`}`);

        // If player is manually disconnected from VC
        if (channelId == null) {
            this.player.destroy();
            this.player.riffy.emit("playerDestroy", this.player);
            return; // Early return to avoid further processing
        }

        if (this.player.voiceChannel && channelId && this.player.voiceChannel !== channelId) {
            this.player.riffy.emit("playerMove", this.player.voiceChannel, channelId);
            this.player.voiceChannel = channelId;
            this.voiceChannel = channelId;
        }

        this.selfDeaf = selfDeaf;
        this.selfMute = selfMute;
        this.voice.sessionId = sessionId || null;
    }

    updatePlayerVoiceData() {
        const data = {
            voice: this.voice,
            volume: this.player.volume,
        };

        this.player.riffy.emit("debug", this.player.node.name, `[Rest Manager] Sending an Update Player request with data: ${JSON.stringify(data)}`);
        this.player.node.rest.updatePlayer({
            guildId: this.player.guildId,
            data,
        });
    }
}

module.exports = { Connection };
