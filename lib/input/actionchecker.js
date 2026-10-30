'use strict';

const { Permissions } = require(__dirname+'/../permission/permissions.js')
	, actions = [
		{name:'unlink_file', global:true, owner:true, build:true},
		{name:'delete_file', global:true, auth:Permissions.MANAGE_GLOBAL_GENERAL, build:true},
		{name:'spoiler', global:true, owner:true, build:true},
		{name:'edit', global:true, auth:Permissions.MANAGE_BOARD_GENERAL, build:true},
		{name:'delete', global:true, owner:true, build:true},
		{name:'lock', global:false, auth:Permissions.MANAGE_BOARD_GENERAL, build:true},
		{name:'sticky', global:false, auth:Permissions.MANAGE_BOARD_GENERAL, build:true},
		{name:'cyclic', global:false, auth:Permissions.MANAGE_BOARD_GENERAL, build:true},
		{name:'bumplock', global:false, auth:Permissions.MANAGE_BOARD_GENERAL, build:true},
		{name:'report', global:false, build:false},
		{name:'global_report', global:true, build:false},
		{name:'move', global:false, auth:Permissions.MANAGE_BOARD_GENERAL, build:true},
		{name:'delete_ip_board', global:true, auth:Permissions.MANAGE_BOARD_GENERAL, build:true},
		{name:'delete_ip_thread', global:true, auth:Permissions.MANAGE_BOARD_GENERAL, build:true},
		{name:'delete_ip_global', global:true, auth:Permissions.MANAGE_GLOBAL_GENERAL, build:true},
		{name:'dismiss', global:false, auth:Permissions.MANAGE_BOARD_GENERAL, build:false},
		{name:'global_dismiss', global:true, auth:Permissions.MANAGE_GLOBAL_GENERAL, build:false},
		{name:'report_ban', global:false, auth:Permissions.MANAGE_BOARD_GENERAL, build:false},
		{name:'global_report_ban', global:true, auth:Permissions.MANAGE_GLOBAL_GENERAL, build:false},
		{name:'ban', global:false, auth:Permissions.MANAGE_BOARD_GENERAL, build:false},
		{name:'global_ban', global:true, auth:Permissions.MANAGE_GLOBAL_GENERAL, build:false},
		{name:'warn', global:false, auth:Permissions.MANAGE_BOARD_GENERAL, build:false},
		{name:'global_warn', global:true, auth:Permissions.MANAGE_GLOBAL_GENERAL, build:false},
	];

module.exports = (req, res) => {

	let numGlobal = 0
		, numOwner = 0
		, numBuild = 0
		, hasPermission = true
		, validActions = [];

	for (let i = 0; i < actions.length; i++) {
		const action = actions[i];
		const bodyAction = req.body[action.name];
		if (bodyAction != null) {
			validActions.push(action.name);
			if (action.global) {
				numGlobal++;
			}
			if (action.auth && !res.locals.permissions.get(action.auth)) {
				hasPermission = false;
				//maybe break;?
			}
			//actions a non-staff user may only take on their own (wallet-signed) posts
			if (action.owner) {
				numOwner++;
			}
			if (action.build) {
				numBuild++;
			}
		}
	}

	return { numGlobal, hasPermission, validActions, numOwner, numBuild };

};
