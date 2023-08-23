'use strict';

import { DiscordStreamClientError } from "./Error";

type libName = 'sodium' | 'libsodium-wrappers' | 'tweetnacl';

interface Libs {
	sodium: (sodium: any) => {
		open: any;
		close: any;
		random: (n: number) => void;
	};
	'libsodium-wrappers': (sodium: any) => {
		open: any;
		close: any;
		random: (n: number) => void;
	};
	tweetnacl: (tweetnacl: any) => {
		open: any;
		close: any;
		random: (n: number) => void;
	};
}

type Method = 'open' | 'close' | 'random';

export const methods: {
	[key in Method]: any;
} = {
	open: null,
	close: null,
	random: null,
};

(async () => {
	const libs: Libs = {
		sodium: (sodium) => ({
			open: sodium.api.crypto_secretbox_open_easy,
			close: sodium.api.crypto_secretbox_easy,
			random: (n) => sodium.randombytes_buf(n),
		}),
		'libsodium-wrappers': (sodium) => ({
			open: sodium.crypto_secretbox_open_easy,
			close: sodium.crypto_secretbox_easy,
			random: (n) => sodium.randombytes_buf(n),
		}),
		tweetnacl: (tweetnacl) => ({
			open: tweetnacl.secretbox.open,
			close: tweetnacl.secretbox,
			random: (n) => tweetnacl.randomBytes(n),
		}),
	};

	for (const libName of Object.keys(libs)) {
		try {
			const lib = require(libName) as any;
			if (libName === 'libsodium-wrappers' && lib.ready) await lib.ready;
			Object.entries(libs[libName as libName](lib)).map(
				([key, value]) => {
					methods[key as Method] = value;
				},
			);
			break;
		} catch (error) {}
	}

    if (!methods.open || !methods.close || !methods.random) {
        throw new DiscordStreamClientError('MISSING_ENCRYPTION_MODULE');
    }
})();
