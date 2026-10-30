# CLAUDE.md

Fork of jschan (AGPLv3 imageboard, Node/Express/MongoDB/Redis) that gates posting behind a
DamageDeposit smart contract deposit. The contract is a separate repository (`../DamageDeposit` in a
local checkout).

`IMPLEMENTATION_PLAN.md` holds the settled design decisions, verified facts about jschan internals
and the contract storage layout, and how the integration is built.

## Repo layout

- Branch `deposit` holds the fork. `master` tracks upstream; remote `upstream` =
  gitgud.io/fatchan/jschan.
- Upstream style: tabs, `'use strict'`, `require(__dirname+'/...')`. Lint with `npx eslint`.
- New server code goes under `lib/deposit/` where practical, and fork-only client code in its own
  files (`gulp/res/js/depositforms.js`, `depositgate.js`, `confiscate.js`), to keep upstream merges
  small.
- New settings and indexes go in the fork migration `migrations/1.7.4-deposit.1.js` and are mirrored
  in `gulpfile.js` `reset`.
- Unit tests: `npm run test:unit` (Jest, `*.test.js` outside `test/`). `test/` holds integration
  tests that need a running instance.

## Critical invariants

- Wallet addresses and signatures must never reach public HTML, public JSON builds, public socket
  rooms, or the API. Staff-only, gated on `VIEW_RAW_IP`.
- Posting is allowed only when the twin (`deposits` collection) says `active`. No live RPC fallback
  at post time.
- Removals leave tombstones; only board deletion and thread pruning hard-delete.

## Running it

- Local development stack (Mongo, Redis, Hardhat chain, contract, jschan): `DEV.md`.
- Public deployment checklist: `DEPLOY.md`.
