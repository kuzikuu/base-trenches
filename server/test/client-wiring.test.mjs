// Browser-side wiring checks (no DOM): every client script parses, shared files load before
// their users, and a game snapshot round-trips through the server's save validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { sanitizeSave, yForDepth } from '../lib/save.js';

const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

test('every js/ file parses', () => {
  for (const f of readdirSync(new URL('js/', root)).filter(f => f.endsWith('.js'))) {
    assert.doesNotThrow(() => new Function(read('js/' + f)), f);
  }
});

test('index.html loads shared logic before its users, with one cache-bust version', () => {
  const html = read('index.html');
  const order = [...html.matchAll(/<script src="js\/([a-z-]+)\.js\?v=([a-z0-9]+)"/g)];
  const names = order.map(m => m[1]);
  const at = n => names.indexOf(n);
  for (const n of ['levels', 'skills', 'campaign', 'rpg', 'multiplayer', 'game', 'save', 'skilltree', 'main']) assert.ok(at(n) >= 0, n + ' missing');
  assert.ok(at('levels') < at('campaign'));
  assert.ok(at('skills') < at('game'));
  assert.ok(at('game') < at('save') && at('save') < at('main'));
  assert.ok(at('skilltree') < at('main'));
  assert.equal(new Set(order.map(m => m[2])).size, 1, 'mixed ?v= versions');
  for (const id of ['saveBtn', 'continueBtn', 'checkpointBtn', 'lvlChip', 'buildBtn']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('data-nav="skills"'));
});

test('a client snapshot (game.js shape) passes the server validator', () => {
  const src = read('js/game.js');
  const m = src.match(/return\{runId,x:[^}]+\}/);
  assert.ok(m, 'snapshot() shape not found');
  for (const k of ['runId', 'lives', 'gems', 'powerGems', 'maxDepth', 'mult', 'runTime', 'depthBonusAt', 'seed', 'secondWindUsed', 'dead']) assert.ok(m[0].includes(k), k);
  const snap = { runId: 'r-' + (123456789).toString(36), x: 242, y: yForDepth(30), lives: 9, gems: 0, powerGems: 0, maxDepth: 30, mult: 1.09, runTime: 50, depthBonusAt: 50, seed: 42, secondWindUsed: false, level: 1, dead: false };
  const r = sanitizeSave(snap, { prev: null, meta: { g: 0, p: 0, since: Date.now() - 60_000 }, bestDepth: 30, levelsUnlocked: false, now: Date.now() });
  assert.equal(r.ok, true);
  assert.equal(r.save.depth, 30);
  assert.equal(r.save.seed, 42);
});

test('the preview test login is only honoured by a preview server (client never trusts itself)', () => {
  const rpg = read('js/rpg.js');
  assert.ok(rpg.includes("window.BT_PREVIEW_TEST_AUTH !== true"));
  const cfg = read('js/config.js');
  assert.ok(!/BT_PREVIEW_TEST_AUTH\s*=\s*true/.test(cfg), 'config.js must not enable preview test auth');
});
