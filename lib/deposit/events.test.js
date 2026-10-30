'use strict';

//In-memory fake of the deposits/depositsync collections and the tombstone helper,
//used to test the deposit event handlers in isolation. Shared across both jest.mock
//factories, so it is prefixed "mock" (allowed by the babel plugin).
const mockDb = {
	twins: new Map(),
	txs: new Map(),
	hidden: [],
	stripped: [],
	reasons: [],
	failConfiscate: false,
};

jest.mock(__dirname+'/../../db/', () => {
	return {
		Deposits: {
			findOne: async ({ _id }) => {
				const twin = mockDb.twins.get(_id);
				return twin ? { _id, ...twin } : null;
			},
			upsertActive: async (address, blockNumber) => {
				mockDb.twins.set(address, { status: 'active', withdrawAt: null, depositBlock: blockNumber, activatedAt: new Date(blockNumber * 1000) });
			},
			setWithdrawing: async (address, withdrawAt) => {
				mockDb.twins.set(address, { ...mockDb.twins.get(address), status: 'withdrawing', withdrawAt });
			},
			//mirrors db/deposits.js: an exit never deletes a newer deposit
			delete: async (address, exitBlock=null) => {
				const twin = mockDb.twins.get(address);
				if (twin && (exitBlock == null || twin.depositBlock <= exitBlock)) {
					mockDb.twins.delete(address);
				}
			},
		},
		DepositSync: {
			claimTx: async (txHash) => {
				const tx = mockDb.txs.get(txHash) || {};
				if (tx.state === 'done') {
					return 'done';
				}
				if (tx.state === 'claimed') {
					return 'busy';
				}
				mockDb.txs.set(txHash, { ...tx, state: 'claimed' });
				return 'won';
			},
			finishTx: async (txHash) => { mockDb.txs.get(txHash).state = 'done'; },
			setTxReason: async (txHash, reason) => { mockDb.txs.set(txHash, { ...mockDb.txs.get(txHash), reason }); },
			getTx: async (txHash) => mockDb.txs.get(txHash) || null,
		},
	};
});

jest.mock(__dirname+'/tombstone.js', () => {
	return {
		hidePostsFor: async (address, before) => { mockDb.hidden.push({ address, before }); return 1; },
		stripPostsFor: async (address, reason, ref, before) => { mockDb.stripped.push({ address, reason, before }); return 1; },
		confiscateFor: async (address, txHash, amount, reason, before) => {
			if (mockDb.failConfiscate) {
				throw new Error('mongo hiccup');
			}
			mockDb.stripped.push({ address, reason: 'confiscated', txHash, before });
			return 1;
		},
		addConfiscationReason: async (txHash, reason) => { mockDb.reasons.push({ txHash, reason }); return 1; },
	};
});

const events = require('./events.js');

beforeEach(() => {
	mockDb.twins.clear();
	mockDb.txs.clear();
	mockDb.hidden = [];
	mockDb.stripped = [];
	mockDb.reasons = [];
	mockDb.failConfiscate = false;
});

describe('deposit event handlers', () => {

	test('DepositMade upserts an active twin', async () => {
		await events.DepositMade('0xabcd', 10);
		const twin = mockDb.twins.get('0xabcd');
		expect(twin.status).toBe('active');
		expect(twin.depositBlock).toBe(10);
	});

	test('WithdrawalInitiated hides posts then marks the twin withdrawing', async () => {
		await events.DepositMade('0xabcd', 5);
		await events.WithdrawalInitiated('0xabcd', 1000, 10);
		expect(mockDb.hidden).toEqual([{ address: '0xabcd', before: null }]);
		const twin = mockDb.twins.get('0xabcd');
		expect(twin.status).toBe('withdrawing');
		expect(twin.withdrawAt).toEqual(new Date(1000000));
	});

	test('DepositWithdrawn strips posts with reason withdrawn and deletes the twin', async () => {
		await events.DepositMade('0xabcd', 10);
		await events.DepositWithdrawn('0xabcd', 20);
		expect(mockDb.stripped).toContainEqual({ address: '0xabcd', reason: 'withdrawn', before: null });
		expect(mockDb.twins.has('0xabcd')).toBe(false);
	});

	test('DepositConfiscated strips with reason confiscated, deletes the twin and finishes the tx', async () => {
		await events.DepositMade('0xabcd', 10);
		await events.DepositConfiscated('0xabcd', 20, '0xtx');
		expect(mockDb.stripped).toContainEqual({ address: '0xabcd', reason: 'confiscated', txHash: '0xtx', before: null });
		expect(mockDb.twins.has('0xabcd')).toBe(false);
		expect(mockDb.txs.get('0xtx').state).toBe('done');
	});

	test('a re-deposit after exit restores active', async () => {
		await events.DepositMade('0xabcd', 10);
		await events.DepositWithdrawn('0xabcd', 20);
		await events.DepositMade('0xabcd', 30);
		expect(mockDb.twins.get('0xabcd').status).toBe('active');
	});

	test('old exits applied after a re-deposit only touch the old deposit\'s posts (regression)', async () => {
		//deposit(10), initiate(11), withdraw(13), deposit(14), all in one poll: the
		//sync applies the grant at 14 before the restrictive events at 11 and 13
		await events.DepositMade('0xabcd', 14);
		const activatedAt = mockDb.twins.get('0xabcd').activatedAt;
		await events.WithdrawalInitiated('0xabcd', 1000, 11);
		await events.DepositWithdrawn('0xabcd', 13);
		const twin = mockDb.twins.get('0xabcd');
		expect(twin.status).toBe('active');
		expect(twin.depositBlock).toBe(14);
		expect(mockDb.hidden).toEqual([{ address: '0xabcd', before: activatedAt }]);
		expect(mockDb.stripped).toEqual([{ address: '0xabcd', reason: 'withdrawn', before: activatedAt }]);
	});

	test('a replayed old confiscation leaves a newer deposit alone (regression)', async () => {
		await events.DepositMade('0xabcd', 30);
		const activatedAt = mockDb.twins.get('0xabcd').activatedAt;
		const { status } = await events.confiscate('0xabcd', 20, '0xold', null, null);
		expect(status).toBe('won');
		expect(mockDb.twins.get('0xabcd').depositBlock).toBe(30);
		expect(mockDb.stripped).toEqual([{ address: '0xabcd', reason: 'confiscated', txHash: '0xold', before: activatedAt }]);
	});

	test('a failed confiscation is not marked done, so it can be retried (regression)', async () => {
		await events.DepositMade('0xabcd', 10);
		mockDb.failConfiscate = true;
		await expect(events.DepositConfiscated('0xabcd', 20, '0xtx')).rejects.toThrow('mongo hiccup');
		expect(mockDb.txs.get('0xtx').state).toBe('claimed');
		expect(mockDb.twins.has('0xabcd')).toBe(true);
	});

	test('the listener aborts its poll while another caller holds the claim', async () => {
		mockDb.txs.set('0xtx', { state: 'claimed' });
		await expect(events.DepositConfiscated('0xabcd', 20, '0xtx')).rejects.toThrow('in progress');
		expect(mockDb.stripped).toEqual([]);
	});

	test('a finished confiscation is skipped by the other caller, which still adds its reason', async () => {
		mockDb.txs.set('0xtx', { state: 'done' });
		const { status } = await events.confiscate('0xabcd', 20, '0xtx', null, 'spam');
		expect(status).toBe('done');
		expect(mockDb.stripped).toEqual([]);
		expect(mockDb.reasons).toEqual([{ txHash: '0xtx', reason: 'spam' }]);
	});

	test('a reason stored while the listener works is applied by the listener (regression)', async () => {
		await events.DepositMade('0xabcd', 10);
		//the confirm endpoint lost the claim and stored its reason before the
		//listener wrote the modlog
		mockDb.txs.set('0xtx', { reason: 'spam' });
		await events.DepositConfiscated('0xabcd', 20, '0xtx');
		expect(mockDb.reasons).toEqual([{ txHash: '0xtx', reason: 'spam' }]);
	});

});
