// Skill tree panel (SKILLS). Rules live in js/skills.js (shared with the server); the server
// checks every point spent.
(function(){
"use strict";
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REASON = { no_points: 'No skill points left', maxed: 'Already maxed', unknown_skill: 'Unknown skill', offline: 'Server unreachable', cooldown: 'Respec is once per 24h', no_profile: 'No profile' };
function reasonText(r) {
  if (!r) return 'Could not learn';
  if (REASON[r]) return REASON[r];
  if (r.startsWith('requires_')) { const d = BTSkills.getSkill(r.slice(9)); return 'Needs ' + (d ? d.name : r.slice(9)) + ' first'; }
  if (r.startsWith('level_')) return 'Needs character level ' + r.slice(6);
  return r.replace(/_/g, ' ');
}
let msg = '';

function render() {
  const S = window.BTSkills, p = RPG.getProfile();
  if (!S || !p) return '<p class="note">Skills loading…</p>';
  const skills = S.normalizeSkills(p.skills);
  const ctx = { level: p.level || 1, maxLevel: p.max_level || 1 };
  const total = S.skillPoints(ctx.level, ctx.maxLevel), free = total - S.spentPoints(skills);
  const tiers = [['digging', 'combat', 'scouting'], ['engineering', 'medic']];
  let h = `<div class="sk-head"><div><b class="dotmatrix">${free}</b> POINT${free === 1 ? '' : 'S'} FREE</div>
    <div class="sk-sub">${total} earned · 2 per character level${ctx.maxLevel > 1 ? ' · +1 per world level (deepest L' + ctx.maxLevel + ')' : ''}</div></div>`;
  h += '<div class="sk-tree">';
  tiers.forEach((row, ti) => {
    h += `<div class="sk-tier sk-tier-${ti}">`;
    for (const id of row) {
      const d = S.getSkill(id), r = skills[id], chk = S.canLearn(skills, id, ctx);
      const req = d.req ? Object.entries(d.req).map(([k, n]) => S.getSkill(k).name + ' ' + n).join(' + ') : '';
      const pips = Array.from({ length: S.SKILL_MAX_RANK }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('');
      h += `<div class="sk-node ${r ? 'has' : ''} ${chk.ok ? 'can' : ''}" data-sk="${id}">
        <div class="sk-ic">${esc(d.icon)}</div>
        <div class="sk-name">${esc(d.name.toUpperCase())}</div>
        <div class="sk-pips">${pips}</div>
        <div class="sk-desc">${esc(d.desc)}</div>
        <div class="sk-now">${r ? 'NOW: ' + esc(d.ranks[r - 1]) : 'NOT LEARNED'}</div>
        ${r < S.SKILL_MAX_RANK ? `<div class="sk-next">NEXT: ${esc(d.ranks[r])}</div>` : ''}
        ${req ? `<div class="sk-req ${chk.reason && chk.reason.startsWith('requires_') ? 'bad' : ''}">REQUIRES ${esc(req.toUpperCase())}</div>` : ''}
        <button type="button" class="sk-learn" data-learn="${id}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.ok ? 'Learn rank ' + chk.rank : reasonText(chk.reason))}">${chk.ok ? 'LEARN +1' : r >= S.SKILL_MAX_RANK ? 'MAX' : esc(reasonText(chk.reason).toUpperCase())}</button>
      </div>`;
    }
    h += '</div>';
  });
  h += '</div>';
  h += `<p class="sk-msg" id="skMsg">${esc(msg)}</p>`;
  h += `<div class="sk-foot"><button type="button" class="ghost" data-skreset>RESET SKILLS</button><span class="sk-sub">Free respec once per 24h. Skills save to your account${RPG.isLoggedIn() ? '' : ' (guest: this browser)'}.</span></div>`;
  return h;
}

async function onClick(e, rerender) {
  const l = e.target.closest('[data-learn]');
  if (l && !l.disabled) {
    l.disabled = true;
    const res = await RPG.skillAction('learn', l.dataset.learn);
    msg = res && res.ok ? (BTSkills.getSkill(l.dataset.learn).name + ' rank ' + res.skills[l.dataset.learn]) : reasonText(res && (res.reason || res.error));
    if (res && res.ok && typeof Sfx !== 'undefined') Sfx.play('power');
    rerender();
    return true;
  }
  if (e.target.closest('[data-skreset]')) {
    if (!confirm('Reset all skills and refund the points? You can do this once every 24 hours.')) return true;
    const res = await RPG.skillAction('reset');
    msg = res && res.ok ? 'Skills reset. Points refunded.' : reasonText(res && (res.reason || res.error));
    rerender();
    return true;
  }
  return false;
}

window.BTSkillTree = { render, onClick };
})();
