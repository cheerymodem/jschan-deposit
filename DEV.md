# Development environment

Fork development happens on the host with current Node LTS, with MongoDB and Redis running via
Docker. The DamageDeposit contract runs on a local Hardhat node.

## Prerequisites

- Node.js current LTS (the upstream Docker image uses node:16, but web3 v4 needs newer)
- Docker (for MongoDB and Redis)
- pnpm (for the DamageDeposit repo, `../DamageDeposit`)

## Start local services

Start MongoDB and Redis:

```
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps
```

For local dev the compose file runs Mongo and Redis without authentication on their default
local ports (27017 and 6379).

## Start the DamageDeposit chain

In `../DamageDeposit`:

```
pnpm hardhat node
```

In a second terminal:

```
pnpm hardhat run scripts/setupLocal.js --network localhost
```

This deploys the ETH and ERC-20 variants (60 s withdraw period) and prints their addresses.
Chain id is `31337`. Account #0 is the owner.

## Set up jschan

Create `configs/secrets.js` from `configs/secrets.js.example`, pointing Mongo at a local
connection string and Redis at `localhost:6379`. The compose services run without auth, so
clear the example redis password and the mongo password accordingly.

Then:

```
npm install
npm run-script setup
npx gulp reset
npm run start
```

Gulp reset prints a generated admin password. Log in as `admin`.

## Enable deposit settings

Deposit is controlled by global settings under the web3 / deposit tab in the global management
panel. At minimum set:

- `deposit.enabled` to true
- `deposit.rpcUrl` to `http://localhost:8545`
- `deposit.chainId` to `31337`
- `deposit.contractAddress` to the ETH variant address printed by `setupLocal.js`
- `deposit.deployBlock` to the block the contract was deployed at

Then create a board and turn on its `requireDeposit` board setting.

## MetaMask setup

Add a custom network against `http://localhost:8545`, chain id `31337`, currency `ETH`.
Import the Hardhat mnemonic accounts (`test test test test test test test test test test test
junk`) so you can deposit from account #1 and confiscate from account #0 (the owner).

## Troubleshooting

- If `npx gulp reset` cannot reach the DB, check `configs/secrets.js` and that the compose
  services are up.
- If the local Hardhat chain was restarted, re-run `setupLocal.js` and update `deposit.deployBlock`
  and `deposit.contractAddress` in settings, then rebuild the deposit twin.
