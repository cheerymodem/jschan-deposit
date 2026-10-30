'use strict';

//web3 accounts are named by their wallet address, so their name must never
//appear publicly: sessionRefresh forces hide_name on every request they make.
const mockCache = { user: null };
jest.mock(__dirname+'/../../db/', () => ({ Accounts: {} }));
jest.mock(__dirname+'/../redis/redis.js', () => ({ get: async () => mockCache.user, set: () => {} }));
jest.mock(__dirname+'/../misc/config.js', () => ({ get: { forceAccountTwofactor: false } }));

const sessionRefresh = require(__dirname+'/../middleware/permission/sessionrefresh.js');

const run = async (username, body) => {
	mockCache.user = { username, twofactor: true };
	const req = { session: { user: username }, body, path: '/forms/board/b/modactions' };
	await new Promise(resolve => sessionRefresh(req, { locals: {} }, resolve));
	return req.body;
};

describe('sessionRefresh name hiding', () => {

	test('web3 accounts always act with their name hidden', async () => {
		const body = await run('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', { ban: '1' });
		expect(body.hide_name).toBe('1');
	});

	test('password accounts keep their choice', async () => {
		expect((await run('alice', { ban: '1' })).hide_name).toBeUndefined();
		expect((await run('alice', { ban: '1', hide_name: '1' })).hide_name).toBe('1');
	});

});
