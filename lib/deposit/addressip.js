'use strict';

const hashIp = require(__dirname+'/../misc/haship.js')
	, ipTypes = require(__dirname+'/../middleware/ip/iptypes.js');

//An ip-shaped record for a wallet, used where jschan stores an ip (address bans,
//confiscation modlogs). The wallet stays in raw, which only VIEW_RAW_IP staff
//see; the cloak is a keyed hash so it does not reveal the wallet.
module.exports = (address) => ({
	cloak: `${hashIp(address.toLowerCase()).substring(0,10)}.WALLET`,
	raw: address.toLowerCase(),
	type: ipTypes.DEPOSIT,
});
