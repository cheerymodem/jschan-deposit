'use strict';

const register = require('./register.js');
const { Web3 } = require('web3');

const sign = async (privateKey, builtMessage) => {
	const account = new Web3().eth.accounts.privateKeyToAccount(privateKey);
	return account.sign(builtMessage).signature;
};

describe('deposit register message builder/verifier', () => {

	const fields = {
		site: 'https://example.com',
		username: 'Alice',
		nonce: 'abc123',
	};
	const privateKey = '0x' + '33'.repeat(32);
	const address = new Web3().eth.accounts.privateKeyToAccount(privateKey).address.toLowerCase();

	test('build produces the canonical register message with a lowercased username', () => {
		expect(register.build(fields)).toBe([
			'jschan-deposit register',
			'Site: https://example.com',
			'Username: alice',
			'Nonce: abc123',
		].join('\n'));
	});

	test('verify round trip recovers the signing address, case-insensitive on username', async () => {
		const signature = await sign(privateKey, register.build(fields));
		const recovered = await register.verify({ ...fields, username: 'ALICE', signature });
		expect(recovered.toLowerCase()).toBe(address);
	});

	test('a signature for one username does not verify for another', async () => {
		const signature = await sign(privateKey, register.build(fields));
		const recovered = await register.verify({ ...fields, username: 'mallory', signature });
		expect(recovered.toLowerCase()).not.toBe(address);
	});

});
