'use strict';

const { Bans } = require(__dirname+'/../../db/')
	, Socketio = require(__dirname+'/../../lib/misc/socketio.js')
	, config = require(__dirname+'/../../lib/misc/config.js')
	, addressBanIp = require(__dirname+'/../../lib/deposit/addressip.js');

module.exports = async (req, res) => {

	const { __, __n } = res.locals;
	const { defaultBanDuration } = config.get;
	const banDate = new Date();
	const banExpiry = new Date(banDate.getTime() + (req.body.ban_duration || defaultBanDuration)); //uses config default if missing or malformed
	const banReason = req.body.ban_reason || req.body.log_message || __('No reason specified');
	const allowAppeal = (req.body.no_appeal || req.body.ban_q || req.body.ban_h) ? false : true; //dont allow appeals for range bans

	const bans = [];

	if (req.body.ban || req.body.global_ban) {
		const banBoard = req.body.global_ban ? [null, req.params.board] : req.params.board;
		//posts signed with a deposit wallet are banned by that address (the
		//poster's identity); unsigned posts (staff modposts) fall back to the IP
		const ipPosts = res.locals.posts.reduce((acc, post) => {
			const key = post.address ? `address:${post.address.toLowerCase()}` : `ip:${post.ip.cloak}`;
			if (!acc[key]) {
				acc[key] = [];
			}
			acc[key].push(post);
			if (req.body.ban_reason) {
				//send banmessage over websocket
				Socketio.emitRoom(`${post.board}-${post.thread || post.postId}`, 'markPost', {
					postId: post.postId,
					type: 'banmessage',
					banmessage: req.body.ban_reason,
				});
			}
			return acc;
		}, {});
		for (let key in ipPosts) {
			//should we at some point filter these to not bother banning pruned ips?
			const thisIpPosts = ipPosts[key];
			const thisPost = thisIpPosts[0];
			const banAddress = thisPost.address ? thisPost.address.toLowerCase() : null;
			let banRange = 0;
			let banIp = banAddress
				? addressBanIp(banAddress)
				: {
					cloak: thisPost.ip.cloak,
					raw: thisPost.ip.raw,
					type: thisPost.ip.type,
				};
			//ranges only make sense for IP bans
			if (!banAddress) {
				if (req.body.ban_h) {
					banRange = 2;
					banIp.cloak = thisPost.ip.cloak
						.split('.')
						.slice(0,1)
						.join('.');
				} else if (req.body.ban_q) {
					banRange = 1;
					banIp.cloak = thisPost.ip.cloak
						.split('.')
						.slice(0,2)
						.join('.');
				}
			}
			bans.push({
				'global': req.body.global_ban != null,
				'range': banRange,
				'ip': banIp,
				'address': banAddress,
				'reason': banReason,
				'board': banBoard,
				'posts': req.body.preserve_post ? thisIpPosts : null,
				'issuer': req.session.user,
				'date': banDate,
				'expireAt': banExpiry,
				//wallet bans are final, never appealable
				'allowAppeal': banAddress ? false : allowAppeal,
				'appeal': null,
				'showUser': !req.body.hide_name,
				'note': null,
				'seen': false,
			});
		}
	}

	if (req.body.report_ban || req.body.global_report_ban) {
		const banBoard = req.body.global_report_ban ? [null, req.params.board] : req.params.board;
		//reporters who signed with a deposit wallet are banned by that address,
		//older unsigned reports by IP like upstream
		res.locals.posts.forEach(post => {
			let reports = [];
			if (req.body.report_ban) {
				reports = reports.concat(post.reports);
			}
			if (req.body.global_report_ban) {
				reports = reports.concat(post.globalreports);
			}
			const targets = {};
			reports.filter(r => r && req.body.checkedreports.includes(r.id.toString()))
				.forEach(r => {
					if (r.address) {
						targets[`address:${r.address.toLowerCase()}`] = { ip: addressBanIp(r.address), address: r.address.toLowerCase() };
					} else if (r.ip) {
						targets[`ip:${r.ip.cloak}`] = { ip: r.ip, address: null };
					}
				});
			Object.values(targets).forEach(target => {
				bans.push({
					'global': req.body.global_report_ban != null,
					'range': 0,
					'ip': target.ip,
					'address': target.address,
					'reason': banReason,
					'board': banBoard,
					'posts': null,
					'issuer': req.session.user,
					'date': banDate,
					'expireAt': banExpiry,
					'allowAppeal': target.address ? false : allowAppeal,
					'appeal': null,
					'showUser': !req.body.hide_name,
					'note': null,
					'seen': false
				});
			});
		});
	}

	const numBans = await Bans.insertMany(bans).then(result => result.insertedCount);

	const query = {
		message: __n('Added %s bans', numBans),
	};

	if ((req.body.ban || req.body.global_ban ) && req.body.ban_reason) {
		res.locals.actions.numBuild++;//there was a ban reason, so we may need to rebuild some pages, since banning is usually not a building action
		query['action'] = '$set';
		query['query'] = {
			'banmessage': req.body.ban_reason
		};
	}

	return query;

};
