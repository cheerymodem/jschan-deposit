'use strict';

const { Web3 } = require('web3')
	, abi = require(__dirname+'/abi.json')
	, config = require(__dirname+'/../misc/config.js')
	, { addCallback } = require(__dirname+'/../redis/redis.js');

//web3 v4 helper to read a key into a raw storage slot by keccak-256 of a 32-byte word
const storageKey = (slot) => {
	const bytes = web3.utils.padLeft(web3.utils.numberToHex(slot), 64);
	return web3.utils.keccak256(bytes);
};

let web3 = null
	, contract = null;

const rebuild = () => {
	const deposit = config.get && config.get.deposit;
	if (!deposit || !deposit.enabled || !deposit.rpcUrl || !deposit.contractAddress) {
		web3 = null;
		contract = null;
		return;
	}
	web3 = new Web3(deposit.rpcUrl);
	contract = new web3.eth.Contract(abi, deposit.contractAddress);
};

addCallback('config', rebuild);
rebuild();

module.exports = {

	isEnabled: () => {
		return web3 != null && contract != null;
	},

	getLogs: (from, to, eventNames) => {
		const topics = eventNames.map(name => {
			return web3.eth.abi.encodeEventSignature(name);
		});
		return contract.getPastEvents('allEvents', {
			fromBlock: from,
			toBlock: to,
			topics: [topics],
		}).then(events => {
			return events.filter(e => eventNames.includes(e.event))
				.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.logIndex - b.logIndex));
		});
	},

	//top 32-byte event signature selector for topic matching a receipt
	eventSignature: (eventName) => {
		return web3.eth.abi.encodeEventSignature(eventName);
	},

	checkDeposit: async (address) => {
		return contract.methods.checkDeposit(address).call();
	},

	owner: async () => {
		return contract.methods.owner().call();
	},

	depositRequirement: async () => {
		return web3.utils.hexToNumber(await contract.methods.depositRequirement().call());
	},

	withdrawPeriod: async () => {
		return web3.utils.hexToNumber(await contract.methods.withdrawPeriod().call());
	},

	getReceipt: async (txHash) => {
		return web3.eth.getTransactionReceipt(txHash);
	},

	getLatestBlockNumber: async () => {
		return web3.eth.getBlockNumber();
	},

	getLagSeconds: async () => {
		const { DepositSync } = require(__dirname+'/../../db/');
		const last = await DepositSync.get();
		if (!last || !last.lastPollAt) {
			return 0;
		}
		return Math.round((Date.now() - last.lastPollAt.getTime()) / 1000);
	},

	//storage walk over the OZ EnumerableSet/EnumerableMap layout used by the
	//DamageDeposit contract. Relies on OZ 4.9.6 internals; pinned by a test.
	//slot 1 = accounts length; element i at keccak256(pad32(1)) + i.
	//slot 3 = withdrawals mapping, value at keccak256(abi.encode(address, uint256(3))).
	async walkAccounts() {
		const length = web3.utils.hexToNumber(await web3.eth.getStorageAt(contract.options.address, 1));
		const baseKey = BigInt(storageKey(1));
		const entries = [];
		for (let i = 0; i < length; i++) {
			const raw = await web3.eth.getStorageAt(contract.options.address, web3.utils.numberToHex(baseKey + BigInt(i)));
			const address = '0x' + raw.slice(-40).toLowerCase();
			const valueKey = web3.utils.soliditySha3({ t: 'bytes32', v: web3.utils.padLeft(address, 64) }, { t: 'uint256', v: 3 });
			const withdrawalTime = web3.utils.hexToNumber(await web3.eth.getStorageAt(contract.options.address, valueKey));
			entries.push({
				address,
				withdrawTimestamp: withdrawalTime,
			});
		}
		return entries;
	},

};
