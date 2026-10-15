'use strict';

const Posts = require(__dirname+'/../../../db/posts.js');

module.exports = async (req, res, next) => {

	let threads;
	try {
		threads = await Posts.getCatalog(req.params.board);
	} catch (err) {
		return next(err);
	}

	//tombstoned threads may lack a files field in the raw projection; running the
	//public transform guarantees files: [] and structural fields for the template
	const publicThreads = threads.map(t => {
		t.replies = (t.replies || []).map(Posts.publicPost);
		return Posts.publicPost(t);
	});

	res
		//.set('Cache-Control', 'private, max-age=5')
		.render('catalog', {
			modview: true,
			threads: publicThreads,
			board: res.locals.board,
			csrf: req.csrfToken(),
		});

};
