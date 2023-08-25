import { Writable } from 'stream';
import VoiceUDP from '../Class/VoiceUDP';
import { VideoPacketizer } from '../Packet/VideoPacketizer';
import { AudioPacketizer } from '../Packet/AudioPacketizer';
import { VideoCodec } from '../Util/Constants';

type StreamDispatcherType = 'audio' | 'video';

export class StreamDispatcher<type extends StreamDispatcherType> extends Writable {
	public voiceUDP?: VoiceUDP;
	public count = 0;
	public sleepTime!: number;
	public startTime = 0;
	public fps!: type extends 'video' ? number : never;
	public type!: StreamDispatcherType;
	public packetizer!: type extends 'video' ? VideoPacketizer : AudioPacketizer;

	constructor(udp: VoiceUDP, type: StreamDispatcherType, fps: number = 0) {
		super();
		Object.defineProperty(this, 'voiceUDP', {
			value: udp,
		});
		this.type = type;
		if (this.type == 'video') {
			(this as StreamDispatcher<'video'>).fps = fps;
			(this as StreamDispatcher<'video'>).packetizer =
				new VideoPacketizer(
					udp,
					this.voiceUDP?.voiceConnection.manager.videoCodec as VideoCodec,
				);
			(this as StreamDispatcher<'video'>).packetizer.setFPS(fps);
		} else {
			(this as StreamDispatcher<'audio'>).packetizer =
				new AudioPacketizer(udp);
		}
		// why not 1000 / this.fps ?
		this.sleepTime = this.type == 'video' ? (1000 / 60) : 20;
	}

	setSleepTime(time: number) {
		if (this.type == 'audio') return;
		if (this.voiceUDP?.voiceConnection.manager.videoCodec !== 'VP8') return;
		this.sleepTime = time;
	}

	_write(frame: any, encoding: any, callback: any) {
		if (!this.voiceUDP) {
			callback();
			return;
		}
		this.count++;
		if (!this.startTime) this.startTime = Date.now();
		this.packetizer.sendFrame(frame);
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
		// this.voiceUDP = undefined;
		super.destroy();
	}
}
