'use strict';

//Wallet bans must only be looked up for a wallet whose signature was verified.
//banCheck runs before any signature check, so it must ignore a submitted address;
//otherwise anyone could post an address and read back that wallet's bans.
const address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

const mockBans = {
	find: jest.fn(async () => []),
	findByAddress: jest.fn(async () => []),
	markSeen: jest.fn(async () => {}),
};
jest.mock(__dirname+'/../../db/', () => ({ Bans: mockBans, Warnings: { findByAddress: async () => [] } }));
jest.mock(__dirname+'/../misc/dynamic.js', () => jest.fn());

const dynamicResponse = require(__dirname+'/../misc/dynamic.js');
const banCheck = require(__dirname+'/../middleware/permission/bancheck.js');

const makeRes = () => ({
	locals: {
		ip: { cloak: 'cloak', raw: '1.2.3.4' },
		board: { _id: 'test' },
		permissions: { get: () => false },
	},
});

describe('banCheck', () => {

	beforeEach(() => jest.clearAllMocks());

	test('ignores an unverified address in the body', async () => {
		const next = jest.fn();
		await banCheck({ body: { address } }, makeRes(), next);
		expect(mockBans.findByAddress).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalled();
	});

	test('ban responses carry no raw IPs, addresses or signatures from preserved posts', async () => {
		mockBans.find.mockResolvedValueOnce([{
			_id: 'b1', board: 'test', seen: false, note: 'n', issuer: 'mod', showUser: false,
			ip: { cloak: 'cloak', raw: '1.2.3.4' },
			posts: [{ postId: 1, address, signature: '0xbeef', password: 'pw', ip: { cloak: 'c', raw: '1.2.3.4', type: 0 } }],
		}]);
		const next = jest.fn();
		await banCheck({ body: {} }, makeRes(), next);
		expect(next).not.toHaveBeenCalled();
		const sent = JSON.stringify(dynamicResponse.mock.calls[0][4]);
		expect(sent).not.toContain('1.2.3.4');
		expect(sent).not.toContain(address);
		expect(sent).not.toContain('0xbeef');
		expect(sent).not.toContain('"pw"');
		expect(sent).toContain('"cloak":"c"');
	});

});
