// Base Trenches Multiplayer Server
// Cloudflare Worker with Durable Objects: TrenchRoom, Profiles, Events

import {
  verifyFarcasterToken as verifyFcJwt,
  verifyPrivyToken as verifyPrivyJwt
} from './lib/jwt.js';
import {
  scoreValidatedEvent,
  createXpWindow,
  depthFromY,
  tileKey,
  TILE_SIZE,
  TRENCH_FLOOR_TILE,
  DEPTH_STEP_M,
  levelFromXp,
  SERVER_XP_KINDS,
  REWARD_WINDOW_MS,
  noteBossSpawn
} from './lib/xp.js';
import {
  normalizeProgress,
  noteStat,
  noteLevel,
  completeMission,
  campaignPublic,
  CHAPTERS
} from './lib/campaign.js';
import {
  handleEventsApi,
  authorizeAdmin,
} from './lib/events.js';
import {
  BOT_TICK_MS,
  BOT_CHAT_MIN_GAP_MS,
  ROLES,
  isBotId,
  targetRecruitCount,
  createRecruit,
  emoteReply,
  publicRecruit
} from './lib/recruits.js';
import { parseGeo, geoHeader, aggregateGeo } from './lib/geo.js';
import { levelForDepth, LEVEL_DEPTH_M, MAX_LEVEL, killXp, bossXp, bossBand, inBossZone, elevatorStops, validElevatorStop } from './lib/levels.js';
import { normalizeSkills, learn as learnSkill, validateSkills, skillPoints, spentPoints, RESPEC_COOLDOWN_MS } from './lib/skills.js';
import { sanitizeSave, sanitizeEquipped, normalizeMeta, noteCredit, emptyMeta, deathCheckpoint, elevatorStart, SAVE_MIN_GAP_MS } from './lib/save.js';

const CORS_ORIGINS = [
  'https://powerof9base.com',
  'https://www.powerof9base.com',
  'https://base-trenches.pages.dev',
  'https://kuzikuu.github.io',
  'http://localhost:8080',
  'http://localhost:9999'
];

const GUEST_ID_RE = /^guest:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRIVY_ID_RE = /^did:privy:[a-zA-Z0-9]+$/;
const MAX_PLAYERS_PER_ROOM = 50;
// Overflow sharding: when 'main' is full, new players land in main-2 … main-8 ("sectors").
const ROOM_SHARDS = 8;
// Sectors stay in the presence fan-out for 15 min after the last overflow join.
const SHARD_HINT_TTL_MS = 15 * 60 * 1000;
// Every open tab polls /presence; cache the merged answer per isolate so sharding
// does not multiply Durable Object requests.
const PRESENCE_CACHE_MS = 5000;
let presenceCache = null;
function shardName(i) { return i === 0 ? 'main' : `main-${i + 1}`; }
const PROFILES_SHARD = 'season-1';
const EVENTS_SHARD = 'calendar-1';
const BROADCAST_INTERVAL_MS = 100;
const CHAT_RATE_LIMIT_MS = 2000;
const CHAT_MAX_LENGTH = 60;
const IDLE_MS = 15_000;
const BOT_PAUSE_IDLE_MS = 60_000; // recruits freeze when every human has been idle this long
// Free-plan guard: estimated billed DO requests per room per UTC day (fetch = 1, incoming
// WebSocket message = 1/20). Past this, recruits switch off in that room until the next UTC day.
const BOT_DAILY_BUDGET_DEFAULT = 15_000;
const BOT_BUDGET_PERSIST_EVERY = 500; // units between storage writes of the counter
const SQUAD_MAX = 9;
const RAID_SURVIVES = 5; // boss raid = survive this many barrages in one session (js/campaign.js)

const PROFANITY_WORDS = ['fuck', 'shit', 'ass', 'bitch', 'damn', 'cunt', 'dick', 'cock', 'pussy', 'fag', 'nigger', 'retard'];

function filterProfanity(text) {
  let filtered = text;
  for (const word of PROFANITY_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filtered = filtered.replace(regex, '*'.repeat(word.length));
  }
  return filtered;
}

// Extra allowed origins from env (preview only: EXTRA_CORS_ORIGINS="https://a,https://b").
let EXTRA_ORIGINS = [];
function setExtraOrigins(env) {
  const raw = String((env && env.EXTRA_CORS_ORIGINS) || '');
  EXTRA_ORIGINS = raw ? raw.split(',').map(s => s.trim()).filter(o => /^https?:\/\/[a-z0-9.:-]+$/i.test(o)) : [];
}
// Levels 2+ are behind a switch: LEVELS_UNLOCKED="1" (preview) opens them; anything else = level 1 only.
export function levelsUnlocked(env) {
  return String((env && env.LEVELS_UNLOCKED) || '').trim() === '1';
}
// Preview-only test login so screenshots and smoke tests can save without a real Privy session.
// Needs BOTH flags, and never applies to the production worker (BT_ENV must be "preview").
export function previewTestAuth(env) {
  return !!env && String(env.PREVIEW_TEST_AUTH || '') === '1' && String(env.BT_ENV || '') === 'preview';
}
// Max depth (m) a single credited event can add to best_depth. Stops one spoofed position
// from jumping the record (and therefore the save / level gate) by hundreds of meters.
const MAX_DEPTH_GAIN_PER_CREDIT = 40;

function corsHeaders(origin) {
  const allowed = CORS_ORIGINS.includes(origin) || EXTRA_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Guest-Secret',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin || '') }
  });
}

const GEAR_TYPES = ['pickaxe', 'helmet', 'boots', 'charm'];
const GEAR_TEMPLATES = {
  pickaxe: [
    { name: 'Rusty Pick', rarity: 0, digSpeed: 1.0 },
    { name: 'Iron Pick', rarity: 1, digSpeed: 1.15 },
    { name: 'Steel Pick', rarity: 2, digSpeed: 1.3 },
    { name: 'Diamond Pick', rarity: 3, digSpeed: 1.5 },
    { name: "Trencher's Fury", rarity: 4, digSpeed: 1.8 }
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
    { name: "Runner's Boots", rarity: 2, moveSpeed: 1.2 },
    { name: 'Swift Treads', rarity: 3, moveSpeed: 1.35 },
    { name: 'Windwalkers', rarity: 4, moveSpeed: 1.5 }
  ],
  charm: [
    { name: 'Lucky Penny', rarity: 0, luck: 1.0 },
    { name: 'Four-Leaf Clover', rarity: 1, luck: 1.1 },
    { name: "Rabbit's Foot", rarity: 2, luck: 1.25 },
    { name: 'Golden Horseshoe', rarity: 3, luck: 1.4 },
    { name: 'Star of Fortune', rarity: 4, luck: 1.6 }
  ]
};

function generateGearDrop(depth) {
  const type = GEAR_TYPES[Math.floor(Math.random() * GEAR_TYPES.length)];
  const templates = GEAR_TEMPLATES[type];
  let rarityChances = [0.6, 0.25, 0.1, 0.04, 0.01];
  if (depth > 50) rarityChances = [0.4, 0.3, 0.2, 0.08, 0.02];
  if (depth > 100) rarityChances = [0.2, 0.3, 0.3, 0.15, 0.05];
  if (depth > 200) rarityChances = [0.1, 0.2, 0.35, 0.25, 0.1];
  const roll = Math.random();
  let cumulative = 0, rarityIndex = 0;
  for (let i = 0; i < rarityChances.length; i++) {
    cumulative += rarityChances[i];
    if (roll < cumulative) { rarityIndex = i; break; }
  }
  return { id: crypto.randomUUID(), type, ...templates[rarityIndex], foundAt: Date.now(), foundDepth: depth };
}

function sanitizeHandle(h) {
  const m = String(h || '').trim().match(/^@?([A-Za-z0-9_]{1,15})$/);
  return m ? '@' + m[1] : null;
}

function sanitizeWallet(w) {
  const m = String(w || '').trim().match(/^(0x[a-fA-F0-9]{40})$/);
  return m ? m[1] : null;
}

function validProfileId(id) {
  return typeof id === 'string' && (GUEST_ID_RE.test(id) || /^fid:\d+$/.test(id) || PRIVY_ID_RE.test(id));
}

function squadCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[(Math.random() * alphabet.length) | 0];
  return s;
}

// ============================================
// TrenchRoom Durable Object
// ============================================
export class TrenchRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.dugBlocks = new Map();
    // Per-session XP windows and recent digs live in memory, not in the WebSocket
    // attachment (attachments are size-capped and rewritten on every message).
    // Hibernation only happens when the room is idle, so losing them then is harmless.
    this.xpWindows = new Map();
    this.recentDigs = new Map();
    this.raidSurvives = new Map(); // sessionId -> barrages survived since the last boss raid
    this.bossSpawns = new Map();   // sessionId -> { band, t } last Sandmaw spawn the room saw
    this.bossSlain = new Map();    // sessionId -> Set(bands) already paid this session
    this.lastBroadcast = 0;
    this.seed = null;
    // NPC recruits live only in memory and only while at least one human is connected.
    this.bots = new Map();
    this.botSeq = 0;
    this.botTimer = null;
    this.lastBotTick = 0;
    this.botsOff = false;        // admin kill switch (storage 'botsOff'), per room
    this.budget = { day: '', units: 0, saved: 0 };
    this.roomName = null;
    this.state.blockConcurrencyWhile(async () => {
      const got = await this.state.storage.get(['botsOff', 'botBudget', 'roomName']);
      this.botsOff = got.get('botsOff') === true;
      this.budget = got.get('botBudget') || this.budget;
      this.roomName = got.get('roomName') || null;
      this.seed = await this.state.storage.get('seed');
      if (!this.seed) {
        this.seed = (Math.random() * 1e9) | 0;
        await this.state.storage.put('seed', this.seed);
      }
    });
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const roomHeader = request.headers.get('X-BT-Room');
    if (roomHeader && roomHeader !== this.roomName) {
      this.roomName = roomHeader;
      await this.state.storage.put('roomName', roomHeader); // survives hibernation
    }
    this.countUnits(1);
    if (url.pathname === '/bots') {
      // Internal only (the Worker checks the admin key before forwarding).
      if (request.method === 'POST') {
        const { enabled } = await request.json().catch(() => ({}));
        this.botsOff = enabled === false;
        await this.state.storage.put('botsOff', this.botsOff);
        if (this.botsOff) this.stopBots();
      }
      return Response.json(this.botStatus());
    }
    if (request.method === 'POST' && url.pathname === '/shard-hint') {
      // Only 'main' keeps this: the highest overflow sector used recently, so presence can sum them.
      const n = Math.max(1, Math.min(ROOM_SHARDS, Number(url.searchParams.get('n')) || 1));
      const cur = (await this.state.storage.get('shardHint')) || { n: 1, at: 0 };
      const fresh = Date.now() - cur.at < SHARD_HINT_TTL_MS;
      if (!fresh || n >= cur.n) await this.state.storage.put('shardHint', { n: Math.max(n, fresh ? cur.n : 1), at: Date.now() });
      return Response.json({ ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/shard-hint') {
      const cur = (await this.state.storage.get('shardHint')) || { n: 1, at: 0 };
      return Response.json({ n: Date.now() - cur.at < SHARD_HINT_TTL_MS ? cur.n : 1 });
    }
    if (request.headers.get('Upgrade') === 'websocket') {
      // ROOM_CAP lets the preview worker raise the cap for load tests; prod uses the constant.
      const cap = Math.max(1, Math.min(1000, Number(this.env && this.env.ROOM_CAP) || MAX_PLAYERS_PER_ROOM));
      if (this.state.getWebSockets().length >= cap) {
        return new Response('Room full', { status: 503 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      const sessionId = crypto.randomUUID();
      const verifiedProfileId = request.headers.get('X-BT-Profile') || null;
      // Country/continent only (from request.cf in the Worker). No IP or finer location is kept.
      const geo = parseGeo(request.headers.get('X-BT-Geo'));
      server.serializeAttachment({
        sessionId,
        verifiedProfileId,
        geo,
        joined: Date.now(),
        lastDepthAwarded: 0
      });
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === 'GET' && (url.pathname === '/presence' || url.pathname === '/')) {
      const body = this.presence();
      if (this.roomName === 'main') {
        const cur = (await this.state.storage.get('shardHint')) || { n: 1, at: 0 };
        body.shards = Date.now() - cur.at < SHARD_HINT_TTL_MS ? cur.n : 1;
      }
      return Response.json(body);
    }
    return new Response('Expected WebSocket', { status: 400 });
  }

  // Humans only. Recruits are reported separately and never counted as players.
  presence() {
    const now = Date.now();
    const players = this.getActivePlayers(null, now);
    const geo = aggregateGeo(this.humanGeos());
    return {
      online: players.length,
      recruits: this.bots.size,
      regions: geo.regions,
      countries: geo.countries,
      unknownRegion: geo.unknown,
      players: players.map(p => ({
        id: p.id,
        name: p.name,
        level: p.level,
        xHandle: p.xHandle || null,
        status: p.status
      }))
    };
  }

  humanGeos() {
    const out = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.playerId && !a.bot) out.push(a.geo || null);
    }
    return out;
  }

  humanCount(excludeWs = null) {
    let n = 0;
    for (const ws of this.state.getWebSockets()) {
      if (ws === excludeWs) continue;
      const a = ws.deserializeAttachment();
      if (a && a.playerId && !a.bot) n++;
    }
    return n;
  }

  // ---- NPC recruits -------------------------------------------------------
  // One setTimeout chain at BOT_TICK_MS. It stops as soon as no human is connected,
  // so an empty room has no timers and can hibernate. After hibernation the next
  // human message restarts it (ensureBotTicker in webSocketMessage / handleJoin).
  // ---- free-plan safeguards ----
  dayKey(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }

  countUnits(u, now = Date.now()) {
    const day = this.dayKey(now);
    if (this.budget.day !== day) this.budget = { day, units: 0, saved: 0 };
    this.budget.units += u;
    if (this.budget.units - this.budget.saved >= BOT_BUDGET_PERSIST_EVERY) {
      this.budget.saved = this.budget.units;
      this.state.storage.put('botBudget', this.budget).catch(() => {});
    }
  }

  botBudgetLimit() {
    const n = Number(this.env && this.env.BOT_DAILY_BUDGET);
    return Number.isFinite(n) && n > 0 ? n : BOT_DAILY_BUDGET_DEFAULT;
  }

  botsAllowed(now = Date.now()) {
    if (this.botsOff) return false;
    if (this.env && String(this.env.BOTS_ENABLED || '').trim() === '0') return false;
    // Recruits only in the public sectors (main, main-2 …), not in ad-hoc ?room= rooms.
    if (this.roomName && !/^main(-\d+)?$/.test(this.roomName)) return false;
    if (this.budget.day === this.dayKey(now) && this.budget.units >= this.botBudgetLimit()) return false;
    return true;
  }

  botStatus() {
    return { room: this.roomName, botsOff: this.botsOff, envDisabled: String((this.env && this.env.BOTS_ENABLED) || '').trim() === '0',
      allowed: this.botsAllowed(), recruits: this.bots.size, budget: { day: this.budget.day, units: Math.round(this.budget.units), limit: this.botBudgetLimit() } };
  }

  ensureBotTicker() {
    if (this.botTimer) return;
    if (!this.botsAllowed()) { if (this.bots.size) this.stopBots(); return; }
    this.botTimer = setTimeout(() => { this.botTimer = null; this.botTick(); }, BOT_TICK_MS);
  }

  stopBots(excludeWs = null) {
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }
    for (const id of this.bots.keys()) this.broadcast({ type: 'leave', playerId: id, bot: true, playerCount: this.humanCount(excludeWs), recruitCount: 0 }, excludeWs);
    this.bots.clear();
  }

  botTick(now = Date.now()) {
    const humans = this.humanCount();
    if (humans === 0 || !this.botsAllowed(now)) { this.stopBots(); return; }
    const dtMs = this.lastBotTick ? Math.min(3000, now - this.lastBotTick) : BOT_TICK_MS;
    this.lastBotTick = now;
    // Ramp one recruit per tick toward the target for this many humans.
    const target = targetRecruitCount(humans);
    if (this.bots.size < target) {
      const b = createRecruit(++this.botSeq, Math.random, now);
      this.bots.set(b.id, b);
      this.broadcast({ type: 'join', playerId: b.id, bot: true, role: b.role, name: b.name, pfp: null, level: b.level, xHandle: null, playerCount: humans, recruitCount: this.bots.size });
    } else if (this.bots.size > target) {
      const id = this.bots.keys().next().value;
      this.bots.delete(id);
      this.broadcast({ type: 'leave', playerId: id, bot: true, playerCount: humans, recruitCount: this.bots.size });
    }
    for (const b of this.bots.values()) {
      const role = ROLES[b.role] || ROLES.recruit;
      const effects = role.step(b, now, Math.random, { dtMs, recruits: this.bots.size });
      for (const e of effects) {
        if (e.type === 'chat' && now - (this.lastBotChat || 0) >= BOT_CHAT_MIN_GAP_MS) {
          this.lastBotChat = now;
          this.broadcast({ type: 'chat', playerId: b.id, bot: true, name: b.name, text: e.text });
        }
      }
    }
    // Human state updates already broadcast at up to 10 Hz; only push a frame if they went quiet.
    if (this.bots.size && now - this.lastBroadcast >= BOT_TICK_MS - 50) {
      this.lastBroadcast = now;
      this.broadcastStates(now);
    }
    // If every human has gone idle (background tab, AFK), pause the ticker so the DO can
    // hibernate; the next human message restarts it.
    if (this.lastHumanActivity() < now - BOT_PAUSE_IDLE_MS) return;
    this.ensureBotTicker();
  }

  lastHumanActivity() {
    let t = 0;
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.playerId && !a.bot) t = Math.max(t, a.lastUpdate || a.joined || 0);
    }
    return t;
  }

  maybeBotEmoteReply(text) {
    if (!this.bots.size) return;
    const reply = emoteReply(text);
    if (!reply) return;
    const list = [...this.bots.values()];
    const b = list[(Math.random() * list.length) | 0];
    setTimeout(() => {
      if (!this.bots.has(b.id)) return;
      this.lastBotChat = Date.now();
      this.broadcast({ type: 'chat', playerId: b.id, bot: true, name: b.name, text: reply });
    }, 900 + Math.random() * 1800);
  }

  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      const attachment = ws.deserializeAttachment() || {};
      this.countUnits(1 / 20);
      if (attachment.playerId) this.ensureBotTicker();
      switch (data.type) {
        case 'join': await this.handleJoin(ws, data, attachment); break;
        case 'state': await this.handleStateUpdate(ws, data, attachment); break;
        case 'dig': await this.handleDig(ws, data, attachment); break;
        case 'chat': await this.handleChat(ws, data, attachment); break;
        case 'event': await this.handleGameEvent(ws, data, attachment); break;
        case 'save': await this.handleSave(ws, data, attachment); break;
        case 'xp':
          // Client XP amounts are ignored. Progression is event-scored.
          break;
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  }

  async webSocketClose(ws, code, reason) {
    const attachment = ws.deserializeAttachment() || {};
    if (attachment.sessionId) { this.xpWindows.delete(attachment.sessionId); this.raidSurvives.delete(attachment.sessionId); this.bossSpawns.delete(attachment.sessionId); this.bossSlain.delete(attachment.sessionId); }
    try { ws.close(code === 1005 ? 1000 : code, reason); } catch (e) {}
    if (attachment.playerId) {
      const playerCount = this.getActivePlayers(ws).length;
      this.broadcast({ type: 'leave', playerId: attachment.playerId, playerCount }, ws);
      if (this.humanCount(ws) === 0) this.stopBots(ws);
    }
  }

  async webSocketError(ws, error) {
    console.error('WebSocket error:', error);
  }

  async handleJoin(ws, data, attachment) {
    if (attachment.playerId) return;
    const playerId = attachment.sessionId;
    attachment.playerId = playerId;
    attachment.name = filterProfanity(String(data.name || 'Trencher').slice(0, 20));
    attachment.pfp = typeof data.pfp === 'string' && /^https:\/\//.test(data.pfp) ? data.pfp.slice(0, 512) : null;
    attachment.level = Math.max(1, Math.min(999, Math.floor(Number(data.level)) || 1));
    attachment.equipped = data.equipped && typeof data.equipped === 'object' && JSON.stringify(data.equipped).length < 2048 ? data.equipped : {};
    attachment.xHandle = sanitizeHandle(data.xHandle || data.x_handle);
    attachment.lastUpdate = Date.now();
    attachment.lastChat = 0;
    this.xpWindows.set(attachment.sessionId, createXpWindow());
    attachment.lastDepthAwarded = 0;
    ws.serializeAttachment(attachment);

    const players = this.getActivePlayers();
    ws.send(JSON.stringify({
      type: 'init',
      playerId,
      seed: this.seed,
      sector: this.roomName || null,
      players: players.concat([...this.bots.values()].map(publicRecruit)),
      dugBlocks: Array.from(this.dugBlocks.entries()).slice(-500),
      playerCount: players.length,
      recruitCount: this.bots.size,
      roster: this.presence().players
    }));
    this.ensureBotTicker();
    this.broadcast({
      type: 'join',
      playerId,
      name: attachment.name,
      pfp: attachment.pfp,
      level: attachment.level,
      xHandle: attachment.xHandle,
      playerCount: players.length
    }, ws);
  }

  async handleStateUpdate(ws, data, attachment) {
    if (!attachment.playerId) return;
    const now = Date.now();
    if (now - (attachment.lastUpdate || 0) < 50) return;
    const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
    attachment.x = num(data.x);
    attachment.y = num(data.y);
    attachment.vx = num(data.vx);
    attachment.vy = num(data.vy);
    attachment.face = data.face < 0 ? -1 : 1;
    attachment.swing = data.swing ? 1 : 0;
    if (data.level !== undefined) attachment.level = Math.max(1, Math.min(999, Math.floor(Number(data.level)) || 1));
    if (data.xHandle || data.x_handle) attachment.xHandle = sanitizeHandle(data.xHandle || data.x_handle);
    attachment.lastUpdate = now;
    ws.serializeAttachment(attachment);

    const depth = depthFromY(attachment.y, TRENCH_FLOOR_TILE, TILE_SIZE);
    if (depth - (attachment.lastDepthAwarded || 0) >= DEPTH_STEP_M) {
      await this.creditEvent(ws, attachment, { kind: 'depth', depth }, now);
    }

    if (now - this.lastBroadcast >= BROADCAST_INTERVAL_MS) {
      this.lastBroadcast = now;
      this.broadcastStates();
    }
  }

  async handleDig(ws, data, attachment) {
    if (!attachment.playerId) return;
    const now = Date.now();
    const bx = Math.floor(Number(data.x)), by = Math.floor(Number(data.y));
    if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
    const key = tileKey(bx, by);
    // Score against the map *before* marking the tile, so only the first digger earns XP.
    const ctx = this.scoreCtx(attachment, now);
    const scored = scoreValidatedEvent({ kind: 'dig', x: bx, y: by }, ctx);
    // World sync is never gated by XP caps (same as before): every dig is shared.
    this.dugBlocks.set(key, now);
    if (scored.ok) this.recentDigs.set(key, { by: attachment.sessionId, t: now, claimed: new Set() });
    const cutoff = now - 300000;
    for (const [k, t] of this.dugBlocks) if (t < cutoff) this.dugBlocks.delete(k);
    for (const [k, r] of this.recentDigs) if (now - r.t > REWARD_WINDOW_MS) this.recentDigs.delete(k);
    this.broadcast({ type: 'dig', playerId: attachment.playerId, x: bx, y: by });
    if (scored.ok) await this.creditScored(ws, attachment, { kind: 'dig', x: bx, y: by }, scored);
  }

  scoreCtx(attachment, now) {
    let win = this.xpWindows.get(attachment.sessionId);
    if (!win) { win = createXpWindow(); this.xpWindows.set(attachment.sessionId, win); }
    let slain = this.bossSlain.get(attachment.sessionId);
    if (!slain) { slain = new Set(); this.bossSlain.set(attachment.sessionId, slain); }
    return {
      dugSet: this.dugBlocks,
      recentDigs: this.recentDigs,
      sessionId: attachment.sessionId,
      playerX: attachment.x,
      playerY: attachment.y,
      lastDepthAwarded: attachment.lastDepthAwarded || 0,
      // world level of the room's last known position (crawler / boss XP scale with it)
      level: levelForDepth(depthFromY(attachment.y, TRENCH_FLOOR_TILE, TILE_SIZE), levelsUnlocked(this.env)),
      boss: this.bossSpawns.get(attachment.sessionId) || null,
      slain,
      now,
      window: win
    };
  }

  // Autosave over the socket: the room supplies the last position it saw for this session,
  // so the client cannot place itself anywhere it has not reported moving to.
  async handleSave(ws, data, attachment) {
    if (!attachment.playerId || attachment.bot) return;
    const profileId = attachment.verifiedProfileId;
    if (!profileId || profileId.startsWith('guest:') || isBotId(profileId)) {
      try { ws.send(JSON.stringify({ type: 'saved', ok: false, error: 'login_required' })); } catch (e) {}
      return;
    }
    const now = Date.now();
    if (now - (attachment.lastSave || 0) < SAVE_MIN_GAP_MS && !(data.snapshot && data.snapshot.dead)) {
      try { ws.send(JSON.stringify({ type: 'saved', ok: false, error: 'too_soon' })); } catch (e) {}
      return;
    }
    attachment.lastSave = now;
    ws.serializeAttachment(attachment);
    const serverPos = Number.isFinite(Number(attachment.y)) && attachment.y !== undefined ? { x: attachment.x, y: attachment.y } : null;
    const res = await this.env.PROFILES.get(this.env.PROFILES.idFromName(PROFILES_SHARD)).fetch(new Request('http://internal/save', {
      method: 'POST',
      body: JSON.stringify({ profileId, input: data.snapshot || {}, serverPos, sector: this.roomName || null })
    }));
    const out = await res.json().catch(() => ({ ok: false }));
    try { ws.send(JSON.stringify({ type: 'saved', ...out })); } catch (e) {}
  }

  async handleChat(ws, data, attachment) {
    if (!attachment.playerId) return;
    const now = Date.now();
    if (now - (attachment.lastChat || 0) < CHAT_RATE_LIMIT_MS) return;
    let text = String(data.text || '').slice(0, CHAT_MAX_LENGTH).trim();
    if (!text) return;
    text = filterProfanity(text);
    attachment.lastChat = now;
    attachment.lastUpdate = now;
    ws.serializeAttachment(attachment);
    this.broadcast({ type: 'chat', playerId: attachment.playerId, text, name: attachment.name });
    this.maybeBotEmoteReply(text);
  }

  async handleGameEvent(ws, data, attachment) {
    if (!attachment.playerId) return;
    const kind = data.kind;
    if (kind === 'dig') return this.handleDig(ws, data, attachment);
    if (kind === 'bossSpawn') {
      // No XP: just start the fight clock if the room agrees the trencher is in a boss zone.
      const sp = noteBossSpawn({ playerY: attachment.y, now: Date.now() });
      const prev = this.bossSpawns.get(attachment.sessionId);
      if (sp && !(prev && prev.band === sp.band)) this.bossSpawns.set(attachment.sessionId, sp);
      return;
    }
    await this.creditEvent(ws, attachment, data, Date.now());
  }

  async creditEvent(ws, attachment, event, now) {
    const sid = attachment.sessionId;
    if (event.kind === 'boss' && (this.raidSurvives.get(sid) || 0) < RAID_SURVIVES) {
      return { ok: false, reason: 'raid_not_done', xp: 0 };
    }
    const result = scoreValidatedEvent(event, this.scoreCtx(attachment, now));
    if (result.ok && event.kind === 'survive') this.raidSurvives.set(sid, (this.raidSurvives.get(sid) || 0) + 1);
    if (result.ok && event.kind === 'boss') this.raidSurvives.set(sid, 0);
    if (event.kind === 'depth' && result.ok) {
      attachment.lastDepthAwarded = Math.max(attachment.lastDepthAwarded || 0, Math.floor(Number(event.depth) || 0));
      ws.serializeAttachment(attachment);
    }
    return this.creditScored(ws, attachment, event, result);
  }

  async creditScored(ws, attachment, event, result) {
    if (attachment.bot || isBotId(attachment.playerId) || isBotId(attachment.verifiedProfileId)) return { ok: false, reason: 'bot', xp: 0 };
    const serverXp = SERVER_XP_KINDS.has(event.kind);
    if (!result.ok || (!result.xp && !serverXp)) return result;

    const profileId = attachment.verifiedProfileId;
    if (!profileId) return result;

    const depth = depthFromY(attachment.y, TRENCH_FLOOR_TILE, TILE_SIZE);
    const profiles = this.env.PROFILES.get(this.env.PROFILES.idFromName(PROFILES_SHARD));
    const res = await profiles.fetch(new Request('http://internal/add-xp', {
      method: 'POST',
      body: JSON.stringify({
        profileId,
        xp: result.xp,
        depth,
        eventKind: event.kind,
        band: result.band || undefined,
        chapterId: typeof event.chapterId === 'string' ? event.chapterId.slice(0, 40) : undefined,
        missionId: typeof event.missionId === 'string' ? event.missionId.slice(0, 40) : undefined,
        name: attachment.name
      })
    }));
    const credited = await res.json().catch(() => null);
    if (credited && credited.success) {
      if (credited.newLevel) attachment.level = credited.newLevel;
      ws.serializeAttachment(attachment);
      try { ws.send(JSON.stringify({ type: 'xp', ...credited })); } catch (e) {}
      if (credited.added > 0) await this.maybeEventScore(profileId, attachment.name, credited.added);
    }
    return result;
  }

  async maybeEventScore(profileId, name, xp) {
    if (isBotId(profileId)) return;
    try {
      const events = this.env.EVENTS.get(this.env.EVENTS.idFromName(EVENTS_SHARD));
      await events.fetch(new Request('http://internal/score', {
        method: 'POST',
        body: JSON.stringify({ profileId, name, xp, now: Date.now() })
      }));
    } catch (e) {}
  }

  getActivePlayers(excludeWs = null, now = Date.now()) {
    const players = [];
    for (const ws of this.state.getWebSockets()) {
      if (ws === excludeWs) continue;
      const a = ws.deserializeAttachment();
      if (a && a.playerId) {
        const idle = !a.lastUpdate || (now - a.lastUpdate > IDLE_MS);
        players.push({
          id: a.playerId,
          name: a.name,
          pfp: a.pfp,
          level: a.level,
          xHandle: a.xHandle || null,
          status: idle ? 'idle' : 'active',
          x: a.x, y: a.y, vx: a.vx, vy: a.vy, face: a.face, swing: a.swing
        });
      }
    }
    return players;
  }

  broadcastStates(now = Date.now()) {
    const players = this.getActivePlayers(null, now);
    const roster = players.map(p => ({
      id: p.id, name: p.name, level: p.level, xHandle: p.xHandle, status: p.status
    }));
    // playerCount and roster are humans only; recruits ride along in players[] with bot:true.
    const all = this.bots.size ? players.concat([...this.bots.values()].map(publicRecruit)) : players;
    this.broadcast(JSON.stringify({ type: 'states', players: all, playerCount: players.length, recruitCount: this.bots.size, roster }), null, true);
  }

  broadcast(data, excludeWs = null, isString = false) {
    const message = isString ? data : JSON.stringify(data);
    for (const ws of this.state.getWebSockets()) {
      if (ws !== excludeWs) {
        try { ws.send(message); } catch (e) {}
      }
    }
  }
}

// ============================================
// Profiles Durable Object
// ============================================
export class Profiles {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
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
        CREATE TABLE IF NOT EXISTS squads (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE,
          name TEXT,
          leader_id TEXT,
          objective TEXT,
          objective_progress INTEGER DEFAULT 0,
          objective_target INTEGER DEFAULT 0,
          xp INTEGER DEFAULT 0,
          created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS squad_members (
          squad_id TEXT,
          profile_id TEXT,
          joined_at INTEGER,
          PRIMARY KEY (squad_id, profile_id)
        );
        CREATE INDEX IF NOT EXISTS idx_squad_code ON squads(code);
        CREATE INDEX IF NOT EXISTS idx_squad_xp ON squads(xp DESC);
      `);
      for (const col of [
        'ALTER TABLE profiles ADD COLUMN x_handle TEXT',
        'ALTER TABLE profiles ADD COLUMN wallet TEXT',
        "ALTER TABLE profiles ADD COLUMN titles TEXT DEFAULT '[]'",
        "ALTER TABLE profiles ADD COLUMN campaign TEXT DEFAULT '{}'",
        'ALTER TABLE profiles ADD COLUMN squad_id TEXT',
        'ALTER TABLE profiles ADD COLUMN migrated_to TEXT',
        'ALTER TABLE profiles ADD COLUMN privy_did TEXT',
        // Save game + endless levels + skills (patch 0010)
        'ALTER TABLE profiles ADD COLUMN save_state TEXT',
        'ALTER TABLE profiles ADD COLUMN save_at INTEGER',
        "ALTER TABLE profiles ADD COLUMN save_meta TEXT DEFAULT '{}'",
        "ALTER TABLE profiles ADD COLUMN skills TEXT DEFAULT '{}'",
        'ALTER TABLE profiles ADD COLUMN skills_reset_at INTEGER',
        'ALTER TABLE profiles ADD COLUMN max_level INTEGER DEFAULT 1',
        "ALTER TABLE profiles ADD COLUMN bosses TEXT DEFAULT '{}'",
        'CREATE INDEX IF NOT EXISTS idx_max_level ON profiles(max_level DESC, best_depth DESC)'
      ]) {
        try { this.sql.exec(col); } catch (e) {}
      }
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
      return this.addXp(await request.json());
    }
    if (path === '/migrate' && request.method === 'POST') {
      return this.migrate(await request.json());
    }
    if (path === '/profile') {
      if (request.method === 'GET') return this.getProfile(url.searchParams.get('id'));
      if (request.method === 'POST') return this.saveProfile(await request.json());
    }
    if (path === '/leaderboard') {
      return this.getLeaderboard(url.searchParams.get('type') || 'xp');
    }
    if (path === '/save') {
      if (request.method === 'GET') return this.getSave(url.searchParams.get('id'));
      if (request.method === 'POST') return this.writeSave(await request.json());
    }
    if (path === '/skills' && request.method === 'POST') {
      return this.updateSkills(await request.json());
    }
    if (path === '/elevator') {
      if (request.method === 'GET') return this.getElevator(url.searchParams.get('id'));
      if (request.method === 'POST') return this.rideElevator(await request.json());
    }
    if (path === '/squad') {
      if (request.method === 'GET') {
        const code = url.searchParams.get('code');
        const id = url.searchParams.get('id');
        const profileId = url.searchParams.get('profileId');
        if (profileId) return this.getSquadFor(profileId);
        return this.getSquad(code || id);
      }
      const body = await request.json().catch(() => ({}));
      const action = body.action || url.searchParams.get('action');
      if (action === 'create') return this.createSquad(body);
      if (action === 'join') return this.joinSquad(body);
      if (action === 'leave') return this.leaveSquad(body);
      if (action === 'objective') return this.setSquadObjective(body);
    }
    if (path === '/squads/leaderboard') {
      return this.squadLeaderboard();
    }
    return new Response('Not found', { status: 404 });
  }

  rowToProfile(row) {
    const { secret_hash, save_state, save_meta, ...rest } = row;
    const skills = normalizeSkills(JSON.parse(row.skills || '{}'));
    return {
      ...rest,
      max_level: Math.max(1, row.max_level || 1),
      skills,
      skill_points: skillPoints(row.level, row.max_level),
      skill_points_free: Math.max(0, skillPoints(row.level, row.max_level) - spentPoints(skills)),
      has_save: !!save_state,
      bosses: (() => { try { return JSON.parse(row.bosses || '{}') || {}; } catch (e) { return {}; } })(),
      elevator: elevatorStops({ bestDepth: row.best_depth || 0, maxLevel: row.max_level || 1, unlocked: levelsUnlocked(this.env) }),
      inventory: JSON.parse(row.inventory || '[]'),
      equipped: JSON.parse(row.equipped || '{}'),
      titles: JSON.parse(row.titles || '[]'),
      campaign: normalizeProgress(JSON.parse(row.campaign || '{}'))
    };
  }

  async getProfile(id) {
    const results = this.sql.exec('SELECT * FROM profiles WHERE id = ?', id).toArray();
    if (!results.length) return Response.json({ exists: false });
    const profile = this.rowToProfile(results[0]);
    return Response.json({ exists: true, profile, campaign: campaignPublic(profile.campaign, { levelsUnlocked: levelsUnlocked(this.env) }) });
  }

  async saveProfile(data) {
    const now = Date.now();
    if (!validProfileId(data.id)) return Response.json({ success: false, error: 'Invalid id' }, { status: 400 });
    const existing = this.sql.exec('SELECT * FROM profiles WHERE id = ?', data.id).toArray();

    if (data.id.startsWith('guest:')) {
      if (!data.secretHash) return Response.json({ success: false, error: 'Guest secret required' }, { status: 401 });
      if (existing.length && existing[0].secret_hash && existing[0].secret_hash !== data.secretHash) {
        return Response.json({ success: false, error: 'Not your profile' }, { status: 403 });
      }
    }

    const name = filterProfanity(String(data.name || 'Trencher').slice(0, 20));
    const pfp = typeof data.pfp === 'string' && /^https:\/\//.test(data.pfp) ? data.pfp.slice(0, 512) : (existing[0] && existing[0].pfp) || null;
    const xHandle = sanitizeHandle(data.x_handle || data.xHandle) || (existing[0] && existing[0].x_handle) || null;
    const wallet = sanitizeWallet(data.wallet) || (existing[0] && existing[0].wallet) || null;
    // Equipped ids must point at gear this profile actually owns (server-owned inventory).
    const ownInv = existing[0] ? JSON.parse(existing[0].inventory || '[]') : [];
    const equipped = JSON.stringify(sanitizeEquipped(data.equipped || (existing[0] ? JSON.parse(existing[0].equipped || '{}') : {}), ownInv));

    if (existing.length) {
      // Server owns xp / level / depth / inventory / campaign. Client may update identity + equipped.
      this.sql.exec(`
        UPDATE profiles SET
          name = ?, pfp = ?, equipped = ?,
          x_handle = ?, wallet = ?,
          secret_hash = COALESCE(secret_hash, ?),
          updated_at = ?
        WHERE id = ?
      `, name, pfp, equipped, xHandle, wallet, data.secretHash || null, now, data.id);
    } else {
      this.sql.exec(`
        INSERT INTO profiles (id, fid, name, pfp, level, xp, best_depth, total_diamonds, total_digs, deaths, play_time,
          inventory, equipped, secret_hash, created_at, updated_at, x_handle, wallet, titles, campaign, privy_did)
        VALUES (?, ?, ?, ?, 1, 0, 0, 0, 0, 0, 0, '[]', ?, ?, ?, ?, ?, ?, '[]', '{}', ?)
      `,
        data.id, data.fid || null, name, pfp,
        equipped, data.secretHash || null, now, now,
        xHandle, wallet, data.id.startsWith('did:privy:') ? data.id : null
      );
    }
    const fresh = this.sql.exec('SELECT * FROM profiles WHERE id = ?', data.id).toArray();
    return Response.json({ success: true, profile: this.rowToProfile(fresh[0]) });
  }

  async addXp({ profileId, xp, depth, eventKind, chapterId, missionId, name, band }) {
    const results = this.sql.exec('SELECT * FROM profiles WHERE id = ?', profileId).toArray();
    if (!results.length) return Response.json({ success: false });
    const row = results[0];
    if (row.migrated_to) return Response.json({ success: false, error: 'migrated' });
    // Room-scored XP is already capped; mission/boss XP is added below only on completion.
    let add = SERVER_XP_KINDS.has(eventKind) ? 0 : Math.max(0, Math.min(250, Math.floor(Number(xp) || 0)));
    const prevBest = row.best_depth || 0;
    const here = Math.max(0, Math.floor(Number(depth) || 0));
    const newBestDepth = Math.max(prevBest, Math.min(here, prevBest + MAX_DEPTH_GAIN_PER_CREDIT));
    const unlocked = levelsUnlocked(this.env);
    // World level of this event: from the (capped) position, never above the deepest verified level.
    const atLevel = levelForDepth(Math.min(here, newBestDepth), unlocked);
    const maxLevel = Math.max(row.max_level || 1, levelForDepth(newBestDepth, unlocked));
    // Crawler / boss XP never exceeds what the deepest *verified* level pays.
    if (eventKind === 'kill') add = Math.min(add, killXp(atLevel));
    if (eventKind === 'bossKill') {
      // The boss only counts where this profile's *verified* depth puts it inside a boss zone.
      const at = Math.min(here, newBestDepth);
      add = inBossZone(at, 12) && (!band || bossBand(at) === Math.floor(Number(band))) ? Math.min(add, bossXp(atLevel)) : 0;
    }
    let campaign = normalizeProgress(JSON.parse(row.campaign || '{}'));
    if (unlocked) campaign = noteLevel(campaign, maxLevel);
    let titles = JSON.parse(row.titles || '[]');
    let inventory = JSON.parse(row.inventory || '[]');
    const rewards = [];

    if (eventKind === 'depth' || eventKind === 'dig') campaign = noteStat(campaign, 'depth', newBestDepth);
    else if (eventKind === 'survive' || eventKind === 'dodge' || eventKind === 'relic' || eventKind === 'squad' || eventKind === 'boss') {
      campaign = noteStat(campaign, eventKind, 1, atLevel);
    }
    if (eventKind === 'dig') {
      this.sql.exec('UPDATE profiles SET total_digs = total_digs + 1 WHERE id = ?', profileId);
    }

    if (eventKind === 'mission' || eventKind === 'boss') {
      const done = completeMission(campaign, chapterId, missionId || (eventKind === 'boss' ? undefined : missionId));
      if (done.ok) {
        add += Math.max(0, Math.floor(Number(done.xp) || 0));
        campaign = done.progress;
        titles = campaign.titles;
        for (const r of done.rewards) {
          if (r.gear) {
            const gear = { id: crypto.randomUUID(), ...r.gear, foundAt: Date.now(), foundDepth: newBestDepth };
            inventory.push(gear);
            rewards.push({ title: r.title, gear });
          } else if (r.title) rewards.push({ title: r.title });
        }
      }
    }

    const newXp = (row.xp || 0) + add;
    const newLevel = levelFromXp(newXp);

    let gearDrop = null;
    // First Sandmaw kill in each level band: a guaranteed gear drop (repeat kills pay XP only).
    let bosses = {};
    try { bosses = JSON.parse(row.bosses || '{}') || {}; } catch (e) { bosses = {}; }
    let bossFirst = false;
    if (eventKind === 'bossKill' && add > 0) {
      const at = Math.min(here, newBestDepth);
      const b = String(bossBand(at));
      bossFirst = !bosses[b];
      bosses[b] = (bosses[b] || 0) + 1;
      if (bossFirst) { gearDrop = generateGearDrop(Math.max(at, 300)); inventory.push(gearDrop); }
      this.sql.exec('UPDATE profiles SET bosses = ? WHERE id = ?', JSON.stringify(bosses), profileId);
    } else if (Math.random() < 0.02 && depth > 10 && add > 0) {
      gearDrop = generateGearDrop(depth);
      inventory.push(gearDrop);
    }

    // Diamonds / power gems the server credited since the last save cap what a save may claim.
    let meta = normalizeMeta(JSON.parse(row.save_meta || '{}'), row.save_at || row.created_at || Date.now());
    if (add > 0 && (eventKind === 'diamond' || eventKind === 'power')) meta = noteCredit(meta, eventKind);

    this.sql.exec(`
      UPDATE profiles SET xp = ?, level = ?, best_depth = ?, inventory = ?, titles = ?, campaign = ?,
        name = COALESCE(?, name), updated_at = ?, max_level = ?, save_meta = ? WHERE id = ?
    `, newXp, newLevel, newBestDepth, JSON.stringify(inventory), JSON.stringify(titles),
      JSON.stringify(campaign), name || null, Date.now(), maxLevel, JSON.stringify(meta), profileId);

    if (row.squad_id && add > 0) {
      this.sql.exec('UPDATE squads SET xp = xp + ? WHERE id = ?', add, row.squad_id);
      const sq = this.sql.exec('SELECT * FROM squads WHERE id = ?', row.squad_id).toArray()[0];
      if (sq && sq.objective_target > 0 && (eventKind === 'dig' || eventKind === 'depth')) {
        const next = Math.min(sq.objective_target, (sq.objective_progress || 0) + (eventKind === 'depth' ? 5 : 1));
        this.sql.exec('UPDATE squads SET objective_progress = ? WHERE id = ?', next, row.squad_id);
        if (next >= sq.objective_target && (sq.objective_progress || 0) < sq.objective_target) {
          campaign = noteStat(campaign, 'squad', 1);
          this.sql.exec('UPDATE profiles SET campaign = ? WHERE id = ?', JSON.stringify(campaign), profileId);
        }
      }
    }

    return Response.json({
      success: true,
      added: add,
      newXp,
      newLevel,
      leveledUp: newLevel > row.level,
      gearDrop,
      rewards,
      campaign: campaignPublic(campaign, { levelsUnlocked: unlocked }),
      titles,
      maxLevel,
      bestDepth: newBestDepth,
      bossFirst,
      skillPoints: skillPoints(newLevel, maxLevel)
    });
  }

  async migrate({ toId, fromId, secretHash }) {
    if (!PRIVY_ID_RE.test(toId) || !validProfileId(fromId) || toId === fromId) {
      return Response.json({ success: false, error: 'bad ids' }, { status: 400 });
    }
    const dest = this.sql.exec('SELECT * FROM profiles WHERE id = ?', toId).toArray();
    const src = this.sql.exec('SELECT * FROM profiles WHERE id = ?', fromId).toArray();
    if (!src.length) return Response.json({ success: false, error: 'source missing' }, { status: 404 });
    if (src[0].migrated_to) return Response.json({ success: false, error: 'already migrated' }, { status: 409 });
    // A guest profile can only be claimed with its secret. Legacy guests with no stored
    // secret can't prove ownership, so they can't be migrated (otherwise anyone who knows
    // the guest id could take its XP and inventory).
    if (fromId.startsWith('guest:') && (!src[0].secret_hash || !secretHash || src[0].secret_hash !== secretHash)) {
      return Response.json({ success: false, error: 'Not your profile' }, { status: 403 });
    }
    const now = Date.now();
    const s = src[0];
    if (!dest.length) {
      this.sql.exec(`
        INSERT INTO profiles (id, fid, name, pfp, level, xp, best_depth, total_diamonds, total_digs, deaths, play_time,
          inventory, equipped, created_at, updated_at, x_handle, wallet, titles, campaign, privy_did, squad_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, toId, s.fid, s.name, s.pfp, s.level, s.xp, s.best_depth, s.total_diamonds, s.total_digs, s.deaths, s.play_time,
        s.inventory, s.equipped, s.created_at || now, now, s.x_handle, s.wallet, s.titles || '[]', s.campaign || '{}', toId, s.squad_id);
    } else if ((dest[0].xp || 0) === 0 && (s.xp || 0) > 0) {
      this.sql.exec(`
        UPDATE profiles SET fid = COALESCE(fid, ?), name = ?, pfp = COALESCE(?, pfp), level = ?, xp = ?, best_depth = MAX(best_depth, ?),
          total_diamonds = total_diamonds + ?, total_digs = total_digs + ?, deaths = deaths + ?, play_time = play_time + ?,
          inventory = ?, equipped = ?, x_handle = COALESCE(x_handle, ?), wallet = COALESCE(wallet, ?),
          titles = ?, campaign = ?, squad_id = COALESCE(squad_id, ?), updated_at = ?
        WHERE id = ?
      `, s.fid, s.name, s.pfp, s.level, s.xp, s.best_depth, s.total_diamonds || 0, s.total_digs || 0, s.deaths || 0, s.play_time || 0,
        s.inventory, s.equipped, s.x_handle, s.wallet, s.titles || '[]', s.campaign || '{}', s.squad_id, now, toId);
    } else {
      return Response.json({ success: false, error: 'already migrated' }, { status: 409 });
    }
    this.sql.exec(`UPDATE profiles SET max_level = MAX(COALESCE(max_level, 1), ?),
      skills = CASE WHEN COALESCE(skills, '{}') = '{}' THEN ? ELSE skills END WHERE id = ?`,
      s.max_level || 1, s.skills || '{}', toId);
    this.sql.exec('UPDATE profiles SET migrated_to = ?, updated_at = ? WHERE id = ?', toId, now, fromId);
    if (s.squad_id) {
      const destSquad = dest.length ? dest[0].squad_id : null;
      if (destSquad && destSquad !== s.squad_id) {
        // Destination already has a squad: drop the guest's membership instead of being in two.
        this.sql.exec('DELETE FROM squad_members WHERE squad_id = ? AND profile_id = ?', s.squad_id, fromId);
        const left = this.sql.exec('SELECT profile_id FROM squad_members WHERE squad_id = ? ORDER BY joined_at', s.squad_id).toArray();
        if (!left.length) this.sql.exec('DELETE FROM squads WHERE id = ?', s.squad_id);
        else this.sql.exec('UPDATE squads SET leader_id = ? WHERE id = ? AND leader_id = ?', left[0].profile_id, s.squad_id, fromId);
      } else {
        this.sql.exec('DELETE FROM squad_members WHERE squad_id = ? AND profile_id = ?', s.squad_id, toId);
        this.sql.exec('UPDATE squad_members SET profile_id = ? WHERE profile_id = ?', toId, fromId);
        this.sql.exec('UPDATE squads SET leader_id = ? WHERE leader_id = ?', toId, fromId);
      }
      this.sql.exec('UPDATE profiles SET squad_id = NULL WHERE id = ?', fromId);
    }
    const fresh = this.sql.exec('SELECT * FROM profiles WHERE id = ?', toId).toArray();
    return Response.json({ success: true, profile: this.rowToProfile(fresh[0]) });
  }

  async getSave(id) {
    const rows = this.sql.exec('SELECT save_state, save_at, migrated_to FROM profiles WHERE id = ?', id).toArray();
    if (!rows.length || rows[0].migrated_to || !rows[0].save_state) return Response.json({ ok: true, save: null });
    let save = null;
    try { save = JSON.parse(rows[0].save_state); } catch (e) {}
    // A level 2+ save made while levels were open is folded back to level 1 if the switch is off.
    if (save && !levelsUnlocked(this.env) && save.level > 1) save = null;
    return Response.json({ ok: true, save, savedAt: rows[0].save_at || null });
  }

  async writeSave({ profileId, input, serverPos, sector }) {
    if (!profileId || String(profileId).startsWith('guest:')) return Response.json({ ok: false, error: 'login_required' }, { status: 403 });
    const rows = this.sql.exec('SELECT * FROM profiles WHERE id = ?', profileId).toArray();
    if (!rows.length) return Response.json({ ok: false, error: 'no_profile' }, { status: 404 });
    const row = rows[0];
    if (row.migrated_to) return Response.json({ ok: false, error: 'migrated' }, { status: 409 });
    const now = Date.now();
    const unlocked = levelsUnlocked(this.env);
    if (input && input.clear) {
      this.sql.exec(`UPDATE profiles SET save_state = NULL, save_at = ?, save_meta = ? WHERE id = ?`, now, JSON.stringify(emptyMeta(now)), profileId);
      return Response.json({ ok: true, save: null, cleared: true });
    }
    if (!(input && input.dead) && row.save_at && now - row.save_at < 4000) {
      return Response.json({ ok: false, error: 'too_soon' }, { status: 429 });
    }
    let prev = null;
    try { prev = row.save_state ? JSON.parse(row.save_state) : null; } catch (e) {}
    const meta = normalizeMeta(JSON.parse(row.save_meta || '{}'), row.save_at || row.created_at || now);
    const out = sanitizeSave(input, {
      prev, prevAt: row.save_at, meta, bestDepth: row.best_depth || 0, levelsUnlocked: unlocked, now,
      serverPos: serverPos || null, sector: typeof sector === 'string' ? sector : null
    });
    if (!out.ok) return Response.json({ ok: false, error: out.error }, { status: 400 });
    let save = out.save;
    let died = false;
    if (input && input.dead) {
      died = true;
      save = deathCheckpoint(save, { now, levelsUnlocked: unlocked });
    }
    const playAdd = Math.max(0, Math.min(out.playDeltaMs, 3_600_000));
    this.sql.exec(`
      UPDATE profiles SET save_state = ?, save_at = ?, save_meta = ?, play_time = COALESCE(play_time, 0) + ?,
        deaths = COALESCE(deaths, 0) + ?, updated_at = ? WHERE id = ?
    `, save ? JSON.stringify(save) : null, now, JSON.stringify(emptyMeta(now)), playAdd, died ? 1 : 0, now, profileId);
    return Response.json({ ok: true, save, clamped: out.clamped, died, playTime: (row.play_time || 0) + playAdd });
  }

  // Elevator: stops come from what this profile has verified (best depth, deepest level).
  async getElevator(id) {
    const rows = this.sql.exec('SELECT best_depth, max_level, migrated_to FROM profiles WHERE id = ?', id).toArray();
    const unlocked = levelsUnlocked(this.env);
    if (!rows.length || rows[0].migrated_to) return Response.json({ ok: true, stops: elevatorStops({ unlocked }) });
    return Response.json({ ok: true, stops: elevatorStops({ bestDepth: rows[0].best_depth || 0, maxLevel: rows[0].max_level || 1, unlocked }) });
  }

  // Ride from the menu: a fresh run at the chosen stop, written as the save (like a checkpoint).
  async rideElevator({ profileId, depth, sector }) {
    if (!profileId || String(profileId).startsWith('guest:')) return Response.json({ ok: false, error: 'login_required' }, { status: 403 });
    const rows = this.sql.exec('SELECT * FROM profiles WHERE id = ?', profileId).toArray();
    if (!rows.length) return Response.json({ ok: false, error: 'no_profile' }, { status: 404 });
    const row = rows[0];
    if (row.migrated_to) return Response.json({ ok: false, error: 'migrated' }, { status: 409 });
    const unlocked = levelsUnlocked(this.env);
    const stop = validElevatorStop(depth, { bestDepth: row.best_depth || 0, maxLevel: row.max_level || 1, unlocked });
    if (!stop) return Response.json({ ok: false, error: 'bad_stop' }, { status: 400 });
    const now = Date.now();
    let prev = null;
    try { prev = row.save_state ? JSON.parse(row.save_state) : null; } catch (e) {}
    const save = elevatorStart(stop, { now, levelsUnlocked: unlocked, seed: prev && prev.seed != null ? prev.seed : null, sector: typeof sector === 'string' ? sector : (prev && prev.sector) || null });
    this.sql.exec(`UPDATE profiles SET save_state = ?, save_at = ?, save_meta = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(save), now, JSON.stringify(emptyMeta(now)), now, profileId);
    return Response.json({ ok: true, save, stop });
  }

  async updateSkills({ profileId, action, skill }) {
    const rows = this.sql.exec('SELECT * FROM profiles WHERE id = ?', profileId).toArray();
    if (!rows.length) return Response.json({ ok: false, error: 'no_profile' }, { status: 404 });
    const row = rows[0];
    if (row.migrated_to) return Response.json({ ok: false, error: 'migrated' }, { status: 409 });
    const ctx = { level: row.level || 1, maxLevel: row.max_level || 1 };
    let skills = validateSkills(JSON.parse(row.skills || '{}'), ctx);
    const now = Date.now();
    if (action === 'reset') {
      if (row.skills_reset_at && now - row.skills_reset_at < RESPEC_COOLDOWN_MS) {
        return Response.json({ ok: false, error: 'respec_cooldown', retryAt: row.skills_reset_at + RESPEC_COOLDOWN_MS }, { status: 429 });
      }
      skills = normalizeSkills({});
      this.sql.exec('UPDATE profiles SET skills = ?, skills_reset_at = ?, updated_at = ? WHERE id = ?', JSON.stringify(skills), now, now, profileId);
    } else if (action === 'learn') {
      const r = learnSkill(skills, skill, ctx);
      if (!r.ok) return Response.json({ ok: false, error: r.reason, skills, points: skillPoints(ctx.level, ctx.maxLevel) }, { status: 400 });
      skills = r.skills;
      this.sql.exec('UPDATE profiles SET skills = ?, updated_at = ? WHERE id = ?', JSON.stringify(skills), now, profileId);
    } else {
      return Response.json({ ok: false, error: 'bad_action' }, { status: 400 });
    }
    const points = skillPoints(ctx.level, ctx.maxLevel);
    return Response.json({ ok: true, skills, points, free: points - spentPoints(skills) });
  }

  async getLeaderboard(type) {
    if (type === 'squad') return this.squadLeaderboard();
    const orderBy = type === 'depth' ? 'best_depth DESC' : type === 'level' ? 'max_level DESC, best_depth DESC' : 'xp DESC';
    const rows = this.sql.exec(`
      SELECT id, name, pfp, level, xp, best_depth, COALESCE(max_level, 1) AS max_level, x_handle, wallet FROM profiles
      WHERE migrated_to IS NULL
      ORDER BY ${orderBy} LIMIT 50
    `).toArray();
    return Response.json({ leaderboard: rows });
  }

  async createSquad({ profileId, name, objective, target }) {
    if (!profileId) return Response.json({ success: false, error: 'auth' }, { status: 401 });
    const me = this.sql.exec('SELECT squad_id, migrated_to FROM profiles WHERE id = ?', profileId).toArray();
    if (!me.length || me[0].migrated_to) return Response.json({ success: false, error: 'save your profile first' }, { status: 404 });
    if (me[0].squad_id) return Response.json({ success: false, error: 'already in a squad' }, { status: 409 });
    const id = crypto.randomUUID();
    let code = squadCode();
    for (let i = 0; i < 8 && this.sql.exec('SELECT 1 AS x FROM squads WHERE code = ?', code).toArray().length; i++) code = squadCode();
    const now = Date.now();
    const obj = filterProfanity(String(objective || 'Dig as a squad').slice(0, 80));
    const tgt = Math.max(9, Math.min(2000, Math.floor(Number(target) || 90)));
    this.sql.exec(
      'INSERT INTO squads (id, code, name, leader_id, objective, objective_progress, objective_target, xp, created_at) VALUES (?,?,?,?,?,0,?,0,?)',
      id, code, filterProfanity(String(name || 'Squad').slice(0, 24)), profileId, obj, tgt, now
    );
    this.sql.exec('INSERT INTO squad_members (squad_id, profile_id, joined_at) VALUES (?,?,?)', id, profileId, now);
    this.sql.exec('UPDATE profiles SET squad_id = ? WHERE id = ?', id, profileId);
    return this.getSquad(code);
  }

  async joinSquad({ profileId, code }) {
    const c = String(code || '').trim().toUpperCase();
    const sq = this.sql.exec('SELECT * FROM squads WHERE code = ?', c).toArray()[0];
    if (!sq) return Response.json({ success: false, error: 'unknown code' }, { status: 404 });
    const n = this.sql.exec('SELECT COUNT(*) AS n FROM squad_members WHERE squad_id = ?', sq.id).toArray()[0].n;
    if (n >= SQUAD_MAX) return Response.json({ success: false, error: 'squad full' }, { status: 409 });
    const me = this.sql.exec('SELECT squad_id, migrated_to FROM profiles WHERE id = ?', profileId).toArray()[0];
    if (!me || me.migrated_to) return Response.json({ success: false, error: 'save your profile first' }, { status: 404 });
    if (me.squad_id && me.squad_id !== sq.id) return Response.json({ success: false, error: 'already in a squad' }, { status: 409 });
    this.sql.exec('INSERT OR IGNORE INTO squad_members (squad_id, profile_id, joined_at) VALUES (?,?,?)', sq.id, profileId, Date.now());
    this.sql.exec('UPDATE profiles SET squad_id = ? WHERE id = ?', sq.id, profileId);
    return this.getSquad(c);
  }

  async leaveSquad({ profileId }) {
    const me = this.sql.exec('SELECT squad_id FROM profiles WHERE id = ?', profileId).toArray()[0];
    if (!me || !me.squad_id) return Response.json({ success: true });
    this.sql.exec('DELETE FROM squad_members WHERE squad_id = ? AND profile_id = ?', me.squad_id, profileId);
    this.sql.exec('UPDATE profiles SET squad_id = NULL WHERE id = ?', profileId);
    const left = this.sql.exec('SELECT profile_id FROM squad_members WHERE squad_id = ?', me.squad_id).toArray();
    if (!left.length) this.sql.exec('DELETE FROM squads WHERE id = ?', me.squad_id);
    else {
      const sq = this.sql.exec('SELECT leader_id FROM squads WHERE id = ?', me.squad_id).toArray()[0];
      if (sq && sq.leader_id === profileId) {
        this.sql.exec('UPDATE squads SET leader_id = ? WHERE id = ?', left[0].profile_id, me.squad_id);
      }
    }
    return Response.json({ success: true });
  }

  async setSquadObjective({ profileId, objective, target }) {
    const me = this.sql.exec('SELECT squad_id FROM profiles WHERE id = ?', profileId).toArray()[0];
    if (!me || !me.squad_id) return Response.json({ success: false, error: 'no squad' }, { status: 404 });
    const sq = this.sql.exec('SELECT * FROM squads WHERE id = ?', me.squad_id).toArray()[0];
    if (!sq || sq.leader_id !== profileId) return Response.json({ success: false, error: 'leader only' }, { status: 403 });
    const obj = filterProfanity(String(objective || sq.objective).slice(0, 80));
    const tgt = Math.max(9, Math.min(2000, Math.floor(Number(target) || sq.objective_target || 90)));
    this.sql.exec('UPDATE squads SET objective = ?, objective_target = ?, objective_progress = 0 WHERE id = ?', obj, tgt, sq.id);
    return this.getSquad(sq.code);
  }

  squadPayload(sq) {
    const members = this.sql.exec(`
      SELECT p.id, p.name, p.level, p.xp, p.x_handle, p.pfp
      FROM squad_members m JOIN profiles p ON p.id = m.profile_id
      WHERE m.squad_id = ? ORDER BY m.joined_at
    `, sq.id).toArray();
    return {
      success: true,
      squad: {
        id: sq.id,
        code: sq.code,
        name: sq.name,
        leader_id: sq.leader_id,
        objective: sq.objective,
        objective_progress: sq.objective_progress,
        objective_target: sq.objective_target,
        xp: sq.xp,
        members
      }
    };
  }

  async getSquad(codeOrId) {
    const sq = this.sql.exec('SELECT * FROM squads WHERE code = ? OR id = ?', String(codeOrId || '').toUpperCase(), codeOrId).toArray()[0];
    if (!sq) return Response.json({ success: false, error: 'not found' }, { status: 404 });
    return Response.json(this.squadPayload(sq));
  }

  async getSquadFor(profileId) {
    const me = this.sql.exec('SELECT squad_id FROM profiles WHERE id = ?', profileId).toArray()[0];
    if (!me || !me.squad_id) return Response.json({ success: true, squad: null });
    const sq = this.sql.exec('SELECT * FROM squads WHERE id = ?', me.squad_id).toArray()[0];
    if (!sq) return Response.json({ success: true, squad: null });
    return Response.json(this.squadPayload(sq));
  }

  async squadLeaderboard() {
    const rows = this.sql.exec(`
      SELECT s.code, s.name, s.xp, s.objective, s.objective_progress, s.objective_target,
        (SELECT COUNT(*) FROM squad_members m WHERE m.squad_id = s.id) AS members
      FROM squads s ORDER BY s.xp DESC LIMIT 50
    `).toArray();
    return Response.json({ leaderboard: rows });
  }
}

// ============================================
// Events Durable Object
// ============================================
export class Events {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.state.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          title TEXT,
          start_at INTEGER,
          end_at INTEGER,
          type TEXT,
          description TEXT,
          created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS event_scores (
          event_id TEXT,
          profile_id TEXT,
          name TEXT,
          score INTEGER DEFAULT 0,
          PRIMARY KEY (event_id, profile_id)
        );
      `);
    });
  }

  store() {
    const self = this;
    return {
      list() { return self.sql.exec('SELECT * FROM events ORDER BY start_at').toArray(); },
      get(id) { return self.sql.exec('SELECT * FROM events WHERE id = ?', id).toArray()[0] || null; },
      put(ev) {
        self.sql.exec(
          'INSERT OR REPLACE INTO events (id, title, start_at, end_at, type, description, created_at) VALUES (?,?,?,?,?,?,?)',
          ev.id, ev.title, ev.start_at, ev.end_at, ev.type, ev.description, ev.created_at
        );
        return ev;
      },
      delete(id) {
        const n = self.sql.exec('SELECT 1 AS x FROM events WHERE id = ?', id).toArray().length;
        self.sql.exec('DELETE FROM events WHERE id = ?', id);
        self.sql.exec('DELETE FROM event_scores WHERE event_id = ?', id);
        return n > 0;
      },
      addScore(eventId, profileId, name, delta) {
        if (!this.get(eventId)) return null;
        const cur = self.sql.exec('SELECT score FROM event_scores WHERE event_id = ? AND profile_id = ?', eventId, profileId).toArray()[0];
        if (cur) {
          self.sql.exec('UPDATE event_scores SET score = score + ?, name = COALESCE(?, name) WHERE event_id = ? AND profile_id = ?',
            delta, name || null, eventId, profileId);
        } else {
          self.sql.exec('INSERT INTO event_scores (event_id, profile_id, name, score) VALUES (?,?,?,?)',
            eventId, profileId, name || 'Trencher', delta);
        }
        return true;
      },
      leaderboard(eventId, limit = 20) {
        return self.sql.exec(
          'SELECT profile_id, name, score FROM event_scores WHERE event_id = ? ORDER BY score DESC LIMIT ?',
          eventId, limit
        ).toArray();
      }
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/score' && request.method === 'POST') {
      const { profileId, name, xp, now } = await request.json();
      const t = now || Date.now();
      const live = this.sql.exec('SELECT id FROM events WHERE start_at <= ? AND end_at >= ?', t, t).toArray();
      const store = this.store();
      for (const e of live) store.addScore(e.id, profileId, name, Math.max(0, Math.floor(Number(xp) || 0)));
      return Response.json({ ok: true, live: live.length });
    }
    const path = url.pathname.replace(/^\/http/, '') || '/';
    let body = null;
    if (request.method === 'POST' || request.method === 'DELETE') {
      const text = await request.text();
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    }
    const result = handleEventsApi(this.store(), {
      method: request.method,
      path,
      body,
      adminKey: this.env.EVENTS_ADMIN_KEY,
      authHeader: request.headers.get('Authorization'),
      now: Date.now()
    });
    if (result.ics) {
      return new Response(result.ics, {
        status: result.status,
        headers: { 'Content-Type': result.contentType || 'text/calendar; charset=utf-8' }
      });
    }
    return new Response(JSON.stringify(result.body || { error: 'not found' }), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// Auth helpers
// ============================================
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function privyAppId(env) {
  return env.PRIVY_APP_ID || '';
}

const PREVIEW_TEST_RE = /^preview-test:([a-z0-9]{3,24})$/;
async function verifyIncomingToken(token, env) {
  if (!token) return null;
  if (previewTestAuth(env)) {
    const m = PREVIEW_TEST_RE.exec(token);
    if (m) return { kind: 'privy', id: `did:privy:previewtest${m[1]}`, did: `did:privy:previewtest${m[1]}`, test: true };
  }
  const appId = privyAppId(env);
  if (appId) {
    const privy = await verifyPrivyJwt(token, appId);
    if (privy) return { kind: 'privy', id: privy.did, did: privy.did };
  }
  const fid = await verifyFcJwt(token);
  if (fid) return { kind: 'fid', id: `fid:${fid}`, fid };
  return null;
}

async function authFromRequest(request, env) {
  const header = request.headers.get('Authorization');
  if (header && header.startsWith('Bearer ')) {
    const verified = await verifyIncomingToken(header.slice(7), env);
    if (verified) return verified;
  }
  return null;
}

async function requireProfileWrite(request, env, dataId) {
  const verified = await authFromRequest(request, env);
  if (dataId && dataId.startsWith('did:privy:')) {
    if (!verified || verified.kind !== 'privy' || verified.id !== dataId) {
      return { error: 'Auth required', status: 401 };
    }
    return { auth: verified, secretHash: null };
  }
  if (dataId && dataId.startsWith('fid:')) {
    if (!verified || verified.kind !== 'fid' || verified.id !== dataId) {
      return { error: 'Auth required', status: 401 };
    }
    return { auth: verified, secretHash: null, fid: verified.fid };
  }
  if (dataId && GUEST_ID_RE.test(dataId)) {
    const secret = request.headers.get('X-Guest-Secret');
    if (!secret || secret.length < 16) return { error: 'Guest secret required', status: 401 };
    return { auth: { kind: 'guest', id: dataId }, secretHash: await sha256Hex(secret) };
  }
  return { error: 'Invalid profile id', status: 400 };
}

// Humans online across 'main' and any overflow sectors in use. Recruits reported separately.
async function presenceAll(env) {
  const stub = (name) => env.TRENCH_ROOM.get(env.TRENCH_ROOM.idFromName(name));
  const main = await (await stub('main').fetch(new Request('http://internal/presence', { headers: { 'X-BT-Room': 'main' } }))).json();
  const n = Math.max(1, Math.min(ROOM_SHARDS, Number(main.shards) || 1));
  delete main.shards;
  const parts = [main];
  if (n > 1) {
    const extra = await Promise.all(Array.from({ length: n - 1 }, (_, i) =>
      stub(shardName(i + 1)).fetch(new Request('http://internal/presence', { headers: { 'X-BT-Room': shardName(i + 1) } }))
        .then(r => r.json()).catch(() => null)));
    parts.push(...extra.filter(Boolean));
  }
  const out = { online: 0, recruits: 0, regions: {}, countries: {}, unknownRegion: 0, players: [], sectors: [] };
  parts.forEach((p, i) => {
    out.online += p.online || 0;
    out.recruits += p.recruits || 0;
    out.unknownRegion += p.unknownRegion || 0;
    for (const [k, v] of Object.entries(p.regions || {})) out.regions[k] = (out.regions[k] || 0) + v;
    for (const [k, v] of Object.entries(p.countries || {})) out.countries[k] = (out.countries[k] || 0) + v;
    if (out.players.length < 200) out.players.push(...(p.players || []).slice(0, 200 - out.players.length));
    out.sectors.push({ name: shardName(i), online: p.online || 0 });
  });
  return out;
}

function profilesStub(env) {
  return env.PROFILES.get(env.PROFILES.idFromName(PROFILES_SHARD));
}
function eventsStub(env) {
  return env.EVENTS.get(env.EVENTS.idFromName(EVENTS_SHARD));
}

// ============================================
// Main Worker
// ============================================
export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e) {
      console.error('Unhandled error:', e && e.stack || e);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request.headers.get('Origin') || '') }
      });
    }
  }
};

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  const path = url.pathname.replace(/\/+$/, '') || '/';
  setExtraOrigins(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  if (path === '/api/health') {
    return json({ status: 'ok', time: Date.now() }, 200, origin);
  }

  // Recruit-bot kill switch. GET = status, POST {"enabled": false|true}. Admin key as Bearer.
  // Applies to every public sector (main, main-2 … main-8); the flag lives in each room's storage.
  if (path === '/api/admin/bots') {
    if (!authorizeAdmin(request.headers.get('Authorization'), env.EVENTS_ADMIN_KEY)) {
      return json({ error: 'unauthorized' }, 401, origin);
    }
    let body = null;
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (typeof b.enabled !== 'boolean') return json({ error: 'enabled must be true or false' }, 400, origin);
      body = JSON.stringify({ enabled: b.enabled });
    } else if (request.method !== 'GET') {
      return json({ error: 'method' }, 405, origin);
    }
    const rooms = await Promise.all(Array.from({ length: ROOM_SHARDS }, (_, i) => {
      const name = shardName(i);
      const stub = env.TRENCH_ROOM.get(env.TRENCH_ROOM.idFromName(name));
      return stub.fetch(new Request('http://internal/bots', { method: body ? 'POST' : 'GET', body, headers: { 'X-BT-Room': name } }))
        .then((r) => r.json()).catch((e) => ({ room: name, error: String(e && e.message || e) }));
    }));
    return json({ ok: true, envDisabled: String(env.BOTS_ENABLED || '').trim() === '0', rooms }, 200, origin);
  }

  if (path === '/api/campaign') {
    return json({ chapters: CHAPTERS }, 200, origin);
  }

  // Feature switches the client reads at boot.
  if (path === '/api/config') {
    return json({ levelsUnlocked: levelsUnlocked(env), levelDepth: LEVEL_DEPTH_M, maxLevel: MAX_LEVEL, saves: true }, 200, origin);
  }

  // Save game: logged-in (Privy / Farcaster) profiles only. Guests keep the old run-and-done play.
  if (path === '/api/save') {
    const v = await authFromRequest(request, env);
    if (!v) return json({ ok: false, error: 'login_required' }, 401, origin);
    const profiles = profilesStub(env);
    if (request.method === 'GET') {
      const r = await profiles.fetch(new Request(`http://internal/save?id=${encodeURIComponent(v.id)}`));
      return json(await r.json(), r.status, origin);
    }
    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400, origin); }
      const snapshot = body && typeof body.snapshot === 'object' ? body.snapshot : body;
      if (!snapshot || JSON.stringify(snapshot).length > 4096) return json({ ok: false, error: 'bad_save' }, 400, origin);
      const r = await profiles.fetch(new Request('http://internal/save', {
        method: 'POST',
        body: JSON.stringify({ profileId: v.id, input: snapshot, serverPos: null, sector: null })
      }));
      return json(await r.json(), r.status, origin);
    }
    return json({ error: 'method' }, 405, origin);
  }

  // Elevator: GET = your stops, POST {depth} = start a run at that stop (saved). Logged-in only.
  if (path === '/api/elevator') {
    const v = await authFromRequest(request, env);
    if (!v) return json({ ok: false, error: 'login_required', stops: elevatorStops({ unlocked: levelsUnlocked(env) }) }, 401, origin);
    const profiles = profilesStub(env);
    if (request.method === 'GET') {
      const r = await profiles.fetch(new Request(`http://internal/elevator?id=${encodeURIComponent(v.id)}`));
      return json(await r.json(), r.status, origin);
    }
    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400, origin); }
      const r = await profiles.fetch(new Request('http://internal/elevator', {
        method: 'POST',
        body: JSON.stringify({ profileId: v.id, depth: Math.floor(Number(body && body.depth)), sector: typeof (body && body.sector) === 'string' ? body.sector.slice(0, 12) : null })
      }));
      return json(await r.json(), r.status, origin);
    }
    return json({ error: 'method' }, 405, origin);
  }

  // Skill tree: POST {action:'learn', skill} | {action:'reset'}. Same auth as profile writes.
  if (path === '/api/skills' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400, origin); }
    const id = typeof body.id === 'string' ? body.id : (await authFromRequest(request, env) || {}).id;
    if (!id) return json({ ok: false, error: 'Auth required' }, 401, origin);
    const gate = await requireProfileWrite(request, env, id);
    if (gate.error) return json({ ok: false, error: gate.error }, gate.status, origin);
    const profiles = profilesStub(env);
    if (gate.secretHash) {
      const chk = await profiles.fetch(new Request('http://internal/check-guest', { method: 'POST', body: JSON.stringify({ id, secretHash: gate.secretHash }) }));
      if (!(await chk.json()).ok) return json({ ok: false, error: 'Not your profile' }, 403, origin);
    }
    const r = await profiles.fetch(new Request('http://internal/skills', {
      method: 'POST',
      body: JSON.stringify({ profileId: id, action: body.action, skill: typeof body.skill === 'string' ? body.skill.slice(0, 20) : null })
    }));
    return json(await r.json(), r.status, origin);
  }

  if (path === '/presence' || path === '/api/presence') {
    const now = Date.now();
    if (!presenceCache || now - presenceCache.at > PRESENCE_CACHE_MS) {
      presenceCache = { at: now, body: presenceAll(env).catch((e) => { presenceCache = null; throw e; }) };
    }
    return json(await presenceCache.body, 200, origin);
  }

  if (path === '/api/ws') {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426, headers: corsHeaders(origin) });
    }
    const roomName = (url.searchParams.get('room') || 'main').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'main';
    let verifiedProfileId = null;
    const token = url.searchParams.get('token');
    const guestId = url.searchParams.get('profileId');
    const guestSecret = url.searchParams.get('secret');
    if (token) {
      const v = await verifyIncomingToken(token, env);
      if (v) verifiedProfileId = v.id;
    } else if (guestId && guestSecret && GUEST_ID_RE.test(guestId)) {
      const res = await profilesStub(env).fetch(new Request('http://internal/check-guest', {
        method: 'POST',
        body: JSON.stringify({ id: guestId, secretHash: await sha256Hex(guestSecret) })
      }));
      if ((await res.json()).ok) verifiedProfileId = guestId;
    }
    const headers = new Headers(request.headers);
    headers.delete('X-BT-Profile');
    headers.delete('X-BT-Geo');
    if (verifiedProfileId) headers.set('X-BT-Profile', verifiedProfileId);
    headers.set('X-BT-Geo', geoHeader(request.cf));
    // 'main' overflows into sectors main-2 … main-8 when full (503). Other room names are used as-is.
    const tries = roomName === 'main' ? ROOM_SHARDS : 1;
    let res;
    for (let i = 0; i < tries; i++) {
      const name = roomName === 'main' ? shardName(i) : roomName;
      headers.set('X-BT-Room', name);
      res = await env.TRENCH_ROOM.get(env.TRENCH_ROOM.idFromName(name)).fetch(new Request(request, { headers }));
      if (res.status !== 503) {
        if (i > 0) {
          const hint = env.TRENCH_ROOM.get(env.TRENCH_ROOM.idFromName('main'))
            .fetch(new Request(`http://internal/shard-hint?n=${i + 1}`, { method: 'POST' })).catch(() => {});
          if (ctx && ctx.waitUntil) ctx.waitUntil(hint);
        }
        return res;
      }
    }
    return res;
  }

  if (path === '/api/profile/migrate' && request.method === 'POST') {
    let data;
    try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, origin); }
    const privy = await authFromRequest(request, env);
    if (!privy || privy.kind !== 'privy') return json({ error: 'Privy auth required' }, 401, origin);
    const fromId = data.from || data.fromId;
    if (!fromId) return json({ error: 'from required' }, 400, origin);
    let secretHash = null;
    if (GUEST_ID_RE.test(fromId)) {
      const secret = data.guestSecret || request.headers.get('X-Guest-Secret');
      if (!secret) return json({ error: 'Guest secret required' }, 401, origin);
      secretHash = await sha256Hex(secret);
    } else if (fromId.startsWith('fid:')) {
      const fc = data.farcasterToken || data.fcToken;
      const fid = fc ? await verifyFcJwt(fc) : (privy.fid || null);
      // Accept if they also sent a FC token proving the fid, or if fromId matches a verified FC on this request.
      const headerFc = request.headers.get('X-Farcaster-Token');
      const proved = (fc && fid && fromId === `fid:${fid}`) || (headerFc && fromId === `fid:${await verifyFcJwt(headerFc)}`);
      if (!proved) return json({ error: 'Farcaster proof required' }, 403, origin);
    } else {
      return json({ error: 'Can only migrate guest or Farcaster profiles' }, 400, origin);
    }
    const res = await profilesStub(env).fetch(new Request('http://internal/migrate', {
      method: 'POST',
      body: JSON.stringify({ toId: privy.id, fromId, secretHash })
    }));
    return json(await res.json(), res.status, origin);
  }

  if (path === '/api/profile') {
    const profiles = profilesStub(env);
    if (request.method === 'POST') {
      let data;
      try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, origin); }
      if (!data || typeof data.id !== 'string') return json({ error: 'Missing id' }, 400, origin);
      const gate = await requireProfileWrite(request, env, data.id);
      if (gate.error) return json({ error: gate.error }, gate.status, origin);
      if (gate.fid) data.fid = gate.fid;
      if (gate.secretHash) data.secretHash = gate.secretHash;
      else delete data.secretHash;
      data.x_handle = sanitizeHandle(data.x_handle || data.xHandle);
      data.wallet = sanitizeWallet(data.wallet);
      data.name = filterProfanity(String(data.name || 'Trencher').slice(0, 20));
      data.pfp = typeof data.pfp === 'string' && /^https:\/\//.test(data.pfp) ? data.pfp.slice(0, 512) : null;
      const response = await profiles.fetch(new Request('http://internal/profile', {
        method: 'POST',
        body: JSON.stringify(data)
      }));
      return json(await response.json(), response.status, origin);
    }
    const id = url.searchParams.get('id') || '';
    const response = await profiles.fetch(new Request(`http://internal/profile?id=${encodeURIComponent(id)}`));
    return json(await response.json(), 200, origin);
  }

  if (path === '/api/leaderboard') {
    const t = url.searchParams.get('type');
    const type = t === 'depth' || t === 'squad' || t === 'level' ? t : 'xp';
    const response = await profilesStub(env).fetch(new Request(`http://internal/leaderboard?type=${type}`));
    return json(await response.json(), 200, origin);
  }

  if (path === '/api/squads/leaderboard') {
    const response = await profilesStub(env).fetch(new Request('http://internal/squads/leaderboard'));
    return json(await response.json(), 200, origin);
  }

  if (path === '/api/squads' || path === '/api/squads/join' || path === '/api/squads/leave' || path === '/api/squads/me' || path === '/api/squads/objective') {
    const profiles = profilesStub(env);
    if (request.method === 'GET') {
      const code = url.searchParams.get('code');
      if (path === '/api/squads/me' || url.searchParams.get('me')) {
        const v = await authFromRequest(request, env);
        const guestId = url.searchParams.get('profileId');
        const guestSecret = request.headers.get('X-Guest-Secret');
        let profileId = v && v.id;
        if (!profileId && guestId && guestSecret && GUEST_ID_RE.test(guestId)) {
          const chk = await profiles.fetch(new Request('http://internal/check-guest', {
            method: 'POST', body: JSON.stringify({ id: guestId, secretHash: await sha256Hex(guestSecret) })
          }));
          if ((await chk.json()).ok) profileId = guestId;
        }
        if (!profileId) return json({ success: true, squad: null }, 200, origin);
        const response = await profiles.fetch(new Request(`http://internal/squad?profileId=${encodeURIComponent(profileId)}`));
        return json(await response.json(), 200, origin);
      }
      const response = await profiles.fetch(new Request(`http://internal/squad?code=${encodeURIComponent(code || '')}`));
      return json(await response.json(), response.status, origin);
    }
    let data;
    try { data = await request.json(); } catch { data = {}; }
    const v = await authFromRequest(request, env);
    let profileId = v && v.id;
    if (!profileId) {
      const guestId = data.profileId || data.id;
      const secret = request.headers.get('X-Guest-Secret');
      if (guestId && secret && GUEST_ID_RE.test(guestId)) {
        const chk = await profiles.fetch(new Request('http://internal/check-guest', {
          method: 'POST', body: JSON.stringify({ id: guestId, secretHash: await sha256Hex(secret) })
        }));
        if ((await chk.json()).ok) profileId = guestId;
      }
    }
    if (!profileId) return json({ error: 'Auth required' }, 401, origin);
    const action = path.endsWith('/join') ? 'join' : path.endsWith('/leave') ? 'leave' : path.endsWith('/objective') ? 'objective' : (data.action || 'create');
    const response = await profiles.fetch(new Request('http://internal/squad', {
      method: 'POST',
      body: JSON.stringify({ ...data, action, profileId })
    }));
    return json(await response.json(), response.status, origin);
  }

  if (path === '/events' || path === '/api/events' || path === '/events.ics' || path === '/api/events.ics' || /^\/(?:api\/)?events\//.test(path)) {
    const stub = eventsStub(env);
    const forwarded = await stub.fetch(new Request('https://events.internal' + path + url.search, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'OPTIONS' ? undefined : await request.text()
    }));
    const ct = forwarded.headers.get('Content-Type') || '';
    if (ct.includes('text/calendar') || path.endsWith('.ics')) {
      return new Response(await forwarded.text(), {
        status: forwarded.status,
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="base-trenches.ics"',
          ...corsHeaders(origin)
        }
      });
    }
    return json(await forwarded.json().catch(() => ({ error: 'bad' })), forwarded.status, origin);
  }

  return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
}
