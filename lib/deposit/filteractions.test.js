'use strict';

//Word filter auto bans: a signed post bans the posting wallet (like manual bans,
//never appealable); anything unsigned (staff post edits) keeps upstream's IP ban.
const mockBans = { inserted: [] };
jest.mock(__dirname+'/../../db/', () => ({
	Bans: { insertOne: async (ban) => { mockBans.inserted.push(JSON.parse(JSON.stringify(ban))); return { insertedId: 'b1' }; } },
}));
jest.mock(__dirname+'/../misc/dynamic.js', () => jest.fn());
jest.mock(__dirname+'/../../configs/secrets.js', () => ({ ipHashSecret: 'test-secret' }));

const filterActions = require(__dirname+'/../post/filteractions.js');
const address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const filter = { filterMode: 2, filterBanDuration: 60000, filterBanAppealable: true, filterMessage: 'no' };
const res = (depositAddress) => ({
	locals: {
		__: s => s,
		board: { _id: 'b' },
		ip: { cloak: 'ipcloak', raw: '1.2.3.4', type: 0 },
		depositAddress,
	},
});

beforeEach(() => { mockBans.inserted = []; });

describe('word filter bans', () => {

	test('a signed post bans the wallet, not the IP, and is not appealable', async () => {
		await filterActions({}, res(address), false, 'bad', filter, '/b/');
		const ban = mockBans.inserted[0];
		expect(ban.address).toBe(address);
		expect(ban.ip.raw).toBe(address);
		expect(ban.ip.cloak.endsWith('.WALLET')).toBe(true);
		expect(JSON.stringify(ban)).not.toContain('1.2.3.4');
		expect(ban.allowAppeal).toBe(false);
	});

	test('an unsigned request keeps the upstream IP ban', async () => {
		await filterActions({}, res(undefined), false, 'bad', filter, '/b/');
		const ban = mockBans.inserted[0];
		expect(ban.address).toBeNull();
		expect(ban.ip).toEqual({ cloak: 'ipcloak', raw: '1.2.3.4', type: 0 });
		expect(ban.allowAppeal).toBe(true);
	});

});
