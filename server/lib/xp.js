// Server-authoritative XP: score validated events with per-kind and per-minute caps.
// Used by TrenchRoom and by node tests. No Durable Object APIs here.
import { P9 } from './power9.js';
import { killXp, bossXp, inBossZone, bossBand, CRAWLER_MIN_DEPTH_M, BOSS_MIN_FIGHT_MS, bossFor, bossMinFightMs } from './levels.js';

export const XP = {
  DIG: 1,
  DIAMOND: 5,
  POWER: 10,
  DEPTH: 2,       // per 5m milestone
  DODGE: 3,
  HIT: 1,
  SURVIVE: 5,     // survived a barrage (shell exploded, player not in blast)
  RELIC: 15,
  MISSION: 25,
  BOSS: 100
};

// Plausibility caps in a rolling 60s window. Digs are also gated by the shared map.
export const CAPS_PER_MINUTE = {
  dig: 90,
  dodge: 24,
  hit: 20,
  survive: 20,
  relic: 3,
  mission: 6,
  boss: 2,
  diamond: 30,
  power: 15,
  depth: 20,
  kill: 30,
  bossKill: 2,
  xp: 250
};

export const DIG_MAX_DIST_TILES = 4;
export const TILE_SIZE = 12;
export const DEPTH_STEP_M = 5;
export const TRENCH_FLOOR_TILE = 14; // S+2 in the client (S=12)

export const EVENT_KINDS = new Set([
  'dig', 'dodge', 'hit', 'survive', 'relic', 'mission', 'boss', 'diamond', 'power', 'depth', 'kill', 'bossKill'
]);
// Crawler kills must be near where the room last saw the trencher.
export const KILL_MAX_DIST_TILES = 7;

// XP for these comes from the server-side campaign definition, and only when
// Profiles actually completes the mission. The room only rate-limits them.
export const SERVER_XP_KINDS = new Set(['mission', 'boss']);
// Rewards found inside a tile (diamond / power gem / relic) must reference a tile
// this same session dug in the last REWARD_WINDOW_MS, once per kind per tile.
export const REWARD_KINDS = new Set(['diamond', 'power', 'relic']);
export const REWARD_WINDOW_MS = 15_000;

export function createXpWindow() {
  return { events: [], xp: 0 };
}

export function pruneWindow(win, now, windowMs = 60_000) {
  if (!win) return createXpWindow();
  win.events = (win.events || []).filter(e => now - e.t < windowMs);
  win.xp = win.events.reduce((s, e) => s + (e.xp || 0), 0);
  return win;
}

export function countKind(win, kind) {
  return (win.events || []).filter(e => e.kind === kind).length;
}

export function xpForKind(kind, extra = {}) {
  // POWER OF 9 boost (server-wide, set by the room from the Pulse DO, never by the client).
  const boost = extra.boost === true ? P9.BOOST_BONUS_XP : 0;
  switch (kind) {
    case 'dig': return XP.DIG;
    case 'diamond': return XP.DIAMOND + boost;
    case 'power': return XP.POWER + boost;
    case 'depth': return XP.DEPTH;
    case 'dodge': return XP.DODGE;
    case 'hit': return XP.HIT;
    case 'survive': return XP.SURVIVE;
    case 'relic': return XP.RELIC + boost;
    // Level comes from the room's verified position (and Profiles re-caps it by best depth).
    case 'kill': return killXp(extra.level || 1);
    case 'bossKill': return bossXp(extra.level || 1);
    // Never trust a client-supplied amount: mission/boss XP is awarded by Profiles.
    case 'mission': return 0;
    case 'boss': return 0;
    default: return 0;
  }
}

export function tileKey(x, y) {
  return `${Math.floor(x)},${Math.floor(y)}`;
}

export function depthFromY(y, floorTile = TRENCH_FLOOR_TILE, tileSize = TILE_SIZE) {
  if (!Number.isFinite(Number(y))) return 0;
  return Math.max(0, Math.floor(Number(y) / tileSize) - floorTile);
}

/**
 * Dig must name a finite tile that is not already dug, and (when we have a
 * recent player position) must be within DIG_MAX_DIST_TILES of the trencher.
 */
export function validateDig({ dugSet, x, y, playerX, playerY, tileSize = TILE_SIZE } = {}) {
  const bx = Math.floor(Number(x));
  const by = Math.floor(Number(y));
  if (!Number.isFinite(bx) || !Number.isFinite(by)) return { ok: false, reason: 'bad_tile' };
  const key = tileKey(bx, by);
  if (dugSet && dugSet.has(key)) return { ok: false, reason: 'already_dug' };
  if (playerX != null && playerY != null && Number.isFinite(Number(playerX)) && Number.isFinite(Number(playerY))) {
    const dx = Number(playerX) / tileSize - (bx + 0.5);
    const dy = Number(playerY) / tileSize - (by + 0.5);
    if (dx * dx + dy * dy > DIG_MAX_DIST_TILES * DIG_MAX_DIST_TILES) {
      return { ok: false, reason: 'too_far' };
    }
  }
  return { ok: true, x: bx, y: by, key };
}

/** A crawler kill: finite tile near the trencher, below the crawler line. */
export function validateKill({ x, y, playerX, playerY, tileSize = TILE_SIZE } = {}) {
  const bx = Number(x), by = Number(y);
  if (!Number.isFinite(bx) || !Number.isFinite(by)) return { ok: false, reason: 'bad_tile' };
  if (playerX == null || playerY == null || !Number.isFinite(Number(playerX)) || !Number.isFinite(Number(playerY))) return { ok: false, reason: 'no_position' };
  const depth = depthFromY(playerY, TRENCH_FLOOR_TILE, tileSize);
  if (depth < CRAWLER_MIN_DEPTH_M - 2) return { ok: false, reason: 'too_shallow' };
  const dx = Number(playerX) / tileSize - (Math.floor(bx) + 0.5);
  const dy = Number(playerY) / tileSize - (Math.floor(by) + 0.5);
  if (dx * dx + dy * dy > KILL_MAX_DIST_TILES * KILL_MAX_DIST_TILES) return { ok: false, reason: 'too_far' };
  return { ok: true, depth };
}

/**
 * The Sandmaw: the room must have seen this session's boss spawn in the same band's boss zone
 * at least BOSS_MIN_FIGHT_MS ago, the trencher must still be in the zone, once per band per session.
 * boss: { band, t } | null ; slain: Set of bands already paid this session.
 */
export function validateBossKill({ boss, slain, playerY, now = Date.now() } = {}) {
  if (playerY == null || !Number.isFinite(Number(playerY))) return { ok: false, reason: 'no_position' };
  const depth = depthFromY(playerY);
  if (!inBossZone(depth, 12)) return { ok: false, reason: 'not_in_zone' };
  const band = bossBand(depth);
  if (!boss || boss.band !== band) return { ok: false, reason: 'no_spawn' };
  if (now - boss.t < (boss.id ? bossMinFightMs(boss.id) : BOSS_MIN_FIGHT_MS)) return { ok: false, reason: 'too_fast' };
  if (slain && slain.has(band)) return { ok: false, reason: 'already_slain' };
  return { ok: true, band, depth };
}

/**
 * Boss spawn notice: only counts inside a boss zone. `claimed` is the boss the client says woke up;
 * it must be the one that guards this band (bossFor), so e.g. a punk-boss spawn is refused while
 * levels are locked. The id sets the minimum fight time for the kill.
 */
export function noteBossSpawn({ playerY, now = Date.now(), claimed, unlocked = false } = {}) {
  if (playerY == null || !Number.isFinite(Number(playerY))) return null;
  const depth = depthFromY(playerY);
  if (!inBossZone(depth, 4)) return null;
  const band = bossBand(depth);
  const id = bossFor(band, unlocked);
  if (claimed != null && claimed !== id) return null;
  return { band, t: now, id };
}

export function validateDepth({ depth, lastAwarded = 0, playerY } = {}) {
  const d = Math.max(0, Math.floor(Number(depth) || 0));
  if (!d) return { ok: false, reason: 'no_depth' };
  if (d - lastAwarded < DEPTH_STEP_M) return { ok: false, reason: 'too_soon' };
  if (playerY != null) {
    const fromPos = depthFromY(playerY);
    if (d > fromPos + 2) return { ok: false, reason: 'depth_mismatch' };
  }
  return { ok: true, depth: d };
}

/**
 * A reward (diamond / power / relic) must name a tile dug by this session within
 * REWARD_WINDOW_MS that has not already paid out that reward kind.
 * recentDigs: Map tileKey -> { by, t, claimed: Set<kind> }
 */
export function validateReward({ recentDigs, sessionId, kind, x, y, now = Date.now() } = {}) {
  const bx = Math.floor(Number(x));
  const by = Math.floor(Number(y));
  if (!Number.isFinite(bx) || !Number.isFinite(by)) return { ok: false, reason: 'bad_tile' };
  const key = tileKey(bx, by);
  const rec = recentDigs && recentDigs.get(key);
  if (!rec || rec.by !== sessionId || now - rec.t > REWARD_WINDOW_MS) return { ok: false, reason: 'not_your_dig' };
  if (rec.claimed && rec.claimed.has(kind)) return { ok: false, reason: 'already_claimed' };
  return { ok: true, key, rec };
}

/**
 * Apply a scored event to a rolling window. Returns { ok, xp, reason, window }.
 * `precheck` may already have rejected map/depth/mission rules.
 */
export function applyEvent(win, event, now = Date.now()) {
  win = pruneWindow(win || createXpWindow(), now);
  const kind = event && event.kind;
  if (!EVENT_KINDS.has(kind)) return { ok: false, reason: 'bad_kind', xp: 0, window: win };
  const cap = CAPS_PER_MINUTE[kind];
  if (cap != null && countKind(win, kind) >= cap) {
    return { ok: false, reason: 'rate_kind', xp: 0, window: win };
  }
  const xp = Math.max(0, Math.floor(xpForKind(kind, event)));
  if (!xp && kind !== 'hit' && !SERVER_XP_KINDS.has(kind)) return { ok: false, reason: 'no_xp', xp: 0, window: win };
  // The boss pays out in one lump (validated separately), so it is not held to the per-minute XP cap.
  if (kind !== 'bossKill' && win.xp + xp > (event.boost === true ? P9.BOOST_XP_CAP : CAPS_PER_MINUTE.xp)) {
    return { ok: false, reason: 'rate_xp', xp: 0, window: win };
  }
  win.events.push({ t: now, kind, xp });
  win.xp += xp;
  return { ok: true, xp, reason: null, window: win };
}

/**
 * Full validation + scoring for one client event against shared room state.
 * ctx: { dugSet, playerX, playerY, lastDepthAwarded, now, window }
 */
export function scoreValidatedEvent(event, ctx = {}) {
  const now = ctx.now != null ? ctx.now : Date.now();
  // The boost flag only ever comes from the room (ctx), never from the client's event.
  if (event && typeof event === 'object') event = { ...event, boost: ctx.boost === true };
  const kind = event && event.kind;
  if (REWARD_KINDS.has(kind)) {
    const r = validateReward({ recentDigs: ctx.recentDigs, sessionId: ctx.sessionId, kind, x: event.x, y: event.y, now });
    if (!r.ok) return { ok: false, reason: r.reason, xp: 0, window: ctx.window };
    const out = applyEvent(ctx.window, event, now);
    if (out.ok) { r.rec.claimed = r.rec.claimed || new Set(); r.rec.claimed.add(kind); }
    return out;
  }
  if (kind === 'dig') {
    const dig = validateDig({
      dugSet: ctx.dugSet,
      x: event.x,
      y: event.y,
      playerX: ctx.playerX,
      playerY: ctx.playerY,
      tileSize: ctx.tileSize
    });
    if (!dig.ok) return { ok: false, reason: dig.reason, xp: 0, window: ctx.window };
  }
  if (kind === 'kill') {
    const k = validateKill({ x: event.x, y: event.y, playerX: ctx.playerX, playerY: ctx.playerY, tileSize: ctx.tileSize });
    if (!k.ok) return { ok: false, reason: k.reason, xp: 0, window: ctx.window };
    return applyEvent(ctx.window, { kind, level: ctx.level || 1 }, now);
  }
  if (kind === 'bossKill') {
    const k = validateBossKill({ boss: ctx.boss, slain: ctx.slain, playerY: ctx.playerY, now });
    if (!k.ok) return { ok: false, reason: k.reason, xp: 0, window: ctx.window };
    const out = applyEvent(ctx.window, { kind, level: ctx.level || 1 }, now);
    if (out.ok) { out.band = k.band; if (ctx.slain) ctx.slain.add(k.band); }
    return out;
  }
  if (kind === 'depth') {
    const d = validateDepth({
      depth: event.depth,
      lastAwarded: ctx.lastDepthAwarded || 0,
      playerY: ctx.playerY
    });
    if (!d.ok) return { ok: false, reason: d.reason, xp: 0, window: ctx.window };
  }
  return applyEvent(ctx.window, event, now);
}

export function levelFromXp(xp, base = 100, mult = 1.5) {
  let level = 1;
  let total = 0;
  const n = Math.max(0, Math.floor(Number(xp) || 0));
  while (total + Math.floor(base * Math.pow(mult, level - 1)) <= n) {
    total += Math.floor(base * Math.pow(mult, level - 1));
    level++;
    if (level > 999) break;
  }
  return level;
}

export function xpForLevel(level, base = 100, mult = 1.5) {
  return Math.floor(base * Math.pow(mult, Math.max(1, level) - 1));
}
