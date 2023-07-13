import ffmpeg from 'fluent-ffmpeg';
import { getFrameDelayInMilliseconds, IvfTransformer } from './ivfreader.js';
import prism from 'prism-media';
import { VideoStream } from './videoStream.js';
import { AudioStream } from './audioStream.js';
import { StreamOutput } from '@dank074/fluent-ffmpeg-multistream-ts';
import EventEmitter from 'events';

class Player extends EventEmitter {
	constructor(url, voiceUdp) {
		super();
		this.url = url;
		this.voiceUdp = voiceUdp;
		this.command = null;
		this.videoStream = null;
		this.audioStream = null;
		this.ivfStream = null;
		this.opusStream = null;
	}
	validateInputMetadata(input) {
		return new Promise((resolve, reject) => {
			const instance = ffmpeg(input).on('error', (err, stdout, stderr) =>
				reject(err),
			);
			instance.ffprobe((err, metadata) => {
				if (err) reject(err);
				instance.removeAllListeners();
				resolve({
					audio: metadata.streams.find(
						(s) => s.codec_type === 'audio',
					),
					video: metadata.streams.find(
						(s) => s.codec_type === 'video',
					),
				});
				instance.kill('SIGINT');
			});
		});
	}
	async play(bitrateVideo, fpsOutput) {
		const url = this.url;
		const checkData = await this.validateInputMetadata(url);
		this.videoStream = new VideoStream(this.voiceUdp, this.fps);
		this.ivfStream = new IvfTransformer();

		// get header frame time
		this.ivfStream.on('header', (header) => {
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
				.addOption('-fflags', 'nobuffer')
				.addOption('-analyzeduration', '0')
				.inputOption('-hwaccel', 'auto')
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
				.output(StreamOutput(this.ivfStream).url, { end: false })
				.noAudio();
			if (
				bitrateVideo &&
				typeof bitrateVideo === 'number' &&
				bitrateVideo > 0
			) {
				this.command.videoBitrate(`${bitrateVideo}k`);
			}
			if (fpsOutput && typeof fpsOutput === 'number' && fpsOutput > 0) {
				this.command.fpsOutput(fpsOutput);
			}
			this.command
				.format('ivf')
				.outputOption('-deadline', 'realtime');
			if (checkData.audio) {
				this.audioStream = new AudioStream(this.voiceUdp);
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
					.output(StreamOutput(this.opusStream).url, { end: false })
					.noVideo()
					.audioChannels(2)
					.audioFrequency(48000)
					//.audioBitrate('128k')
					.format('s16le');
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
			this.command.run();
			this.ivfStream.pipe(this.videoStream, { end: false });
			this.opusStream?.pipe(this.audioStream, { end: false });
		} catch (e) {
			this.command = undefined;
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
		}
	}
}

export default Player;
