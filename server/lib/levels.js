// Endless levels: themes, difficulty scaling and per-level campaign chapters.
// Pure logic, shared with the browser: tools/gen-shared.mjs copies this file to js/levels.js
// (window.BTLevels). Edit here, then run `node tools/gen-shared.mjs`.
//
// The world is one continuous shaft. Level L covers depth [(L-1)*LEVEL_DEPTH_M, L*LEVEL_DEPTH_M).
// The last row of each level is a sealed floor; breaking it drops you into the next level's cavern.
// With levels locked (prod default), level 1 is endless, exactly like the game before levels.

export const LEVEL_DEPTH_M = 589;
export const MAX_LEVEL = 9999;

// White + #0052FF dithered dot-matrix look in every theme; each one swaps the accent,
// the dither density, the rock/fill treatment and the props drawn in open ground.
export const THEMES = [
  { id: 'trenches', name: 'The Trenches', campaign: 'Campaign 1', accent: '#8a5a2b', accent2: '#c9a27a', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#c9d6ff', dens: [0.15, 0.25, 0.37], invert: false, props: 'wire',
    title: 'Trencher', boss: 'Zero Hour', relic: 'trench relic', blurb: 'Mud, wire and the duckboards.' },
  // Level 2, Sinai front, 1916: a desert level with a nod to a certain spice-and-sandworm epic.
  { id: 'sands', name: 'The Dust Sea', campaign: 'Desert Column', accent: '#ffd400', accent2: '#c9a27a', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#fff3b8', dens: [0.1, 0.18, 0.28], invert: false, props: 'dune',
    title: 'Sand Rider', boss: 'Sandmaw', relic: 'spice tin', blurb: 'Sinai sand all the way down. Step soft, step odd.' },
  { id: 'mines', name: "Tunnellers' Mines", campaign: 'The Tunnellers', accent: '#c9a27a', accent2: '#ffd400', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#c9d6ff', dens: [0.3, 0.4, 0.5], invert: false, props: 'timber',
    title: 'Tunneller', boss: 'The Great Mine', relic: 'miner\'s lamp', blurb: 'Timbered galleries. Sappers in the dark. Listen for the charges.' },
  { id: 'chalk', name: 'Chalk Caverns', campaign: 'The Chalk Line', accent: '#c9d6ff', accent2: '#16e0ff', ink: '#0052ff', bed: '#7fa0ff', pale: '#e6ecff', dens: [0.06, 0.1, 0.16], invert: false, props: 'chalk',
    title: 'Chalk Ghost', boss: 'The Cathedral', relic: 'carved badge', blurb: 'White chalk halls carved by a thousand names.' },
  { id: 'flooded', name: 'Flooded Galleries', campaign: 'High Water', accent: '#16e0ff', accent2: '#ffffff', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#bff6ff', dens: [0.2, 0.3, 0.42], invert: false, props: 'water',
    title: 'Pump Crew', boss: 'The Breach', relic: 'brass valve', blurb: 'The water table broke. Pump, dig, keep your boots dry.' },
  { id: 'ember', name: 'Hellfire Corner', campaign: 'Hellfire', accent: '#ff2bd6', accent2: '#ffd400', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#ffd6f6', dens: [0.22, 0.34, 0.46], invert: false, props: 'ember',
    title: 'Firewalker', boss: 'The Furnace', relic: 'molten medal', blurb: 'Hot rock and burning seams. Everything down here bites.' },
  { id: 'core', name: 'The Base Core', campaign: 'Onchain', accent: '#16e0ff', accent2: '#22e36b', ink: '#ffffff', bed: '#0b1a8f', pale: '#3d74ff', dens: [0.55, 0.65, 0.75], invert: true, props: 'circuit',
    title: 'Core Runner', boss: 'The Sequencer', relic: 'genesis block', blurb: 'Blue all the way down. The trench runs onchain.' },
  // Level 8: Base culture. Pixel punks in Base blue, and a fan-tribute final boss (see PUNK_BOSS).
  // `mottos` are real, publicly used Base phrases (sources in PUNK_SLOGANS); shown on the level banner.
  { id: 'punks', name: 'Attack of the Punks', campaign: 'Stay Based', accent: '#0052ff', accent2: '#16e0ff', ink: '#0b1a8f', bed: '#0a2fd1', pale: '#c9d6ff', dens: [0.18, 0.28, 0.4], invert: false, props: 'punks',
    title: 'Based Builder', boss: 'Builder #001', relic: 'Onchain Summer badge', blurb: 'Pixel punks in Base blue. Stay based, keep building.',
    mottos: ['STAY BASED', 'BASE IS FOR EVERYONE', "IT'S TIME TO BRING THE WORLD ONCHAIN"] }
];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function roman(n) {
  n = Math.max(1, Math.floor(n));
  return n < ROMAN.length ? ROMAN[n] : String(n);
}

export function clampLevel(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_LEVEL, n);
}

// Level for a depth in meters (0 = trench floor). Locked => always 1 (endless level 1).
export function levelForDepth(depth, unlocked) {
  if (!unlocked) return 1;
  const d = Math.max(0, Math.floor(Number(depth) || 0));
  return clampLevel(Math.floor(d / LEVEL_DEPTH_M) + 1);
}

export function levelTopDepth(level) { return (clampLevel(level) - 1) * LEVEL_DEPTH_M; }
export function levelFloorDepth(level) { return clampLevel(level) * LEVEL_DEPTH_M - 1; }

// Theme for a level: cycles through THEMES; each cycle is a variation (denser dither, roman suffix).
export function themeFor(level) {
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
export function difficulty(level) {
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

export function tileHp(baseHp, level) {
  if (!baseHp) return 0;
  return Math.max(1, Math.ceil(baseHp * difficulty(level).hardness));
}

// ---------- per-level campaigns (level 1 = Campaign 1, the five classic chapters) ----------
const GEAR_TYPES = ['pickaxe', 'helmet', 'boots', 'charm'];
export function levelGear(level) {
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

export function levelChapterId(level) { return `lvl-${clampLevel(level)}`; }

export function parseLevelChapterId(id) {
  const m = /^lvl-(\d{1,4})$/.exec(String(id || ''));
  if (!m) return null;
  const L = Number(m[1]);
  return L >= 2 && L <= MAX_LEVEL ? L : null;
}

export function levelChapter(level) {
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

// ---------- crawlers + the Sandmaw boss (client sim, server-validated rewards) ----------
// Every theme has two crawlers: a primary (always) and a secondary (deeper in the level).
// Names and art are original; the taglines are affectionate nods to well-known films and games.
export const CRAWLERS = {
  trenches: [
    { id: 'mudling', name: 'Mudling', kind: 'walker', body: '#8a5a2b', eye: '#ffd400', tag: 'NEVER FEED AFTER MIDNIGHT' },
    { id: 'wireskitter', name: 'Wire Skitter', kind: 'hopper', body: '#0b1a8f', eye: '#ff2bd6', tag: 'ENLIST TODAY, DIG TOMORROW' }
  ],
  mines: [
    { id: 'hissbug', name: 'Hissbug', kind: 'fuser', body: '#22e36b', eye: '#0b1a8f', tag: 'SSSSSS...' },
    { id: 'lampmole', name: 'Lamp Mole', kind: 'walker', body: '#c9a27a', eye: '#ffd400', tag: 'YOU SHALL NOT DIG' }
  ],
  chalk: [
    { id: 'paleclinger', name: 'Pale Clinger', kind: 'dropper', body: '#7fa0ff', eye: '#ff2bd6', tag: 'IN THE CHALK NO ONE HEARS YOU DIG' },
    { id: 'bonechitter', name: 'Bone Chitter', kind: 'hopper', body: '#e6ecff', eye: '#0052ff', tag: "THEY'RE HERE" }
  ],
  flooded: [
    { id: 'gillnipper', name: 'Gill Nipper', kind: 'hopper', body: '#16e0ff', eye: '#0b1a8f', tag: 'NEED A BIGGER SHOVEL' },
    { id: 'pumpleech', name: 'Pump Leech', kind: 'walker', body: '#0a2fd1', eye: '#16e0ff', tag: 'STAY OUT OF THE WATER' }
  ],
  ember: [
    { id: 'cinderimp', name: 'Cinder Imp', kind: 'spitter', body: '#ff2bd6', eye: '#ffd400', tag: 'RIP AND DIG' },
    { id: 'magmatick', name: 'Magma Tick', kind: 'walker', body: '#ffd400', eye: '#ff2bd6', tag: 'THE FLOOR IS LAVA' }
  ],
  core: [
    { id: 'glitchmite', name: 'Glitch Mite', kind: 'blinker', body: '#22e36b', eye: '#ffffff', tag: 'DEJA VU? A GLITCH' },
    { id: 'packetcrawler', name: 'Packet Crawler', kind: 'walker', body: '#16e0ff', eye: '#22e36b', tag: 'ENTER THE GRID' }
  ],
  punks: [
    { id: 'pixelpunk', name: 'Pixel Punk', kind: 'walker', body: '#0052ff', eye: '#ffffff', tag: 'STAY BASED' },
    { id: 'mohawker', name: 'Mohawk Hopper', kind: 'hopper', body: '#16e0ff', eye: '#0b1a8f', tag: 'BASE IS FOR EVERYONE' }
  ],
  sands: [
    { id: 'spicemite', name: 'Spice Mite', kind: 'swarmer', body: '#ffd400', eye: '#ff2bd6', tag: 'THE DIRT MUST FLOW' },
    { id: 'wormling', name: 'Wormling', kind: 'burrower', body: '#c9a27a', eye: '#0b1a8f', tag: 'STEP SOFT, STEP ODD' }
  ]
};
export const CRAWLER_KINDS = ['walker', 'hopper', 'fuser', 'dropper', 'spitter', 'blinker', 'swarmer', 'burrower'];
export const CRAWLER_MIN_DEPTH_M = 12;   // nothing crawls in the first few meters under the trench
export const BOSS_ZONE_M = 60;           // the Sandmaw wakes this far above a level's floor
export const BOSS_MIN_FIGHT_MS = 15_000; // server: a kill sooner than this after the spawn is rejected
export const TELEPORT_COOLDOWN_S = 90;
export const ELEVATOR_SHAFT_STEP_M = 100; // levels locked: shaft stops every 100 m of level 1
export const ELEVATOR_MAX_STOPS = 12;

// The "tier" crawlers and the boss scale with. Levels unlocked: the world level. Locked
// (prod): level 1 is endless, so the tier grows every LEVEL_DEPTH_M meters of depth instead
// (difficulty only; no themes, chapters or levels 2+ are revealed).
export function crawlerTier(depth) {
  const d = Math.max(0, Math.floor(Number(depth) || 0));
  return clampLevel(Math.floor(d / LEVEL_DEPTH_M) + 1);
}

export function crawlersFor(level) {
  return CRAWLERS[themeFor(level).id] || CRAWLERS.trenches;
}

// Crawler stats for a tier and how far into its level you are (0..LEVEL_DEPTH_M-1).
// Level 1 at the top is gentle; everything climbs without a cap.
export function crawlerStats(tier, levelDepth = 0) {
  const L = clampLevel(tier);
  const f = Math.max(0, Math.min(1, (Number(levelDepth) || 0) / LEVEL_DEPTH_M));
  const t = (L - 1) + f;                     // smooth: 0 at the top of level 1
  return {
    hp: Math.max(1, Math.round(1 + 1.2 * t)),
    damage: 1 + Math.floor(t / 3),
    speed: Math.min(84, Math.round(22 + 5 * t)),
    maxAlive: Math.min(12, 2 + Math.floor(t * 1.3)),
    spawnEvery: Math.max(1.1, 6.5 - 0.7 * t),  // seconds between spawn attempts
    secondaryChance: f < 0.3 && L === 1 ? 0 : Math.min(0.5, 0.2 + 0.05 * t)
  };
}

// ---------- Attack of the Punks: Base culture slogans + the Builder #001 tribute boss ----------
// Only phrases Base (@base) or Jesse Pollak (@jessepollak) used publicly, with the post they came from.
export const PUNK_SLOGANS = [
  { text: 'STAY BASED', src: 'https://x.com/base/status/1931073901301506426' },
  { text: 'NEW WEEK, SAME TEAM, STAY BASED, KEEP BUILDING', src: 'https://x.com/jessepollak/status/1977772900179652715' },
  { text: 'BASE IS FOR EVERYONE', src: 'https://x.com/jessepollak/status/2011537655180230683' },
  { text: "IT'S TIME TO BRING THE WORLD ONCHAIN", src: 'https://x.com/jessepollak/status/2001375464603128251' },
  { text: "ONCHAIN SUMMER DOESN'T STOP", src: 'https://x.com/base/status/1826754546410160396' },
  { text: 'BUILD ON BASE', src: 'https://x.com/base/status/1826334930554814507' },
  { text: 'DAY BY DAY WE WILL BRING THE WORLD ONCHAIN', src: 'https://x.com/jessepollak/status/2011525884642279490' }
];

// A friendly final boss: a pixel tribute to Jesse Pollak's punk-style X avatar (sampled 24x24 from
// the public avatar, `src`). He challenges you to build; nothing here mocks or insults him.
// h hair · s skin · e eye · k outline/pupil · m mouth · g vape · b vape tip (Base blue) · . clear
export const PUNK_BOSS = {
  id: 'punk',
  name: 'BUILDER #001',
  tribute: 'JESSE.BASE.ETH',
  note: 'FAN TRIBUTE · NOT AFFILIATED WITH BASE OR COINBASE',
  intro: 'BUILDER #001 CHALLENGES YOU TO BUILD ONCHAIN',
  lines: ['STAY BASED', 'BASE IS FOR EVERYONE', 'BUILD ON BASE', "ONCHAIN SUMMER DOESN'T STOP", "IT'S TIME TO BRING THE WORLD ONCHAIN"],
  defeat: 'GG, BUILDER. NEW WEEK, SAME TEAM, STAY BASED, KEEP BUILDING.',
  src: 'https://pbs.twimg.com/profile_images/1879556312822120448/QngrqCSC_400x400.jpg',
  palette: { h: '#fff68d', s: '#ae8b61', e: '#89571a', k: '#000207', m: '#5c1e09', g: '#595959', b: '#0052ff' },
  sprite: [
    '........................',
    '........................',
    '........................',
    '...........h..hh........',
    '........hh..hhhh.h......',
    '......hhhhh.hhhhh.......',
    '.....hhh.hhhhhh.hhhhh...',
    '....hh.hhhhhhhhhhhh.....',
    '...hhhhhhhhhhhhhhh......',
    '.....hhhhhsssshhhhhh....',
    '....hhhhsshssshshhh.h...',
    '...hhhhhssssshsskhhh....',
    '....hhksseessseekhhhh...',
    '...hhhkssksssskskhhhh...',
    '....hhkksssssssskhhh....',
    '...hhhhksssssssskh.h....',
    '....h.hhssssksssh.h.....',
    '....hhhksssssskkkkkkk...',
    '.....h.ksssmmkgggggbk...',
    '........kssssskkkkkkk...',
    '........ksksssk.........',
    '........ksskkk..........',
    '........ksssk...........',
    '........ksssk...........'
  ]
};
export const PUNK_MIN_FIGHT_MS = 20_000; // the punk fight is longer than the Sandmaw's

// Which boss guards a level band's floor. Locked (prod default): always the Sandmaw, so nothing
// from levels 2+ (the punks included) ever shows.
export function bossFor(band, unlocked) {
  if (!unlocked) return 'sandmaw';
  return themeFor(band).id === 'punks' ? 'punk' : 'sandmaw';
}
export function bossMinFightMs(id) { return id === 'punk' ? PUNK_MIN_FIGHT_MS : BOSS_MIN_FIGHT_MS; }

export function bossStats(tier, id = 'sandmaw') {
  const L = clampLevel(tier);
  if (id === 'punk') {
    return {
      id: 'punk',
      hp: Math.round(1.25 * (14 + 7 * (L - 1))),
      damage: 1 + Math.floor((L - 1) / 3),
      segments: 0,
      speed: Math.min(130, 60 + 6 * (L - 1)),
      dropEvery: Math.max(1.4, 2.8 - 0.12 * (L - 1)),  // seconds between telegraphed block drops
      swoopEvery: 3,                                  // every Nth attack is a swoop that leaves it dazed
      exposed: Math.max(1.2, 2.0 - 0.08 * (L - 1)),
      name: PUNK_BOSS.name
    };
  }
  return {
    id: 'sandmaw',
    hp: Math.round(14 + 7 * (L - 1)),
    damage: 1 + Math.floor((L - 1) / 3),
    segments: Math.min(14, 7 + Math.floor((L - 1) / 2)),
    speed: Math.min(150, 70 + 8 * (L - 1)),
    lungeEvery: Math.max(1.6, 3.2 - 0.15 * (L - 1)),
    exposed: Math.max(1.1, 1.9 - 0.08 * (L - 1)),
    name: 'SANDMAW'
  };
}

// Meters into the current level band (works locked or unlocked).
export function levelDepthOf(depth) {
  const d = Math.max(0, Math.floor(Number(depth) || 0));
  return d % LEVEL_DEPTH_M;
}
export function bossBand(depth) { return Math.floor(Math.max(0, Math.floor(Number(depth) || 0)) / LEVEL_DEPTH_M) + 1; }
// True near the bottom of a level band, where the Sandmaw guards the floor. `slack` widens it (server).
export function inBossZone(depth, slack = 0) {
  return levelDepthOf(depth) >= LEVEL_DEPTH_M - 1 - BOSS_ZONE_M - slack;
}

// Server-side XP for crawler kills and the boss, by verified world level.
export function killXp(level) { return Math.min(8, 2 + Math.floor((clampLevel(level) - 1) / 2)); }
export function bossXp(level) { return Math.min(240, 60 + 20 * (clampLevel(level) - 1)); }

// Elevator stops for a profile. Unlocked: the top of every level you have reached.
// Locked: level 1 only, the surface plus a shaft stop every 100 m down to your best depth.
export function elevatorStops({ bestDepth = 0, maxLevel = 1, unlocked = false } = {}) {
  const best = Math.max(0, Math.floor(Number(bestDepth) || 0));
  const stops = [{ level: 1, depth: 0, label: 'SURFACE' }];
  if (unlocked) {
    const top = Math.max(clampLevel(maxLevel), levelForDepth(best, true));
    for (let L = 2; L <= top; L++) {
      const t = themeFor(L);
      stops.push({ level: L, depth: levelTopDepth(L) + 2, label: 'LEVEL ' + L + ' · ' + t.displayName.toUpperCase() });
    }
  } else {
    const shaft = [];
    for (let d = ELEVATOR_SHAFT_STEP_M; d <= best; d += ELEVATOR_SHAFT_STEP_M) shaft.push({ level: 1, depth: d, label: 'SHAFT ' + d + 'M' });
    stops.push(...shaft);
  }
  return stops.length > ELEVATOR_MAX_STOPS ? [stops[0], ...stops.slice(-(ELEVATOR_MAX_STOPS - 1))] : stops;
}

export function validElevatorStop(depth, ctx = {}) {
  const d = Math.floor(Number(depth));
  if (!Number.isFinite(d)) return null;
  return elevatorStops(ctx).find(s => s.depth === d) || null;
}
