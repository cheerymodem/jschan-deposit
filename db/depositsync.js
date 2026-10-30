'use strict';

const Mongo = require(__dirname+'/db.js')
	, db = Mongo.db.collection('depositsync')
	, { MINUTE } = require(__dirname+'/../lib/converter/timeutils.js')
	, TX_CLAIM_LEASE = MINUTE * 5;

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

	//claim a confiscation tx so the confirm endpoint and the listener process it
	//once between them. Returns 'won' (process it, then finishTx), 'busy' (another
	//caller is processing it) or 'done'. A claim that was never finished (the
	//holder crashed or threw) expires after TX_CLAIM_LEASE and can be taken over.
	claimTx: async (txHash) => {
		const _id = `tx:${txHash.toLowerCase()}`;
		const now = new Date();
		try {
			//claimable when new, carrying only a reason (setTxReason), or expired
			await db.updateOne({
				_id,
				'$or': [
					{ 'state': { '$exists': false } },
					{ 'state': 'claimed', 'claimedAt': { '$lt': new Date(now.getTime() - TX_CLAIM_LEASE) } },
				],
			}, {
				'$set': { 'state': 'claimed', 'claimedAt': now },
			}, { 'upsert': true });
			return 'won';
		} catch (err) {
			//a live claim or a finished tx fails the filter, so the upsert collides
			if (err.code !== 11000) {
				throw err;
			}
		}
		const existing = await db.findOne({ _id });
		return existing && existing.state === 'done' ? 'done' : 'busy';
	},

	finishTx: (txHash) => {
		return db.updateOne({ '_id': `tx:${txHash.toLowerCase()}` }, { '$set': { 'state': 'done', 'doneAt': new Date() } });
	},

	//staff reason for a confiscation, kept with the tx so whichever caller writes
	//the modlog can apply it
	setTxReason: (txHash, reason) => {
		return db.updateOne({ '_id': `tx:${txHash.toLowerCase()}` }, { '$set': { reason } }, { 'upsert': true });
	},

	getTx: (txHash) => {
		return db.findOne({ '_id': `tx:${txHash.toLowerCase()}` });
	},

};
