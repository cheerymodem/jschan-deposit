'use strict';

const { createHash, randomBytes } = require('crypto')
	, { Posts, Files, Boards, Modlogs } = require(__dirname+'/../../db/')
	, Socketio = require(__dirname+'/../misc/socketio.js')
	, config = require(__dirname+'/../misc/config.js')
	, buildQueue = require(__dirname+'/../build/queue.js')
	, ModlogActions = require(__dirname+'/../input/modlogactions.js')
	, addressIp = require(__dirname+'/addressip.js')
	, { func: pruneFiles } = require(__dirname+'/../../schedules/tasks/prune.js');

const tempIpHashSecret = randomBytes(32).toString('base64');

//produce a pruned-style random raw ip/cloak so code that reads `ip.cloak` keeps working
//after we strip a post's identity, mirroring schedules/tasks/ips.js

const prunedIp = (cloak) => {
	const randomIP = createHash('sha256').update(tempIpHashSecret + cloak).digest('base64');
	return {
		raw: `${randomIP.slice(-10)}.PRUNED`,
		cloak: `${randomIP.slice(-10)}.PRUNED`,
	};
};

//recalculate each affected thread's reply/file counts after files are stripped
const recalcThreadAggregates = async (board, threadPostIds) => {
	const ors = threadPostIds.map(thread => ({ board, thread }));
	const aggregates = await Posts.getThreadAggregates(ors);
	const bulkWrites = [];
	for (const thread of ors) {
		const agg = aggregates.find(a => a._id.thread === thread.thread && a._id.board === thread.board);
		if (agg) {
			bulkWrites.push({
				'updateOne': {
					'filter': {
						'board': thread.board,
						'postId': thread.thread,
					},
					'update': {
						'$set': {
							'replyposts': agg.replyposts,
							'replyfiles': agg.replyfiles,
						}
					}
				}
			});
		} else {
			bulkWrites.push({
				'updateOne': {
					'filter': {
						'board': thread.board,
						'postId': thread.thread,
					},
					'update': {
						'$set': {
							'replyposts': 0,
							'replyfiles': 0,
						}
					}
				}
			});
		}
	}
	if (bulkWrites.length > 0) {
		await Posts.db.bulkWrite(bulkWrites);
	}
};

const parseDate = (d) => {
	const month = ('0' + (d.getMonth() + 1)).slice(-2);
	const day = ('0' + d.getDate()).slice(-2);
	return `${month}-${day}-${d.getFullYear()}`;
};

module.exports = {

	//mark every visible, non-tombstoned post by this address as hidden, and tell
	//live clients + queue rebuilds for the affected boards/threads. Already hidden
	//posts are skipped: the sync re-runs this every poll for withdrawing keys.
	//before (optional) limits it to posts older than a newer deposit.
	hidePostsFor: async (address, before=null) => {
		const query = module.exports.addressQuery(address, before);
		query['tombstone'] = { '$exists': false };
		query['hidden'] = { '$ne': true };
		const posts = await Posts.db.find(query).toArray();
		if (posts.length === 0) {
			return 0;
		}

		const boardThreads = {};
		for (const post of posts) {
			boardThreads[post.board] = boardThreads[post.board] || new Set();
			boardThreads[post.board].add(post.thread || post.postId);
		}

		await Posts.db.updateMany({
			'_id': { '$in': posts.map(p => p._id) },
		}, {
			'$set': { 'hidden': true },
		});

		for (const post of posts) {
			Socketio.emitRoom(`${post.board}-${post.thread || post.postId}`, 'markPost', { postId: post.postId, type: 'hidden' });
		}

		await module.exports.queueRebuilds(boardThreads);
		return posts.length;
	},

	//strip a set of posts to tombstones and prune their files
	stripPosts: async (posts, reason, modlogRef=null) => {
		const { pruneImmediately } = config.get;
		const boardThreads = {};
		const filesToPrune = [];

		for (const post of posts) {
			if (post.tombstone) {
				continue;
			}
			boardThreads[post.board] = boardThreads[post.board] || new Set();
			boardThreads[post.board].add(post.thread || post.postId);

			if (post.files && post.files.length > 0) {
				post.files.forEach(f => filesToPrune.push(f));
			}

			//a per-post modlog ref (from confiscateFor) overrides the common one
			const ref = modlogRef != null ? modlogRef : (post.tombstoneModlogRef || null);

			//unset identity fields, then replace the IP with a pruned-style value so
			//code that reads `ip.cloak` keeps working
			const pruned = prunedIp(post.ip ? post.ip.cloak : 'anon');
			await Posts.db.updateOne({
				'_id': post._id,
			}, {
				'$set': {
					'tombstone': {
						'reason': reason,
						'date': new Date(),
						'modlog': ref,
					},
					'ip': pruned,
					//reports hold reporter addresses and raw IPs. Empty arrays, not
					//unset: templates and dismiss code read .length
					'reports': [],
					'globalreports': [],
				},
				'$unset': {
					'message': '',
					'nomarkup': '',
					'subject': '',
					'name': '',
					'tripcode': '',
					'capcode': '',
					'email': '',
					'files': '',
					'signature': '',
					'address': '',
					'password': '',
					'salt': '',
					'hidden': '',
					'tombstoneModlogRef': '',
					//user ids and flags link a poster's posts
					'userId': '',
					'country': '',
				},
			});

			Socketio.emitRoom(`${post.board}-${post.thread || post.postId}`, 'markPost', { postId: post.postId, type: 'tombstone' });
		}

		const stripped = posts.filter(p => !p.tombstone);
		if (stripped.length > 0) {
			const fileNames = filesToPrune.map(f => f.filename);
			if (fileNames.length > 0) {
				await Files.decrement(fileNames);
				if (pruneImmediately) {
					await pruneFiles(fileNames);
				}
			}

			//recalculate reply/file counts on affected threads
			for (const board of Object.keys(boardThreads)) {
				await recalcThreadAggregates(board, [...boardThreads[board]]);
				await Posts.fixLatest([board]);
			}
		}

		await module.exports.queueRebuilds(boardThreads);
		return stripped.length;
	},

	//strip all posts by an address and delete its twin doc
	stripPostsFor: async (address, reason, modlogRef=null, before=null) => {
		const posts = await Posts.db.find(module.exports.addressQuery(address, before)).toArray();
		return module.exports.stripPosts(posts, reason, modlogRef);
	},

	//posts by an address, optionally only those made before a date (the posts of
	//an older deposit, when the wallet has since deposited again)
	addressQuery: (address, before=null) => {
		const query = { 'address': address.toLowerCase() };
		if (before) {
			query['date'] = { '$lt': before };
		}
		return query;
	},

	//fetch all posts by an address (used to build a confiscation modlog)
	postsForAddress: async (address, before=null) => {
		return Posts.db.find(module.exports.addressQuery(address, before)).toArray();
	},

	//queue rebuilds of affected thread pages, board pages and catalogs
	queueRebuilds: async (boardThreads) => {
		for (const boardId of Object.keys(boardThreads)) {
			const board = await Boards.findOne(boardId);
			if (!board) {
				continue;
			}
			for (const thread of boardThreads[boardId]) {
				buildQueue.push({
					'task': 'buildThread',
					'options': { 'board': board, 'threadId': thread },
				});
			}
			buildQueue.push({
				'task': 'buildBoardMultiple',
				'options': { 'board': board, 'startpage': 1, 'endpage': 1 },
			});
			buildQueue.push({
				'task': 'buildCatalog',
				'options': { 'board': board },
			});
		}
	},

	//write a public modlog entry per affected board for a confiscation, and return
	//a per-board ref ({ board, date }) suitable for storing on the tombstones
	writeConfiscationModlog: async (address, posts, txHash, amount, reason) => {
		const boards = [...new Set(posts.map(p => p.board))];
		const logDate = new Date();
		const refs = {};
		for (const boardId of boards) {
			const modlog = {
				board: boardId,
				showLinks: true,
				postLinks: posts.filter(p => p.board === boardId).map(p => ({ board: p.board, postId: p.postId })),
				actions: [ModlogActions.CONFISCATE_DEPOSIT],
				public: true,
				date: logDate,
				showUser: false,
				message: reason || null,
				user: null,
				//keyed cloak; board staff without VIEW_RAW_IP see the cloak
				ip: addressIp(address),
				txHash,
				amount,
			};
			await Modlogs.insertOne(modlog);
			refs[boardId] = { board: boardId, date: parseDate(logDate) };
			//buildModLog/buildModLogList read options.board._id, so pass a board
			//object rather than the bare id string
			const board = { '_id': boardId, 'settings': {} };
			buildQueue.push({
				'task': 'buildModLog',
				'options': {
					'board': board,
					'day': parseDate(logDate),
				},
			});
			buildQueue.push({
				'task': 'buildModLogList',
				'options': {
					'board': board,
				},
			});
		}
		return refs;
	},

	//set the staff reason on the confiscation modlog entries for a tx that the
	//listener already processed (it has no reason), then rebuild those logs.
	//Entries that already carry a message are left alone.
	addConfiscationReason: async (txHash, reason) => {
		const logs = await Modlogs.db.find({ txHash, 'message': null }).toArray();
		if (logs.length === 0) {
			return 0;
		}
		await Modlogs.db.updateMany({ txHash, 'message': null }, { '$set': { 'message': reason } });
		//buildModLog rebuilds today's log, which is when the listener wrote these
		//entries (dates do not survive the queue's JSON serialisation)
		for (const boardId of new Set(logs.map(l => l.board))) {
			buildQueue.push({
				'task': 'buildModLog',
				'options': {
					'board': { '_id': boardId, 'settings': {} },
				},
			});
		}
		return logs.length;
	},

	//full confiscation flow shared by the event listener and the confirm endpoint:
	//strip posts first, then write one public modlog per affected board with the
	//modlog ref. Stripping before logging means a crash cannot leave a public
	//"confiscated" log entry whose posts are not yet stripped; a re-run is
	//idempotent (already-tombstoned posts strip nothing and write no new log).
	confiscateFor: async (address, txHash, amount, reason, before=null) => {
		const posts = await module.exports.postsForAddress(address, before);
		const unstripped = posts.filter(p => !p.tombstone);
		if (unstripped.length === 0) {
			return 0;
		}
		const stripped = await module.exports.stripPosts(unstripped, 'confiscated', null);
		//write the public modlog after stripping and link each fresh tombstone to
		//the modlog ref for its board
		const refs = await module.exports.writeConfiscationModlog(address, posts, txHash, amount, reason);
		for (const post of unstripped) {
			if (!refs[post.board]) {
				continue;
			}
			await Posts.db.updateOne({
				'_id': post._id,
				'tombstone.reason': 'confiscated',
			}, {
				'$set': { 'tombstone.modlog': refs[post.board] },
			});
		}
		return stripped;
	},

};
