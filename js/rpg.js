// RPG System - Levels, XP, Gear, Profiles
(function(){
"use strict";

const STORAGE_KEY = 'bt_profile';
const GUEST_SECRET_KEY = 'bt_guest_secret';
const PREV_ID_KEY = 'bt_prev_profile_id';

let profile = null;
let serverXpLocked = false;
let levelUpCallbacks = [];
let gearDropCallbacks = [];

const GEAR_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_COLORS = ['#aaa', '#22e36b', '#0052ff', '#ff2bd6', '#ffd400'];

const GEAR_TEMPLATES = {
  pickaxe: [
    { name: 'Rusty Pick', rarity: 0, digSpeed: 1.0, desc: 'A worn trenching tool' },
    { name: 'Iron Pick', rarity: 1, digSpeed: 1.15, desc: '+15% dig speed' },
    { name: 'Steel Pick', rarity: 2, digSpeed: 1.3, desc: '+30% dig speed' },
    { name: 'Diamond Pick', rarity: 3, digSpeed: 1.5, desc: '+50% dig speed' },
    { name: 'Trencher\'s Fury', rarity: 4, digSpeed: 1.8, desc: '+80% dig speed' }
  ],
  helmet: [
    { name: 'Cloth Cap', rarity: 0, protection: 0, desc: 'Offers no protection' },
    { name: 'Tin Helmet', rarity: 1, protection: 1, desc: 'Absorbs 1 hit' },
    { name: 'Steel Helmet', rarity: 2, protection: 2, desc: 'Absorbs 2 hits' },
    { name: 'Reinforced Helm', rarity: 3, protection: 3, desc: 'Absorbs 3 hits' },
    { name: 'Diamond Dome', rarity: 4, protection: 4, desc: 'Absorbs 4 hits' }
  ],
  boots: [
    { name: 'Worn Boots', rarity: 0, moveSpeed: 1.0, desc: 'Standard issue' },
    { name: 'Leather Boots', rarity: 1, moveSpeed: 1.1, desc: '+10% move speed' },
    { name: 'Runner\'s Boots', rarity: 2, moveSpeed: 1.2, desc: '+20% move speed' },
    { name: 'Swift Treads', rarity: 3, moveSpeed: 1.35, desc: '+35% move speed' },
    { name: 'Windwalkers', rarity: 4, moveSpeed: 1.5, desc: '+50% move speed' }
  ],
  charm: [
    { name: 'Lucky Penny', rarity: 0, luck: 1.0, desc: 'A small comfort' },
    { name: 'Four-Leaf Clover', rarity: 1, luck: 1.1, desc: '+10% diamond luck' },
    { name: 'Rabbit\'s Foot', rarity: 2, luck: 1.25, desc: '+25% diamond luck' },
    { name: 'Golden Horseshoe', rarity: 3, luck: 1.4, desc: '+40% diamond luck' },
    { name: 'Star of Fortune', rarity: 4, luck: 1.6, desc: '+60% diamond luck' }
  ]
};

function generateId() {
  return 'guest:' + crypto.randomUUID();
}

function getGuestSecret() {
  let secret = localStorage.getItem(GUEST_SECRET_KEY);
  if (!secret) {
    secret = crypto.randomUUID();
    localStorage.setItem(GUEST_SECRET_KEY, secret);
  }
  return secret;
}

function createDefaultProfile(id, name, pfp, fid) {
  return {
    id,
    fid: fid || null,
    name: name || 'Trencher',
    pfp: pfp || null,
    level: 1,
    xp: 0,
    best_depth: 0,
    total_diamonds: 0,
    total_digs: 0,
    deaths: 0,
    play_time: 0,
    inventory: [],
    equipped: {
      pickaxe: null,
      helmet: null,
      boots: null,
      charm: null
    },
    x_handle: null,
    wallet: null,
    titles: [],
    campaign: {},
    created_at: Date.now(),
    updated_at: Date.now()
  };
}

function applyPrivyIdentity() {
  if (typeof BTPrivy === 'undefined' || !BTPrivy.enabled()) return null;
  const snap = BTPrivy.snapshot();
  if (!snap.did) return null;
  return snap;
}

async function loadProfile() {
  // Check for Farcaster context
  let fid = null;
  let fcName = null;
  let fcPfp = null;
  
  if (typeof MiniApp !== 'undefined' && MiniApp.contextReady) {
    try { await MiniApp.contextReady; } catch (e) {}
  }
  if (typeof MiniApp !== 'undefined' && MiniApp.context && MiniApp.context.user) {
    fid = MiniApp.context.user.fid;
    fcName = MiniApp.context.user.username || MiniApp.context.user.displayName;
    fcPfp = MiniApp.context.user.pfpUrl;
  }

  if (typeof BTPrivy !== 'undefined' && BTPrivy.enabled()) {
    try { await BTPrivy.init(); } catch (e) {}
  }
  const privy = applyPrivyIdentity();
  
  const profileId = privy && privy.did
    ? privy.did
    : (fid ? `fid:${fid}` : (localStorage.getItem(STORAGE_KEY + '_id') || generateId()));
  
  // Try to load from server
  try {
    const response = await fetch(`${BT_CONFIG.serverUrl}/api/profile?id=${encodeURIComponent(profileId)}`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.exists) {
        profile = data.profile;
        // Update name/pfp from Farcaster if available
        if (fcName) profile.name = fcName;
        if (fcPfp) profile.pfp = fcPfp;
        if (privy) {
          if (privy.xHandle) profile.x_handle = privy.xHandle;
          if (privy.wallet) profile.wallet = privy.wallet;
          if (privy.did) profile.id = privy.did;
        }
        if (!profile.equipped) profile.equipped = {};
        if (!Array.isArray(profile.inventory)) profile.inventory = [];
        if (data.campaign && typeof Campaign !== 'undefined') Campaign.applyServer(data.campaign);
        serverXpLocked = true;
        saveLocal();
        if (privy) await maybeMigrate(privy);
        return profile;
      }
    }
  } catch (e) {
    console.warn('[RPG] Server unreachable, using local profile');
  }
  
  // Load from local or create new
  const localData = localStorage.getItem(STORAGE_KEY);
  if (localData) {
    try {
      profile = JSON.parse(localData);
      if (fid && !profile.fid) {
        profile.fid = fid;
        profile.id = `fid:${fid}`;
      }
    } catch (e) {
      profile = createDefaultProfile(profileId, fcName, fcPfp, fid);
    }
  } else {
    profile = createDefaultProfile(profileId, fcName, fcPfp, fid);
  }
  
  // Save ID for guests
  if (!fid && !(privy && privy.did)) {
    localStorage.setItem(STORAGE_KEY + '_id', profileId);
  }
  if (privy) {
    if (privy.xHandle) profile.x_handle = privy.xHandle;
    if (privy.wallet) profile.wallet = privy.wallet;
    profile.id = privy.did;
  }
  
  saveLocal();
  // Register the profile server-side so the WebSocket can be verified for XP credit
  await saveToServer();
  if (privy) await maybeMigrate(privy);
  return profile;
}

async function getAuthToken() {
  if (profile && profile.id && String(profile.id).startsWith('did:privy:') && typeof BTPrivy !== 'undefined') {
    try { return await BTPrivy.getAccessToken(); } catch (e) {}
  }
  if (!(profile && profile.fid)) return null; // guests use the guest secret instead
  if (typeof miniapp !== 'undefined' && miniapp.sdk && miniapp.sdk.quickAuth) {
    try {
      // Quick Auth sets aud to this mini app's domain automatically
      const result = await miniapp.sdk.quickAuth.getToken();
      return result.token;
    } catch (e) {
      console.warn('[RPG] Quick auth failed:', e);
    }
  }
  return null;
}

async function maybeMigrate(privy) {
  if (!privy || !privy.did) return;
  const prev = localStorage.getItem(PREV_ID_KEY) || localStorage.getItem(STORAGE_KEY + '_id');
  const fromFc = profile && profile.fid ? `fid:${profile.fid}` : null;
  const fromId = (prev && prev !== privy.did && (prev.startsWith('guest:') || prev.startsWith('fid:'))) ? prev : fromFc;
  if (!fromId || fromId === privy.did) return;
  try {
    const token = await getAuthToken();
    if (!token) return;
    const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
    const body = { from: fromId };
    if (fromId.startsWith('guest:')) {
      body.guestSecret = getGuestSecret();
      headers['X-Guest-Secret'] = getGuestSecret();
    } else if (fromId.startsWith('fid:') && typeof miniapp !== 'undefined' && miniapp.sdk && miniapp.sdk.quickAuth) {
      try { body.farcasterToken = (await miniapp.sdk.quickAuth.getToken()).token; } catch (e) {}
    }
    const res = await fetch(`${BT_CONFIG.serverUrl}/api/profile/migrate`, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (data && data.success && data.profile) {
      profile = data.profile;
      localStorage.setItem(PREV_ID_KEY, fromId);
      saveLocal();
    }
  } catch (e) {
    console.warn('[RPG] migrate skipped', e);
  }
}

function saveLocal() {
  if (profile) {
    profile.updated_at = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }
}

async function saveToServer() {
  if (!profile) return;
  
  try {
    const token = await getAuthToken();
    const guest = !token && !(profile.fid);
    // Do not POST xp/level — the server owns those now.
    const body = {
      id: profile.id,
      fid: profile.fid || null,
      name: profile.name,
      pfp: profile.pfp,
      equipped: profile.equipped,
      x_handle: profile.x_handle || null,
      wallet: profile.wallet || null
    };
    const res = await fetch(`${BT_CONFIG.serverUrl}/api/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(guest ? { 'X-Guest-Secret': getGuestSecret() } : {})
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (data && data.profile) {
      applyServerProfile(data.profile);
    }
  } catch (e) {
    console.warn('[RPG] Failed to save to server:', e);
  }
}

function applyServerProfile(next) {
  if (!next || !profile) return;
  const oldLevel = profile.level;
  profile.xp = next.xp;
  profile.level = next.level;
  profile.best_depth = Math.max(profile.best_depth || 0, next.best_depth || 0);
  if (Array.isArray(next.inventory)) profile.inventory = next.inventory;
  if (next.equipped) profile.equipped = next.equipped;
  if (next.x_handle) profile.x_handle = next.x_handle;
  if (next.wallet) profile.wallet = next.wallet;
  if (Array.isArray(next.titles)) profile.titles = next.titles;
  if (next.campaign && typeof Campaign !== 'undefined') Campaign.applyServer({ ...next.campaign, titles: next.titles });
  serverXpLocked = true;
  if (next.level > oldLevel) {
    levelUpCallbacks.forEach(cb => cb(next.level, oldLevel));
  }
  saveLocal();
}

function applyServerXp(result) {
  if (!profile || !result) return;
  const oldLevel = profile.level;
  if (typeof result.newXp === 'number') profile.xp = result.newXp;
  if (typeof result.newLevel === 'number') profile.level = result.newLevel;
  if (result.gearDrop) {
    profile.inventory.push(result.gearDrop);
    gearDropCallbacks.forEach(cb => cb(result.gearDrop));
  }
  if (result.rewards) {
    result.rewards.forEach(r => {
      if (r.gear) {
        profile.inventory.push(r.gear);
        gearDropCallbacks.forEach(cb => cb(r.gear));
      }
    });
  }
  if (result.campaign && typeof Campaign !== 'undefined') Campaign.applyServer(result.campaign);
  if (result.titles) profile.titles = result.titles;
  serverXpLocked = true;
  if (profile.level > oldLevel) {
    levelUpCallbacks.forEach(cb => cb(profile.level, oldLevel));
    if (typeof Haptics !== 'undefined') Haptics.notification('success');
    if (typeof Sfx !== 'undefined') Sfx.play('power');
  }
  saveLocal();
}

function addXp(amount, source) {
  if (!profile) return;
  // Online: server scores events. Keep a local HUD bump only when offline.
  const online = typeof Multiplayer !== 'undefined' && Multiplayer.connected && serverXpLocked;
  if (online) {
    saveLocal();
    return;
  }
  
  const oldLevel = profile.level;
  profile.xp += amount;
  
  // Recalculate level
  const { level } = BT_CONFIG.levelFromXp(profile.xp);
  profile.level = level;
  
  // Check for level up
  if (level > oldLevel) {
    levelUpCallbacks.forEach(cb => cb(level, oldLevel));
    if (typeof Haptics !== 'undefined') {
      Haptics.notification('success');
    }
    if (typeof Sfx !== 'undefined') {
      Sfx.play('power');
    }
  }
  
  saveLocal();
}

function updateStats(stats) {
  if (!profile) return;
  
  if (stats.depth > profile.best_depth) {
    profile.best_depth = stats.depth;
  }
  if (stats.diamonds) {
    profile.total_diamonds += stats.diamonds;
  }
  if (stats.digs) {
    profile.total_digs += stats.digs;
  }
  if (stats.died) {
    profile.deaths++;
  }
  if (stats.playTime) {
    profile.play_time += stats.playTime;
  }
  
  saveLocal();
}

function generateGearDrop(depth) {
  const types = Object.keys(GEAR_TEMPLATES);
  const type = types[Math.floor(Math.random() * types.length)];
  const templates = GEAR_TEMPLATES[type];
  
  // Rarity based on depth
  let rarityChances = [0.6, 0.25, 0.1, 0.04, 0.01];
  if (depth > 50) rarityChances = [0.4, 0.3, 0.2, 0.08, 0.02];
  if (depth > 100) rarityChances = [0.2, 0.3, 0.3, 0.15, 0.05];
  if (depth > 200) rarityChances = [0.1, 0.2, 0.35, 0.25, 0.1];
  
  const roll = Math.random();
  let cumulative = 0;
  let rarityIndex = 0;
  for (let i = 0; i < rarityChances.length; i++) {
    cumulative += rarityChances[i];
    if (roll < cumulative) {
      rarityIndex = i;
      break;
    }
  }
  
  const template = templates[rarityIndex];
  return {
    id: crypto.randomUUID(),
    type,
    ...template,
    foundAt: Date.now(),
    foundDepth: depth
  };
}

function tryGearDrop(depth) {
  if (!profile) return null;
  
  // Chance based on depth milestones
  if (Math.random() > BT_CONFIG.gearDropChance) return null;
  if (depth < 15) return null;
  
  const gear = generateGearDrop(depth);
  profile.inventory.push(gear);
  saveLocal();
  
  gearDropCallbacks.forEach(cb => cb(gear));
  
  if (typeof Haptics !== 'undefined') {
    Haptics.notification('success');
  }
  
  return gear;
}

function equipGear(gearId) {
  if (!profile) return false;
  
  const gear = profile.inventory.find(g => g.id === gearId);
  if (!gear) return false;
  
  profile.equipped[gear.type] = gearId;
  saveLocal();
  return true;
}

function unequipGear(type) {
  if (!profile) return;
  profile.equipped[type] = null;
  saveLocal();
}

function getEquippedGear(type) {
  if (!profile || !profile.equipped[type]) return null;
  return profile.inventory.find(g => g.id === profile.equipped[type]);
}

function getGearStats() {
  const stats = {
    digSpeed: 1.0,
    protection: 0,
    moveSpeed: 1.0,
    luck: 1.0
  };
  
  if (!profile) return stats;
  
  const pickaxe = getEquippedGear('pickaxe');
  const helmet = getEquippedGear('helmet');
  const boots = getEquippedGear('boots');
  const charm = getEquippedGear('charm');
  
  if (pickaxe) stats.digSpeed = pickaxe.digSpeed;
  if (helmet) stats.protection = helmet.protection;
  if (boots) stats.moveSpeed = boots.moveSpeed;
  if (charm) stats.luck = charm.luck;
  
  return stats;
}

function onLevelUp(callback) {
  levelUpCallbacks.push(callback);
}

function onGearDrop(callback) {
  gearDropCallbacks.push(callback);
}

async function fetchLeaderboard(type = 'xp') {
  try {
    const response = await fetch(`${BT_CONFIG.serverUrl}/api/leaderboard?type=${type}`);
    if (response.ok) {
      const data = await response.json();
      return data.leaderboard;
    }
  } catch (e) {
    console.warn('[RPG] Failed to fetch leaderboard:', e);
  }
  return [];
}

window.RPG = {
  loadProfile,
  saveToServer,
  addXp,
  applyServerXp,
  applyServerProfile,
  updateStats,
  tryGearDrop,
  equipGear,
  unequipGear,
  getEquippedGear,
  getGearStats,
  onLevelUp,
  onGearDrop,
  fetchLeaderboard,
  getProfile: () => profile,
  getAuthToken,
  getGuestSecret,
  maybeMigrate,
  GEAR_TEMPLATES,
  GEAR_RARITIES,
  RARITY_COLORS
};
})();
