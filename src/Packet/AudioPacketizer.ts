import VoiceUDP from "../Class/VoiceUDP";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer";

const time_inc = (48000 / 100) * 2;
export class AudioPacketizer extends BaseMediaPacketizer {
	constructor(connection: VoiceUDP) {
		super(connection, 0x78);
	}

	public sendFrame(frame: any): void {
		const packet = this.createPacket(frame);
		this.connection.sendPacket(packet, 'audio');
		this.onFrameSent();
	}

	public createPacket(chunk: any): Buffer {
		const header = this.makeRtpHeader(this.connection.voiceConnection.ssrc as number);
		const nonceBuffer = this.connection.getNewNonceBuffer();
		return Buffer.concat([
			header,
			this.encryptData(chunk, nonceBuffer),
			nonceBuffer.subarray(0, 4),
		]);
	}

	public onFrameSent(): void {
		this.incrementTimestamp(time_inc);
	}
}