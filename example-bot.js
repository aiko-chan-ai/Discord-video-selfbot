import { Client } from 'discord.js-selfbot-v13';
import { DiscordStreamClient } from 'discord-stream-client';
import Y2MateClient from 'y2mate-api';

const y2mate = new Y2MateClient();

const client = new Client();

const StreamClient = new DiscordStreamClient(client);

const token = 'token';

client.login(token);

client.on('ready', async () => {
	console.log(`--- ${client.user.tag} is ready ---`);
});

let connection;
let stream;
let player;

client.on('messageCreate', async (msg) => {
	if (msg.author.bot) return;
	if (!['721746046543331449', client.user.id].includes(msg.author.id)) return;
	if (!msg.content) return;
	if (!msg.content.startsWith(`$`)) return;
	const args = msg.content.trim().slice(1).split(' ');
	const command = args.shift().toLowerCase();
	if (command === 'join') {
		const voiceChannel = msg.member.voice?.channel;
		if (!voiceChannel) return;
		if (!connection)
			connection = await StreamClient.joinVoiceChannel(voiceChannel, {
				selfDeaf: true,
				selfMute: false,
				selfVideo: false,
			});
		if (connection && !stream) stream = await connection.createStream();
	}
	if (command === 'play') {
		let url = args[0];
		if (!url || !connection || !stream) return;
		if (player) player.stop();
		if (url.includes('youtube.com')) {
			const result = await y2mate.getFromURL(url, 'vi');
			if (result.page == 'detail') {
				url = await result.linksVideo.get('auto').fetch();
			} else if (result.page == 'playlist') {
				let video = await result.videos[0].fetch();
				url = await video.linksVideo.get('auto').fetch();
			}
			url = url.downloadLink;
		}
		player = StreamClient.createPlayer(url, stream.udp);
		player.play();
		player.once('finish', () => {
			player = null;
		});
	}
	if (command === 'stop') {
		connection = null;
		stream = null;
		player = null;
		StreamClient.leaveVoiceChannel();
	}
});

/* Message
$join
// Await join voice channel
$play https://www.youtube.com/watch?v=QH2-TGUlwu4
// Play video youtube with screen share mode
$stop
// Destroy all (leave voice channel and stop player)
*/
