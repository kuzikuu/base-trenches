// Events calendar page + in-game live banner. Times shown in the viewer's zone.
(function(){
"use strict";

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
let cache = { upcoming: [], live: [], past: [], now: Date.now() };
let timer = null;

function server() {
  return (window.BT_CONFIG && BT_CONFIG.serverUrl) || '';
}

async function load() {
  try {
    const r = await fetch(server().replace(/\/$/, '') + '/events', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    cache = await r.json();
    cache.now = cache.now || Date.now();
  } catch (e) {
    cache = { upcoming: [], live: [], past: [], now: Date.now(), error: true };
  }
  return cache;
}

function localRange(ev) {
  const a = new Date(ev.start_at);
  const b = new Date(ev.end_at);
  const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${a.toLocaleString(undefined, opts)} – ${b.toLocaleString(undefined, opts)} (${zone})`;
}

function countdown(ev, now) {
  const t = now < ev.start_at ? ev.start_at - now : Math.max(0, ev.end_at - now);
  const s = Math.floor(t / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  const label = now < ev.start_at ? 'STARTS' : 'ENDS';
  return `${label} ${h}:${pad(m)}:${pad(sec)}`;
}

function typeLabel(t) {
  return String(t || '').replace(/_/g, ' ').toUpperCase();
}

function icsHref(id) {
  const base = server().replace(/\/$/, '');
  return id ? `${base}/events/${encodeURIComponent(id)}.ics` : `${base}/events.ics`;
}

function card(ev, now) {
  const lb = (ev.leaderboard || []).slice(0, 5).map((r, i) =>
    `<li><b>#${i + 1}</b> ${esc(r.name)} <span>${r.score}</span></li>`).join('');
  return `<article class="event-card ${ev.status || ''}">
    <div class="event-type">${esc(typeLabel(ev.type))}</div>
    <h3 class="dotmatrix">${esc(ev.title)}</h3>
    <div class="event-when">${esc(localRange(ev))}</div>
    <div class="event-count" data-start="${ev.start_at}" data-end="${ev.end_at}">${esc(countdown(ev, now))}</div>
    <p>${esc(ev.description || '')}</p>
    <div class="event-acts">
      <a class="ics" href="${esc(icsHref(ev.id))}" download>DOWNLOAD .ICS</a>
    </div>
    ${lb ? `<ol class="event-lb">${lb}</ol>` : ''}
  </article>`;
}

function render() {
  const now = Date.now();
  const { upcoming = [], live = [], past = [], error } = cache;
  const feed = `<p class="note"><a href="${esc(icsHref())}">Full calendar feed (.ics)</a> · times are in your local zone.</p>`;
  if (error) return feed + '<p class="note">Events API is offline.</p>';
  const section = (title, rows, empty) =>
    `<h3 class="dotmatrix" style="font-size:12px;margin:16px 0 8px">${title}</h3>` +
    (rows.length ? `<div class="event-grid">${rows.map(e => card(e, now)).join('')}</div>` : `<p class="note">${empty}</p>`);
  return feed +
    section('LIVE', live, 'No live event.') +
    section('UPCOMING', upcoming, 'Nothing on the board yet.') +
    section('PAST', past.slice(0, 12), 'No past events.');
}

function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll('.event-count, #eventBanner .event-count').forEach(el => {
    const start = Number(el.dataset.start), end = Number(el.dataset.end);
    if (!start) return;
    el.textContent = countdown({ start_at: start, end_at: end }, now);
  });
}

function liveBannerHtml() {
  const live = (cache.live || [])[0];
  if (!live) return '';
  const now = Date.now();
  const top = (live.leaderboard || []).slice(0, 3).map((r, i) =>
    `#${i + 1} ${esc(r.name)} ${r.score}`).join(' · ');
  return `<div id="eventBannerInner">
    <span class="event-type">LIVE ${esc(typeLabel(live.type))}</span>
    <b>${esc(live.title)}</b>
    <span class="event-count" data-start="${live.start_at}" data-end="${live.end_at}">${esc(countdown(live, now))}</span>
    ${top ? `<span class="event-lb-inline">${top}</span>` : ''}
  </div>`;
}

function paintBanner() {
  const el = document.getElementById('eventBanner');
  if (!el) return;
  const html = liveBannerHtml();
  if (!html) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = html;
}

async function refresh() {
  await load();
  const body = document.getElementById('panelBody');
  const title = document.getElementById('panelTitle');
  if (body && title && title.textContent === 'EVENTS') body.innerHTML = render();
  paintBanner();
}

function start() {
  refresh();
  if (timer) clearInterval(timer);
  timer = setInterval(() => { tickCountdowns(); }, 1000);
  setInterval(refresh, 30000);
}

window.BTEvents = { load, render, refresh, start, getCache: () => cache, icsHref, paintBanner };
})();
