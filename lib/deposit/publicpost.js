'use strict';

//Public (non-sensitive) post transform. Hidden posts (deposit withdrawing) are
//reduced to an exiting tombstone view so no content or identity leaks, and already
//tombstoned posts keep only their tombstone metadata. Pure/stateless so it can be
//unit tested without a live database.
module.exports = (post) => {
	if (!post) {
		return post;
	}
	if (post.hidden === true && !post.tombstone) {
		post.tombstone = {
			reason: 'exiting',
			date: post.date,
			modlog: null,
		};
		delete post.hidden;
	}
	if (post.tombstone) {
		return {
			'_id': post._id,
			'board': post.board,
			'thread': post.thread,
			'postId': post.postId,
			'date': post.tombstone.date || post.date,
			'tombstone': post.tombstone,
		};
	}
	return post;
};
