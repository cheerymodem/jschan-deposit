'use strict';

const client = require(__dirname+'/../../lib/deposit/client.js')
	, { Deposits, DepositSync } = require(__dirname+'/../../db/')
	, tombstone = require(__dirname+'/../../lib/deposit/tombstone.js')
	, config = require(__dirname+'/../../lib/misc/config.js')
	, dynamicResponse = require(__dirname+'/../../lib/misc/dynamic.js');

//verify the receipt for a browser-signature confiscation matches our contract and
//the address. Returns the DepositConfiscated log if valid, else null.
const verifyReceipt = async (txHash, address, contractAddress) => {
	let receipt;
	try {
		receipt = await client.getReceipt(txHash);
	} catch (e) {
		return null;
	}
	//web3 v4 returns numeric receipt fields as BigInt
	if (!receipt || BigInt(receipt.status) !== 1n) {
		return null;
	}
	const contract = contractAddress.toLowerCase();
	if ((receipt.to || '').toLowerCase() !== contract) {
		return null;
	}
	let owner;
	try {
		owner = await client.owner();
	} catch (e) {
		return null;
	}
	if ((receipt.from || '').toLowerCase() !== owner.toLowerCase()) {
		return null;
	}
	const confiscatedLog = (receipt.logs || []).find(log => {
		if ((log.address || '').toLowerCase() !== contract) {
			return false;
		}
		const top = log.topics && log.topics[0];
		return top === client.eventSignature('DepositConfiscated');
	});
	if (!confiscatedLog) {
		return null;
	}
	const emitedAddress = confiscatedLog.topics[1]
		? '0x' + confiscatedLog.topics[1].slice(-40).toLowerCase()
		: null;
	if (emitedAddress !== address.toLowerCase()) {
		return null;
	}
	return confiscatedLog;
};

module.exports = {

	controller: async (req, res) => {

		const { __ } = res.locals;
		const { deposit } = config.get;

		const address = (typeof req.body.address === 'string') ? req.body.address.toLowerCase() : null;
		const txHash = (typeof req.body.txHash === 'string') ? req.body.txHash.toLowerCase() : null;
		const reason = (typeof req.body.reason === 'string') ? req.body.reason : null;

		if (!deposit || deposit.enabled !== true || !txHash || !address
			|| !/^0x[a-f0-9]{40}$/.test(address) || !/^0x[a-f0-9]{64}$/.test(txHash)) {
			return dynamicResponse(req, res, 400, 'message', {
				'title': __('Bad request'),
				'message': __('Bad request'),
			});
		}

		const contractAddress = deposit.contractAddress.toLowerCase();
		const log = await verifyReceipt(txHash, address, contractAddress);
		if (!log) {
			return dynamicResponse(req, res, 400, 'message', {
				'title': __('Bad request'),
				'message': __('Could not verify the confiscation transaction.'),
			});
		}

		//idempotent on the tx hash, claimed only after the receipt verified so a
		//bogus or not-yet-mined hash cannot block the real confirmation. The
		//listener may already have processed it from the chain event.
		if (!(await DepositSync.claimTx(txHash))) {
			await Deposits.delete(address);
			return dynamicResponse(req, res, 200, 'message', {
				'title': __('Success'),
				'message': __('Deposit already confiscated.'),
				'redirect': '/globalmanage/deposits.html',
			});
		}

		//get the deposit requirement as the amount shown
		let amount = null;
		try {
			amount = await client.depositRequirement();
		} catch (e) {
			amount = null;
		}

		const stripped = await tombstone.confiscateFor(address, txHash, amount, reason);

		await Deposits.delete(address);

		return dynamicResponse(req, res, 200, 'message', {
			'title': __('Success'),
			'message': __('Deposit confiscated.') + (stripped > 0 ? ' ' + __('%s posts removed', stripped) : ''),
			'redirect': '/globalmanage/deposits.html',
		});

	}

};
