'use strict';

const { Bans, Warnings } = require(__dirname+'/../../../db/')
	, dynamicResponse = require(__dirname+'/../../misc/dynamic.js')
	, { Permissions } = require(__dirname+'/../../permission/permissions.js');

//respond with the ban page if any bans apply. Returns true if a response was sent.
const respondBans = async (req, res, bans) => {
	//board staff still bypass bans on their board by default
	if (res.locals.permissions.get(Permissions.MANAGE_BOARD_GENERAL)) {
		//filter bans to leave only global bans remaining
		bans = bans.filter(ban => ban.board !== res.locals.board);
	}
	if (bans && bans.length > 0) {
		const unseenBans = bans.filter(b => !b.seen).map(b => b._id);
		await Bans.markSeen(unseenBans); //mark bans as seen
		bans.forEach(ban => {
			ban.note = null;
			ban.ip.raw = null;
			ban.issuer = ban.showUser === true ? ban.issuer : null;
			ban.seen = true;
		});
		dynamicResponse(req, res, 403, 'ban', {
			bans,
		});
		return true;
	}
	return false;
};

//address bans and warnings for a verified deposit wallet. The post route parses
//its multipart body after banCheck runs, so the post controller calls this once
//the signature has been verified. Returns true if a ban response was sent.
const checkAddress = async (req, res, address) => {
	if (!address || res.locals.permissions.get(Permissions.BYPASS_BANS)) {
		return false;
	}
	const banBoard = res.locals.board ? res.locals.board._id : null;
	const addressBans = await Bans.findByAddress(address, banBoard);
	if (await respondBans(req, res, addressBans)) {
		return true;
	}
	//no active ban; surface pending warnings to the poster for notice (not a ban)
	const warnings = await Warnings.findByAddress(address, banBoard);
	if (warnings && warnings.length > 0) {
		res.locals.warnings = warnings.map(w => ({
			board: w.board,
			reason: w.reason,
			date: w.date,
			issuer: w.showUser === true ? w.issuer : null,
		}));
	}
	return false;
};

module.exports = async (req, res, next) => {

	//bypass all bans, special permission
	if (res.locals.permissions.get(Permissions.BYPASS_BANS)) {
		return next();
	}

	//fetch bans
	const banBoard = res.locals.board ? res.locals.board._id : null; //if no board, global bans or "null" board.
	const bans = await Bans.find(res.locals.ip, banBoard);
	if (await respondBans(req, res, bans)) {
		return;
	}

	//on deposit boards, also ban by wallet address. Only urlencoded forms (post
	//actions/reports) have a parsed body here; a submitted address must still
	//pass signature verification later, so it cannot be used to dodge a ban.
	const depositBanAddress = (res.locals.board && res.locals.board.settings.requireDeposit === true
		&& typeof req.body.address === 'string')
		? req.body.address.toLowerCase()
		: null;
	if (depositBanAddress && await checkAddress(req, res, depositBanAddress)) {
		return;
	}

	next(); //no bans found

};

module.exports.checkAddress = checkAddress;
