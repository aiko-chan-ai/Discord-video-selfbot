const formatInt = (int: number) => (int < 10 ? `0${int}` : int);

/**
 * Format duration to string
 * @param {number} sec Duration in seconds
 * @returns {string}
 */
export function formatDuration(sec: number): string {
	if (!sec || !Number(sec)) return '00:00';
	const seconds = Math.floor(sec % 60);
	const minutes = Math.floor((sec % 3600) / 60);
	const hours = Math.floor(sec / 3600);
	if (hours > 0)
		return `${formatInt(hours)}:${formatInt(minutes)}:${formatInt(
			seconds,
		)}`;
	if (minutes > 0) return `${formatInt(minutes)}:${formatInt(seconds)}`;
	return `00:${formatInt(seconds)}`;
}

export type ResolutionType = '1440p' | '1080p' | '720p' | '480p' | 'auto';

export function getResolutionData(resolution: ResolutionType) {
	switch (resolution) {
		case '1440p':
			return {
				width: 2560,
				height: 1440,
				fps: 60,
				bitrate: 14000000,
			};
		case '1080p':
			return {
				width: 1920,
				height: 1080,
				fps: 60,
				bitrate: 8000000,
				type: 'fixed',
			};
		case '720p':
			return {
				width: 1280,
				height: 720,
				fps: 60,
				bitrate: 6000000,
				type: 'fixed',
			};
		case '480p':
			return {
				width: 640,
				height: 480,
				fps: 30,
				bitrate: 2000000,
				type: 'fixed',
			};
		case 'auto': {
			return {
				width: 0,
				height: 0,
				fps: 60,
				bitrate: 8000000,
				type: 'source',
			};
		}
	}
}
