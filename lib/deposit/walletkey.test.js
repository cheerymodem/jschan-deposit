'use strict';

jest.mock(__dirname+'/../../configs/secrets.js', () => ({ ipHashSecret: 'test-secret' }));

const walletKey = require('./walletkey.js');

describe('deposit account wallet key', () => {

	const address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

	test('is stable and case-insensitive on the address', () => {
		expect(walletKey(address)).toBe(walletKey(address.toUpperCase().replace('0X', '0x')));
	});

	test('differs between wallets', () => {
		expect(walletKey(address)).not.toBe(walletKey('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'));
	});

	test('does not contain the address or its plain sha256', () => {
		const key = walletKey(address);
		const plain = require('crypto').createHash('sha256').update(address).digest('base64');
		expect(key).not.toContain(address.slice(2));
		expect(key).not.toBe(plain);
	});

});
