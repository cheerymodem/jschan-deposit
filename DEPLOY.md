# Deploying a public jschan-deposit instance

A checklist for running jschan-deposit on the open internet (for example a demo VPS). Follow
upstream's [INSTALLATION.md](INSTALLATION.md) for the base install; this file covers what the deposit
fork changes or depends on. [DEV.md](DEV.md) is for a local development stack only: do not copy its
settings (Hardhat keys, `JSCHAN_IP=0.0.0.0`, default passwords) to a public server.

## Chain and contract

- **Deploy a fresh contract with a fresh owner key.** Hardhat's default accounts and their private
  keys are public; anyone could confiscate with them. Use a testnet such as Sepolia for a demo (see the
  DamageDeposit README), and keep the owner key in a hardware or otherwise dedicated wallet.
- **Never expose a Hardhat node** or any unlocked RPC to the internet.
- **Withdrawal period**: long enough for moderators to see abuse and confiscate before the deposit
  can leave (hours to days, not the seconds used for local testing).
- **Global settings, deposit section**:
  - `deposit.rpcUrl`: an RPC provider you trust. jschan trusts it for all deposit state.
  - `deposit.contractAddress` and `deposit.chainId`: the deployed contract and its chain.
  - `deposit.deployBlock`: the block the contract was deployed in.
  - `deposit.confirmations`: at least 2 or 3 on a public chain. Grants wait for these, but
    restrictive events apply immediately.
  - `deposit.interfaceUrl`: where users make deposits. It is linked from the post form.
- **Testnet deposits are free** (faucets), so on a testnet demo the deposit shows the mechanism but
  costs a spammer nothing real.

## Network and proxy

- **Run jschan behind nginx and keep it on 127.0.0.1.** jschan listens on 127.0.0.1 unless
  `JSCHAN_IP` is set; leave it unset. jschan takes the client IP from the `ipHeader` setting
  (`x-real-ip`) without checking where the request came from, so if jschan were reachable directly
  anyone could send their own `X-Real-IP` and slip every IP ban, flood timer and rate limit.
  Have nginx set the header (upstream's [configs/nginx](configs/nginx) does).
- **TLS everywhere.** Set `secureCookies` to true.
- **`meta.url`** must be the exact public origin users see (for example `https://demo.example.org`).
  Every wallet signature binds it, so a mismatch makes every post fail to verify.
- **Referer check**: enable `refererCheck` and list the public hostnames in `allowedHosts`. Public
  forms carry no CSRF token; the wallet signatures protect posts, actions and registration, and the
  referer check covers the rest (login, appeals).
- **Security headers**: use upstream's nginx snippets (CSP with `script-src 'self'`). Set the
  `connect-src` websocket hosts to your own domain. The deposit scripts only talk to the same origin
  and to the injected wallet, so the strict CSP is compatible.
- **Proxy rate limits**: add an nginx `limit_req` zone for `/forms/` and `/nonce/`. The application
  limits below skip anonymizers (Tor users share one IP cloak, as with upstream's quotas), so the
  proxy is the place to cap total request rates.

## Secrets and services

- Generate random values for `cookieSecret`, `tripcodeSecret`, `ipHashSecret` and
  `postPasswordSecret` in `configs/secrets.js`.
- `ipHashSecret` also keys the per-account wallet hash (one account per wallet), the key tags staff
  without raw IP access see, and wallet ban cloaks. Changing it frees every registered wallet to
  register again and changes all tags, so set it once.
- MongoDB and Redis: authentication on, strong passwords, bound to localhost (the
  `docker-compose.dev.yml` passwords are for development only).

## Accounts and permissions

- Change the admin password printed by `gulp reset` and enable two-factor authentication. Consider
  `forceAccountTwofactor` for staff.
- **`VIEW_RAW_IP` reveals wallets.** Only roles with it (ADMIN and ROOT by default) see wallet
  addresses, can filter posts by wallet, and can confiscate. Grant it deliberately.
- **Keep `enableWeb3` off.** Upstream's web3 login signs a bare `Nonce: ...` message with no site in
  it, so a phishing page could get a wallet owner to sign one and log in as them.
- Confiscation needs a staff member with both `MANAGE_GLOBAL_BANS` and `VIEW_RAW_IP`, using the
  contract owner wallet in their browser.

## What the fork already limits

The captchas are gone, so the fork rate limits what they used to protect (`lib/deposit/ratelimit.js`):

| What | Limit |
|---|---|
| Login and change password (shared) | 10 per 5 minutes, per IP and per username |
| Board creation | 5 per day, per account and per IP |
| Nonce requests (needed before every signature) | 30 per minute per IP |
| Posts | 1 per `floodTimers.anyContentSameIp` (5 s default) per wallet, on top of upstream's per-IP flood timers |
| Post actions (report, delete, spoiler, unlink) | 1 per `floodTimers.anyContentSameIp` per wallet |

Keep `floodTimers.anyContentSameIp` above 0; the per-wallet limits use it. Block bypasses stay off
(the fork migration sets this), since they relied on the captcha.

## Operations

- Watch the sync status on the Deposits page (Global management, Deposits): last block, last poll,
  lag. If the RPC is down, new deposits are not recognised and withdrawals are not seen until it
  recovers.
- Back up MongoDB. The deposit twin can be rebuilt from the chain, but accounts, bans and posts
  cannot.
