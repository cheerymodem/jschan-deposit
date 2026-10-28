'use strict';

const Posts = require(__dirname+'/../../../db/posts.js')
	, { Permissions } = require(__dirname+'/../../../lib/permission/permissions.js')
	, omitAddress = require(__dirname+'/../../../lib/deposit/omitaddress.js');

module.exports = async (req, res, next) => {

	let thread;
	try {
		thread = await Posts.getThread(res.locals.board._id, res.locals.thread.postId, true);
		if (!thread) {
			return next(); //deleted between exists
		}
		//wallet addresses are only for staff who can see raw IPs
		if (!res.locals.permissions.get(Permissions.VIEW_RAW_IP)) {
			thread = { ...omitAddress(thread), replies: (thread.replies || []).map(omitAddress) };
		}
	} catch (err) {
		return next(err);
	}

	res
		.set('Cache-Control', 'private, max-age=5')
		.render('thread', {
			modview: true,
			upLevel: true,
			board: res.locals.board,
			thread,
			csrf: req.csrfToken(),
			permissions: res.locals.permissions,
		});

};
