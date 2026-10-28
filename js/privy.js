// Privy login modal. Hidden when BT_PRIVY_APP_ID is empty (guest / Farcaster unchanged).
(function(){
"use strict";

// Self-hosted, esbuild-bundled @privy-io/js-sdk-core@0.79.1 (one file, one viem version; built by
// tools/build-privy.mjs). The CDN builds are fallbacks only. The SDK is loaded lazily: on a Sign in
// tap, or on idle when this browser already has a Privy session / OAuth callback / Telegram launch.
const SDK_LOCAL = (window.BT_CONFIG && BT_CONFIG.privySdk) || 'js/vendor/privy-sdk-0.79.1.1fa2d3cd12.js';
const CDN = [
  SDK_LOCAL,
  'https://esm.sh/@privy-io/js-sdk-core@0.79.1',
  'https://cdn.jsdelivr.net/npm/@privy-io/js-sdk-core@0.79.1/+esm'
];

let client = null;
let user = null;
let ready = false;
const listeners = [];

function appId() {
  return (window.BT_CONFIG && BT_CONFIG.privyAppId) || window.BT_PRIVY_APP_ID || '';
}
function enabled() { return !!appId(); }

// event: 'restore' (saved session found on load), 'login' (just signed in), 'link', 'logout'
function emit(event) { const snap = snapshot(); snap.event = event || 'restore'; listeners.forEach(fn => { try { fn(snap); } catch (e) {} }); }

function snapshot() {
  return {
    enabled: enabled(),
    ready,
    user,
    did: user && (user.id || user.did),
    xHandle: extractHandle(user),
    tgHandle: extractTelegram(user),
    wallet: extractWallet(user),
    accounts: describeAccounts(user),
    method: primaryMethod(user),
    displayName: displayName(user),
    avatar: avatar(user)
  };
}

function extractHandle(u) {
  if (!u) return null;
  const accounts = u.linked_accounts || u.linkedAccounts || [];
  const tw = accounts.find(a => /twitter|x/i.test(a.type || a.provider || '') && (a.username || a.handle));
  if (tw) return '@' + String(tw.username || tw.handle).replace(/^@/, '');
  if (u.twitter || u.x) return '@' + String((u.twitter || u.x).username || '').replace(/^@/, '');
  return null;
}

function extractTelegram(u) {
  if (!u) return null;
  const accounts = u.linked_accounts || u.linkedAccounts || [];
  const tg = accounts.find(a => a.type === 'telegram');
  if (!tg) return null;
  return tg.username ? '@' + String(tg.username).replace(/^@/, '') : (tg.first_name || tg.firstName || null);
}

const METHOD_LABEL = { telegram: 'Telegram', twitter_oauth: 'X', farcaster: 'Farcaster', email: 'Email', wallet: 'Wallet' };
const METHOD_ICON = { telegram: 'TG', twitter_oauth: 'X', farcaster: 'FC', email: '@', wallet: '◆' };

function accountsOf(u) { return (u && (u.linked_accounts || u.linkedAccounts)) || []; }

// Linked accounts in a display-friendly shape (no ids beyond what the user already sees).
function describeAccounts(u) {
  return accountsOf(u).filter(a => METHOD_LABEL[a.type]).map(a => {
    let label = '';
    if (a.type === 'telegram') label = a.username ? '@' + a.username : (a.first_name || 'Telegram');
    else if (a.type === 'twitter_oauth') label = a.username ? '@' + a.username : (a.name || 'X');
    else if (a.type === 'farcaster') label = a.username ? '@' + a.username : ('fid ' + a.fid);
    else if (a.type === 'email') label = a.address || 'Email';
    else if (a.type === 'wallet') label = shortAddr(a.address) + (/privy/i.test(a.wallet_client_type || '') ? ' (embedded)' : '');
    return { type: a.type, method: METHOD_LABEL[a.type], icon: METHOD_ICON[a.type], label };
  });
}

// The method used for the current session: remembered at login, else the most recently verified account.
function primaryMethod(u) {
  if (!u) return null;
  let m = null;
  try { m = localStorage.getItem('bt_login_method'); } catch (e) {}
  const acc = accountsOf(u).filter(a => METHOD_LABEL[a.type]);
  if (m && acc.some(a => a.type === m)) return m;
  acc.sort((a, b) => (b.latest_verified_at || b.verified_at || 0) - (a.latest_verified_at || a.verified_at || 0));
  return acc[0] ? acc[0].type : null;
}

function displayName(u) {
  if (!u) return null;
  const acc = accountsOf(u);
  const pick = t => acc.find(a => a.type === t);
  const order = [primaryMethod(u), 'telegram', 'twitter_oauth', 'farcaster', 'email', 'wallet'];
  for (const t of order) {
    const a = t && pick(t);
    if (!a) continue;
    if (a.username) return '@' + String(a.username).replace(/^@/, '');
    if (a.type === 'telegram' && a.first_name) return a.first_name;
    if (a.type === 'twitter_oauth' && a.name) return a.name;
    if (a.type === 'farcaster' && a.display_name) return a.display_name;
    if (a.type === 'email' && a.address) return a.address.split('@')[0];
    if (a.type === 'wallet' && a.address) return shortAddr(a.address);
  }
  return 'Trencher';
}

function avatar(u) {
  const acc = accountsOf(u);
  for (const a of acc) {
    const url = a.photo_url || a.profile_picture_url || a.profile_picture;
    if (url && /^https:\/\//.test(url)) return url;
  }
  return null;
}

function rememberMethod(m) { try { if (m) localStorage.setItem('bt_login_method', m); else localStorage.removeItem('bt_login_method'); } catch (e) {} }

function extractWallet(u) {
  if (!u) return null;
  const accounts = u.linked_accounts || u.linkedAccounts || [];
  const w = accounts.find(a => (a.type === 'wallet' || a.chain_type === 'ethereum' || a.chainType === 'ethereum') && a.address);
  if (w) return w.address;
  if (u.wallet && u.wallet.address) return u.wallet.address;
  const embedded = accounts.find(a => /embedded/i.test(a.wallet_client || a.walletClientType || '') && a.address);
  return embedded ? embedded.address : null;
}

function shortAddr(a) {
  if (!a) return '';
  return a.slice(0, 6) + '…' + a.slice(-4);
}

let sdkLoad = null;
function loadSdk() {
  if (sdkLoad) return sdkLoad;
  sdkLoad = (async () => {
    let last;
    for (const url of CDN) {
      try {
        return await import(/* @vite-ignore */ new URL(url, document.baseURI).href);
      } catch (e) { last = e; }
    }
    sdkLoad = null;
    throw last || new Error('Privy SDK failed to load');
  })();
  return sdkLoad;
}

// Does this browser need Privy at page load? Only when a session may already exist (Privy keeps
// its tokens in localStorage under privy:*), an OAuth redirect is being finished, or the page was
// launched inside Telegram (seamless login). Guests on a plain visit never download the SDK.
function hasSavedSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (/^privy:(.+:)?(refresh_token|token)$/.test(k) || k === 'privy:active-user') return true;
    }
  } catch (e) {}
  return false;
}
function shouldInitEarly() {
  if (!enabled()) return false;
  if (/[?&]privy_oauth_code=/.test(location.search)) return true;
  if (typeof BTTelegram !== 'undefined' && BTTelegram.launched) return true;
  return hasSavedSession();
}
// Init once the main thread is idle (bounded), so the SDK never competes with first paint.
function initWhenIdle(timeout) {
  return new Promise(resolve => {
    const go = () => init().then(resolve, () => resolve(null));
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: timeout || 1500 });
    else setTimeout(go, 200);
  });
}

let initing = null;
function init() {
  if (!enabled()) return Promise.resolve(null);
  if (client && ready) return Promise.resolve(client);
  if (!initing) initing = doInit().catch(e => { initing = null; client = null; throw e; });
  return initing;
}

async function doInit() {
  const mod = await loadSdk();
  const Privy = mod.default || mod.Privy;
  const LocalStorage = mod.LocalStorage || (mod.default && mod.default.LocalStorage);
  const opts = { appId: appId(), storage: LocalStorage ? new LocalStorage() : undefined };
  if (window.BT_CONFIG && BT_CONFIG.privyClientId) opts.clientId = BT_CONFIG.privyClientId;
  client = new Privy(opts);
  if (client.initialize) await client.initialize();
  try {
    const got = client.user && client.user.get ? await client.user.get() : null;
    user = (got && got.user) || got || null;
  } catch (e) { user = null; }
  if (!user) await telegramSeamless();
  if (/[?&]privy_oauth_code=/.test(location.search)) {
    ready = true;
    finishingOauth = finishOauth().catch(() => false);
    await finishingOauth;
    if (user) { justLoggedIn = false; return client; }   // afterLogin / link already emitted
  }
  if (user) await ensureWallet();
  ready = true;
  emit(justLoggedIn ? 'login' : 'restore');
  justLoggedIn = false;
  return client;
}

// Inside the Telegram Mini App, log in silently with the signed initData (Privy
// "Enable login directly from Telegram app"). Any failure leaves the user as a guest.
let seamlessTried = false;
let justLoggedIn = false;
let finishingOauth = null;
async function telegramSeamless() {
  if (seamlessTried || typeof BTTelegram === 'undefined') return;
  try { if (sessionStorage.getItem('bt_no_seamless') === '1') return; } catch (e) {}
  seamlessTried = true;
  try {
    const inTg = await Promise.race([BTTelegram.ready, new Promise(r => setTimeout(() => r(false), 4000))]);
    if (!inTg || !BTTelegram.isMiniApp()) return;
    const m = await loadMethods();
    if (m && (!m.telegram || !m.telegramSeamless)) return;
    const data = BTTelegram.webAppData();
    if (!data || !client.auth || !client.auth.telegram) return;
    const session = await client.auth.telegram.authenticate({ telegramWebAppData: data });
    user = (session && session.user) || null;
    if (user) { rememberMethod('telegram'); justLoggedIn = true; }
  } catch (e) {
    console.warn('[Privy] Telegram seamless login skipped:', e && e.message);
  }
}

async function ensureWallet() {
  if (!client || !user) return;
  if (extractWallet(user)) return;
  try {
    if (client.embeddedWallet && client.embeddedWallet.create) {
      const created = await client.embeddedWallet.create({});
      user = (created && created.user) || user;
    }
  } catch (e) {
    console.warn('[Privy] embedded wallet create skipped:', e);
  }
}

async function getAccessToken() {
  if (!client) return null;
  try {
    if (client.getAccessToken) return await client.getAccessToken();
    if (user && user.getAccessToken) return await user.getAccessToken();
  } catch (e) {
    console.warn('[Privy] getAccessToken', e);
  }
  return null;
}

function ensureModal() {
  let el = document.getElementById('loginModal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'loginModal';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="panel login-panel" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
      <div class="panelhead">
        <span class="squares"><i></i><i></i><i></i></span>
        <h2 id="loginTitle" class="dotmatrix">SIGN IN</h2>
        <button type="button" class="iconbtn" id="loginClose" aria-label="Close">✕ ESC</button>
      </div>
      <div class="panelbody" id="loginBody"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target.id === 'loginModal') hide(); });
  el.querySelector('#loginClose').onclick = hide;
  return el;
}

function renderBody(html) {
  ensureModal().querySelector('#loginBody').innerHTML = html;
}

function showError(msg) {
  const box = document.getElementById('loginErr');
  if (box) box.textContent = msg;
}

// Which login methods the Privy dashboard actually has switched on (public app config).
// Buttons for disabled methods are hidden instead of failing with "not allowed".
let methods = null;
async function loadMethods() {
  if (methods || !enabled()) return methods;
  try {
    const r = await fetch('https://auth.privy.io/api/v1/apps/' + encodeURIComponent(appId()), { headers: { 'privy-app-id': appId() } });
    const c = await r.json();
    const tg = c.telegram_auth_config || {};
    methods = {
      telegram: !!c.telegram_auth, telegramSeamless: !!(c.telegram_seamless_auth_enabled || tg.seamless_auth_enabled),
      telegramBotId: tg.bot_id || null, telegramBotName: tg.bot_name || null,
      twitter: !!c.twitter_oauth, wallet: !!c.wallet_auth, farcaster: !!c.farcaster_auth, email: !!c.email_auth
    };
  } catch (e) { methods = null; }
  return methods;
}

function homeView() {
  const t = ensureModal().querySelector('#loginTitle'); if (t) t.textContent = 'SIGN IN';
  renderBody(`
    <p class="note">Sign in to keep your XP, gear and squad across devices. Non-custodial — keys stay with Privy / you.</p>
    <div class="login-methods">
      <button type="button" data-privy="telegram">TELEGRAM</button>
      <button type="button" data-privy="twitter">X / TWITTER</button>
      <button type="button" data-privy="wallet">WALLET</button>
      <button type="button" data-privy="farcaster">FARCASTER</button>
      <button type="button" data-privy="email">EMAIL</button>
    </div>
    <p class="login-err" id="loginErr"></p>
    ${user ? `<button type="button" class="ghost" data-privy="logout">SIGN OUT</button>` : ''}`);
  ensureModal().querySelectorAll('[data-privy]').forEach(btn => {
    btn.onclick = () => startMethod(btn.dataset.privy);
  });
  loadMethods().then(m => {
    if (!m) return;
    ensureModal().querySelectorAll('.login-methods [data-privy]').forEach(btn => {
      if (m[btn.dataset.privy] === false) btn.classList.add('hidden');
    });
    const tgBtn = ensureModal().querySelector('[data-privy="telegram"]');
    if (tgBtn && typeof BTTelegram !== 'undefined' && BTTelegram.isMiniApp()) tgBtn.classList.add('tg-primary');
  });
}

function emailView() {
  renderBody(`
    <p class="note">We'll send a one-time code.</p>
    <form id="emailForm" class="login-form">
      <input type="email" id="emailAddr" placeholder="you@trench.base" required autocomplete="email">
      <button type="submit">SEND CODE</button>
    </form>
    <form id="codeForm" class="login-form hidden">
      <input type="text" id="emailCode" placeholder="123456" inputmode="numeric" autocomplete="one-time-code">
      <button type="submit">VERIFY</button>
    </form>
    <p class="login-err" id="loginErr"></p>
    <button type="button" class="ghost" id="loginBack">← BACK</button>`);
  document.getElementById('loginBack').onclick = homeView;
  let addr = '';
  document.getElementById('emailForm').onsubmit = async e => {
    e.preventDefault();
    addr = document.getElementById('emailAddr').value.trim();
    try {
      await client.auth.email.sendCode(addr);
      document.getElementById('codeForm').classList.remove('hidden');
    } catch (err) { showError(err.message || 'Could not send code'); }
  };
  document.getElementById('codeForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const session = await client.auth.email.loginWithCode(addr, document.getElementById('emailCode').value.trim());
      await afterLogin(session, 'email');
    } catch (err) { showError(err.message || 'Bad code'); }
  };
}

async function telegramLogin() {
  if (!client.auth || !client.auth.telegram) { showError('Telegram login is not available in this SDK build.'); return; }
  const m = await loadMethods();
  try {
    let session;
    if (typeof BTTelegram !== 'undefined' && BTTelegram.isMiniApp() && BTTelegram.webAppData()) {
      session = await client.auth.telegram.authenticate({ telegramWebAppData: BTTelegram.webAppData() });
    } else {
      const botId = (m && m.telegramBotId) || (window.BT_CONFIG && BT_CONFIG.telegramBotId);
      if (!botId || typeof BTTelegram === 'undefined') { showError('Telegram login is not configured.'); return; }
      showError('Confirm in the Telegram popup…');
      const result = await BTTelegram.loginPopup(botId);
      if (!result) { showError('Telegram login cancelled.'); return; }
      session = await client.auth.telegram.authenticate({ telegramAuthResult: result });
    }
    await afterLogin(session, 'telegram');
  } catch (e) {
    showError((e && e.message) || 'Telegram login failed');
  }
}

async function farcasterLogin() {
  if (!client.auth || !client.auth.farcaster) { showError('Farcaster login is not available.'); return; }
  try {
    const init = await client.auth.farcaster.initializeAuth({ relyingParty: location.origin });
    const token = init.channel_token, uri = init.connect_uri;
    renderBody(`
      <div class="login-fc">
        <p class="note">Approve the sign-in in Warpcast / Farcaster.</p>
        <a href="${uri}" target="_blank" rel="noopener" class="bigbtn" id="fcOpen">OPEN FARCASTER</a>
        <p class="login-err" id="loginErr">Waiting for approval…</p>
        <button type="button" class="ghost" id="loginBack">← BACK</button>
      </div>`);
    let stop = false;
    document.getElementById('loginBack').onclick = () => { stop = true; homeView(); };
    if (typeof BTTelegram !== 'undefined' && BTTelegram.isMiniApp()) {
      document.getElementById('fcOpen').onclick = e => { if (BTTelegram.openLink(uri)) e.preventDefault(); };
    }
    const started = Date.now();
    while (!stop && Date.now() - started < 5 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 2000));
      if (stop) return;
      const st = await client.auth.farcaster.getFarcasterStatus({ channel_token: token }).catch(() => null);
      if (st && st.state === 'completed') {
        const session = await client.auth.farcaster.authenticate({ channel_token: token, message: st.message, signature: st.signature, fid: st.fid });
        await afterLogin(session, 'farcaster');
        return;
      }
    }
    if (!stop) showError('Farcaster sign-in timed out.');
  } catch (e) {
    showError((e && e.message) || 'Farcaster login failed');
  }
}

async function oauth(provider, mode) {
  if (!client || !client.auth || !client.auth.oauth) {
    showError('OAuth is not available in this SDK build.');
    return;
  }
  const redirectURI = location.origin + location.pathname;
  try {
    const res = await client.auth.oauth.generateURL(provider, redirectURI);
    const url = typeof res === 'string' ? res : res && res.url;
    if (!url) throw new Error('No OAuth URL from Privy');
    try { sessionStorage.setItem('bt_privy_oauth_provider', provider); sessionStorage.setItem('bt_privy_oauth_mode', mode || 'login'); } catch (e) {}
    location.assign(url);
  } catch (e) {
    showError(e.message || 'OAuth failed');
  }
}

async function finishOauth() {
  const q = new URLSearchParams(location.search);
  const code = q.get('privy_oauth_code');
  const state = q.get('privy_oauth_state');
  if (!code || !client) return false;
  try {
    let provider = q.get('privy_oauth_provider'), mode = 'login';
    try {
      provider = provider || sessionStorage.getItem('bt_privy_oauth_provider');
      mode = sessionStorage.getItem('bt_privy_oauth_mode') || 'login';
      sessionStorage.removeItem('bt_privy_oauth_provider'); sessionStorage.removeItem('bt_privy_oauth_mode');
    } catch (e) {}
    history.replaceState(null, '', location.pathname + location.hash);
    if (mode === 'link' && user) {
      const res = await client.auth.oauth.linkWithCode(code, state, provider || undefined);
      user = (res && res.user) || user;
      emit('link');
      return true;
    }
    const session = await client.auth.oauth.loginWithCode(code, state, provider || undefined);
    await afterLogin(session, provider === 'twitter' ? 'twitter_oauth' : provider);
    return true;
  } catch (e) {
    console.warn('[Privy] oauth callback', e);
    return false;
  }
}

async function walletLogin() {
  const eth = window.ethereum;
  if (!eth) { showError('No injected wallet. Try email or X.'); return; }
  try {
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    const address = accounts[0];
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }).catch(() => {});
    const wallet = { address, chainId: 'eip155:8453' };
    const { message } = await client.auth.siwe.init(wallet, location.host, location.origin);
    const signature = await eth.request({ method: 'personal_sign', params: [message, address] });
    const session = await client.auth.siwe.loginWithSiwe(signature, wallet, message, 'login-or-sign-up');
    await afterLogin(session, 'wallet');
  } catch (e) {
    showError(e.message || 'Wallet login failed');
  }
}

async function afterLogin(session, method) {
  user = (session && session.user) || session || user;
  rememberMethod(method);
  try { sessionStorage.removeItem('bt_no_seamless'); } catch (e) {}
  await ensureWallet();
  ready = true;
  emit('login');
  hide();
}

async function afterLink(res) {
  user = (res && res.user) || user;
  emit('link');
  accountView();
}

async function startMethod(method) {
  try { await init(); } catch (e) { showError('Could not load Privy. Check the app id.'); return; }
  if (method === 'email') return emailView();
  if (method === 'twitter') return oauth('twitter');
  if (method === 'farcaster') return farcasterLogin();
  if (method === 'telegram') return telegramLogin();
  if (method === 'wallet') return walletLogin();
  if (method === 'logout') return logout();
}

async function logout() {
  try {
    if (client && client.auth && client.auth.logout && user) {
      await client.auth.logout({ userId: user.id });
    }
  } catch (e) {}
  user = null;
  rememberMethod(null);
  try { sessionStorage.setItem('bt_no_seamless', '1'); } catch (e) {}
  emit('logout');
  hide();
}

function show() {
  if (!enabled()) return;
  ensureModal().classList.remove('hidden');
  if (user) accountView(); else homeView();
  init().then(() => { if (user && !document.getElementById('acctView')) accountView(); })
    .catch(e => showError(e.message || 'Privy failed'));
}

function escText(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Signed-in view: who you are, what is linked, link X / Telegram, log out.
function accountView() {
  const snap = snapshot();
  if (!snap.did) return homeView();
  const accs = snap.accounts;
  const has = t => accs.some(a => a.type === t);
  const av = snap.avatar ? `<img src="${escText(snap.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span>${escText((snap.displayName || 'T').replace(/^@/, '').slice(0, 1).toUpperCase())}</span>`;
  renderBody(`
    <div class="acct-view" id="acctView">
      <div class="acct-head">
        <div class="acct-avatar">${av}</div>
        <div>
          <div class="acct-name">${escText(snap.displayName)}</div>
          <div class="acct-sub">Signed in with ${escText(METHOD_LABEL[snap.method] || 'Privy')}${snap.wallet ? ' · ' + escText(shortAddr(snap.wallet)) : ''}</div>
        </div>
      </div>
      <h3 class="dotmatrix acct-h">LINKED ACCOUNTS</h3>
      <ul class="acct-list">${accs.map(a => `<li><b class="acct-ic">${escText(a.icon)}</b><span>${escText(a.method)}</span><em>${escText(a.label)}</em></li>`).join('') || '<li>None</li>'}</ul>
      <div class="login-methods acct-actions">
        <button type="button" data-acct="link-telegram" class="${has('telegram') ? 'hidden' : ''}">LINK TELEGRAM</button>
        <button type="button" data-acct="link-twitter" class="${has('twitter_oauth') ? 'hidden' : ''}">LINK X</button>
        <button type="button" class="ghost" data-acct="logout">LOG OUT</button>
      </div>
      <p class="login-err" id="loginErr"></p>
    </div>`);
  const root = ensureModal();
  root.querySelector('#loginTitle').textContent = 'ACCOUNT';
  root.querySelectorAll('[data-acct]').forEach(btn => {
    btn.onclick = () => {
      const a = btn.dataset.acct;
      if (a === 'logout') return logout();
      if (a === 'link-telegram') return linkTelegram();
      if (a === 'link-twitter') return oauth('twitter', 'link');
    };
  });
  loadMethods().then(m => {
    if (!m) return;
    if (!m.telegram) root.querySelector('[data-acct="link-telegram"]').classList.add('hidden');
    if (!m.twitter) root.querySelector('[data-acct="link-twitter"]').classList.add('hidden');
  });
}

async function linkTelegram() {
  try {
    await init();
    let res;
    if (typeof BTTelegram !== 'undefined' && BTTelegram.isMiniApp() && BTTelegram.webAppData()) {
      res = await client.auth.telegram.link({ telegramWebAppData: BTTelegram.webAppData() });
    } else {
      const m = await loadMethods();
      const botId = (m && m.telegramBotId) || (window.BT_CONFIG && BT_CONFIG.telegramBotId);
      showError('Confirm in the Telegram popup…');
      const result = await BTTelegram.loginPopup(botId);
      if (!result) { showError('Telegram link cancelled.'); return; }
      res = await client.auth.telegram.link({ telegramAuthResult: result });
    }
    await afterLink(res);
  } catch (e) {
    showError((e && e.message) || 'Could not link Telegram');
  }
}

function hide() {
  const el = document.getElementById('loginModal');
  if (el) el.classList.add('hidden');
}

function onChange(fn) { listeners.push(fn); }

// Screenshot/test hook only: lets a headless test render the signed-in UI with a fake user.
// Client-side display only; the game server still verifies real Privy JWTs.
function _testLogin(u, method, event) {
  if (window.BT_PRIVY_TEST !== true) return false;
  user = u; rememberMethod(method); ready = true; emit(event || 'login'); return true;
}

window.BTPrivy = {
  _testLogin,
  enabled, init, initWhenIdle, shouldInitEarly, hasSavedSession, show, hide, logout, getAccessToken, onChange,
  get loaded() { return !!client; },
  getUser: () => user,
  snapshot,
  shortAddr,
  extractHandle,
  extractTelegram,
  extractWallet,
  loadMethods,
  methodLabel: m => METHOD_LABEL[m] || null,
  methodIcon: m => METHOD_ICON[m] || null
};
})();
