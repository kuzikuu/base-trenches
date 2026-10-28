// RPG skills: Digging, Combat, Engineering, Scouting, Medic.
// Pure logic, shared with the browser: tools/gen-shared.mjs copies this file to js/skills.js
// (window.BTSkills). Edit here, then run `node tools/gen-shared.mjs`.
//
// Points come from the server-owned XP level (2 per level after 1) plus 1 per level of the
// world reached past level 1. Spending is validated server-side; the client only renders.

export const SKILL_MAX_RANK = 5;
// Ranks 4 and 5 of any skill need this character level.
export const RANK_LEVEL_GATE = { 4: 6, 5: 8 };
export const RESPEC_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const SKILLS = [
  { id: 'digging', name: 'Digging', icon: '⛏', req: null,
    desc: 'Faster swings. Soft ground breaks quicker.',
    ranks: ['+12% dig speed', '+24% dig speed', '+36% · soft dirt and clay take double damage', '+48% dig speed', '+60% · 20% chance to break any block in one swing'] },
  { id: 'combat', name: 'Combat', icon: '⚔', req: null,
    desc: 'Pickaxe damage against crawlers and the Sandmaw. Parry bullets.',
    ranks: ['Pick hits crawlers for 2', 'Pick hits for 3', 'Hits for 4 · 15% chance to parry a bullet', 'Hits for 5 · 30% parry', 'Hits for 6 · 45% parry'] },
  { id: 'scouting', name: 'Scouting', icon: '◎', req: null,
    desc: 'See further in the dark below level 1. Earlier warnings for sweeps and charges.',
    ranks: ['+4 tiles of sight · +0.12s warning', '+6 sight · depth compass to the level floor', '+8 sight · +0.36s warning', '+10 sight · +0.48s warning', '+12 sight · +0.6s warning'] },
  { id: 'engineering', name: 'Engineering', icon: '▤', req: { digging: 2 },
    desc: 'Build timber fortifications (F / ▤) that stop bullets and crawlers.',
    ranks: ['Fortify every 9.2s · 3 HP timber', 'Every 7.4s · 4 HP', 'Every 5.6s · 5 HP · blasts hit you for 1 less', 'Every 3.8s · 6 HP', 'Every 2s · 7 HP'] },
  { id: 'medic', name: 'Medic', icon: '✚', req: { combat: 1, scouting: 1 },
    desc: 'Patch yourself up over time. Field medics get a second wind.',
    ranks: ['Regain 1 life every 70s', 'Every 60s', 'Every 50s', 'Every 40s', 'Every 30s · second wind: once per run, revive with 3 lives'] }
];
export const SKILL_IDS = SKILLS.map(s => s.id);

export function emptySkills() {
  const o = {};
  for (const id of SKILL_IDS) o[id] = 0;
  return o;
}

export function normalizeSkills(raw) {
  const out = emptySkills();
  if (raw && typeof raw === 'object') {
    for (const id of SKILL_IDS) {
      const n = Math.floor(Number(raw[id]) || 0);
      out[id] = Math.max(0, Math.min(SKILL_MAX_RANK, n));
    }
  }
  return out;
}

export function skillPoints(level, maxLevel = 1) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  const ml = Math.max(1, Math.floor(Number(maxLevel) || 1));
  return 2 * (lv - 1) + (ml - 1);
}

export function spentPoints(skills) {
  const s = normalizeSkills(skills);
  return SKILL_IDS.reduce((sum, id) => sum + s[id], 0);
}

export function availablePoints(skills, ctx = {}) {
  return skillPoints(ctx.level, ctx.maxLevel) - spentPoints(skills);
}

export function getSkill(id) { return SKILLS.find(s => s.id === id) || null; }

export function canLearn(skills, id, ctx = {}) {
  const def = getSkill(id);
  if (!def) return { ok: false, reason: 'unknown_skill' };
  const s = normalizeSkills(skills);
  const next = s[id] + 1;
  if (next > SKILL_MAX_RANK) return { ok: false, reason: 'maxed' };
  if (availablePoints(s, ctx) < 1) return { ok: false, reason: 'no_points' };
  if (def.req) {
    for (const [rid, need] of Object.entries(def.req)) {
      if ((s[rid] || 0) < need) return { ok: false, reason: 'requires_' + rid };
    }
  }
  const gate = RANK_LEVEL_GATE[next];
  if (gate && Math.floor(Number(ctx.level) || 1) < gate) return { ok: false, reason: 'level_' + gate };
  return { ok: true, rank: next };
}

export function learn(skills, id, ctx = {}) {
  const chk = canLearn(skills, id, ctx);
  if (!chk.ok) return { ok: false, reason: chk.reason, skills: normalizeSkills(skills) };
  const s = normalizeSkills(skills);
  s[id] = chk.rank;
  return { ok: true, skills: s };
}

// Re-check a stored allocation (e.g. after a profile migration). Removes ranks from the end of
// the tree until it fits the points and prerequisites again.
export function validateSkills(skills, ctx = {}) {
  let s = normalizeSkills(skills);
  const fits = x => spentPoints(x) <= skillPoints(ctx.level, ctx.maxLevel) && SKILLS.every(def => {
    if (!x[def.id]) return true;
    if (def.req && Object.entries(def.req).some(([rid, need]) => x[rid] < need)) return false;
    for (let r = 4; r <= x[def.id]; r++) if (RANK_LEVEL_GATE[r] && (Number(ctx.level) || 1) < RANK_LEVEL_GATE[r]) return false;
    return true;
  });
  const order = SKILL_IDS.slice().reverse();
  let guard = 0;
  while (!fits(s) && guard++ < 50) {
    const id = order.find(k => s[k] > 0);
    if (!id) break;
    s = { ...s, [id]: s[id] - 1 };
  }
  return s;
}

// Gameplay numbers for a skill allocation. Gear stacks on top of these.
export function skillEffects(skills) {
  const s = normalizeSkills(skills);
  return {
    digSpeed: 1 + 0.12 * s.digging,
    softDouble: s.digging >= 3,
    oneShot: s.digging >= 5 ? 0.2 : 0,
    melee: 1 + s.combat,
    parry: s.combat >= 3 ? 0.15 * (s.combat - 2) : 0,
    fortifyCooldown: s.engineering ? Math.max(2, Math.round((11 - 1.8 * s.engineering) * 10) / 10) : 0,
    fortifyHp: s.engineering ? 2 + s.engineering : 0,
    blastReduce: s.engineering >= 3 ? 1 : 0,
    reveal: s.scouting ? 2 + 2 * s.scouting : 0,
    warnBonus: 0.12 * s.scouting,
    compass: s.scouting >= 2,
    regenEvery: s.medic ? 80 - 10 * s.medic : 0,
    secondWind: s.medic >= 5
  };
}
