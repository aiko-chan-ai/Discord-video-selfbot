import VoiceConnection from './VoiceConnection';
import { VoiceOpCodes } from '../Util/Opcode';

export default class StreamConnection extends VoiceConnection {
    // video
	setSpeaking(speaking: boolean) {
		this.sendOpcode(VoiceOpCodes.SPEAKING, {
			delay: 0,
			speaking: speaking ? 2 : 0,
			ssrc: this.ssrc,
		});
	}
}
