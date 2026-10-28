import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.WebSocketRequestResponsePair ??= class {};
const mod = await import('../index.js');
const worker = mod.default;
const { build, SHARED } = await import('../../tools/gen-shared.mjs');

function env(extra = {}) {
  const calls = [];
  const profiles = {
    idFromName: n => n,
    get: () => ({ fetch: async (req) => { const u = new URL(req.url); calls.push([u.pathname + u.search, req.method]); return Response.json({ ok: true, leaderboard: [] }); } })
  };
  return { env: { PROFILES: profiles, PRIVY_APP_ID: '', ...extra }, calls };
}

test('/api/config reports the levels switch (off by default)', async () => {
  let r = await worker.fetch(new Request('https://x/api/config'), env().env);
  assert.equal((await r.json()).levelsUnlocked, false);
  r = await worker.fetch(new Request('https://x/api/config'), env({ LEVELS_UNLOCKED: '1' }).env);
  const j = await r.json();
  assert.equal(j.levelsUnlocked, true);
  assert.equal(j.levelDepth, 589);
});

test('/api/save needs a real login (guests and anonymous get 401)', async () => {
  const { env: e, calls } = env();
  const r = await worker.fetch(new Request('https://x/api/save', { method: 'POST', body: '{}', headers: { 'X-Guest-Secret': 'x'.repeat(32) } }), e);
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
});

test('preview test login is OFF unless both preview flags are set', async () => {
  const hdr = { Authorization: 'Bearer preview-test:abc123' };
  let { env: e, calls } = env({ PREVIEW_TEST_AUTH: '1' }); // missing BT_ENV=preview
  let r = await worker.fetch(new Request('https://x/api/save', { headers: hdr }), e);
  assert.equal(r.status, 401);
  ({ env: e, calls } = env({ BT_ENV: 'preview' }));
  r = await worker.fetch(new Request('https://x/api/save', { headers: hdr }), e);
  assert.equal(r.status, 401);
  ({ env: e, calls } = env({ BT_ENV: 'preview', PREVIEW_TEST_AUTH: '1' }));
  r = await worker.fetch(new Request('https://x/api/save', { headers: hdr }), e);
  assert.equal(r.status, 200);
  assert.ok(calls[0][0].includes(encodeURIComponent('did:privy:previewtestabc123')));
  assert.equal(mod.previewTestAuth({}), false);
  assert.equal(mod.previewTestAuth({ PREVIEW_TEST_AUTH: '1', BT_ENV: 'production' }), false);
});

test('prod wrangler.toml keeps levels locked and no test auth', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /LEVELS_UNLOCKED = "0"/);
  assert.doesNotMatch(toml, /PREVIEW_TEST_AUTH/);
});

test('leaderboard accepts type=level', async () => {
  const { env: e, calls } = env();
  await worker.fetch(new Request('https://x/api/leaderboard?type=level'), e);
  assert.equal(calls[0][0], '/leaderboard?type=level');
  await worker.fetch(new Request('https://x/api/leaderboard?type=drop'), e);
  assert.equal(calls[1][0], '/leaderboard?type=xp');
});

test('extra CORS origins only from env', async () => {
  let r = await worker.fetch(new Request('https://x/api/config', { headers: { Origin: 'https://preview.example.dev' } }), env().env);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://powerof9base.com');
  r = await worker.fetch(new Request('https://x/api/config', { headers: { Origin: 'https://preview.example.dev' } }), env({ EXTRA_CORS_ORIGINS: 'https://preview.example.dev' }).env);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://preview.example.dev');
  r = await worker.fetch(new Request('https://x/api/config', { headers: { Origin: 'https://preview.example.dev' } }), env().env);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://powerof9base.com');
});

test('browser copies of levels.js / skills.js are in sync', () => {
  for (const f of SHARED) {
    const want = build(readFileSync(new URL('../../' + f.src, import.meta.url), 'utf8'), f.global, f.src);
    const have = readFileSync(new URL('../../' + f.out, import.meta.url), 'utf8');
    assert.equal(have, want, f.out + ' is stale: run node tools/gen-shared.mjs');
  }
});
