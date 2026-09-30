'use strict';

//web3 needs a global getRandomValues even in the node test env
if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
	const { webcrypto } = require('crypto');
	globalThis.crypto = globalThis.crypto || {};
	globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
}

//Storage-walk test: skipped unless the caller points at a live local chain with a
//deployed DamageDeposit contract. This deploys nothing; it expects setupLocal.js to
//have run and the ETH variant address to be given in DEPOSIT_TEST_CONTRACT.
//
//  DEPOSIT_TEST_RPC      e.g. http://localhost:8545
//  DEPOSIT_TEST_CONTRACT e.g. 0x...
//  DEPOSIT_TEST_KEY      a funded Hardhat private key (defaults to account #0)
//
//Run: DEPOSIT_TEST_RPC=... DEPOSIT_TEST_CONTRACT=... npx jest lib/deposit/storagewalk.test.js

const { Web3 } = require('web3');

const rpc = process.env.DEPOSIT_TEST_RPC;
const contractAddress = process.env.DEPOSIT_TEST_CONTRACT;
const privateKey = process.env.DEPOSIT_TEST_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; //Hardhat account #0

const describeFn = (rpc && contractAddress) ? describe : describe.skip;

describeFn('DamageDeposit storage walk', () => {

	const walkAt = (rpc, address) => {
		const client = require(__dirname+'/client.js');
		return client.walkAccountsAt(rpc, address);
	};

	const checkDepositAt = async (rpc, address, target) => {
		const web3 = new Web3(rpc);
		const c = new web3.eth.Contract(require(__dirname+'/abi.json'), address);
		const res = await c.methods.checkDeposit(target).call();
		const present = !!res[0];
		const wt = res[1];
		return [ present, wt ];
	};

	test('walkAccounts matches checkDeposit for a deposited account', async () => {
		const web3 = new Web3(rpc);
		const contract = new web3.eth.Contract(require(__dirname+'/abi.json'), contractAddress);

		const account = web3.eth.accounts.privateKeyToAccount(privateKey);
		const address = account.address.toLowerCase();

		//deposit via the contract method (idempotent; sign with the wallet)
		web3.eth.accounts.wallet.add(privateKey);
		const checkRes = await contract.methods.checkDeposit(address).call();
		const present = !!checkRes[0];
		if (!present) {
			const deporeq = await contract.methods.depositRequirement().call();
			await contract.methods.deposit().send({ from: address, value: deporeq.toString(), gas: '0x186a0' });
		}

		const walked = await walkAt(rpc, contractAddress);
		const entry = walked.find(a => a.address === address);
		expect(entry).toBeTruthy();
		const [ walkPresent, walkWt ] = await checkDepositAt(rpc, contractAddress, address);
		expect(walkPresent).toBe(true);
		expect(Number(walkWt)).toBe(entry.withdrawTimestamp);
	}, 60000);

});
