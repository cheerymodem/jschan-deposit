'use strict';

module.exports = async(db) => {
	console.log('Indexing account wallet keys (one account per deposit wallet)');
	await db.collection('accounts').createIndex({ 'walletKey': 1 }, {
		'unique': true,
		'partialFilterExpression': { 'walletKey': { '$type': 'string' } },
	});
};
