// Farcaster Mini App SDK integration for Base App.
// Falls back gracefully when not running inside a mini-app host.
(function(){
"use strict";

const HOME_URL = window.BT_HOME_URL || 'https://powerof9base.com/';
let sdk = null;
let context = null;
let isInHost = false;
let safeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };
let contextReady = Promise.resolve(null);

// The SDK (136 KiB) is only fetched when the page can actually be a mini app: inside an iframe
// (Farcaster / Base web clients) or a React Native webview (mobile hosts), or with ?miniApp=true.
// Telegram launches (also iframes on web.telegram.org) are excluded. Plain browser visits skip it.
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@farcaster/miniapp-sdk@0.3/dist/index.min.js';
let wantReady = false;

function miniAppContextLikely() {
  try {
    if (typeof BTTelegram !== 'undefined' && BTTelegram.launched) return false;
    if (/[?&]miniApp=true\b/i.test(location.search)) return true;
    if (window.ReactNativeWebView) return true;
    if (window.self !== window.top) return true;
  } catch (e) { return true; }   // cross-origin top access threw: we are framed
  return false;
}

function loadSdk() {
  if (typeof miniapp !== 'undefined' && miniapp.sdk) return Promise.resolve(miniapp.sdk);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL; s.async = true;
    s.onload = () => (typeof miniapp !== 'undefined' && miniapp.sdk) ? resolve(miniapp.sdk) : reject(new Error('no sdk'));
    s.onerror = () => reject(new Error('Farcaster SDK failed to load'));
    document.head.appendChild(s);
  });
}

function init() {
  if (!miniAppContextLikely()) { Haptics.init(null); return; }
  // sdk.context is a Promise; outside a host it may never resolve, so cap the wait
  contextReady = loadSdk().then(loaded => {
    sdk = loaded;
    if (wantReady) ready();
    const timeout = new Promise(r => setTimeout(() => r(null), 1500));
    return Promise.race([Promise.resolve(sdk.context), timeout]);
  }).then(ctx => {
    context = ctx || null;
    isInHost = !!(context && context.user);
    if (context && context.client && context.client.safeAreaInsets) {
      safeAreaInsets = context.client.safeAreaInsets;
      applySafeAreaInsets();
    }
    Haptics.init(isInHost ? sdk : null);
    return context;
  }).catch(e => {
    console.warn('[MiniApp] Failed to get context:', e && e.message);
    Haptics.init(null);
    return null;
  });
}

function applySafeAreaInsets() {
  document.documentElement.style.setProperty('--safe-top', safeAreaInsets.top + 'px');
  document.documentElement.style.setProperty('--safe-bottom', safeAreaInsets.bottom + 'px');
  document.documentElement.style.setProperty('--safe-left', safeAreaInsets.left + 'px');
  document.documentElement.style.setProperty('--safe-right', safeAreaInsets.right + 'px');
}

function ready() {
  wantReady = true;   // SDK still loading: called again once it is in
  if (sdk && sdk.actions && sdk.actions.ready) {
    wantReady = false;
    sdk.actions.ready().catch(e => console.warn('[MiniApp] ready() failed:', e));
  }
}

function getUsername() {
  if (context && context.user && context.user.username) {
    return context.user.username;
  }
  return null;
}

function getDisplayName() {
  if (context && context.user && context.user.displayName) {
    return context.user.displayName;
  }
  return null;
}

function shareScore(mult, depth) {
  const text = `⛏️ I dug to x${mult.toFixed(2)} at ${depth}m in Base Trenches!\n\nPower of 9. Manifesting 589x. @PowerOf9Base`;
  const url = HOME_URL;
  
  if (sdk && sdk.actions && sdk.actions.composeCast) {
    sdk.actions.composeCast({
      text: text,
      embeds: [url]
    }).catch(e => {
      console.warn('[MiniApp] composeCast failed, falling back:', e);
      fallbackShare(text, url);
    });
  } else {
    fallbackShare(text, url);
  }
}

function fallbackShare(text, url) {
  const xText = encodeURIComponent(text + '\n' + url);
  const xUrl = `https://x.com/intent/tweet?text=${xText}`;
  window.open(xUrl, '_blank', 'noopener');
}

// Open an outside link through the host (mini-app webviews may block target=_blank).
function openUrl(url) {
  if (!isInHost || !sdk || !sdk.actions || !sdk.actions.openUrl) return false;
  try { Promise.resolve(sdk.actions.openUrl(url)).catch(() => window.open(url, '_blank', 'noopener')); return true; } catch (e) { return false; }
}

window.MiniApp = {
  init,
  openUrl,
  ready,
  getUsername,
  getDisplayName,
  shareScore,
  get isInHost() { return isInHost; },
  get context() { return context; },
  get contextReady() { return contextReady; },
  get safeAreaInsets() { return safeAreaInsets; }
};
})();
