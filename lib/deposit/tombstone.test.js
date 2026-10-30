'use strict';

//tombstone.stripPosts unsets the sensitive/content fields and replaces the ip with
//a pruned-style value. We mock the posts/files collections and the build queue so
//no live DB or redis is needed. All state is held in the mock factory (prefixed
//"mock", so it is in scope for jest.mock) and exposed via the Posts mock.
const mockState = {
	updates: [],
	fixLatest: [],
	boards: null,
	modlogs: [],
	queued: [],
};

const mockPosts = {
	db: {
		updateOne: async (filter, update) => { mockState.updates.push({ filter, update }); },
		find: async () => ({ toArray: async () => [] }),
		bulkWrite: async () => {},
	},
	getThreadAggregates: async () => [],
	fixLatest: async (boards) => { mockState.fixLatest = boards; },
};
const mockFiles = { decrement: async () => {} };
const mockModlogs = {
	insertOne: async () => {},
	db: {
		find: (filter) => ({ toArray: async () => mockState.modlogs.filter(l => l.txHash === filter.txHash && l.message === null) }),
		updateMany: async (filter, update) => {
			mockState.modlogs.filter(l => l.txHash === filter.txHash && l.message === null)
				.forEach(l => Object.assign(l, update.$set));
		},
	},
};

jest.mock(__dirname+'/../../db/', () => ({
	Posts: mockPosts,
	Files: mockFiles,
	Modlogs: mockModlogs,
	Boards: {
		findOne: async () => mockState.boards,
	},
}));

jest.mock(__dirname+'/../misc/socketio.js', () => ({
	emitRoom: async () => {},
}));
jest.mock(__dirname+'/../build/queue.js', () => ({
	push: async (job) => { mockState.queued.push(job); },
}));
jest.mock(__dirname+'/../input/modlogactions.js', () => ({
	CONFISCATE_DEPOSIT: 'Confiscate deposit',
}));
jest.mock(__dirname+'/../../schedules/tasks/prune.js', () => ({
	func: async () => {},
}));
//config.get.debugLogs only; avoid pulling the real config/redis chain
jest.mock(__dirname+'/../misc/config.js', () => ({
	get: { pruneImmediately: true, debugLogs: false },
}));

const tombstone = require('./tombstone.js');

beforeEach(() => {
	mockState.updates.length = 0;
	mockState.fixLatest = [];
	mockState.boards = null;
	mockState.modlogs = [];
	mockState.queued = [];
});

describe('tombstone.stripPosts', () => {

	const makePost = () => ({
		_id: 'post1',
		board: 'b',
		thread: null,
		postId: 1,
		date: new Date(),
		message: 'content',
		signature: '0xsig',
		address: '0xpii_4a3f8d01-b2c4-4a9e-8f0a-3c6d7e8f9a0bpii_5b4e9f02-c3d5-4baf-9f1b-4d7e8f9a0b1cpii_6c5f0a03-d4e6-4cb0-9f2c-5e8f9a0b1c2d',
		files: [{ filename: 'abc' }],
		ip: { cloak: 'cloak', raw: 'raw', type: 'ipv4' },
	});

	test('sets tombstone with the reason and pruned ip, unsets content and identity', async () => {
		await tombstone.stripPosts([makePost()], 'moderator', null);
		const update = mockState.updates[0].update;
		expect(update.$set.tombstone.reason).toBe('moderator');
		expect(update.$set.tombstone.date).toBeInstanceOf(Date);
		expect(update.$set.ip.cloak.endsWith('.PRUNED')).toBe(true);
		expect(update.$unset.message).toBe('');
		expect(update.$unset.signature).toBe('');
		expect(update.$unset.address).toBe('');
		expect(update.$set.files).toEqual([]);
		expect(update.$set.reports).toEqual([]);
		expect(update.$unset.userId).toBe('');
		expect(update.$unset.password).toBe('');
		expect(update.$unset.salt).toBe('');
		expect('reports' in update.$unset).toBe(false);
		expect('globalreports' in update.$unset).toBe(false);
		expect(update.$unset.hidden).toBe('');
	});

	test('skips posts that are already tombstoned', async () => {
		const already = makePost();
		already.tombstone = { reason: 'withdrawn', date: new Date(), modlog: null };
		const stripped = await tombstone.stripPosts([already], 'moderator', null);
		expect(stripped).toBe(0);
		expect(mockState.updates.length).toBe(0);
	});
});

describe('tombstone.addConfiscationReason', () => {

	test('fills the reason on the listener-written logs for that tx and rebuilds them', async () => {
		mockState.modlogs = [
			{ txHash: '0xtx', board: 'a', message: null },
			{ txHash: '0xtx', board: 'b', message: null },
			{ txHash: '0xother', board: 'a', message: null },
		];
		const n = await tombstone.addConfiscationReason('0xtx', 'spam');
		expect(n).toBe(2);
		expect(mockState.modlogs.map(l => l.message)).toEqual(['spam', 'spam', null]);
		expect(mockState.queued.map(j => j.options.board._id).sort()).toEqual(['a', 'b']);
	});

	test('leaves logs that already have a message alone', async () => {
		mockState.modlogs = [{ txHash: '0xtx', board: 'a', message: 'staff reason' }];
		expect(await tombstone.addConfiscationReason('0xtx', 'other')).toBe(0);
		expect(mockState.modlogs[0].message).toBe('staff reason');
		expect(mockState.queued).toHaveLength(0);
	});

});
