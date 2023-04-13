import { Writable } from 'stream';

export class VideoStream extends Writable {
	/*
    public udp: VoiceUdp;
    public count: number;
    public sleepTime: number;
    public startTime: number = -1;
    */

	constructor(udp, fps = 60) {
		super();
		this.udp = udp;
		this.count = 0;
		this.sleepTime = 1000 / fps;
		this.startTime = -1;
	}

	setSleepTime(time) {
		this.sleepTime = time;
	}

	_write(frame, encoding, callback) {
		if (!this.udp) {
			callback();
			return;
		}
		this.count++;
		if (this.startTime === -1) this.startTime = Date.now();
		this.udp.sendVideoFrame(frame);
		const next =
			(this.count + 1) * this.sleepTime - (Date.now() - this.startTime);
		setTimeout(() => {
			callback();
		}, next);
	}

	destroy() {
		this.udp = null;
		super.destroy();
	}
}
