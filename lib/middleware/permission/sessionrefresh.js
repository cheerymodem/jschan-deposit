'use strict';

const { Accounts } = require(__dirname+'/../../../db/')
	, { DAY } = require(__dirname+'/../../converter/timeutils.js')
	, cache = require(__dirname+'/../../redis/redis.js')
	, config = require(__dirname+'/../../misc/config.js')
	, isWalletUsername = (username) => /^0x[a-f0-9]{40}$/.test(username || '');

module.exports = async (req, res, next) => {
	if (!res.locals) {
		res.locals = {};
	}
	if (req.session && req.session.user) {
		res.locals.user = await cache.get(`users:${req.session.user}`);
		if (!res.locals.user) {
			const account = await Accounts.findOne(req.session.user);
			if (!account) {
				req.session.destroy();
			} else {
				await Accounts.updateLastActiveDate(req.session.user);
				res.locals.user = {
					'username': account._id,
					'permissions': account.permissions.toString('base64'),
					'staffBoards': account.staffBoards,
					'ownedBoards': account.ownedBoards,
					/* For security, only storing a boolean used for checks,
						we dont need/want to store the twofactor secret in session */
					'twofactor': account.twofactor != null,
				};
				req.session.expires = new Date(Date.now() + (3 * DAY));
				cache.set(`users:${req.session.user}`, res.locals.user, 3600);
			}
		}
		//web3 accounts are named by their wallet address (registration refuses
		//address-shaped usernames otherwise), so they always act with their name
		//hidden: public modlogs, ban issuers, warnings and post edit markers all
		//read hide_name. Bodies are parsed (urlencoded) before this runs.
		if (res.locals.user && isWalletUsername(res.locals.user.username) && req.body) {
			req.body.hide_name = '1';
		}
		const { forceAccountTwofactor } = config.get;
		//Note: not /forms/twofactor because req.path doesnt contain the mount point when called from a middleware
		if (!['/twofactor.html', '/twofactor'].includes(req.path)
			&& forceAccountTwofactor === true
			&& res.locals.user
			&& !res.locals.user.twofactor) {
			return res.redirect('/twofactor.html');
		}
	}
	next();
};
