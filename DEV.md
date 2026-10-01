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
npm run start-dev
```

Gulp reset prints a generated admin password. Log in as `admin`.

Note: use `npm run start-dev` (NODE_ENV != production) when running without nginx, because
Express only serves the static CSS/JS/files itself in non-production mode. In production
mode nginx is expected to serve `static/`.

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

## Manual end-to-end checklist

Prereqs live: compose services up, Hardhat node + `setupLocal.js` running, jschan running, a
deposit-requiring board created, `deposit.*` settings set (see "Enable deposit settings"), and
MetaMask pointed at `http://localhost:8545` chain 31337 with the Hardhat test accounts imported.

1. **Deposit and post (ok)**: from account #1 make a deposit via the DamageDeposit UI
   (`?contract=<address>`), then post on the deposit board. Twin flips to `active`, post appears.
2. **Post without deposit (rejected)**: with a wallet that has no deposit, attempt to post. The
   server rejects with "No deposit found for this wallet".
3. **Initiate a withdrawal**: from account #1 call `initiateWithdraw()`. New posts from that key
   are rejected. Existing posts become hidden publicly but stay fully visible to staff with the
   "Hidden: deposit exiting" banner, and the key is listed on the Deposits page under Exiting.
4. **Withdraw after the period**: wait 60 s, then call `withdrawDeposit()`. The author's posts are
   stripped to "Post removed: deposit withdrawn" tombstones; the key leaves the twin.
5. **Re-deposit, post, confiscate**: deposit again from account #1 and post. Then, logged in with
   the owner account #0 on the Deposits page, click Confiscate for that key and approve in
   MetaMask. The posts become "Post removed: deposit confiscated" tombstones that link to the day's
   modlog; the modlog row shows the tx hash and amount.
6. **Author and moderator delete**: author deletes via the post password and a moderator deletes;
   both leave tombstones ("Post removed by author" / "Post removed by moderator") instead of hard
   deleting.
7. **No addresses in public output**: check `/<board>/thread/N.json`, `/<board>/index.json` and
   `/<board>/catalog.json` contain no `address`, `signature`, or hidden message content.

## Verification of the deposit sync

- Confirm the `deposits` collection is populated and the `depositsync` cursor advances with new
  blocks.
- Optionally run the storage-walk test against the live local chain:
  `DEPOSIT_TEST_RPC=http://localhost:8545 DEPOSIT_TEST_CONTRACT=<eth-address> npx jest lib/deposit/storagewalk.test.js`
