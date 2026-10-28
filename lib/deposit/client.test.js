'use strict';

//The confirm endpoint matches receipt log topics against eventSignature(), so it
//must hash the full "Name(type,...)" signature, not the bare event name.
jest.mock(__dirname+'/../misc/config.js', () => ({
	get: { deposit: { enabled: true, rpcUrl: 'http://127.0.0.1:8545', contractAddress: '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9' } },
}));
jest.mock(__dirname+'/../redis/redis.js', () => ({
	addCallback: () => {},
}));

const client = require('./client.js');

describe('deposit client eventSignature', () => {

	test('hashes the full event signature from the ABI', () => {
		//keccak256('DepositConfiscated(address)')
		expect(client.eventSignature('DepositConfiscated'))
			.toBe('0x5994d0facb2afc918317f00ca6f00405e3adbe77f381d975a91a6752d51aa5ad');
	});

});
