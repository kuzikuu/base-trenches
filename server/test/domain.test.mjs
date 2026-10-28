import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.WebSocketRequestResponsePair ??= class {};
const worker = (await import('../index.js')).default;
const { QUICK_AUTH_AUDIENCES } = await import('../lib/jwt.js');

for (const o of ['https://powerof9base.com', 'https://www.powerof9base.com', 'https://base-trenches.pages.dev', 'https://kuzikuu.github.io']) {
  test('CORS allows ' + o, async () => {
    const r = await worker.fetch(new Request('https://x/api/health', { headers: { Origin: o } }), {}, {});
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), o);
    const pre = await worker.fetch(new Request('https://x/api/profile', { method: 'OPTIONS', headers: { Origin: o } }), {}, {});
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), o);
  });
}
test('unknown origins are not reflected', async () => {
  const r = await worker.fetch(new Request('https://x/api/health', { headers: { Origin: 'https://evil.example' } }), {}, {});
  assert.notEqual(r.headers.get('Access-Control-Allow-Origin'), 'https://evil.example');
});
test('Farcaster Quick Auth accepts the new domain', () => {
  assert.ok(QUICK_AUTH_AUDIENCES.includes('powerof9base.com'));
  assert.ok(QUICK_AUTH_AUDIENCES.includes('base-trenches.pages.dev'));
});
