'use strict';

const actions = require('./actions.js');
const { Web3 } = require('web3');

describe('deposit post actions message', () => {

	const fields = {
		site: 'https://example.com',
		board: 'b',
		actions: ['report', 'delete'],
		posts: [12, 3, 3],
		nonce: 'abc123',
	};
	const account = new Web3().eth.accounts.privateKeyToAccount('0x' + '44'.repeat(32));

	test('build sorts actions and dedupes and sorts posts numerically', () => {
		expect(actions.build(fields)).toBe([
			'jschan-deposit actions',
			'Site: https://example.com',
			'Board: b',
			'Actions: delete,report',
			'Posts: 3,12',
			'Nonce: abc123',
		].join('\n'));
	});

	test('verify round trip recovers the signer', async () => {
		const signature = account.sign(actions.build(fields)).signature;
		expect((await actions.verify({ ...fields, posts: ['3', '12'], signature })).toLowerCase())
			.toBe(account.address.toLowerCase());
	});

	test('a signature for one set of posts or actions does not verify for another', async () => {
		const signature = account.sign(actions.build(fields)).signature;
		expect((await actions.verify({ ...fields, posts: [3, 13], signature })).toLowerCase())
			.not.toBe(account.address.toLowerCase());
		expect((await actions.verify({ ...fields, actions: ['report'], signature })).toLowerCase())
			.not.toBe(account.address.toLowerCase());
	});

	test('selected picks only public actions present in the body', () => {
		expect(actions.selected({ delete: '1', report: '1', ban: '1', hide_name: '1' })).toEqual(['delete', 'report']);
	});

});
