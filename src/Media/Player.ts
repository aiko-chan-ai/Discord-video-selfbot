import ffmpeg from 'fluent-ffmpeg';
import * as util from 'fluent-ffmpeg-util';
import { getFrameDelayInMilliseconds, IvfTransformer } from './ivfreader';
import prism from 'prism-media';
import { VideoStream } from './videoStream';
import { AudioStream } from './audioStream';
import { StreamOutput } from '@dank074/fluent-ffmpeg-multistream-ts';
import { formatDuration, getResolutionData } from '../Util/Util';
import EventEmitter from 'events';
import VoiceUDP from '../Class/VoiceUDP';

interface PlayOptions {
	kbpsVideo?: number;
	kbpsAudio?: number;
	fps?: number;
	hwaccel?: boolean;
	volume?: number;
}

interface Player {
	on(event: 'finish', listener: () => void): this;
	on(event: 'finishVideo', listener: () => void): this;
	on(event: 'finishAudio', listener: () => void): this;
	on(event: 'error', listener: (error: Error) => void): this;
}

class Player extends EventEmitter {
	url: any;
	voiceUdp?: VoiceUDP;
	command: ffmpeg.FfmpegCommand | null;
	videoStream: any;
	audioStream: any;
	ivfStream: any;
	opusStream: any;
	fps?: number;
	#isPaused: boolean = false;
	metadata?: ffmpeg.FfprobeData;
	#startTime: number = 0;
	#cachedDuration: number = 0;
	playOptions?: PlayOptions;
	constructor(url: any, voiceUdp: VoiceUDP) {
		super();
		this.url = url;
		this.voiceUdp = voiceUdp;
		this.command = null;
		this.videoStream = null;
		this.audioStream = null;
		this.ivfStream = null;
		this.opusStream = null;
	}
	validateInputMetadata(input: any): Promise<{
		audio: boolean;
		video: boolean;
	}> {
		return new Promise((resolve, reject) => {
			if (this.metadata) {
				if (!this.metadata?.streams)
					return reject(new Error('No metadata'));
				return resolve({
					audio: this.metadata.streams.some(
						(s) => s.codec_type === 'audio',
					),
					video: this.metadata.streams.some(
						(s) => s.codec_type === 'video',
					),
				});
			}
			const instance = ffmpeg(input).on('error', (err, stdout, stderr) =>
				reject(err),
			);
			instance.ffprobe((err, metadata) => {
				if (err) reject(err);
				instance.removeAllListeners();
				this.metadata = metadata;
				if (!this.metadata?.streams)
					return reject(new Error('No metadata'));
				resolve({
					audio: metadata.streams.some(
						(s) => s.codec_type === 'audio',
					),
					video: metadata.streams.some(
						(s) => s.codec_type === 'video',
					),
				});
				instance.kill('SIGINT');
			});
		});
	}
	async play(options: PlayOptions = {}) {
		if (typeof options !== 'object' || Array.isArray(options)) {
			options = {};
		}
		this.playOptions = options;
		const url = this.url;
		const checkData = await this.validateInputMetadata(url);
		this.videoStream = new VideoStream(this.voiceUdp as VoiceUDP, this.fps);
		this.ivfStream = new IvfTransformer();
		// get header frame time
		this.ivfStream.on('header', (header: any) => {
			this.videoStream.setSleepTime(getFrameDelayInMilliseconds(header));
		});

		this.videoStream.on('finish', () => {
			this.emit('finishVideo');
		});

		const headers = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3',
			Connection: 'keep-alive',
		};

		let isHttpUrl = false;
		let isHls = false;

		if (typeof url === 'string') {
			isHttpUrl = url.startsWith('http') || url.startsWith('https');
			isHls = url.includes('m3u');
		}

		try {
			this.command = ffmpeg(url)
				.inputOption('-re')
				.addOption('-loglevel', '0')
				.addOption('-preset', 'ultrafast')
				.addOption('-fflags', 'nobuffer')
				.addOption('-analyzeduration', '0')
				.addOption('-flags', 'low_delay')
				.on('end', () => {
					this.emit('finish');
				})
				.on('error', (err, stdout, stderr) => {
					this.command = null;
					if (
						err.message.includes(
							'ffmpeg was killed with signal SIGINT',
						) ||
						err.message.includes('ffmpeg exited with code 255')
					) {
						return;
					}
					this.emit('error', err);
				})
				.output(StreamOutput(this.ivfStream).url, {
					end: false,
				})
				.noAudio();
			const videoResolutionData = getResolutionData(
				this.voiceUdp?.voiceConnection?.manager?.resolution ?? 'auto',
			);
			const videoStream = this.metadata?.streams.find(
				(s) => s.codec_type === 'video',
			);
			if (
				videoResolutionData.type === 'fixed' &&
				videoStream &&
				videoStream.height &&
				videoStream.height > videoResolutionData.height
			) {
				this.command.size(`?x${videoResolutionData.height}`);
			}
			if (options?.hwaccel === true) {
				this.command.inputOption('-hwaccel', 'auto');
			}
			if (
				options?.kbpsVideo &&
				typeof options?.kbpsVideo === 'number' &&
				options?.kbpsVideo > 0
			) {
				this.command.videoBitrate(`${options?.kbpsVideo}k`);
			} else {
				const bitrate =
					(videoResolutionData.fps *
						videoResolutionData.width *
						videoResolutionData.height *
						0.1 || videoResolutionData.bitrate) / 1_000_000;
				this.command.videoBitrate(
					`${Number(bitrate.toFixed(1)) * 1000}k`,
				);
			}
			if (
				options?.fps &&
				typeof options?.fps === 'number' &&
				options?.fps > 0
			) {
				this.command.fpsOutput(options?.fps);
			}
			this.command.format('ivf').outputOption('-deadline', 'realtime');
			if (checkData.audio) {
				this.audioStream = new AudioStream(this.voiceUdp as VoiceUDP);
				// make opus stream
				this.opusStream = new prism.opus.Encoder({
					channels: 2,
					rate: 48000,
					frameSize: 960,
				});
				this.audioStream.on('finish', () => {
					this.emit('finishAudio');
				});
				this.command
					.output(StreamOutput(this.opusStream).url, {
						end: false,
					})
					.noVideo()
					.audioChannels(2)
					.audioFrequency(48000)
					.format('s16le');
				if (
					options?.kbpsAudio &&
					typeof options?.kbpsAudio === 'number' &&
					options?.kbpsAudio > 0
				) {
					this.command.audioBitrate(`${options?.kbpsAudio}k`);
				} else {
					this.command.audioBitrate('128k');
				}
				if (
					options.volume &&
					typeof options.volume === 'number' &&
					options.volume >= 0
				) {
					this.command.audioFilters(
						`volume=${(options.volume / 100).toFixed(1)}`,
					);
				}
			}
			if (isHttpUrl) {
				this.command.inputOption(
					'-headers',
					Object.keys(headers)
						// @ts-ignore
						.map((key) => key + ': ' + headers[key])
						.join('\r\n'),
				);
				if (!isHls)
					this.command.inputOptions(
						'-reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 4294'.split(
							' ',
						),
					);
			}
			this.command.run();
			this.#startTime = Date.now();
			this.#isPaused = false;
			this.ivfStream.pipe(this.videoStream, { end: false });
			this.opusStream?.pipe(this.audioStream, { end: false });
		} catch (e) {
			this.command = null;
			this.emit('error', e);
		}
	}
	stop() {
		if (this.command) {
			this.ivfStream.destroy();
			this.opusStream?.destroy();
			this.audioStream?.destroy();
			this.videoStream.destroy();
			this.command.kill('SIGINT');
			this.command = null;
			this.#isPaused = true;
			this.#startTime = 0;
			this.#cachedDuration = 0;
		}
	}
	pause() {
		if (!this.command) throw new Error('Not playing');
		util.pause(this.command);
		this.voiceUdp?.voiceConnection.manager.pauseScreenShare(true);
		this.#isPaused = true;
		this.#cachedDuration = Date.now() - this.#startTime;
		return this;
	}
	resume() {
		if (!this.command) throw new Error('Not playing');
		util.resume(this.command);
		this.voiceUdp?.voiceConnection.manager.pauseScreenShare(false);
		this.#isPaused = false;
		this.#startTime = Date.now() - this.#cachedDuration;
		return this;
	}
	get isPlaying() {
		return this.command !== null;
	}
	get isPaused() {
		return this.#isPaused;
	}
	get duration() {
		return this.metadata?.format.duration || 0;
	}
	get formattedDuration() {
		return formatDuration(this.duration);
	}
	get currentTime() {
		if (this.#startTime == 0) return 0;
		if (this.#isPaused == true) {
			return this.#cachedDuration / 1000;
		} else {
			return (Date.now() - this.#startTime) / 1000;
		}
	}
	get formattedCurrentTime() {
		return formatDuration(this.currentTime);
	}
}

export default Player;
