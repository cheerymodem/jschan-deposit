'use strict';

const collect = require('./confiscateaddresses.js');

const post = (address, reports = [], overrides = {}) => ({
	postId: 1,
	board: 'test',
	address,
	reports,
	globalreports: reports,
	...overrides,
});

const rep = (id, address) => ({ id, address });

describe('collectConfiscationAddresses', () => {

	test('collects the author address when confiscating posts', () => {
		const posts = [post('0x70997970c51812dc3a010c7d01b50e0d17dc79c8')];
		const out = collect(posts, { confiscate_posts: true }, [], false);
		expect([...out]).toEqual(['0x70997970c51812dc3a010c7d01b50e0d17dc79c8']);
	});

	test('does not collect a post without a valid address', () => {
		const posts = [post(null), post('0xnothing')];
		expect(collect(posts, { confiscate_posts: true }, [], false).size).toBe(0);
	});

	test('collects only checked reporters with valid addresses', () => {
		const posts = [
			post(null, [
				rep('a', '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'),
				rep('b', '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'),
			]),
		];
		const out = collect(posts, { confiscate_reporters: true }, ['a'], true);
		expect([...out]).toEqual(['0x70997970c51812dc3a010c7d01b50e0d17dc79c8']);
	});

	test('ignores un-checked, missing, or malformed reporter addresses', () => {
		const posts = [
			post(null, [
				rep('a', '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'), // not checked
				rep('b', '0xgarbage'), // bad
				rep('c', null), // none
			]),
		];
		expect(collect(posts, { confiscate_reporters: true }, ['b', 'c'], true).size).toBe(0);
	});

	test('returns empty when no confiscation flag is set', () => {
		expect(collect([post('0x70997970c51812dc3a010c7d01b50e0d17dc79c8')], {}, [], false).size).toBe(0);
	});

});
