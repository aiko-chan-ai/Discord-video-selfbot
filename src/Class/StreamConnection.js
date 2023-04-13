import VoiceConnection from './VoiceConnection.js';
import { VoiceOpCodes } from '../Util/Opcode.js';

export default class StreamConnection extends VoiceConnection {
    // video
	setSpeaking(speaking) {
		this.sendOpcode(VoiceOpCodes.SPEAKING, {
			delay: 0,
			speaking: speaking ? 2 : 0,
			ssrc: this.ssrc,
		});
	}
}
