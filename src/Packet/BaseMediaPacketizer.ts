import { crypto_secretbox_easy } from 'libsodium-wrappers';
import VoiceUDP from '../Class/VoiceUDP';

export const max_int16bit = 2 ** 16 - 1;
export const max_int32bit = 2 ** 32 - 1;

export class BaseMediaPacketizer {
	private _payloadType: number;
	private _mtu: number;
	private _sequence: number;
	private _timestamp: number;
	private _connection: VoiceUDP;
	private _extensionEnabled: boolean;

	constructor(
		connection: VoiceUDP,
		payloadType: number,
		extensionEnabled = false,
	) {
		this._connection = connection;
		this._payloadType = payloadType;
		this._sequence = 0;
		this._timestamp = 0;
		this._mtu = 1200;
		this._extensionEnabled = extensionEnabled;
	}

	public sendFrame(frame: any): void {
		// override this
	}

	public onFrameSent(): void {
		// override this
	}

	/**
	 * Partitions a buffer into chunks of length this.mtu
	 * @param data buffer to be partitioned
	 * @returns array of chunks
	 */
	public partitionDataMTUSizedChunks(data: any): any[] {
		let i = 0;
		let len = data.length;

		const out = [];

		while (len > 0) {
			const size = Math.min(len, this._mtu);
			out.push(data.slice(i, i + size));
			len -= size;
			i += size;
		}

		return out;
	}

	public getNewSequence(): number {
		this._sequence++;
		if (this._sequence > max_int16bit) this._sequence = 0;
		return this._sequence;
	}

	public incrementTimestamp(incrementBy: number): void {
		this._timestamp += incrementBy;
		if (this._timestamp > max_int32bit) this._timestamp = 0;
	}

	public makeRtpHeader(ssrc: number, isLastPacket: boolean = true): Buffer {
		const packetHeader = Buffer.alloc(12);

		packetHeader[0] = (2 << 6) | ((this._extensionEnabled ? 1 : 0) << 4); // set version and flags
		packetHeader[1] = this._payloadType; // set packet payload
		if (isLastPacket) packetHeader[1] |= 0b10000000; // mark M bit if last frame

		packetHeader.writeUIntBE(this.getNewSequence(), 2, 2);
		packetHeader.writeUIntBE(this._timestamp, 4, 4);
		packetHeader.writeUIntBE(ssrc, 8, 4);
		return packetHeader;
	}

	/**
	 * Creates a single extension of type playout-delay
	 * Discord seems to send this extension on every video packet
	 * @see https://webrtc.googlesource.com/src/+/refs/heads/main/docs/native-code/rtp-hdrext/playout-delay
	 * @returns playout-delay extension @type Buffer
	 */
	public createHeaderExtension(): Buffer {
		const extensions = [{ id: 5, len: 2, val: 0 }];

		/**
         *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
            +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
            |      defined by profile       |           length              |
            +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
        */
		const profile = Buffer.alloc(4);
		profile[0] = 0xbe;
		profile[1] = 0xde;
		profile.writeInt16BE(extensions.length, 2); // extension count

		const extensionsData = [];
		for (let ext of extensions) {
			/**
			 * EXTENSION DATA - each extension payload is 32 bits
			 */
			const data = Buffer.alloc(4);

			/**
             *  0 1 2 3 4 5 6 7
                +-+-+-+-+-+-+-+-+
                |  ID   |  len  |
                +-+-+-+-+-+-+-+-+

            where len = actual length - 1
            */
			data[0] = (ext.id & 0b00001111) << 4;
			data[0] |= (ext.len - 1) & 0b00001111;

			/**  Specific to type playout-delay
             *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4
                +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
                |       MIN delay       |       MAX delay       |
                +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
            */
			data.writeUIntBE(ext.val, 1, 2); // not quite but its 0 anyway

			extensionsData.push(data);
		}

		return Buffer.concat([profile, ...extensionsData]);
	}

	// encrypts all data that is not in rtp header.
	// rtp header extensions and payload headers are also encrypted
	public encryptData(
		message: string | Uint8Array,
		nonceBuffer: Buffer,
	): Uint8Array {
		return crypto_secretbox_easy(
			message,
			nonceBuffer,
			this._connection.voiceConnection.secretkey as Uint8Array,
		);
	}

	public get connection(): VoiceUDP {
		return this._connection;
	}

	public get mtu(): number {
		return this._mtu;
	}
}
