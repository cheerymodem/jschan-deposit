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
		//keep the structural/thread fields the templates and JSON consumers need,
		//but drop all content and identity
		return {
			'_id': post._id,
			'board': post.board,
			'thread': post.thread,
			'postId': post.postId,
			'date': post.tombstone.date || post.date,
			'sticky': post.sticky,
			'replyposts': post.replyposts,
			'replyfiles': post.replyfiles,
			'backlinks': post.backlinks,
			'replies': post.replies,
			'files': [],
			'tombstone': post.tombstone,
		};
	}
	return post;
};
