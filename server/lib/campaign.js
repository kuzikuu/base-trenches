// Data-driven RPG campaign. Keep mission ids in sync with js/campaign.js.
// Level 1 = Campaign 1 (the five chapters below). Levels 2+ get a generated campaign per level
// (see levels.js levelChapter); those unlock when the player first reaches that level.

import { levelChapter, parseLevelChapterId, clampLevel } from './levels.js';

const LEVEL_STAT_KEYS = ['survive', 'dodge', 'relic'];
const MAX_LEVEL_STAT_ENTRIES = 24;

export const CHAPTERS = [
  {
    id: 'basic-training',
    name: 'Basic Training',
    brief: 'Learn the shaft. Dig, duck, and bring back a relic before the sergeant notices.',
    index: 0,
    missions: [
      { id: 'bt-dig-25', type: 'dig', target: 25, title: 'First Shaft', desc: 'Dig 25 meters down.', xp: 25 },
      { id: 'bt-survive-3', type: 'survive', target: 3, title: 'Keep Your Head Down', desc: 'Survive 3 artillery barrages.', xp: 25 },
      { id: 'bt-relic', type: 'relic', target: 1, title: 'Training Relic', desc: 'Find the mess-tin relic in the clay.', xp: 40 },
      { id: 'bt-boss', type: 'boss', target: 1, title: 'The Drill Sergeant', desc: 'Boss raid: hold the training trench. Survive 5 barrages in one run.', xp: 100, boss: true }
    ],
    rewards: {
      title: 'Recruit',
      gear: { type: 'helmet', name: 'Tin Helmet', rarity: 1, protection: 1, desc: 'Absorbs 1 hit' }
    }
  },
  {
    id: 'the-front',
    name: 'The Front',
    brief: 'The duckboards end. Machine-gun lanes and a nest that has to fall.',
    index: 1,
    missions: [
      { id: 'tf-dig-75', type: 'dig', target: 75, title: 'Forward Trench', desc: 'Dig 75 meters.', xp: 35 },
      { id: 'tf-survive-8', type: 'survive', target: 8, title: 'Under Fire', desc: 'Survive 8 barrages.', xp: 35 },
      { id: 'tf-dodge-10', type: 'dodge', target: 10, title: 'Sweep Dodger', desc: 'Dodge 10 machine-gun sweeps.', xp: 30 },
      { id: 'tf-relic', type: 'relic', target: 1, title: 'Front Relic', desc: 'Find the periscope relic.', xp: 45 },
      { id: 'tf-boss', type: 'boss', target: 1, title: 'Machine-Gun Nest', desc: 'Boss raid: silence the nest. Survive 5 barrages in one run.', xp: 120, boss: true }
    ],
    rewards: {
      title: 'Frontliner',
      gear: { type: 'pickaxe', name: 'Iron Pick', rarity: 1, digSpeed: 1.15, desc: '+15% dig speed' }
    }
  },
  {
    id: 'no-mans-land',
    name: "No Man's Land",
    brief: 'Wire, craters, and a night raid. Nobody holds this ground for long.',
    index: 2,
    missions: [
      { id: 'nml-dig-150', type: 'dig', target: 150, title: 'Across the Wire', desc: 'Dig 150 meters.', xp: 45 },
      { id: 'nml-survive-12', type: 'survive', target: 12, title: 'Crater Watch', desc: 'Survive 12 barrages.', xp: 45 },
      { id: 'nml-relic', type: 'relic', target: 1, title: 'Lost Relic', desc: 'Find the wire-cutter relic.', xp: 50 },
      { id: 'nml-squad', type: 'squad', target: 1, title: 'Squad Objective', desc: 'Finish a shared squad objective.', xp: 50 },
      { id: 'nml-boss', type: 'boss', target: 1, title: 'Night Raid', desc: 'Boss raid: cross no man\'s land after dark. Survive 5 barrages in one run.', xp: 150, boss: true }
    ],
    rewards: {
      title: 'Raider',
      gear: { type: 'boots', name: "Runner's Boots", rarity: 2, moveSpeed: 1.2, desc: '+20% move speed' }
    }
  },
  {
    id: 'over-the-top',
    name: 'Over the Top',
    brief: 'The whistle goes. Climb the parapet and keep moving.',
    index: 3,
    missions: [
      { id: 'ott-dig-250', type: 'dig', target: 250, title: 'The Jump-Off', desc: 'Dig 250 meters.', xp: 55 },
      { id: 'ott-survive-20', type: 'survive', target: 20, title: 'Creeping Barrage', desc: 'Survive 20 barrages.', xp: 55 },
      { id: 'ott-dodge-25', type: 'dodge', target: 25, title: 'Over the Parapet', desc: 'Dodge 25 sweeps.', xp: 45 },
      { id: 'ott-relic', type: 'relic', target: 1, title: 'Command Relic', desc: 'Find the whistle relic.', xp: 60 },
      { id: 'ott-boss', type: 'boss', target: 1, title: 'The Whistle', desc: 'Boss raid: go over the top. Survive 5 barrages in one run.', xp: 180, boss: true }
    ],
    rewards: {
      title: 'Veteran',
      gear: { type: 'charm', name: "Rabbit's Foot", rarity: 2, luck: 1.25, desc: '+25% diamond luck' }
    }
  },
  {
    id: 'the-big-push',
    name: 'The Big Push',
    brief: 'Zero hour. Nine trenchers, one objective, manifesting 589x.',
    index: 4,
    missions: [
      { id: 'tbp-dig-400', type: 'dig', target: 400, title: 'Zero Hour Dig', desc: 'Dig 400 meters.', xp: 70 },
      { id: 'tbp-survive-30', type: 'survive', target: 30, title: 'The Big Noise', desc: 'Survive 30 barrages.', xp: 70 },
      { id: 'tbp-relic', type: 'relic', target: 1, title: '589 Relic', desc: 'Find the 589 relic.', xp: 80 },
      { id: 'tbp-squad', type: 'squad', target: 1, title: 'The Nine', desc: 'Complete a squad objective of 9.', xp: 80 },
      { id: 'tbp-boss', type: 'boss', target: 1, title: 'Zero Hour', desc: 'Boss raid: the big push. Survive 5 barrages in one run.', xp: 250, boss: true }
    ],
    rewards: {
      title: '589 Manifested',
      gear: { type: 'pickaxe', name: "Trencher's Fury", rarity: 4, digSpeed: 1.8, desc: '+80% dig speed' }
    }
  }
];

export function emptyProgress() {
  return {
    completed: {},
    stats: { depth: 0, survive: 0, dodge: 0, relic: 0, squad: 0, boss: 0, dig: 0 },
    titles: [],
    rewardedChapters: {},
    maxLevel: 1,
    levelStats: {}
  };
}

function normalizeLevelStats(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const keys = Object.keys(raw).map(Number).filter(n => Number.isInteger(n) && n >= 2).sort((a, b) => b - a).slice(0, MAX_LEVEL_STAT_ENTRIES);
  for (const k of keys) {
    const v = raw[k] || {};
    out[k] = {};
    for (const sk of LEVEL_STAT_KEYS) out[k][sk] = Math.max(0, Math.floor(Number(v[sk]) || 0));
  }
  return out;
}

export function normalizeProgress(raw) {
  const base = emptyProgress();
  if (!raw || typeof raw !== 'object') return base;
  return {
    completed: raw.completed && typeof raw.completed === 'object' ? { ...raw.completed } : {},
    stats: { ...base.stats, ...(raw.stats || {}) },
    titles: Array.isArray(raw.titles) ? raw.titles.slice() : [],
    rewardedChapters: raw.rewardedChapters && typeof raw.rewardedChapters === 'object' ? { ...raw.rewardedChapters } : {},
    maxLevel: clampLevel(raw.maxLevel || 1),
    levelStats: normalizeLevelStats(raw.levelStats)
  };
}

export function getChapter(id) {
  const L = parseLevelChapterId(id);
  if (L) return levelChapter(L);
  return CHAPTERS.find(c => c.id === id) || null;
}

export function getMission(chapterId, missionId) {
  const ch = getChapter(chapterId);
  if (!ch) return null;
  const mission = ch.missions.find(m => m.id === missionId);
  return mission ? { chapter: ch, mission } : null;
}

export function chapterUnlocked(progress, chapter) {
  progress = normalizeProgress(progress);
  if (!chapter || chapter.index === 0) return true;
  if (chapter.level >= 2) return progress.maxLevel >= chapter.level;
  const prev = CHAPTERS[chapter.index - 1];
  if (!prev) return false;
  const boss = prev.missions.find(m => m.boss);
  return !!(boss && progress.completed[boss.id]);
}

export function missionReady(progress, chapter, mission) {
  progress = normalizeProgress(progress);
  if (!chapter || !mission) return false;
  if (!chapterUnlocked(progress, chapter)) return false;
  if (progress.completed[mission.id]) return false;
  const idx = chapter.missions.findIndex(m => m.id === mission.id);
  for (let i = 0; i < idx; i++) {
    if (!progress.completed[chapter.missions[i].id]) return false;
  }
  return true;
}

export function statForType(type) {
  if (type === 'dig') return 'depth';
  return type;
}

export function statsMeet(progress, mission) {
  progress = normalizeProgress(progress);
  const key = statForType(mission.type);
  const have = mission.scope === 'level'
    ? Number((progress.levelStats[mission.level] || {})[key] || 0)
    : Number(progress.stats[key] || 0);
  return have >= (mission.target || 1);
}

export function canComplete(progress, chapterId, missionId) {
  const found = getMission(chapterId, missionId);
  if (!found) return { ok: false, reason: 'unknown' };
  const { chapter, mission } = found;
  progress = normalizeProgress(progress);
  if (progress.completed[mission.id]) return { ok: false, reason: 'already' };
  if (!chapterUnlocked(progress, chapter)) return { ok: false, reason: 'locked_chapter' };
  if (!missionReady(progress, chapter, mission)) return { ok: false, reason: 'locked_mission' };
  if (!statsMeet(progress, mission)) return { ok: false, reason: 'stats' };
  return { ok: true, chapter, mission };
}

// level: the world level the event happened on (survive/dodge/relic also count per level 2+).
export function noteStat(progress, kind, amount = 1, level = 1) {
  progress = normalizeProgress(progress);
  const L = clampLevel(level);
  if (L > progress.maxLevel) progress.maxLevel = L;
  if (L >= 2 && LEVEL_STAT_KEYS.includes(kind)) {
    const ls = progress.levelStats[L] || { survive: 0, dodge: 0, relic: 0 };
    ls[kind] = (ls[kind] || 0) + (Number(amount) || 1);
    progress.levelStats[L] = ls;
    progress.levelStats = normalizeLevelStats(progress.levelStats);
  }
  const key = kind === 'dig' ? 'depth' : (kind === 'survive' || kind === 'dodge' || kind === 'relic' || kind === 'squad' || kind === 'boss' || kind === 'depth' ? (kind === 'depth' ? 'depth' : kind) : null);
  if (kind === 'depth' || kind === 'dig') {
    const n = Number(amount) || 0;
    if (n > progress.stats.depth) progress.stats.depth = n;
    return progress;
  }
  if (!key) return progress;
  progress.stats[key] = (progress.stats[key] || 0) + (Number(amount) || 1);
  return progress;
}

export function completeMission(progress, chapterId, missionId, now = Date.now()) {
  const check = canComplete(progress, chapterId, missionId);
  if (!check.ok) return { ok: false, reason: check.reason, progress: normalizeProgress(progress), rewards: [] };
  const next = normalizeProgress(progress);
  next.completed[missionId] = now;
  const rewards = [];
  const { chapter, mission } = check;
  if (mission.boss && !next.rewardedChapters[chapter.id]) {
    next.rewardedChapters[chapter.id] = now;
    if (chapter.rewards && chapter.rewards.title && !next.titles.includes(chapter.rewards.title)) {
      next.titles.push(chapter.rewards.title);
    }
    rewards.push({
      chapterId: chapter.id,
      title: chapter.rewards && chapter.rewards.title,
      gear: chapter.rewards && chapter.rewards.gear,
      xp: mission.xp
    });
  }
  return { ok: true, progress: next, mission, chapter, rewards, xp: mission.xp || 0 };
}

export function noteLevel(progress, level) {
  progress = normalizeProgress(progress);
  const L = clampLevel(level);
  if (L > progress.maxLevel) progress.maxLevel = L;
  return progress;
}

// opts.levelsUnlocked: also list level campaigns 2..maxLevel+1 (the next one shows as locked).
export function campaignPublic(progress, opts = {}) {
  progress = normalizeProgress(progress);
  const chapters = CHAPTERS.slice();
  if (opts.levelsUnlocked) {
    const top = Math.min(progress.maxLevel + 1, 9999);
    const from = Math.max(2, top - 11);
    for (let L = from; L <= top; L++) chapters.push(levelChapter(L));
  }
  return {
    maxLevel: progress.maxLevel,
    levelStats: progress.levelStats,
    chapters: chapters.map(ch => ({
      level: ch.level || 1,
      theme: ch.theme || 'trenches',
      id: ch.id,
      name: ch.name,
      brief: ch.brief,
      index: ch.index,
      unlocked: chapterUnlocked(progress, ch),
      rewards: ch.rewards,
      missions: ch.missions.map(m => ({
        ...m,
        done: !!progress.completed[m.id],
        ready: missionReady(progress, ch, m)
      }))
    })),
    stats: progress.stats,
    titles: progress.titles
  };
}
