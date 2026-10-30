'use strict';

const { ObjectId } = require(__dirname+'/../../db/db.js');

module.exports = (req, res) => {

	const { __n } = res.locals;

	const report = {
		'id': ObjectId(),
		'reason': req.body.report_reason,
		'date': new Date(),
		'ip': {
			'cloak': res.locals.ip.cloak,
			'raw': res.locals.ip.raw,
			'type': res.locals.ip.type,
		}
	};

	//bind the report to the verified, active wallet address that signed it, so
	//staff can confiscate spam reports
	if (res.locals.actionAddress) {
		report.address = res.locals.actionAddress;
	}

	const ret = {
		message: __n('Reported %s posts', res.locals.posts.length),
		action: '$push',
		query: {}
	};
	const query = {
		'$each': [report],
		'$slice': -5 //limit number of  reports
	};
	if (req.body.global_report) {
		ret.query['globalreports'] = query;
	}
	if (req.body.report) {
		ret.query['reports'] = query;
	}

	return ret;

};
