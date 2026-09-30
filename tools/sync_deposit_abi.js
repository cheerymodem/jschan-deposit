#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const srcArg = process.argv[2] || path.join(__dirname, '..', '..', 'DamageDeposit',
	'artifacts', 'contracts', 'DamageDeposit.sol', 'DamageDeposit.json');
const dest = path.join(__dirname, '..', 'lib', 'deposit', 'abi.json');

const artifact = JSON.parse(fs.readFileSync(srcArg, 'utf8'));
fs.writeFileSync(dest, JSON.stringify(artifact.abi, null, '\t') + '\n');
console.log(`Wrote ABI to ${dest}`);