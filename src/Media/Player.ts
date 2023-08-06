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
import { Readable } from 'stream';
import { DiscordStreamClientError, ErrorCodes, ErrorCode } from '../Util/Error';

interface PlayOptions {
	kbpsVideo?: number;
	kbpsAudio?: number;
	fps?: number;
	hwaccel?: boolean;
	volume?: number;
	// @ts-ignore
	private seekTime?: number;
}

interface PlayerEvents {
	spawnProcess: (commandLine: string) => void;
	codecData: (data: {
		format: any;
		duration: any;
		audio: any;
		video: any;
		audio_details: any;
		video_details: any;
	}) => void;
	progress: (progress: {
		frames: any;
		currentFps: any;
		currentKbps: any;
		targetSize: any;
		timemark: any;
		percent: any;
	}) => void;
	vp8Header: (header: {
		signature: string;
		version: number;
		headerLength: number;
		codec: string;
		width: number;
		height: number;
		timeDenominator: number;
		timeNumerator: number;
		frameCount: number;
	}) => void;
	finish: () => void;
	finishVideo: () => void;
	finishAudio: () => void;
	error: (error: Error, stdout: any, stderr: any) => void;
}

interface Player {
	on<U extends keyof PlayerEvents>(event: U, listener: PlayerEvents[U]): this;
	once<U extends keyof PlayerEvents>(
		event: U,
		listener: PlayerEvents[U],
	): this;
}

class Player extends EventEmitter {
	playable!: string | Readable;
	voiceUdp!: VoiceUDP;
	command?: ffmpeg.FfmpegCommand;
	videoStream!: VideoStream;
	audioStream?: AudioStream;
	ivfStream!: IvfTransformer;
	opusStream?: prism.opus.Encoder;
	fps: number = 60;
	#isPaused: boolean = false;
	metadata?: ffmpeg.FfprobeData;
	#startTime: number = 0;
	#cachedDuration: number = 0;
	playOptions?: PlayOptions;
	constructor(playable: string | Readable, voiceUdp: VoiceUDP) {
		super();
		if (typeof playable !== 'string' && !playable.readable) {
			throw new DiscordStreamClientError('PLAYER_MISSING_PLAYABLE');
		}
		if (!(voiceUdp instanceof VoiceUDP)) {
			throw new DiscordStreamClientError('PLAYER_MISSING_VOICE_UDP');
		}
		this.playable = playable;
		this.voiceUdp = voiceUdp;
	}
	validateInputMetadata(input: any): Promise<{
		audio: boolean;
		video: boolean;
	}> {
		return new Promise((resolve, reject) => {
			if (this.metadata) {
				if (!this.metadata?.streams)
					return reject(
						new DiscordStreamClientError('STREAM_INVALID'),
					);
				return resolve({
					audio: this.metadata.streams.some(
						(s) => s.codec_type === 'audio',
					),
					video: this.metadata.streams.some(
						(s) => s.codec_type === 'video',
					),
				});
			} else {
				const instance = ffmpeg(input).on(
					'error',
					(err, stdout, stderr) => reject(err),
				);
				instance.ffprobe((err, metadata) => {
					if (err) reject(err);
					instance.removeAllListeners();
					this.metadata = metadata || {};
					resolve(this.validateInputMetadata(input));
					instance.kill('SIGINT');
				});
			}
		});
	}
	play(options: PlayOptions = {}): Promise<boolean> {
		return new Promise(async (resolve, reject) => {
			if (typeof options !== 'object' || Array.isArray(options)) {
				options = {};
			}
			this.playOptions = options;
			const checkData = await this.validateInputMetadata(this.playable);
			this.videoStream = new VideoStream(
				this.voiceUdp as VoiceUDP,
				this.fps,
			);
			this.ivfStream = new IvfTransformer();
			// get header frame time
			this.ivfStream.on('header', (header: any) => {
				(this.videoStream as VideoStream).setSleepTime(
					getFrameDelayInMilliseconds(header),
				);
				if (!options?.seekTime) this.emit('vp8Header', header);
				this.#startTime = Date.now() - (options?.seekTime || 0) * 1000;
				this.#cachedDuration = 0;
				this.#isPaused = false;
			});

			this.videoStream.on('finish', () => {
				this.emit('finishVideo');
			});

			const headers: { [key: string]: string } = {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3',
				Connection: 'keep-alive',
			};

			let isHttpUrl = false;
			let isHls = false;

			if (typeof this.playable === 'string') {
				isHttpUrl =
					this.playable.startsWith('http') ||
					this.playable.startsWith('https');
				isHls = this.playable.includes('m3u');
			}

			try {
				this.command = ffmpeg(this.playable)
					.inputOption('-re')
					.addOption('-loglevel', '0')
					.addOption('-preset', 'ultrafast')
					.addOption('-fflags', 'nobuffer')
					.addOption('-analyzeduration', '0')
					.addOption('-flags', 'low_delay')
					.on('end', () => {
						this.emit('finish');
						resolve(true);
					})
					.on('error', (err, stdout, stderr) => {
						this.command = undefined;
						if (
							err.message.includes(
								'ffmpeg was killed with signal SIGINT',
							) ||
							err.message.includes('ffmpeg exited with code 255')
						) {
							return;
						}
						this.emit('error', err, stdout, stderr);
						reject(err);
					})
					.on('start', (commandLine) => {
						this.emit('spawnProcess', commandLine);
					})
					.on('codecData', (data) => {
						this.emit('codecData', data);
					})
					.on('progress', (progress) => {
						this.emit('progress', progress);
					})
					.output(StreamOutput(this.ivfStream).url, {
						end: false,
					})
					.noAudio();
				const videoResolutionData = getResolutionData(
					this.voiceUdp?.voiceConnection?.manager?.resolution ??
						'auto',
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
				this.command
					.format('ivf')
					.outputOption('-deadline', 'realtime');
				if (checkData.audio) {
					this.audioStream = new AudioStream(
						this.voiceUdp as VoiceUDP,
					);
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
				if (
					options?.seekTime &&
					typeof options?.seekTime === 'number' &&
					options?.seekTime > 0
				) {
					this.command.seekInput(options.seekTime.toString());
				}
				this.command.run();
				this.ivfStream.pipe(this.videoStream, { end: false });
				this.opusStream?.pipe(this.audioStream as AudioStream, {
					end: false,
				});
			} catch (e) {
				this.command = undefined;
				reject(e);
			}
		});
	}
	stop() {
		return this.#stop(true);
	}
	#stop(isCleanData: boolean = true) {
		if (this.command) {
			this.ivfStream.destroy();
			this.opusStream?.destroy();
			this.audioStream?.destroy();
			this.videoStream.destroy();
			this.command.kill('SIGINT');
			this.command = undefined;
			this.#isPaused = true;
			if (isCleanData) {
				this.#startTime = 0;
				this.#cachedDuration = 0;
				this.metadata = undefined;
			}
		}
		return new Promise((resolve) => {
			setTimeout(() => {
				resolve(true);
			}, 500);
			// Make sure ffmpeg is killed
		});
	}
	pause() {
		if (!this.command)
			throw new DiscordStreamClientError('PLAYER_NOT_PLAYING');
		util.pause(this.command);
		this.voiceUdp?.voiceConnection.manager.pauseScreenShare(true);
		this.#isPaused = true;
		this.#cachedDuration = Date.now() - this.#startTime;
		return this;
	}
	resume() {
		if (!this.command)
			throw new DiscordStreamClientError('PLAYER_NOT_PLAYING');
		util.resume(this.command);
		this.voiceUdp?.voiceConnection.manager.pauseScreenShare(false);
		this.#isPaused = false;
		this.#startTime = Date.now() - this.#cachedDuration;
		return this;
	}
	seek(time: number) {
		if (typeof time !== 'number' || isNaN(time))
			throw new DiscordStreamClientError('INVALID_SEEK_TIME');
		this.#stop(false).then(() =>
			this.play({
				...this.playOptions,
				seekTime: time,
			}),
		);
		return this;
	}
	setVolume(volume: number) {
		if (typeof volume !== 'number' || isNaN(volume) || volume < 0)
			throw new DiscordStreamClientError('INVALID_VOLUME');
		(this.playOptions as PlayOptions).volume = volume;
		this.seek(this.currentTime);
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
