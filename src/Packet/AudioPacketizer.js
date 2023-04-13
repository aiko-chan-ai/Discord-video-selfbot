import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";

const time_inc = (48000 / 100) * 2;

export class AudioPacketizer extends BaseMediaPacketizer {
    constructor(connection) {
        super(connection, 0x78);
    }

    createPacket(chunk) {
        const header = this.makeRtpHeader(this.connection.voiceConnection.ssrc);
        const nonceBuffer = this.connection.getNewNonceBuffer();
        return Buffer.concat([header, this.encryptData(chunk, nonceBuffer), nonceBuffer.subarray(0, 4)]);
    }

    onFrameSent() {
        this.incrementTimestamp(time_inc);
    }
}