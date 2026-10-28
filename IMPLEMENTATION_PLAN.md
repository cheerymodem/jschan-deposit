# jschan-deposit: Implementation Plan

Proof of concept fork of [jschan](https://gitgud.io/fatchan/jschan) that requires a valid
[DamageDeposit](../DamageDeposit) deposit before posting, and lets moderators confiscate
deposits for abuse. Anonymity toward the public is the top priority; abuse control comes
from the refundable deposit instead of identity.

- Repo: `this repository`, branch `deposit` (local only for now)
- Upstream remote: `upstream` = gitgud.io/fatchan/jschan (`master` = upstream 1.7.3, commit `c0d50eb1`)
- Contract repo: `../DamageDeposit` (Hardhat; see its `CLAUDE.md`)
- Target chain for this PoC: local Hardhat node only

## Decisions (settled, do not re-litigate)

| Topic | Decision |
|---|---|
| Address/signature visibility | Staff only. Never in public HTML, public JSON, public sockets, or the API |
| Signing | Every post is signed (no posting sessions) |
| Deposit check | Server-side "twin" of contract state, fed by event polling. No live RPC fallback at post time |
| Who may post | Twin status `active` only. Blocked as soon as `WithdrawalInitiated` is seen |
| Scope | Every board requires a deposit (no per-board toggle). Captchas and block bypasses are unhooked; reports and account registration are signed by an active deposit wallet instead. One account per wallet, enforced by a keyed hash of the address (`accounts.walletKey`, HMAC with `ipHashSecret`), never the address itself |
| Confiscation | Moderator's browser wallet (must equal `owner()`) calls `confiscate()` via MetaMask; server verifies the receipt |
| After confiscation | No extra ban. A fresh deposit restores posting |
| Permissions | Reuse existing: see addresses = `VIEW_RAW_IP`; Deposits page + confiscate = `MANAGE_GLOBAL_BANS` |
| Withdrawal started | Author's posts are hidden from the public immediately, still fully visible to staff |
| Deposit exited | Author's posts are stripped to tombstones immediately (no batching/jitter in v1) |
| Tombstones | Every removal (exit, confiscation, mod delete, author delete) leaves a tombstone with a reason |
| Confiscation log | Public modlog entry with tx hash, amount, reason, post links. Tombstone links to it |
| Hidden post files | Left in place (still reachable by direct URL). Quarantine is v2 |
| Contract changes | None in v1. Twin rebuild/verify reads contract storage directly |

## Deferred to v2

Multiple moderator keys on the contract, enumeration getters (`accountCount`/`accountAt`),
batched/jittered purge to reduce timing correlation, file quarantine for hidden posts,
posting sessions, mainnet deployment.

## Post lifecycle

| Chain state (twin) | Public view | Staff view | Stored data |
|---|---|---|---|
| `active` | Normal | Normal + address badge | Full |
| `withdrawing` (`WithdrawalInitiated`) | Tombstone "Post hidden: author's deposit is exiting" | Full post, flagged hidden, countdown to `withdrawAt` | Full |
| exited (`DepositWithdrawn`, incl. `privWithdraw`) | Tombstone "Post removed: deposit withdrawn" | Same | Stripped |
| `DepositConfiscated` | Tombstone "Post removed: deposit confiscated" + link to modlog entry | Same | Stripped; modlog keeps tx hash, amount, links |
| Mod delete | Tombstone "Post removed by moderator" | Same | Stripped; normal modlog entry |
| Author delete (post password) | Tombstone "Post removed by author" | Same | Stripped |

The contract has no "cancel withdrawal", so `withdrawing` only moves forward to exited or
confiscated. A key that stays `withdrawing` past `withdrawAt` without calling
`withdrawDeposit()` stays hidden and confiscatable indefinitely; that is fine.

## Verified facts the implementer can rely on

**Contract storage layout** (verified on a Hardhat deployment of `DamageDeposit`, OZ 4.9.6, including swap-and-pop after a removal):

| Slot | Content |
|---|---|
| 0 | `Ownable._owner` |
| 1 | `accounts._keys._inner._values.length`; element `i` at `uint256(keccak256(pad32(1))) + i`, address in the low 20 bytes |
| 2 | `accounts._keys._inner._indexes` (mapping, unused by us) |
| 3 | `accounts._values` mapping; value for address `a` at `keccak256(abi.encode(bytes32(pad32(a)), uint256(3)))` = withdrawal timestamp (0 = active) |
| 4 | `paused` (bool) |

`withdrawPeriod` and `depositRequirement` are `immutable` (bytecode, not storage); read them via their getters. The walk depends on OZ internals: pin it with a test (see Phase 7).

**Contract events**: `DepositMade(address indexed account)`, `WithdrawalInitiated(address indexed account, uint256 withdrawalTime)`, `DepositWithdrawn(address indexed account)` (also emitted by `privWithdraw`), `DepositConfiscated(address indexed account)`. `checkDeposit(address) -> (bool present, uint256 withdrawTimestamp)`. Custom errors are declared in `contracts/DamageDepositBase.sol`.

**Local chain**: `pnpm hardhat node` then `pnpm hardhat run scripts/setupLocal.js --network localhost` in the DamageDeposit repo deploys the ETH and ERC-20 variants (60 s withdraw period) and prints addresses. Chain id 31337. Account #0 is the owner.

**jschan internals**:
- Post submit route: `controllers/forms.js:36` (`/forms/board/:board/post`) -> `controllers/forms/makepost.js` (validation, current web3 recover at `:55`) -> `models/forms/makepost.js` (builds post; `signature`/`address` at `:462-489`, socket emits at `:640-665`, insert at `:521`).
- Existing web3 bits: `lib/web3/web3.js` (unused client, reads `config.get.ethereumNode`), `models/pages/nonce.js` + route `controllers/pages.js:137` (`/nonce/:address.json`, stores redis key `nonce:<address>:<nonce>` for 60 s; login consumes it with `cache.del`, see `controllers/forms/login.js:55-64`), client signing in `gulp/res/js/forms.js:240-279`, `views/includes/postform.pug:88-92`, badge `views/mixins/web3signature.pug`, rendered in `views/mixins/post.pug:160`. `enableWeb3`/`ethereumNode` defaults in `configs/template.js.example:143-144`; `ethereumNode` is commented out in `models/forms/changeglobalsettings.js:145` and `views/includes/globalmanagesettings.pug` (tab-8).
- Public vs staff queries in `db/posts.js`: public paths omit `ip` via projection when `getSensitive` is false (`getRecent`, `getThread`, `getMultipleThreadPosts`, `getCatalog`, `getPost`, `getPosts`, `postExists`). Static pages are built by `lib/build/tasks.js` (`buildThread`, `buildBoard`, `buildBoardMultiple`, `buildCatalog`), which write both HTML and JSON from the same data. Staff views pass `modview`/`manage`/`globalmanage` to the pug mixins.
- Staff recent pages: `models/pages/manage/recent.js`, `models/pages/globalmanage/recent.js`, both call `Posts.getBoardRecent(offset, limit, ip, board, permissions)` (`db/posts.js:46`). Templates `views/pages/managerecent.pug`, `views/pages/globalmanagerecent.pug`. Global nav: `views/mixins/globalmanagenav.pug`. Routes: `controllers/pages.js:71,99`.
- Deletion: `models/forms/deletepost.js` hard-deletes and cascades OP deletion to the whole thread; dead quotes become `<span class="invalid-quote">` via `lib/post/deletequotes.js`. Callers: `models/forms/actionhandler.js:175` (mod and author delete), `changeboardsettings.js`, `deleteboard.js`, `makepost.js` (thread pruning). Live clients get `markPost` with `type: 'delete'` (`gulp/res/js/live.js:33`).
- Modlog: built in `models/forms/actionhandler.js:317-380` (per-board docs with `public`, `postLinks`, `actions`, `message`, `showUser`), stored via `db/modlogs.js`, rendered at `/<board>/logs/MM-DD-YYYY.html` (`views/pages/modlog.pug`) by build tasks `buildModLog`/`buildModLogList`. Action names in `lib/input/modlogactions.js`.
- Scheduled tasks: every file in `schedules/tasks/` exports `{ func, interval, immediate, condition }` and runs in the single `schedules` pm2 process (`ecosystem.config.js`). `condition` is a config key name. Note upstream bug: `Schedule.stop()` calls `clearInterval(this.interval)` instead of `this.intervalId`; fix it since our task is config-toggled.
- Build queue: `require('lib/build/queue.js').push({ task, options })`, processed by `worker.js`.
- Sockets: `lib/misc/socketio.js` `emitRoom(room, event, msg)`; rooms `<board>-<thread>`, `globalmanage-recent-{raw,hashed}`, `<board>-manage-recent-{raw,hashed}`. `-raw` rooms require `VIEW_RAW_IP`.
- Uploaded files expose `file.sha256` (lowercase hex) from `@fatchan/express-fileupload`.
- Migrations: `migrations/<semver>.js` exporting `async (db, redis)`, run by `npx gulp migrate` when `package.json` `migrateVersion` is newer than the DB. Indexes for fresh installs are created in `gulpfile.js` `reset` (~line 194). Use version **`1.7.4-deposit.1`** (greater than 1.7.3, sorts before a future upstream 1.7.4).
- Roles are seeded in `gulpfile.js` (`GLOBAL_STAFF` has `MANAGE_GLOBAL_BANS`; `ADMIN` adds `VIEW_RAW_IP`).
- Tests: Jest. `npm run test:unit` runs `*.test.js` outside `test/`; `test/` holds integration tests that need a running instance.
- Upstream Dockerfile uses `node:16`; web3 v4 needs a newer Node. Develop on the host with current Node LTS, Mongo and Redis via docker.

## Phases

Each phase should land as one or more focused commits on `deposit`. Keep upstream code
style (tabs, `'use strict'`, `__dirname+` requires). Put new server code under
`lib/deposit/` where practical to keep upstream merges easy.

### Phase 0: Fork housekeeping and dev environment

1. README: add a short header stating this is a modified version of jschan (AGPLv3 section 5a), what it adds, and a link to upstream. Change the footer link in `views/includes/footer.pug` to point to this fork's source (AGPL section 13; URL configurable, placeholder until pushed).
2. `lib/deposit/abi.json`: the DamageDeposit ABI. Add `tools/sync_deposit_abi.js` that copies `abi` from `../DamageDeposit/artifacts/contracts/DamageDeposit.sol/DamageDeposit.json` (path overridable by argument). The ETH and ERC-20 variants share the ABI surface we use; `token()` exists only on the ERC-20 one.
3. `docker-compose.dev.yml` with just `mongodb` and `redis`, and `DEV.md` (or README section) covering: start compose, `pnpm hardhat node` + `setupLocal.js` in DamageDeposit, `configs/secrets.js`, `npm install`, `npm run-script setup`, `npx gulp reset`, `npm run start`, enabling deposit settings, and a MetaMask setup against `http://127.0.0.1:8545` chain 31337.
4. Bump `package.json` `version`/`migrateVersion` to `1.7.4-deposit.1`, add `migrations/1.7.4-deposit.1.js` (settings and indexes from later phases accumulate here), and mirror new indexes in `gulpfile.js` `reset`.
5. Fix `Schedule.stop()` (see above).

### Phase 1: Keep addresses and signatures away from the public

1. `db/posts.js`: in every public path (the functions listed above, when not `getSensitive`), also project out `signature` and `address`. Add an explicit `includeAddress` decision for staff paths: `getBoardRecent`, `getReports`, `getGlobalReports`, and manage board/thread/catalog pages include them only if `permissions.get(Permissions.VIEW_RAW_IP)`.
2. `models/forms/makepost.js:640-665`: public thread room gets the post without `signature`/`address`; `-raw` staff rooms get them; `-hashed` staff rooms do not.
3. `views/mixins/post.pug:160`: render the badge only when `(modview || manage || globalmanage)` and the address is present. The badge shows a short address linking to "posts by key" (Phase 6) instead of etherscan.
4. `lib/build/tasks.js` JSON output must not contain them either (covered by 1, verify).
5. Unit tests: build a fake post with `address`/`signature`, run it through the public projections/serializers, and assert neither appears. Grep-style test over rendered `post.pug` output for public vs modview.

### Phase 2: Deposit twin

Settings (global, via migration + `configs/template.js.example` + global settings form, web3 tab):
`deposit.enabled` (bool), `deposit.rpcUrl`, `deposit.chainId`, `deposit.contractAddress`,
`deposit.deployBlock`, `deposit.confirmations` (default 1), `deposit.pollInterval` (ms, default 5000),
`deposit.interfaceUrl` (link to the DamageDeposit UI with `?contract=`),
`deposit.assetSymbol`/`deposit.assetDecimals` (display only; read `depositRequirement` from chain).
~~Board setting: `requireDeposit`~~ (removed: every board requires a deposit).

Collections (`db/deposits.js`, export from `db/index.js`):
- `deposits`: `{ _id: <lowercase address>, status: 'active'|'withdrawing', withdrawAt: Date|null, depositBlock, lastEventBlock, updatedAt }`. Exited/confiscated keys are deleted after their posts are stripped. Index `{ status: 1, withdrawAt: 1 }`.
- `depositsync`: single doc `{ _id: 'sync', lastBlock, lastPollAt, lastVerifyAt, lagSeconds }`.

`lib/deposit/client.js`: web3 (already a dependency) contract instance from settings, rebuilt on config change (`addCallback('config', ...)`), helpers: `getLogs(from, to)`, `checkDeposit(addr)`, `owner()`, `depositRequirement()`, `withdrawPeriod()`, `walkAccounts()` (storage walk per the verified layout), `getReceipt(txHash)`.

`schedules/tasks/depositsync.js` (`Schedule` checks `config.get[condition]`, which does not resolve dotted paths; either store a flat `depositEnabled` key or extend `Schedule.update()` to resolve dotted paths):
1. On first run with no sync doc, backfill from `deployBlock` in chunks (e.g. 2000 blocks).
2. Each poll: `head = latest block`. Fetch logs `(lastBlock+1 .. head)`, ordered by block/log index.
   - `WithdrawalInitiated`, `DepositWithdrawn`, `DepositConfiscated`: apply immediately (at `head`).
   - `DepositMade`: apply only once `block <= head - confirmations`; so fetch `DepositMade` up to `head - confirmations`, and track `lastBlock` per the lower bound for that event type (simplest: keep two cursors, `lastBlockRestrictive` and `lastBlockGrant`).
   - Handlers (`lib/deposit/events.js`): `DepositMade` -> upsert `active`. `WithdrawalInitiated` -> `withdrawing`, `withdrawAt = withdrawalTime*1000`, then `hidePostsFor(address)`. `DepositWithdrawn` -> `stripPostsFor(address, 'withdrawn')`, delete twin doc. `DepositConfiscated` -> if not already processed by the confirm endpoint (Phase 6), `stripPostsFor(address, 'confiscated')` + modlog entry without staff user, delete twin doc.
   - Handlers must be idempotent (reprocessing a block range is safe).
3. Every poll also re-runs `hidePostsFor` for all `withdrawing` keys that still have visible posts (closes the post-vs-listener race).
4. Every N minutes: verify. `walkAccounts()` from storage, compare with the twin (missing, extra, wrong status/timestamp), correct the twin, log discrepancies. Rebuild the twin entirely from the walk if the sync doc is missing.
5. Lag alarm: if `now - lastPollAt` or chain lag exceeds `withdrawPeriod / 4`, log a warning and show a banner on the Deposits page.
6. Reorg handling for v1: restrictive events applied at head are safe to keep; grant events wait for confirmations. Document the rest as a limitation.

### Phase 3: Deposit check at post time

1. Signed message (client builds, server rebuilds byte-for-byte and verifies):
   ```
   jschan-deposit post
   Site: <config meta.url>
   Board: <board>
   Thread: <thread postId or "new">
   Message-SHA256: <hex sha256 of message with \r\n normalised to \n, empty string if none>
   Files-SHA256: <sorted, comma-joined lowercase hex sha256 of each file, or "none">
   Nonce: <nonce>
   ```
   Client computes file hashes with `crypto.subtle.digest`. Server uses `req.files.file[i].sha256`.
2. Client (`gulp/res/js/forms.js`): on deposit-required boards, intercept submit: request accounts, fetch `/nonce/<address>.json`, build the message, `personal_sign`, fill hidden `signature`, `address`, `nonce` fields, then submit. Replace the manual "Sign" button on those boards. Show errors inline.
3. Server (`controllers/forms/makepost.js`), on every board (no bypass permission in v1; staff posting via `/modpost` is exempt; posting is refused while `deposit.enabled` is off):
   - Consume the nonce (`cache.del('nonce:<address>:<nonce>') === 1`), else error.
   - Recover the address from the rebuilt message; must equal the submitted address (case-insensitive).
   - Twin lookup: missing -> "No deposit found for this wallet (deposits can take a few blocks to be recognised)"; `withdrawing` -> "This wallet's deposit is being withdrawn; posting is disabled"; `active` -> ok.
   - Store `address` lowercase on the post; keep `signature`. Index `Posts {address: 1}` (sparse).
   - Just before insert in `models/forms/makepost.js`, re-read the twin; if no longer `active`, insert with `hidden: true`.
4. The nonce route regex (`[a-zA-Z0-9]{42}`) is fine; lowercase the address in the redis key on both sides.
5. `views/includes/postform.pug`: on deposit boards show a short explainer (deposit amount from chain, cached; link to `deposit.interfaceUrl`; note that withdrawing hides your posts and completing a withdrawal removes them).
6. Posting on these boards requires JavaScript and a wallet; render a clear noscript notice.

### Phase 4: Tombstones and hiding

Post fields: `hidden: true` (withdrawing), `tombstone: { reason: 'exiting'|'withdrawn'|'confiscated'|'moderator'|'author', date, modlog: { board, date } | null }`.

1. `lib/deposit/tombstone.js`:
   - `hidePostsFor(address)`: set `hidden: true` on that address's posts that are not tombstoned; emit `markPost` (new type `hidden`) to thread rooms; queue rebuilds (threads, board pages, catalog) for affected boards.
   - `stripPosts(posts, reason, modlogRef)`: for each post set `tombstone`, unset `message`, `nomarkup`, `subject`, `name`, `tripcode`, `capcode`, `email`, `files`, `signature`, `address`, `password`, `salt`, `ip` (replace with a pruned-style random value like `schedules/tasks/ips.js` does, since other code assumes `ip.cloak` exists), `reports`, `globalreports`, `hidden`. Decrement/prune files like `deletepost.js` does. Emit `markPost` (type `tombstone`). Queue rebuilds. Recalculate thread reply/file counts (`Posts.getThreadAggregates`).
   - `stripPostsFor(address, reason, modlogRef)`: query by address, then `stripPosts`.
2. Replace hard deletion with `stripPosts` for moderator delete and author delete in `models/forms/actionhandler.js:175` (reason `moderator` or `author`, based on whether the post password path was used). Deleting an OP no longer deletes its thread. Leave `deleteboard.js` and thread pruning as hard deletes. Keep the "delete by IP" variants, also as tombstones.
3. Public rendering: add a single `publicPost(post)` transform in `db/posts.js` for non-sensitive paths that turns `hidden` posts into an `exiting` tombstone view (drops content fields) so both HTML and JSON builds are safe. Staff paths return hidden posts in full with `hidden: true`.
4. `views/mixins/post.pug`: if `post.tombstone` (or public-hidden), render a compact placeholder: post number, date, and the reason text:
   - exiting: "[Post hidden: author's deposit is exiting]"
   - withdrawn: "[Post removed: deposit withdrawn]"
   - confiscated: "[Post removed: deposit confiscated]" linking to `/<board>/logs/MM-DD-YYYY.html` of the modlog entry
   - moderator: "[Post removed by moderator]" linking to that day's modlog
   - author: "[Post removed by author]"
   Staff views show hidden posts in full with a "Hidden: deposit exiting, withdrawable <reltime>" banner.
5. Quotes: since posts are no longer deleted, quotes and backlinks keep working and point at the tombstone. Do not call `deleteQuotes` for tombstoned posts.
6. Catalog/overboard: tombstoned OPs show the placeholder tile; do not drop the thread.
7. `gulp/res/js/live.js` `markPost`: handle `hidden` and `tombstone` by replacing the post body with the placeholder text (translations in `locales/*.json`, add English at minimum).

### Phase 5: Exit handling

Covered by the Phase 2 handlers calling Phase 4 helpers. Checklist:
- `WithdrawalInitiated` -> hide immediately.
- `DepositWithdrawn` -> strip with `withdrawn`, delete twin doc.
- `DepositConfiscated` seen by the listener without a matching confirm-endpoint record -> strip with `confiscated`, write a modlog entry with the tx hash and no staff user.
- Re-deposit after exit works (new `DepositMade` -> `active`); earlier posts stay tombstoned.

### Phase 6: Staff tools

1. "Posts by key": accept `?address=0x...` on `/:board/manage/recent.(html|json)` and `/globalmanage/recent.(html|json)`, requiring `VIEW_RAW_IP`. Extend `Posts.getBoardRecent` with an `address` filter. Include hidden posts in full. In `managerecent.pug`/`globalmanagerecent.pug` show the active filter and a "See global posts by this key" link like the existing IP one.
2. Deposits page `/globalmanage/deposits.(html|json)` (`MANAGE_GLOBAL_BANS`; addresses only rendered if also `VIEW_RAW_IP`, otherwise show a truncated hash-like id):
   - Default tab "Exiting": twin keys with `status: 'withdrawing'`, sorted by `withdrawAt` ascending. Columns: address, time left (reltime), posts still on server, hidden posts count, last post date, link to posts by key, Confiscate button.
   - Tab "All keys": all twin entries with post counts (aggregate on `Posts` by `address`).
   - Sync status line (last block, last poll, lag warning).
   - Add to `views/mixins/globalmanagenav.pug`, route in `controllers/pages.js`, model in `models/pages/globalmanage/deposits.js`, view `views/pages/globalmanagedeposits.pug`.
3. Confiscation (browser-signed, option B):
   - Client script `gulp/res/js/confiscate.js` (loaded on the Deposits page and staff post views): on click, require `window.ethereum`, request accounts, check chain id matches `deposit.chainId`, read `owner()` and refuse if the connected account differs, confirm dialog with address and deposit amount, send `confiscate(address)`, wait for the receipt, then POST `{ address, txHash, reason, _csrf }` to the confirm endpoint. Decode custom errors using the ABI (ship a trimmed ABI to the client via `gulpfile.js` `extraLocals` or a static JSON).
   - Endpoint `POST /forms/global/confiscate` (`MANAGE_GLOBAL_BANS`, csrf): fetch the receipt from the RPC, require `status == 1`, `to == contractAddress`, a `DepositConfiscated` log for that address, and `from == owner()`. Idempotent on `txHash` (store processed hashes, e.g. in `depositsync` or a small collection). Then: strip that address's posts with reason `confiscated`, write one public modlog entry per affected board with a new action `Confiscate deposit` (add to `lib/input/modlogactions.js`), `message` = staff reason, plus `txHash`, `amount`, and `postLinks`; queue `buildModLog`/`buildModLogList`; store the modlog ref on the tombstones; delete the twin doc.
   - `views/pages/modlog.pug`: when a log has `txHash`, render it (with a configurable explorer URL, reuse `ethereumLinksURL` pattern with a `%s` tx variant, empty for local) and the amount.
   - Add a "Confiscate deposit" control next to the address badge in staff post views.
4. CSP: MetaMask injects the provider, so no CSP change is needed for the browser flow; do not add inline scripts.

### Phase 7: Tests and docs

1. Unit tests (Jest, `*.test.js` next to the code):
   - Message builder/verifier round trip, including CRLF normalisation, file hash ordering, wrong board/thread/nonce rejection.
   - Event handlers against an in-memory fake of the posts/deposits collections (or a mocked db module): each event transition, idempotency, `DepositMade` confirmation gating.
   - Public projection/`publicPost` never leaks `address`, `signature`, or hidden content.
   - Tombstone field stripping.
2. Storage walk test: `lib/deposit/storagewalk.test.js`, skipped unless `DEPOSIT_TEST_RPC` is set; deploys nothing itself, expects the DamageDeposit `setupLocal.js` contract address in `DEPOSIT_TEST_CONTRACT`, makes deposits from Hardhat accounts, and compares `walkAccounts()` with `checkDeposit`.
3. Manual end-to-end checklist in `DEV.md`: deposit from account #1, post (ok); post from a wallet with no deposit (rejected); initiate withdrawal (new posts rejected, old posts hidden publicly, visible to staff, listed on Deposits page); wait 60 s, withdraw (posts tombstoned); new deposit, post, confiscate from account #0 in the Deposits page (tombstones link to modlog, modlog shows tx hash); author and moderator delete leave tombstones; public JSON (`/<board>/thread/N.json`, `catalog.json`) contains no addresses.
4. README "Threat model and limitations": staff with `VIEW_RAW_IP` can link all posts by one key; hiding/stripping at on-chain events lets observers correlate posts with a wallet on low-traffic boards (v2: batching); hidden posts' files remain reachable by direct URL until stripped (v2: quarantine); posting needs JS and a wallet; reorg handling is minimal; the owner key is a single EOA (v2: multiple keys).

## Out of scope for v1

Mainnet deployment, multiple owners/moderator keys, contract changes, ERC-20 specific UI
beyond showing the asset symbol, posting sessions, upstream contribution.
