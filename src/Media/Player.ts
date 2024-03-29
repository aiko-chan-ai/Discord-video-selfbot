import ffmpeg from 'fluent-ffmpeg';
import * as util from 'fluent-ffmpeg-util';
import { Readable } from 'stream';
import EventEmitter from 'events';
import prism from 'prism-media';
import { StreamOutput } from '@aikochan2k6/fluent-ffmpeg-multistream-ts';
import { getFrameDelayInMilliseconds, IvfTransformer } from './Codec/VP8';
import { H264NalSplitter } from './Codec/H264';
import { formatDuration, getResolutionData } from '../Util/Util';
import { StreamDispatcher } from './StreamDispatcher';
import VoiceUDP from '../Class/VoiceUDP';
import { DiscordStreamClientError, ErrorCodes, ErrorCode } from '../Util/Error';

interface PlayOptions {
	kbpsVideo?: number;
	kbpsAudio?: number;
	hwaccel?: boolean;
	volume?: number;
	// @ts-ignore
	seekTime?: number;
	fps?: number;
	ffmpegConfig?: Partial<FFmpegConfigOutput>;
}

type PresetType =
	| 'ultrafast'
	| 'superfast'
	| 'veryfast'
	| 'faster'
	| 'fast'
	| 'medium'
	| 'slow'
	| 'slower'
	| 'veryslow';

type Quality = 'best' | 'good' | 'realtime';

interface FFmpegConfigOutput {
	preset: PresetType;
	quality: Quality;
	fflags: string;
}

interface PlayerEvents {
	spawnProcess: (commandLine: string) => void;
	start: () => void;
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
	voiceUDP!: VoiceUDP;
	command?: ffmpeg.FfmpegCommand;
	videoStream!: StreamDispatcher<'video'>;
	audioStream?: StreamDispatcher<'audio'>;
	videoOutput!: IvfTransformer | H264NalSplitter;
	opusStream?: prism.opus.Encoder;
	fps: number = 60;
	#isPaused: boolean = false;
	#isStarted: boolean = false;
	metadata?: ffmpeg.FfprobeData;
	#startTime: number = 0;
	#cachedDuration: number = 0;
	playOptions?: PlayOptions;
	ffmpegPath?: {
		ffmpeg: string;
		ffprobe: string;
	};
	volumeManager?: prism.VolumeTransformer;
	constructor(
		playable: string | Readable,
		voiceUDP: VoiceUDP,
		ffmpegPath?: {
			ffmpeg: string;
			ffprobe: string;
		},
	) {
		super();
		if (typeof playable !== 'string' && !playable.readable) {
			throw new DiscordStreamClientError('PLAYER_MISSING_PLAYABLE');
		}
		if (!(voiceUDP instanceof VoiceUDP)) {
			throw new DiscordStreamClientError('PLAYER_MISSING_VOICE_UDP');
		}
		Object.defineProperty(this, 'playable', {
			value: playable,
		});
		Object.defineProperty(this, 'voiceUDP', {
			value: voiceUDP,
		});
		if (ffmpegPath) {
			this.ffmpegPath = ffmpegPath;
			ffmpeg.setFfmpegPath(ffmpegPath.ffmpeg);
			ffmpeg.setFfprobePath(ffmpegPath.ffprobe);
		}
		this.checkFFmpegAndFFprobeExists();
	}

	private checkFFmpegAndFFprobeExists() {
		return new Promise((resolve, reject) => {
			ffmpeg.getAvailableEncoders((err, encoders) => {
				if (err) reject(err);
				ffmpeg.getAvailableFormats((err, formats) => {
					if (err) reject(err);
					resolve(true);
				});
			});
		});
	}

	private validateInputMetadata(input: any): Promise<{
		audio: boolean;
		video: boolean;
	}> {
		return new Promise((resolve, reject) => {
			if (input instanceof Readable) {
				this.metadata = {
					streams: [],
					chapters: [],
					format: {},
				};
				return resolve({
					audio: true,
					video: true,
				});
			}
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
			const videoStream = this.metadata?.streams.find(
				(s) => s.codec_type === 'video',
			);
			const evalGetFPS = (str: string) => {
				try {
					return eval(str);
				} catch {
					return 0;
				}
			};
			// FPS
			const fpsOutput =
				options.fps ||
				evalGetFPS(videoStream?.r_frame_rate || '') ||
				evalGetFPS(videoStream?.avg_frame_rate || '');
			if (fpsOutput) {
				this.fps = fpsOutput;
			}
			this.videoStream = new StreamDispatcher(
				this.voiceUDP as VoiceUDP,
				'video',
				this.fps,
			);
			if (this.voiceUDP.voiceConnection.manager.videoCodec == 'H264') {
				this.videoOutput = new H264NalSplitter();
			} else if (
				this.voiceUDP.voiceConnection.manager.videoCodec == 'VP8'
			) {
				this.videoOutput = new IvfTransformer();
			}

			this.videoOutput.on('header', (header: any) => {
				(this.videoStream as StreamDispatcher<'video'>).setSleepTime(
					getFrameDelayInMilliseconds(header),
				);
			});

			this.videoOutput.on('data', (data: any) => {
				if (this.isStarted) return;
				this.#isStarted = true;
				if (!options?.seekTime) this.emit('start');
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
					//.inputOption('-re')
					.addOption('-loglevel', '0')
					.addOption(
						'-preset',
						options.ffmpegConfig?.preset || 'ultrafast',
					)
					.addOption(
						'-fflags',
						options.ffmpegConfig?.fflags || 'nobuffer',
					)
					.outputOption(
						'-quality',
						options.ffmpegConfig?.quality || 'realtime',
					)
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
					.FPSOutput(fpsOutput)
					.output(StreamOutput(this.videoOutput).url, {
						end: false,
					})
					.noAudio();
				const videoResolutionData = getResolutionData(
					this.voiceUDP?.voiceConnection?.manager?.resolution ??
						'auto',
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
					this.voiceUDP.voiceConnection.manager.videoCodec == 'H264'
				) {
					this.command
						.format('h264')
						.outputOptions([
							'-tune zerolatency',
							'-profile:v high422',
							'-bsf:v h264_metadata=aud=insert',
							`-g ${this.fps}`,
							// `-x264-params keyint=${this.fps}:min-keyint=${this.fps}`,
						]);
						/*
						.outputOptions([
							'-tune zerolatency',
							'-pix_fmt yuv420p',
							'-profile:v baseline',
							`-g ${this.fps}`,
							`-x264-params keyint=${this.fps}:min-keyint=${this.fps}`,
							'-bsf:v h264_metadata=aud=insert',
						]);
						*/
				} else if (
					this.voiceUDP.voiceConnection.manager.videoCodec == 'VP8'
				) {
					this.command
						.format('ivf');
				}
				if (checkData.audio) {
					this.audioStream = new StreamDispatcher(
						this.voiceUDP as VoiceUDP,
						'audio',
					);
					this.opusStream = new prism.opus.Encoder({
						channels: 2,
						rate: 48000,
						frameSize: 960,
					});
					this.volumeManager = new prism.VolumeTransformer({
						type: 's16le',
						volume:
							options.volume &&
							typeof options.volume === 'number' &&
							options.volume >= 0
								? options.volume
								: 1,
					});
					this.volumeManager.pipe(this.opusStream);
					this.audioStream.on('finish', () => {
						this.emit('finishAudio');
					});
					this.command
						.output(StreamOutput(this.volumeManager).url, {
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
				}
				if (isHttpUrl) {
					this.command.inputOption(
						'-headers',
						Object.keys(headers)
							.map((key) => key + ': ' + headers[key])
							.join('\r\n'),
					);
					if (!isHls)
						this.command.inputOptions([
							'-reconnect 1',
							'-reconnect_at_eof 1',
							'-reconnect_streamed 1',
							'-reconnect_delay_max 4294',
						]);
					this.command.inputOption(
						'-protocol_whitelist file,http,https,tcp,tls',
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
				this.videoOutput.pipe(this.videoStream, { end: false });
				this.opusStream?.pipe(
					this.audioStream as StreamDispatcher<'audio'>,
					{
						end: false,
					},
				);
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
			this.videoOutput.destroy();
			this.opusStream?.destroy();
			this.audioStream?.destroy();
			this.volumeManager?.destroy();
			this.videoStream.destroy();
			this.command.kill('SIGINT');
			this.command = undefined;
			this.#isPaused = true;
			this.#isStarted = false;
			if (isCleanData) {
				this.#startTime = 0;
				this.#cachedDuration = 0;
				this.metadata = undefined;
				this.volumeManager = undefined;
			}
		}
		return new Promise((resolve) => {
			setTimeout(() => {
				resolve(true);
			}, 500);
		});
	}

	pause() {
		if (!this.command)
			throw new DiscordStreamClientError('PLAYER_NOT_PLAYING');
		util.pause(this.command);
		this.voiceUDP.voiceConnection.manager.pauseScreenShare(true);
		this.voiceUDP.voiceConnection.setVideoStatus(false);
		this.voiceUDP.voiceConnection.setSpeaking(false);
		this.#isPaused = true;
		this.#cachedDuration = Date.now() - this.#startTime;
		return this;
	}

	resume() {
		if (!this.command)
			throw new DiscordStreamClientError('PLAYER_NOT_PLAYING');
		util.resume(this.command);
		this.voiceUDP.voiceConnection.manager.pauseScreenShare(false);
		this.voiceUDP.voiceConnection.setVideoStatus(true);
		this.voiceUDP.voiceConnection.setSpeaking(true);
		this.#isPaused = false;
		this.#startTime = Date.now() - this.#cachedDuration;
		return this;
	}

	seek(time: number) {
		if (typeof time !== 'number' || isNaN(time))
			throw new DiscordStreamClientError('INVALID_SEEK_TIME');
		if (this.duration < time) {
			throw new DiscordStreamClientError('INVALID_SEEK_TIME');
		}
		this.#stop(false).then(() =>
			this.play({
				...this.playOptions,
				seekTime: time,
			}),
		);
		return this;
	}

	get isPlaying() {
		return this.command !== null;
	}

	get isPaused() {
		return this.#isPaused;
	}

	get isStarted() {
		return this.#isStarted;
	}

	get duration() {
		return this.metadata?.format?.duration || 0;
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
