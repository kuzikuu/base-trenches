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
let recruitCount = 0; // NPC recruits (server bots), never included in playerCount
let worldSeed = null;
let connecting = false;
let lastStateSent = 0;
let lastStateKey = '';
let sector = null;
let pendingXp = 0;
let chatCallbacks = [];
let statusCallbacks = [];

let heartbeat = null, heartbeatSock = null, replacedSock = false;
let roster = [];
let rosterCallbacks = [];
// Save game: reconnect to the sector you saved in (falls back to 'main' if it fails once).
let roomOverride = null;
let savedCallbacks = [];

// Guest credentials go in the first websocket message (type 'auth'), never in the URL, so the
// guest secret does not end up in proxy / CDN / server access logs. Signed-in players still send
// their short-lived Privy / Farcaster token in the URL (browsers can't set WS headers).
let pendingAuth = null;
async function getWsUrl(profile) {
  const base = BT_CONFIG.serverUrl.replace(/^http/, 'ws');
  const q = new URLSearchParams({ room: roomOverride && /^main(-[2-8])?$/.test(roomOverride) ? roomOverride : 'main' });
  pendingAuth = null;
  // Credentials let the server credit XP to this profile
  const token = profile && typeof RPG !== 'undefined' ? await RPG.getAuthToken() : null;
  if (token) {
    q.set('token', token);
  } else if (profile && profile.id && String(profile.id).startsWith('guest:')) {
    const secret = RPG.getGuestSecret();
    if (secret) pendingAuth = { type: 'auth', profileId: profile.id, secret };
  }
  return `${base}/api/ws?${q}`;
}

async function connect(profile) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  
  if (connecting) return;
  let sock, auth = null;
  try {
    connecting = true;
    const url = await getWsUrl(profile);
    auth = pendingAuth; pendingAuth = null;
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
    replacedSock = false;
    notifyStatus('connected');
    // Heartbeat: the room auto-answers 'ping' without waking up and prunes sockets that go
    // silent for 150 s, so a dead tab / dropped network never lingers in the roster.
    if (heartbeat) clearInterval(heartbeat);
    heartbeatSock = sock;
    heartbeat = setInterval(() => { if (sock.readyState === WebSocket.OPEN) { try { sock.send('ping'); } catch (e) {} } }, 25000);
    
    // Guest auth first (the room verifies it before handling join), then join
    if (auth) sock.send(JSON.stringify(auth));
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
  
  sock.onclose = (ev) => {
    if (sock === heartbeatSock) { clearInterval(heartbeat); heartbeat = null; heartbeatSock = null; }
    if (sock !== ws) return;
    console.log('[MP] Disconnected');
    connected = false;
    // 4002: the server replaced this idle connection with a newer one of the same account
    // (another tab / a reconnect). Do not fight it; reconnect only when this tab is used again.
    if (ev && ev.code === 4002) { notifyStatus('offline'); replacedSock = true; return; }
    notifyStatus('disconnected');
    if (roomOverride && !playerId) roomOverride = null; // sector unreachable: next try uses 'main'
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
      sector = data.sector || null;
      playerCount = data.playerCount;
      recruitCount = data.recruitCount || 0;
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
      if (data.pulse) pulseCallbacks.forEach(cb => { try { cb(data.pulse); } catch (e) {} });
      break;
      
    case 'join':
      if (data.playerId !== playerId) {
        players.set(data.playerId, {
          id: data.playerId,
          name: data.name,
          pfp: data.pfp,
          level: data.level,
          bot: !!data.bot,
          role: data.role || null,
          x: 0, y: 0, vx: 0, vy: 0, face: 1, swing: 0
        });
        if (data.bot) recruitCount = typeof data.recruitCount === 'number' ? data.recruitCount : recruitCount + 1;
        else playerCount = typeof data.playerCount === 'number' ? data.playerCount : playerCount + 1;
        if (data.xHandle) players.get(data.playerId).xHandle = data.xHandle;
      }
      break;
      
    case 'leave':
      players.delete(data.playerId);
      if (data.bot) recruitCount = typeof data.recruitCount === 'number' ? data.recruitCount : Math.max(0, recruitCount - 1);
      else playerCount = typeof data.playerCount === 'number' ? data.playerCount : Math.max(0, playerCount - 1);
      break;
      
    case 'states':
      playerCount = data.playerCount;
      recruitCount = data.recruitCount || 0;
      if (data.roster) { roster = data.roster; rosterCallbacks.forEach(cb => cb(roster)); }
      // The server sends everyone it still counts (one per account, dead sockets pruned):
      // forget anyone missing so duplicate / dropped sessions do not linger as ghosts.
      { const live = new Set(data.players.map(p => p.id)); for (const id of [...players.keys()]) if (!live.has(id)) players.delete(id); }
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
            existing.bot = !!p.bot;
          } else {
            players.set(p.id, { ...p, targetX: p.x, targetY: p.y });
          }
        }
      });
      break;
      
    case 'xp':
      if (typeof RPG !== 'undefined' && RPG.applyServerXp) RPG.applyServerXp(data);
      break;

    // Power of 9: server-wide meter / boost / feed (batched by the room from the Pulse DO)
    case 'pulse':
      pulseCallbacks.forEach(cb => { try { cb(data); } catch (e) {} });
      break;

    // Power of 9: a personal moment the server validated (9-streak, 589 m, perk)
    case 'p9':
      p9Callbacks.forEach(cb => { try { cb(data); } catch (e) {} });
      break;

    case 'saved':
      savedCallbacks.forEach(cb => { try { cb(data); } catch (e) {} });
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
        chatCallbacks.forEach(cb => cb(data.playerId, data.name, data.text, !!data.bot));
      }
      break;
  }
}

function sendState(x, y, vx, vy, face, swing) {
  if (!connected || !ws) return;
  
  const now = Date.now();
  if (now - lastStateSent < BT_CONFIG.syncRate) return;
  const msg = {
    type: 'state',
    x: Math.round(x),
    y: Math.round(y),
    vx: Math.round(vx),
    vy: Math.round(vy),
    face,
    swing: swing > 0 ? 1 : 0,
    level: (RPG.getProfile() || {}).level || 1
  };
  // Standing still: skip identical frames, heartbeat every 2 s. Every incoming WebSocket
  // message is a billed Durable Object request, so this is most of the server cost.
  const key = msg.x + ',' + msg.y + ',' + msg.face + ',' + msg.swing + ',' + msg.level;
  if (key === lastStateKey && now - lastStateSent < 2000) return;
  lastStateKey = key;
  lastStateSent = now;
  ws.send(JSON.stringify(msg));
}

function sendDig(x, y) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'dig', x, y }));
}

function sendEvent(event) {
  if (!connected || !ws || !event) return;
  ws.send(JSON.stringify({ type: 'event', ...event }));
}

// Autosave over the socket. Push the current position first so the room's copy is fresh.
function sendSave(snapshot) {
  if (!connected || !ws || !snapshot) return false;
  try {
    ws.send(JSON.stringify({ type: 'state', x: Math.round(snapshot.x), y: Math.round(snapshot.y), vx: 0, vy: 0, face: 1, swing: 0, level: (RPG.getProfile() || {}).level || 1 }));
    lastStateSent = Date.now();
    ws.send(JSON.stringify({ type: 'save', snapshot }));
    return true;
  } catch (e) { return false; }
}

function setRoom(name) { roomOverride = name || null; }
function onSaved(cb) { savedCallbacks.push(cb); }
const pulseCallbacks = [], p9Callbacks = [];
function onPulse(cb) { pulseCallbacks.push(cb); }
function onP9(cb) { p9Callbacks.push(cb); }

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

// A tab whose connection was replaced by a newer one reconnects when it is used again.
function resumeIfReplaced() {
  if (!replacedSock || document.visibilityState === 'hidden') return;
  replacedSock = false;
  const profile = typeof RPG !== 'undefined' && RPG.getProfile();
  if (profile) { reconnectAttempts = 0; connect(profile); }
}
document.addEventListener('visibilitychange', resumeIfReplaced);
window.addEventListener('pointerdown', resumeIfReplaced, true);
window.addEventListener('keydown', resumeIfReplaced, true);

window.Multiplayer = {
  connect,
  disconnect,
  sendState,
  sendDig,
  sendEvent,
  sendChat,
  sendSave,
  setRoom,
  get room() { return roomOverride || 'main'; },
  onSaved,
  onPulse,
  onP9,
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
  get recruitCount() { return recruitCount; },
  get sector() { return sector; },
  get roster() { return roster; },
  get worldSeed() { return worldSeed; },
  get dugBlocks() { return dugBlocks; }
};
})();
