'use strict';

//The Deposits page twin rows are keyed by wallet address, so staff without
//VIEW_RAW_IP must get rows (HTML and JSON) with no address anywhere in them.
const address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

jest.mock(__dirname+'/../../configs/secrets.js', () => ({ ipHashSecret: 'test-secret' }));
jest.mock(__dirname+'/../misc/config.js', () => ({ get: { deposit: { enabled: true } } }));
jest.mock(__dirname+'/../../db/', () => ({
	Deposits: { find: async () => ({ sort: () => ({ toArray: async () => [
		{ _id: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', status: 'withdrawing', withdrawAt: new Date('2026-10-30T10:17:23.000Z'), depositBlock: 24 },
		//deposit order, as the twin collection returns it
		...['0x1', '0x2', '0x3', '0x4', '0x5'].map(id => ({ _id: id.padEnd(42, '0'), status: 'active', withdrawAt: null })),
	] }) }) },
	DepositSync: { get: async () => ({ lastBlockGrant: 1 }) },
	Posts: { db: { aggregate: () => ({ toArray: async () => [
		{ _id: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', posts: 2, hidden: 0, lastPost: new Date() },
	] }) } },
}));

const { Permissions } = require('../permission/permissions.js');
const deposits = require('../../models/pages/globalmanage/deposits.js');

const run = (perms, path) => new Promise((resolve, reject) => {
	const req = { path, csrfToken: () => 'csrf' };
	const res = {
		locals: { permissions: { get: (p) => perms.includes(p) } },
		json: resolve,
		render: (view, data) => resolve(data),
	};
	deposits(req, res, reject);
});

describe('global manage deposits page', () => {

	test('staff without VIEW_RAW_IP get a keyed tag and no address', async () => {
		for (const path of ['/globalmanage/deposits.html', '/globalmanage/deposits.json']) {
			const data = await run([Permissions.MANAGE_GLOBAL_BANS], path);
			const out = JSON.stringify(data);
			expect(out).not.toContain(address.slice(2, 10));
			expect(data.allKeys[0].address).toBeNull();
			expect(data.allKeys[0].id).toMatch(/^[a-f0-9]{10}$/);
			expect(data.exiting[0].stats.posts).toBe(2);
		}
	});

	test('staff without VIEW_RAW_IP get hour-rounded times and rows not in deposit order', async () => {
		const data = await run([Permissions.MANAGE_GLOBAL_BANS], '/globalmanage/deposits.html');
		expect(data.exiting[0].withdrawAt).toEqual(new Date('2026-10-30T11:00:00.000Z'));
		const active = data.allKeys.filter(r => r.status === 'active').map(r => r.id);
		expect(active).toEqual([...active].sort());
	});

	test('staff with VIEW_RAW_IP get the address', async () => {
		const data = await run([Permissions.MANAGE_GLOBAL_BANS, Permissions.VIEW_RAW_IP], '/globalmanage/deposits.json');
		expect(data.allKeys[0].address).toBe(address);
		expect(data.allKeys[0].id).toBe(address);
		expect(data.allKeys[0].withdrawAt).toEqual(new Date('2026-10-30T10:17:23.000Z'));
	});

});
