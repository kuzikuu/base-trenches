// Multiplayer client - WebSocket connection to TrenchRoom
(function(){
"use strict";

let ws = null;
let connected = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let playerId = null;
let players = new Map(); // id -> player data
let dugBlocks = new Map(); // "x,y" -> timestamp
let playerCount = 0;
let worldSeed = null;
let connecting = false;
let lastStateSent = 0;
let pendingXp = 0;
let chatCallbacks = [];
let statusCallbacks = [];

let roster = [];
let rosterCallbacks = [];

async function getWsUrl(profile) {
  const base = BT_CONFIG.serverUrl.replace(/^http/, 'ws');
  const q = new URLSearchParams({ room: 'main' });
  // Credentials let the server credit XP to this profile (browsers can't set WS headers)
  const token = profile && typeof RPG !== 'undefined' ? await RPG.getAuthToken() : null;
  if (token) {
    q.set('token', token);
  } else if (profile && profile.id && String(profile.id).startsWith('guest:')) {
    q.set('profileId', profile.id);
    q.set('secret', RPG.getGuestSecret());
  }
  return `${base}/api/ws?${q}`;
}

async function connect(profile) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  
  if (connecting) return;
  let sock;
  try {
    connecting = true;
    const url = await getWsUrl(profile);
    sock = ws = new WebSocket(url);
  } catch (e) {
    connecting = false;
    console.warn('[MP] WebSocket connection failed:', e);
    notifyStatus('offline');
    scheduleReconnect();
    return;
  }
  connecting = false;
  
  // Handlers ignore events from a socket that has since been replaced (disconnect()/reconnect)
  sock.onopen = () => {
    if (sock !== ws) return;
    console.log('[MP] Connected');
    connected = true;
    reconnectAttempts = 0;
    notifyStatus('connected');
    
    // Send join message
    sock.send(JSON.stringify({
      type: 'join',
      playerId: profile.id,
      name: profile.name,
      pfp: profile.pfp,
      level: profile.level,
      equipped: profile.equipped,
      xHandle: profile.x_handle || profile.xHandle || null
    }));
  };
  
  sock.onmessage = (event) => {
    if (sock !== ws) return;
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (e) {
      console.warn('[MP] Invalid message:', e);
    }
  };
  
  sock.onclose = () => {
    if (sock !== ws) return;
    console.log('[MP] Disconnected');
    connected = false;
    notifyStatus('disconnected');
    scheduleReconnect();
  };
  
  sock.onerror = (e) => {
    if (sock !== ws) return;
    console.warn('[MP] WebSocket error');
    notifyStatus('error');
  };
}

function disconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (ws) {
    const old = ws;
    ws = null; // detach first so the old socket's onclose doesn't flip state or auto-reconnect
    old.close();
  }
  connected = false;
  players.clear();
  dugBlocks.clear();
}

function scheduleReconnect() {
  if (reconnectTimeout) return;
  if (reconnectAttempts >= BT_CONFIG.wsReconnectAttempts) {
    console.log('[MP] Max reconnect attempts reached, staying offline');
    notifyStatus('offline');
    return;
  }
  
  const delay = Math.min(
    BT_CONFIG.wsReconnectDelay * Math.pow(2, reconnectAttempts),
    BT_CONFIG.wsMaxReconnectDelay
  );
  
  reconnectAttempts++;
  console.log(`[MP] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    const profile = RPG.getProfile();
    if (profile) connect(profile);
  }, delay);
}

function handleMessage(data) {
  switch (data.type) {
    case 'init':
      playerId = data.playerId;
      playerCount = data.playerCount;
      players.clear();
      if (typeof data.seed === 'number' && data.seed !== worldSeed) {
        worldSeed = data.seed;
        if (typeof Game !== 'undefined' && Game.setSeed) Game.setSeed(worldSeed);
      }
      data.players.forEach(p => {
        if (p.id !== playerId) players.set(p.id, p);
      });
      data.dugBlocks.forEach(([key, ts]) => {
        dugBlocks.set(key, ts);
        const [bx, by] = key.split(',').map(Number);
        if (typeof Game !== 'undefined' && Game.applyRemoteDig) Game.applyRemoteDig(bx, by);
      });
      if (data.roster) { roster = data.roster; rosterCallbacks.forEach(cb => cb(roster)); }
      break;
      
    case 'join':
      if (data.playerId !== playerId) {
        players.set(data.playerId, {
          id: data.playerId,
          name: data.name,
          pfp: data.pfp,
          level: data.level,
          x: 0, y: 0, vx: 0, vy: 0, face: 1, swing: 0
        });
        playerCount = typeof data.playerCount === 'number' ? data.playerCount : playerCount + 1;
        if (data.xHandle) players.get(data.playerId).xHandle = data.xHandle;
      }
      break;
      
    case 'leave':
      players.delete(data.playerId);
      playerCount = typeof data.playerCount === 'number' ? data.playerCount : Math.max(0, playerCount - 1);
      break;
      
    case 'states':
      playerCount = data.playerCount;
      if (data.roster) { roster = data.roster; rosterCallbacks.forEach(cb => cb(roster)); }
      data.players.forEach(p => {
        if (p.id !== playerId) {
          const existing = players.get(p.id);
          if (existing) {
            // Interpolation target
            existing.targetX = p.x;
            existing.targetY = p.y;
            existing.vx = p.vx;
            existing.vy = p.vy;
            existing.face = p.face;
            existing.swing = p.swing;
            existing.name = p.name;
            existing.pfp = p.pfp;
            existing.level = p.level;
            existing.xHandle = p.xHandle;
            existing.status = p.status;
          } else {
            players.set(p.id, { ...p, targetX: p.x, targetY: p.y });
          }
        }
      });
      break;
      
    case 'xp':
      if (typeof RPG !== 'undefined' && RPG.applyServerXp) RPG.applyServerXp(data);
      break;
      
    case 'dig':
      if (data.playerId !== playerId) {
        dugBlocks.set(`${data.x},${data.y}`, Date.now());
        if (typeof Game !== 'undefined' && Game.applyRemoteDig) Game.applyRemoteDig(data.x, data.y);
      }
      break;
      
    case 'chat':
      if (data.playerId !== playerId) {
        const player = players.get(data.playerId);
        if (player) {
          player.chatText = data.text;
          player.chatTime = Date.now();
        }
        chatCallbacks.forEach(cb => cb(data.playerId, data.name, data.text));
      }
      break;
  }
}

function sendState(x, y, vx, vy, face, swing) {
  if (!connected || !ws) return;
  
  const now = Date.now();
  if (now - lastStateSent < BT_CONFIG.syncRate) return;
  lastStateSent = now;
  
  ws.send(JSON.stringify({
    type: 'state',
    x: Math.round(x),
    y: Math.round(y),
    vx: Math.round(vx),
    vy: Math.round(vy),
    face,
    swing: swing > 0 ? 1 : 0,
    level: (RPG.getProfile() || {}).level || 1
  }));
}

function sendDig(x, y) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'dig', x, y }));
}

function sendEvent(event) {
  if (!connected || !ws || !event) return;
  ws.send(JSON.stringify({ type: 'event', ...event }));
}

function sendChat(text) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
}

function sendXp() { /* client XP amounts are ignored; use sendEvent */ }

function flushXp() { pendingXp = 0; }

function interpolatePlayers(dt) {
  const lerpSpeed = 10;
  players.forEach(p => {
    if (p.targetX !== undefined) {
      p.x += (p.targetX - p.x) * lerpSpeed * dt;
      p.y += (p.targetY - p.y) * lerpSpeed * dt;
    }
    // Clear old chat
    if (p.chatTime && Date.now() - p.chatTime > 4000) {
      p.chatText = null;
    }
  });
}

function notifyStatus(status) {
  statusCallbacks.forEach(cb => cb(status));
}

function onChat(callback) {
  chatCallbacks.push(callback);
}

function onStatus(callback) {
  statusCallbacks.push(callback);
}

function onRoster(callback) {
  rosterCallbacks.push(callback);
}

function isBlockDugByOthers(x, y) {
  return dugBlocks.has(`${x},${y}`);
}

window.Multiplayer = {
  connect,
  disconnect,
  sendState,
  sendDig,
  sendEvent,
  sendChat,
  sendXp,
  flushXp,
  interpolatePlayers,
  onChat,
  onStatus,
  onRoster,
  isBlockDugByOthers,
  get connected() { return connected; },
  get playerId() { return playerId; },
  get players() { return players; },
  get playerCount() { return playerCount; },
  get roster() { return roster; },
  get worldSeed() { return worldSeed; },
  get dugBlocks() { return dugBlocks; }
};
})();
