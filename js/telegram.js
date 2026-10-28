// Telegram Mini App support. Loads telegram-web-app.js only when the page was opened
// from Telegram (launch params in the URL or the Telegram webview bridge), so a normal
// browser visit makes no extra request and behaves exactly as before.
(function(){
"use strict";

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js?59';
const WIDGET_URL = 'https://telegram.org/js/telegram-widget.js?22';

function launchedFromTelegram() {
  try {
    const s = location.hash + '&' + location.search;
    if (/tgWebApp(Data|Version|Platform)=/.test(s)) return true;
    if (window.TelegramWebviewProxy) return true;
    if (sessionStorage.getItem('bt_tg_launch') === '1') return true;
    if (window.parent !== window && /web\.telegram\.org/.test(document.referrer || '')) return true;
  } catch (e) {}
  return false;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('load failed: ' + src));
    document.head.appendChild(s);
  });
}

let webApp = null;
let inMiniApp = false;

function setInsets() {
  if (!webApp) return;
  const a = webApp.safeAreaInset || {}, c = webApp.contentSafeAreaInset || {};
  const root = document.documentElement.style;
  root.setProperty('--safe-top', ((a.top || 0) + (c.top || 0)) + 'px');
  root.setProperty('--safe-bottom', ((a.bottom || 0) + (c.bottom || 0)) + 'px');
  root.setProperty('--safe-left', ((a.left || 0) + (c.left || 0)) + 'px');
  root.setProperty('--safe-right', ((a.right || 0) + (c.right || 0)) + 'px');
  const h = webApp.viewportStableHeight || webApp.viewportHeight;
  if (h) root.setProperty('--tg-vh', h + 'px');
}

function setup() {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg || !tg.initData) return false;   // script loaded but not inside a Mini App
  webApp = tg; inMiniApp = true;
  try { sessionStorage.setItem('bt_tg_launch', '1'); } catch (e) {}
  document.documentElement.classList.add('tg-miniapp');
  try { tg.ready(); } catch (e) {}
  try { tg.expand(); } catch (e) {}
  // Vertical swipes would close/minimise the app while digging with the pad.
  try { if (tg.isVersionAtLeast && tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes(); } catch (e) {}
  try { if (tg.isVersionAtLeast && tg.isVersionAtLeast('6.1')) { tg.setHeaderColor('#ffffff'); tg.setBackgroundColor('#ffffff'); } } catch (e) {}
  try { if (tg.isVersionAtLeast && tg.isVersionAtLeast('8.0') && tg.lockOrientation) tg.lockOrientation(); } catch (e) {}
  setInsets();
  ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged'].forEach(ev => {
    try { tg.onEvent(ev, setInsets); } catch (e) {}
  });
  return true;
}

const ready = launchedFromTelegram()
  ? loadScript(SDK_URL).then(setup).catch(e => { console.warn('[Telegram]', e.message); return false; })
  : Promise.resolve(false);

// Signed launch params for Privy seamless login: initData split into key/value pairs,
// each value decoded exactly once (URLSearchParams does that).
function webAppData() {
  if (!webApp || !webApp.initData) return null;
  const p = new URLSearchParams(webApp.initData);
  const out = {};
  p.forEach((v, k) => { out[k] = v; });
  if (out.auth_date) out.auth_date = Number(out.auth_date);
  return out.hash && out.user ? out : null;
}

function user() {
  return webApp && webApp.initDataUnsafe && webApp.initDataUnsafe.user || null;
}

// Telegram Login Widget popup for normal browsers. Resolves to the auth result or null.
let widgetLoad = null;
function loginPopup(botId) {
  if (!widgetLoad) widgetLoad = loadScript(WIDGET_URL);
  return widgetLoad.then(() => new Promise(resolve => {
    if (!window.Telegram || !Telegram.Login || !Telegram.Login.auth) return resolve(null);
    Telegram.Login.auth({ bot_id: String(botId), request_access: 'write' }, data => resolve(data || null));
  }));
}

function openLink(url) {
  if (webApp && webApp.openLink) { try { webApp.openLink(url); return true; } catch (e) {} }
  return false;
}

window.BTTelegram = {
  ready,
  isMiniApp: () => inMiniApp,
  webApp: () => webApp,
  webAppData,
  user,
  loginPopup,
  openLink
};
})();
