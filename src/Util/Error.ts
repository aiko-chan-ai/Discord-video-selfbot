type ErrorCode = keyof typeof ErrorCodes;

class DiscordStreamClientError extends Error {
	code: string;
    constructor(code: ErrorCode) {
        super(ErrorCodes[code] ?? 'Unknown error');
        this.name = "DiscordStreamClientError";
        this.code = code;
    }
}

const ErrorCodes = {
	NO_CLIENT:
		'You must provide a client to the DiscordStreamClient constructor',
	NO_CHANNEL: 'You must provide a channel to joinVoiceChannel',
    MISSING_VOICE_CHANNEL: 'Missing voice channel',
	NO_STREAM_PATH: 'You must provide a stream path to createPlayer',
	NO_UDP: 'You must provide a UDP connection to createPlayer',
	NO_STREAM_CONNECTION:
		'You must create a stream connection to use this function',
	CHANNEL_TYPE_NOT_SUPPORTED:
		'Channel type not supported (DM and Group DM not supported)',
	INVALID_IP: 'Malformed IP address',
	MISSING_VOICE_SERVER: 'Missing voice server or token',
	JOIN_VOICE_CHANNEL_FAILED: 'Failed to join voice channel (Timeout)',
	STREAM_CONNECTION_FAILED: 'Failed to connect to stream server (Timeout)',
};

export {
    DiscordStreamClientError,
    ErrorCodes,
}