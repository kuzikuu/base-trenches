// Save game: SAVE button, login-to-save, autosave, continue where you left off.
// The server validates every save (server/lib/save.js); this file only collects the snapshot.
(function(){
"use strict";
const AUTOSAVE_MS = 60000;
let cfg = { levelsUnlocked: false, levelDepth: 589 };
let saved = null;          // last save the server holds for this account
let pendingAfterLogin = false;
let lastKey = '';
let lastSaveAt = 0;
let busy = false;
const listeners = [];

const api = (p) => BT_CONFIG.serverUrl + p;
const emit = (ev, data) => listeners.forEach(fn => { try { fn(ev, data); } catch (e) {} });
const keyOf = s => s ? [s.runId, s.x, s.y, s.lives, s.gems, s.powerGems, Math.floor(s.runTime / 30)].join('|') : '';

async function loadConfig() {
  try {
    const r = await fetch(api('/api/config'));
    if (r.ok) cfg = { ...cfg, ...(await r.json()) };
  } catch (e) {}
  // A preview build can force the switch for local testing; prod never sets it.
  if (window.BT_LEVELS_UNLOCKED === true) cfg.levelsUnlocked = true;
  if (typeof Game !== 'undefined') Game.setLevelsEnabled(!!cfg.levelsUnlocked);
  if (typeof Campaign !== 'undefined' && Campaign.setLevelsEnabled) Campaign.setLevelsEnabled(!!cfg.levelsUnlocked);
  return cfg;
}

async function fetchSave() {
  saved = null;
  if (!RPG.isLoggedIn()) { emit('save', null); return null; }
  const token = await RPG.getAuthToken();
  if (!token) { emit('save', null); return null; }
  try {
    const r = await fetch(api('/api/save'), { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json().catch(() => null);
    saved = j && j.save ? j.save : null;
  } catch (e) {}
  emit('save', saved);
  return saved;
}

function applyResult(res, quiet) {
  busy = false;
  if (!res) { if (!quiet) emit('error', 'offline'); return; }
  if (res.ok) {
    saved = res.save || null;
    lastSaveAt = Date.now();
    emit('saved', { save: saved, clamped: res.clamped || [], died: !!res.died, quiet });
  } else if (!quiet) emit('error', res.error || 'failed');
}

async function postHttp(snapshot, opts = {}) {
  const token = await RPG.getAuthToken();
  if (!token) return { ok: false, error: 'login_required' };
  try {
    const r = await fetch(api('/api/save'), {
      method: 'POST',
      keepalive: !!opts.keepalive,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ snapshot })
    });
    return await r.json().catch(() => null);
  } catch (e) { return null; }
}

// Manual SAVE. Guests are sent to login; the save finishes on its own after they sign in.
async function saveNow(opts = {}) {
  const snap = typeof Game !== 'undefined' ? Game.snapshot() : null;
  if (!snap) { emit('error', 'no_run'); return; }
  if (!RPG.isLoggedIn()) {
    pendingAfterLogin = true;
    emit('login', null);
    if (typeof BTPrivy !== 'undefined' && BTPrivy.enabled()) BTPrivy.show();
    return;
  }
  if (busy && !opts.force) return;
  busy = true;
  lastKey = keyOf(snap);
  // Socket first: the room adds the position it last saw, and it costs no extra Worker request.
  lastSent = snap; lastQuiet = !!opts.quiet;
  if (!opts.http && typeof Multiplayer !== 'undefined' && Multiplayer.connected && Multiplayer.sendSave(snap)) {
    setTimeout(() => { if (busy) { busy = false; postHttp(snap).then(r => applyResult(r, opts.quiet)); } }, 4000);
    return;
  }
  applyResult(await postHttp(snap), opts.quiet);
}

let lastSent = null, lastQuiet = false;
function onSocketSaved(res) {
  if (res && res.error === 'too_soon') {
    // the room limits socket saves to one per 15 s; a manual save goes over HTTP instead
    if (!lastQuiet && lastSent) { postHttp(lastSent).then(r => applyResult(r, false)); } else busy = false;
    return;
  }
  applyResult(res, lastQuiet);
}

// Called by main.js when Privy reports a login.
function afterLogin() {
  fetchSave().then(() => {
    if (pendingAfterLogin && typeof Game !== 'undefined' && Game.mode === 'play') {
      pendingAfterLogin = false;
      setTimeout(() => saveNow({ http: true }), 800);
    }
  });
}

function autosaveTick() {
  if (!RPG.isLoggedIn() || typeof Game === 'undefined' || Game.mode !== 'play') return;
  const snap = Game.snapshot();
  if (!snap || keyOf(snap) === lastKey || Date.now() - lastSaveAt < AUTOSAVE_MS - 1000) return;
  saveNow({ quiet: true });
}

// Page hidden / closed: one keepalive POST with the cached token (no await possible on unload).
function saveOnExit() {
  if (!RPG.isLoggedIn() || typeof Game === 'undefined' || Game.mode !== 'play') return;
  const snap = Game.snapshot();
  const token = RPG.getCachedToken();
  if (!snap || !token || keyOf(snap) === lastKey) return;
  lastKey = keyOf(snap);
  try {
    fetch(api('/api/save'), { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ snapshot: snap }) });
  } catch (e) {}
}

// Run ended: level 1 clears the save, level 2+ keeps a checkpoint at the top of that level.
async function onDeath() {
  if (!RPG.isLoggedIn() || typeof Game === 'undefined') return;
  const snap = Game.snapshot(true);
  if (!snap) return;
  snap.dead = true;
  let res = null;
  lastSent = snap; lastQuiet = true;
  if (typeof Multiplayer !== 'undefined' && Multiplayer.connected && Multiplayer.sendSave(snap)) return; // reply lands in onSocketSaved
  res = await postHttp(snap);
  applyResult(res, true);
}

function continueRun() {
  if (!saved || typeof Game === 'undefined') return false;
  const s = saved;
  if (typeof Multiplayer !== 'undefined' && s.sector && s.sector !== Multiplayer.room) {
    Multiplayer.setRoom(s.sector);
    Multiplayer.disconnect();
    const p = RPG.getProfile(); if (p) Multiplayer.connect(p);
  }
  Game.startFrom(s);
  lastKey = keyOf(Game.snapshot());
  lastSaveAt = Date.now();
  return true;
}

function describe(s) {
  if (!s) return '';
  const t = Math.floor(s.runTime || 0), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
  return (cfg.levelsUnlocked ? 'LV ' + (s.level || 1) + ' · ' : '') + (s.depth || 0) + 'M · ' + mm + ':' + ss + (s.checkpoint ? ' · CHECKPOINT' : '');
}

function init() {
  if (typeof Multiplayer !== 'undefined' && Multiplayer.onSaved) Multiplayer.onSaved(onSocketSaved);
  setInterval(autosaveTick, 15000);
  addEventListener('pagehide', saveOnExit);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveOnExit(); });
}

window.BTSave = {
  init, loadConfig, fetchSave, saveNow, afterLogin, onDeath, continueRun, describe,
  on: fn => listeners.push(fn),
  get save() { return saved; },
  get config() { return cfg; },
  get pending() { return pendingAfterLogin; }
};
})();
