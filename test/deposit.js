'use strict';

//Deposit end-to-end flows against a running instance: a local Hardhat network
//with the DamageDeposit contract deployed, the app on localhost, and a /test/
//board with requireDeposit on. Reads the same env the storage-walk test uses.
//Entire suite is skipped unless DEPOSIT_TEST_RPC/DEPOSIT_TEST_CONTRACT are set.
const fetch = require('node-fetch');
const FormData = require('form-data');

const rpc = process.env.DEPOSIT_TEST_RPC;
const contractAddress = process.env.DEPOSIT_TEST_CONTRACT;

const suite = (rpc && contractAddress) ? describe : describe.skip;

module.exports = () => suite('deposit-gated flows', () => {

	beforeAll(async () => {
		const res = await fetch('http://localhost/test/index.html');
		expect(res.status).toBe(200);
	});

	test('deposit board serves the postform with the deposit flag', async () => {
		const html = await fetch('http://localhost/test/index.html').then(r => r.text());
		expect(html).toContain('data-deposit-report="true"');
	});

	test('posting without a deposit signature is rejected', async () => {
		const form = new FormData();
		form.append('message', 'unsigned post attempt');
		const res = await fetch('http://localhost/forms/board/test/post', {
			method: 'POST',
			body: form,
			redirect: 'manual',
		});
		expect(res.status).toBe(400);
		const text = await res.text();
		expect(text).toContain('signature');
	});

	test('reporting with an unverified address is rejected', async () => {
		const params = new URLSearchParams();
		params.append('report', '1');
		params.append('checkedposts', '999');
		params.append('report_reason', 'spam');
		params.append('address', '0xNOTAVALIDWALLETADDRESS0000000000000000000000000000');
		params.append('nonce', 'not-a-nonce');
		params.append('signature', '0x000');
		const res = await fetch('http://localhost/forms/board/test/actions', {
			method: 'POST',
			body: params,
			redirect: 'manual',
		});
		expect(res.status).toBe(400);
	});

});