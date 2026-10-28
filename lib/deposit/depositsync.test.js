'use strict';

//Test the deposit sync polling loop: the two cursors (grant waits for
//confirmations, restrictive applies immediately), event application, verification
//and checkpoint persistence. All the db / client / tombstone dependencies are
//mocked. State is held in the mock factory (prefixed "mock" so it is in scope for
//jest.mock).
const mockState = {
	enabled: true,
	deposit: {
		deployBlock: 2,
		confirmations: 1,
	},
	head: 5,
	syncDoc: null,
	twins: new Map(),
	hidden: [],
	events: [],
	applied: [],
	getLogCalls: [],
	withdrawingCalls: [],
	verifyInterval: 999999999,
	chain: new Map(),
};

jest.mock(__dirname+'/../../db/', () => {
	const array = () => ({
		toArray: async () => Array.from(mockState.twins.entries()).map(([id, v]) => ({ _id: id, ...v })),
	});
	return {
		Deposits: {
			find: async () => ({
				...array(),
				sort: () => array(),
			}),
			upsertActive: async (address, blockNumber) => {
				//mirror the real implementation: do not resurrect a withdrawing twin
				const existing = mockState.twins.get(address);
				if (existing && existing.status === 'withdrawing') {
					return;
				}
				mockState.twins.set(address, { _id: address, status: 'active', depositBlock: blockNumber });
			},
			setWithdrawing: async (address, withdrawAt, lastEventBlock) => {
				mockState.withdrawingCalls.push({ address, withdrawAt, lastEventBlock });
				mockState.twins.set(address, { _id: address, status: 'withdrawing', withdrawAt });
			},
			delete: async (address) => { mockState.twins.delete(address); },
		},
		DepositSync: {
			get: async () => mockState.syncDoc,
			set: async (data) => { mockState.syncDoc = { ...mockState.syncDoc, ...data }; },
			claimTx: async () => true,
		},
	};
});

jest.mock(__dirname+'/../../lib/deposit/client.js', () => ({
	isEnabled: () => mockState.enabled,
	getLatestBlockNumber: async () => mockState.head,
	getLogs: async (from, to, eventNames) => {
		mockState.getLogCalls.push({ from, to, eventNames });
		return mockState.events.filter(e => eventNames.includes(e.event)
			&& Number(e.blockNumber) >= from && Number(e.blockNumber) <= to);
	},
	walkAccounts: async () => mockState.walk || [],
	//chain state for checkDeposit; keys absent from the map hold an active deposit
	checkDeposit: async (address) => {
		const c = mockState.chain.get(address);
		return c ? { 0: c.present, 1: BigInt(c.withdrawTimestamp) } : { 0: true, 1: 0n };
	},
	getLagSeconds: async () => 0,
}));

jest.mock(__dirname+'/../../lib/deposit/events.js', () => {
	const m = {
		DepositMade: async (address, blockNumber) => {
			mockState.applied.push({ event: 'DepositMade', address, rest: [blockNumber] });
			mockState.twins.set(address, { _id: address, status: 'active', depositBlock: blockNumber });
		},
		WithdrawalInitiated: async (address, withdrawalTime, blockNumber) => {
			mockState.applied.push({ event: 'WithdrawalInitiated', address, rest: [withdrawalTime, blockNumber] });
			mockState.hidden.push(address);
			mockState.twins.set(address, { _id: address, status: 'withdrawing', withdrawAt: new Date(withdrawalTime * 1000) });
		},
		DepositWithdrawn: async (address, blockNumber) => {
			mockState.applied.push({ event: 'DepositWithdrawn', address, rest: [blockNumber] });
			mockState.twins.delete(address);
		},
		DepositConfiscated: async (address, blockNumber, txHash) => {
			mockState.applied.push({ event: 'DepositConfiscated', address, rest: [blockNumber, txHash] });
			mockState.twins.delete(address);
		},
	};
	return m;
});

jest.mock(__dirname+'/../../lib/deposit/tombstone.js', () => ({
	hidePostsFor: async (address) => { mockState.hidden.push(address); },
	stripPostsFor: async () => 1,
}));

jest.mock(__dirname+'/../misc/config.js', () => ({
	//read the deposit config lazily so beforeEach reassignments are seen by the SUT
	get: { get deposit() { return mockState.deposit; }, debugLogs: false },
}));

const ds = require('./depositsync.js');

beforeEach(() => {
	mockState.enabled = true;
	mockState.deposit = { deployBlock: 2, confirmations: 1, verifyInterval: 1000 };
	mockState.head = 5;
	mockState.syncDoc = null;
	mockState.twins.clear();
	mockState.hidden = [];
	mockState.events = [];
	mockState.applied = [];
	mockState.getLogCalls = [];
	mockState.withdrawingCalls = [];
	mockState.walk = null;
	mockState.chain = new Map();
});

const mkEvent = (event, blockNumber, account, extra = {}) => ({
	event,
	blockNumber,
	transactionHash: '0xtx',
	returnValues: { account, ...extra },
});

//force the periodic storage-walk verification to run on the next poll
const forceVerifyDue = () => {
	mockState.syncDoc = { lastVerifyAt: new Date(Date.now() - 60000) };
};

describe('deposit sync polling loop', () => {

	test('DepositMade is held until it reaches head - confirmations', async () => {
		//deposit at block 5, head 5, confirmations 1: grant cursor reaches 4, so it is not applied
		mockState.events = [ mkEvent('DepositMade', 5, '0xaaa') ];
		await ds.func();
		expect(mockState.applied.filter(a => a.event === 'DepositMade')).toHaveLength(0);
		expect(mockState.twins.has('0xaaa')).toBe(false);
	});

	test('DepositMade applies once it is confirmed', async () => {
		mockState.events = [ mkEvent('DepositMade', 4, '0xaaa') ];
		//the confirmed deposit is present on chain, so the walk includes it
		mockState.walk = [{ address: '0xaaa', withdrawTimestamp: 0 }];
		await ds.func();
		expect(mockState.applied).toContainEqual(expect.objectContaining({ event: 'DepositMade', address: '0xaaa' }));
		expect(mockState.twins.has('0xaaa')).toBe(true);
	});

	test('restrictive events apply immediately even at head', async () => {
		mockState.events = [
			mkEvent('DepositMade', 3, '0xaaa'),
			mkEvent('WithdrawalInitiated', 5, '0xaaa', { withdrawalTime: '1000000' }),
		];
		//the key still holds a deposit on chain, marked withdrawing when first deposited
		mockState.walk = [{ address: '0xaaa', withdrawTimestamp: 12345 }];
		await ds.func();
		expect(mockState.applied).toContainEqual(expect.objectContaining({ event: 'WithdrawalInitiated', address: '0xaaa' }));
		expect(mockState.hidden).toContain('0xaaa');
	});

	test('reprocessing is idempotent across repeated polls (cursors advance)', async () => {
		mockState.events = [
			mkEvent('DepositMade', 3, '0xaaa'),
			mkEvent('DepositMade', 4, '0xbbb'),
		];
		mockState.walk = [
			{ address: '0xaaa', withdrawTimestamp: 0 },
			{ address: '0xbbb', withdrawTimestamp: 0 },
		];
		await ds.func();
		const callsAfterFirst = mockState.getLogCalls.filter(c => c.eventNames[0] === 'DepositMade').length;
		await ds.func();
		const appliedGrants = mockState.applied.filter(a => a.event === 'DepositMade');
		expect(appliedGrants).toHaveLength(2);
		//no new deposit range is fetched on the second poll because the cursor advanced
		const grantCallsSecond = mockState.getLogCalls.filter(c => c.eventNames[0] === 'DepositMade').length - callsAfterFirst;
		expect(grantCallsSecond).toBe(0);
	});

	test('a lagging DepositMade does not resurrect a key that already exited', async () => {
		//deposit at 4 and confiscation at 5: the restrictive pass sees the
		//confiscation first, then the grant cursor reaches the deposit next poll
		mockState.events = [
			mkEvent('DepositMade', 4, '0xaaa'),
			mkEvent('DepositConfiscated', 5, '0xaaa'),
		];
		mockState.deposit.confirmations = 2;
		mockState.chain.set('0xaaa', { present: false, withdrawTimestamp: 0 });
		await ds.func();
		mockState.head = 6;
		await ds.func();
		expect(mockState.applied.filter(a => a.event === 'DepositMade')).toHaveLength(0);
		expect(mockState.twins.has('0xaaa')).toBe(false);
	});

	test('events in the deploy block itself are processed', async () => {
		mockState.events = [ mkEvent('DepositMade', 2, '0xaaa') ];
		mockState.walk = [{ address: '0xaaa', withdrawTimestamp: 0 }];
		await ds.func();
		expect(mockState.twins.has('0xaaa')).toBe(true);
	});

	test('overlapping polls do not run concurrently', async () => {
		mockState.events = [ mkEvent('DepositMade', 3, '0xaaa') ];
		await Promise.all([ds.func(), ds.func()]);
		expect(mockState.applied.filter(a => a.event === 'DepositMade')).toHaveLength(1);
	});

	test('checkpoint is persisted with advanced cursors', async () => {
		mockState.events = [ mkEvent('DepositMade', 4, '0xaaa') ];
		mockState.walk = [{ address: '0xaaa', withdrawTimestamp: 0 }];
		await ds.func();
		expect(mockState.syncDoc.lastBlockGrant).toBe(4);
		expect(mockState.syncDoc.lastBlockRestrictive).toBe(5);
	});

	test('walk verification corrects a twin that diverged', async () => {
		//twin says active, but the walk says the key withdrew (withdrawTimestamp nonzero)
		mockState.twins.set('0xaaa', { _id: '0xaaa', status: 'active', depositBlock: 3 });
		mockState.walk = [{ address: '0xaaa', withdrawTimestamp: 12345 }];
		forceVerifyDue();
		await ds.func();
		const twin = mockState.twins.get('0xaaa');
		expect(twin.status).toBe('withdrawing');
		expect(twin.withdrawAt.getTime()).toBe(12345000);
	});

	test('walk verification removes a stale twin absent from the walk', async () => {
		//a twin not present on chain (withdrawn/confiscated) must be cleaned up
		mockState.twins.set('0xaaa', { _id: '0xaaa', status: 'active', depositBlock: 3 });
		mockState.walk = [];
		forceVerifyDue();
		await ds.func();
		expect(mockState.twins.has('0xaaa')).toBe(false);
	});

});
