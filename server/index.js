// Base Trenches Multiplayer Server
// Cloudflare Worker with Durable Objects for real-time multiplayer + RPG progression

const CORS_ORIGINS = [
  'https://base-trenches.pages.dev',
  'https://kuzikuu.github.io',
  'http://localhost:8080',
  'http://localhost:9999'
];

const FARCASTER_QUICK_AUTH_ISSUER = 'https://auth.farcaster.xyz';
const MAX_PLAYERS_PER_ROOM = 50;
const BROADCAST_INTERVAL_MS = 100; // 10Hz
const XP_RATE_LIMIT_WINDOW_MS = 1000;
const XP_MAX_PER_WINDOW = 50;
const CHAT_RATE_LIMIT_MS = 2000;
const CHAT_MAX_LENGTH = 60;

const PROFANITY_WORDS = ['fuck', 'shit', 'ass', 'bitch', 'damn', 'cunt', 'dick', 'cock', 'pussy', 'fag', 'nigger', 'retard'];

function filterProfanity(text) {
  let filtered = text;
  for (const word of PROFANITY_WORDS) {
    const regex = new RegExp(word, 'gi');
    filtered = filtered.replace(regex, '*'.repeat(word.length));
  }
  return filtered;
}

function corsHeaders(origin) {
  const allowed = CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
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
    
    // Use WebSocket Hibernation API
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      // Accept with hibernation
      this.state.acceptWebSocket(server);
      
      // Initialize session data
      const sessionId = crypto.randomUUID();
      server.serializeAttachment({ sessionId, joined: Date.now() });
      
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
    if (attachment.playerId) {
      this.broadcast({ type: 'leave', playerId: attachment.playerId });
    }
  }

  async webSocketError(ws, error) {
    console.error('WebSocket error:', error);
  }

  async handleJoin(ws, data, attachment) {
    const playerId = data.playerId || attachment.sessionId;
    attachment.playerId = playerId;
    attachment.name = data.name || 'Trencher';
    attachment.pfp = data.pfp || null;
    attachment.level = data.level || 1;
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
      players,
      dugBlocks: Array.from(this.dugBlocks.entries()).slice(-500),
      playerCount: players.length
    }));
    
    // Broadcast join to others
    this.broadcast({ type: 'join', playerId, name: attachment.name, pfp: attachment.pfp, level: attachment.level }, ws);
  }

  async handleStateUpdate(ws, data, attachment) {
    if (!attachment.playerId) return;
    
    const now = Date.now();
    if (now - attachment.lastUpdate < 50) return; // Throttle to 20Hz max
    
    attachment.x = data.x;
    attachment.y = data.y;
    attachment.vx = data.vx;
    attachment.vy = data.vy;
    attachment.face = data.face;
    attachment.swing = data.swing;
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
    
    const key = `${data.x},${data.y}`;
    this.dugBlocks.set(key, Date.now());
    
    // Clean old dug blocks (older than 5 minutes)
    const cutoff = Date.now() - 300000;
    for (const [k, t] of this.dugBlocks) {
      if (t < cutoff) this.dugBlocks.delete(k);
    }
    
    this.broadcast({ type: 'dig', playerId: attachment.playerId, x: data.x, y: data.y });
  }

  async handleChat(ws, data, attachment) {
    if (!attachment.playerId) return;
    
    const now = Date.now();
    if (now - attachment.lastChat < CHAT_RATE_LIMIT_MS) return;
    
    let text = String(data.text || '').slice(0, CHAT_MAX_LENGTH);
    text = filterProfanity(text);
    
    attachment.lastChat = now;
    ws.serializeAttachment(attachment);
    
    this.broadcast({ type: 'chat', playerId: attachment.playerId, text, name: attachment.name });
  }

  async handleXpClaim(ws, data, attachment) {
    if (!attachment.playerId) return;
    
    const now = Date.now();
    const xp = Math.min(Math.max(0, Math.floor(data.xp)), 20); // Cap single claim at 20
    
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
    
    // Notify the Profiles DO to record XP
    if (data.profileId) {
      const profilesId = this.env.PROFILES.idFromName('global');
      const profiles = this.env.PROFILES.get(profilesId);
      await profiles.fetch(new Request('http://internal/add-xp', {
        method: 'POST',
        body: JSON.stringify({ profileId: data.profileId, xp, depth: data.depth })
      }));
    }
  }

  getActivePlayers() {
    const players = [];
    const webSockets = this.state.getWebSockets();
    
    for (const ws of webSockets) {
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
    
    const row = results[0];
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
    const existing = this.sql.exec('SELECT id FROM profiles WHERE id = ?', data.id).toArray();
    
    if (existing.length > 0) {
      this.sql.exec(`
        UPDATE profiles SET
          name = ?, pfp = ?, level = ?, xp = ?, best_depth = ?,
          total_diamonds = ?, total_digs = ?, deaths = ?, play_time = ?,
          inventory = ?, equipped = ?, updated_at = ?
        WHERE id = ?
      `,
        data.name, data.pfp, data.level, data.xp, data.best_depth,
        data.total_diamonds || 0, data.total_digs || 0, data.deaths || 0, data.play_time || 0,
        JSON.stringify(data.inventory || []), JSON.stringify(data.equipped || {}),
        now, data.id
      );
    } else {
      this.sql.exec(`
        INSERT INTO profiles (id, fid, name, pfp, level, xp, best_depth, total_diamonds, total_digs, deaths, play_time, inventory, equipped, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        data.id, data.fid || null, data.name, data.pfp,
        data.level || 1, data.xp || 0, data.best_depth || 0,
        data.total_diamonds || 0, data.total_digs || 0, data.deaths || 0, data.play_time || 0,
        JSON.stringify(data.inventory || []), JSON.stringify(data.equipped || {}),
        now, now
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
    const newXp = row.xp + xp;
    const newLevel = levelFromXp(newXp);
    const newBestDepth = Math.max(row.best_depth, depth || 0);
    
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
      // Pick a room based on some criteria (could be random, geographic, etc.)
      const roomName = url.searchParams.get('room') || 'main';
      const roomId = env.TRENCH_ROOM.idFromName(roomName);
      const room = env.TRENCH_ROOM.get(roomId);
      return room.fetch(request);
    }
    
    // Profile endpoints
    if (url.pathname === '/api/profile') {
      const profilesId = env.PROFILES.idFromName('global');
      const profiles = env.PROFILES.get(profilesId);
      
      // Verify Farcaster auth if provided
      const authHeader = request.headers.get('Authorization');
      let verifiedFid = null;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        verifiedFid = await verifyFarcasterToken(token, url.hostname);
      }
      
      if (request.method === 'POST') {
        const data = await request.json();
        
        // If FID auth verified, ensure profile ID matches
        if (verifiedFid && data.fid && data.fid !== verifiedFid) {
          return new Response(JSON.stringify({ error: 'FID mismatch' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
          });
        }
        
        const response = await profiles.fetch(new Request('http://internal/profile', {
          method: 'POST',
          body: JSON.stringify(data)
        }));
        const result = await response.json();
        
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }
      
      // GET profile
      const id = url.searchParams.get('id');
      const response = await profiles.fetch(new Request(`http://internal/profile?id=${id}`));
      const result = await response.json();
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }
    
    // Leaderboard
    if (url.pathname === '/api/leaderboard') {
      const type = url.searchParams.get('type') || 'xp';
      const profilesId = env.PROFILES.idFromName('global');
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
};

// Verify Farcaster Quick Auth JWT
async function verifyFarcasterToken(token, audience) {
  try {
    // Decode JWT header to get kid
    const [headerB64] = token.split('.');
    const header = JSON.parse(atob(headerB64));
    
    // Fetch JWKS from Farcaster
    const jwksResponse = await fetch(`${FARCASTER_QUICK_AUTH_ISSUER}/.well-known/jwks.json`);
    const jwks = await jwksResponse.json();
    
    // Find matching key
    const key = jwks.keys.find(k => k.kid === header.kid);
    if (!key) return null;
    
    // Import key and verify
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const [, payloadB64, signatureB64] = token.split('.');
    const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, data);
    if (!valid) return null;
    
    // Decode and verify payload
    const payload = JSON.parse(atob(payloadB64));
    
    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    
    // Check audience
    if (payload.aud && payload.aud !== audience) return null;
    
    // Check issuer
    if (payload.iss !== FARCASTER_QUICK_AUTH_ISSUER) return null;
    
    return payload.fid;
  } catch (e) {
    console.error('Token verification error:', e);
    return null;
  }
}
