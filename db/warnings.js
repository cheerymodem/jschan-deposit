'use strict';

const Mongo = require(__dirname+'/db.js')
	, db = Mongo.db.collection('warnings');

module.exports = {

	db,

	//all non-expired warnings for an address on a board (or global)
	findByAddress: (address, board) => {
		return db.find({
			'address': address.toLowerCase(),
			'board': {
				'$in': [board, null]
			},
			'expireAt': {
				'$gt': new Date(),
			},
		}).sort({ 'date': -1 }).toArray();
	},

	insertOne: (warning) => {
		return db.insertOne(warning);
	},

	insertMany: (warnings) => {
		return db.insertMany(warnings);
	},

	deleteAll: () => {
		return db.deleteMany({});
	},

};
