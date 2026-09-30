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

	//tombstone a processed confiscation tx hash so the confirm endpoint and
	//listener are both idempotent on it
	hasProcessedTx: async (txHash) => {
		const result = await db.updateOne({
			'_id': 'processedtx',
			'hashes': { '$ne': txHash },
		}, {
			'$push': { 'hashes': txHash },
		});
		return result.modifiedCount === 0;
	},

};
