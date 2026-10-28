'use strict';

const { Bypass } = require(__dirname+'/../../../db/')
	, { ObjectId } = require(__dirname+'/../../../db/db.js')
	, config = require(__dirname+'/../../misc/config.js')
	, deleteTempFiles = require(__dirname+'/../../file/deletetempfiles.js')
	, dynamicResponse = require(__dirname+'/../../misc/dynamic.js')
	, production = process.env.NODE_ENV === 'production'
	, { Permissions } = require(__dirname+'/../../permission/permissions.js');

module.exports = {

	check: async (req, res, next) => {

		const { __, locale } = res.locals;
		const { secureCookies, blockBypass } = config.get;

		//bypass captcha permission
		if (res.locals.permissions &&
			res.locals.permissions.get(Permissions.BYPASS_CAPTCHA)) {
			res.locals.solvedCaptcha = true;
		}

		//check if blockbypass exists and right length
		const bypassId = req.signedCookies.bypassid;
		if (!res.locals.solvedCaptcha && (!bypassId || bypassId.length !== 24)) {
			deleteTempFiles(req).catch(console.error);
			return dynamicResponse(req, res, 403, 'message', {
				'title': __('Forbidden'),
				'message': __('Please complete a block bypass to continue'),
				'frame': `/bypass_minimal.html?language=${encodeURIComponent(locale)}`,
				'link': {
					'href': '/bypass.html',
					'text': __('Get block bypass'),
				},
			});
		}

		//try to get bypass from db
		let bypass;
		if (bypassId && bypassId.length === 24) {
			try {
				const bypassMongoId = ObjectId(bypassId);
				bypass = await Bypass.checkBypass(bypassMongoId, res.locals.anonymizer);
			} catch (err) {
				return next(err);
			}
		}

		//next if they have a valid bypass
		if (bypass != null) {
			res.locals.blockBypass = true;				
			return next();
		}

		if (res.locals.solvedCaptcha) {
			//they dont have a valid bypass, but just solved board captcha, so give them a new one
			const newBypass = await Bypass.getBypass(res.locals.anonymizer, res.locals.pseudoIp, blockBypass.expireAfterUses);
			const newBypassId = newBypass.upsertedId || newBypass.insertedId || res.locals.pseudoIp;
			res.locals.blockBypass = true;
			res.cookie('bypassid', newBypassId.toString(), {
				'maxAge': blockBypass.expireAfterTime,
				'secure': production && secureCookies && (req.headers['x-forwarded-proto'] === 'https'),
				'sameSite': 'strict',
				'signed': true
			});
			return next();
		}

		deleteTempFiles(req).catch(console.error);
		res.clearCookie('bypassid');
		return dynamicResponse(req, res, 403, 'message', {
			'title': __('Forbidden'),
			'message': __('Block bypass expired or exceeded max uses'),
			'frame': `/bypass_minimal.html?language=${encodeURIComponent(locale)}`,
			'link': {
				'href': '/bypass.html',
				'text': __('Get block bypass'),
			},
		});

	},

	//block bypasses are captcha-based, and deposits gate posting instead, so the
	//check is never enforced. Anonymizers still get the dummy cookie so they keep
	//the same ip/userId for the session.
	middleware: async (req, res, next) => {
		const { blockBypass, secureCookies } = config.get;
		if (res.locals.anonymizer) {
			res.cookie('bypassid', res.locals.pseudoIp, {
				'maxAge': blockBypass.expireAfterTime,
				'secure': production && secureCookies && (req.headers['x-forwarded-proto'] === 'https'),
				'sameSite': 'strict',
				'signed': true
			});
		}
		return next();
	},

};
