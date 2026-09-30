'use strict';

const omitAddress = require('./omitaddress.js');

describe('omitAddress for public and -hashed staff sockets', () => {

	const makePost = () => ({
		'_id': 'abc123',
		'postId': 1,
		'message': 'hello',
		'signature': '0xdeadbeef',
		'address': '0x0123456789012345678901234567890123456789',
		'ip': { cloak: 'cloak', raw: 'raw', type: 'ipv4' },
	});

	test('keeps non-wallet fields', () => {
		const out = omitAddress(makePost());
		expect(out.postId).toBe(1);
		expect(out.message).toBe('hello');
		expect(out.ip).toEqual({ cloak: 'cloak', raw: 'raw', type: 'ipv4' });
	});

	test('removes signature and address', () => {
		const out = omitAddress(makePost());
		expect('signature' in out).toBe(false);
		expect('address' in out).toBe(false);
	});

	test('does not mutate the input object', () => {
		const post = makePost();
		omitAddress(post);
		expect(post.signature).toBe('0xdeadbeef');
		expect(post.address).toBe('0x0123456789012345678901234567890123456789');
	});
});
