'use strict';

const publicPost = require('./publicpost.js');

describe('publicPost', () => {

	const makePost = (overrides = {}) => ({
		'_id': 'abc',
		'board': 'b',
		'thread': null,
		'postId': 1,
		'date': new Date('2020-01-01T00:00:00Z'),
		'name': 'anon',
		'message': 'secret content',
		'signature': '0xsig',
		'address': '0xpii_9e6f2d8d-0f2d-4ff4-86fc-9c1f1a1f4b9bpii_1b9c3abf-7a3d-4c8e-b2f3-3b3e2b7f6a5cpii_5d4b9e2c-bfc7-4c9d-8a4e-7d1c9e2b4f6bpii_2a5f6c8e-3b7d-4a9f-b1c4-d8e2f4a6b8ca',
		'files': [{}],
		...overrides,
	});

	test('a normal post is returned unchanged', () => {
		const out = publicPost(makePost());
		expect(out.message).toBe('secret content');
		expect(out.files).toEqual([{}]);
	});

	test('a hidden post (withdrawing) becomes an exiting tombstone view with no content', () => {
		const out = publicPost(makePost({ hidden: true }));
		expect(out.tombstone.reason).toBe('exiting');
		expect('message' in out).toBe(false);
		expect(out.files).toEqual([]);
		expect('signature' in out).toBe(false);
		expect('address' in out).toBe(false);
		expect('hidden' in out).toBe(false);
	});

	test('an already tombstoned post keeps structural fields but no content', () => {
		const ts = { reason: 'withdrawn', date: new Date(), modlog: null };
		const out = publicPost(makePost({ tombstone: ts }));
		expect(out.tombstone).toBe(ts);
		expect('message' in out).toBe(false);
		expect(out.files).toEqual([]);
		expect(out.postId).toBe(1);
		expect(out.board).toBe('b');
	});

	test('null input returns null', () => {
		expect(publicPost(null)).toBe(null);
	});
});
