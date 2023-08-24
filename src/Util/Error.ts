type ErrorCode = keyof typeof ErrorCodes;

class DiscordStreamClientError extends Error {
	code: string;
	constructor(code: ErrorCode) {
		super(ErrorCodes[code] ?? 'Unknown error');
		this.name = 'DiscordStreamClientError';
		this.code = code;
	}
}

const ErrorCodes = {
	NO_CLIENT:
		'You must provide a client to the DiscordStreamClient constructor',
	NO_CHANNEL: 'You must provide a channel to joinVoiceChannel',
	MISSING_VOICE_CHANNEL: 'Missing voice channel',
	NO_STREAM_CONNECTION:
		'You must create a stream connection to use this function',
	CHANNEL_TYPE_NOT_SUPPORTED:
		'Channel type not supported (DM and Group DM not supported)',
	INVALID_IP: 'Malformed IP address',
	MISSING_VOICE_SERVER: 'Missing voice server or token',
	JOIN_VOICE_CHANNEL_FAILED: 'Failed to join voice channel (Timeout)',
	STREAM_CONNECTION_FAILED: 'Failed to connect to stream server (Timeout)',
	INVALID_RESOLUTION: 'Invalid resolution (1440p, 1080p, 720p, 480p or auto)',
	PLAYER_MISSING_PLAYABLE: 'Player is missing playable (string or Readable)',
	PLAYER_MISSING_VOICE_UDP: 'Player is missing voiceUdp',
	PLAYER_NOT_PLAYING: 'Player is not playing',
	STREAM_INVALID: 'Invalid stream (No metadata)',
	INVALID_SEEK_TIME: 'Invalid seek time (Must be a number)',
	INVALID_VOLUME: 'Invalid volume (Must be a number between 0 and 200)',
	INVALID_CODEC: 'Invalid codec (VP8 or H264)',
	MISSING_ENCRYPTION_MODULE:
		'Missing encryption module (sodium, libsodium-wrappers or tweetnacl)',
	INVALID_ENCRYPTION_MODE:
		'Invalid encryption mode (xsalsa20_poly1305, xsalsa20_poly1305_suffix or xsalsa20_poly1305_lite)',
};

export { DiscordStreamClientError, ErrorCodes, ErrorCode };
