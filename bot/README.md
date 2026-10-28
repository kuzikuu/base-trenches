# Power of 9 bot (@Powerof9BaseBot)

Cloudflare Worker `base-trenches-bot` + one SQLite-backed Durable Object (`BotDO`, "main").
Live at https://base-trenches-bot.base-trenches.workers.dev

- `src/core.js` all bot logic (tags, power-up, pins, prices, API), shared with `vm/`
- `src/index.js` Worker + Durable Object (webhook, admin, API, cron)
- `test/` node tests: `npm install && npm test`
- `vm/` optional long-poll runner for an Oracle Cloud VM

## How it works
- Vote group "Base Trenches" (-1004397164578) or DM: `/tag <Base CA | DexScreener | Basescan link>`.
  One tag per Telegram user per coin. Tokens resolve via DexScreener, Base pairs only.
  In DM a bare CA also counts.
- 9 unique tags: coin is POWERED UP. First tagger = caller. Call price/mcap/time stored.
  Announcement posted + pinned in the channel @powerof9base (-1003874691876), echoed in the group,
  with an X intent link for the @PowerOf9Base bull-post.
- `/setpost <ca> <x status url>` (owners in `OWNER_TG_IDS`) attaches the X post.
- `POST /admin/engagement` (Bearer ADMIN_KEY) `{ca, post_url, replies, reposts, likes}`:
  at 5 replies / 8 reposts / 9 likes a powered call becomes PINNED, announced and pinned.
  `GET /admin/pending` lists powered calls waiting on 5/8/9.
- Cron `*/10 * * * *` refreshes DexScreener prices (calls from the last 30 days, tagging coins from
  the last 7) and tracks the ATH price since the call (sampled every 10 min).
- Public API (CORS for base-trenches.pages.dev, kuzikuu.github.io):
  `/api/health`, `/api/hot`, `/api/calls`, `/api/callers`, `/api/coin/:ca`.

## Secrets
The bot token, webhook path/secret and ADMIN_KEY live in the Durable Object's SQLite, written once
through a temporary `/__bootstrap` route that only works while a `BOOTSTRAP_KEY` binding exists.
The binding is removed after setup, so the route returns 404. Nothing secret is in this repo.

Webhook: `setWebhook url=https://base-trenches-bot.base-trenches.workers.dev/tg/<path>`,
`secret_token=<webhook secret>`, `allowed_updates=["message","my_chat_member","channel_post"]`.
