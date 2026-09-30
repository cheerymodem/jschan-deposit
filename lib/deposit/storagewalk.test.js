'use strict';

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
const privateKey = process.env.DEPOSIT_TEST_KEY;

const describeFn = (rpc && contractAddress) ? describe : describe.skip;

describeFn('DamageDeposit storage walk', () => {

	const walkAt = (rpc, address) => {
		const client = require(__dirname+'/client.js');
		return client.walkAccountsAt(rpc, address);
	};

	const checkDepositAt = async (rpc, address, target) => {
		const web3 = new Web3(rpc);
		const c = new web3.eth.Contract(require(__dirname+'/abi.json'), address);
		return c.methods.checkDeposit(target).call();
	};

	test('walkAccounts matches checkDeposit for a deposited account', async () => {
		expect.assertions(2);
		const web3 = new Web3(rpc);
		const contract = new web3.eth.Contract(require(__dirname+'/abi.json'), contractAddress);

		const account = web3.eth.accounts.privateKeyToAccount(privateKey);
		const address = account.address.toLowerCase();

		//deposit if not already present (idempotent)
		const [ present ] = await contract.methods.checkDeposit(address).call();
		if (!present) {
			const deporeq = await contract.methods.depositRequirement().call();
			const tx = await account.signTransaction({
				to: contractAddress,
				value: deporeq,
				gas: 200000,
			});
			await web3.eth.sendSignedTransaction(tx.rawTransaction);
		}

		const walked = await walkAt(rpc, contractAddress);
		const entry = walked.find(a => a.address === address);
		expect(entry).toBeTruthy();
		const [ walkPresent, walkWt ] = await checkDepositAt(rpc, contractAddress, address);
		expect(walkPresent).toBe(true);
		expect(walkWt === entry.withdrawTimestamp).toBe(true);
	}, 60000);

});
