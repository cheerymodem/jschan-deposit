'use strict';

module.exports = async(db, redis) => {
	console.log('Adding deposit settings to globalsettings');
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
		},
	});
	console.log('Clearing globalsettings cache');
	await redis.deletePattern('globalsettings');

	console.log('Indexing wallet addresses for posts, bans and warnings');
	await db.collection('posts').createIndex({ 'address': 1 }, { 'sparse': true });
	await db.collection('deposits').createIndex({ 'status': 1, 'withdrawAt': 1 });
	await db.collection('bans').createIndex({ 'address': 1, 'board': 1 }, { 'sparse': true });
	await db.collection('warnings').createIndex({ 'address': 1, 'board': 1 });
	await db.collection('warnings').createIndex({ 'expireAt': 1 }, { expireAfterSeconds: 0 });

	console.log('Indexing account wallet keys (one account per deposit wallet)');
	await db.collection('accounts').createIndex({ 'walletKey': 1 }, {
		'unique': true,
		'partialFilterExpression': { 'walletKey': { '$type': 'string' } },
	});
};
