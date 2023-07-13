import fs from "fs";
import { Transform } from "stream";

type IvfHeader = {
    signature: string;
    version: number;
    headerLength: number;
    codec: string;
    width: number;
    height: number;
    timeDenominator: number;
    timeNumerator: number;
    frameCount: number;
}

/*
** Transform stream to transform file stream into ivf file
** TODO: optimize concats
*/
class IvfTransformer extends Transform {
    public headerSize: number;
    public frameHeaderSize: number;
    public header?: IvfHeader;
    public buf?: Buffer;
    public retFullFrame: boolean;

    constructor(options?: any) {
        super(options);
        this.headerSize = 32;
        this.frameHeaderSize = 12;
        this.retFullFrame = (options && options.fullframe) ? options.fullframe : false;
    }

    _parseHeader(header: any) {
        // header: Buffer
        const out = {
            signature: header.subarray(0, 4).toString(),
            version: header.readUIntLE(4, 2),
            headerLength: header.readUIntLE(6, 2),
            codec: header.subarray(8, 12).toString(),
            width: header.readUIntLE(12, 2),
            height: header.readUIntLE(14, 2),
            timeDenominator: header.readUIntLE(16, 4),
            timeNumerator: header.readUIntLE(20, 4),
            frameCount: header.readUIntLE(24, 4)
        };

        this.header = out;
        this.emit("header", this.header);
    }

    _getFrameSize(buf: any) {
        return buf.readUIntLE(0, 4);
    }

    _parseFrame(frame: any) {
        // frame: Buffer
        const size = this._getFrameSize(frame);

        if (this.retFullFrame)
            return this.push(frame.subarray(0, 12 + size));

        const out = {
            size: size,
            timestamp: frame.readBigUInt64LE(4),
            data: frame.subarray(12, 12 + size)
        }
        this.push(out.data);
    }

    _appendChunkToBuf(chunk: any) {
        if (this.buf)
            this.buf = Buffer.concat([this.buf, chunk]);
        else
            this.buf = chunk;
    }

    _updateBufLen(size: any) {
		// @ts-ignore
		if (this.buf.length > size)
			// @ts-ignore
			this.buf = this.buf.subarray(size, this.buf.length);
		// @ts-ignore
		else this.buf = null;
	}

    _write(chunk: any, encoding: any, callback: any) {
        this._appendChunkToBuf(chunk);
        // parse header
        if (!this.header) {
			// @ts-ignore
			if (this.buf.length >= this.headerSize) {
				// @ts-ignore
				this._parseHeader(this.buf.subarray(0, this.headerSize));
				this._updateBufLen(this.headerSize);
			} else {
				callback();
				return;
			}
		}
        
        // parse frame(s)
        while (this.buf && this.buf.length >= this.frameHeaderSize) {
            const size = this._getFrameSize(this.buf) + this.frameHeaderSize;
            if (this.buf.length >= size) {
                this._parseFrame(this.buf.subarray(0, size));
                this._updateBufLen(size);
            }
            else
                break
        }
        
        // callback
        callback();
    }
}

async function readIvfFile(filepath: any) {
    const inputStream = fs.createReadStream(filepath);
    
    const stream = new IvfTransformer({ fullframe: true });
    inputStream.pipe(stream);

    let out = {
        frames: []
    };

    await new Promise((resolve, reject) => {
        stream.on("header", (header) => {
            out = {
                ...out,
                ...header
            };
        });

        stream.on("data", (frame) => {
			// @ts-ignore
			out.frames.push(frame);
		});
    
        stream.on("end", () => {
			// @ts-ignore
			out.frames = Buffer.concat(out.frames);
			resolve(true);
		});
    });

    return out;
}

// get frame, starts at one
function getFrameFromIvf(file: any, framenum = 1) {
    if (!(framenum > 0 && framenum <= file.frameCount))
        return false;
    
    let currentFrame = 1;
    let currentBuffer = file.frames;
    while (true) {
        const size = currentBuffer.readUIntLE(0, 4);

        // jump to next frame if isnt the requested frame
        if (currentFrame != framenum) {
            currentBuffer = currentBuffer.slice(12 + size, currentBuffer.length);
            currentFrame++;
            continue
        }

        // return frame data
        const out = {
            size: size,
            timestamp: currentBuffer.readBigUInt64LE(4),
            data: currentBuffer.slice(12, 12 + size)
        }

        return out;
    }
}

function getFrameDelayInMilliseconds(file: any) {
    return ((file.timeNumerator / file.timeDenominator) * 1000);
}

export {
    getFrameFromIvf,
    readIvfFile,
    getFrameDelayInMilliseconds,
    IvfTransformer
}
