'use strict';

const Mongo = require(__dirname+'/db.js')
	, db = Mongo.db.collection('deposits');

module.exports = {

	db,

	find: (query, options) => {
		return db.find(query, options);
	},

	findOne: (query, options) => {
		return db.findOne(query, options);
	},

	upsertActive: (address, blockNumber, lastEventBlock) => {
		//only activate when the key is not already withdrawing in our store. The
		//grant cursor lags by confirmations and can otherwise re-apply a deposit
		//after a restrictive event set the twin to withdrawing, resurrecting it.
		return db.updateOne({
			'_id': address.toLowerCase(),
			'status': { '$ne': 'withdrawing' },
		}, {
			'$set': {
				'status': 'active',
				'withdrawAt': null,
				'depositBlock': blockNumber,
				'lastEventBlock': lastEventBlock,
				'updatedAt': new Date(),
			},
			'$setOnInsert': {
				'depositBlock': blockNumber,
				'lastEventBlock': lastEventBlock,
			},
		}, { 'upsert': true });
	},

	setWithdrawing: (address, withdrawAt, lastEventBlock) => {
		return db.updateOne({ '_id': address.toLowerCase() }, {
			'$set': {
				'status': 'withdrawing',
				'withdrawAt': withdrawAt,
				'lastEventBlock': lastEventBlock,
				'updatedAt': new Date(),
			},
		}, { 'upsert': true });
	},

	delete: (address) => {
		return db.deleteOne({ '_id': address.toLowerCase() });
	},

	deleteAll: () => {
		return db.deleteMany();
	},

};
