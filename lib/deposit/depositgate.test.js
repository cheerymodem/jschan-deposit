'use strict';

//Exercise the deposit signing gate (gulp/res/js/depositgate.js). This is loaded
//into the frontend bundle before forms.js and decides, in pure functions,
//whether a submit must ask the wallet to sign, and builds the signed post
//actions message. The same module is also require()d here so the logic is
//unit-tested directly.
const depositGate = require('../../gulp/res/js/depositgate.js');
const actions = require('./actions.js');

describe('deposit signing gate', () => {

	test('post form only signs when it is the real deposit post form', () => {
		expect(depositGate.requiresPostSign(true, true)).toBe(true);
		expect(depositGate.requiresPostSign(false, true)).toBe(false);
		expect(depositGate.requiresPostSign(true, false)).toBe(false);
	});

	test('action forms sign only when a public action is selected on a public action form', () => {
		expect(depositGate.requiresActionSign(true, ['report'])).toBe(true);
		expect(depositGate.requiresActionSign(true, ['delete'])).toBe(true);
		expect(depositGate.requiresActionSign(false, ['delete'])).toBe(false);
		expect(depositGate.requiresActionSign(true, [])).toBe(false);
	});

	test('the client knows the same public actions as the server', () => {
		expect(depositGate.publicActions).toEqual(actions.PUBLIC_ACTIONS);
	});

	test('the client builds the same actions message as the server', () => {
		const fields = { site: 'http://x', board: 'b', actions: ['spoiler', 'delete'], posts: ['10', '2', '2'], nonce: 'n' };
		expect(depositGate.buildActionsMessage(fields)).toBe(actions.build(fields));
	});

});
