import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSave, sanitizeEquipped, deathCheckpoint, noteCredit, emptyMeta, depthOfY, yForDepth, computeMult } from '../lib/save.js';

const NOW = 1_800_000_000_000;
const base = (o = {}) => ({ runId: 'run-abc123', x: 242, y: yForDepth(40), lives: 7, gems: 0, powerGems: 0, maxDepth: 40, mult: 1.09, runTime: 100, depthBonusAt: 50, ...o });
const ctx = (o = {}) => ({ prev: null, meta: { g: 0, p: 0, since: NOW - 200_000 }, bestDepth: 42, levelsUnlocked: false, now: NOW, ...o });

test('y <-> depth round trip', () => {
  for (const d of [0, 1, 40, 589, 3000]) assert.equal(depthOfY(yForDepth(d)), d);
});

test('a normal save keeps position, lives, time', () => {
  const r = sanitizeSave(base(), ctx());
  assert.equal(r.ok, true);
  assert.equal(r.save.depth, 40);
  assert.equal(r.save.x, 242);
  assert.equal(r.save.lives, 7);
  assert.equal(r.save.runTime, 100);
  assert.equal(r.save.level, 1);
  assert.deepEqual(r.clamped, []);
});

test('depth past the verified best depth is pulled back', () => {
  const r = sanitizeSave(base({ y: yForDepth(900), maxDepth: 900 }), ctx());
  assert.ok(r.clamped.includes('depth'));
  assert.equal(r.save.depth, 42);
  assert.ok(r.save.maxDepth <= 45);
});

test('room-known position beats the client position', () => {
  const r = sanitizeSave(base({ y: yForDepth(10) }), ctx({ serverPos: { x: 100, y: yForDepth(30) } }));
  assert.equal(r.save.depth, 30);
  assert.equal(r.save.x, 100);
});

test('gems are capped by what the server credited', () => {
  let meta = emptyMeta(NOW - 100_000);
  meta = noteCredit(meta, 'diamond'); meta = noteCredit(meta, 'diamond'); meta = noteCredit(meta, 'power');
  const r = sanitizeSave(base({ gems: 50, powerGems: 9, mult: 9999 }), ctx({ meta }));
  assert.equal(r.save.gems, 2);
  assert.equal(r.save.powerGems, 1);
  assert.ok(r.clamped.includes('gems') && r.clamped.includes('mult'));
  assert.equal(r.save.mult, computeMult(2, 1, r.save.maxDepth));
});

test('same run keeps earlier gems', () => {
  const prev = { runId: 'run-abc123', gems: 5, powerGems: 1, runTime: 90, depth: 40 };
  const meta = noteCredit(emptyMeta(NOW - 10_000), 'diamond');
  const r = sanitizeSave(base({ gems: 6, powerGems: 1, runTime: 95 }), ctx({ prev, prevAt: NOW - 10_000, meta }));
  assert.equal(r.save.gems, 6);
  assert.equal(r.save.powerGems, 1);
});

test('run time cannot run ahead of the wall clock', () => {
  const prev = { runId: 'run-abc123', runTime: 50 };
  const r = sanitizeSave(base({ runTime: 99999 }), ctx({ prev, prevAt: NOW - 30_000 }));
  assert.ok(r.save.runTime <= 50 + 30 + 20);
  assert.ok(r.clamped.includes('runTime'));
  assert.ok(r.playDeltaMs <= 50_000);
});

test('lives, x and bad input are sanitized', () => {
  assert.equal(sanitizeSave(base({ lives: 99 }), ctx()).save.lives, 9);
  assert.equal(sanitizeSave(base({ lives: -3 }), ctx()).save.lives, 1);
  assert.equal(sanitizeSave(base({ x: 99999 }), ctx()).save.x, 472);
  assert.equal(sanitizeSave(base({ runId: '<script>' }), ctx()).ok, false);
  assert.equal(sanitizeSave(base({ y: 'abc' }), ctx()).ok, false);
  assert.equal(sanitizeSave(null, ctx()).ok, false);
  assert.equal(sanitizeSave(base({ sector: 'evil' }), ctx()).save.sector, null);
  assert.equal(sanitizeSave(base({ sector: 'main-3' }), ctx()).save.sector, 'main-3');
});

test('level is computed by the server, not the client', () => {
  const deep = base({ y: yForDepth(600), maxDepth: 600, level: 99 });
  assert.equal(sanitizeSave(deep, ctx({ bestDepth: 600 })).save.level, 1);
  assert.equal(sanitizeSave(deep, ctx({ bestDepth: 600, levelsUnlocked: true })).save.level, 2);
});

test('death: level 1 clears, level 2+ checkpoints at the top of the level', () => {
  assert.equal(deathCheckpoint({ level: 1 }, { levelsUnlocked: true, now: NOW }), null);
  const cp = deathCheckpoint({ level: 3, seed: 7, sector: 'main' }, { levelsUnlocked: true, now: NOW });
  assert.equal(cp.level, 3);
  assert.equal(cp.depth, 589 * 2 + 2);
  assert.equal(cp.lives, 9);
  assert.equal(cp.gems, 0);
  assert.equal(deathCheckpoint({ level: 3 }, { levelsUnlocked: false, now: NOW }), null);
});

test('equipped gear must be owned', () => {
  const inv = [{ id: 'a', type: 'pickaxe' }, { id: 'b', type: 'helmet' }];
  assert.deepEqual(sanitizeEquipped({ pickaxe: 'a', helmet: 'zzz', boots: 'b', charm: { x: 1 } }, inv),
    { pickaxe: 'a', helmet: null, boots: null, charm: null });
});
