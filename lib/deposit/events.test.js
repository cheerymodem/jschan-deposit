'use strict';

//In-memory fake of the deposits/depositsync collections and the tombstone helper,
//used to test the deposit event handlers in isolation. Shared across both jest.mock
//factories, so it is prefixed "mock" (allowed by the babel plugin).
const mockDb = {
	twins: new Map(),
	sync: null,
	hidden: [],
	stripped: [],
};

jest.mock(__dirname+'/../../db/', () => {
	return {
		Deposits: {
			upsertActive: async (address, blockNumber) => {
				mockDb.twins.set(address, { status: 'active', withdrawAt: null, depositBlock: blockNumber });
			},
			setWithdrawing: async (address, withdrawAt) => {
				mockDb.twins.set(address, { status: 'withdrawing', withdrawAt });
			},
			delete: async (address) => {
				mockDb.twins.delete(address);
			},
			find: async () => Array.from(mockDb.twins.entries()).map(([id, v]) => ({ _id: id, ...v })),
		},
		DepositSync: {
			get: async () => mockDb.sync,
			set: async (data) => { mockDb.sync = { ...mockDb.sync, ...data }; },
			hasProcessedTx: async () => false,
		},
	};
});

jest.mock(__dirname+'/tombstone.js', () => {
	return {
		hidePostsFor: async (address) => { mockDb.hidden.push(address); return 1; },
		stripPostsFor: async (address, reason) => { mockDb.stripped.push({ address, reason }); return 1; },
		confiscateFor: async (address, txHash) => { mockDb.stripped.push({ address, reason: 'confiscated', txHash }); return 1; },
		postsForAddress: async () => [],
		writeConfiscationModlog: async () => ({}),
	};
});

const events = require('./events.js');

beforeEach(() => {
	mockDb.twins.clear();
	mockDb.sync = null;
	mockDb.hidden = [];
	mockDb.stripped = [];
});

describe('deposit event handlers', () => {

	test('DepositMade upserts an active twin', async () => {
		await events.DepositMade('0xabcd', 10);
		const twin = mockDb.twins.get('0xabcd');
		expect(twin.status).toBe('active');
		expect(twin.depositBlock).toBe(10);
	});

	test('WithdrawalInitiated hides posts then marks the twin withdrawing', async () => {
		await events.WithdrawalInitiated('0xabcd', 1000, 10);
		expect(mockDb.hidden).toContain('0xabcd');
		const twin = mockDb.twins.get('0xabcd');
		expect(twin.status).toBe('withdrawing');
		expect(twin.withdrawAt).toEqual(new Date(1000000));
	});

	test('DepositWithdrawn strips posts with reason withdrawn and deletes the twin', async () => {
		await events.DepositMade('0xabcd', 10);
		await events.DepositWithdrawn('0xabcd', 20);
		expect(mockDb.stripped).toContainEqual({ address: '0xabcd', reason: 'withdrawn' });
		expect(mockDb.twins.has('0xabcd')).toBe(false);
	});

	test('DepositConfiscated strips with reason confiscated and deletes the twin', async () => {
		await events.DepositMade('0xabcd', 10);
		await events.DepositConfiscated('0xabcd', 20, '0xtx');
		expect(mockDb.stripped).toContainEqual({ address: '0xabcd', reason: 'confiscated', txHash: '0xtx' });
		expect(mockDb.twins.has('0xabcd')).toBe(false);
	});

	test('a re-deposit after exit restores active', async () => {
		await events.DepositMade('0xabcd', 10);
		await events.DepositWithdrawn('0xabcd', 20);
		await events.DepositMade('0xabcd', 30);
		expect(mockDb.twins.get('0xabcd').status).toBe('active');
		//tombstoned posts stay stripped; only the twin being active again enables posting
	});
});
