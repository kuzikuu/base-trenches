// GENERATED from server/lib/levels.js by tools/gen-shared.mjs. Do not edit; edit the server file.
(function(){
"use strict";
// Endless levels: themes, difficulty scaling and per-level campaign chapters.
// Pure logic, shared with the browser: tools/gen-shared.mjs copies this file to js/levels.js
// (window.BTLevels). Edit here, then run `node tools/gen-shared.mjs`.
//
// The world is one continuous shaft. Level L covers depth [(L-1)*LEVEL_DEPTH_M, L*LEVEL_DEPTH_M).
// The last row of each level is a sealed floor; breaking it drops you into the next level's cavern.
// With levels locked (prod default), level 1 is endless, exactly like the game before levels.

const LEVEL_DEPTH_M = 589;
const MAX_LEVEL = 9999;

// White + #0052FF dithered dot-matrix look in every theme; each one swaps the accent,
// the dither density, the rock/fill treatment and the props drawn in open ground.
const THEMES = [
  { id: 'trenches', name: 'The Trenches', campaign: 'Campaign 1', accent: '#8a5a2b', accent2: '#c9a27a', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#c9d6ff', dens: [0.15, 0.25, 0.37], invert: false, props: 'wire',
    title: 'Trencher', boss: 'Zero Hour', relic: 'trench relic', blurb: 'Mud, wire and the duckboards.' },
  { id: 'mines', name: "Tunnellers' Mines", campaign: 'The Tunnellers', accent: '#c9a27a', accent2: '#ffd400', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#c9d6ff', dens: [0.3, 0.4, 0.5], invert: false, props: 'timber',
    title: 'Tunneller', boss: 'The Great Mine', relic: 'miner\'s lamp', blurb: 'Timbered galleries. Sappers in the dark. Listen for the charges.' },
  { id: 'chalk', name: 'Chalk Caverns', campaign: 'The Chalk Line', accent: '#c9d6ff', accent2: '#16e0ff', ink: '#0052ff', bed: '#7fa0ff', pale: '#e6ecff', dens: [0.06, 0.1, 0.16], invert: false, props: 'chalk',
    title: 'Chalk Ghost', boss: 'The Cathedral', relic: 'carved badge', blurb: 'White chalk halls carved by a thousand names.' },
  { id: 'flooded', name: 'Flooded Galleries', campaign: 'High Water', accent: '#16e0ff', accent2: '#ffffff', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#bff6ff', dens: [0.2, 0.3, 0.42], invert: false, props: 'water',
    title: 'Pump Crew', boss: 'The Breach', relic: 'brass valve', blurb: 'The water table broke. Pump, dig, keep your boots dry.' },
  { id: 'ember', name: 'Hellfire Corner', campaign: 'Hellfire', accent: '#ff2bd6', accent2: '#ffd400', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#ffd6f6', dens: [0.22, 0.34, 0.46], invert: false, props: 'ember',
    title: 'Firewalker', boss: 'The Furnace', relic: 'molten medal', blurb: 'Hot rock and burning seams. Everything down here bites.' },
  { id: 'core', name: 'The Base Core', campaign: 'Onchain', accent: '#16e0ff', accent2: '#22e36b', ink: '#ffffff', bed: '#0b1a8f', pale: '#3d74ff', dens: [0.55, 0.65, 0.75], invert: true, props: 'circuit',
    title: 'Core Runner', boss: 'The Sequencer', relic: 'genesis block', blurb: 'Blue all the way down. The trench runs onchain.' }
];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
function roman(n) {
  n = Math.max(1, Math.floor(n));
  return n < ROMAN.length ? ROMAN[n] : String(n);
}

function clampLevel(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_LEVEL, n);
}

// Level for a depth in meters (0 = trench floor). Locked => always 1 (endless level 1).
function levelForDepth(depth, unlocked) {
  if (!unlocked) return 1;
  const d = Math.max(0, Math.floor(Number(depth) || 0));
  return clampLevel(Math.floor(d / LEVEL_DEPTH_M) + 1);
}

function levelTopDepth(level) { return (clampLevel(level) - 1) * LEVEL_DEPTH_M; }
function levelFloorDepth(level) { return clampLevel(level) * LEVEL_DEPTH_M - 1; }

// Theme for a level: cycles through THEMES; each cycle is a variation (denser dither, roman suffix).
function themeFor(level) {
  const L = clampLevel(level);
  const i = (L - 1) % THEMES.length;
  const cycle = Math.floor((L - 1) / THEMES.length);
  const base = THEMES[i];
  const bump = Math.min(0.18, cycle * 0.06);
  return {
    ...base,
    index: i,
    cycle,
    level: L,
    dens: base.invert ? base.dens.map(v => Math.max(0.3, v - bump)) : base.dens.map(v => Math.min(0.85, v + bump)),
    displayName: base.name + (cycle > 0 ? ' ' + roman(cycle + 1) : ''),
    mirror: cycle % 2 === 1
  };
}

// Difficulty grows without a cap. Level 1 returns exactly today's numbers (all multipliers 1).
// Timing values (fire intervals) have floors so the game stays playable; damage, HP and
// hardness keep climbing forever.
function difficulty(level) {
  const L = clampLevel(level);
  const d = L - 1;
  return {
    level: L,
    hardness: 1 + 0.25 * d,                  // tile HP multiplier (ceil per tile)
    hazard: 1 + 0.2 * d,                     // boulder / UXB density multiplier
    fire: 1 + 0.15 * d,                      // sweep + artillery rate multiplier
    bulletSpeed: 1 + 0.06 * d,
    extraBullets: Math.floor(d / 2),
    blastDamage: 2 + Math.floor(d / 2),
    blastRadius: 2.3 + Math.min(1.2, 0.1 * d),
    enemyHp: L >= 2 ? Math.round(2 + 1.5 * (L - 2)) : 0,
    enemyDamage: L >= 2 ? 1 + Math.floor((L - 2) / 3) : 0,
    enemyCount: L >= 2 ? 2 + d : 0,         // spawn budget; the client caps how many are alive at once
    enemySpeed: L >= 2 ? Math.min(80, 26 + 4 * d) : 0
  };
}

function tileHp(baseHp, level) {
  if (!baseHp) return 0;
  return Math.max(1, Math.ceil(baseHp * difficulty(level).hardness));
}

// ---------- per-level campaigns (level 1 = Campaign 1, the five classic chapters) ----------
const GEAR_TYPES = ['pickaxe', 'helmet', 'boots', 'charm'];
function levelGear(level) {
  const L = clampLevel(level);
  const t = themeFor(L);
  const type = GEAR_TYPES[(L - 2 + 4) % 4];
  const rarity = Math.min(4, 1 + Math.floor(L / 2));
  const r2 = n => Math.round(n * 100) / 100;
  const base = { type, rarity, name: `${t.name.replace(/^The /, '')} ${type === 'pickaxe' ? 'Pick' : type === 'helmet' ? 'Helm' : type === 'boots' ? 'Boots' : 'Charm'} Mk ${L}` };
  if (type === 'pickaxe') return { ...base, digSpeed: r2(1.8 + 0.1 * (L - 1)), desc: `+${Math.round((0.8 + 0.1 * (L - 1)) * 100)}% dig speed` };
  if (type === 'helmet') return { ...base, protection: Math.min(9, 2 + Math.floor(L / 2)), desc: `Absorbs ${Math.min(9, 2 + Math.floor(L / 2))} hits` };
  if (type === 'boots') return { ...base, moveSpeed: r2(Math.min(2, 1.3 + 0.05 * L)), desc: `+${Math.round((Math.min(2, 1.3 + 0.05 * L) - 1) * 100)}% move speed` };
  return { ...base, luck: r2(1.5 + 0.1 * L), desc: `+${Math.round((0.5 + 0.1 * L) * 100)}% diamond luck` };
}

function levelChapterId(level) { return `lvl-${clampLevel(level)}`; }

function parseLevelChapterId(id) {
  const m = /^lvl-(\d{1,4})$/.exec(String(id || ''));
  if (!m) return null;
  const L = Number(m[1]);
  return L >= 2 && L <= MAX_LEVEL ? L : null;
}

function levelChapter(level) {
  const L = clampLevel(level);
  if (L < 2) return null;
  const t = themeFor(L);
  const top = levelTopDepth(L);
  const xp = n => Math.round(n * (1 + 0.15 * (L - 2)));
  const p = `l${L}`;
  return {
    id: levelChapterId(L),
    level: L,
    index: 3 + L, // after Campaign 1's five chapters (index 0..4)
    name: `${t.campaign}${t.cycle > 0 ? ' ' + roman(t.cycle + 1) : ''}`,
    theme: t.id,
    brief: `Level ${L} · ${t.displayName}. ${t.blurb}`,
    missions: [
      { id: `${p}-in`, type: 'dig', target: top + 60, title: 'Break Ground', desc: `Dig 60 meters into level ${L} (${top + 60}M).`, xp: xp(40) },
      { id: `${p}-survive`, type: 'survive', scope: 'level', level: L, target: 3 + L, title: 'Hold Underground', desc: `Survive ${3 + L} blasts on this level.`, xp: xp(45) },
      { id: `${p}-dodge`, type: 'dodge', scope: 'level', level: L, target: 4 + 2 * L, title: 'Gallery Sweeps', desc: `Dodge ${4 + 2 * L} sweeps on this level.`, xp: xp(40) },
      { id: `${p}-relic`, type: 'relic', scope: 'level', level: L, target: 1, title: 'Level Relic', desc: `Find the ${t.relic}.`, xp: xp(55) },
      { id: `${p}-floor`, type: 'dig', target: L * LEVEL_DEPTH_M - 1, title: 'Breach the Floor', desc: `Reach the floor of level ${L} (${L * LEVEL_DEPTH_M - 1}M).`, xp: xp(70) },
      { id: `${p}-boss`, type: 'boss', target: 1, title: t.boss, desc: 'Boss raid: survive 5 blasts in one run.', xp: xp(200), boss: true }
    ],
    rewards: { title: t.title + (t.cycle > 0 ? ' ' + roman(t.cycle + 1) : ''), gear: levelGear(L) }
  };
}

window.BTLevels = { LEVEL_DEPTH_M, MAX_LEVEL, THEMES, roman, clampLevel, levelForDepth, levelTopDepth, levelFloorDepth, themeFor, difficulty, tileHp, levelGear, levelChapterId, parseLevelChapterId, levelChapter };
})();
