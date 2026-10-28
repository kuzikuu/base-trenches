import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.WebSocketRequestResponsePair ??= class {};
const worker = (await import('../index.js')).default;

function fakeEnv(full) {
  const seen = [];
  const rooms = {};
  const ns = {
    idFromName: (n) => n,
    get: (name) => ({
      fetch: async (req) => {
        const u = new URL(req.url);
        seen.push([name, u.pathname, req.headers.get('X-BT-Room'), req.headers.get('X-BT-Geo')]);
        if (u.pathname === '/shard-hint') { rooms.hint = Math.max(rooms.hint || 1, +u.searchParams.get('n')); return Response.json({ ok: true }); }
        if (u.pathname === '/presence') {
          const base = { online: full.includes(name) ? 50 : 3, recruits: 0, regions: { EU: 1 }, countries: { DE: 1 }, unknownRegion: 0, players: [{ id: name }] };
          if (name === 'main') base.shards = rooms.hint || 1;
          return Response.json(base);
        }
        if (full.includes(name)) return new Response('Room full', { status: 503 });
        return new Response('ok-' + name, { status: 200 });
      }
    })
  };
  return { env: { TRENCH_ROOM: ns }, seen, rooms };
}
const wsReq = (q = '') => Object.assign(new Request('https://x/api/ws' + q, { headers: { Upgrade: 'websocket', 'X-BT-Geo': 'spoofed|XX', 'X-BT-Profile': 'did:privy:evil' } }), {});

test('main overflows into the next sector when full and records a hint', async () => {
  const { env, seen, rooms } = fakeEnv(['main', 'main-2']);
  const waits = [];
  const res = await worker.fetch(wsReq('?room=main'), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(await res.text(), 'ok-main-3');
  assert.deepEqual(seen.filter(s => s[1] === '/api/ws').map(s => s[2]), ['main', 'main-2', 'main-3']);
  assert.equal(rooms.hint, 3);
  // spoofed geo/profile headers never reach the room
  assert.ok(seen.every(s => s[3] === null || s[3] === '|'));
});

test('custom rooms do not overflow', async () => {
  const { env, seen } = fakeEnv(['lt-a']);
  const res = await worker.fetch(wsReq('?room=lt-a'), env, {});
  assert.equal(res.status, 503);
  assert.equal(seen.length, 1);
});

test('presence sums main and the sectors in use', async () => {
  const { env, rooms } = fakeEnv(['main']);
  rooms.hint = 3;
  const res = await worker.fetch(new Request('https://x/presence'), env, {});
  const p = await res.json();
  assert.equal(p.online, 50 + 3 + 3);
  assert.deepEqual(p.sectors.map(s => s.name), ['main', 'main-2', 'main-3']);
  assert.deepEqual(p.regions, { EU: 3 });
  assert.equal(p.shards, undefined);
});
