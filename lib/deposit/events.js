'use strict';

const { Deposits, DepositSync } = require(__dirname+'/../../db/')
	, tombstone = require(__dirname+'/tombstone.js');

//apply a single event to the twin and to stored posts. Handlers must be
//idempotent: reprocessing a block range is safe.
module.exports = {

	DepositMade: async (address, blockNumber) => {
		await Deposits.upsertActive(address, blockNumber, blockNumber);
	},

	WithdrawalInitiated: async (address, withdrawalTimeSeconds, blockNumber) => {
		//hide the author's posts immediately, then flip the twin to withdrawing
		await tombstone.hidePostsFor(address);
		await Deposits.setWithdrawing(address, new Date(withdrawalTimeSeconds * 1000), blockNumber);
	},

	DepositWithdrawn: async (address, blockNumber) => {
		await tombstone.stripPostsFor(address, 'withdrawn');
		await Deposits.delete(address);
	},

	DepositConfiscated: async (address, blockNumber, txHash) => {
		//strip + (if any posts were newly stripped) write a public modlog entry
		//without a staff user. Idempotent: reprocessing after the strip already
		//happened strips nothing and writes no second log.
		const { Deposits } = require(__dirname+'/../../db/');
		await tombstone.confiscateFor(address, txHash, null, null);
		await Deposits.delete(address);
	},

};
