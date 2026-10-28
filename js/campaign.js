// RPG campaign data + map renderer. Mission ids stay in sync with server/lib/campaign.js.
(function(){
"use strict";

const CHAPTERS = [
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
    rewards: { title: 'Recruit', gear: { type: 'helmet', name: 'Tin Helmet', rarity: 1 } }
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
    rewards: { title: 'Frontliner', gear: { type: 'pickaxe', name: 'Iron Pick', rarity: 1 } }
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
    rewards: { title: 'Raider', gear: { type: 'boots', name: "Runner's Boots", rarity: 2 } }
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
    rewards: { title: 'Veteran', gear: { type: 'charm', name: "Rabbit's Foot", rarity: 2 } }
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
    rewards: { title: '589 Manifested', gear: { type: 'pickaxe', name: "Trencher's Fury", rarity: 4 } }
  }
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function emptyProgress() {
  return { completed: {}, stats: { depth: 0, survive: 0, dodge: 0, relic: 0, squad: 0, boss: 0 }, titles: [], maxLevel: 1, levelStats: {} };
}

// Levels 2+ each have their own generated campaign (shared code: js/levels.js).
let levelsOn = false;
function setLevelsEnabled(on) { levelsOn = !!on; }
function allChapters() {
  if (!levelsOn || typeof BTLevels === 'undefined') return CHAPTERS;
  const top = Math.max(2, (progress.maxLevel || 1) + 1);
  const out = CHAPTERS.slice();
  for (let L = Math.max(2, top - 11); L <= top; L++) out.push(BTLevels.levelChapter(L));
  return out;
}
function chapterOpen(ch) {
  if (ch.level >= 2) return (progress.maxLevel || 1) >= ch.level;
  const prev = CHAPTERS[ch.index - 1];
  return !prev || prev.missions.filter(m => m.boss).every(m => progress.completed[m.id]);
}
function statFor(m) {
  const key = m.type === 'dig' ? 'depth' : m.type;
  if (m.scope === 'level') return ((progress.levelStats || {})[m.level] || {})[key] || 0;
  return progress.stats[key] || 0;
}

let progress = emptyProgress();
const session = { survive: 0, dodge: 0, relic: 0, depth: 0, raid: 0 };
// Boss raid: once a chapter's other missions are done, survive RAID_SURVIVES barrages in
// one run. The server checks the same count for the session before accepting it.
const RAID_SURVIVES = 5;
const sentAt = {};

function banner(text) {
  if (typeof Game !== 'undefined' && Game._debug && Game._debug.showBanner) Game._debug.showBanner(text);
}

function readyBoss() {
  for (const ch of allChapters()) {
    if (!chapterOpen(ch)) { if (ch.level >= 2) continue; return null; }
    const boss = ch.missions.find(m => m.boss);
    if (!boss || progress.completed[boss.id]) continue;
    const others = ch.missions.filter(m => !m.boss);
    return others.every(m => progress.completed[m.id]) ? boss : null;
  }
  return null;
}

function applyServer(pub) {
  if (!pub) return;
  if (pub.stats) progress.stats = { ...progress.stats, ...pub.stats };
  if (Array.isArray(pub.titles)) progress.titles = pub.titles;
  if (pub.maxLevel) progress.maxLevel = Math.max(progress.maxLevel || 1, pub.maxLevel);
  if (pub.levelStats) progress.levelStats = pub.levelStats;
  if (pub.chapters) {
    progress.completed = {};
    pub.chapters.forEach(ch => (ch.missions || []).forEach(m => { if (m.done) progress.completed[m.id] = true; }));
  }
}

function note(kind, amount, level) {
  const L = Math.max(1, Math.floor(level || 1));
  if (L > (progress.maxLevel || 1)) progress.maxLevel = L;
  if (L >= 2 && (kind === 'survive' || kind === 'dodge' || kind === 'relic')) {
    const ls = progress.levelStats[L] || (progress.levelStats[L] = { survive: 0, dodge: 0, relic: 0 });
    ls[kind] = (ls[kind] || 0) + (amount || 1);
  }
  if (kind === 'depth' || kind === 'dig') {
    const n = Number(amount) || 0;
    if (n > session.depth) session.depth = n;
    if (n > (progress.stats.depth || 0)) progress.stats.depth = n;
    tryComplete();
    return;
  }
  if (kind === 'survive' || kind === 'dodge' || kind === 'relic' || kind === 'squad' || kind === 'boss') {
    session[kind] = (session[kind] || 0) + (amount || 1);
    progress.stats[kind] = (progress.stats[kind] || 0) + (amount || 1);
  }
  if (kind === 'survive') {
    const boss = readyBoss();
    if (boss) {
      session.raid++;
      if (session.raid >= RAID_SURVIVES) { session.raid = 0; progress.stats.boss = (progress.stats.boss || 0) + 1; }
      else banner(`RAID ${session.raid}/${RAID_SURVIVES}`);
    }
  }
  tryComplete();
}

function tryComplete() {
  const profile = typeof RPG !== 'undefined' ? RPG.getProfile() : null;
  for (const ch of allChapters()) {
    if (!chapterOpen(ch)) continue;
    for (const m of ch.missions) {
      if (progress.completed[m.id]) continue;
      const idx = ch.missions.indexOf(m);
      if (ch.missions.slice(0, idx).some(x => !progress.completed[x.id])) break;
      if (statFor(m) < m.target) break;
      if (typeof Multiplayer !== 'undefined' && Multiplayer.connected) {
        // Wait for the server's answer instead of re-sending on every dig.
        if (sentAt[m.id] && Date.now() - sentAt[m.id] < 15000) break;
        sentAt[m.id] = Date.now();
        Multiplayer.sendEvent({ kind: m.boss ? 'boss' : 'mission', chapterId: ch.id, missionId: m.id });
      } else {
        progress.completed[m.id] = Date.now();
      }
      banner((m.boss ? 'RAID ' : 'MISSION ') + m.title.toUpperCase());
      break;
    }
  }
}

function renderMap() {
  const titles = (progress.titles || []).map(t => `<span class="title-chip">${esc(t)}</span>`).join('') || '<span class="empty">NO TITLES YET</span>';
  const stats = progress.stats || {};
  const chapters = allChapters();
  let html = `<p class="note">${levelsOn ? 'Campaign 1 is five chapters. Every level below it has its own campaign. Break the floor of a level to drop into the next.' : 'Five chapters.'} Dig, survive the barrages, find the relics, hit the squad mark, then the boss raid. Progress is saved on the server.</p>
    <div class="campaign-titles">${titles}</div>
    <div class="campaign-stats">DEPTH ${stats.depth||0}M · SURVIVED ${stats.survive||0} · DODGES ${stats.dodge||0} · RELICS ${stats.relic||0}</div>
    <div class="trench-map">`;
  chapters.forEach((ch, i) => {
    const unlocked = chapterOpen(ch);
    if (ch.level === 2) html += `<div class="level-divider dotmatrix">▼ BELOW CAMPAIGN 1 · ENDLESS LEVELS</div>`;
    const done = ch.missions.every(m => progress.completed[m.id]);
    const nDone = ch.missions.filter(m => progress.completed[m.id]).length;
    html += `<div class="dugout ${unlocked ? 'open' : 'locked'} ${done ? 'cleared' : ''}">
      <div class="dugout-mark">${ch.level >= 2 ? 'L' + ch.level : String(i + 1).padStart(2, '0')}</div>
      <div class="dugout-body">
        <h3 class="dotmatrix">${esc(ch.name.toUpperCase())}</h3>
        <p>${esc(ch.brief)}</p>
        <div class="mission-list">`;
    ch.missions.forEach(m => {
      const ok = !!progress.completed[m.id];
      html += `<div class="mission ${ok ? 'done' : ''} ${m.boss ? 'boss' : ''}">
        <span class="tick">${ok ? '■' : '□'}</span>
        <span class="mtitle">${m.boss ? 'RAID · ' : ''}${esc(m.title)}</span>
        <span class="mdesc">${esc(m.desc)}${m.scope === 'level' && !ok ? ` (${statFor(m)}/${m.target})` : ''}</span>
      </div>`;
    });
    html += `</div>
        <div class="dugout-foot">${nDone}/${ch.missions.length} · REWARD <b>${esc(ch.rewards.title)}</b> + ${esc(ch.rewards.gear.name)}</div>
      </div>
    </div>`;
    if (i < chapters.length - 1 && chapters[i + 1].level !== 2) html += `<div class="trench-link ${unlocked ? 'open' : ''}"></div>`;
  });
  html += `</div>`;
  return html;
}

window.Campaign = {
  CHAPTERS,
  note,
  applyServer,
  tryComplete,
  renderMap,
  setLevelsEnabled,
  allChapters,
  getProgress: () => progress,
  session
};
})();
