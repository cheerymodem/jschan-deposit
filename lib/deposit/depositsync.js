'use strict';

const { Deposits, DepositSync } = require(__dirname+'/../../db/')
	, client = require(__dirname+'/../../lib/deposit/client.js')
	, events = require(__dirname+'/../../lib/deposit/events.js')
	, tombstone = require(__dirname+'/../../lib/deposit/tombstone.js')
	, config = require(__dirname+'/../../lib/misc/config.js')
	, { MINUTE } = require(__dirname+'/../../lib/converter/timeutils.js');

const BACKFILL_CHUNK = 2000
	, VERIFY_INTERVAL = MINUTE * 10;

const log = (msg) => {
	if (config.get.debugLogs) {
		console.log(msg);
	}
};

//apply a batch of already-ordered events idempotently
const applyEvent = async (logEvent) => {
	const address = logEvent.returnValues.account.toLowerCase();
	const blockNumber = Number(logEvent.blockNumber);
	switch (logEvent.event) {
		case 'DepositMade': {
			//the grant cursor lags the restrictive one by confirmations, so by now
			//the key may already have withdrawn or been confiscated (and its twin
			//deleted). Only grant if the deposit is still present and not exiting.
			const result = await client.checkDeposit(address);
			if (result[0] === true && BigInt(result[1]) === 0n) {
				await events.DepositMade(address, blockNumber);
			}
			break;
		}
		case 'WithdrawalInitiated': {
			const withdrawalTime = logEvent.returnValues.withdrawalTime;
			await events.WithdrawalInitiated(address, Number(withdrawalTime), blockNumber);
			break;
		}
		case 'DepositWithdrawn':
			await events.DepositWithdrawn(address, blockNumber);
			break;
		case 'DepositConfiscated':
			await events.DepositConfiscated(address, blockNumber, logEvent.transactionHash || null);
			break;
	}
};

//the schedule fires on a fixed interval regardless of whether the previous
//poll finished (a backfill can take longer), so never run two polls at once
let running = false;

const func = async () => {
	if (!client.isEnabled() || running) {
		return;
	}
	running = true;
	try {
		await poll();
	} finally {
		running = false;
	}
};

const poll = async () => {

	const { deployBlock, confirmations, ...rest } = config.get.deposit;
	const verifyInterval = rest.verifyInterval || VERIFY_INTERVAL;
	const checkpoint = await DepositSync.get();

	//cursors hold the last processed block, so start just before the deploy block
	const start = Math.max(deployBlock - 1, 0);
	let lastBlockGrant = (checkpoint && checkpoint.lastBlockGrant != null) ? checkpoint.lastBlockGrant : start;
	let lastBlockRestrictive = (checkpoint && checkpoint.lastBlockRestrictive != null) ? checkpoint.lastBlockRestrictive : start;

	//backfill is handled incrementally: on first run with no sync doc both cursors
	//start at deployBlock and the loops below advance them until they catch up,
	//which is equivalent to a chunked backfill.

	const head = await client.getLatestBlockNumber();

	//DepositMade waits for confirmations; process the grant cursor over the
	//confirmed range. A deposit minted then withdrawn within the confirmed range is
	//correctly handled because the restrictive pass below applies immediately over
	//the whole range; the verify walk is authoritative for final state.
	const grantTarget = Math.max(head - confirmations, deployBlock);
	while (lastBlockGrant < grantTarget) {
		const grantTo = Math.min(lastBlockGrant + BACKFILL_CHUNK, grantTarget);
		const logs = await client.getLogs(lastBlockGrant + 1, grantTo, ['DepositMade']);
		for (const lg of logs) {
			await applyEvent(lg);
		}
		lastBlockGrant = grantTo;
	}

	//restrictive events (WithdrawalInitiated, WithdrawalWithdrawn, DepositConfiscated)
	//apply immediately up to head, chunked for safe backfill.
	while (lastBlockRestrictive < head) {
		const restrictiveTo = Math.min(lastBlockRestrictive + BACKFILL_CHUNK, head);
		const logs = await client.getLogs(lastBlockRestrictive + 1, restrictiveTo,
			['WithdrawalInitiated', 'DepositWithdrawn', 'DepositConfiscated']);
		for (const lg of logs) {
			await applyEvent(lg);
		}
		lastBlockRestrictive = restrictiveTo;
	}

	//re-run hiding for all withdrawing keys that still have visible posts,
	//closing the post-vs-listener race
	const withdrawing = await (await Deposits.find({ 'status': 'withdrawing' })).toArray();
	for (const dep of withdrawing) {
		await tombstone.hidePostsFor(dep._id);
	}

	//periodic storage-walk verification
	if (!checkpoint || !checkpoint.lastVerifyAt || (Date.now() - checkpoint.lastVerifyAt.getTime()) > verifyInterval) {
		await verify();
	}

	await DepositSync.set({
		lastBlockGrant,
		lastBlockRestrictive,
		lastPollAt: new Date(),
		lagSeconds: await client.getLagSeconds(),
	});
};

//compare the storage walk with the twin and correct discrepancies
const verify = async () => {
	const accounts = await client.walkAccounts();
	const walkMap = {};
	for (const a of accounts) {
		walkMap[a.address] = a;
	}
	const twins = await (await Deposits.find({})).toArray();

	//twin entries missing from the walk are exiting or already gone; leave them,
	//the event listener is authoritative for removals. Correct status/timestamp
	//mismatches on keys present in both.
	for (const twin of twins) {
		const walked = walkMap[twin._id];
		//a twin absent from the walk no longer holds a deposit on chain (a key is
		//only present while it has a deposit; withdrawal/confiscation removes it).
		//Reconcile so a missed restricted event never leaves a stale gateable twin.
		if (!walked) {
			//the listener missed the exit, so the posts were never stripped. Find
			//out how the key left and run the matching handler (both delete the twin).
			const fromBlock = twin.lastEventBlock != null ? twin.lastEventBlock : config.get.deposit.deployBlock;
			const exit = await client.findExitEvent(twin._id, fromBlock);
			log(`deposit verify: stale twin for ${twin._id} (absent from storage walk), exit ${exit ? exit.event : 'unknown'}`);
			if (exit && exit.event === 'DepositConfiscated') {
				await events.DepositConfiscated(twin._id, Number(exit.blockNumber), exit.transactionHash || null);
			} else {
				await events.DepositWithdrawn(twin._id, exit ? Number(exit.blockNumber) : null);
			}
			continue;
		}
		const walkedStatus = walked.withdrawTimestamp === 0 ? 'active' : 'withdrawing';
		if (walkedStatus !== twin.status || (walked.withdrawTimestamp && twin.withdrawAt && walked.withdrawTimestamp * 1000 !== twin.withdrawAt.getTime())) {
			log(`deposit verify: corrected twin for ${twin._id} from ${twin.status} to ${walkedStatus}`);
			if (walkedStatus === 'active') {
				await Deposits.upsertActive(twin._id, twin.depositBlock, twin.lastEventBlock);
			} else {
				await Deposits.setWithdrawing(twin._id, new Date(walked.withdrawTimestamp * 1000), twin.lastEventBlock);
			}
		}
	}

	//keys holding a deposit on chain with no twin (e.g. a twin wrongly removed by
	//an exit replayed out of order). Their deposit block is unknown, so record the
	//current head: every older exit then leaves the new twin alone, and any exit of
	//this deposit comes later.
	const twinIds = new Set(twins.map(t => t._id));
	const missing = accounts.filter(a => !twinIds.has(a.address));
	if (missing.length > 0) {
		const head = await client.getLatestBlockNumber();
		for (const a of missing) {
			log(`deposit verify: added missing twin for ${a.address}`);
			if (a.withdrawTimestamp === 0) {
				await Deposits.upsertActive(a.address, head, head);
			} else {
				await Deposits.setWithdrawing(a.address, new Date(a.withdrawTimestamp * 1000), head);
			}
		}
	}

	await DepositSync.set({ lastVerifyAt: new Date() });
};

module.exports.func = func;
