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

## Durable store: Oracle Autonomous Database (schema `BASETRENCHES`)

The Durable Object's SQLite is the fast state and the point where everything gets serialized. **ADB is the durable source of truth.** It holds the dedicated `BASETRENCHES` schema on instance TOBYADB (us-phoenix-1) and is reached only through ORDS REST-enabled SQL over HTTPS: `…/ords/basetrenches/_/sql`.

- **Schema:** `bot/adb/schema.sql` holds the tables `bt_users`, `bt_coins`, `bt_tags` (PK ca+telegram_id, so one tag per user per coin), `bt_calls`, `bt_call_taggers` (position 1–9), `bt_engagement_snapshots`, `bt_price_snapshots` and `bt_health_checks`, plus the view `bt_callers`. Statements are separated by `/` lines.
- **Write-through:** `bot/src/adb.js` provides `AdbSink`. Every mutation in `core.js` calls `onWrite(kind, key, payload)`, which adds a row to the `adb_outbox` table in the DO. Then `ctx.waitUntil(sink.flush())` runs.
  - Ops name entity keys, and their SQL is rebuilt from the current DO state at flush time. That makes them idempotent `MERGE`s, so a retry never duplicates anything.
  - Every value is passed as an ORDS bind variable. The SQL text is constant.
- **Retry:** the outbox is processed in strict FIFO order, so foreign keys stay ordered.
  - A failure leaves the row at the head of the queue with exponential backoff (5 s doubling, up to 10 min). A DO alarm and the 10-minute cron both retry.
  - After 10 attempts the row moves to `adb_dead`.
  - ORDS returns HTTP 200 with an `errorCode` on SQL errors. These count as failures.
- **Backfill:** this runs once, the first time ADB is configured, and enqueues every user and coin. `POST /admin/backfill` re-runs it.
- **Health:** `/api/health` includes `db: {configured, ok, pending, dead, last_ok_at, last_error}`. `POST /admin/dbcheck` (Bearer admin key) inserts a synthetic `bt_health_checks` row, counts it, deletes it and recounts. `POST /admin/flush` forces a flush.
- **Config:**
  - The vars `ADB_SQL_URL` and `ADB_USER` are plain-text bindings.
  - The password is stored only in the DO kv as `secret:adb_password`. It was set once through the temporary `/__bootstrap` route. That route only exists while a `BOOTSTRAP_KEY` secret is bound, and the secret was deleted afterwards.
- **Isolation:** `BASETRENCHES` has only CREATE SESSION/TABLE/VIEW/SEQUENCE/PROCEDURE, a 2G quota on DATA, and no roles or object grants. It cannot see any other schema, and other schemas cannot see it.
- **Reads:** the API is still served from the DO. Reading from ADB is optional and not enabled yet.
