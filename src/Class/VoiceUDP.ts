import { createSocket, Socket } from 'dgram';
import { isIPv4 } from 'net';
import { AudioPacketizer } from '../Packet/AudioPacketizer';
import { VideoPacketizer } from '../Packet/VideoPacketizer';
import { max_int32bit } from '../Packet/BaseMediaPacketizer';
import VoiceConnection from './VoiceConnection';
import { DiscordStreamClientError } from '../Util/Error';

// credit to discord.js
function parseLocalPacket(message: any) {
	const packet = Buffer.from(message);
	const ip = packet.subarray(8, packet.indexOf(0, 8)).toString('utf8');
	if (!isIPv4(ip)) {
		throw new DiscordStreamClientError('INVALID_IP');
	}
	const port = packet.readUInt16BE(packet.length - 2);
	return { ip, port };
}

const KEEP_ALIVE_INTERVAL = 5e3;
const MAX_COUNTER_VALUE = 2 ** 32 - 1;

class VoiceUDP {
	voiceConnection!: VoiceConnection;
	nonce = 0;
	socket?: Socket;
	ready = false;
	audioPacketizer: AudioPacketizer;
	videoPacketizer: VideoPacketizer;
	keepAliveBuffer = Buffer.alloc(8);
	keepAliveCounter = 0;
	keepAliveInterval?: NodeJS.Timer;
	constructor(voiceConnection: VoiceConnection) {
		Object.defineProperty(this, 'voiceConnection', {
			value: voiceConnection,
		});
		this.audioPacketizer = new AudioPacketizer(this);
		this.videoPacketizer = new VideoPacketizer(
			this,
			this.voiceConnection.manager.videoCodec,
		);
	}

	connect() {
		return new Promise((resolve, reject) => {
			this.socket = createSocket('udp4');

			this.socket.on('error', (error: any) => {
				this.voiceConnection.manager.emit('debug', 'VoideUDP', error);
			});

			this.socket.once('message', (message: any) => {
				if (message.readUInt16BE(0) !== 2) {
					reject('Wrong handshake packet for UDP');
				}
				try {
					const packet = parseLocalPacket(message);
					this.voiceConnection.selfIp = packet.ip;
					this.voiceConnection.selfPort = packet.port;
					this.voiceConnection.selectProtocols();
					// Ok
					this.keepAliveInterval = setInterval(
						() => this.keepAlive(),
						KEEP_ALIVE_INTERVAL,
					).unref();
					setImmediate(() => this.keepAlive()).unref();
				} catch (e) {
					reject(e);
				}
				this.socket?.on('message', this.handleIncoming);
			});
			this.sendBlankPacket();
			resolve(true);
		});
	}

	handleIncoming(buf: any) {
		// console.log('RECEIVED PACKET', buf);
	}

	sendBlankPacket() {
		const blank = Buffer.alloc(74);
		blank.writeUInt16BE(1, 0);
		blank.writeUInt16BE(70, 2);
		blank.writeUInt32BE(this.voiceConnection.ssrc as number, 4);
		this.sendPacket(blank, 'unknown');
	}

	sendPacket(packet: any, type: 'video' | 'audio' | 'unknown') {
		if (type === 'audio') {
			this.voiceConnection.setSpeaking(true);
		} else if (type === 'video') {
			this.voiceConnection.setVideoStatus(true);
		}
		if (!this.socket) {
			return this.voiceConnection.manager.emit(
				'debug',
				'VoiceUDP',
				'Failed to send a packet - no UDP socket',
			);
		}
		this.socket?.send(
			packet,
			0,
			packet.length,
			this.voiceConnection.port,
			this.voiceConnection.address,
			(error: any, bytes: any) => {
				if (error) {
					if (type === 'audio') {
						this.voiceConnection.setSpeaking(true);
					} else if (type === 'video') {
						this.voiceConnection.setVideoStatus(true);
					}
					this.voiceConnection.manager.emit(
						'debug',
						'VoiceUDP',
						`Failed to send a packet - ${error}`,
					);
				} else {
					this.voiceConnection.manager.emit(
						'debug',
						'VoiceUDP',
						`Sent a packet - ${bytes} bytes`,
					);
				}
			},
		);
	}

	sendAudioFrame(frame: any) {
		this.audioPacketizer.sendFrame(frame);
	}

	/**
	 * Sends packets after partitioning the video frame into
	 * MTU-sized chunks
	 * @param frame
	 */
	sendVideoFrame(frame: any) {
		this.videoPacketizer.sendFrame(frame);
	}

	stop() {
		this.ready = false;
		try {
			this.socket?.disconnect();
			clearInterval(this.keepAliveInterval as NodeJS.Timer);
			this.keepAliveBuffer = Buffer.alloc(8);
			this.keepAliveCounter = 0;
		} catch (e) {
			// ERR_SOCKET_DGRAM_NOT_CONNECTED
		}
		return this;
	}

	getNewNonceBuffer() {
		const nonceBuffer = Buffer.alloc(24);
		this.nonce++;
		if (this.nonce > max_int32bit) this.nonce = 0;
		nonceBuffer.writeUInt32BE(this.nonce, 0);
		return nonceBuffer;
	}

	keepAlive() {
		this.keepAliveBuffer.writeUInt32LE(this.keepAliveCounter, 0);
		this.sendPacket(this.keepAliveBuffer, 'unknown');
		this.keepAliveCounter++;
		if (this.keepAliveCounter > MAX_COUNTER_VALUE) {
			this.keepAliveCounter = 0;
		}
	}
}

export default VoiceUDP;
