'use strict';

const Mongo = require(__dirname+'/db.js')
	, db = Mongo.db.collection('deposits');

module.exports = {

	db,

	find: (query, options) => {
		return db.find(query, options).toArray();
	},

	findOne: (query, options) => {
		return db.findOne(query, options);
	},

	upsertActive: (address, blockNumber, lastEventBlock) => {
		return db.updateOne({ '_id': address.toLowerCase() }, {
			'$set': {
				'status': 'active',
				'withdrawAt': null,
				'depositBlock': blockNumber,
				'lastEventBlock': lastEventBlock,
				'updatedAt': new Date(),
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
