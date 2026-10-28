# Base Trenches Multiplayer Server

Cloudflare Worker with Durable Objects for real-time multiplayer and RPG progression.

## Architecture

- **TrenchRoom DO**: Real-time WebSocket room with hibernation API. Handles player state broadcasting at 10Hz, presence/roster, chat, dug blocks, and **server-scored** events (digs, dodges, hits, missions).
- **Profiles DO**: SQLite-backed player profiles (XP, gear, campaign, titles, squads). Leaderboard reads these server values only.
- **Events DO** (migration `v2`): calendar + live event scores.

## Deploy

### First-time setup

```bash
cd server

# Login to Cloudflare (if not already)
npx wrangler login

# Deploy (creates the Worker and Durable Objects)
npx wrangler deploy
```

This creates:
- Worker: `base-trenches-server.<your-subdomain>.workers.dev`
- Durable Objects: `TrenchRoom`, `Profiles`, `Events`
- SQLite migrations: `v1` (TrenchRoom + Profiles), `v2` (Events)

### Secrets and vars (do not skip)

```bash
# Admin bearer for POST/DELETE /events
npx wrangler secret put EVENTS_ADMIN_KEY

# Same public app id as js/config.js BT_PRIVY_APP_ID (or set [vars] PRIVY_APP_ID)
npx wrangler secret put PRIVY_APP_ID   # optional; empty = Privy auth off
```

`PRIVY_APP_ID` can stay a plain `[vars]` value (it is public). `EVENTS_ADMIN_KEY` must be a secret.

### After deploy

1. Note the Workers URL (e.g., `https://base-trenches-server.yourname.workers.dev`)
2. Update `js/config.js` (`BT_SERVER_URL`, and `BT_PRIVY_APP_ID` when you have a Privy app)
3. Deploy the static site (Pages) — no build step
4. Redeploy the Telegram bot after setting `GAME_SERVER_URL` so `/events` and the announce cron can read the calendar

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/ws?room=main` | GET | WebSocket upgrade for multiplayer |
| `/api/profile?id=X` | GET | Get profile by ID |
| `/api/profile` | POST | Save profile (JSON body) |
| `/api/leaderboard?type=xp` | GET | Top 50 by XP, `depth`, or `squad` (server values only) |
| `/api/profile/migrate` | POST | One-time guest/Farcaster → Privy DID (prove with guest secret or FC token) |
| `/presence` | GET | `{ online, players }` for the homepage |
| `/events` | GET | Calendar: upcoming / live / past (local clients convert UTC) |
| `/events.ics` | GET | iCal feed |
| `/events/:id.ics` | GET | One event as `.ics` |
| `/events` | POST | Admin create (`Authorization: Bearer EVENTS_ADMIN_KEY`) |
| `/events/:id` | DELETE | Admin delete |
| `/api/squads` | POST | Create a squad (max 9) |
| `/api/squads/join` | POST | Join by code |
| `/api/squads/leave` | POST | Leave |
| `/api/squads/me` | GET | Current squad |
| `/api/campaign` | GET | Chapter / mission definitions |

### WebSocket Messages

**Client → Server:**
- `{ type: 'join', playerId, name, pfp, level, equipped }`
- `{ type: 'state', x, y, vx, vy, face, swing }`
- `{ type: 'dig', x, y }`
- `{ type: 'chat', text }`
- `{ type: 'event', kind, x, y, chapterId, missionId, depth }` — server computes XP (client `xp` amounts are ignored)

**Server → Client:**
- `{ type: 'init', playerId, seed, players, dugBlocks, playerCount }` (`seed` = shared world seed for the room)
- `{ type: 'join', playerId, name, pfp, level }`
- `{ type: 'leave', playerId, playerCount }`
- `{ type: 'states', players, playerCount }`
- `{ type: 'dig', playerId, x, y }`
- `{ type: 'chat', playerId, text, name }`

## Local Development

```bash
cd server
npx wrangler dev

# Connect from client at ws://localhost:8787/api/ws
```

## Profile Schema

```json
{
  "id": "fid:12345 or guest:uuid",
  "fid": 12345,
  "name": "Trencher",
  "pfp": "https://...",
  "level": 5,
  "xp": 1250,
  "best_depth": 127,
  "total_diamonds": 89,
  "total_digs": 5420,
  "deaths": 42,
  "play_time": 3600000,
  "inventory": [
    { "id": "uuid", "type": "pickaxe", "name": "Iron Pick", "rarity": 1, "digSpeed": 1.15, "foundAt": 1698456789000, "foundDepth": 45 }
  ],
  "equipped": {
    "pickaxe": "uuid",
    "helmet": null,
    "boots": null,
    "charm": null
  }
}
```

## Rate Limits

- Position updates: throttled to 20Hz client-side, 10Hz broadcast
- Chat: 1 message per 2 seconds, max 60 chars, profanity filtered
- XP claims: max 50 XP per second window, max 20 per claim

## Authentication

- **Farcaster users**: Verified via Quick Auth JWT in Authorization header
- **Privy users**: `Authorization: Bearer <Privy access token>` (ES256, JWKS `https://auth.privy.io/api/v1/apps/<appId>/jwks.json`, `iss` `privy.io`, `aud` = app id). Profile id is the Privy DID.
- **Guests**: Random ID + secret stored in localStorage

## CORS

Allowed origins:
- `https://base-trenches.pages.dev`
- `https://kuzikuu.github.io`
- `http://localhost:8080` (dev)
- `http://localhost:9999` (dev)

## Auth model

- **Guests**: id `guest:<uuid>`. The first save stores a SHA-256 of the client's `X-Guest-Secret` header (random, kept in localStorage); later saves must send the same secret.
- **Farcaster/Base**: id `fid:<fid>`. Saves require `Authorization: Bearer <Quick Auth JWT>` (RS256, iss `https://auth.farcaster.xyz`, aud = `base-trenches.pages.dev` or `kuzikuu.github.io`, sub = fid).
- **WebSocket**: browsers can't set headers, so the client passes `?token=` (Quick Auth) or `?profileId=&secret=` (guest). The Worker verifies them and the room only credits XP to that profile.
- XP / score / leaderboard are server-authoritative. Digs are checked against the shared dug map and rate-capped; dodges, hits, mission completions have per-minute plausibility caps.
- `PROFILES_SHARD` in index.js names the Profiles DO instance; change it to start a fresh leaderboard season.

## Deployed

- `https://base-trenches-server.base-trenches.workers.dev`
