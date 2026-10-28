import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupePresence, socketsToReplace, presenceKey, STALE_MS, IDLE_MS, CLOSE_STALE, CLOSE_REPLACED } from '../lib/presence.js';
import { targetRecruitCount } from '../lib/recruits.js';

globalThis.WebSocketRequestResponsePair ??= class { constructor(a, b) { this.a = a; this.b = b; } };
const { TrenchRoom } = await import('../index.js');

function fakeWs(att = {}) {
  return {
    att, sent: [], closed: null,
    deserializeAttachment() { return this.att; },
    serializeAttachment(a) { this.att = a; },
    send(m) { if (this.closed) throw new Error('closed'); this.sent.push(typeof m === 'string' ? JSON.parse(m) : m); },
    close(code, reason) { this.closed = { code, reason }; }
  };
}
function fakeRoom() {
  const sockets = []; const auto = new Map();
  const stub = { fetch: async () => new Response('{"success":true}') };
  const env = { PROFILES: { idFromName: () => 'p', get: () => stub }, EVENTS: { idFromName: () => 'e', get: () => stub }, BOTS_ENABLED: '0' };
  const m = new Map([['seed', 1]]);
  const state = {
    storage: { get: async (k) => Array.isArray(k) ? new Map() : m.get(k), put: async (k, v) => { m.set(k, v); } },
    blockConcurrencyWhile: (fn) => fn(), setWebSocketAutoResponse() {},
    getWebSockets: () => sockets.filter(w => !w.closed),
    getWebSocketAutoResponseTimestamp: (ws) => auto.has(ws) ? new Date(auto.get(ws)) : null
  };
  return { room: new TrenchRoom(state, env), sockets, auto };
}
async function join(ctx, profile, name, joined = Date.now()) {
  const ws = fakeWs({ sessionId: crypto.randomUUID(), verifiedProfileId: profile, joined });
  ctx.sockets.push(ws);
  await ctx.room.handleJoin(ws, { name, level: 7 }, ws.att);
  return ws;
}

test('presence key: account for verified players, socket for anonymous ones', () => {
  assert.equal(presenceKey({ verifiedProfileId: 'did:privy:x', sessionId: 's1' }), 'p:did:privy:x');
  assert.equal(presenceKey({ sessionId: 's1' }), 's:s1');
});

test('dedupe keeps one entry per account (the most recently active) and drops dead sockets', () => {
  const now = 1_000_000;
  const e = (ref, a, autoTs = 0) => ({ ref, a: { playerId: ref, sessionId: ref, ...a }, autoTs });
  const r = dedupePresence([
    e('old', { verifiedProfileId: 'K', joined: now - 60_000, lastUpdate: now - 40_000 }),
    e('new', { verifiedProfileId: 'K', joined: now - 5_000, lastUpdate: now - 1_000 }),
    e('idleTab', { verifiedProfileId: 'K', joined: now - 100_000, lastUpdate: now - 90_000 }, now - 10_000),
    e('dead', { verifiedProfileId: 'K', joined: now - 900_000, lastUpdate: now - 800_000 }),
    e('anon1', { joined: now - 1000, lastUpdate: now - 500 }),
    e('anon2', { joined: now - 1000, lastUpdate: now - 500 }),
    e('deadHeartbeat', { verifiedProfileId: 'Z', joined: now - STALE_MS * 2 }, now - STALE_MS - 1),
    e('aliveByHeartbeat', { verifiedProfileId: 'Y', joined: now - STALE_MS * 2 }, now - 20_000)
  ], now);
  const keep = Object.fromEntries(r.keep.map(k => [k.key, k.ref]));
  assert.equal(keep['p:K'], 'new');
  assert.equal(keep['p:Y'], 'aliveByHeartbeat');
  assert.equal(r.keep.find(k => k.key === 'p:Y').idle, true);
  assert.equal(r.keep.length, 4); // K, Y, anon1, anon2
  assert.deepEqual(r.stale.sort(), ['dead', 'deadHeartbeat']);
  assert.deepEqual(r.dupes.sort(), ['idleTab', 'old']);
});

test('a rejoin replaces only idle sockets of the same account', () => {
  const now = 2_000_000;
  const joining = { sessionId: 'n', playerId: 'n', verifiedProfileId: 'K', lastUpdate: now };
  const list = [
    { ref: 'idle', a: { sessionId: 'i', playerId: 'i', verifiedProfileId: 'K', lastUpdate: now - IDLE_MS - 1 } },
    { ref: 'active', a: { sessionId: 'a', playerId: 'a', verifiedProfileId: 'K', lastUpdate: now - 1000 } },
    { ref: 'other', a: { sessionId: 'o', playerId: 'o', verifiedProfileId: 'Q', lastUpdate: 0 } }
  ];
  assert.deepEqual(socketsToReplace(list, joining, now), ['idle']);
  assert.deepEqual(socketsToReplace(list, { ...joining, verifiedProfileId: null }, now), []);
});

test('room: 9 sockets of one account show as ONE trencher; online and recruit ramp count people', async () => {
  const ctx = fakeRoom();
  const now = Date.now();
  // 8 leftover sockets of the same account (reconnects / old tabs), all quiet for a while
  for (let i = 0; i < 8; i++) {
    const ws = fakeWs({ sessionId: 'old' + i, playerId: 'old' + i, verifiedProfileId: 'did:privy:kuzi', name: 'KUZI', level: i % 2 ? 7 : 1, joined: now - 60_000, lastUpdate: now - 30_000 });
    ctx.sockets.push(ws);
  }
  const fresh = await join(ctx, 'did:privy:kuzi', 'KUZI');
  const p = ctx.room.presence();
  assert.equal(p.online, 1);
  assert.equal(p.players.length, 1);
  assert.equal(p.players[0].id, fresh.att.playerId);
  assert.equal(p.players[0].status, 'active');
  // the idle copies were closed as replaced
  assert.equal(ctx.sockets.filter(w => w.closed && w.closed.code === CLOSE_REPLACED).length, 8);
  assert.equal(ctx.room.humanCount(), 1);
  assert.equal(targetRecruitCount(ctx.room.humanCount()), targetRecruitCount(1));
  // two other people → 3 humans, not 11 sockets
  await join(ctx, 'guest:a', 'A'); await join(ctx, 'guest:b', 'B');
  assert.equal(ctx.room.humanCount(), 3);
  ctx.room.broadcastStates();
  const st = fresh.sent.filter(m => m.type === 'states').pop();
  assert.equal(st.playerCount, 3);
  assert.equal(st.roster.length, 3);
});

test('room: an actively played second tab stays connected but is listed once', async () => {
  const ctx = fakeRoom();
  const a = await join(ctx, 'did:privy:kuzi', 'KUZI', Date.now() - 10);
  const b = await join(ctx, 'did:privy:kuzi', 'KUZI'); // a is not idle yet → kept open
  assert.equal(a.closed, null);
  assert.equal(ctx.room.presence().online, 1);
  assert.equal(ctx.room.presence().players[0].id, b.att.playerId);
});

test('room: silent sockets are pruned after the heartbeat timeout; pings keep them', async () => {
  const ctx = fakeRoom();
  const now = Date.now();
  const dead = fakeWs({ sessionId: 'd', playerId: 'd', verifiedProfileId: 'guest:d', name: 'D', joined: now - STALE_MS - 5000, lastUpdate: now - STALE_MS - 5000 });
  const pinging = fakeWs({ sessionId: 'p', playerId: 'p', verifiedProfileId: 'guest:p', name: 'P', joined: now - STALE_MS - 5000, lastUpdate: now - STALE_MS - 5000 });
  const neverJoined = fakeWs({ sessionId: 'n', joined: now - STALE_MS - 5000 });
  ctx.sockets.push(dead, pinging, neverJoined);
  ctx.auto.set(pinging, now - 20_000);
  const watcher = await join(ctx, 'guest:w', 'W');
  const p = ctx.room.presence();
  assert.deepEqual(p.players.map(x => x.name).sort(), ['P', 'W']);
  assert.equal(p.players.find(x => x.name === 'P').status, 'idle');
  assert.equal(dead.closed.code, CLOSE_STALE);
  assert.equal(neverJoined.closed.code, CLOSE_STALE);
  assert.equal(pinging.closed, null);
  assert.ok(watcher.sent.some(m => m.type === 'leave' && m.playerId === 'd'));
  // a late message from a pruned socket is ignored and closed again, not resurrected
  await ctx.room.webSocketMessage(dead, JSON.stringify({ type: 'state', x: 1, y: 1 }));
  assert.equal(ctx.room.presence().online, 2);
});

test('client sends a heartbeat and does not fight a replaced connection', async () => {
  const { readFileSync } = await import('node:fs');
  const mp = readFileSync(new URL('../../js/multiplayer.js', import.meta.url), 'utf8');
  assert.match(mp, /sock\.send\('ping'\)/);
  assert.match(mp, /ev\.code === 4002/);
  assert.match(mp, /resumeIfReplaced/);
});
