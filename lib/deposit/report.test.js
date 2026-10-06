'use strict';

const report = require('./report.js');
const { Web3 } = require('web3');

const sign = async (privateKey, builtMessage) => {
	const account = new Web3().eth.accounts.privateKeyToAccount(privateKey);
	return account.sign(builtMessage).signature;
};

describe('deposit report message builder/verifier', () => {

	const fields = {
		site: 'https://example.com',
		board: 'b',
		nonce: 'abc123',
	};

	test('build produces the canonical report message', () => {
		expect(report.build(fields)).toBe([
			'jschan-deposit report',
			'Site: https://example.com',
			'Board: b',
			'Nonce: abc123',
		].join('\n'));
	});

	test('verify round trip recovers the signing address', async () => {
		const privateKey = '0x' + '22'.repeat(32);
		const address = new Web3().eth.accounts.privateKeyToAccount(privateKey).address;
		const signature = await sign(privateKey, report.build(fields));
		const recovered = await report.verify({ ...fields, signature });
		expect(recovered.toLowerCase()).toBe(address.toLowerCase());
	});

	test('verify with a different board rejects (recovers a different address)', async () => {
		const privateKey = '0x' + '22'.repeat(32);
		const address = new Web3().eth.accounts.privateKeyToAccount(privateKey).address;
		const signature = await sign(privateKey, report.build(fields));
		const recovered = await report.verify({
			...fields,
			board: 'different',
			signature,
		});
		expect(recovered.toLowerCase()).not.toBe(address.toLowerCase());
	});

});