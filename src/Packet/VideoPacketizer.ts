import { BaseMediaPacketizer, max_int16bit } from "./BaseMediaPacketizer";

/**
 * VP8 payload format
 */
export class VideoPacketizer extends BaseMediaPacketizer {
    _pictureId: number;

    constructor(connection: any) {
        super(connection, 0x67, true);
        this._pictureId = 0;
    }

    incrementPictureId() {
        this._pictureId++;
        if(this._pictureId > max_int16bit) this._pictureId = 0;
    }

    createPacket(chunk: any, isLastPacket = true, isFirstPacket = true) {
		if (chunk.length > this.mtu)
			throw Error(
				'error packetizing video frame: frame is larger than mtu',
			);
		// @ts-ignore
		const packetHeader = this.makeRtpHeader(
			// @ts-ignore
			this.connection.voiceConnection.videoSsrc,
			isLastPacket,
		);

		const packetData = this.makeFrame(chunk, isFirstPacket);

		// nonce buffer used for encryption. 4 bytes are appended to end of packet
		// @ts-ignore
		const nonceBuffer = this.connection.getNewNonceBuffer();
		return Buffer.concat([
			packetHeader,
			this.encryptData(packetData, nonceBuffer),
			nonceBuffer.subarray(0, 4),
		]);
	}

    onFrameSent() {
        // video RTP packet timestamp incremental value = 90,000Hz / fps
        this.incrementTimestamp(90_000 / 400);
        this.incrementPictureId();
    }

    makeFrame(frameData: any, isFirstPacket: any) {
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
    
        return Buffer.concat([headerExtensionBuf, payloadDescriptorBuf, pictureIdBuf, frameData]);
    }
}