// Generates browser copies of the shared pure modules so client and server can never disagree.
//   server/lib/levels.js -> js/levels.js  (window.BTLevels)
//   server/lib/skills.js -> js/skills.js  (window.BTSkills)
// Run: node tools/gen-shared.mjs   (server/test/shared.test.mjs fails if they drift)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SHARED = [
  { src: 'server/lib/levels.js', out: 'js/levels.js', global: 'BTLevels' },
  { src: 'server/lib/skills.js', out: 'js/skills.js', global: 'BTSkills' },
  { src: 'server/lib/power9.js', out: 'js/power9.js', global: 'BTPower9' }
];

export function build(srcText, global, srcPath) {
  if (/^\s*import\s/m.test(srcText)) throw new Error(srcPath + ': shared modules must not import');
  const names = [...srcText.matchAll(/^export\s+(?:const|function|let)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  const body = srcText.replace(/^export\s+(?=(?:const|function|let)\s)/gm, '');
  return `// GENERATED from ${srcPath} by tools/gen-shared.mjs. Do not edit; edit the server file.\n` +
    `(function(){\n"use strict";\n${body}\nwindow.${global} = { ${names.join(', ')} };\n})();\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const f of SHARED) {
    const text = build(readFileSync(join(root, f.src), 'utf8'), f.global, f.src);
    writeFileSync(join(root, f.out), text);
    console.log('wrote', f.out);
  }
}
