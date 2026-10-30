'use strict';

const cache = require(__dirname+'/../redis/redis.js')
	, dynamicResponse = require(__dirname+'/../misc/dynamic.js')
	, { Permissions } = require(__dirname+'/../permission/permissions.js')
	, config = require(__dirname+'/../misc/config.js');

//Fixed-window request counters in redis. The upstream captchas used to slow down
//these endpoints; with them gone, the deposit fork limits them directly.
//The key is created with its expiry before counting (INCR keeps the TTL), so a
//crash between the two can never leave a counter that blocks forever.
const hit = async (key, windowSeconds) => {
	await cache.redisClient.set(`ratelimit:${key}`, 0, 'EX', windowSeconds, 'NX');
	return cache.incr(`ratelimit:${key}`);
};

const bypasses = (res) => res.locals.permissions != null
	&& res.locals.permissions.get(Permissions.BYPASS_RATELIMITS) === true;

const tooOften = (req, res) => {
	const { __ } = res.locals;
	return dynamicResponse(req, res, 429, 'message', {
		'title': __('Ratelimited'),
		'error': __('You are doing that too often, please wait and try again'),
		'redirect': req.headers.referer || '/',
	});
};

//Route middleware limiting an action to max requests per window, counted per
//client IP and, when keyFn returns one, per extra key (e.g. the username being
//tried). Anonymizers share one IP cloak, so like upstream's quotas they skip the
//IP count (the extra key still applies); limit them further at the proxy.
const limit = (action, max, windowSeconds, keyFn=null) => async (req, res, next) => {
	if (bypasses(res)) {
		return next();
	}
	try {
		const keys = [];
		if (!res.locals.anonymizer && res.locals.ip) {
			keys.push(`${action}:ip:${res.locals.ip.cloak}`);
		}
		const extra = keyFn ? keyFn(req, res) : null;
		if (extra) {
			keys.push(`${action}:key:${String(extra).toLowerCase()}`);
		}
		for (const key of keys) {
			if ((await hit(key, windowSeconds)) > max) {
				return tooOften(req, res);
			}
		}
	} catch (err) {
		return next(err);
	}
	next();
};

//One post (or one post action) per flood window per wallet: upstream's
//anyContentSameIp timer, applied to the wallet so it holds across IPs. Call only
//after the signature is verified, so nobody can use up another wallet's quota.
//Returns true if the wallet is over the limit.
const walletFlood = async (res, kind, address) => {
	const { anyContentSameIp } = config.get.floodTimers;
	if (!anyContentSameIp || bypasses(res)) {
		return false;
	}
	return (await hit(`${kind}:wallet:${address}`, Math.ceil(anyContentSameIp / 1000))) > 1;
};

module.exports = {
	hit,
	limit,
	bypasses,
	walletFlood,
};
