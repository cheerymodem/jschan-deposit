# CLAUDE.md

Fork of jschan (AGPLv3 imageboard, Node/Express/MongoDB/Redis) that gates posting behind a
DamageDeposit smart contract deposit. The contract lives in `../DamageDeposit`.

**Start by reading `IMPLEMENTATION_PLAN.md`.** It holds the settled design decisions, verified
facts about jschan internals and the contract storage layout, and the phased work list.
Do not re-open decisions listed there without asking.

## Repo conventions

- Work on branch `deposit`. `master` tracks upstream; remote `upstream` = gitgud.io/fatchan/jschan.
- Keep upstream style: tabs, `'use strict'`, `require(__dirname+'/...')`. Lint with `npx eslint`.
- Put new server code under `lib/deposit/` where practical to keep upstream merges small.
- New settings/indexes go in the fork migration `migrations/1.7.4-deposit.1.js` and are mirrored in `gulpfile.js` `reset`.
- Unit tests: `npm run test:unit` (Jest, `*.test.js` outside `test/`). `test/` = integration tests needing a running instance.
- No emdashes in files or docs. No co-author lines or AI attribution in commits.

## Critical invariants

- Wallet addresses and signatures must never reach public HTML, public JSON builds, public socket rooms, or the API. Staff-only, gated on `VIEW_RAW_IP`.
- Posting on deposit boards is allowed only when the twin (`deposits` collection) says `active`. No live RPC fallback at post time.
- Removals leave tombstones; only board deletion and thread pruning hard-delete.

## Local dev

See `DEV.md` (created in Phase 0). Short version: Mongo + Redis via `docker-compose.dev.yml`,
`pnpm hardhat node` and `pnpm hardhat run scripts/setupLocal.js --network localhost` in
`../DamageDeposit`, then the usual jschan `npm install`, `npm run-script setup`, `npx gulp reset`, `npm run start`.
