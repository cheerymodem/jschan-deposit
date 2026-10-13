'use strict';

//Exercise the deposit signing gate (gulp/res/js/depositgate.js). This is loaded
//into the frontend bundle before forms.js and decides, in a pure function,
//whether a post-actions submit must ask the wallet to sign for a report or for
//posting. The same module is also require()d here so the logic is unit-tested
//directly.
const depositGate = require('../../gulp/res/js/depositgate.js');

describe('deposit signing gate', () => {

	test('post form only signs when it is the real deposit post form', () => {
		expect(depositGate.requiresPostSign(true, true)).toBe(true);
		expect(depositGate.requiresPostSign(false, true)).toBe(false);
		expect(depositGate.requiresPostSign(true, false)).toBe(false);
	});

	test('report signing only happens on a deposit board page', () => {
		expect(depositGate.requiresReportSign(true, true, false)).toBe(true);
		expect(depositGate.requiresReportSign(true, false, true)).toBe(true);
		expect(depositGate.requiresReportSign(false, true, false)).toBe(false);
		expect(depositGate.requiresReportSign(true, false, false)).toBe(false);
	});

	test('delete-without-report does not trigger the wallet prompt (regression)', () => {
		//the exact scenario that broke before: an action form with a report box
		//unticked must not require a signature
		expect(depositGate.requiresReportSign(true, false, false)).toBe(false);
	});

});