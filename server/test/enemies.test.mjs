import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.WebSocketRequestResponsePair ??= class {};
import {
  THEMES, CRAWLERS, CRAWLER_KINDS, LEVEL_DEPTH_M, crawlersFor, crawlerStats, crawlerTier, bossStats, inBossZone, bossBand,
  killXp, bossXp, elevatorStops, validElevatorStop, difficulty, themeFor, BOSS_MIN_FIGHT_MS
} from '../lib/levels.js';
import { scoreValidatedEvent, createXpWindow, validateKill, validateBossKill, noteBossSpawn, EVENT_KINDS, SERVER_XP_KINDS } from '../lib/xp.js';
import { yForDepth, elevatorStart } from '../lib/save.js';
const mod = await import('../index.js');

const TRADEMARKS = /gremlin|xenomorph|alien|shai|hulud|dune|fremen|\btron\b|pac-?man|mario|zelda|pokemon|doom|predator|jaws|starship/i;

test('every theme has two original crawlers with known behaviours', () => {
  for (const th of THEMES) {
    const pair = CRAWLERS[th.id];
    assert.ok(pair && pair.length === 2, th.id);
    for (const c of pair) {
      assert.ok(CRAWLER_KINDS.includes(c.kind), c.id + ' kind');
      assert.match(c.body, /^#[0-9a-f]{6}$/i); assert.match(c.eye, /^#[0-9a-f]{6}$/i);
      assert.doesNotMatch(c.name, TRADEMARKS, 'original names only: ' + c.name);
      assert.ok(c.tag && c.tag.length <= 40);
    }
  }
  const ids = Object.values(CRAWLERS).flat().map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'unique crawler ids');
  for (const L of [1, 2, 7, 8, 14]) assert.equal(crawlersFor(L), CRAWLERS[themeFor(L).id]);
});

test('desert theme is level 2 and the other themes shift down one', () => {
  assert.deepEqual(THEMES.map(t => t.id), ['trenches', 'sands', 'mines', 'chalk', 'flooded', 'ember', 'core']);
  assert.equal(themeFor(1).id, 'trenches');
  assert.equal(themeFor(2).id, 'sands');
  assert.equal(themeFor(3).id, 'mines');
  assert.equal(themeFor(7).id, 'core');
  // callouts are our own lines, not quotes
  for (const c of Object.values(CRAWLERS).flat()) assert.doesNotMatch(c.tag || '', /without rhythm|know more/i);
  for (const t of THEMES) assert.doesNotMatch(t.blurb, /without rhythm|know more/i);
  assert.equal(difficulty(1).enemyCount, 0, 'old raider count unchanged');
});

test('crawlers spawn on level 1 too and scale with depth and level', () => {
  const top = crawlerStats(1, 0), mid = crawlerStats(1, 300), l3 = crawlerStats(3, 0), l20 = crawlerStats(20, 0);
  assert.ok(top.maxAlive >= 2 && top.hp >= 1, 'level 1 has crawlers');
  assert.ok(mid.spawnEvery < top.spawnEvery);
  assert.ok(l3.hp > top.hp && l3.speed > top.speed && l3.maxAlive > top.maxAlive);
  assert.ok(l20.maxAlive <= 12 && l20.spawnEvery >= 1.1 && l20.speed <= 84, 'free-plan friendly caps');
  assert.equal(top.secondaryChance, 0, 'only the primary near the surface');
  assert.equal(crawlerTier(233), 1);
  assert.equal(crawlerTier(LEVEL_DEPTH_M + 5), 2);
});

test('Sandmaw boss: stats scale per level and it lives near the floor', () => {
  const b1 = bossStats(1), b5 = bossStats(5);
  assert.equal(b1.name, 'SANDMAW');
  assert.ok(b5.hp > b1.hp && b5.speed > b1.speed && b5.lungeEvery < b1.lungeEvery);
  assert.ok(b1.hp <= 20 && b1.exposed >= 1.5, 'beatable solo on level 1');
  assert.equal(inBossZone(233), false);
  assert.equal(inBossZone(540), true);
  assert.equal(inBossZone(LEVEL_DEPTH_M + 10), false);
  assert.equal(bossBand(540), 1); assert.equal(bossBand(LEVEL_DEPTH_M * 2 - 20), 2);
  assert.ok(bossXp(1) >= 60 && bossXp(99) <= 240);
  assert.ok(killXp(1) >= 2 && killXp(99) <= 8);
});

test('kill events: need a position, depth, and a nearby tile; XP from the room level', () => {
  assert.ok(EVENT_KINDS.has('kill') && EVENT_KINDS.has('bossKill'));
  assert.equal(SERVER_XP_KINDS.has('kill'), false);
  const y = yForDepth(100), x = 20 * 12;
  assert.equal(validateKill({ x: 20, y: 114, playerX: x, playerY: null }).reason, 'no_position');
  assert.equal(validateKill({ x: 20, y: 15, playerX: x, playerY: yForDepth(2) }).reason, 'too_shallow');
  assert.equal(validateKill({ x: 35, y: 114, playerX: x, playerY: y }).reason, 'too_far');
  assert.equal(validateKill({ x: 21, y: 114, playerX: x, playerY: y }).ok, true);
  let win = createXpWindow();
  const r = scoreValidatedEvent({ kind: 'kill', x: 21, y: 114, level: 999 }, { playerX: x, playerY: y, level: 1, window: win });
  assert.equal(r.ok, true); assert.equal(r.xp, killXp(1), 'client level ignored');
  // per-minute cap
  let n = 0; win = createXpWindow(); const now = Date.now();
  for (let i = 0; i < 60; i++) { const o = scoreValidatedEvent({ kind: 'kill', x: 21, y: 114 }, { playerX: x, playerY: y, level: 1, window: win, now: now + i }); win = o.window; if (o.ok) n++; }
  assert.ok(n <= 30, 'kills capped per minute: ' + n);
});

test('bossKill needs a spawn the room saw in the same band, 15 s of fight, once per band', () => {
  const t0 = 1_000_000, yZone = yForDepth(545), slain = new Set();
  assert.equal(noteBossSpawn({ playerY: yForDepth(200), now: t0 }), null, 'no spawn outside the zone');
  const boss = noteBossSpawn({ playerY: yZone, now: t0 });
  assert.deepEqual(boss, { band: 1, t: t0 });
  assert.equal(validateBossKill({ boss: null, slain, playerY: yZone, now: t0 + 20000 }).reason, 'no_spawn');
  assert.equal(validateBossKill({ boss, slain, playerY: yZone, now: t0 + 3000 }).reason, 'too_fast');
  assert.equal(validateBossKill({ boss, slain, playerY: yForDepth(100), now: t0 + 20000 }).reason, 'not_in_zone');
  assert.equal(validateBossKill({ boss: { band: 2, t: t0 }, slain, playerY: yZone, now: t0 + 20000 }).reason, 'no_spawn');
  const ctx = { boss, slain, playerY: yZone, level: 1, window: createXpWindow(), now: t0 + BOSS_MIN_FIGHT_MS + 1 };
  const r = scoreValidatedEvent({ kind: 'bossKill' }, ctx);
  assert.equal(r.ok, true); assert.equal(r.xp, bossXp(1)); assert.equal(r.band, 1);
  const again = scoreValidatedEvent({ kind: 'bossKill' }, { ...ctx, window: r.window });
  assert.equal(again.ok, false); assert.equal(again.reason, 'already_slain');
});

test('elevator: locked mode never offers level 2+', () => {
  const locked = elevatorStops({ bestDepth: 4000, maxLevel: 7, unlocked: false });
  // Locked = classic endless level 1: every stop is a level-1 shaft stop, never a level top.
  assert.ok(locked.every(s => s.level === 1 && s.depth <= 4000 && !/LEVEL/.test(s.label)), JSON.stringify(locked));
  assert.ok(locked.length <= 12);
  assert.equal(locked[0].label, 'SURFACE');
  assert.deepEqual(elevatorStops({ bestDepth: 233, unlocked: false }).map(s => s.depth), [0, 100, 200]);
  assert.equal(validElevatorStop(LEVEL_DEPTH_M + 2, { bestDepth: 4000, maxLevel: 7, unlocked: false }), null);
  assert.equal(validElevatorStop(150, { bestDepth: 400, unlocked: false }), null, 'only listed stops');
  const open = elevatorStops({ bestDepth: 1300, maxLevel: 3, unlocked: true });
  assert.deepEqual(open.map(s => s.depth), [0, LEVEL_DEPTH_M + 2, 2 * LEVEL_DEPTH_M + 2]);
  assert.equal(elevatorStops({ bestDepth: 0, maxLevel: 1, unlocked: true }).length, 1);
  assert.ok(elevatorStops({ bestDepth: 99999, maxLevel: 200, unlocked: true }).length <= 12);
  const sv = elevatorStart({ depth: 200 }, { now: 5, levelsUnlocked: false });
  assert.equal(sv.depth, 200); assert.equal(sv.mult, 1); assert.equal(sv.checkpoint, true); assert.equal(sv.level, 1);
  assert.equal(sv.y, yForDepth(200)); assert.equal(sv.depthBonusAt, 225);
});

// Minimal fake of the Profiles SQL for the DO methods.
function fakeProfiles(row, envExtra = {}) {
  const writes = [];
  const sql = { exec: (q, ...args) => { if (/^\s*SELECT/i.test(q)) return { toArray: () => row ? [row] : [] }; writes.push([q.replace(/\s+/g, ' ').trim(), args]); return { toArray: () => [] }; } };
  const self = Object.create(mod.Profiles.prototype);
  self.sql = sql; self.env = { ...envExtra };
  return { self, writes };
}

test('Profiles /elevator: validates the stop and writes a checkpoint save; locked = level 1 only', async () => {
  const row = { id: 'did:privy:a', best_depth: 1500, max_level: 3, save_state: null, migrated_to: null };
  let { self, writes } = fakeProfiles(row, { LEVELS_UNLOCKED: '0' });
  let r = await (await self.rideElevator({ profileId: 'did:privy:a', depth: LEVEL_DEPTH_M + 2 })).json();
  assert.equal(r.ok, false); assert.equal(r.error, 'bad_stop');
  assert.equal(writes.length, 0);
  r = await (await self.rideElevator({ profileId: 'did:privy:a', depth: 500 })).json();
  assert.equal(r.ok, true); assert.equal(r.save.depth, 500); assert.equal(r.save.level, 1);
  assert.match(writes[0][0], /UPDATE profiles SET save_state/);
  r = await (await self.getElevator('did:privy:a')).json();
  assert.ok(r.stops.every(s => s.level === 1));
  ({ self } = fakeProfiles(row, { LEVELS_UNLOCKED: '1' }));
  r = await (await self.rideElevator({ profileId: 'did:privy:a', depth: LEVEL_DEPTH_M * 2 + 2 })).json();
  assert.equal(r.ok, true); assert.equal(r.save.level, 3);
  r = await (await self.rideElevator({ profileId: 'guest:x', depth: 0 })).json();
  assert.equal(r.error, 'login_required');
});

test('/api/elevator needs a real login', async () => {
  const e = { PROFILES: { idFromName: n => n, get: () => ({ fetch: async () => Response.json({ ok: true }) }) }, PRIVY_APP_ID: '' };
  const r = await mod.default.fetch(new Request('https://x/api/elevator', { method: 'POST', body: '{"depth":0}' }), e);
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.ok(j.stops.every(s => s.level === 1));
});

function xpRow(extra = {}) {
  return { id: 'p1', xp: 0, level: 1, best_depth: 545, max_level: 1, inventory: '[]', titles: '[]', campaign: '{}', bosses: '{}', save_meta: '{}', created_at: 1, ...extra };
}
test('Profiles addXp: boss pays only in a verified boss zone; first kill per band drops gear', async () => {
  let { self, writes } = fakeProfiles(xpRow());
  let r = await (await self.addXp({ profileId: 'p1', xp: 500, depth: 545, eventKind: 'bossKill', band: 1 })).json();
  assert.equal(r.success, true); assert.equal(r.added, bossXp(1)); assert.equal(r.bossFirst, true); assert.ok(r.gearDrop);
  assert.ok(writes.some(w => /SET bosses/.test(w[0]) && w[1][0] === '{"1":1}'));
  ({ self } = fakeProfiles(xpRow({ bosses: '{"1":1}' })));
  r = await (await self.addXp({ profileId: 'p1', xp: 500, depth: 545, eventKind: 'bossKill', band: 1 })).json();
  assert.equal(r.bossFirst, false); assert.equal(r.gearDrop, null);
  // a spoofed position far below the verified best depth earns nothing
  ({ self } = fakeProfiles(xpRow({ best_depth: 100 })));
  r = await (await self.addXp({ profileId: 'p1', xp: 500, depth: 545, eventKind: 'bossKill', band: 1 })).json();
  assert.equal(r.added, 0); assert.equal(r.gearDrop, null);
  ({ self } = fakeProfiles(xpRow({ best_depth: 300 })));
  r = await (await self.addXp({ profileId: 'p1', xp: 99, depth: 300, eventKind: 'kill' })).json();
  assert.equal(r.added, killXp(1));
});

test('client wiring: crawlers report kills, boss reports spawn/kill, Medic second wind is reachable', async () => {
  const { readFileSync } = await import('node:fs');
  const g = readFileSync(new URL('../../js/game.js', import.meta.url), 'utf8');
  assert.match(g, /sendEvent\(\{kind:'kill',x:/);
  assert.match(g, /sendEvent\(\{kind:'bossSpawn'\}\)/);
  assert.match(g, /sendEvent\(\{kind:'bossKill'\}\)/);
  assert.doesNotMatch(g, /function hurt\(n,fx,/, 'hurt() must not shadow the skills fx');
  for (const id of Object.values(CRAWLERS).flat().map(c => c.id)) assert.ok(g.includes(id + ':['), 'sprite for ' + id);
  const m = readFileSync(new URL('../../js/main.js', import.meta.url), 'utf8');
  assert.match(m, /\/api\/elevator/);
});
