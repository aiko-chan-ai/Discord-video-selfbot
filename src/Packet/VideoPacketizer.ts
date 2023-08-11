import VoiceUDP from '../Class/VoiceUDP';
import { BaseMediaPacketizer, max_int16bit } from './BaseMediaPacketizer';
import { VideoCodec, VideoCodecType } from '../Util/Constants';

// Source: https://github.com/dank074/Discord-video-stream

export class VideoPacketizer extends BaseMediaPacketizer {
	public videoCodec: VideoCodec;
	private _pictureId: number = 0; // VP8
	public fps: number = 60;
	constructor(connection: VoiceUDP, videoCodec: VideoCodec, fps = 60) {
		super(connection, VideoCodecType[videoCodec], true);
		this.videoCodec = videoCodec;
		this.fps = fps;
	}

	public sendFrame(frame: any): void {
		if (this.videoCodec === 'H264') {
			this.sendFrameH264(frame);
		} else if (this.videoCodec === 'VP8') {
			this.sendFrameVP8(frame);
		} else {
			throw new Error('Unsupported video codec');
		}
	}

	private sendFrameH264(frame: Buffer): void {
		let accessUnit = frame;
		const nalus: Buffer[] = [];
		let offset = 0;
		while (offset < accessUnit.length) {
			const naluSize = accessUnit.readUInt32BE(offset);
			offset += 4;
			const nalu = accessUnit.subarray(offset, offset + naluSize);
			nalus.push(nalu);
			offset += nalu.length;
		}
		let index = 0;
		for (const nalu of nalus) {
			const nal0 = nalu[0];
			const isLastNal = index === nalus.length - 1;
			if (nalu.length <= this.mtu) {
				// Send as Single-Time Aggregation Packet (STAP-A).
				const packetHeader = this.makeRtpHeader(
					this.connection.voiceConnection.videoSsrc,
					isLastNal,
				);
				const packetData = Buffer.concat([
					this.createHeaderExtension(),
					nalu,
				]);
				const nonceBuffer = this.connection.getNewNonceBuffer();
				this.connection.sendPacket(
					Buffer.concat([
						packetHeader,
						this.encryptData(packetData, nonceBuffer),
						nonceBuffer.subarray(0, 4),
					]),
				);
			} else {
				const data = this.partitionDataMTUSizedChunks(nalu.subarray(1));

				// Send as Fragmentation Unit A (FU-A):
				for (let i = 0; i < data.length; i++) {
					const isFirstPacket = i === 0;
					const isFinalPacket = i === data.length - 1;

					const markerBit = isLastNal && isFinalPacket;

					const packetHeader = this.makeRtpHeader(
						this.connection.voiceConnection.videoSsrc,
						markerBit,
					);

					const packetData = this.makeChunk(
						data[i],
						isFirstPacket,
						isFinalPacket,
						nal0,
					);

					// nonce buffer used for encryption. 4 bytes are appended to end of packet
					const nonceBuffer = this.connection.getNewNonceBuffer();
					this.connection.sendPacket(
						Buffer.concat([
							packetHeader,
							this.encryptData(packetData, nonceBuffer),
							nonceBuffer.subarray(0, 4),
						]),
					);
				}
			}
			index++;
		}

		this.onFrameSent();
	}

	private sendFrameVP8(frame: Buffer): void {
		const data = this.partitionDataMTUSizedChunks(frame);
		for (let i = 0; i < data.length; i++) {
			const packet = this.createPacketVP8(
				data[i],
				i === data.length - 1,
				i === 0,
			);
			this.connection.sendPacket(packet);
		}
		this.onFrameSent();
	}

	private createPacketVP8(
		chunk: any,
		isLastPacket = true,
		isFirstPacket = true,
	): Buffer {
		if (chunk.length > this.mtu)
			throw new Error(
				'error packetizing video frame: frame is larger than mtu',
			);
		const packetHeader = this.makeRtpHeader(
			this.connection.voiceConnection.videoSsrc,
			isLastPacket,
		);

		const packetData = this.makeChunk(chunk, isFirstPacket);

		// nonce buffer used for encryption. 4 bytes are appended to end of packet
		const nonceBuffer = this.connection.getNewNonceBuffer();
		return Buffer.concat([
			packetHeader,
			this.encryptData(packetData, nonceBuffer),
			nonceBuffer.subarray(0, 4),
		]);
	}

	/**
     * The FU indicator octet has the following format:
        
            +---------------+
            |0|1|2|3|4|5|6|7|
            +-+-+-+-+-+-+-+-+
            |F|NRI|  Type   |
            +---------------+
            
            F and NRI bits come from the NAL being transmitted.
            Type = 28 for FU-A (NOTE: this is the type of the H264 RTP header 
            and NOT the NAL type).
            
            The FU header has the following format:
            
            +---------------+
            |0|1|2|3|4|5|6|7|
            +-+-+-+-+-+-+-+-+
            |S|E|R|  Type   |
            +---------------+
            
            S: Set to 1 for the start of the NAL FU (i.e. first packet in frame).
            E: Set to 1 for the end of the NAL FU (i.e. the last packet in the frame).
            R: Reserved bit must be 0.
            Type: The NAL unit payload type, comes from NAL packet (NOTE: this IS the type of the NAL message).
 * @param frameData 
 * @param isFirstPacket 
 * @param isLastPacket 
 * @returns payload for FU-A packet
 */
	private makeChunkH264(
		frameData: any,
		isFirstPacket: boolean,
		isLastPacket: boolean,
		nal0: number,
	): Buffer {
		const headerExtensionBuf = this.createHeaderExtension();

		const fuPayloadHeader = Buffer.alloc(2);
		const nalType = nal0 & 0x1f;
		const fnri = nal0 & 0xe0;

		// set fu indicator
		fuPayloadHeader[0] = 0x1c | fnri; // type 28 with fnri from original frame

		// set fu header
		if (isFirstPacket) {
			fuPayloadHeader[1] = 0x80 | nalType; // set start bit
		} else if (isLastPacket) {
			fuPayloadHeader[1] = 0x40 | nalType; // set last bit
		} else {
			fuPayloadHeader[1] = nalType; // no start or end bit
		}

		return Buffer.concat([headerExtensionBuf, fuPayloadHeader, frameData]);
	}

	private makeChunkVP8(frameData: any, isFirstPacket: boolean): Buffer {
		const headerExtensionBuf = this.createHeaderExtension();

		// vp8 payload descriptor
		const payloadDescriptorBuf = Buffer.alloc(2);

		payloadDescriptorBuf[0] = 0x80;
		payloadDescriptorBuf[1] = 0x80;
		if (isFirstPacket) {
			payloadDescriptorBuf[0] |= 0b00010000; // mark S bit, indicates start of frame
		}

		// vp8 pictureid payload extension
		const pictureIdBuf = Buffer.alloc(2);

		pictureIdBuf.writeUIntBE(this._pictureId, 0, 2);
		pictureIdBuf[0] |= 0b10000000;

		return Buffer.concat([
			headerExtensionBuf,
			payloadDescriptorBuf,
			pictureIdBuf,
			frameData,
		]);
	}

	private makeChunk(
		frameData: any,
		isFirstPacket: boolean,
		isLastPacket?: boolean,
		nal0?: number,
	): Buffer {
		if (this.videoCodec === 'H264') {
			return this.makeChunkH264(
				frameData,
				isFirstPacket,
				isLastPacket as boolean,
				nal0 as number,
			);
		} else if (this.videoCodec === 'VP8') {
			return this.makeChunkVP8(frameData, isFirstPacket);
		} else {
			throw new Error('unsupported video codec');
		}
	}

	public override onFrameSent(): void {
		this.incrementTimestamp(90000 / this.fps);
		if (this.videoCodec == 'VP8') {
			this.incrementPictureId();
		}
	}

	private incrementPictureId(): void {
		if (this.videoCodec != 'VP8') return;
		this._pictureId++;
		if (this._pictureId > max_int16bit) this._pictureId = 0;
	}
}
