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

function init() {
  if (typeof miniapp !== 'undefined' && miniapp.sdk) {
    sdk = miniapp.sdk;
    // sdk.context is a Promise; outside a host it may never resolve, so cap the wait
    const timeout = new Promise(r => setTimeout(() => r(null), 1500));
    contextReady = Promise.race([Promise.resolve(sdk.context), timeout]).then(ctx => {
      context = ctx || null;
      isInHost = !!(context && context.user);
      if (context && context.client && context.client.safeAreaInsets) {
        safeAreaInsets = context.client.safeAreaInsets;
        applySafeAreaInsets();
      }
      Haptics.init(isInHost ? sdk : null);
      return context;
    }).catch(e => {
      console.warn('[MiniApp] Failed to get context:', e);
      Haptics.init(null);
      return null;
    });
  } else {
    Haptics.init(null);
  }
}

function applySafeAreaInsets() {
  document.documentElement.style.setProperty('--safe-top', safeAreaInsets.top + 'px');
  document.documentElement.style.setProperty('--safe-bottom', safeAreaInsets.bottom + 'px');
  document.documentElement.style.setProperty('--safe-left', safeAreaInsets.left + 'px');
  document.documentElement.style.setProperty('--safe-right', safeAreaInsets.right + 'px');
}

function ready() {
  if (sdk && sdk.actions && sdk.actions.ready) {
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

window.MiniApp = {
  init,
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
