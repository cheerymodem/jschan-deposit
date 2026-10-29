'use strict';

const { createHmac } = require('crypto')
	, { ipHashSecret } = require(__dirname+'/../../configs/secrets.js');

//Short stable label for a deposit key, shown to staff without VIEW_RAW_IP. An
//address prefix would not do: the depositor list is public on chain, so a few hex
//digits identify the wallet. Keyed, so it cannot be matched without the secret.
module.exports = (address) => {
	return createHmac('sha256', ipHashSecret)
		.update(`jschan-deposit staff tag\n${String(address).toLowerCase()}`)
		.digest('hex')
		.substring(0, 10);
};
