# BASE TRENCHES · POWER OF 9

**Live:** https://base-trenches.pages.dev/ (Cloudflare Pages, mini app root) · mirror: https://kuzikuu.github.io/base-trenches/

**Manifesting 589x.** This is the website and game prototype for Base Trenches, an anonymous meme-coin crew on Base.

The site *is* a game. You play a helmeted trencher with a pickaxe in a WW1 trench. You dig down through the dirt, dodge machine-gun sweeps and artillery, and mine blue diamonds to push your multiplier from x1 toward **x589**. Dug-outs along the trench are labelled **HOT LIST**, **CALLS**, **CALLERS** and **HOW TO**, and each one opens a panel. Every panel is also in the top menu, so the site works without playing.

> ⚠️ Everything in `data/calls.json` is **EXAMPLE DATA**: fake tickers (`$EXAMPLE1`…), fake contracts (`0x000…0001`) and fake handles (`@caller_demo1`). The UI labels it that way. Swap in real data once the bot is live.

---

## Run it locally

No build step. These are plain static files (HTML/CSS/JS plus `<canvas>`).

```bash
cd base-trenches
python3 -m http.server 8080      # or: npx serve .
# open http://localhost:8080
```

(It has to be served over http. Opening `index.html` as `file://` blocks the `fetch` of `data/calls.json`.)

Deep links: `/#hot`, `/#calls`, `/#callers`, `/#about`, `/#play`.

### Controls
| Action | Keyboard | Touch |
|---|---|---|
| Move | ← → / A D | ◀ ▶ |
| Jump / climb a shaft wall | ↑ / W (hold against a wall to climb) | ▲ |
| Aim down / up | ↓ / S, ↑ / W | ▼ ▲ |
| Dig | Space (or J) | ⛏ |
| Enter a dug-out | E / Enter | E |
| Mute | M or the SND button | SND button |
| Close panel | Esc | ✕ |

### Game rules
- **9 lives** (the blue squares, top left). A bullet costs 1, an artillery blast 2, and a falling boulder 1.
- Machine-gun **sweeps** are announced with a pink `>>!` lane warning and fly along the trench. Jump them, or dig a foxhole.
- **Artillery** shells whistle in, aimed near you, and fall down any open shaft. Dig sideways to stay safe.
- Loose **boulders** fall when you dig out what's under them. **UXB** shells buried in the dirt arm themselves when you hit them, so run.
- Blue gems: **×1.05**. Hot-list **power seams** are 3×3 clusters labelled with a hot-list ticker, each gem **×1.25**, and mining all 9 "powers up" the coin. Every 25 m of depth adds **×1.09**.
- Milestones: x9 (POWER OF 9), x58.9, x100, **x589 MANIFESTED**. Your best score is saved in localStorage.
- Game over screen: **ONE LIFE. ITS WORTH AN ATTEMPT.**

---

## Files

```
index.html          markup, menus, overlays
css/style.css       white + Base blue, dithering, responsive
js/font.js          3x5 pixel font for crisp in-canvas labels
js/audio.js         WebAudio chiptune SFX (no audio files)
js/pickaxe.js       3D point-cloud pickaxe, ordered-dithered, stepped 10fps ("TRENCHER PROGRAM" spinner)
js/data.js          loads data/calls.json, derives stats, renders the panels
js/game.js          the game (tiles, physics, bullets, artillery, particles, camera)
js/main.js          wiring: loader, nav/hash routing, HUD, touch controls
data/calls.json     ← single source of truth (bot writes here)
assets/fonts/       Press Start 2P + VT323 (OFL, self-hosted)
screens/            screenshots + gameplay.mp4 (not needed for deploy)
vercel.json/_headers  short cache on /data so updates show up fast
```

---

## Data schema: `data/calls.json`

The site only **reads** this file. The Telegram bot (or a backend or GitHub Action) **writes** it. Everything else (multiples, hit rate, best call, ranking, hot-list order) is derived in the browser, so the bot only stores raw facts.

```jsonc
{
  "meta": {
    "schema_version": 1,
    "example_data": true,              // set false when real; the UI keeps showing labels while true
    "updated_at": "2026-10-27T23:00:00Z",
    "chain": "base",
    "thresholds": { "tags": 9, "comments": 5, "retweets": 8, "likes": 9 },
    "hit_multiple": 2                  // a call counts as a "hit" when ATH >= 2x
  },
  "links": { "x": "https://x.com/YOUR_X_HANDLE", "telegram": "https://t.me/YOUR_TELEGRAM_GROUP" },

  "coins": [{                          // every coin ever tagged
    "id": "c1", "ticker": "EXAMPLE1", "name": "Example Dig (fake)", "chain": "base",
    "contract": "0x…", "dexscreener_url": null, "image": null
  }],

  "callers": [{                        // members who get credit for calls
    "id": "u1", "alias": "caller_demo1",
    "x_handle": "@caller_demo1", "telegram_handle": "@tg_demo1_example",
    "joined_at": "2026-03-11T12:00:00Z"
  }],

  "watchlist": [{                      // = HOT LIST, coins currently powering up
    "coin_id": "c11",
    "caller_id": "u4",                 // first person to tag it = the caller
    "status": "tagging | powered | pinned",
    "first_tagged_at": "…",
    "tags": [{ "telegram_handle": "@member_demo1", "tagged_at": "…" }],   // unique taggers, 9 = powered
    "x_post": { "url": "https://x.com/…/status/…", "comments": 5, "retweets": 8, "likes": 9, "checked_at": "…" } | null,
    "game_round": { "id": "round-c11", "seed": 11 } | null    // set when pinned
  }],

  "calls": [{                          // = PREVIOUS CALLS, immutable call record + price tracking
    "id": "call1", "coin_id": "c1", "caller_id": "u1",
    "called_at": "…",
    "call_price_usd": 0.00012, "call_mcap_usd": 120000,     // frozen at call time
    "current_price_usd": …, "current_mcap_usd": …,            // refreshed by a price job
    "ath_mcap_usd": …, "ath_at": "…",                         // max(current, previous ath)
    "status": "open | closed",
    "x_post_url": "…", "telegram_msg_url": "…"
  }]
}
```

Derived in `js/data.js`:
- `ath_x = ath_mcap_usd / call_mcap_usd`, `cur_x = current_mcap_usd / call_mcap_usd`
- caller `hit_rate = hits / calls` (hit = `ath_x >= meta.hit_multiple`), `best = max(ath_x)`
- hot-list sort: pinned → powered → tagging, then by progress

---

## How the Telegram bot should feed the site

**Flow (Power of 9):**
1. A member runs `/tag <contract or $TICKER>` in the group. The bot resolves the coin on Base (DexScreener), creates `coins[]` and `callers[]` entries if they're new, and adds a `watchlist` entry with `caller_id` set to the first tagger.
2. Each unique Telegram user adds to `tags[]`. Dedupe by Telegram user id; one tag per person per coin.
3. At **9 tags** → `status: "powered"`. The bot pings the group and the X account bull-posts the meme. Store `x_post.url`.
4. A job polls the X post (X API) every few minutes for comments, retweets and likes. At **5 / 8 / 9** → `status: "pinned"`: pin the message in Telegram, set `game_round`, and append a `calls[]` record that freezes `call_price_usd` / `call_mcap_usd` at that moment.
5. A price job (every 5–15 min) updates `current_*` and `ath_*` for open calls from DexScreener (`GET https://api.dexscreener.com/latest/dex/tokens/<address>`).

**How to publish the JSON (pick one):**
- **Easiest, no server for the site:** keep the site in a GitHub repo. The bot commits `data/calls.json` through the GitHub Contents API (or a scheduled GitHub Action rebuilds it), and Vercel, Netlify or Pages redeploys in about 30 s.
- **Live:** host the JSON on object storage (Cloudflare R2, S3 or Supabase Storage) or a tiny API (`GET /calls.json`), then change the URL in `BT.load()` (`js/data.js`). Keep the CORS header on.
- Later, add a **Supabase/Postgres** backend with the same shape and expose a view that returns this JSON.

Keep the bot's tokens server-side. The site never needs a secret.

---

## Hosting

Any static host works. Drop the folder in as it is.

### GitHub Pages

Already configured. Push to `main` and Pages deploys automatically.

**Limitation:** GitHub Pages serves under `/base-trenches/` subpath. The `/.well-known/farcaster.json` manifest cannot be served at the root domain, so GitHub Pages is fine for testing but **Cloudflare Pages is recommended for production** (custom domain at root).

### Cloudflare Pages (recommended)

Two deployment options:

**Option A: Git integration (easiest)**
1. Go to Cloudflare Dashboard → Workers & Pages → Create → Pages
2. Connect your GitHub repo
3. Build command: (leave empty)
4. Build output directory: `/` (or leave empty)
5. Deploy

**Option B: CLI / GitHub Actions**
1. Create a Pages project: `npx wrangler pages project create base-trenches`
2. Deploy: `npx wrangler pages deploy . --project-name=base-trenches`
3. Or use the GitHub Actions workflow (`.github/workflows/cloudflare-pages.yml`) by adding these repository secrets:
   - `CLOUDFLARE_API_TOKEN` (create at dash.cloudflare.com/profile/api-tokens with "Edit Cloudflare Workers" permissions)
   - `CLOUDFLARE_ACCOUNT_ID` (found in your dashboard URL or Workers & Pages overview)

The workflow only runs if the secrets exist (skips silently otherwise).

### Custom domain

Once on Cloudflare Pages, add your custom domain (e.g. `basetrenches.xyz`). Then update these URLs in:
- `index.html`: `og:image`, `og:url`, `fc:miniapp` meta tag
- `.well-known/farcaster.json`: all URLs (`homeUrl`, `iconUrl`, `splashImageUrl`, `heroImageUrl`, `ogImageUrl`, `screenshotUrls`)
- `js/miniapp.js`: `BT_HOME_URL` at the top (or set `window.BT_HOME_URL` before loading)

---

## Base App / Farcaster Mini App

The site works as a **Farcaster Mini App** inside the Base app or any Farcaster client. Features:

- **Haptics:** tactile feedback on dig hits, block breaks, damage, gem collection, and UI interactions. Uses Farcaster SDK haptics when available, falls back to `navigator.vibrate` (Android Chrome). Toggle with the VIB button.
- **User greeting:** shows the user's Farcaster username on the title screen
- **Share:** game-over share button opens Farcaster cast composer (or X intent as fallback)
- **Safe-area insets:** respects the host's navigation chrome

### Signing the manifest (required)

The `.well-known/farcaster.json` manifest has **placeholder** `accountAssociation` values. You must sign it to verify domain ownership:

1. Deploy to your final domain (e.g. Cloudflare Pages with custom domain)
2. Ensure `/.well-known/farcaster.json` is accessible at `https://yourdomain.com/.well-known/farcaster.json`
3. Go to the [Mini App Manifest Tool](https://warpcast.com/~/developers/mini-apps/manifest) in your desktop browser
4. Enter your domain and scroll to the bottom
5. Click "Claim Ownership" and sign with your Farcaster custody address using your phone (Warpcast)
6. Copy the full signed manifest and replace the contents of `.well-known/farcaster.json`

The signed manifest will look like:
```json
{
  "accountAssociation": {
    "header": "eyJmaWQiOjEyMzQ1...",
    "payload": "eyJkb21haW4iOiJ5b3VyZG9tYWluLmNvbSJ9",
    "signature": "MHgwZmJiYWIw..."
  },
  "miniapp": { ... }
}
```

### Manifest fields to customize

Update these in `.well-known/farcaster.json` before signing:
- `noindex`: set to `false` when ready to appear in Farcaster app stores
- `webhookUrl`: add if you want to receive notification events
- `screenshotUrls`: replace with proper 1284×2778 portrait screenshots (max 3)

---

## Files
```
index.html                HTML, menus, overlays, fc:miniapp embed meta
css/style.css             white + Base blue, dithering, responsive, safe-area
js/font.js                3x5 pixel font for in-canvas labels
js/audio.js               WebAudio chiptune SFX (no audio files)
js/haptics.js             Haptic feedback (SDK or vibrate fallback)
js/miniapp.js             Farcaster Mini App SDK integration
js/pickaxe.js             3D pickaxe, ordered-dithered, 10fps
js/data.js                loads data/calls.json, derives stats, renders panels
js/game.js                the game (tiles, physics, bullets, artillery, particles)
js/main.js                wiring: loader, nav, HUD, touch, mini-app init
data/calls.json           ← single source of truth (bot writes here)
assets/fonts/             Press Start 2P + VT323 (OFL, self-hosted)
assets/icon-1024.png      Mini-app icon (1024×1024, no alpha)
assets/splash.png         Mini-app splash screen (200×200)
screens/                  Screenshots + og.png (share card)
.well-known/farcaster.json  Farcaster manifest (sign before production)
_headers                  Cloudflare Pages headers (CORS, caching)
wrangler.toml             Cloudflare Pages/Wrangler config
vercel.json               Vercel config (optional)
```

---

## Known gaps / next steps
- Data is static EXAMPLE DATA. The bot, X polling and DexScreener price job still need to be built.
- "Game rounds" per pinned coin currently means the coin appears as a labelled diamond seam in the shared game. Seeded per-coin levels (`game_round.seed`) are the next step.
- No on-chain/wallet features, leaderboard submissions, or anti-cheat for game scores.
- Social links in `links` are placeholders.
- **iOS Safari:** does not support `navigator.vibrate`, so haptics are silent on iOS outside the Farcaster host app.
- Not financial advice. Memes are volatile.
