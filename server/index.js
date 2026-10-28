// Base Trenches Multiplayer Server
// Cloudflare Worker with Durable Objects for real-time multiplayer + RPG progression

const CORS_ORIGINS = [
  'https://base-trenches.pages.dev',
  'https://kuzikuu.github.io',
  'http://localhost:8080',
  'http://localhost:9999'
];

const FARCASTER_QUICK_AUTH_ISSUER = 'https://auth.farcaster.xyz';
// Quick Auth tokens are issued with aud = the mini app's domain (not the API host)
const QUICK_AUTH_AUDIENCES = ['base-trenches.pages.dev', 'kuzikuu.github.io'];
const GUEST_ID_RE = /^guest:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PLAYERS_PER_ROOM = 50;
// Name of the single Profiles DO instance. Bump to start a fresh leaderboard season.
const PROFILES_SHARD = 'season-1';
const BROADCAST_INTERVAL_MS = 100; // 10Hz
const XP_RATE_LIMIT_WINDOW_MS = 1000;
const XP_MAX_PER_WINDOW = 50;
const CHAT_RATE_LIMIT_MS = 2000;
const CHAT_MAX_LENGTH = 60;

const PROFANITY_WORDS = ['fuck', 'shit', 'ass', 'bitch', 'damn', 'cunt', 'dick', 'cock', 'pussy', 'fag', 'nigger', 'retard'];

function filterProfanity(text) {
  let filtered = text;
  for (const word of PROFANITY_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi'); // word boundaries so "pass"/"Bass" survive
    filtered = filtered.replace(regex, '*'.repeat(word.length));
  }
  return filtered;
}

function corsHeaders(origin) {
  const allowed = CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Guest-Secret',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

// Level curve: XP needed for level N
function xpForLevel(level) {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

function levelFromXp(xp) {
  let level = 1;
  let totalXp = 0;
  while (totalXp + xpForLevel(level) <= xp) {
    totalXp += xpForLevel(level);
    level++;
  }
  return level;
}

// Gear definitions
const GEAR_TYPES = ['pickaxe', 'helmet', 'boots', 'charm'];
const GEAR_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const GEAR_TEMPLATES = {
  pickaxe: [
    { name: 'Rusty Pick', rarity: 0, digSpeed: 1.0 },
    { name: 'Iron Pick', rarity: 1, digSpeed: 1.15 },
    { name: 'Steel Pick', rarity: 2, digSpeed: 1.3 },
    { name: 'Diamond Pick', rarity: 3, digSpeed: 1.5 },
    { name: 'Trencher\'s Fury', rarity: 4, digSpeed: 1.8 }
  ],
  helmet: [
    { name: 'Cloth Cap', rarity: 0, protection: 0 },
    { name: 'Tin Helmet', rarity: 1, protection: 1 },
    { name: 'Steel Helmet', rarity: 2, protection: 2 },
    { name: 'Reinforced Helm', rarity: 3, protection: 3 },
    { name: 'Diamond Dome', rarity: 4, protection: 4 }
  ],
  boots: [
    { name: 'Worn Boots', rarity: 0, moveSpeed: 1.0 },
    { name: 'Leather Boots', rarity: 1, moveSpeed: 1.1 },
    { name: 'Runner\'s Boots', rarity: 2, moveSpeed: 1.2 },
    { name: 'Swift Treads', rarity: 3, moveSpeed: 1.35 },
    { name: 'Windwalkers', rarity: 4, moveSpeed: 1.5 }
  ],
  charm: [
    { name: 'Lucky Penny', rarity: 0, luck: 1.0 },
    { name: 'Four-Leaf Clover', rarity: 1, luck: 1.1 },
    { name: 'Rabbit\'s Foot', rarity: 2, luck: 1.25 },
    { name: 'Golden Horseshoe', rarity: 3, luck: 1.4 },
    { name: 'Star of Fortune', rarity: 4, luck: 1.6 }
  ]
};

function generateGearDrop(depth) {
  const type = GEAR_TYPES[Math.floor(Math.random() * GEAR_TYPES.length)];
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

// ============================================
// TrenchRoom Durable Object - Real-time multiplayer
// ============================================
export class TrenchRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // WebSocket -> player data
    this.lastBroadcast = 0;
    this.dugBlocks = new Map(); // "x,y" -> timestamp
    this.seed = null; // shared world seed so every client generates the same trench
    this.state.blockConcurrencyWhile(async () => {
      this.seed = await this.state.storage.get('seed');
      if (!this.seed) {
        this.seed = (Math.random() * 1e9) | 0;
        await this.state.storage.put('seed', this.seed);
      }
    });
    
    // Use WebSocket Hibernation API
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (request.headers.get('Upgrade') === 'websocket') {
      if (this.state.getWebSockets().length >= MAX_PLAYERS_PER_ROOM) {
        return new Response('Room full', { status: 503 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      // Accept with hibernation
      this.state.acceptWebSocket(server);
      
      // Initialize session data
      const sessionId = crypto.randomUUID();
      // Profile id verified by the Worker (Quick Auth token or guest secret); null if unverified
      const verifiedProfileId = request.headers.get('X-BT-Profile') || null;
      server.serializeAttachment({ sessionId, verifiedProfileId, joined: Date.now() });
      
      return new Response(null, { status: 101, webSocket: client });
    }
    
    return new Response('Expected WebSocket', { status: 400 });
  }

  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      const attachment = ws.deserializeAttachment() || {};
      
      switch (data.type) {
        case 'join':
          await this.handleJoin(ws, data, attachment);
          break;
        case 'state':
          await this.handleStateUpdate(ws, data, attachment);
          break;
        case 'dig':
          await this.handleDig(ws, data, attachment);
          break;
        case 'chat':
          await this.handleChat(ws, data, attachment);
          break;
        case 'xp':
          await this.handleXpClaim(ws, data, attachment);
          break;
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  }

  async webSocketClose(ws, code, reason) {
    const attachment = ws.deserializeAttachment() || {};
    try { ws.close(code === 1005 ? 1000 : code, reason); } catch (e) {}
    if (attachment.playerId) {
      const playerCount = this.getActivePlayers(ws).length;
      this.broadcast({ type: 'leave', playerId: attachment.playerId, playerCount }, ws);
    }
  }

  async webSocketError(ws, error) {
    console.error('WebSocket error:', error);
  }

  async handleJoin(ws, data, attachment) {
    if (attachment.playerId) return; // already joined
    // Room identity is always the server-issued session id (unique per socket, can't be spoofed)
    const playerId = attachment.sessionId;
    attachment.playerId = playerId;
    attachment.name = filterProfanity(String(data.name || 'Trencher').slice(0, 20));
    attachment.pfp = typeof data.pfp === 'string' && /^https:\/\//.test(data.pfp) ? data.pfp.slice(0, 512) : null;
    attachment.level = Math.max(1, Math.min(999, Math.floor(Number(data.level)) || 1));
    attachment.equipped = data.equipped || {};
    attachment.lastUpdate = Date.now();
    attachment.lastXpClaim = 0;
    attachment.xpThisWindow = 0;
    attachment.lastChat = 0;
    
    ws.serializeAttachment(attachment);
    
    // Send current state to new player
    const players = this.getActivePlayers();
    ws.send(JSON.stringify({
      type: 'init',
      playerId,
      seed: this.seed,
      players,
      dugBlocks: Array.from(this.dugBlocks.entries()).slice(-500),
      playerCount: players.length
    }));
    
    // Broadcast join to others
    this.broadcast({ type: 'join', playerId, name: attachment.name, pfp: attachment.pfp, level: attachment.level, playerCount: players.length }, ws);
  }

  async handleStateUpdate(ws, data, attachment) {
    if (!attachment.playerId) return;
    
    const now = Date.now();
    if (now - attachment.lastUpdate < 50) return; // Throttle to 20Hz max
    
    const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
    attachment.x = num(data.x);
    attachment.y = num(data.y);
    attachment.vx = num(data.vx);
    attachment.vy = num(data.vy);
    attachment.face = data.face < 0 ? -1 : 1;
    attachment.swing = data.swing ? 1 : 0;
    if (data.level !== undefined) attachment.level = Math.max(1, Math.min(999, Math.floor(Number(data.level)) || 1));
    attachment.lastUpdate = now;
    
    ws.serializeAttachment(attachment);
    
    // Broadcast at 10Hz
    if (now - this.lastBroadcast >= BROADCAST_INTERVAL_MS) {
      this.lastBroadcast = now;
      this.broadcastStates();
    }
  }

  async handleDig(ws, data, attachment) {
    if (!attachment.playerId) return;
    
    const bx = Math.floor(Number(data.x)), by = Math.floor(Number(data.y));
    if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
    const key = `${bx},${by}`;
    this.dugBlocks.set(key, Date.now());
    
    // Clean old dug blocks (older than 5 minutes)
    const cutoff = Date.now() - 300000;
    for (const [k, t] of this.dugBlocks) {
      if (t < cutoff) this.dugBlocks.delete(k);
    }
    
    this.broadcast({ type: 'dig', playerId: attachment.playerId, x: bx, y: by });
  }

  async handleChat(ws, data, attachment) {
    if (!attachment.playerId) return;
    
    const now = Date.now();
    if (now - attachment.lastChat < CHAT_RATE_LIMIT_MS) return;
    
    let text = String(data.text || '').slice(0, CHAT_MAX_LENGTH).trim();
    if (!text) return;
    text = filterProfanity(text);
    
    attachment.lastChat = now;
    ws.serializeAttachment(attachment);
    
    this.broadcast({ type: 'chat', playerId: attachment.playerId, text, name: attachment.name });
  }

  async handleXpClaim(ws, data, attachment) {
    if (!attachment.playerId) return;
    
    const now = Date.now();
    const xp = Math.min(Math.max(0, Math.floor(Number(data.xp)) || 0), 20); // Cap single claim at 20
    if (!xp) return;
    
    // Rate limiting
    if (now - attachment.lastXpClaim > XP_RATE_LIMIT_WINDOW_MS) {
      attachment.lastXpClaim = now;
      attachment.xpThisWindow = 0;
    }
    
    if (attachment.xpThisWindow + xp > XP_MAX_PER_WINDOW) {
      return; // Over rate limit
    }
    
    attachment.xpThisWindow += xp;
    ws.serializeAttachment(attachment);
    
    // Only credit the profile the Worker verified at connect time (ignore client-supplied profileId)
    const profileId = attachment.verifiedProfileId;
    if (profileId) {
      const profilesId = this.env.PROFILES.idFromName(PROFILES_SHARD);
      const profiles = this.env.PROFILES.get(profilesId);
      const res = await profiles.fetch(new Request('http://internal/add-xp', {
        method: 'POST',
        body: JSON.stringify({ profileId, xp, depth: Math.max(0, Math.floor(Number(data.depth)) || 0) })
      }));
      const result = await res.json().catch(() => null);
      if (result && result.success) {
        try { ws.send(JSON.stringify({ type: 'xp', ...result })); } catch (e) {}
      }
    }
  }

  getActivePlayers(excludeWs = null) {
    const players = [];
    const webSockets = this.state.getWebSockets();
    
    for (const ws of webSockets) {
      if (ws === excludeWs) continue;
      const attachment = ws.deserializeAttachment();
      if (attachment && attachment.playerId) {
        players.push({
          id: attachment.playerId,
          name: attachment.name,
          pfp: attachment.pfp,
          level: attachment.level,
          x: attachment.x,
          y: attachment.y,
          vx: attachment.vx,
          vy: attachment.vy,
          face: attachment.face,
          swing: attachment.swing
        });
      }
    }
    
    return players;
  }

  broadcastStates() {
    const players = this.getActivePlayers();
    const message = JSON.stringify({ type: 'states', players, playerCount: players.length });
    this.broadcast(message, null, true);
  }

  broadcast(data, excludeWs = null, isString = false) {
    const message = isString ? data : JSON.stringify(data);
    const webSockets = this.state.getWebSockets();
    
    for (const ws of webSockets) {
      if (ws !== excludeWs) {
        try {
          ws.send(message);
        } catch (e) {
          // Socket might be closed
        }
      }
    }
  }
}

// ============================================
// Profiles Durable Object - Player data storage
// ============================================
export class Profiles {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    
    // Initialize SQLite schema
    this.state.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY,
          fid INTEGER,
          name TEXT,
          pfp TEXT,
          level INTEGER DEFAULT 1,
          xp INTEGER DEFAULT 0,
          best_depth INTEGER DEFAULT 0,
          total_diamonds INTEGER DEFAULT 0,
          total_digs INTEGER DEFAULT 0,
          deaths INTEGER DEFAULT 0,
          play_time INTEGER DEFAULT 0,
          inventory TEXT DEFAULT '[]',
          equipped TEXT DEFAULT '{}',
          secret_hash TEXT,
          created_at INTEGER,
          updated_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_xp ON profiles(xp DESC);
        CREATE INDEX IF NOT EXISTS idx_depth ON profiles(best_depth DESC);
        CREATE INDEX IF NOT EXISTS idx_fid ON profiles(fid);
      `);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (path === '/check-guest' && request.method === 'POST') {
      const { id, secretHash } = await request.json();
      const rows = this.sql.exec('SELECT secret_hash FROM profiles WHERE id = ?', id).toArray();
      const ok = rows.length > 0 && !!rows[0].secret_hash && rows[0].secret_hash === secretHash;
      return Response.json({ ok });
    }

    if (path === '/add-xp' && request.method === 'POST') {
      const { profileId, xp, depth } = await request.json();
      return this.addXp(profileId, xp, depth);
    }
    
    if (path === '/profile') {
      if (request.method === 'GET') {
        const id = url.searchParams.get('id');
        return this.getProfile(id);
      }
      if (request.method === 'POST') {
        const data = await request.json();
        return this.saveProfile(data);
      }
    }
    
    if (path === '/leaderboard') {
      const type = url.searchParams.get('type') || 'xp';
      return this.getLeaderboard(type);
    }
    
    return new Response('Not found', { status: 404 });
  }

  async getProfile(id) {
    const results = this.sql.exec('SELECT * FROM profiles WHERE id = ?', id).toArray();
    if (results.length === 0) {
      return new Response(JSON.stringify({ exists: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { secret_hash, ...row } = results[0];
    const profile = {
      ...row,
      inventory: JSON.parse(row.inventory || '[]'),
      equipped: JSON.parse(row.equipped || '{}')
    };
    
    return new Response(JSON.stringify({ exists: true, profile }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async saveProfile(data) {
    const now = Date.now();
    const existing = this.sql.exec('SELECT id, secret_hash FROM profiles WHERE id = ?', data.id).toArray();
    
    // Guest profiles are owned by whoever first saved them with a secret
    if (data.id.startsWith('guest:')) {
      if (!data.secretHash) {
        return Response.json({ success: false, error: 'Guest secret required' }, { status: 401 });
      }
      if (existing.length > 0 && existing[0].secret_hash && existing[0].secret_hash !== data.secretHash) {
        return Response.json({ success: false, error: 'Not your profile' }, { status: 403 });
      }
    }
    
    if (existing.length > 0) {
      this.sql.exec(`
        UPDATE profiles SET
          name = ?, pfp = ?, level = ?, xp = ?, best_depth = ?,
          total_diamonds = ?, total_digs = ?, deaths = ?, play_time = ?,
          inventory = ?, equipped = ?, secret_hash = COALESCE(secret_hash, ?), updated_at = ?
        WHERE id = ?
      `,
        data.name, data.pfp, data.level, data.xp, data.best_depth,
        data.total_diamonds || 0, data.total_digs || 0, data.deaths || 0, data.play_time || 0,
        JSON.stringify(data.inventory || []), JSON.stringify(data.equipped || {}),
        data.secretHash || null, now, data.id
      );
    } else {
      this.sql.exec(`
        INSERT INTO profiles (id, fid, name, pfp, level, xp, best_depth, total_diamonds, total_digs, deaths, play_time, inventory, equipped, secret_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        data.id, data.fid || null, data.name, data.pfp,
        data.level || 1, data.xp || 0, data.best_depth || 0,
        data.total_diamonds || 0, data.total_digs || 0, data.deaths || 0, data.play_time || 0,
        JSON.stringify(data.inventory || []), JSON.stringify(data.equipped || {}),
        data.secretHash || null, now, now
      );
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async addXp(profileId, xp, depth) {
    const results = this.sql.exec('SELECT xp, best_depth, level FROM profiles WHERE id = ?', profileId).toArray();
    if (results.length === 0) {
      return new Response(JSON.stringify({ success: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const row = results[0];
    const newXp = (row.xp || 0) + xp;
    const newLevel = levelFromXp(newXp);
    const newBestDepth = Math.max(row.best_depth || 0, depth || 0);
    
    this.sql.exec(`
      UPDATE profiles SET xp = ?, level = ?, best_depth = ?, updated_at = ? WHERE id = ?
    `, newXp, newLevel, newBestDepth, Date.now(), profileId);
    
    // Check for gear drop
    let gearDrop = null;
    if (Math.random() < 0.02 && depth > 10) { // 2% chance per XP claim if deep enough
      gearDrop = generateGearDrop(depth);
      const currentArr = this.sql.exec('SELECT inventory FROM profiles WHERE id = ?', profileId).toArray();
      if (currentArr.length > 0) {
        const inventory = JSON.parse(currentArr[0].inventory || '[]');
        inventory.push(gearDrop);
        this.sql.exec('UPDATE profiles SET inventory = ? WHERE id = ?', JSON.stringify(inventory), profileId);
      }
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      newXp, 
      newLevel, 
      leveledUp: newLevel > row.level,
      gearDrop 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getLeaderboard(type) {
    const orderBy = type === 'depth' ? 'best_depth' : 'xp';
    const rows = this.sql.exec(`
      SELECT id, name, pfp, level, xp, best_depth FROM profiles
      ORDER BY ${orderBy} DESC LIMIT 50
    `).toArray();
    
    return new Response(JSON.stringify({ leaderboard: rows }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// Main Worker - HTTP routing
// ============================================
export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e) {
      // Always return CORS headers so browsers surface the real error instead of a CORS failure
      console.error('Unhandled error:', e && e.stack || e);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request.headers.get('Origin') || '') }
      });
    }
  }
};

async function handleRequest(request, env, ctx) {
  {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    
    // Health check
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', time: Date.now() }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }
    
    // WebSocket connection to TrenchRoom
    if (url.pathname === '/api/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426, headers: corsHeaders(origin) });
      }
      const roomName = (url.searchParams.get('room') || 'main').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'main';
      const roomId = env.TRENCH_ROOM.idFromName(roomName);
      const room = env.TRENCH_ROOM.get(roomId);
      
      // Verify which profile this socket may credit XP to (browsers can't set WS headers, so use query params)
      let verifiedProfileId = null;
      const token = url.searchParams.get('token');
      const guestId = url.searchParams.get('profileId');
      const guestSecret = url.searchParams.get('secret');
      if (token) {
        const fid = await verifyFarcasterToken(token);
        if (fid) verifiedProfileId = `fid:${fid}`;
      } else if (guestId && guestSecret && GUEST_ID_RE.test(guestId)) {
        const profiles = env.PROFILES.get(env.PROFILES.idFromName(PROFILES_SHARD));
        const res = await profiles.fetch(new Request('http://internal/check-guest', {
          method: 'POST',
          body: JSON.stringify({ id: guestId, secretHash: await sha256Hex(guestSecret) })
        }));
        if ((await res.json()).ok) verifiedProfileId = guestId;
      }
      const headers = new Headers(request.headers);
      headers.delete('X-BT-Profile');
      if (verifiedProfileId) headers.set('X-BT-Profile', verifiedProfileId);
      return room.fetch(new Request(request, { headers }));
    }
    
    // Profile endpoints
    if (url.pathname === '/api/profile') {
      const profilesId = env.PROFILES.idFromName(PROFILES_SHARD);
      const profiles = env.PROFILES.get(profilesId);
      
      // Verify Farcaster auth if provided
      const authHeader = request.headers.get('Authorization');
      let verifiedFid = null;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        verifiedFid = await verifyFarcasterToken(token);
      }
      
      if (request.method === 'POST') {
        const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
          status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
        let data;
        try { data = await request.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400); }
        if (!data || typeof data.id !== 'string') return json({ error: 'Missing id' }, 400);
        
        if (data.id.startsWith('fid:')) {
          // Farcaster profiles require a valid Quick Auth token for the same FID
          if (!verifiedFid) return json({ error: 'Auth required' }, 401);
          if (data.id !== `fid:${verifiedFid}`) return json({ error: 'FID mismatch' }, 403);
          data.fid = Number(verifiedFid);
          delete data.secretHash;
        } else if (GUEST_ID_RE.test(data.id)) {
          const secret = request.headers.get('X-Guest-Secret');
          if (!secret || secret.length < 16) return json({ error: 'Guest secret required' }, 401);
          data.fid = null;
          data.secretHash = await sha256Hex(secret);
        } else {
          return json({ error: 'Invalid profile id' }, 400);
        }
        data.name = filterProfanity(String(data.name || 'Trencher').slice(0, 20));
        data.pfp = typeof data.pfp === 'string' && /^https:\/\//.test(data.pfp) ? data.pfp.slice(0, 512) : null;
        
        const response = await profiles.fetch(new Request('http://internal/profile', {
          method: 'POST',
          body: JSON.stringify(data)
        }));
        return json(await response.json(), response.status);
      }

      // GET profile
      const id = url.searchParams.get('id') || '';
      const response = await profiles.fetch(new Request(`http://internal/profile?id=${encodeURIComponent(id)}`));
      const result = await response.json();
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }
    
    // Leaderboard
    if (url.pathname === '/api/leaderboard') {
      const type = url.searchParams.get('type') === 'depth' ? 'depth' : 'xp';
      const profilesId = env.PROFILES.idFromName(PROFILES_SHARD);
      const profiles = env.PROFILES.get(profilesId);
      
      const response = await profiles.fetch(new Request(`http://internal/leaderboard?type=${type}`));
      const result = await response.json();
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }
    
    return new Response('Not found', { 
      status: 404, 
      headers: corsHeaders(origin) 
    });
  }
}

function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function b64urlToJson(str) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

let jwksCache = null;
let jwksCachedAt = 0;
async function getJwks() {
  if (jwksCache && Date.now() - jwksCachedAt < 3600_000) return jwksCache;
  const res = await fetch(`${FARCASTER_QUICK_AUTH_ISSUER}/.well-known/jwks.json`);
  if (!res.ok) throw new Error('JWKS fetch failed: ' + res.status);
  jwksCache = await res.json();
  jwksCachedAt = Date.now();
  return jwksCache;
}

// Verify Farcaster Quick Auth JWT (RS256, iss=https://auth.farcaster.xyz, sub=fid, aud=mini app domain)
async function verifyFarcasterToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const header = b64urlToJson(headerB64);
    if (header.alg !== 'RS256') return null;
    
    const jwks = await getJwks();
    const key = jwks.keys.find(k => k.kid === header.kid);
    if (!key) return null;
    
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', cryptoKey, b64urlToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) return null;
    
    const payload = b64urlToJson(payloadB64);
    const now = Date.now() / 1000;
    if (!payload.exp || payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now + 60) return null;
    if (payload.iss !== FARCASTER_QUICK_AUTH_ISSUER) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.some(a => QUICK_AUTH_AUDIENCES.includes(a))) return null;
    
    const fid = Number(payload.sub);
    return Number.isSafeInteger(fid) && fid > 0 ? fid : null;
  } catch (e) {
    console.error('Token verification error:', e);
    return null;
  }
}
