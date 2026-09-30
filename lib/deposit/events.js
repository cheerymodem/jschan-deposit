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

	DepositConfiscated: async (address, blockNumber) => {
		//if the confirm endpoint already processed this (see Phase 6), the twin
		//doc is gone and strip is a no-op. Otherwise strip + log without staff.
		await tombstone.stripPostsFor(address, 'confiscated');
		await Deposits.delete(address);
	},

};
