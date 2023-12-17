import StreamConnection from './StreamConnection';
import { DiscordStreamClientError } from '../Util/Error';
import BaseConnnection from './BaseConnection';
import DiscordStreamClient from '..';
import { Snowflake } from 'discord.js-selfbot-v13';
import { VideoTestCardBase64 } from '../Util/Constants';

class VoiceConnection extends BaseConnnection {
	#connectionTimeout: number;
	streamConnection?: StreamConnection;
	constructor(
		manager: DiscordStreamClient,
		guildId?: Snowflake,
		channelId?: Snowflake,
		timeout = 30_000,
	) {
		super(manager, guildId, channelId);
		this.#connectionTimeout = timeout;
	}

	createStream(postTestCard = true): Promise<StreamConnection> {
		this.streamConnection = new StreamConnection(
			this.manager,
			this.guildId,
			this.channelId,
		);
		this.manager.signalScreenShare();
		this.manager.pauseScreenShare(false);
		return new Promise((resolve, reject) => {
			let timeoutId = setTimeout(() => {
				reject(
					new DiscordStreamClientError('STREAM_CONNECTION_FAILED'),
				);
			}, this.#connectionTimeout).unref();
			let i = setInterval(() => {
				if (
					this.streamConnection?.sessionId &&
					this.streamConnection.token &&
					this.streamConnection.streamKey
				) {
					clearTimeout(timeoutId);
					clearInterval(i);
					resolve(this.streamConnection.connect());
					// Send test card
					if (postTestCard) {
						this.manager.client.user?.voice.postPreview(
							VideoTestCardBase64,
						);
					}
				}
			}, 100).unref();
		});
	}
}

export default VoiceConnection;
