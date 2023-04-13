import { Writable } from "stream";

class AudioStream extends Writable {
    /*
    public udp: VoiceUdp;
    public count: number;
    public sleepTime: number;
    public startTime: number;
    */
    
    constructor(udp) {
        super();
        this.udp = udp;
        this.count = 0;
        this.sleepTime = 20;
        this.startTime = null;
    }

    _write(chunk, encoding, callback) {
        if (!this.udp) {
            callback();
            return;
        }

        this.count++;
        if (!this.startTime)
            this.startTime = Date.now();

        this.udp.sendAudioFrame(chunk);
        
        const next = ((this.count + 1) * this.sleepTime) - (Date.now() - this.startTime);
        setTimeout(() => {
            callback();
        }, next);
    }

    destroy() {
        this.udp = null;
        super.destroy();
    }
}

export {
    AudioStream
};
