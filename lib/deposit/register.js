'use strict';

const { recover: web3EthAccountsRecover } = require('web3-eth-accounts');

//Registration-scoped signed message. Binds the site and the (lowercased) username
//so one deposit attestation cannot be replayed to register a different account,
//and is distinct from the post and report messages.
const build = ({ site, username, nonce }) => {
	return [
		'jschan-deposit register',
		`Site: ${site}`,
		`Username: ${String(username).toLowerCase()}`,
		`Nonce: ${nonce}`,
	].join('\n');
};

const verify = async ({ site, username, nonce, signature }) => {
	return web3EthAccountsRecover(build({ site, username, nonce }), signature);
};

module.exports = {
	build,
	verify,
};
