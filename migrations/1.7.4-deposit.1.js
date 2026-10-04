'use strict';

module.exports = async(db, redis) => {
	console.log('Adding deposit settings to globalsettings and boardDefaults');
	await db.collection('globalsettings').updateOne({ _id: 'globalsettings' }, {
		'$set': {
			'deposit.enabled': true,
			'deposit.rpcUrl': '',
			'deposit.chainId': 0,
			'deposit.contractAddress': '',
			'deposit.deployBlock': 0,
			'deposit.confirmations': 1,
			'deposit.pollInterval': 5000,
			'deposit.interfaceUrl': '',
			'deposit.assetSymbol': 'ETH',
			'deposit.assetDecimals': 18,
			'boardDefaults.requireDeposit': true,
		},
	});
	console.log('Clearing globalsettings cache');
	await redis.deletePattern('globalsettings');
};
