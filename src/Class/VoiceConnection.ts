import WebSocket from 'ws';
import { VoiceOpCodes } from '../Util/Opcode';
import StreamConnection from './StreamConnection';
import { DiscordStreamClient } from '../index';
import VoiceUDP from './VoiceUDP';
import { DiscordStreamClientError } from '../Util/Error';
import { Snowflake } from 'discord.js-selfbot-v13';
import { getResolutionData } from '../Util/Util';

class VoiceConnection {
	serverId!: Snowflake;
	guildId?: Snowflake;
	channelId?: Snowflake;
	sessionId?: string;
	token?: string;
	_endpoint?: string;
	voiceVersion: number;
	ws?: WebSocket;
	ssrc?: number;
	address?: string;
	port?: number;
	modes?: string[];
	udp?: VoiceUDP;
	heartbeatInterval?: NodeJS.Timeout;
	selfIp?: string;
	selfPort?: number;
	secretkey?: Uint8Array;
	manager!: DiscordStreamClient;
	streamConnection?: StreamConnection;
	constructor(
		manager: DiscordStreamClient,
		guildId?: Snowflake,
		channelId?: Snowflake,
	) {
		Object.defineProperty(this, 'manager', { value: manager });
		this.guildId = guildId;
		this.channelId = channelId;
		this.voiceVersion = 7;
		this.udp = new VoiceUDP(this);
	}
	get videoSsrc() {
		return this.ssrc ? this.ssrc + 1 : 0;
	}
	get rtxSsrc() {
		return this.ssrc ? this.ssrc + 2 : 0;
	}
	get wsEndpoint() {
		return `wss://${this._endpoint}/?v=${this.voiceVersion}`;
	}
	get isReady() {
		return (
			this.ws && this.ws.readyState === WebSocket.OPEN && this.udp?.ready
		);
	}
	setSession(sessionId: string) {
		this.sessionId = sessionId;
		return this;
	}
	setServer(
		{ token, endpoint } = {} as {
			token?: string;
			endpoint?: string;
		},
	) {
		this.token = token;
		this._endpoint = endpoint;
		return this;
	}
	handleReady(d: {
		ssrc: number;
		ip: string;
		port: number;
		modes: string[];
	}) {
		this.ssrc = d.ssrc;
		this.address = d.ip;
		this.port = d.port;
		this.modes = d.modes;
		return this;
	}
	setupHeartbeat(interval: number) {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = undefined;
		}
		this.heartbeatInterval = setInterval(() => {
			this.sendOpcode(VoiceOpCodes.HEARTBEAT, interval);
		}, interval).unref();
	}
	selectProtocols() {
		this.sendOpcode(VoiceOpCodes.SELECT_PROTOCOL, {
			protocol: 'udp',
			codecs: [
				{
					name: 'opus',
					type: 'audio',
					priority: 1000,
					payload_type: 120,
				},
				/*
				{
					name: 'H264',
					type: 'video',
					priority: 1000,
					payload_type: 101,
					rtx_payload_type: 102,
				},
				*/
				{
					name: 'VP8',
					type: 'video',
					priority: 3000,
					payload_type: 103,
					rtx_payload_type: 104,
				},
				/*
				{
					name: 'VP9',
					type: 'video',
					priority: 3000,
					payload_type: 105,
					rtx_payload_type: 106,
				},
				*/
			],
			data: {
				address: this.selfIp,
				port: this.selfPort,
				mode: 'xsalsa20_poly1305_lite',
			},
		});
		return this;
	}
	handleSessionDescription(d: { secret_key: Uint8Array }) {
		this.secretkey = new Uint8Array(d.secret_key);
		if (this.udp) {
			this.udp.ready = true;
		}
		return this;
	}
	connect(timeout = 30_000, isResume = false): Promise<this> {
		return new Promise((resolve, reject) => {
			if (!this.wsEndpoint || !this.token) {
				throw new DiscordStreamClientError('MISSING_VOICE_SERVER');
			}
			this.ws = new WebSocket(this.wsEndpoint, {
				followRedirects: true,
				headers: {
					origin: 'https://discord.com',
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
				},
			});
			this.ws.on('open', () => {
				if (isResume === true) {
					this.doResume();
				} else {
					this.doIdentify();
				}
			});
			this.ws.on('error', (err) => {
				this.manager.emit('error', 'VoiceConnection', err);
			});
			this.ws.on('close', (code) => {
				this.manager.emit(
					'debug',
					'VoiceConnection',
					`Voice connection closed ${code}`,
				);
				clearInterval(this.heartbeatInterval);
				this.heartbeatInterval = undefined;
				if (code === 4_015) {
					this.connect(timeout, true);
				}
			});
			this.ws.on('message', (data: string) => {
				const { op, d } = JSON.parse(data);
				switch (op) {
					case VoiceOpCodes.READY: {
						this.handleReady(d);
						this.udp?.connect();
						this.setVideoStatus(false);
						break;
					}
					case VoiceOpCodes.HELLO: {
						// Start heartbeat
						this.setupHeartbeat(d.heartbeat_interval);
						break;
					}
					case VoiceOpCodes.SESSION_DESCRIPTION: {
						this.handleSessionDescription(d);
						break;
					}
					case VoiceOpCodes.RESUMED: {
						// console.log('Voice connection resumed');
						break;
					}
					case VoiceOpCodes.HEARTBEAT_ACK: {
						break;
					}
					case VoiceOpCodes.SPEAKING: {
						// console.log('Voice connection speaking', d);
						break;
					}
					default: {
						if (op >= 4_000) {
							this.manager.emit(
								'debug',
								'VoiceConnection',
								`Voice connection error ${op}`,
								d,
							);
						}
					}
				}
			});
			let timeoutId = setTimeout(() => {
				clearInterval(i);
				this.manager.emit(
					'debug',
					'VoiceConnection',
					`Voice connection timed out ${
						isResume ? 'with' : 'without'
					} resume`,
				);
				if (isResume) {
					this.doResume();
				} else {
					throw new DiscordStreamClientError(
						'JOIN_VOICE_CHANNEL_FAILED',
					);
				}
			}, timeout).unref();
			let i = setInterval(() => {
				if (this.isReady) {
					clearTimeout(timeoutId);
					clearInterval(i);
					resolve(this);
				}
			}, 100).unref();
		});
	}
	doResume() {
		this.sendOpcode(VoiceOpCodes.RESUME, {
			server_id: this.guildId ?? this.channelId,
			session_id: this.sessionId,
			token: this.token,
		});
	}
	doIdentify(video = true) {
		this.sendOpcode(VoiceOpCodes.IDENTIFY, {
			server_id: this.serverId ?? this.guildId ?? this.channelId,
			user_id: this.manager.client.user?.id,
			session_id: this.sessionId,
			token: this.token,
			video,
			streams: [{ type: 'screen', rid: '100', quality: 100 }],
		});
	}
	sendOpcode(op: number, data: any) {
		// console.log("Voice connection send", { op, d: data });
		this.ws?.send(JSON.stringify({ op, d: data }));
	}
	setVideoStatus(bool: boolean) {
		const videoData = getResolutionData(this.manager?.resolution);
		this.sendOpcode(VoiceOpCodes.SOURCES, {
			audio_ssrc: this.ssrc,
			video_ssrc: bool ? this.videoSsrc : 0,
			rtx_ssrc: bool ? this.rtxSsrc : 0,
			streams: [
				{
					type: 'video',
					rid: '100',
					ssrc: bool ? this.videoSsrc : 0,
					active: true,
					quality: 100,
					rtx_ssrc: bool ? this.rtxSsrc : 0,
					max_bitrate: videoData.bitrate,
					max_framerate: videoData.fps,
					max_resolution: {
						type: videoData.type,
						width: videoData.width,
						height: videoData.height,
					},
				},
			],
		});
	}
	setSpeaking(speaking: boolean) {
		// audio
		this.sendOpcode(VoiceOpCodes.SPEAKING, {
			delay: 0,
			speaking: speaking ? 1 : 0,
			ssrc: this.ssrc,
		});
	}
	disconnect() {
		this.ws?.close();
		this.udp?.stop();
	}
	// @ts-ignore
	createStream(): Promise<this> {}
}

export default VoiceConnection;
