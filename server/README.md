# Base Trenches Multiplayer Server

Cloudflare Worker with Durable Objects for real-time multiplayer and RPG progression.

## Architecture

- **TrenchRoom DO**: Real-time WebSocket room with hibernation API. Handles player state broadcasting at 10Hz, presence, chat, dug blocks sync, and XP validation.
- **Profiles DO**: SQLite-backed player profiles. Stores level, XP, inventory, equipped gear, stats.

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
- Durable Objects: `TrenchRoom`, `Profiles`
- SQLite migration: `v1` (creates Profiles table)

### After deploy

1. Note the Workers URL (e.g., `https://base-trenches-server.yourname.workers.dev`)
2. Update `js/config.js` in the client with this URL
3. Deploy the client to Cloudflare Pages

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/ws?room=main` | GET | WebSocket upgrade for multiplayer |
| `/api/profile?id=X` | GET | Get profile by ID |
| `/api/profile` | POST | Save profile (JSON body) |
| `/api/leaderboard?type=xp` | GET | Top 50 by XP or depth |

### WebSocket Messages

**Client → Server:**
- `{ type: 'join', playerId, name, pfp, level, equipped }`
- `{ type: 'state', x, y, vx, vy, face, swing }`
- `{ type: 'dig', x, y }`
- `{ type: 'chat', text }`
- `{ type: 'xp', xp, depth, profileId }`

**Server → Client:**
- `{ type: 'init', playerId, players, dugBlocks, playerCount }`
- `{ type: 'join', playerId, name, pfp, level }`
- `{ type: 'leave', playerId }`
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
- **Guests**: Random ID + secret stored in localStorage, unverified

## CORS

Allowed origins:
- `https://base-trenches.pages.dev`
- `https://kuzikuu.github.io`
- `http://localhost:8080` (dev)
- `http://localhost:9999` (dev)
