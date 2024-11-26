class Connection {
    /**
     * @param {import("../index").Player} player 
     */
    constructor(player) {
        this.player = player; // Reference to the player, essential for the connection
        this.sessionId = null;
        this.voice = {
            sessionId: null,
            endpoint: null,
            token: null,
        };
        this.region = null; // Voice region
        this.selfDeaf = false; // Self deaf status
        this.selfMute = false; // Self mute status
        this.voiceChannel = player.voiceChannel; // Initial voice channel from player
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

        // Emit debug event only if the region changes
        if (previousVoiceRegion !== this.region) {
            this.player.toddysriffy.emit("debug", `[Player ${this.player.guildId} - CONNECTION] Voice region changed from ${previousVoiceRegion || 'unknown'} to ${this.region}. Updating node's voice data.`);
        }

        // Unpause only if the player is paused
        if (this.player.paused) {
            this.player.toddysriffy.emit("debug", this.player.node.name, `Unpaused ${this.player.guildId} player, expecting it was paused while the player moved to ${this.voiceChannel}.`);
            this.player.pause(false);
        }

        this.updatePlayerVoiceData();
    }

    setStateUpdate(data) {
        const { session_id: sessionId, channel_id: channelId, self_deaf: selfDeaf, self_mute: selfMute } = data;
        
        // Emit debug event for voice state update
        this.player.toddysriffy.emit("debug", `[Player ${this.player.guildId} - CONNECTION] Received Voice State Update: ${channelId !== null ? `Connected to ${this.voiceChannel}` : `Disconnected from ${this.voiceChannel}`}`);

        // Handle manual disconnection from voice channel
        if (channelId == null) {
            this.player.destroy();
            this.player.toddysriffy.emit("playerDestroy", this.player);
            return; // Early return to avoid further processing
        }

        // Handle voice channel changes
        if (this.player.voiceChannel && channelId && this.player.voiceChannel !== channelId) {
            this.player.toddysriffy.emit("playerMove", this.player.voiceChannel, channelId);
            this.player.voiceChannel = channelId; // Update the player's voice channel
            this.voiceChannel = channelId; // Update the connection's voice channel
        }

        // Update self-deaf and self-mute status
        this.selfDeaf = selfDeaf;
        this.selfMute = selfMute;
        this.voice.sessionId = sessionId || null; // Update sessionId
    }

    updatePlayerVoiceData() {
        const data = {
            voice: this.voice,
            volume: this.player.volume, // Include volume in the update
        };
        this.player.toddysriffy.emit("debug", this.player.node.name, `[Rest Manager] Sending an Update Player request with data: ${JSON.stringify(data)}`);
        
        // Make the REST request to update player
        this.player.node.rest.updatePlayer({
            guildId: this.player.guildId,
            data,
        });
    }
}

module.exports = { Connection };
