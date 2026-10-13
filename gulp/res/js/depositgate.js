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

	//a report only needs a wallet proof when the board is a deposit board and a
	//report (or global report) checkbox is actually checked
	requiresReportSign: (depositBoardPage, reportChecked, globalReportChecked) => {
		return depositBoardPage && (reportChecked || globalReportChecked);
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