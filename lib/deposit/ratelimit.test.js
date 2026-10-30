'use strict';

//The fork's rate limits replace the upstream captchas on login, change password,
//board creation and the nonce endpoint, and limit posts/actions per wallet.
const mockRedis = { store: new Map() };
jest.mock(__dirname+'/../redis/redis.js', () => ({
	redisClient: {
		set: async (key, value, ex, ttl, nx) => {
			if (nx === 'NX' && mockRedis.store.has(key)) {
				return null;
			}
			mockRedis.store.set(key, { value: Number(value), ttl });
			return 'OK';
		},
	},
	incr: async (key) => {
		const entry = mockRedis.store.get(key) || { value: 0, ttl: null };
		entry.value++;
		mockRedis.store.set(key, entry);
		return entry.value;
	},
}));
jest.mock(__dirname+'/../misc/dynamic.js', () => jest.fn());
jest.mock(__dirname+'/../misc/config.js', () => ({ get: { floodTimers: { anyContentSameIp: 5000 } } }));

const dynamicResponse = require(__dirname+'/../misc/dynamic.js');
const ratelimit = require('./ratelimit.js');

const res = (cloak, { anonymizer=false, bypass=false }={}) => ({
	locals: { __: s => s, ip: { cloak }, anonymizer, permissions: { get: () => bypass } },
});
const run = async (mw, req, r) => {
	let passed = false;
	await mw(req, r, () => { passed = true; });
	return passed;
};

beforeEach(() => {
	mockRedis.store.clear();
	dynamicResponse.mockClear();
});

describe('deposit fork rate limits', () => {

	test('counters are created with their expiry', async () => {
		await ratelimit.hit('x', 60);
		expect(mockRedis.store.get('ratelimit:x')).toEqual({ value: 1, ttl: 60 });
		await ratelimit.hit('x', 60);
		expect(mockRedis.store.get('ratelimit:x')).toEqual({ value: 2, ttl: 60 });
	});

	test('limits per IP and responds 429 over the limit', async () => {
		const mw = ratelimit.limit('login', 2, 300);
		expect(await run(mw, {}, res('a'))).toBe(true);
		expect(await run(mw, {}, res('a'))).toBe(true);
		expect(await run(mw, { headers: {} }, res('a'))).toBe(false);
		expect(dynamicResponse.mock.calls[0][2]).toBe(429);
		expect(await run(mw, {}, res('b'))).toBe(true);
	});

	test('the extra key (username) limits across IPs, case-insensitively', async () => {
		const mw = ratelimit.limit('login', 2, 300, req => req.body.username);
		expect(await run(mw, { body: { username: 'Admin' } }, res('a'))).toBe(true);
		expect(await run(mw, { body: { username: 'admin' } }, res('b'))).toBe(true);
		expect(await run(mw, { body: { username: 'ADMIN' }, headers: {} }, res('c'))).toBe(false);
	});

	test('anonymizers skip the shared IP count but not the extra key', async () => {
		const mw = ratelimit.limit('login', 1, 300, req => req.body.username);
		expect(await run(mw, { body: { username: 'u1' } }, res('tor', { anonymizer: true }))).toBe(true);
		expect(await run(mw, { body: { username: 'u2' } }, res('tor', { anonymizer: true }))).toBe(true);
		expect(await run(mw, { body: { username: 'u2' }, headers: {} }, res('tor', { anonymizer: true }))).toBe(false);
	});

	test('BYPASS_RATELIMITS skips the limit', async () => {
		const mw = ratelimit.limit('create', 1, 60);
		for (let i = 0; i < 3; i++) {
			expect(await run(mw, {}, res('a', { bypass: true }))).toBe(true);
		}
	});

	test('one post per flood window per wallet', async () => {
		expect(await ratelimit.walletFlood(res('a'), 'post', '0xw')).toBe(false);
		expect(await ratelimit.walletFlood(res('b'), 'post', '0xw')).toBe(true);
		expect(mockRedis.store.get('ratelimit:post:wallet:0xw').ttl).toBe(5);
		expect(await ratelimit.walletFlood(res('a'), 'actions', '0xw')).toBe(false);
	});

});
