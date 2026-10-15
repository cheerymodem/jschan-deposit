'use strict';

const { Bans, Warnings } = require(__dirname+'/../../../db/')
	, dynamicResponse = require(__dirname+'/../../misc/dynamic.js')
	, { Permissions } = require(__dirname+'/../../permission/permissions.js');

module.exports = async (req, res, next) => {

	//bypass all bans, special permission
	if (res.locals.permissions.get(Permissions.BYPASS_BANS)) {
		return next();
	}

	//on deposit boards, ban by both wallet address (poster identity) and IP.
	//Address bans come from banning a poster on a deposit board; IP bans come
	//from report bans and global bans, which remain IP-keyed. Both must be
	//enforced so neither class of ban silently fails.
	const depositBanAddress = (res.locals.board && res.locals.board.settings.requireDeposit === true)
		? res.locals.depositAddress || (req.body.address ? String(req.body.address).toLowerCase() : null)
		: null;

	//fetch bans
	const banBoard = res.locals.board ? res.locals.board._id : null; //if no board, global bans or "null" board.
	let bans = await Bans.find(res.locals.ip, banBoard);
	if (depositBanAddress) {
		const addressBans = await Bans.findByAddress(depositBanAddress, banBoard);
		//dedupe on _id just in case a ban overlaps somehow
		const seen = new Set(bans.map(b => String(b._id)));
		for (const b of addressBans) {
			if (!seen.has(String(b._id))) {
				bans.push(b);
			}
		}
	}
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
		return dynamicResponse(req, res, 403, 'ban', {
			bans,
		});
	}

	//no active ban; surface pending warnings to the poster for notice (not a ban)
	if (depositBanAddress) {
		const warnings = await Warnings.findByAddress(depositBanAddress, banBoard);
		if (warnings && warnings.length > 0) {
			res.locals.warnings = warnings.map(w => ({
				board: w.board,
				reason: w.reason,
				date: w.date,
				issuer: w.showUser === true ? w.issuer : null,
			}));
		}
	}

	next(); //no bans found

};
