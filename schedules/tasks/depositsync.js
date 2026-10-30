'use strict';

const depositsync = require(__dirname+'/../../lib/deposit/depositsync.js');

module.exports = {

	func: depositsync.func,
	interval: 5000,
	immediate: true,
	//no condition: the sync returns at once while the deposit system is disabled

};
