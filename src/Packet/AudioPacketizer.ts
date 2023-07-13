import { BaseMediaPacketizer } from "./BaseMediaPacketizer";

const time_inc = (48000 / 100) * 2;

export class AudioPacketizer extends BaseMediaPacketizer {
    constructor(connection: any) {
        super(connection, 0x78);
    }

    createPacket(chunk: any) {
        // @ts-ignore
        const header = this.makeRtpHeader(this.connection.voiceConnection.ssrc);
        // @ts-ignore
        const nonceBuffer = this.connection.getNewNonceBuffer();
        return Buffer.concat([header, this.encryptData(chunk, nonceBuffer), nonceBuffer.subarray(0, 4)]);
    }

    onFrameSent() {
        this.incrementTimestamp(time_inc);
    }
}