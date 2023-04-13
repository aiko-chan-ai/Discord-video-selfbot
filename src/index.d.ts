import {
	Client,
	GuildVoiceChannelResolvable,
	Snowflake,
	VoiceBasedChannel,
} from "discord.js-selfbot-v13";
import EventEmitter from "events";
import { Writable, Transform } from "stream";

interface JoinVoiceChannelOptions {
	selfDeaf?: boolean;
	selfMute?: boolean;
	selfVideo?: boolean;
}

interface PlayerEvents {
	finishVideo: [];
	finishAudio: [];
	finish: [];
	error: [err: Error];
}

declare class Player extends EventEmitter {
	public url?: string;
	public voiceUdp?: VoiceUDP;
	private command?: any;
	private videoStream?: Writable;
	private audioStream?: Writable;
	private ivfStream?: Transform;
	private opusStream?: any;
	constructor(url: string, udp: VoiceUDP);
	public play(bitrateVideo?: number, fpsOutput?: number): void;
	public stop(): void;
	public on<K extends keyof PlayerEvents>(
		event: K,
		listener: (...args: PlayerEvents[K]) => Awaitable<void>
	): this;
	public on<S extends string | symbol>(
		event: Exclude<S, keyof PlayerEvents>,
		listener: (...args: any[]) => Awaitable<void>
	): this;

	public once<K extends keyof PlayerEvents>(
		event: K,
		listener: (...args: PlayerEvents[K]) => Awaitable<void>
	): this;
	public once<S extends string | symbol>(
		event: Exclude<S, keyof PlayerEvents>,
		listener: (...args: any[]) => Awaitable<void>
	): this;
}

declare class VoiceUDP {
	constructor(voiceConnection: VoiceConnection | StreamConnection);
	public nonce: number;
	public ready: boolean;
	public connect(): Promise<void>;
	private handleIncoming(): void;
	private sendBlankPacket(): void;
	public sendPacket(packet: Buffer): void;
	private sendAudioFrame(frame: any): void;
	private sendVideoFrame(frame: any): void;
	public stop(): VoiceUDP;
	private getNewNonceBuffer(): number;
}

declare class VoiceConnection {
	public readonly manager: DiscordStreamClient;
	constructor(
		manager: DiscordStreamClient,
		guildId: Snowflake,
		channelId: Snowflake,
	);
	public guildId: Snowflake;
	public channelId: Snowflake;
	public sessionId?: string;
	public token?: string;
	private _endpoint?: string;
	public voiceVersion: number;
	public ws?: WebSocket;
	public ssrc?: number;
	public address?: string;
	public port?: number;
	public modes?: string[];
	public udp: VoiceUDP;
	public heartbeatInterval?: number;
	public selfIp?: string;
	public selfPort?: number;
	public secretkey?: Uint8Array;
	public streamConnection?: StreamConnection;
	public readonly videoSsrc: number;
	public readonly rtxSsrc: number;
	public readonly wsEndpoint: string;
	public readonly isReady: boolean;
	private setSession(sessionId: string): VoiceConnection;
	private setServer(packet: {
		token: string;
		endpoint: string;
	}): VoiceConnection;
	private handleReady(packet: {
		ssrc: number;
		address: string;
		port: number;
		modes: string[];
	}): VoiceConnection;
	private setupHeartbeat(interval: number): void;
	private selectProtocols(): void;
	private handleSessionDescription(packet: {
		secret_key: number[];
	}): VoiceConnection;
	public connect(timeout?: number): Promise<VoiceConnection>;
	private doResume(): void;
	private doIdentify(video?: boolean): void;
	private sendOpcode(op: number, data: any): void;
	public setVideoStatus(bool?: boolean): void;
	public setSpeaking(speaking?: boolean): void;
	public createStream(): Promise<StreamConnection>;
}

declare class StreamConnection extends VoiceConnection {
	public serverId: string;
	public streamKey: string;
}

declare class DiscordStreamClient {
	public readonly client: Client;
	constructor(client: Client);
	public connection: VoiceConnection | StreamConnection;
	public channel: GuildVoiceChannelResolvable | null;
	public selfDeaf: boolean;
	public selfMute: boolean;
	public selfVideo: boolean;
	public patch(): void;
	public unpatch(): void;
	private _handleEvents(packet: { t: string; d: any }): void;
	public signalVoiceChannel(options?: JoinVoiceChannelOptions): Promise<void>;
	public joinVoiceChannel(
		channel: VoiceBasedChannel,
		options?: JoinVoiceChannelOptions
	): Promise<VoiceConnection | StreamConnection>;
	public leaveVoiceChannel(): Promise<void>;
	public signalScreenShare(): void;
	public pauseScreenShare(isPause?: boolean): void;
	public createPlayer(url: string, udp: VoiceUDP): Player;
}

export {
	DiscordStreamClient,
	DiscordStreamClient as default,
	StreamConnection,
	VoiceConnection,
	VoiceUDP,
	Player,
};
