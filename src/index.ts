import { EventEmitter } from 'events';
import { GatewayOpCodes } from './Util/Opcode';
import VoiceConnection from './Class/VoiceConnection';
import StreamConnection from './Class/StreamConnection';
import Player from './Media/Player';
import VoiceUDP from './Class/VoiceUDP';
import {
	Client,
	DMChannel,
	PartialGroupDMChannel,
	VoiceChannel,
	VoiceChannelResolvable,
} from 'discord.js-selfbot-v13';
import { DiscordStreamClientError, ErrorCodes } from './Util/Error';
import { ResolutionType, parseStreamKey } from './Util/Util';
import { VideoCodec } from './Util/Constants';
import { Readable } from 'stream';
import { methods } from './Util/Library';

declare module 'discord.js-selfbot-v13' {
	interface Client {
		streamClient: DiscordStreamClient;
	}
}

interface DiscordStreamClientEvents {
	debug: (
		type: 'VoiceConnection' | 'VoiceUDP' | string,
		...args: any[]
	) => void;
	error: (
		type: 'VoiceConnection' | 'VoiceUDP' | string,
		error: Error,
	) => void;
}

interface DiscordStreamClientVoiceState {
	selfDeaf: boolean;
	selfMute: boolean;
	selfVideo: boolean;
}

interface DiscordStreamClient {
	on<K extends keyof DiscordStreamClientEvents>(
		event: K,
		listener: DiscordStreamClientEvents[K],
	): this;
	once<K extends keyof DiscordStreamClientEvents>(
		event: K,
		listener: DiscordStreamClientEvents[K],
	): this;
	emit<K extends keyof DiscordStreamClientEvents>(
		event: K,
		...args: Parameters<DiscordStreamClientEvents[K]>
	): boolean;
}

type EncryptionMode = 'xsalsa20_poly1305_lite' | 'xsalsa20_poly1305_suffix' | 'xsalsa20_poly1305';

class DiscordStreamClient extends EventEmitter {
	client!: Client;
	connection?: VoiceConnection;
	channel?: VoiceChannel | DMChannel | PartialGroupDMChannel;
	voiceState: DiscordStreamClientVoiceState = {
		selfDeaf: false,
		selfMute: false,
		selfVideo: false,
	};
	player?: Player;
	resolution: ResolutionType = '1080p';
	videoCodec: VideoCodec = 'H264';
	encryptionMode: EncryptionMode = 'xsalsa20_poly1305_lite';
	methods!: {
		open: any;
		close: any;
		random: (n: any) => any;
	}
	#isPauseScreenShare = false;
	constructor(client: Client) {
		super();
		if (!client || !(client instanceof Client))
			throw new DiscordStreamClientError('NO_CLIENT');
		Object.defineProperty(this, 'client', { value: client });
		// Inject stream client
		client.streamClient = this;
		this._initModules();
	}

	private _initModules() {
		this.methods = methods;
	}

	patch() {
		this.unpatch();
		this.client.on('raw', DiscordStreamClient._handleEvents);
	}

	sendPacket(packet: { op: number; d: any }) {
		(this.client.ws as any).broadcast(packet);
	}

	unpatch() {
		this.client.removeListener('raw', DiscordStreamClient._handleEvents);
	}

	static _handleEvents(this: Client<true>, packet: { t: string; d: any }) {
		if (typeof packet !== 'object' || !packet.t || !packet.d) return;
		const { t: event, d: data } = packet;
		if (event === 'VOICE_STATE_UPDATE') {
			if (data.user_id === this.user.id) {
				this.streamClient.connection?.setSession(data.session_id);
			}
		} else if (event === 'VOICE_SERVER_UPDATE') {
			this.streamClient.connection?.setServer(data);
		} else if (event === 'STREAM_CREATE') {
			const StreamKey = parseStreamKey(data.stream_key);
			if (this.streamClient.connection?.channelId != StreamKey.channelId)
				return;
			if (StreamKey.userId === this.user.id) {
				(
					(this.streamClient.connection as VoiceConnection)
						.streamConnection as StreamConnection
				).serverId = data.rtc_server_id;
				(
					(this.streamClient.connection as VoiceConnection)
						.streamConnection as StreamConnection
				).streamKey = data.stream_key;
				(
					(this.streamClient.connection as VoiceConnection)
						.streamConnection as StreamConnection
				).setSession(this.streamClient.connection?.sessionId as string);
			}
		} else if (event === 'STREAM_SERVER_UPDATE') {
			const StreamKey = parseStreamKey(data.stream_key);
			if (this.streamClient.connection?.channelId != StreamKey.channelId)
				return;
			if (StreamKey.userId === this.user.id) {
				(
					(this.streamClient.connection as VoiceConnection)
						.streamConnection as StreamConnection
				).setServer(data);
			}
		} else if (event === 'STREAM_DELETE') {
			const StreamKey = parseStreamKey(data.stream_key);
			if (this.streamClient.connection?.channelId != StreamKey.channelId)
				return;
			if (StreamKey.userId === this.user.id) {
				(this.streamClient.connection as VoiceConnection).disconnect();
			}
		}
	}

	setResolution(resolution: ResolutionType) {
		if (!['1440p', '1080p', '720p', '480p', 'auto'].includes(resolution))
			throw new DiscordStreamClientError('INVALID_RESOLUTION');
		this.resolution = resolution;
	}

	setVideoCodec(codec: VideoCodec) {
		if (!['VP8', 'H264'].includes(codec))
			throw new DiscordStreamClientError('INVALID_CODEC');
		this.videoCodec = codec;
	}

	setEncryptionMode(mode: EncryptionMode) {
		if (!['xsalsa20_poly1305_lite', 'xsalsa20_poly1305_suffix', 'xsalsa20_poly1305'].includes(mode))
			throw new DiscordStreamClientError('INVALID_ENCRYPTION_MODE');
		this.encryptionMode = mode;
	}

	signalVoiceChannel(
		{ selfDeaf, selfMute, selfVideo } = {} as {
			selfDeaf?: boolean;
			selfMute?: boolean;
			selfVideo?: boolean;
		},
	) {
		this.voiceState = {
			selfDeaf: selfDeaf ?? this.voiceState.selfDeaf,
			selfMute: selfMute ?? this.voiceState.selfMute,
			selfVideo: selfVideo ?? this.voiceState.selfVideo,
		};
		this.sendPacket({
			op: GatewayOpCodes.VOICE_STATE_UPDATE,
			d: {
				// @ts-ignore
				guild_id: this.channel?.guildId ?? null,
				channel_id: this.channel?.id ?? null,
				self_mute: this.voiceState.selfMute,
				self_deaf: this.voiceState.selfDeaf,
				self_video: this.voiceState.selfVideo,
			},
		});
	}

	joinVoiceChannel(
		channel: VoiceChannel | DMChannel | PartialGroupDMChannel,
		{ selfMute = false, selfDeaf = false, selfVideo = false } = {},
		timeout = 30_000,
	): Promise<VoiceConnection> {
		if (
			!channel ||
			(!['DM', 'GROUP_DM'].includes(channel.type) &&
				(!channel.isVoice() || !channel.joinable))
		)
			throw new DiscordStreamClientError('NO_CHANNEL');
		this.patch();
		this.channel = channel;
		this.signalVoiceChannel({ selfMute, selfDeaf, selfVideo });
		this.connection = new VoiceConnection(
			this,
			// @ts-ignore
			channel.guildId ?? null,
			channel.id,
		);
		// Inject stream connection
		this.connection.createStream = function () {
			this.streamConnection = new StreamConnection(
				this.manager,
				this.guildId,
				this.channelId,
			);
			this.manager.signalScreenShare();
			this.manager.pauseScreenShare(false);
			return new Promise((resolve, reject) => {
				let timeoutId = setTimeout(() => {
					reject(
						new DiscordStreamClientError(
							'STREAM_CONNECTION_FAILED',
						),
					);
				}, timeout).unref();
				let i = setInterval(() => {
					if (
						this.streamConnection?.sessionId &&
						this.streamConnection.token &&
						this.streamConnection.streamKey
					) {
						clearTimeout(timeoutId);
						clearInterval(i);
						resolve(this.streamConnection.connect());
					}
				}, 100).unref();
			});
		};
	
		return new Promise((resolve, reject) => {
			let timeoutId = setTimeout(() => {
				reject(
					new DiscordStreamClientError('JOIN_VOICE_CHANNEL_FAILED'),
				);
			}, timeout).unref();
			let i = setInterval(() => {
				if (this.connection?.sessionId && this.connection.token) {
					clearTimeout(timeoutId);
					clearInterval(i);
					resolve(this.connection.connect());
				}
			}, 100).unref();
		});
	}

	leaveVoiceChannel() {
		// Todo
		this.unpatch();
		this.channel = undefined;
		this.signalVoiceChannel();
		this.connection?.disconnect();
		this.connection = undefined;
	}

	signalScreenShare() {
		if (!this.connection?.streamConnection)
			throw new DiscordStreamClientError('NO_STREAM_CONNECTION');
		if (!this.channel)
			throw new DiscordStreamClientError('MISSING_VOICE_CHANNEL');
		let data: {
			type: 'guild' | 'call';
			guild_id: string | null;
			channel_id: string;
			preferred_region: string | null;
		} = {
			type: 'guild',
			guild_id: null,
			channel_id: this.channel.id,
			preferred_region: null,
		};
		if (['DM', 'GROUP_DM'].includes(this.channel.type)) {
			data.type = 'call';
		} else {
			if (!this.channel.isVoice())
				throw new DiscordStreamClientError('MISSING_VOICE_CHANNEL');
			data.guild_id = this.channel.guildId;
		}
		(this.client.ws as any).broadcast({
			// @ts-ignore
			op: GatewayOpCodes.STREAM_CREATE,
			d: data,
		});
	}

	pauseScreenShare(isPause = false) {
		if (!this.connection?.streamConnection) return;
		if (this.#isPauseScreenShare === isPause) return;
		let streamKey;
		if (['DM', 'GROUP_DM'].includes(this.channel?.type as string)) {
			streamKey = `call:${this.channel?.id}:${this.client.user?.id}`;
		} else {
			if (!this.channel || !this.channel.isVoice())
				throw new DiscordStreamClientError('MISSING_VOICE_CHANNEL');
			streamKey = `guild:${this.channel.guildId}:${this.channel.id}:${this.client.user?.id}`;
		}
		(this.client.ws as any).broadcast({
			// @ts-ignore
			op: GatewayOpCodes.STREAM_SET_PAUSED,
			d: {
				stream_key: streamKey,
				paused: isPause,
			},
		});
		this.#isPauseScreenShare = isPause;
	}

	stopScreenShare() {
		if (!this.connection?.streamConnection) return;
		let streamKey;
		if (['DM', 'GROUP_DM'].includes(this.channel?.type as string)) {
			streamKey = `call:${this.channel?.id}:${this.client.user?.id}`;
		} else {
			if (!this.channel || !this.channel.isVoice())
				throw new DiscordStreamClientError('MISSING_VOICE_CHANNEL');
			streamKey = `guild:${this.channel.guildId}:${this.channel.id}:${this.client.user?.id}`;
		}
		(this.client.ws as any).broadcast({
			// @ts-ignore
			op: GatewayOpCodes.STREAM_DELETE,
			d: {
				stream_key: streamKey,
			},
		});
		this.connection.streamConnection = undefined;
		this.#isPauseScreenShare = false;
	}

	createPlayer(
		playable: string | Readable,
		udpConnection: VoiceUDP,
		ffmpegPath?: {
			ffmpeg: string;
			ffprobe: string;
		},
	) {
		if (!this.connection)
			throw new DiscordStreamClientError('NO_STREAM_CONNECTION');
		const player = new Player(playable, udpConnection, ffmpegPath);
		player.once('spawnProcess', () => {
			this.pauseScreenShare(false);
		});
		player.once('finish', () => {
			udpConnection.voiceConnection.setSpeaking(false);
			udpConnection.voiceConnection.setVideoStatus(false);
			this.pauseScreenShare(true);
			this.player = undefined;
		});
		return player;
	}
}

export default DiscordStreamClient;
export {
	DiscordStreamClient,
	Player,
	VoiceConnection,
	StreamConnection,
	VoiceUDP,
	DiscordStreamClientError,
	ErrorCodes,
};
