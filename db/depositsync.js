'use strict';

const Mongo = require(__dirname+'/db.js')
	, db = Mongo.db.collection('depositsync');

module.exports = {

	db,

	get: () => {
		return db.findOne({ '_id': 'sync' });
	},

	set: (data) => {
		const update = {
			'$set': {
				'updatedAt': new Date(),
				...data,
			},
		};
		return db.updateOne({ '_id': 'sync' }, update, { 'upsert': true });
	},

	//claim a confiscation tx hash so the confirm endpoint and the listener
	//process it once between them. Returns true if this caller won the claim.
	claimTx: async (txHash) => {
		const result = await db.updateOne({
			'_id': 'processedtx',
		}, {
			'$addToSet': { 'hashes': txHash.toLowerCase() },
		}, { 'upsert': true });
		return result.modifiedCount === 1 || result.upsertedCount === 1;
	},

};
