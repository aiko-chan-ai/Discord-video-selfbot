import { Client } from 'discord.js-selfbot-v13';
import { DiscordStreamClient } from './src/index.js';

const client = new Client();
const StreamClient = new DiscordStreamClient(client);

const token = 'token';

client.login(token);

client.on('ready', async () => {
	// Connect to a voice channel
	const voiceConnection = await StreamClient.joinVoiceChannel(
		client.channels.cache.get('voice channel id'),
		{
			selfDeaf: false,
			selfMute: true,
			selfVideo: false,
		}
	);
	// I want to use screen sharing ...
	const streamConnection = await voiceConnection.createStream();
	// Create a player
	const player = StreamClient.createPlayer(
		'https://dl2.issou.best/ordr/videos/render1046454.mp4',
		streamConnection.udp,
	);
	// Events
	player.on('finish', () => {
		console.log('Finished playing');
	});
	// Play video !!!
	player.play();
	// Display `User paused screen sharing` after 5 seconds
	setTimeout(() => {
		StreamClient.pauseScreenShare(true);
	}, 5_000);
	// But I want to use the webcam...
	StreamClient.signalVoiceChannel({
		selfVideo: true,
		selfMute: false,
	});
	// Create a different player
	const player_ = StreamClient.createPlayer(
		'https://dl2.issou.best/ordr/videos/render1046454.mp4',
		voiceConnection.udp,
	);
	// Events
	player_.on('finish', () => {
		console.log('Finished playing');
	});
	// Play video !!!
	player_.play();
	// Stop playing after 10 seconds
	setTimeout(() => {
		// Stop playing Screen sharing
		player.stop();
		// Stop playing Webcam
		player_.stop();
		// Disconnect from the voice channel
		StreamClient.leaveVoiceChannel();
	}, 10_000);
});
