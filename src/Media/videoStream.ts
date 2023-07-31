import { Writable } from 'stream';
import VoiceUDP from '../Class/VoiceUDP';

export class VideoStream extends Writable {
    public udp?: VoiceUDP;
    public count: number;
    public sleepTime: number;
    public startTime: number = -1;

	constructor(udp: VoiceUDP, fps = 60) {
		super();
		this.udp = udp;
		this.count = 0;
		this.sleepTime = 1000 / fps;
		this.startTime = -1;
	}

	setSleepTime(time: number) {
		this.sleepTime = time;
	}

	_write(frame: any, encoding: any, callback: any) {
		if (!this.udp) {
			callback();
			return;
		}
		this.count++;
		if (this.startTime === -1) this.startTime = Date.now();
		this.udp.sendVideoFrame(frame);
		let next =
			(this.count + 1) * this.sleepTime - (Date.now() - this.startTime);
		if (next < 0) {
			this.count = 0;
			this.startTime = Date.now();
			next =
				(this.count + 1) * this.sleepTime -
				(Date.now() - this.startTime);
		}
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
