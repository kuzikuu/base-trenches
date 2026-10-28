// Privy login modal. Hidden when BT_PRIVY_APP_ID is empty (guest / Farcaster unchanged).
(function(){
"use strict";

const CDN = [
  'https://esm.sh/@privy-io/js-sdk-core@0.58.0',
  'https://cdn.jsdelivr.net/npm/@privy-io/js-sdk-core@0.58.0/+esm'
];

let client = null;
let user = null;
let ready = false;
const listeners = [];

function appId() {
  return (window.BT_CONFIG && BT_CONFIG.privyAppId) || window.BT_PRIVY_APP_ID || '';
}
function enabled() { return !!appId(); }

function emit() { listeners.forEach(fn => { try { fn(snapshot()); } catch (e) {} }); }

function snapshot() {
  return {
    enabled: enabled(),
    ready,
    user,
    did: user && (user.id || user.did),
    xHandle: extractHandle(user),
    wallet: extractWallet(user)
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

async function loadSdk() {
  let last;
  for (const url of CDN) {
    try {
      return await import(/* @vite-ignore */ url);
    } catch (e) { last = e; }
  }
  throw last || new Error('Privy SDK failed to load');
}

async function init() {
  if (!enabled()) return null;
  if (client) return client;
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
  if (user) await ensureWallet();
  ready = true;
  emit();
  return client;
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

function homeView() {
  renderBody(`
    <p class="note">Link X, a wallet, Farcaster or email. An embedded Base wallet is created if you do not have one. Non-custodial — keys stay with Privy / you.</p>
    <div class="login-methods">
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
      await afterLogin(session);
    } catch (err) { showError(err.message || 'Bad code'); }
  };
}

async function oauth(provider) {
  if (!client || !client.auth || !client.auth.oauth) {
    showError('OAuth is not available in this SDK build.');
    return;
  }
  const redirectURI = location.origin + location.pathname;
  try {
    const url = await client.auth.oauth.generateURL(provider, redirectURI);
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
    const session = await client.auth.oauth.loginWithCode(code, state);
    history.replaceState(null, '', location.pathname + location.hash);
    await afterLogin(session);
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
    await afterLogin(session);
  } catch (e) {
    showError(e.message || 'Wallet login failed');
  }
}

async function afterLogin(session) {
  user = (session && session.user) || session || user;
  await ensureWallet();
  ready = true;
  emit();
  hide();
}

async function startMethod(method) {
  try { await init(); } catch (e) { showError('Could not load Privy. Check the app id.'); return; }
  if (method === 'email') return emailView();
  if (method === 'twitter') return oauth('twitter');
  if (method === 'farcaster') return oauth('farcaster');
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
  emit();
  hide();
}

function show() {
  if (!enabled()) return;
  ensureModal().classList.remove('hidden');
  homeView();
  init().then(() => finishOauth()).catch(e => showError(e.message || 'Privy failed'));
}

function hide() {
  const el = document.getElementById('loginModal');
  if (el) el.classList.add('hidden');
}

function onChange(fn) { listeners.push(fn); }

window.BTPrivy = {
  enabled, init, show, hide, logout, getAccessToken, onChange,
  getUser: () => user,
  snapshot,
  shortAddr,
  extractHandle,
  extractWallet
};
})();
