'use strict';

const message = require('./message.js');
const { Web3 } = require('web3');
const { createHash } = require('crypto');

//sign a built message the way MetaMask's personal_sign does
const sign = async (privateKey, builtMessage) => {
	const account = new Web3().eth.accounts.privateKeyToAccount(privateKey);
	return account.sign(builtMessage).signature;
};

const sha256Hex = (input) => createHash('sha256').update(input, 'utf8').digest('hex');

describe('deposit signed message builder/verifier', () => {

	const fields = {
		site: 'https://example.com',
		board: 'b',
		thread: 42,
		message: 'hello world',
		fileHashes: ['b'.repeat(64), 'a'.repeat(64)],
		nonce: 'abc123',
	};

	test('build produces the canonical message', () => {
		const built = message.build(fields);
		expect(built).toBe([
			'jschan-deposit post',
			'Site: https://example.com',
			'Board: b',
			'Thread: 42',
			`Message-SHA256: ${sha256Hex('hello world')}`,
			`Files-SHA256: ${'a'.repeat(64)},${'b'.repeat(64)}`,
			'Nonce: abc123',
		].join('\n'));
	});

	test('file hashes are lowercased and sorted before joining', () => {
		const built = message.build(fields);
		expect(built).toBe([
			'jschan-deposit post',
			'Site: https://example.com',
			'Board: b',
			'Thread: 42',
			`Message-SHA256: ${sha256Hex('hello world')}`,
			`Files-SHA256: ${'a'.repeat(64)},${'b'.repeat(64)}`,
			'Nonce: abc123',
		].join('\n'));
	});

	test('empty message uses empty string, empty files use "none"', () => {
		const built = message.build({ ...fields, message: '', fileHashes: [] });
		expect(built).toContain('\nMessage-SHA256: \n');
		expect(built).toContain('\nFiles-SHA256: none\n');
	});

	test('thread null renders as "new"', () => {
		expect(message.build({ ...fields, thread: null })).toContain('\nThread: new\n');
	});

	test('CRLF is normalised to LF before hashing', () => {
		const crlf = message.build({ ...fields, message: 'line1\r\nline2' });
		const lf = message.build({ ...fields, message: 'line1\nline2' });
		expect(crlf).toBe(lf);
	});

	test('verify round trip recovers the signing address', async () => {
		const privateKey = '0x' + '11'.repeat(32);
		const address = new Web3().eth.accounts.privateKeyToAccount(privateKey).address;
		const signature = await sign(privateKey, message.build(fields));
		const recovered = await message.verify({ ...fields, signature });
		expect(recovered.toLowerCase()).toBe(address.toLowerCase());
	});

	test('verify with a wrong board rejects (recovers a different address)', async () => {
		const privateKey = '0x' + '11'.repeat(32);
		const address = new Web3().eth.accounts.privateKeyToAccount(privateKey).address;
		const signature = await sign(privateKey, message.build(fields));
		const recovered = await message.verify({
			...fields,
			board: 'different',
			signature,
		});
		expect(recovered.toLowerCase()).not.toBe(address.toLowerCase());
	});

});
