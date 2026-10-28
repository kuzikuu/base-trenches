// Base Trenches Configuration
// Edit BT_SERVER_URL after deploying the multiplayer server
(function(){
"use strict";

// ============================================
// SERVER URL - UPDATE THIS AFTER DEPLOY
// ============================================
// Replace with your deployed worker URL, e.g.:
// 'https://base-trenches-server.yourname.workers.dev'
const DEFAULT_SERVER_URL = 'https://base-trenches-server.YOURSUBDOMAIN.workers.dev';

window.BT_CONFIG = {
  // Multiplayer server URL (can be overridden by setting window.BT_SERVER_URL before loading)
  serverUrl: window.BT_SERVER_URL || DEFAULT_SERVER_URL,
  
  // Home URL for sharing
  homeUrl: window.BT_HOME_URL || 'https://base-trenches.pages.dev/',
  
  // WebSocket reconnect settings
  wsReconnectDelay: 2000,
  wsMaxReconnectDelay: 30000,
  wsReconnectAttempts: 10,
  
  // State sync rate (ms between position updates)
  syncRate: 50, // 20Hz
  
  // XP settings
  xpPerDig: 1,
  xpPerDiamond: 5,
  xpPerPowerGem: 10,
  xpPerMeter: 2,
  xpPerDodge: 3,
  xpPerSecondAlive: 0.5,
  
  // Level curve: XP = 100 * 1.5^(level-1)
  levelBase: 100,
  levelMultiplier: 1.5,
  
  // Gear drop chance per depth milestone
  gearDropChance: 0.03, // 3% per 25m depth
  
  // Debug mode
  debug: false
};

// Utility functions
window.BT_CONFIG.xpForLevel = function(level) {
  return Math.floor(this.levelBase * Math.pow(this.levelMultiplier, level - 1));
};

window.BT_CONFIG.levelFromXp = function(xp) {
  let level = 1;
  let totalXp = 0;
  while (totalXp + this.xpForLevel(level) <= xp) {
    totalXp += this.xpForLevel(level);
    level++;
  }
  return { level, xpInLevel: xp - totalXp, xpForNext: this.xpForLevel(level) };
};

})();
