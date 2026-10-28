import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.WebSocketRequestResponsePair ??= class {};
import {
  THEMES, CRAWLERS, themeFor, crawlersFor, bossFor, bossStats, bossMinFightMs, BOSS_MIN_FIGHT_MS, PUNK_MIN_FIGHT_MS,
  PUNK_BOSS, PUNK_SLOGANS, elevatorStops, levelChapter, levelForDepth, LEVEL_DEPTH_M
} from '../lib/levels.js';
import { noteBossSpawn, validateBossKill, scoreValidatedEvent, createXpWindow } from '../lib/xp.js';
import { yForDepth } from '../lib/save.js';

const root = new URL('../../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const PUNK_LEVEL = 8;
const bandFloorY = L => yForDepth(L * LEVEL_DEPTH_M - 20);

test('Attack of the Punks is level 8, right after The Base Core, then the cycle repeats', () => {
  assert.equal(THEMES.length, 8);
  assert.equal(themeFor(7).id, 'core');
  const t = themeFor(PUNK_LEVEL);
  assert.equal(t.id, 'punks');
  assert.equal(t.name, 'Attack of the Punks');
  assert.equal(t.props, 'punks');
  assert.ok(t.mottos.length >= 1);
  assert.equal(themeFor(9).id, 'trenches');
  assert.equal(themeFor(16).id, 'punks');
  assert.equal(themeFor(16).cycle, 1);
  assert.equal(crawlersFor(PUNK_LEVEL), CRAWLERS.punks);
  assert.deepEqual(CRAWLERS.punks.map(c => c.id), ['pixelpunk', 'mohawker']);
  assert.match(levelChapter(PUNK_LEVEL).brief, /Attack of the Punks/);
});

test('slogans, mottos and boss lines only use verified, sourced Base phrases', () => {
  const verified = new Set(PUNK_SLOGANS.map(s => s.text));
  for (const s of PUNK_SLOGANS) assert.match(s.src, /^https:\/\/x\.com\/(base|jessepollak)\/status\/\d+$/);
  for (const m of themeFor(PUNK_LEVEL).mottos) assert.ok(verified.has(m), m);
  for (const l of PUNK_BOSS.lines) assert.ok(verified.has(l), l);
  for (const c of CRAWLERS.punks) assert.ok(verified.has(c.tag), c.tag);
  assert.ok(PUNK_BOSS.defeat.includes('NEW WEEK, SAME TEAM, STAY BASED, KEEP BUILDING'));
});

test('Builder #001 is a friendly tribute with the not-affiliated note and the sampled PFP', () => {
  assert.equal(PUNK_BOSS.note, 'FAN TRIBUTE · NOT AFFILIATED WITH BASE OR COINBASE');
  assert.match(PUNK_BOSS.intro, /CHALLENGES YOU TO BUILD ONCHAIN/);
  const all = [PUNK_BOSS.intro, PUNK_BOSS.defeat, ...PUNK_BOSS.lines].join(' ');
  assert.doesNotMatch(all, /\b(kill|killed|die|dead|destroy|loser|scam|rug|stupid|idiot|felled|villain)\b/i);
  assert.match(PUNK_BOSS.src, /^https:\/\/pbs\.twimg\.com\/profile_images\//);
  assert.equal(PUNK_BOSS.sprite.length, 24);
  for (const r of PUNK_BOSS.sprite) {
    assert.equal(r.length, 24);
    for (const ch of r) assert.ok(ch === '.' || PUNK_BOSS.palette[ch], 'palette ' + ch);
  }
  const flat = PUNK_BOSS.sprite.join('');
  assert.ok((flat.match(/h/g) || []).length > 120, 'big blonde hair');
  assert.ok(flat.includes('gggggb'), 'the vape with the blue tip');
});

test('the punk boss only guards the punks band, and only with levels unlocked', () => {
  assert.equal(bossFor(PUNK_LEVEL, true), 'punk');
  assert.equal(bossFor(16, true), 'punk');
  for (const L of [1, 2, 7, 9]) assert.equal(bossFor(L, true), 'sandmaw');
  for (const L of [1, 2, 7, 8, 16]) assert.equal(bossFor(L, false), 'sandmaw', 'locked: never the punk boss');
  const p = bossStats(PUNK_LEVEL, 'punk'), s = bossStats(PUNK_LEVEL);
  assert.equal(p.name, 'BUILDER #001'); assert.equal(s.name, 'SANDMAW');
  assert.ok(p.hp > s.hp && p.dropEvery > 0 && p.swoopEvery === 3);
  assert.equal(bossMinFightMs('punk'), PUNK_MIN_FIGHT_MS);
  assert.equal(bossMinFightMs('sandmaw'), BOSS_MIN_FIGHT_MS);
});

test('server: punk spawn only counts unlocked in the punks band; the kill needs 20 s of fight', () => {
  const t0 = 2_000_000, y8 = bandFloorY(PUNK_LEVEL), y7 = bandFloorY(7);
  assert.equal(noteBossSpawn({ playerY: y8, now: t0, claimed: 'punk', unlocked: false }), null, 'locked prod refuses a punk spawn');
  assert.equal(noteBossSpawn({ playerY: y7, now: t0, claimed: 'punk', unlocked: true }), null, 'wrong band');
  assert.deepEqual(noteBossSpawn({ playerY: y8, now: t0, unlocked: false }), { band: PUNK_LEVEL, t: t0, id: 'sandmaw' }, 'locked depth 4.7 km: Sandmaw');
  const boss = noteBossSpawn({ playerY: y8, now: t0, claimed: 'punk', unlocked: true });
  assert.deepEqual(boss, { band: PUNK_LEVEL, t: t0, id: 'punk' });
  const slain = new Set();
  assert.equal(validateBossKill({ boss, slain, playerY: y8, now: t0 + 16_000 }).reason, 'too_fast', 'Sandmaw-length fight is not enough');
  assert.equal(validateBossKill({ boss, slain, playerY: y8, now: t0 + PUNK_MIN_FIGHT_MS + 1 }).ok, true);
  const out = scoreValidatedEvent({ kind: 'bossKill' }, { boss, slain: new Set(), playerY: y8, level: PUNK_LEVEL, window: createXpWindow(), now: t0 + PUNK_MIN_FIGHT_MS + 1 });
  assert.ok(out.ok && out.xp > 0 && out.band === PUNK_LEVEL);
});

test('locked prod never shows the punks: level 1 forever, elevator level-1 only', () => {
  assert.equal(levelForDepth(PUNK_LEVEL * LEVEL_DEPTH_M - 10, false), 1);
  const stops = elevatorStops({ bestDepth: 5000, maxLevel: 9, unlocked: false });
  assert.ok(stops.every(s => s.level === 1 && !/PUNK/i.test(s.label)));
  assert.ok(elevatorStops({ bestDepth: 5000, maxLevel: 9, unlocked: true }).some(s => /ATTACK OF THE PUNKS/.test(s.label)));
});

test('client wiring: punk boss routing, tribute note on the bar, spawn tells the server which boss', () => {
  const g = read('js/game.js');
  assert.match(g, /LV\.bossFor\(band,levelsOn\)==="punk"\)return spawnPunk\(band\)/);
  assert.match(g, /sendEvent\(\{kind:'bossSpawn',boss:'punk'\}\)/);
  assert.match(g, /LV\.PUNK_BOSS\.note/);
  assert.match(g, /pixelpunk:\[/); assert.match(g, /mohawker:\[/);
  assert.match(g, /case "punks":/);
  assert.match(g, /LV\.CRAWLERS\.sands/, 'Sandmaw summons spice mites, whatever level 7 is');
  const shared = read('js/levels.js');
  assert.match(shared, /Attack of the Punks/);
  assert.match(read('server/index.js'), /claimed: typeof data\.boss === 'string'/);
});
