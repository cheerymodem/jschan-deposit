'use strict';

const depositsync = require(__dirname+'/depositsync.js');

module.exports = {

	func: depositsync.func,
	interval: 5000,
	immediate: true,
	condition: 'deposit.enabled',

};
