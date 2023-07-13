import { createSocket } from 'dgram';
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

class VoiceUDP {
	voiceConnection!: VoiceConnection;
	nonce: number;
	socket: any;
	ready: boolean;
	audioPacketizer: AudioPacketizer;
	videoPacketizer: VideoPacketizer;
	constructor(voiceConnection: VoiceConnection) {
		Object.defineProperty(this, 'voiceConnection', {
			value: voiceConnection,
		});
		this.nonce = 0;
		this.socket = null;
		this.ready = false;
		this.audioPacketizer = new AudioPacketizer(this);
		this.videoPacketizer = new VideoPacketizer(this);
	}

	connect() {
		return new Promise((resolve, reject) => {
			this.socket = createSocket('udp4');

			this.socket.on('error', (error: any) => {
				console.error('Error connecting to media udp server', error);
			});

			this.socket.once('message', (message: any) => {
				if (message.readUInt16BE(0) !== 2) {
					reject('wrong handshake packet for udp');
				}
				try {
					const packet = parseLocalPacket(message);
					this.voiceConnection.selfIp = packet.ip;
					this.voiceConnection.selfPort = packet.port;
					this.voiceConnection.selectProtocols();
				} catch (e) {
					reject(e);
				}
				this.socket.on('message', this.handleIncoming);
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
		this.sendPacket(blank);
	}

	sendPacket(packet: any) {
		return new Promise((resolve, reject) => {
			// console.log('SENDING PACKET', packet);
			try {
				this.socket.send(
					packet,
					0,
					packet.length,
					this.voiceConnection.port,
					this.voiceConnection.address,
					(error: any, bytes: any) => {
						if (error) {
							// console.log('ERROR', error);
							reject(error);
						}
						resolve(true);
					},
				);
			} catch (e) {
				reject(e);
			}
		});
	}

	sendAudioFrame(frame: any) {
		if (!this.ready) return;
		const packet = this.audioPacketizer.createPacket(frame);
		this.sendPacket(packet);
		this.audioPacketizer.onFrameSent();
	}

	/**
	 * Sends packets after partitioning the video frame into
	 * MTU-sized chunks
	 * @param frame
	 */
	sendVideoFrame(frame: any) {
		if (!this.ready) return;
		const data = this.videoPacketizer.partitionVideoData(frame);
		for (let i = 0; i < data.length; i++) {
			const packet = this.videoPacketizer.createPacket(
				data[i],
				i === data.length - 1,
				i === 0,
			);
			this.sendPacket(packet);
		}

		this.videoPacketizer.onFrameSent();
	}

	stop() {
		this.ready = false;
		this.socket.disconnect();
		return this;
	}

	getNewNonceBuffer() {
		const nonceBuffer = Buffer.alloc(24);
		this.nonce++;
		if (this.nonce > max_int32bit) this.nonce = 0;
		nonceBuffer.writeUInt32BE(this.nonce, 0);
		return nonceBuffer;
	}
}

export default VoiceUDP;
