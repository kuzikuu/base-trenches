// Builds the self-hosted Privy SDK: @privy-io/js-sdk-core@0.79.1 bundled by esbuild into ONE ES module
// with a single viem (2.57.8, pinned through npm overrides) and a Buffer shim. Output name carries a
// content hash so it can be cached for a year; js/privy.js is updated to point at it.
//   cd tools/privy-bundle && npm ci && cd ../.. && node tools/build-privy.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const dir = root + 'tools/privy-bundle/';
const tmp = dir + 'out.js';
execFileSync(dir + 'node_modules/.bin/esbuild', ['entry.mjs', '--bundle', '--format=esm', '--minify', '--platform=browser',
  '--target=es2020', '--legal-comments=none', '--inject:shim.mjs', '--define:process.env.NODE_ENV="production"',
  '--define:global=globalThis', '--outfile=' + tmp], { cwd: dir, stdio: 'inherit' });
const code = fs.readFileSync(tmp);
const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
const name = `privy-sdk-0.79.1.${hash}.js`;
fs.mkdirSync(root + 'js/vendor', { recursive: true });
for (const f of fs.readdirSync(root + 'js/vendor')) if (/^privy-sdk-/.test(f) && f !== name) fs.unlinkSync(root + 'js/vendor/' + f);
fs.writeFileSync(root + 'js/vendor/' + name, code);
fs.unlinkSync(tmp);
const p = root + 'js/privy.js';
fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/'js\/vendor\/privy-sdk-[^']+'/, `'js/vendor/${name}'`));
console.log('js/vendor/' + name, code.length, 'bytes');
