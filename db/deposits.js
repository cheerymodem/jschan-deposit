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

	upsertActive: async (address, blockNumber, lastEventBlock) => {
		//only activate when the key is not withdrawing in our store, unless this
		//deposit is newer than the withdrawal (a re-deposit applied before the old
		//exit). The grant cursor lags by confirmations and can otherwise re-apply a
		//deposit after a restrictive event set the twin to withdrawing, resurrecting
		//it. A doc failing the filter makes the upsert insert a duplicate _id; that
		//is the "leave it alone" case, not an error.
		const _id = address.toLowerCase();
		//activatedAt (server time) marks where this deposit's posts begin, so an
		//older exit event can tell the old deposit's posts from the new ones. Keep
		//it when the same deposit is re-applied.
		const existing = await db.findOne({ _id });
		const activatedAt = (existing && existing.depositBlock === blockNumber && existing.activatedAt)
			? existing.activatedAt
			: new Date();
		return db.updateOne({
			_id,
			'$or': [
				{ 'status': { '$ne': 'withdrawing' } },
				{ 'lastEventBlock': { '$lt': blockNumber } },
			],
		}, {
			'$set': {
				'status': 'active',
				'withdrawAt': null,
				'depositBlock': blockNumber,
				'lastEventBlock': lastEventBlock,
				activatedAt,
				'updatedAt': new Date(),
			},
		}, { 'upsert': true }).catch(err => {
			if (err.code !== 11000) {
				throw err;
			}
			return null;
		});
	},

	//callers only pass a withdrawal at or after the current deposit (see
	//events.exitScope), so this never touches a newer deposit
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

	//delete the twin for an exit at exitBlock, unless the twin is a newer deposit.
	//A null exitBlock (exit block unknown) deletes unconditionally.
	delete: (address, exitBlock=null) => {
		const filter = { '_id': address.toLowerCase() };
		if (exitBlock != null) {
			filter['depositBlock'] = { '$lte': exitBlock };
		}
		return db.deleteOne(filter);
	},

	deleteAll: () => {
		return db.deleteMany();
	},

};
