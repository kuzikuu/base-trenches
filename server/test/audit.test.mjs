// pr13 site audit fixes: lazy Privy (self-hosted bundle), no render-blocking scripts, meta / icons /
// manifest, guest call to action and community links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const html = read('index.html');

test('every app script is deferred, in one version, and no third-party script blocks first paint', () => {
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
  assert.ok(tags.length >= 20);
  for (const t of tags) {
    assert.ok(/\bdefer\b/.test(t[0]), 'not deferred: ' + t[1]);
    assert.ok(t[1].startsWith('js/'), 'third-party script tag: ' + t[1]);
  }
  assert.ok(!html.includes('miniapp-sdk'), 'Farcaster SDK must load from miniapp.js only in a mini app');
});

test('Privy SDK is a self-hosted, content-hashed bundle, loaded lazily', () => {
  const src = read('js/privy.js');
  const m = src.match(/'(js\/vendor\/privy-sdk-0\.79\.1\.[0-9a-f]{10}\.js)'/);
  assert.ok(m, 'SDK_LOCAL not pointing at a hashed vendor file');
  assert.ok(existsSync(new URL(m[1], root)), m[1] + ' missing');
  const files = readdirSync(new URL('js/vendor/', root)).filter(f => f.startsWith('privy-sdk-'));
  assert.deepEqual(files, [m[1].split('/').pop()], 'stale vendor bundles left behind');
  assert.ok(src.indexOf("'js/vendor/") < src.indexOf('esm.sh'), 'self-hosted bundle must be tried first');
  const rpg = read('js/rpg.js');
  assert.ok(/shouldInitEarly\(\)/.test(rpg) && !/await BTPrivy\.init\(\)/.test(rpg), 'profile load must not force the SDK for guests');
});

test('saved-session detection matches the keys js-sdk-core writes', () => {
  const store = new Map();
  const ls = { get length() { return store.size; }, key: i => [...store.keys()][i], getItem: k => store.get(k) ?? null };
  const g = { localStorage: ls, location: { search: '' }, window: {}, document: { baseURI: 'https://x/' } };
  g.window = g; g.window.BT_PRIVY_APP_ID = 'app';
  new Function('window', 'localStorage', 'location', 'document', read('js/privy.js'))(g, ls, g.location, g.document);
  const P = g.BTPrivy;
  assert.equal(P.shouldInitEarly(), false);
  store.set('bt_login_method', 'x'); assert.equal(P.hasSavedSession(), false);
  store.set('privy:refresh_token', '"t"'); assert.equal(P.hasSavedSession(), true);
  store.clear(); store.set('privy:did:privy:abc:token', '"t"'); assert.equal(P.hasSavedSession(), true);
  store.clear(); g.location.search = '?privy_oauth_code=1&privy_oauth_state=2'; assert.equal(P.shouldInitEarly(), true);
});

test('meta: says it is a free WW1 trench-digging game on Base, no token; social tags, icons, manifest', () => {
  const meta = n => (html.match(new RegExp(`<meta (?:name|property)="${n}" content="([^"]+)"`)) || [])[1] || '';
  for (const n of ['description', 'og:description', 'twitter:description']) {
    assert.match(meta(n), /free WW1 trench-digging multiplayer game on Base/i, n);
    assert.match(meta(n), /no token/i, n);
  }
  for (const n of ['og:title', 'twitter:title', 'og:image:width', 'og:image:height']) assert.ok(meta(n), n);
  assert.equal(meta('og:image:width'), '1200'); assert.equal(meta('og:image:height'), '630');
  for (const f of ['favicon.ico', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/fonts/PressStart2P-Regular.woff2']) assert.ok(existsSync(new URL(f, root)), f);
  const man = JSON.parse(read('manifest.json'));
  assert.equal(man.display, 'standalone');
  assert.ok(man.icons.some(i => i.sizes === '512x512'));
  assert.ok(html.includes('rel="manifest"') && html.includes('rel="apple-touch-icon"'));
});

test('guest CTA under START DIGGING, community links on home and game-over, login button name = its text', () => {
  const title = html.slice(html.indexOf('id="title"'), html.indexOf('id="over"'));
  const over = html.slice(html.indexOf('id="over"'), html.indexOf('id="touch"'));
  assert.ok(title.indexOf('id="startBtn"') < title.indexOf('id="homeSignin"'));
  assert.match(title, /SIGN IN TO SAVE \+ RANK/);
  for (const part of [title, over]) {
    assert.ok(part.includes('href="https://t.me/powerof9base"') && part.includes('JOIN TELEGRAM'));
    assert.ok(part.includes('href="https://x.com/powerof9base"') && part.includes('FOLLOW @POWEROF9BASE'));
  }
  assert.ok(!/id="loginBtn"[^>]*aria-label/.test(html));
  const main = read('js/main.js');
  assert.ok(!/setAttribute\("aria-label","Guest/.test(main));
  assert.match(main, /SIGN IN TO SAVE \+ RANK/);   // game-over (#overSave) for guests
});
