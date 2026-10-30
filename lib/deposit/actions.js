'use strict';

const { recover: web3EthAccountsRecover } = require('web3-eth-accounts');

//the post actions anyone can take from a board page. Reports need an active
//deposit; delete, spoiler and unlink act only on the signing wallet's own posts.
const PUBLIC_ACTIONS = ['delete', 'global_report', 'report', 'spoiler', 'unlink_file'];
const OWNER_ACTIONS = ['delete', 'spoiler', 'unlink_file'];

//the public actions selected in a submitted body (unchecked boxes are absent)
const selected = (body) => PUBLIC_ACTIONS.filter(a => body[a] != null);

//Post-actions signed message, replacing post passwords. Distinct from the post,
//register and login messages so a signature cannot be reused across them. Binds
//the site, board, the selected actions and the selected posts, so the wallet shows
//exactly what is being authorised.
const build = ({ site, board, actions, posts, nonce }) => {
	const postIds = [...new Set((posts || []).map(Number))].sort((a, b) => a - b);
	return [
		'jschan-deposit actions',
		`Site: ${site}`,
		`Board: ${board}`,
		`Actions: ${[...actions].sort().join(',')}`,
		`Posts: ${postIds.join(',')}`,
		`Nonce: ${nonce}`,
	].join('\n');
};

const verify = async ({ signature, ...fields }) => {
	return web3EthAccountsRecover(build(fields), signature);
};

module.exports = {
	PUBLIC_ACTIONS,
	OWNER_ACTIONS,
	selected,
	build,
	verify,
};
