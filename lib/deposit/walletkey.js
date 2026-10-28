'use strict';

const { createHmac } = require('crypto')
	, { ipHashSecret } = require(__dirname+'/../../configs/secrets.js');

//Keyed hash of a wallet address, stored on accounts to allow one account per
//deposit wallet without storing the wallet itself. Without the secret the hash
//cannot be matched back to an address. Changing ipHashSecret orphans existing
//keys, letting those wallets register again.
module.exports = (address) => {
	return createHmac('sha256', ipHashSecret)
		.update(`jschan-deposit account wallet\n${String(address).toLowerCase()}`)
		.digest('base64');
};
