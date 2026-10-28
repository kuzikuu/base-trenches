# BASE TRENCHES · POWER OF 9

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

Any static host works. Drop the folder in as it is:
- **Vercel:** `npx vercel` in this folder (framework: "Other", no build command, output dir `.`).
- **Netlify:** drag-and-drop the folder onto app.netlify.com/drop, or `npx netlify deploy --dir . --prod`.
- **GitHub Pages:** push to a repo, then Settings → Pages → deploy from branch `/root`.
- **Domain:** something like `basetrenches.xyz` / `.fun`. Point it at the host and update `og:image` to an absolute URL.

`screens/` isn't needed in production apart from `screens/og.png` (the share card). Copy it to `/assets/og.png` if you prune.

---

## Known gaps / next steps
- Data is static EXAMPLE DATA. The bot, X polling and DexScreener price job still need to be built.
- "Game rounds" per pinned coin currently means the coin appears as a labelled diamond seam in the shared game. Seeded per-coin levels (`game_round.seed`) are the next step.
- No on-chain/wallet features, leaderboard submissions, or anti-cheat for game scores.
- Social links in `links` are placeholders.
- Not financial advice. Memes are volatile.
