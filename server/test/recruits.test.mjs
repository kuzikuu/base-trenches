import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LINES, EMOTES, BANNED, targetRecruitCount, createRecruit, stepRecruit, isBotId, emoteReply, publicRecruit, MIN_X, MAX_X, FLOOR_Y
} from '../lib/recruits.js';
import { parseGeo, geoHeader, aggregateGeo } from '../lib/geo.js';

globalThis.WebSocketRequestResponsePair ??= class { constructor(a, b) { this.a = a; this.b = b; } };
const { TrenchRoom } = await import('../index.js');

function fakeWs(att = {}) {
  return {
    att, sent: [],
    deserializeAttachment() { return this.att; },
    serializeAttachment(a) { this.att = a; },
    send(m) { this.sent.push(typeof m === 'string' ? JSON.parse(m) : m); },
    close() {}
  };
}
function fakeRoom() {
  const sockets = [];
  const calls = { profiles: 0, events: 0 };
  const stub = (k) => ({ fetch: async () => { calls[k]++; return new Response(JSON.stringify({ success: true, added: 1 })); } });
  const env = {
    PROFILES: { idFromName: () => 'p', get: () => stub('profiles') },
    EVENTS: { idFromName: () => 'e', get: () => stub('events') }
  };
  const state = {
    storage: { get: async () => 123, put: async () => {} },
    blockConcurrencyWhile: (fn) => fn(),
    setWebSocketAutoResponse() {},
    getWebSockets: () => sockets
  };
  const room = new TrenchRoom(state, env);
  return { room, sockets, calls };
}
async function joinHuman(ctx, name, geo) {
  const ws = fakeWs({ sessionId: crypto.randomUUID(), verifiedProfileId: 'guest:00000000-0000-4000-8000-000000000000', joined: Date.now(), geo });
  ctx.sockets.push(ws);
  await ctx.room.handleJoin(ws, { name }, ws.att);
  return ws;
}

test('recruit target fills a quiet room and ramps down as humans join', () => {
  assert.equal(targetRecruitCount(0), 0);
  assert.equal(targetRecruitCount(1), 10);
  assert.equal(targetRecruitCount(3), 8);
  assert.equal(targetRecruitCount(11), 0);
  assert.equal(targetRecruitCount(40), 0);
  for (let h = 1; h < 15; h++) assert.ok(targetRecruitCount(h + 1) <= targetRecruitCount(h));
});

test('canned lines never shill coins, make money claims or tag people', () => {
  for (const l of [...LINES, ...EMOTES]) {
    assert.ok(!BANNED.test(l), l);
    assert.ok(!/@\w/.test(l), l);
    assert.ok(l.length <= 60, l);
  }
});

test('recruits walk on the trench floor and stay in bounds', () => {
  let seed = 1; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const b = createRecruit(1, rng, 0);
  assert.ok(isBotId(b.id) && b.bot === true);
  let chats = 0;
  for (let t = 0; t < 600; t++) {
    chats += stepRecruit(b, t * 1000, rng, { recruits: 8 }).filter(e => e.type === 'chat').length;
    assert.ok(b.x >= MIN_X && b.x <= MAX_X);
    assert.equal(b.y, FLOOR_Y);
  }
  assert.ok(chats >= 1 && chats < 30, 'chat is occasional: ' + chats);
  assert.equal(publicRecruit(b).bot, true);
  assert.equal(emoteReply('hello', () => 0), null);
  assert.equal(emoteReply('gm', () => 0), 'GM');
});

test('recruits are excluded from online, roster, map counts, XP and event tallies', async (t) => {
  const ctx = fakeRoom();
  t.after(() => ctx.room.stopBots());
  const a = await joinHuman(ctx, 'ALICE', parseGeo('US|NA'));
  const b = await joinHuman(ctx, 'BOB', parseGeo('DE|EU'));
  for (let i = 0; i < 12; i++) ctx.room.botTick(Date.now() + i * 1000);
  assert.equal(ctx.room.bots.size, targetRecruitCount(2));

  const p = ctx.room.presence();
  assert.equal(p.online, 2);
  assert.equal(p.players.length, 2);
  assert.ok(p.players.every(x => !isBotId(x.id)));
  assert.equal(p.recruits, ctx.room.bots.size);
  assert.deepEqual(p.regions, { NA: 1, EU: 1 });
  assert.deepEqual(p.countries, { US: 1, DE: 1 });
  assert.ok(!JSON.stringify(p).match(/ip|lat|lon|city/i));

  ctx.room.broadcastStates();
  const st = a.sent.filter(m => m.type === 'states').pop();
  assert.equal(st.playerCount, 2);
  assert.equal(st.roster.length, 2);
  assert.equal(st.recruitCount, ctx.room.bots.size);
  const bots = st.players.filter(x => x.bot);
  assert.equal(bots.length, ctx.room.bots.size);
  assert.ok(bots.every(x => isBotId(x.id)));

  // XP / leaderboards / events: a bot-shaped attachment never reaches Profiles or Events.
  const before = { ...ctx.calls };
  const botAtt = { sessionId: 'bot:1', playerId: 'bot:1', bot: true, verifiedProfileId: 'bot:1', y: 0 };
  const r = await ctx.room.creditScored(fakeWs(botAtt), botAtt, { kind: 'dig' }, { ok: true, xp: 5 });
  assert.equal(r.ok, false);
  await ctx.room.maybeEventScore('bot:1', 'PVT MUDD', 10);
  assert.deepEqual(ctx.calls, before);

  // A human still earns XP (sanity: the guard is bot-only).
  await ctx.room.creditScored(a, a.att, { kind: 'dig' }, { ok: true, xp: 1 });
  assert.equal(ctx.calls.profiles, before.profiles + 1);
  void b;
});

test('recruits leave and the ticker stops when the last human disconnects', async (t) => {
  const ctx = fakeRoom();
  t.after(() => ctx.room.stopBots());
  const a = await joinHuman(ctx, 'ALICE', parseGeo('GB|EU'));
  for (let i = 0; i < 5; i++) ctx.room.botTick(Date.now() + i * 1000);
  assert.ok(ctx.room.bots.size > 0);
  await ctx.room.webSocketClose(a, 1000, 'bye');
  ctx.sockets.length = 0;
  assert.equal(ctx.room.bots.size, 0);
  assert.equal(ctx.room.botTimer, null);
  ctx.room.botTick();
  assert.equal(ctx.room.bots.size, 0);
  assert.equal(ctx.room.botTimer, null);
});

test('geo is coarse and aggregate-only', () => {
  assert.deepEqual(parseGeo('US|NA'), { cc: 'US', ct: 'NA' });
  assert.deepEqual(parseGeo('T1|XX'), { cc: null, ct: null });
  assert.deepEqual(parseGeo('1.2.3.4'), { cc: null, ct: null });
  assert.equal(geoHeader({ country: 'JP', continent: 'AS', city: 'Tokyo', latitude: '35' }), 'JP|AS');
  const agg = aggregateGeo([{ cc: 'US', ct: 'NA' }, { cc: 'US', ct: 'NA' }, null, { cc: 'BR', ct: 'SA' }]);
  assert.deepEqual(agg, { countries: { US: 2, BR: 1 }, regions: { NA: 2, SA: 1 }, unknown: 1 });
});
