import ffmpeg from 'fluent-ffmpeg';
import * as util from 'fluent-ffmpeg-util';
import { getFrameDelayInMilliseconds, IvfTransformer } from './Util/ivfreader';
import { H264NalSplitter } from './Util/H264NalSplitter';
import prism from 'prism-media';
import { VideoStream } from './videoStream';
import { AudioStream } from './audioStream';
import { StreamOutput } from '@aikochan2k6/fluent-ffmpeg-multistream-ts';
import { formatDuration, getResolutionData } from '../Util/Util';
import EventEmitter from 'events';
import VoiceUDP from '../Class/VoiceUDP';
import { Readable } from 'stream';
import { DiscordStreamClientError, ErrorCodes, ErrorCode } from '../Util/Error';

interface PlayOptions {
	kbpsVideo?: number;
	kbpsAudio?: number;
	hwaccel?: boolean;
	volume?: number;
	// @ts-ignore
	seekTime?: number;
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
	voiceUdp!: VoiceUDP;
	command?: ffmpeg.FfmpegCommand;
	videoStream!: VideoStream;
	audioStream?: AudioStream;
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
		voiceUdp: VoiceUDP,
		ffmpegPath?: {
			ffmpeg: string;
			ffprobe: string;
		},
	) {
		super();
		if (typeof playable !== 'string' && !playable.readable) {
			throw new DiscordStreamClientError('PLAYER_MISSING_PLAYABLE');
		}
		if (!(voiceUdp instanceof VoiceUDP)) {
			throw new DiscordStreamClientError('PLAYER_MISSING_VOICE_UDP');
		}
		this.playable = playable;
		this.voiceUdp = voiceUdp;
		if (ffmpegPath) {
			this.ffmpegPath = ffmpegPath;
			ffmpeg.setFfmpegPath(ffmpegPath.ffmpeg);
			ffmpeg.setFfprobePath(ffmpegPath.ffprobe);
		}
		this.checkFFmpegAndFFprobeExists();
	}

	checkFFmpegAndFFprobeExists() {
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

	validateInputMetadata(input: any): Promise<{
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
			this.videoStream = new VideoStream(
				this.voiceUdp as VoiceUDP,
				this.fps,
			);
			if (this.voiceUdp.voiceConnection.manager.videoCodec == 'H264') {
				this.videoOutput = new H264NalSplitter();
			} else if (
				this.voiceUdp.voiceConnection.manager.videoCodec == 'VP8'
			) {
				this.videoOutput = new IvfTransformer();
			}

			this.videoOutput.on('header', (header: any) => {
				(this.videoStream as VideoStream).setSleepTime(
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
					.output(StreamOutput(this.videoOutput).url, {
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
				const evalGetFPS = (str: string) => {
					try {
						return eval(str);
					} catch {
						return 0;
					}
				}
				// FPS
				const fpsOutput =
					evalGetFPS(videoStream?.r_frame_rate || '') ||
					evalGetFPS(videoStream?.avg_frame_rate || '');
				if (fpsOutput) {
					this.voiceUdp.videoPacketizer.fps = fpsOutput;
				}
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
					this.voiceUdp.voiceConnection.manager.videoCodec == 'H264'
				) {
					this.command
						.format('h264')
						.outputOption(
							`-tune zerolatency -pix_fmt yuv420p -profile:v baseline -g ${this.voiceUdp.videoPacketizer.fps} -x264-params keyint=${this.voiceUdp.videoPacketizer.fps}:min-keyint=${this.voiceUdp.videoPacketizer.fps} -bsf:v h264_metadata=aud=insert`.split(
								' ',
							),
						);
				} else if (
					this.voiceUdp.voiceConnection.manager.videoCodec == 'VP8'
				) {
					this.command
						.format('ivf')
						.outputOption('-deadline', 'realtime');
				}
				if (checkData.audio) {
					this.audioStream = new AudioStream(
						this.voiceUdp as VoiceUDP,
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
				this.videoOutput.pipe(this.videoStream, { end: false });
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
