import { Transform, TransformCallback } from 'stream';

type NalInfo = {
	startCodeLength: number;
	nalLength: number;
};

const epbSuffix = [0x00, 0x01, 0x02, 0x03];

/**
 * Outputs a buffer containing length-delimited nalu units
 * that belong to the same access unit.
 * In a h264 stream, 1 frame is equal to 1 access unit, and an access
 * unit is composed of 1 to n Nal units
 */
export class H264NalSplitter extends Transform {
	private _buffer?: Buffer;
	private _accessUnit: Buffer[] = [];

	/**
	 * Removes emulation prevention bytes from a nalu frame
	 * @description there are chances that 0x000001 or 0x00000001 exists in the bitstream of a NAL unit.
	 * So a emulation prevention bytes, 0x03, is presented when there is 0x000000, 0x000001, 0x000002 and 0x000003
	 * to make them become 0x00000300, 0x00000301, 0x00000302 and 0x00000303 respectively
	 * @param data
	 * @returns frame with emulation prevention bytes removed
	 */
	rbsp(data: Buffer): Buffer {
		const len = data.byteLength;
		let pos = 0;
		let epbs = [];

		while (pos < len - 3) {
            if (
				data[pos] === 0 &&
				data[pos + 1] === 0 &&
				data[pos + 2] === 0x03 &&
				epbSuffix.includes(data[pos + 3])
			) {
				epbs.push(pos + 2);
				pos += 3;
			} else {
				pos++;
			}
		}

		if (epbs.length === 0) return data;

		let rbsp = new Uint8Array(len - epbs.length);

		// Remove the EPBs
		pos = 0;
		for (let i = 0; i < rbsp.length; i++) {
			if (pos === epbs[0]) {
				pos++;
				epbs.shift();
			}
			rbsp[i] = data[pos];
			pos++;
		}

		return Buffer.from(rbsp);
	}

	/**
	 * Finds the next nal unit in a buffer
	 * @param buf buffer containing nal units
	 * @returns found nalu unit information
	 */
	parseNal(buf: Buffer): NalInfo {
		const nalInfo: NalInfo = {
			startCodeLength: 0,
			nalLength: 0,
		};

		if (this.findNalByMagicString(buf, 3)) {
			nalInfo.startCodeLength = 3;
		} else if (this.findNalByMagicString(buf, 4)) {
			nalInfo.startCodeLength = 4;
		}

		// If we find the next start code, then we are done
		const remainingLen = buf.length - nalInfo.startCodeLength;

		for (let i = 0; i < remainingLen; i++) {
			if (
				this.findNalByMagicString(
					buf.subarray(nalInfo.startCodeLength + i),
					3,
				) ||
				this.findNalByMagicString(
					buf.subarray(nalInfo.startCodeLength + i),
					4,
				)
			) {
				nalInfo.nalLength = i + nalInfo.startCodeLength;
				break;
			}
		}

		return nalInfo;
	}

	/**
	 * Returns true if nal magic string with specified length was found.
	 * Nal magic string is either 001 or 0001 depending on length
	 * @param buf
	 * @param magicLength either 3 or 4
	 * @returns true if nalu magic string was found
	 */
	findNalByMagicString(buf: Buffer, magicLength: 3 | 4) {
		let found = false;

		if (magicLength === 3) {
			if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1) found = true;
		} else if (magicLength === 4) {
			if (buf[0] === 0 && buf[1] === 0 && buf[2] === 0 && buf[3] === 1)
				found = true;
		} else {
			throw new Error('invalid magic length for h264 nal unit');
		}

		return found;
	}

	_transform(
		chunk: any,
		encoding: BufferEncoding,
		callback: TransformCallback,
	): void {
		this._appendChunkToBuf(chunk);

		// start chunking
		while (this._buffer && this._buffer.length > 0) {
			const nalInfo = this.parseNal(this._buffer);

			if (nalInfo.nalLength === 0) {
				// we are missing frame data
				break;
			} else {
				const frame = this._buffer.subarray(
					nalInfo.startCodeLength,
					nalInfo.nalLength,
				);

				this._updateBufLen(nalInfo.nalLength);

				const header = frame[0];

				const unitType = header & 0x1f;

				if (unitType === NalUnitTypes.AccessUnitDelimiter) {
					if (this._accessUnit.length > 0) {
						let sizeOfAccessUnit = 0;
						this._accessUnit.forEach(
							(nalu) => (sizeOfAccessUnit += nalu.length),
						);

						// total length is sum of all nalu lengths, plus 4 bytes for each nalu
						const accessUnitBuf = Buffer.alloc(
							sizeOfAccessUnit + 4 * this._accessUnit.length,
						);

						let offset = 0;
						for (let nalu of this._accessUnit) {
							// hacky way of outputting several nal units that belong to the same access unit
							accessUnitBuf.writeUint32BE(nalu.length, offset);
							offset += 4;
							nalu.copy(accessUnitBuf, offset);
							offset += nalu.length;
						}

						this.push(accessUnitBuf);
						this._accessUnit = [];
					}
				} else {
					// remove emulation bytes from frame (only importannt ones like SPS and SEI since its costly operation)
					if (
						unitType === NalUnitTypes.SPS ||
						unitType === NalUnitTypes.SEI
					) {
						const rbspFrame = this.rbsp(frame);
						this._accessUnit.push(rbspFrame);
					} else {
						this._accessUnit.push(frame);
					}
				}
			}
		}

		callback();
	}

	_appendChunkToBuf(chunk: any) {
		if (this._buffer) this._buffer = Buffer.concat([this._buffer, chunk]);
		else this._buffer = chunk;
	}

	_updateBufLen(size: number) {
		if (this._buffer && this._buffer.length > size)
			this._buffer = this._buffer.subarray(size, this._buffer.length);
		else this._buffer = undefined;
	}
}

enum NalUnitTypes {
	Unspecified,
	CodedSliceNonIDR,
	CodedSlicePartitionA,
	CodedSlicePartitionB,
	CodedSlicePartitionC,
	CodedSliceIdr,
	SEI,
	SPS,
	PPS,
	AccessUnitDelimiter,
	EndOfSequence,
	EndOfStream,
	FillerData,
	SEIExtenstion,
	PrefixNalUnit,
	SubsetSPS,
}
