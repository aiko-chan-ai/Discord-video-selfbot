import VoiceUDP from "../Class/VoiceUDP";
import { OpusCodecType } from "../Util/Constants";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer";

const CHANNELS = 2;
const TIMESTAMP_INC = (48000 / 100) * CHANNELS;
export class AudioPacketizer extends BaseMediaPacketizer {
	constructor(connection: VoiceUDP) {
		super(connection, OpusCodecType);
	}

	public sendFrame(frame: any): void {
		const packet = this.createPacket(frame);
		this.voiceUDP.sendPacket(packet, 'audio');
		this.onFrameSent();
	}

	public createPacket(chunk: any): Buffer {
		const header = this.makeRtpHeader(
			this.voiceUDP.voiceConnection.ssrc as number,
		);
		return this.encryptData(chunk, header);
	}

	public onFrameSent(): void {
		this.incrementTimestamp(TIMESTAMP_INC);
	}
}