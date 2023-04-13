## Discord selfbot video

Fork: [Discord-video-stream](https://github.com/dank074/Discord-video-stream)

## Features

-   Playing vp8 video in a voice channel (`go live`, or webcam video)
-   Transcoding video to vp8 and audio to opus (using ffmpeg)

## Implementation

What I implemented and what I did not.

#### Video codecs

-   [x] VP8
-   [ ] VP9
-   [ ] H.264

#### Packet types

-   [x] RTP (sending of realtime data)
-   [ ] RTX (retransmission)

#### Connection types

-   [x] Regular Voice Connection
-   [x] Go live

#### Extras

-   [x] Figure out rtp header extensions (discord specific)
> [discord seems to use one-byte RTP header extension](https://www.rfc-editor.org/rfc/rfc8285.html#section-4.2)

## Requirements

Ffmpeg is required for the usage of this package. If you are on linux you can easily install ffmpeg from your distribution's package manager.

If you are on Windows, you can download it from the official ffmpeg website: https://ffmpeg.org/download.html

## Usage

Install the package, alongside its peer-dependency discord.js-selfbot-v13:

```
npm install discord-stream-client@latest
npm install discord.js-selfbot-v13@latest
```

Create a new client, and patch its events to listen for voice gateway events:

```js
import { Client } from 'discord.js-selfbot-v13';
import { DiscordStreamClient } from 'discord-stream-client';

const client = new Client();
const StreamClient = new DiscordStreamClient(client);

const token = 'token';

StreamClient.patch();
await client.login(token);
```

Make client join a voice channel and create a stream (Screen Share):

```js
// Connect to a voice channel
const voiceConnection = await StreamClient.joinVoiceChannel(
	client.channels.cache.get('voice channel id'),
	{
		selfDeaf: false,
		selfMute: true,
		selfVideo: false,
	},
);
// Create a stream
const streamConnection = await voiceConnection.createStream();
// Create a player
const player = StreamClient.createPlayer(
	'https://dl2.issou.best/ordr/videos/render1046454.mp4', // DIRECT VIDEO URL OR READABLE STREAM HERE
	streamConnection.udp, // UDP connection
);
// Events
player.on('finish', () => {
	console.log('Finished playing');
});
// Play video !!!
player.play();
// Stop playing
player.stop();
```