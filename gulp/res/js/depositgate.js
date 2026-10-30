'use strict';

//Pure client-side gate for the deposit signing flows. Included in the frontend
//bundle (see gulpfile.js scripts order) and exercised directly by the unit
//tests so the decision logic can't silently regress. Exposed on the global
//object (window in a browser, globalThis in node tests).
const depositGate = {

	//the post form itself (the one with data-deposit-report="true") and no
	//other form on a deposit board asks the poster to sign the post message
	requiresPostSign: (isDepositPostForm, hasNonceField) => {
		return isDepositPostForm && hasNonceField;
	},

	//the post actions anyone can take from a board page; each submission that
	//selects one is signed with the deposit wallet (it replaces post passwords).
	//Must match lib/deposit/actions.js PUBLIC_ACTIONS.
	publicActions: ['delete', 'global_report', 'report', 'spoiler', 'unlink_file'],

	//an action form needs a wallet signature when it is a public board action form
	//(it carries the signing nonce field) and a public action is selected
	requiresActionSign: (publicActionForm, selectedActions) => {
		return publicActionForm && selectedActions.length > 0;
	},

	//the signed post actions message; must match lib/deposit/actions.js build()
	//(the unit tests compare the two)
	buildActionsMessage: ({ site, board, actions, posts, nonce }) => {
		const postIds = [...new Set(posts.map(Number))].sort((a, b) => a - b);
		return [
			'jschan-deposit actions',
			`Site: ${site}`,
			`Board: ${board}`,
			`Actions: ${[...actions].sort().join(',')}`,
			`Posts: ${postIds.join(',')}`,
			`Nonce: ${nonce}`,
		].join('\n');
	},

};

if (typeof module !== 'undefined' && module.exports) {
	module.exports = depositGate;
}
const hasWindow = typeof window !== 'undefined';
if (hasWindow) {
	window.depositGate = depositGate;
} else if (typeof globalThis !== 'undefined') {
	globalThis.depositGate = depositGate;
}