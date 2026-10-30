'use strict';

const { Deposits, DepositSync, Posts } = require(__dirname+'/../../../db/')
	, { Permissions } = require(__dirname+'/../../../lib/permission/permissions.js')
	, config = require(__dirname+'/../../../lib/misc/config.js')
	, keyTag = require(__dirname+'/../../../lib/deposit/keytag.js')
	, { HOUR } = require(__dirname+'/../../../lib/converter/timeutils.js');

//aggregate post counts per address
const postAggregates = async () => {
	const rows = await Posts.db.aggregate([
		{
			'$match': {
				'address': { '$exists': true },
			}
		}, {
			'$group': {
				'_id': '$address',
				'posts': { '$sum': 1 },
				'hidden': { '$sum': { '$cond': [{ '$eq': ['$hidden', true] }, 1, 0] } },
				'lastPost': { '$max': '$date' },
			}
		}
	]).toArray();
	const map = {};
	for (const row of rows) {
		map[row._id] = {
			posts: row.posts,
			hidden: row.hidden,
			lastPost: row.lastPost,
		};
	}
	return map;
};

module.exports = async (req, res, next) => {

	const showAddress = res.locals.permissions.get(Permissions.VIEW_RAW_IP);
	const viewRawIp = showAddress;

	let allKeys, sync, agg;
	try {
		[ allKeys, sync, agg ] = await Promise.all([
			(await Deposits.find({})).sort({ withdrawAt: 1 }).toArray(),
			DepositSync.get(),
			postAggregates(),
		]);
	} catch (err) {
		return next(err);
	}

	//the twin _id is the wallet address, so rows are built field by field and only
	//carry it (as address) for staff with VIEW_RAW_IP. For other staff, exact
	//withdrawal times and the row order (deposit order) could be matched against the
	//public chain events, so times are rounded up to the hour and rows sorted by
	//time, then tag.
	const roundUpToHour = (date) => date ? new Date(Math.ceil(date.getTime() / HOUR) * HOUR) : date;
	const withStats = (k) => ({
		id: showAddress ? k._id : keyTag(k._id),
		address: showAddress ? k._id : null,
		status: k.status,
		withdrawAt: showAddress ? k.withdrawAt : roundUpToHour(k.withdrawAt),
		stats: agg[k._id] || { posts: 0, hidden: 0, lastPost: null },
	});
	let rows = allKeys.map(withStats);
	if (!showAddress) {
		const time = (r) => r.withdrawAt ? r.withdrawAt.getTime() : Infinity;
		rows = rows.sort((a, b) => (time(a) - time(b)) || a.id.localeCompare(b.id));
	}
	const exiting = rows.filter(r => r.status === 'withdrawing');

	const data = {
		showAddress,
		viewRawIp,
		allKeys: rows,
		exiting,
		sync,
		deposit: config.get && config.get.deposit ? config.get.deposit : null,
	};

	if (req.path.endsWith('.json')) {
		return res.json({
			exiting: data.exiting,
			allKeys: data.allKeys,
			sync,
		});
	}

	res.render('globalmanagedeposits', {
		...data,
		csrf: req.csrfToken ? req.csrfToken() : null,
	});

};
