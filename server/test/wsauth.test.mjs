// Guest secret out of the websocket URL: new clients send { type: 'auth' } as the first message;
// the URL ?secret= form keeps working for cached old clients during the transition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWsAuth, GUEST_ID_RE } from '../lib/wsauth.js';

globalThis.WebSocketRequestResponsePair ??= class { constructor(a, b) { this.a = a; this.b = b; } };
const mod = await import('../index.js');
const { TrenchRoom } = mod;

const GUEST = 'guest:12345678-1234-4234-8234-123456789abc';
const SECRET = 's3cr3t-0123456789abcdef';
async function sha(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

function fakeWs(att = {}) {
  return {
    att, sent: [], closed: null,
    deserializeAttachment() { return this.att; },
    serializeAttachment(a) { this.att = { ...a }; },
    send(m) { this.sent.push(JSON.parse(m)); },
    close(code, reason) { this.closed = { code, reason }; }
  };
}
// PROFILES stub that knows one guest; check-guest answers after a short delay (a real DO hop).
function profilesEnv(calls) {
  const stub = { fetch: async (req) => {
    const u = new URL(req.url);
    if (u.pathname === '/check-guest') {
      const { id, secretHash } = await req.json();
      calls.push(id);
      await new Promise(r => setTimeout(r, 20));
      return Response.json({ ok: id === GUEST && secretHash === await sha(SECRET) });
    }
    return new Response('{"success":true}');
  } };
  return { PROFILES: { idFromName: () => 'p', get: () => stub }, EVENTS: { idFromName: () => 'e', get: () => stub }, PULSE: { idFromName: () => 'u', get: () => stub }, BOTS_ENABLED: '0' };
}
function fakeRoom(env) {
  const sockets = []; const m = new Map([['seed', 1]]);
  const state = {
    storage: { get: async (k) => Array.isArray(k) ? new Map() : m.get(k), put: async (k, v) => { m.set(k, v); } },
    blockConcurrencyWhile: (fn) => fn(), setWebSocketAutoResponse() {},
    getWebSockets: () => sockets.filter(w => !w.closed),
    getWebSocketAutoResponseTimestamp: () => null
  };
  return { room: new TrenchRoom(state, env), sockets };
}

test('parseWsAuth accepts only a well-formed guest auth on an unverified socket', () => {
  assert.ok(GUEST_ID_RE.test(GUEST));
  assert.deepEqual(parseWsAuth({ type: 'auth', profileId: GUEST, secret: SECRET }, {}), { profileId: GUEST, secret: SECRET });
  assert.equal(parseWsAuth({ type: 'join', profileId: GUEST, secret: SECRET }, {}), null);
  assert.equal(parseWsAuth({ type: 'auth', profileId: 'did:privy:abc', secret: SECRET }, {}), null);
  assert.equal(parseWsAuth({ type: 'auth', profileId: GUEST, secret: 'short' }, {}), null);
  assert.equal(parseWsAuth({ type: 'auth', profileId: GUEST, secret: 'x'.repeat(300) }, {}), null);
  assert.equal(parseWsAuth({ type: 'auth', profileId: GUEST, secret: 42 }, {}), null);
  assert.equal(parseWsAuth({ type: 'auth', profileId: GUEST, secret: SECRET }, { verifiedProfileId: 'did:privy:x' }), null);
});

test('room: auth as the first message verifies the guest before join runs (join sent without waiting)', async () => {
  const calls = []; const ctx = fakeRoom(profilesEnv(calls));
  const ws = fakeWs({ sessionId: 'sess-1', verifiedProfileId: null, joined: Date.now() });
  ctx.sockets.push(ws);
  const a = ctx.room.webSocketMessage(ws, JSON.stringify({ type: 'auth', profileId: GUEST, secret: SECRET }));
  const j = ctx.room.webSocketMessage(ws, JSON.stringify({ type: 'join', name: 'Anon', level: 3 }));
  await Promise.all([a, j]);
  assert.equal(ws.att.verifiedProfileId, GUEST, 'verified id lost');
  assert.equal(ws.att.playerId, 'sess-1', 'join lost');
  assert.deepEqual(calls, [GUEST]);
  const types = ws.sent.map(m => m.type);
  assert.ok(types.indexOf('auth') >= 0 && types.indexOf('auth') < types.indexOf('init'), 'auth answered before init: ' + types);
  assert.equal(ws.sent.find(m => m.type === 'auth').ok, true);
  ctx.room.stopBots && ctx.room.stopBots();
  if (ctx.room.p9Timer) clearTimeout(ctx.room.p9Timer);
});

test('room: a wrong secret leaves the socket anonymous; a verified socket cannot be re-pointed', async () => {
  const calls = []; const ctx = fakeRoom(profilesEnv(calls));
  const bad = fakeWs({ sessionId: 'sess-2', verifiedProfileId: null });
  await ctx.room.webSocketMessage(bad, JSON.stringify({ type: 'auth', profileId: GUEST, secret: 'wrong-secret-0123456789' }));
  assert.equal(bad.att.verifiedProfileId, null);
  assert.equal(bad.sent.find(m => m.type === 'auth').ok, false);
  const privy = fakeWs({ sessionId: 'sess-3', verifiedProfileId: 'did:privy:me' });
  await ctx.room.webSocketMessage(privy, JSON.stringify({ type: 'auth', profileId: GUEST, secret: SECRET }));
  assert.equal(privy.att.verifiedProfileId, 'did:privy:me');
  assert.equal(calls.length, 1, 'no check for an already verified socket');
});

test('worker: /api/ws never needs the secret in the URL, and the legacy ?secret= still verifies', async () => {
  const seen = [];
  const env = profilesEnv([]);
  env.TRENCH_ROOM = { idFromName: n => n, get: () => ({ fetch: async (req) => { seen.push(req.headers.get('X-BT-Profile')); return new Response('ok', { status: 200 }); } }) };
  const call = q => mod.default.fetch(new Request('https://x.test/api/ws?' + q, { headers: { Upgrade: 'websocket', Origin: 'https://powerof9base.com' } }), env, { waitUntil() {} });
  await call('room=main');
  await call('room=main&profileId=' + encodeURIComponent(GUEST) + '&secret=' + encodeURIComponent(SECRET));
  await call('room=main&profileId=' + encodeURIComponent(GUEST) + '&secret=nope-nope-nope-nope');
  assert.deepEqual(seen, [null, GUEST, null]);
});

test('client: multiplayer.js keeps the guest secret out of the URL and sends auth before join', () => {
  const src = readFileSync(new URL('../../js/multiplayer.js', import.meta.url), 'utf8');
  assert.ok(!/q\.set\('secret'/.test(src), 'secret still put in the URL');
  const open = src.slice(src.indexOf('sock.onopen'));
  assert.ok(open.indexOf('JSON.stringify(auth)') >= 0 && open.indexOf('JSON.stringify(auth)') < open.indexOf("type: 'join'"));
});
