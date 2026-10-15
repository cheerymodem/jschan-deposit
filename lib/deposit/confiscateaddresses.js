'use strict';

//Collect the wallet addresses to confiscate for a moderation action. Deposit
//boards store a verified wallet address on the post author and, for reports, on
//each report. Returns a Set of lowercase addresses that actually carry a valid
//deposit address in the selected data. Pure so it can be unit tested.
module.exports = (posts, flags, checkedReports, globalConfiscate) => {

	const addresses = new Set();
	const confiscatePosts = !!(flags.confiscate_posts || flags.global_confiscate_posts);
	const confiscateReporters = !!(flags.confiscate_reporters || flags.global_confiscate_reporters);
	const checked = Array.isArray(checkedReports) ? checkedReports : [];

	for (const post of posts) {
		//confiscate the author of a reported post
		if (confiscatePosts && post.address && /^0x[a-f0-9]{40}$/.test(post.address)) {
			addresses.add(post.address.toLowerCase());
		}
		//confiscate the checked reporters of a reported post. When no specific
		//report ids are checked (e.g. the mod only selected the parent post),
		//confiscate every reporter address on the selected posts rather than
		//silently doing nothing.
		if (confiscateReporters) {
			const reports = globalConfiscate ? (post.globalreports || []) : (post.reports || []);
			for (const r of reports) {
				if (r && r.address && /^0x[a-f0-9]{40}$/.test(r.address)
					&& (checked.length === 0 || checked.includes(String(r.id)))) {
					addresses.add(r.address.toLowerCase());
				}
			}
		}
	}

	return addresses;
};
