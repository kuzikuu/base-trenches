// Power of 9: in-game hot list, server-wide meter + boost, 9-streaks, perks, 589 m, leaderboards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  P9, P9_POINTS, sanitizeTicker, collectibleKey, keyLabel, noteStreak, perkTier, perkFor, perkCrossed, manifestCrossed,
  periodKeys, isGuestId, publicName, feedText, chargeMeter, boostActive, mergeRow, rankRows, meterMax, topKeys, bucketOf
} from '../lib/power9.js';
import { PulseCore } from '../lib/pulse.js';
import { xpForKind, scoreValidatedEvent, createXpWindow, applyEvent } from '../lib/xp.js';

globalThis.WebSocketRequestResponsePair ??= class { constructor(a, b) { this.a = a; this.b = b; } };
const { TrenchRoom, anonymizeBoard } = await import('../index.js');
const root = new URL('../../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);

test('tickers: sanitized, and only hot-list tickers count as coins', () => {
  assert.equal(sanitizeTicker('$toby'), 'TOBY');
  assert.equal(sanitizeTicker('<script>'), null);
  assert.equal(sanitizeTicker(''), null);
  const allow = new Set(['TOBY']);
  assert.equal(collectibleKey('power', 'toby', allow), '$TOBY');
  assert.equal(collectibleKey('power', 'SCAM', allow), 'POWER GEM', 'naming a coin cannot promote it');
  assert.equal(collectibleKey('diamond', 'TOBY', allow), 'GEM');
  assert.equal(collectibleKey('relic', null, allow), 'RELIC');
  assert.ok(keyLabel('$TOBY').includes('TOBY'));
});

test('9-streak: nine pickups each within the gap', () => {
  let st = null, hits = 0;
  for (let i = 0; i < 9; i++) { const r = noteStreak(st, T0 + i * 5000); st = r.st; if (r.hit) hits++; }
  assert.equal(hits, 1);
  const r = noteStreak(st, T0 + 9 * 5000 + P9.STREAK_GAP_MS + 1);
  assert.equal(r.hit, false); assert.equal(r.st.n, 1, 'a long gap resets the streak');
});

test('perks every 9 levels (capped) and 589 m manifest crossings', () => {
  assert.equal(perkTier(8), 0); assert.equal(perkTier(9), 1); assert.equal(perkTier(18), 2); assert.equal(perkTier(999), P9.PERK_MAX_TIER);
  assert.equal(perkFor(9).digSpeed, 1.03);
  assert.match(perkFor(18).label, /POWER OF 9 PERK 2/);
  assert.equal(perkCrossed(8, 9), 1); assert.equal(perkCrossed(9, 10), 0); assert.equal(perkCrossed(5, 30), 3);
  assert.equal(manifestCrossed(500, 600), 589);
  assert.equal(manifestCrossed(600, 700), 0);
  assert.equal(manifestCrossed(1000, 1200), 1178);
});

test('periods, names and feed text', () => {
  const pk = periodKeys(T0);
  assert.equal(pk.day, 'd:2026-10-28'); assert.match(pk.week, /^w:2026-W\d\d$/); assert.equal(pk.all, 'all');
  assert.ok(isGuestId('guest:abc')); assert.ok(!isGuestId('did:privy:x'));
  assert.equal(publicName('kuzi', '@kuzi', true), 'anon trencher');
  assert.equal(publicName('Kuzi', '@kuzi', false), '@kuzi');
  assert.equal(feedText({ kind: 'dig', who: '@k', key: '$TOBY', n: 9, depth: 312 }), '@k dug up 9x $TOBY at 312 m');
  assert.match(feedText({ kind: 'manifest', who: '@k', depth: 589 }), /MANIFESTING 589 m/);
  assert.match(feedText({ kind: 'boost' }), /POWER OF 9/);
  assert.equal(meterMax({}), P9.METER_MAX); assert.equal(meterMax({ P9_METER_MAX: '18' }), 18);
});

test('meter: fills, fires a timed boost, carries the overflow, queues a boost during a boost', () => {
  let r = chargeMeter({ meter: 90, max: 99, boost: null }, 12, T0);
  assert.equal(r.fired, true); assert.equal(r.meter, 3);
  assert.equal(r.boost.until - r.boost.start, P9.BOOST_MS);
  assert.ok(boostActive(r.boost, T0 + 1000)); assert.ok(!boostActive(r.boost, T0 + P9.BOOST_MS + 1));
  const r2 = chargeMeter({ meter: 98, max: 99, boost: r.boost }, 5, T0 + 1000);
  assert.equal(r2.fired, true); assert.equal(r2.boost.start, r.boost.until);
});

test('boards: depth is a max, the rest add up; zero rows hidden', () => {
  let row = mergeRow(null, { name: 'a', depth: 300, gems: 2, boss: 0, p9: 5 });
  row = mergeRow(row, { name: 'a', depth: 100, gems: 3, boss: 1, p9: 30 });
  assert.deepEqual(row, { name: 'a', depth: 300, gems: 5, boss: 1, p9: 35 });
  const rows = rankRows([{ id: 'x', ...row }, { id: 'y', name: 'b', depth: 0, gems: 0, boss: 0, p9: 1 }], 'boss');
  assert.equal(rows.length, 1);
});

test('PulseCore: hot list windows, allowlist, guests never on the boards, boost + contributors', () => {
  const c = new PulseCore(18);
  c.allow = new Set(['TOBY']);
  const out = c.ingest({
    counts: { 'P:TOBY': 9, GEM: 4, 'P:FAKE': 2, RELIC: 1, bogus: 5 },
    players: [
      { id: 'did:privy:a', name: '@a', guest: false, depth: 312, gems: 13, boss: 0, p9: 12 },
      { id: 'guest:g', name: 'anon trencher', guest: true, depth: 900, gems: 3, boss: 0, p9: 9 }
    ],
    feed: [{ kind: 'dig', who: '@a', key: 'P:TOBY', n: 9, depth: 312 }, { kind: 'evil', who: 'x' }]
  }, T0);
  assert.ok(out.fired, '21 points >= 18 fills the meter');
  assert.equal(c.meter, 3);
  assert.deepEqual(c.lastCharge.map(x => x.name), ['@a', 'anon trencher']);
  const st = c.state(T0 + 1000);
  assert.deepEqual(st.hot.h1.map(r => [r.key, r.n]), [['$TOBY', 9], ['GEM', 4], ['POWER GEM', 2], ['RELIC', 1]]);
  assert.equal(st.feed[0].kind, 'boost');
  assert.equal(st.feed.length, 2, 'unknown feed kinds dropped');
  assert.ok(st.boost && st.boost.until > T0);
  const lb = c.leaders('depth', 'day', T0 + 1000);
  assert.deepEqual(lb.rows.map(r => r.id), ['did:privy:a'], 'guests are not ranked');
  // an hour later the 1h window is empty but 24h / all-time keep it
  const later = c.state(T0 + 3600_000 + P9.BUCKET_MS);
  assert.equal(later.hot.h1.length, 0);
  assert.equal(later.hot.h24[0].key, '$TOBY');
  assert.equal(later.hot.all[0].key, '$TOBY');
  // next day: the daily board resets, all-time stays
  assert.equal(c.leaders('gems', 'day', T0 + 86400_000).rows.length, 0);
  assert.equal(c.leaders('gems', 'all', T0 + 86400_000).rows[0].gems, 13);
});

test('PulseCore: batch limits clamp a hostile room', () => {
  const c = new PulseCore(99);
  c.ingest({ counts: { GEM: 1e9 }, points: 1e9, players: [{ id: 'did:privy:z', name: 'z', p9: 1e9, gems: 1e9, boss: 1e9, depth: 1e12 }] }, T0);
  assert.ok(c.allTime.GEM <= P9.MAX_COUNT_PER_KEY);
  const r = c.leaders('boss', 'all', T0).rows[0];
  assert.ok(r.boss <= 20 && r.gems <= 2000 && r.p9 <= 2000);
  assert.ok(c.meter < 99);
});

test('boost XP is server-side only: the client cannot set it', () => {
  assert.equal(xpForKind('diamond', { boost: true }) - xpForKind('diamond'), P9.BOOST_BONUS_XP);
  assert.equal(xpForKind('dig', { boost: true }), xpForKind('dig'));
  const recent = () => new Map([['4,30', { by: 's1', t: T0, claimed: new Set() }]]);
  const ev = { kind: 'diamond', x: 4, y: 30, boost: true };
  const noBoost = scoreValidatedEvent(ev, { recentDigs: recent(), sessionId: 's1', now: T0 + 10, window: createXpWindow() });
  const boosted = scoreValidatedEvent({ kind: 'diamond', x: 4, y: 30 }, { recentDigs: recent(), sessionId: 's1', now: T0 + 10, window: createXpWindow(), boost: true });
  assert.ok(noBoost.ok && boosted.ok);
  assert.equal(boosted.xp - noBoost.xp, P9.BOOST_BONUS_XP);
});

test('existing RANKS: guest rows are anonymized', () => {
  const b = anonymizeBoard({ leaderboard: [{ id: 'guest:1', name: 'Bob', x_handle: '@bob', pfp: 'x' }, { id: 'did:privy:a', name: 'A' }] });
  assert.deepEqual(b.leaderboard[0], { id: null, name: 'Anon trencher', x_handle: null, pfp: null, wallet: null, anon: true });
  assert.equal(b.leaderboard[1].name, 'A');
});

function fakeRoom(pulse) {
  const sockets = [];
  const stub = { fetch: async () => new Response('{"success":true}') };
  const pstub = { fetch: async (req) => { const b = await req.json(); const out = pulse.ingest(b, Date.now()); void out; return new Response(JSON.stringify(pulse.live(Date.now(), Number(new URL(req.url).searchParams.get('since')) || 0))); } };
  const env = { PROFILES: { idFromName: () => 'p', get: () => stub }, EVENTS: { idFromName: () => 'e', get: () => stub }, PULSE: { idFromName: () => 'q', get: () => pstub }, BOTS_ENABLED: '0' };
  const m = new Map([['seed', 1]]);
  const state = {
    storage: { get: async (k) => Array.isArray(k) ? new Map() : m.get(k), put: async (k, v) => { m.set(k, v); } },
    blockConcurrencyWhile: (fn) => fn(), setWebSocketAutoResponse() {},
    getWebSockets: () => sockets.filter(w => !w.closed), getWebSocketAutoResponseTimestamp: () => null
  };
  return { room: new TrenchRoom(state, env), sockets };
}
const fakeWs = (att) => ({ att, sent: [], deserializeAttachment() { return this.att; }, serializeAttachment(a) { this.att = a; }, send(m) { this.sent.push(JSON.parse(m)); }, close() {} });

test('room: validated pickups → counts, feed, streak, manifest, perk → Pulse → broadcast', async () => {
  const pulse = new PulseCore(18); pulse.allow = new Set(['TOBY']);
  const { room, sockets } = fakeRoom(pulse);
  const ws = fakeWs({ sessionId: 's1', verifiedProfileId: 'did:privy:k', name: 'Kuzi', xHandle: '@kuzi', y: 300 });
  sockets.push(ws);
  const now = Date.now();
  for (let i = 0; i < 9; i++) room.p9Note(ws, ws.att, { kind: 'power', ticker: 'toby' }, { success: true, added: 13 }, 1, now + i * 1000);
  assert.equal(room.p9.counts['P:TOBY'], 9);
  assert.ok(ws.sent.some(m => m.type === 'p9' && m.kind === 'streak'));
  room.p9Note(ws, ws.att, { kind: 'depth' }, { success: true, added: 5, bestDepth: 600, prevBestDepth: 580, leveledUp: true, newLevel: 9 }, 8, now + 10_000);
  assert.ok(ws.sent.some(m => m.type === 'p9' && m.kind === 'manifest' && m.depth === 589));
  assert.ok(ws.sent.some(m => m.type === 'p9' && m.kind === 'perk' && m.tier === 1));
  // a rejected / zero-credit event never counts
  room.p9Note(ws, ws.att, { kind: 'diamond' }, { success: true, added: 0 }, 9, now + 11_000);
  assert.equal(room.p9.counts.GEM, undefined);
  clearTimeout(room.p9Timer); room.p9Timer = null;
  await room.p9Flush(true);
  const pl = ws.sent.filter(m => m.type === 'pulse').pop();
  assert.ok(pl, 'room broadcast the pulse');
  assert.ok(pl.boost && pl.boost.until > now, '9×3 + 9 + 9 + 9 points fill an 18 meter');
  assert.ok(pl.feed.some(f => f.kind === 'dig' && f.key === '$TOBY' && f.n === 9));
  assert.ok(pl.feed.some(f => f.kind === 'manifest'));
  assert.equal(pulse.leaders('p9', 'day').rows[0].name, '@kuzi');
  assert.equal(room.p9.boost.until, pl.boost.until, 'the room scores the next events as boosted');
  clearTimeout(room.p9Timer);
});

test('room: bots never count; guests show as anon trencher', () => {
  const { room } = fakeRoom(new PulseCore());
  const bot = fakeWs({ sessionId: 'b', verifiedProfileId: 'bot:1', name: 'Recruit' });
  room.p9Note(bot, bot.att, { kind: 'diamond' }, { success: true, added: 3 }, 1, Date.now());
  assert.equal(Object.keys(room.p9.counts).length, 0);
  const g = fakeWs({ sessionId: 'g', verifiedProfileId: 'guest:zz', name: 'Real Name' });
  room.p9Note(g, g.att, { kind: 'diamond' }, { success: true, added: 3 }, 1, Date.now());
  assert.equal(room.p9.feed[0].who, 'anon trencher');
  assert.equal(room.p9.players.get('guest:zz').guest, true);
  clearTimeout(room.p9Timer);
});

test('client wiring: ticker rides with power gems, pulse/p9 handlers, hot list + RANKS hooks', () => {
  const game = read('js/game.js'), mp = read('js/multiplayer.js'), main = read('js/main.js'), ui = read('js/pulse-ui.js'), html = read('index.html');
  assert.match(game, /sendEvent\(\{kind:'power',x,y,ticker:s\?s\.ticker:null\}\)/);
  assert.match(game, /p9Perk\)/);
  assert.ok(game.includes("MANIFESTING 589x"));
  assert.ok(mp.includes("case 'pulse':") && mp.includes("case 'p9':") && mp.includes('onPulse,'));
  assert.ok(main.includes('BTPulse.hotSection()') && main.includes('data-lbp'));
  for (const m of ['gems', 'boss', 'p9']) assert.ok(main.includes(`data-lb="${m}"`), m);
  assert.ok(ui.includes('/api/pulse/leaders') && ui.includes('IN-GAME HOT LIST'));
  const names = [...html.matchAll(/<script src="js\/([a-z0-9-]+)\.js\?v=/g)].map(m => m[1]);
  assert.ok(names.indexOf('power9') >= 0 && names.indexOf('power9') < names.indexOf('pulse-ui'));
  assert.ok(names.indexOf('multiplayer') < names.indexOf('pulse-ui') && names.indexOf('pulse-ui') < names.indexOf('main'));
  assert.ok(read('js/power9.js').includes('BTPower9'));
});
