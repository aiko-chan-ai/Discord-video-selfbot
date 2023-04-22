import WebSocket from 'ws';
import { VoiceOpCodes } from '../Util/Opcode.js';
import VoiceUDP from './VoiceUDP.js';
import { DiscordStreamClientError } from '../Util/Error.js';

class VoiceConnection {
	constructor(manager, guildId, channelId) {
		Object.defineProperty(this, 'manager', { value: manager });
		this.guildId = guildId;
		this.channelId = channelId;
		this.sessionId = null;
		this.token = null;
		this._endpoint = null;
		this.voiceVersion = 7;
		this.ws = null;
		this.ssrc = null;
		this.address = null;
		this.port = null;
		this.modes = null;
		this.udp = new VoiceUDP(this);
		this.heartbeatInterval = null;
		this.selfIp = null;
		this.selfPort = null;
		this.secretkey = null;
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
	setSession(sessionId) {
		this.sessionId = sessionId;
		return this;
	}
	setServer({ token, endpoint } = {}) {
		this.token = token;
		this._endpoint = endpoint;
		return this;
	}
	handleReady(d) {
		this.ssrc = d.ssrc;
		this.address = d.ip;
		this.port = d.port;
		this.modes = d.modes;
		return this;
	}
	setupHeartbeat(interval) {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
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
				{
					name: 'H264',
					type: 'video',
					priority: 1000,
					payload_type: 101,
					rtx_payload_type: 102,
				},
				{
					name: 'VP8',
					type: 'video',
					priority: 3000,
					payload_type: 103,
					rtx_payload_type: 104,
				},
				{
					name: 'VP9',
					type: 'video',
					priority: 3000,
					payload_type: 105,
					rtx_payload_type: 106,
				},
			],
			data: {
				address: this.selfIp,
				port: this.selfPort,
				mode: 'xsalsa20_poly1305_lite',
			},
		});
	}
	handleSessionDescription(d) {
		this.secretkey = new Uint8Array(d.secret_key);
		this.udp.ready = true;
		return this;
	}
	connect(timeout = 30_000, isResume = false) {
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
				console.error(err);
			});
			this.ws.on('close', (code) => {
				// console.log('Voice connection closed', code);
				clearInterval(this.heartbeatInterval);
				this.heartbeatInterval = null;
				if (code === 4_015 || code < 4_000) {
					this.connect(timeout, true);
				}
			});
			this.ws.on('message', (data) => {
				const { op, d } = JSON.parse(data);
				switch (op) {
					case VoiceOpCodes.READY: {
						this.handleReady(d);
						this.udp.connect();
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
							console.error('Voice connection error', d);
						}
						// console.log('Voice connection unknown', { op, d });
					}
				}
			});
			let timeoutId = setTimeout(() => {
				throw new DiscordStreamClientError('JOIN_VOICE_CHANNEL_FAILED');
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
			user_id: this.manager.client.user.id,
			session_id: this.sessionId,
			token: this.token,
			video,
			streams: [{ type: 'screen', rid: '100', quality: 100 }],
		});
	}
	sendOpcode(op, data) {
		// console.log("Voice connection send", { op, d: data });
		this.ws.send(JSON.stringify({ op, d: data }));
	}
	setVideoStatus(bool) {
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
					max_bitrate: 2500000,
					max_framerate: 60,
					max_resolution: {
						type: 'fixed',
						width: 1920,
						height: 1080,
					},
				},
			],
		});
	}
	setSpeaking(speaking) {
		// audio
		this.sendOpcode(VoiceOpCodes.SPEAKING, {
			delay: 0,
			speaking: speaking ? 1 : 0,
			ssrc: this.ssrc,
		});
	}
	disconnect() {
		this.ws.close();
		this.udp = null;
	}
}

export default VoiceConnection;
