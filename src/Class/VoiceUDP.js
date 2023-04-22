import { createSocket } from 'dgram';
import { isIPv4 } from 'net';
import { AudioPacketizer } from '../Packet/AudioPacketizer.js';
import { VideoPacketizer } from '../Packet/VideoPacketizer.js';
import { max_int32bit } from '../Packet/BaseMediaPacketizer.js';
import { DiscordStreamClientError } from '../Util/Error.js';

// credit to discord.js
function parseLocalPacket(message) {
	const packet = Buffer.from(message);
	const ip = packet.subarray(8, packet.indexOf(0, 8)).toString('utf8');
	if (!isIPv4(ip)) {
		throw new DiscordStreamClientError('INVALID_IP');
	}
	const port = packet.readUInt16BE(packet.length - 2);
	return { ip, port };
}

class VoiceUDP {
	constructor(voiceConnection) {
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

			this.socket.on('error', (error) => {
				console.error('Error connecting to media udp server', error);
			});

			this.socket.once('message', (message) => {
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
			resolve();
		});
	}

	handleIncoming(buf) {
		// console.log('RECEIVED PACKET', buf);
	}

	sendBlankPacket() {
		const blank = Buffer.alloc(74);
		blank.writeUInt16BE(1, 0);
		blank.writeUInt16BE(70, 2);
		blank.writeUInt32BE(this.voiceConnection.ssrc, 4);
		this.sendPacket(blank);
	}

	sendPacket(packet) {
		return new Promise((resolve, reject) => {
			// console.log('SENDING PACKET', packet);
			try {
				this.socket.send(
					packet,
					0,
					packet.length,
					this.voiceConnection.port,
					this.voiceConnection.address,
					(error, bytes) => {
						if (error) {
							// console.log('ERROR', error);
							reject(error);
						}
						resolve();
					},
				);
			} catch (e) {
				reject(e);
			}
		});
	}

	sendAudioFrame(frame) {
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
	sendVideoFrame(frame) {
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
