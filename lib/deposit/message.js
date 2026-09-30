'use strict';

const { createHash } = require('crypto')
	, { recover: web3EthAccountsRecover } = require('web3-eth-accounts');

//normalise \r\n to \n exactly as the client does before hashing
const normaliseMessage = (message) => {
	return ((message == null) ? '' : message).replace(/\r\n/igm, '\n');
};

const sha256Hex = (input) => {
	return createHash('sha256').update(input, 'utf8').digest('hex');
};

//Build the canonical signed message. Every field is fixed-width so the server
//can rebuild it byte-for-byte and the recovered address is stable.
const build = ({ site, board, thread, message, fileHashes, nonce }) => {
	const messageSha = message == null || message.length === 0
		? ''
		: sha256Hex(normaliseMessage(message));
	const filesSha = (!fileHashes || fileHashes.length === 0)
		? 'none'
		: [...fileHashes].map(h => h.toLowerCase()).sort().join(',');

	return [
		'jschan-deposit post',
		`Site: ${site}`,
		`Board: ${board}`,
		`Thread: ${thread == null ? 'new' : thread}`,
		`Message-SHA256: ${messageSha}`,
		`Files-SHA256: ${filesSha}`,
		`Nonce: ${nonce}`,
	].join('\n');
};

//Rebuild and recover the address from a submitted signature
const verify = async ({ site, board, thread, message, fileHashes, nonce, signature }) => {
	const built = build({ site, board, thread, message, fileHashes, nonce });
	return web3EthAccountsRecover(built, signature);
};

//mirror of build() for client-side use, returns the raw string to sign
const clientBuild = ({ site, board, thread, message, fileHashes, nonce }) => {
	return build({ site, board, thread, message, fileHashes, nonce });
};

module.exports = {
	normaliseMessage,
	sha256Hex,
	build,
	verify,
	clientBuild,
};
