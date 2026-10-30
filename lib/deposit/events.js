'use strict';

const { Deposits, DepositSync } = require(__dirname+'/../../db/')
	, tombstone = require(__dirname+'/tombstone.js');

//An exit event (withdrawal or confiscation) at exitBlock can belong to an older
//deposit than the current twin: the sync applies grants before restrictive events,
//and a backfill replays old exits. Posting needs an active twin, so the newer
//deposit's posts all postdate its activatedAt. Returns whether the exit is for the
//current twin, and the date before which posts belong to the exited deposit (null:
//all of them).
const exitScope = async (address, exitBlock) => {
	const twin = await Deposits.findOne({ '_id': address.toLowerCase() });
	if (twin && exitBlock != null && twin.depositBlock > exitBlock) {
		return { current: false, before: twin.activatedAt || twin.updatedAt || new Date(0) };
	}
	return { current: true, before: null };
};

//apply a single event to the twin and to stored posts. Handlers must be
//idempotent: reprocessing a block range is safe.
module.exports = {

	exitScope,

	DepositMade: async (address, blockNumber) => {
		await Deposits.upsertActive(address, blockNumber, blockNumber);
	},

	WithdrawalInitiated: async (address, withdrawalTimeSeconds, blockNumber) => {
		//hide the author's posts immediately, then flip the twin to withdrawing
		const scope = await exitScope(address, blockNumber);
		await tombstone.hidePostsFor(address, scope.before);
		if (scope.current) {
			await Deposits.setWithdrawing(address, new Date(withdrawalTimeSeconds * 1000), blockNumber);
		}
	},

	DepositWithdrawn: async (address, blockNumber=null) => {
		const scope = await exitScope(address, blockNumber);
		await tombstone.stripPostsFor(address, 'withdrawn', null, scope.before);
		if (scope.current) {
			await Deposits.delete(address, blockNumber);
		}
	},

	//shared by the chain listener and the staff confirm endpoint. Strips the
	//deposit's posts, writes the public modlog (with the staff reason when one was
	//given, by either caller) and removes the twin. Returns { status, stripped }:
	//status 'won' when this call did the work, 'done' or 'busy' when another
	//caller already has. A failure leaves the claim unfinished, so it expires and
	//the listener retries.
	confiscate: async (address, blockNumber, txHash, amount=null, reason=null) => {
		if (txHash) {
			if (reason) {
				await DepositSync.setTxReason(txHash, reason);
			}
			const status = await DepositSync.claimTx(txHash);
			if (status !== 'won') {
				//the other caller may already have written the modlog
				if (reason) {
					await tombstone.addConfiscationReason(txHash, reason);
				}
				return { status, stripped: 0 };
			}
		}
		const scope = await exitScope(address, blockNumber);
		const stripped = await tombstone.confiscateFor(address, txHash, amount, reason, scope.before);
		if (scope.current) {
			await Deposits.delete(address, blockNumber);
		}
		if (txHash) {
			//a reason stored by the other caller while this one was working
			const record = await DepositSync.getTx(txHash);
			if (record && record.reason && record.reason !== reason) {
				await tombstone.addConfiscationReason(txHash, record.reason);
			}
			await DepositSync.finishTx(txHash);
		}
		return { status: 'won', stripped };
	},

	DepositConfiscated: async (address, blockNumber, txHash) => {
		const { status } = await module.exports.confiscate(address, blockNumber, txHash);
		if (status === 'busy') {
			//the confirm endpoint is mid-confiscation (or crashed holding the claim).
			//Abort this poll so the cursor stays put and the event is retried.
			throw new Error(`deposit confiscation ${txHash} is in progress elsewhere, retrying next poll`);
		}
	},

};
