'use strict';

const config = require(__dirname+'/../lib/misc/config.js');

module.exports = class Schedule {

	constructor (func, interval, immediate, condition) {
		this.func = func;
		this.interval = interval;
		this.immediate = immediate;
		this.condition = condition;
		this.intervalId = null;
		this.update();
	}

	//start the schedule
	start () {
		if (!this.intervalId) {
			if (this.immediate) {
				this.func();
			}
			this.intervalId = setInterval(this.func, this.interval);
		}
	}

	//stop the schedule
	stop () {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	//check config and either start or stop
	update () {
		if (!this.condition || resolveDotProp(config.get, this.condition)) {
			this.start();
		} else {
			this.stop();
		}
	}

};

//config.get[path] does not resolve dotted keys like 'deposit.enabled'. Walk the
//object so a condition can reference a nested setting.
const resolveDotProp = (object, prop) => {
	return prop.split('.').reduce((acc, key) => {
		if (acc == null) {
			return acc;
		}
		return acc[key];
	}, object);
};
