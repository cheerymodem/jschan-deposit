'use strict';

const { Deposits, DepositSync, Posts } = require(__dirname+'/../../../db/')
	, { Permissions } = require(__dirname+'/../../../lib/permission/permissions.js')
	, config = require(__dirname+'/../../../lib/misc/config.js');

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
			Deposits.find({}).sort({ withdrawAt: 1 }),
			DepositSync.get(),
			postAggregates(),
		]);
	} catch (err) {
		return next(err);
	}

	const mask = (address) => showAddress ? address : address.substring(0, 8);

	const exiting = allKeys.filter(k => k.status === 'withdrawing');
	const withStats = (k) => ({
		...k,
		id: mask(k._id),
		stats: agg[k._id] || { posts: 0, hidden: 0, lastPost: null },
		address: k._id,
	});

	const data = {
		showAddress,
		viewRawIp,
		allKeys: allKeys.map(withStats),
		exiting: exiting.map(withStats),
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
