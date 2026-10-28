'use strict';

const { Permissions } = require(__dirname+'/../../lib/permission/permissions.js')
	, dynamicResponse = require(__dirname+'/../../lib/misc/dynamic.js')
	, registerAccount = require(__dirname+'/../../models/forms/register.js')
	, paramConverter = require(__dirname+'/../../lib/middleware/input/paramconverter.js')
	, config = require(__dirname+'/../../lib/misc/config.js')
	, { timingSafeEqual } = require('crypto')
	, { alphaNumericRegex, checkSchema, lengthBody, existsBody } = require(__dirname+'/../../lib/input/schema.js')
	, cache = require(__dirname+'/../../lib/redis/redis.js')
	, { recover: web3EthAccountsRecover } = require('web3-eth-accounts')
	, { isAddress: web3UtilsIsAddress } = require('web3-utils')
	, { Accounts, Deposits } = require(__dirname+'/../../db/')
	, walletKey = require(__dirname+'/../../lib/deposit/walletkey.js')
	, registerMessage = require(__dirname+'/../../lib/deposit/register.js');

//registering needs a wallet with an active deposit (it replaces the captcha, and
//accounts can create boards). Password registrations sign a username-bound
//message; web3 registrations already proved control of their address. Each wallet
//registers one account, tracked by a keyed hash (res.locals.walletKey) rather than
//the address. Returns an error message, or null if the wallet may register.
const checkRegisterDeposit = async (req, res) => {
	const { __ } = res.locals;
	if (config.get.deposit.enabled !== true) {
		return __('Registration is unavailable while the deposit system is disabled');
	}
	let address;
	if (res.locals.isWeb3) {
		address = req.body.address.toLowerCase();
	} else {
		address = String(req.body.deposit_address || '').toLowerCase();
		const nonce = String(req.body.deposit_nonce || '');
		const signature = String(req.body.deposit_signature || '');
		if (!/^0x[a-f0-9]{40}$/.test(address) || !nonce || !signature) {
			return __('A wallet deposit signature is required to register');
		}
		if ((await cache.del(`nonce:${address}:${nonce}`)) !== 1) {
			return __('Invalid or expired signature nonce. Refresh the page and try again');
		}
		let recovered;
		try {
			recovered = (await registerMessage.verify({ site: config.get.meta.url, username: req.body.username, nonce, signature })).toLowerCase();
		} catch (e) {
			return __('Failed to verify message signature');
		}
		if (recovered !== address) {
			return __('Failed to verify message signature');
		}
	}
	const twin = await Deposits.findOne({ _id: address });
	if (!twin || twin.status !== 'active') {
		return __('No active deposit found for this wallet');
	}
	res.locals.walletKey = walletKey(address);
	if (await Accounts.walletKeyExists(res.locals.walletKey)) {
		return __('This wallet is already linked to an account');
	}
	return null;
};

module.exports = {

	paramConverter: paramConverter({
		trimFields: ['username', 'password', 'passwordconfirm', 'nonce', 'signature', 'address', 'deposit_nonce', 'deposit_signature', 'deposit_address'],
	}),

	controller: async (req, res, next) => {

		const { __ } = res.locals;
		const { enableWeb3 } = config.get;
		res.locals.isWeb3 = req.body.address && req.body.address.length > 0;

		let errors = [];

		if (res.locals.isWeb3) {
			errors = await checkSchema([
				{ result: res.locals.permissions.get(Permissions.CREATE_ACCOUNT), blocking: true, expected: true, error: __('No permission') },
				{ result: enableWeb3 === true, expected: true, error: __('Web3 logins disabled') },
				{ result: web3UtilsIsAddress(req.body.address), expected: true, error: __('Invalid address') },
				{ result: existsBody(req.body.nonce), expected: true, error: __('Missing nonce') },
				{ result: existsBody(req.body.signature), expected: true, error: __('Missing signature') },
			]);
		} else {
			errors = await checkSchema([
				{ result: res.locals.permissions.get(Permissions.CREATE_ACCOUNT), blocking: true, expected: true, error: __('No permission') },
				{ result: existsBody(req.body.username), expected: true, error: __('Missing username') },
				{ result: lengthBody(req.body.username, 0, 50), expected: false, error: __('Username must be 50 characters or less') },
				{ result: lengthBody(req.body.username), expected: false, error: __('Username must be 50 characters or less') },
				{ result: alphaNumericRegex.test(req.body.username), expected: true, error: __('Username must contain a-z 0-9 only') },
				{ result: web3UtilsIsAddress(req.body.username), expected: false, error: __('Username must not be an ethereum address') },
				{ result: existsBody(req.body.password), expected: true, error: __('Missing password') },
				{ result: lengthBody(req.body.password, 0, 50), expected: false, error: __('Password must be 50 characters or less') },
				{ result: existsBody(req.body.passwordconfirm), expected: true, error: __('Missing password confirmation') },
				{ result: lengthBody(req.body.passwordconfirm, 0, 100), expected: false, error: __('Password confirmation must be 100 characters or less') },
				{ result: (req.body.password === req.body.passwordconfirm), expected: true, error: __('Password and password confirmation must match') },
			], res.locals.permissions);
		}

		if (errors.length > 0) {
			return dynamicResponse(req, res, 400, 'message', {
				'title': __('Bad request'),
				'errors': errors,
				'redirect': '/register.html'
			});
		}

		try {
			if (res.locals.isWeb3) {
				const { address, nonce, signature } = req.body;
				const nonceRequest = await cache.del(`nonce:${address}:${nonce}`);
				if (!nonceRequest || nonceRequest !== 1) {
					return dynamicResponse(req, res, 400, 'message', {
						'title': __('Bad Request'),
						'error': __('Login timed out'),
						'redirect': '/login.html'
					});
				}
				let recoveredAddress = (await web3EthAccountsRecover(`Nonce: ${nonce}`, signature)).toLowerCase();
				const match = await timingSafeEqual(Buffer.from(recoveredAddress), Buffer.from(address));
				if (match !== true) {
					return dynamicResponse(req, res, 400, 'message', {
						'title': __('Bad Request'),
						'error': __('Invalid login signature'),
						'redirect': '/login.html'
					});
				}
			}
			const depositError = await checkRegisterDeposit(req, res);
			if (depositError) {
				return dynamicResponse(req, res, 400, 'message', {
					'title': __('Bad Request'),
					'error': depositError,
					'redirect': '/register.html'
				});
			}
			await registerAccount(req, res, next);
		} catch (err) {
			return next(err);
		}

	}

};
