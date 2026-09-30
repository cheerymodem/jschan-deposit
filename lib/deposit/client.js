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
		return module.exports.walkAccountsAt(web3, contract.options.address);
	},

	//walk against an explicit provider/address (used by the storage-walk test that
	//does not rely on the app config). slot 1 holds the accounts length; element i
	//of the set is at keccak256(pad32(1)) + i; the withdrawals mapping is slot 3 at
	//keccak256(abi.encode(address, uint256(3))).
	async walkAccountsAt(provider, address) {
		const w3 = provider && provider.eth ? provider : new Web3(provider);
		const eth = w3.eth;
		const baseKey = w3.utils.keccak256(w3.utils.padLeft(w3.utils.numberToHex(1), 64));
		const baseKeyInt = BigInt(baseKey);
		const length = w3.utils.hexToNumber(await eth.getStorageAt(address, 1));
		const entries = [];
		for (let i = 0; i < length; i++) {
			const raw = await eth.getStorageAt(address, '0x' + (baseKeyInt + BigInt(i)).toString(16));
			const addr = '0x' + raw.slice(-40).toLowerCase();
			const valueKey = w3.utils.soliditySha3(
				{ t: 'bytes32', v: w3.utils.padLeft(addr, 64) },
				{ t: 'uint256', v: 3 });
			const withdrawalTime = w3.utils.hexToNumber(await eth.getStorageAt(address, valueKey));
			entries.push({
				address: addr,
				withdrawTimestamp: withdrawalTime,
			});
		}
		return entries;
	},

};
