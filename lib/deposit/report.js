'use strict';

const { recover: web3EthAccountsRecover } = require('web3-eth-accounts');

//Report-scoped signed message. Distinct from the posting message so a post
//signature cannot be reused for a report (and vice versa). Binds the site,
//board and the report action so a signature cannot be replayed elsewhere.
const build = ({ site, board, nonce }) => {
	return [
		'jschan-deposit report',
		`Site: ${site}`,
		`Board: ${board}`,
		`Nonce: ${nonce}`,
	].join('\n');
};

const verify = async ({ site, board, nonce, signature }) => {
	const built = build({ site, board, nonce });
	return web3EthAccountsRecover(built, signature);
};

module.exports = {
	build,
	verify,
};