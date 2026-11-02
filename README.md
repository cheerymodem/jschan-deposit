# jschan-deposit

<!-- TODO: link the DamageDeposit repository once it is published -->
A fork of the [jschan](https://gitgud.io/fatchan/jschan) imageboard that demonstrates
**DamageDeposit**, an Ethereum smart contract, as its anti-spam system. Every post is backed by a
refundable deposit held in the contract, which moderators can confiscate for abuse. It replaces
captchas, post passwords and IP-based gatekeeping, while keeping posters anonymous to the public.

## Fork of jschan

This project is a modified version of **jschan** by Thomas Lynch (fatchan) and contributors:
https://gitgud.io/fatchan/jschan. It is not affiliated with or endorsed by the jschan project.
Everything that makes jschan an imageboard is their work; this fork adds the DamageDeposit
integration and removes the parts it replaces. Like upstream it is licensed under the GNU AGPLv3
(see [LICENSE](LICENSE)), and the `master` branch tracks upstream, so `git diff master deposit` shows
exactly what the fork changes. Please report problems with the deposit integration here, not to
upstream.

## Why

The only way to stop spam is to make spamming cost more than it earns. Most sites raise the *work*
needed to post: captchas, email or phone verification, IP blocklists, ID checks. Those defences are
failing and they cost legitimate users dearly:

- **Captchas no longer stop bots.** Machine learning solves them, and solving farms sell answers by
  the thousand. Each new captcha generation is harder for people and barely slows automation.
- **Privacy erodes.** Third-party captchas track users across sites, and verification by email,
  phone or ID ties every post to a real identity, which defeats the point of an anonymous board.
- **IP blocking punishes the wrong people.** Tor, VPN and mobile users share addresses with abusers,
  while a determined spammer rents fresh IPs cheaply.

DamageDeposit raises the *financial* cost instead. To post, a user locks a small deposit in a
contract. Honest users get it back when they leave; a spammer loses it the moment a moderator
confiscates, so every banned identity costs real money to replace. Removal stops being a pure cost
for the operator: confiscated deposits pay for moderation.

An anonymous imageboard is a demanding test of this idea: there are no user identities to lean on,
it attracts heavy spam, and its users care most about privacy. This fork shows the deposit carrying
the whole anti-spam load, with the public never seeing which wallet made which post.

## How it works

- **Deposit.** A user deposits through the DamageDeposit interface (linked from the post form) with a
  browser wallet such as MetaMask.
- **Every post is signed.** The post form asks the wallet to sign a message that binds this site,
  board, thread, the message text, the file hashes and a single-use nonce. The server checks the
  signature and that the wallet holds an active deposit.
- **No RPC on the hot path.** The server keeps a local copy of deposit state, fed by polling the
  contract's events and periodically checked against contract storage, so posting never waits on
  the chain.
- **Withdrawing hides and then removes a user's posts.** Starting a withdrawal hides that wallet's
  posts at once (staff still see them), and when the deposit leaves the contract the posts become
  tombstones. Content only stays up while a deposit stands behind it.
- **Confiscation.** Staff confiscate from the Deposits page or straight from a post, signing the
  `confiscate()` transaction with the contract owner wallet. The server verifies the transaction,
  removes the wallet's posts and writes a public modlog entry with the transaction hash and reason.
- **Captchas are replaced, not just removed.** Registration needs a signature from a wallet with an
  active deposit (one account per wallet). Reports, deleting, spoilering and unlinking your own posts
  are signed by the wallet instead of using post passwords. Bans and word-filter bans apply to the
  wallet. Rate limits cover login, board creation and per-wallet posting.
- **Anonymity toward the public.** Wallet addresses and signatures never appear in public pages,
  JSON, live updates or the API. Only staff with the raw IP permission see them.

## Documentation

- [DEV.md](DEV.md): run the full stack locally (Hardhat chain, contract, jschan).
- [DEPLOY.md](DEPLOY.md): checklist for a public server.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): design decisions and how the integration works.
- [INSTALLATION.md](INSTALLATION.md): upstream's install and upgrade guide.

## Threat model and limitations

- **Posts by key linkage**: staff with `VIEW_RAW_IP` can list every post a wallet made. Anonymity is
  toward the public, not toward staff.
- **Timing correlation**: hiding and stripping happen at on-chain events, so on low-traffic boards an
  observer can correlate a wallet with its posts around those events. Batching/jitter is deferred to v2.
- **Hidden file reachability**: hidden posts' files stay reachable by direct URL until the post is
  stripped (v2 adds quarantine).
- **Posting needs a wallet**: deposit boards require JavaScript and a web3 wallet; there is no
  noscript posting path.
- **Reorg handling is minimal**: restrictive events are applied immediately and grant events wait for
  confirmations, but deeper reorganisations are not specially handled.
- **Single owner key**: the confiscation authority is one contract `owner()` EOA (v2 allows multiple
  moderator keys).
- **Confiscation is public by design**: the modlog entry lists the removed posts and the transaction
  hash, and the transaction names the wallet on chain, so a confiscated wallet is publicly linked to
  those posts.
- **Accounts outlive deposits, by design**: registering needs a wallet with an active deposit, but
  an account keeps its non-posting abilities (board creation, board pages and settings, staff roles)
  after that deposit is withdrawn or confiscated. Dealing with a trusted user who goes rogue takes
  two steps: confiscate to stop the posting, then disable or delete the account in global
  management.
- **Rate limits skip anonymizers**: Tor and other anonymizer users share one IP cloak, so the
  per-IP limits do not apply to them (as with upstream's quotas). Per-username and per-wallet limits
  still do; cap total rates at the reverse proxy.

## License
GNU AGPLv3, see [LICENSE](LICENSE).

## Upstream jschan

jschan: anonymous imageboard software that doesn't suck. This fork tracks upstream on the `master`
branch; the deposit work lives on `deposit`.
