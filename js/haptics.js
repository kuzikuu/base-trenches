// Haptics: tactile feedback using Farcaster mini-app SDK or navigator.vibrate fallback.
(function(){
"use strict";

let enabled = localStorage.getItem("bt_haptics") !== "0";
let sdkHaptics = null;
let vibrateSupported = false;
let lastTime = {};
const THROTTLE_MS = 50;

function init(sdk) {
  if (sdk && sdk.haptics) {
    sdk.getCapabilities().then(caps => {
      sdkHaptics = {
        impact: caps.includes('haptics.impactOccurred'),
        notification: caps.includes('haptics.notificationOccurred'),
        selection: caps.includes('haptics.selectionChanged'),
        sdk: sdk
      };
    }).catch(() => {});
  }
  vibrateSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function throttled(key) {
  const now = Date.now();
  if (lastTime[key] && now - lastTime[key] < THROTTLE_MS) return false;
  lastTime[key] = now;
  return true;
}

function impact(style) {
  if (!enabled || !throttled('impact')) return;
  style = style || 'medium';
  
  if (sdkHaptics && sdkHaptics.impact) {
    sdkHaptics.sdk.haptics.impactOccurred(style).catch(() => {});
    return;
  }
  
  if (vibrateSupported) {
    const patterns = {
      light: [10],
      medium: [20],
      heavy: [40],
      soft: [15],
      rigid: [25]
    };
    navigator.vibrate(patterns[style] || [20]);
  }
}

function notification(type) {
  if (!enabled || !throttled('notification')) return;
  type = type || 'success';
  
  if (sdkHaptics && sdkHaptics.notification) {
    sdkHaptics.sdk.haptics.notificationOccurred(type).catch(() => {});
    return;
  }
  
  if (vibrateSupported) {
    const patterns = {
      success: [30, 50, 30],
      warning: [50, 30, 50],
      error: [100, 50, 100]
    };
    navigator.vibrate(patterns[type] || [30, 50, 30]);
  }
}

function selection() {
  if (!enabled || !throttled('selection')) return;
  
  if (sdkHaptics && sdkHaptics.selection) {
    sdkHaptics.sdk.haptics.selectionChanged().catch(() => {});
    return;
  }
  
  if (vibrateSupported) {
    navigator.vibrate([8]);
  }
}

function toggle() {
  enabled = !enabled;
  localStorage.setItem("bt_haptics", enabled ? "1" : "0");
  if (enabled) selection();
  return enabled;
}

window.Haptics = {
  init,
  impact,
  notification,
  selection,
  toggle,
  get enabled() { return enabled; }
};
})();
