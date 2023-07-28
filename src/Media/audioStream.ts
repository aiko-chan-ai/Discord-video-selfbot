import { Writable } from "stream";
import VoiceUDP from "../Class/VoiceUDP";

class AudioStream extends Writable {
	udp?: VoiceUDP;
	count: number;
	sleepTime: number;
	startTime: number | null;

	constructor(udp: VoiceUDP) {
		super();
		this.udp = udp;
		this.count = 0;
		this.sleepTime = 20;
		this.startTime = null;
	}

	_write(chunk: any, encoding: any, callback: any) {
		if (!this.udp) {
			callback();
			return;
		}

		this.count++;
		if (!this.startTime) this.startTime = Date.now();

		this.udp.sendAudioFrame(chunk);

		const next =
			(this.count + 1) * this.sleepTime - (Date.now() - this.startTime);
		setTimeout(() => {
			callback();
		}, next);
	}

	// @ts-ignore
	destroy() {
		this.udp = undefined;
		super.destroy();
	}
}

export {
    AudioStream
};
