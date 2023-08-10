export type VideoCodec = 'H264' | 'VP8';

export const VideoCodecProtocols: {
    [key in VideoCodec]: {
        name: VideoCodec;
        type: 'video';
        priority: number;
        payload_type: number;
        rtx_payload_type: number;
        encode: boolean;
        decode: boolean;
    }
} = {
	H264: {
		name: 'H264',
		type: 'video',
		priority: 1000,
		payload_type: 101,
		rtx_payload_type: 102,
		encode: true,
		decode: true,
	},
	VP8: {
		name: 'VP8',
		type: 'video',
		priority: 3000,
		payload_type: 103,
		rtx_payload_type: 104,
		encode: true,
		decode: true,
	},
    /*
	VP9: {
		name: 'VP9',
		type: 'video',
		priority: 3000,
		payload_type: 105,
		rtx_payload_type: 106,
		encode: true,
		decode: true,
	},
    */
};

export enum VideoCodecType {
    H264 = 101,
    VP8 = 103,
}