// Save game validation. Pure logic (no Durable Object APIs) so node tests cover it.
//
// The server owns XP, level, inventory, skills and best depth. A save only adds the run
// snapshot: where you are, lives, run multiplier inputs and run time. Every client number is
// clamped against what the server has already verified for this profile.

import { levelForDepth, LEVEL_DEPTH_M, levelTopDepth } from './levels.js';

export const SAVE_VERSION = 1;
export const TS = 12;
export const FLOOR_TILE = 14;
export const WORLD_W_TILES = 40;
export const PLAYER_W = 8;
export const PLAYER_H = 11;
export const MAX_LIVES = 9;
export const DEPTH_SLACK_M = 3;        // client can be a few meters past the last verified depth
export const RUNTIME_SLACK_S = 20;
export const SAVE_MIN_GAP_MS = 15_000; // WebSocket autosave throttle per session
export const GEM_X = 1.05, POWER_X = 1.25, DEPTH_X = 1.09;
export const GEAR_TYPES = ['pickaxe', 'helmet', 'boots', 'charm'];
const SECTOR_RE = /^main(-[2-8])?$/;
const RUN_RE = /^[a-z0-9-]{4,40}$/i;

export function depthOfY(y) {
  return Math.max(0, Math.floor((Number(y) + PLAYER_H) / TS) - FLOOR_TILE);
}

export function yForDepth(depth) {
  // Player top y that puts the feet `depth` meters below the trench floor.
  return (FLOOR_TILE + Math.max(0, Math.floor(depth))) * TS - PLAYER_H;
}

export function computeMult(gems, power, maxDepth) {
  const m = Math.pow(GEM_X, gems) * Math.pow(POWER_X, power) * Math.pow(DEPTH_X, Math.floor(Math.max(0, maxDepth) / 25));
  return Math.round(m * 100) / 100;
}

const int = (v, d = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : d;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function emptyMeta(now = Date.now()) {
  return { g: 0, p: 0, since: now };
}

export function normalizeMeta(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return emptyMeta(now);
  return { g: Math.max(0, int(raw.g)), p: Math.max(0, int(raw.p)), since: int(raw.since, now) || now };
}

// Count server-credited rewards since the last save (called from Profiles.addXp).
export function noteCredit(meta, kind, now = Date.now()) {
  const m = normalizeMeta(meta, now);
  if (kind === 'diamond') m.g++;
  else if (kind === 'power') m.p++;
  return m;
}

export function sanitizeEquipped(equipped, inventory) {
  const out = { pickaxe: null, helmet: null, boots: null, charm: null };
  const inv = Array.isArray(inventory) ? inventory : [];
  if (!equipped || typeof equipped !== 'object') return out;
  for (const type of GEAR_TYPES) {
    const id = equipped[type];
    if (typeof id !== 'string') continue;
    const item = inv.find(g => g && g.id === id && g.type === type);
    if (item) out[type] = id;
  }
  return out;
}

/**
 * Validate a save request.
 * input: client snapshot { runId, x, y, lives, gems, powerGems, maxDepth, mult, runTime, seed, sector, depthBonusAt }
 * ctx: { prev, prevAt, meta, bestDepth, levelsUnlocked, now, serverPos: {x,y} | null }
 * Returns { ok, save, clamped: [field…], playDeltaMs }.
 */
export function sanitizeSave(input, ctx = {}) {
  const now = ctx.now || Date.now();
  if (!input || typeof input !== 'object') return { ok: false, error: 'bad_save' };
  const clamped = [];
  const prev = ctx.prev && typeof ctx.prev === 'object' ? ctx.prev : null;
  const meta = normalizeMeta(ctx.meta, now);
  const runId = typeof input.runId === 'string' && RUN_RE.test(input.runId) ? input.runId : null;
  if (!runId) return { ok: false, error: 'bad_run' };
  const sameRun = !!(prev && prev.runId === runId && !prev.dead);
  const bestDepth = Math.max(0, int(ctx.bestDepth), sameRun ? int(prev.depth) : 0);

  // Position: prefer the room's last known position (WebSocket autosave), else the client's.
  const src = ctx.serverPos && Number.isFinite(Number(ctx.serverPos.y)) ? ctx.serverPos : input;
  let x = Number(src.x), y = Number(src.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: 'bad_position' };
  const maxX = WORLD_W_TILES * TS - PLAYER_W;
  if (x < 0 || x > maxX) { x = clamp(x, 0, maxX); clamped.push('x'); }
  if (y < 0) { y = 0; clamped.push('y'); }
  let depth = depthOfY(y);
  const allowed = bestDepth + DEPTH_SLACK_M;
  if (depth > allowed) { depth = bestDepth; y = yForDepth(depth); clamped.push('depth'); }
  x = Math.round(x); y = Math.round(y);

  const lives = clamp(int(input.lives, MAX_LIVES), 1, MAX_LIVES);
  if (lives !== int(input.lives, -1)) clamped.push('lives');

  const gemCap = (sameRun ? int(prev.gems) : 0) + meta.g;
  const powCap = (sameRun ? int(prev.powerGems) : 0) + meta.p;
  let gems = Math.max(0, int(input.gems));
  let powerGems = Math.max(0, int(input.powerGems));
  if (gems > gemCap) { gems = gemCap; clamped.push('gems'); }
  if (powerGems > powCap) { powerGems = powCap; clamped.push('powerGems'); }

  let maxDepth = Math.max(depth, int(input.maxDepth));
  if (maxDepth > bestDepth + DEPTH_SLACK_M) { maxDepth = Math.max(depth, bestDepth); clamped.push('maxDepth'); }

  const fullMult = computeMult(gems, powerGems, maxDepth);
  let mult = Number(input.mult);
  if (!Number.isFinite(mult) || mult < 1) mult = 1;
  if (mult > fullMult + 0.01) { mult = fullMult; clamped.push('mult'); }
  mult = Math.round(mult * 100) / 100;

  const prevRunTime = sameRun ? Math.max(0, Number(prev.runTime) || 0) : 0;
  const since = sameRun ? int(ctx.prevAt, meta.since) : meta.since;
  const wall = Math.max(0, (now - since) / 1000);
  let runTime = Math.max(0, Number(input.runTime) || 0);
  const runCap = prevRunTime + wall + RUNTIME_SLACK_S;
  if (runTime > runCap) { runTime = runCap; clamped.push('runTime'); }
  runTime = Math.round(runTime * 10) / 10;
  const playDeltaMs = Math.round(Math.max(0, Math.min(runTime - prevRunTime, wall + RUNTIME_SLACK_S)) * 1000);

  let depthBonusAt = int(input.depthBonusAt, 25);
  depthBonusAt = clamp(depthBonusAt, 25, (Math.floor(maxDepth / 25) + 1) * 25);

  const save = {
    v: SAVE_VERSION,
    runId,
    x, y, depth,
    level: levelForDepth(depth, !!ctx.levelsUnlocked),
    lives, gems, powerGems, maxDepth, mult, depthBonusAt,
    runTime,
    secondWindUsed: !!input.secondWindUsed,
    seed: Number.isFinite(Number(input.seed)) ? int(input.seed) : null,
    sector: typeof (ctx.sector || input.sector) === 'string' && SECTOR_RE.test(ctx.sector || input.sector) ? (ctx.sector || input.sector) : null,
    savedAt: now
  };
  return { ok: true, save, clamped, playDeltaMs };
}

// After death: keep the checkpoint (top of the level you died on) and start a fresh run there.
export function deathCheckpoint(prev, ctx = {}) {
  const now = ctx.now || Date.now();
  const unlocked = !!ctx.levelsUnlocked;
  const level = prev && prev.level ? (unlocked ? Math.max(1, int(prev.level, 1)) : 1) : 1;
  if (level <= 1) return null; // level 1: a normal new run from the trench, like before saves
  const depth = levelTopDepth(level) + 2;
  return {
    v: SAVE_VERSION,
    runId: 'cp-' + now.toString(36),
    checkpoint: true,
    x: 20 * TS + 2, y: yForDepth(depth), depth,
    level,
    lives: MAX_LIVES, gems: 0, powerGems: 0, maxDepth: depth, mult: 1, depthBonusAt: (Math.floor(depth / 25) + 1) * 25,
    runTime: 0, secondWindUsed: false,
    seed: prev && prev.seed != null ? prev.seed : null,
    sector: prev && prev.sector || null,
    savedAt: now
  };
}

export { LEVEL_DEPTH_M };
