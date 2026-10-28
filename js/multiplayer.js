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
let lastStateSent = 0;
let pendingXp = 0;
let chatCallbacks = [];
let statusCallbacks = [];

function getWsUrl() {
  const base = BT_CONFIG.serverUrl.replace(/^http/, 'ws');
  return `${base}/api/ws?room=main`;
}

function connect(profile) {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  
  try {
    ws = new WebSocket(getWsUrl());
  } catch (e) {
    console.warn('[MP] WebSocket connection failed:', e);
    notifyStatus('offline');
    scheduleReconnect();
    return;
  }
  
  ws.onopen = () => {
    console.log('[MP] Connected');
    connected = true;
    reconnectAttempts = 0;
    notifyStatus('connected');
    
    // Send join message
    ws.send(JSON.stringify({
      type: 'join',
      playerId: profile.id,
      name: profile.name,
      pfp: profile.pfp,
      level: profile.level,
      equipped: profile.equipped
    }));
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (e) {
      console.warn('[MP] Invalid message:', e);
    }
  };
  
  ws.onclose = () => {
    console.log('[MP] Disconnected');
    connected = false;
    notifyStatus('disconnected');
    scheduleReconnect();
  };
  
  ws.onerror = (e) => {
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
    ws.close();
    ws = null;
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
      data.players.forEach(p => {
        if (p.id !== playerId) players.set(p.id, p);
      });
      data.dugBlocks.forEach(([key, ts]) => dugBlocks.set(key, ts));
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
        playerCount++;
      }
      break;
      
    case 'leave':
      players.delete(data.playerId);
      playerCount = Math.max(0, playerCount - 1);
      break;
      
    case 'states':
      playerCount = data.playerCount;
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
          } else {
            players.set(p.id, { ...p, targetX: p.x, targetY: p.y });
          }
        }
      });
      break;
      
    case 'dig':
      if (data.playerId !== playerId) {
        dugBlocks.set(`${data.x},${data.y}`, Date.now());
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
    swing: swing > 0 ? 1 : 0
  }));
}

function sendDig(x, y) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'dig', x, y }));
}

function sendChat(text) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
}

function sendXp(xp, depth) {
  if (!connected || !ws) return;
  const profile = RPG.getProfile();
  if (!profile) return;
  
  pendingXp += xp;
  
  // Batch XP sends
  if (pendingXp >= 5) {
    ws.send(JSON.stringify({
      type: 'xp',
      xp: pendingXp,
      depth,
      profileId: profile.id
    }));
    pendingXp = 0;
  }
}

function flushXp(depth) {
  if (pendingXp > 0 && connected && ws) {
    const profile = RPG.getProfile();
    if (profile) {
      ws.send(JSON.stringify({
        type: 'xp',
        xp: pendingXp,
        depth,
        profileId: profile.id
      }));
    }
    pendingXp = 0;
  }
}

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

function isBlockDugByOthers(x, y) {
  return dugBlocks.has(`${x},${y}`);
}

window.Multiplayer = {
  connect,
  disconnect,
  sendState,
  sendDig,
  sendChat,
  sendXp,
  flushXp,
  interpolatePlayers,
  onChat,
  onStatus,
  isBlockDugByOthers,
  get connected() { return connected; },
  get playerId() { return playerId; },
  get players() { return players; },
  get playerCount() { return playerCount; }
};
})();
