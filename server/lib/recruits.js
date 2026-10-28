// NPC "recruits": cheap server-side bots that make a quiet trench feel populated.
// Pure logic (no Durable Object APIs) so node tests can cover it.
// Recruits are NOT players: they never touch Profiles, XP, squads, leaderboards,
// event tallies, presence counts or the world-map counts. Clients tag them [BOT].

export const BOT_ID_PREFIX = 'bot:';
export const BOT_TICK_MS = 1000;      // one cheap tick per second, only while humans are connected
export const BOT_FILL_TARGET = 11;    // humans + recruits we aim for in a quiet room
export const BOT_MAX = 10;
export const BOT_CHAT_EVERY_S = 18;   // room-wide: about one canned line per 18 s
export const BOT_CHAT_MIN_GAP_MS = 7000; // never two recruit lines closer than this

// World geometry mirrors js/game.js (TS=12, W=40, S=12, FLOOR=S+2).
export const WORLD = { TS: 12, W: 40, FLOOR: 14, PLAYER_H: 11 };
export const FLOOR_Y = WORLD.FLOOR * WORLD.TS - WORLD.PLAYER_H; // feet on the duckboards
export const MIN_X = 2 * WORLD.TS;
export const MAX_X = (WORLD.W - 3) * WORLD.TS;

const RANKS = ['PVT', 'PVT', 'PVT', 'LCPL', 'CPL'];
const SURNAMES = ['MUDD', 'DIGBY', 'SPADE', 'SANDBAG', 'BARROW', 'BURROWS', 'BRASS', 'HAVERSACK',
  'DUCKBOARD', 'PICKETT', 'TRENCHARD', 'GRAVEL', 'CLAY', 'FLINT', 'MORTAR', 'BUNKER'];

// Canned lines: WW1 trench life + Base / onchain meme culture.
// Rules: never name a coin or ticker, never make price or profit claims, never name real people.
export const LINES = [
  'Dig in, lads.',
  'Mind the duckboards.',
  'Heads down, shells incoming!',
  "Tea's up in the bunker.",
  'Hold the line.',
  "Mud's deep today.",
  'Who nicked my shovel?',
  'Stay based, stay low.',
  'GM trenchers.',
  'GM. Coffee is mud again.',
  'Power of 9, lads.',
  'Keep digging.',
  'Another day in the trenches.',
  'Sandbags first, glory later.',
  'Rats ate my rations again.',
  'Blue skies up top, mud down here.',
  'Built different. Built on Base.',
  'Onchain or in the mud, same grind.',
  'Sergeant says dig faster.',
  'Found a button. Not a gem.',
  'Quiet night. Too quiet.',
  'Boots are soaked through.',
  'Who is on watch tonight?',
  'Proof of dig.',
  'Touch grass? Only mud here.',
  'Write home, they said.',
  'Steady, steady...',
  'Shovel diff.'
];
export const EMOTES = ['GM', 'LFG', 'POWER OF 9'];
// Words a recruit line must never contain (checked by tests).
export const BANNED = /\$|\b(buy|sell|pump|dump|moon|100x|1000x|price|profit|invest|ape|airdrop|presale|ca:|0x)\b/i;

// Role registry. Only 'recruit' exists today; a future 'villain' role plugs in here
// with its own step() (e.g. lob shells, steal digs) and its own spawn rules.
export const ROLES = {
  recruit: { hostile: false, step: stepRecruit }
};

export function isBotId(id) {
  return typeof id === 'string' && id.startsWith(BOT_ID_PREFIX);
}

// How many recruits a room should have for this many connected humans.
// 0 humans -> 0 (room can hibernate); 1 human -> 10; ramps down; 11+ humans -> 0.
export function targetRecruitCount(humans) {
  if (!humans || humans <= 0) return 0;
  return Math.max(0, Math.min(BOT_MAX, BOT_FILL_TARGET - humans));
}

export function createRecruit(n, rng = Math.random, now = Date.now()) {
  const name = `${RANKS[(rng() * RANKS.length) | 0]} ${SURNAMES[(rng() * SURNAMES.length) | 0]}`;
  const x = MIN_X + Math.round(rng() * (MAX_X - MIN_X));
  return {
    id: `${BOT_ID_PREFIX}${n}`,
    bot: true,
    role: 'recruit',
    name,
    level: 1 + ((rng() * 6) | 0),
    x, y: FLOOR_Y, vx: 0, vy: 0, face: rng() < 0.5 ? -1 : 1, swing: 0,
    mode: 'idle',               // idle | walk | dig
    targetX: x,
    until: now + 1000 + rng() * 4000,
    // First line lands anywhere in the first ~2 minutes so a fresh room does not burst.
    nextChat: now + 6000 + rng() * BOT_CHAT_EVERY_S * BOT_MAX * 600
  };
}

// Advance one recruit by one tick. Returns side effects for the room to broadcast.
export function stepRecruit(bot, now, rng = Math.random, ctx = {}) {
  const out = [];
  const dt = (ctx.dtMs || BOT_TICK_MS) / 1000;
  bot.swing = 0;
  if (now >= bot.until) {
    const r = rng();
    if (r < 0.45) {
      bot.mode = 'walk';
      bot.targetX = MIN_X + Math.round(rng() * (MAX_X - MIN_X));
      bot.until = now + 2000 + rng() * 6000;
    } else if (r < 0.8) {
      bot.mode = 'dig';
      bot.until = now + 1500 + rng() * 3500;
    } else {
      bot.mode = 'idle';
      bot.until = now + 1500 + rng() * 5000;
    }
  }
  if (bot.mode === 'walk') {
    const speed = 30 + rng() * 15; // px/s, a slow trudge
    const dx = bot.targetX - bot.x;
    if (Math.abs(dx) < 3) { bot.mode = 'idle'; bot.vx = 0; }
    else {
      const step = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
      bot.x = Math.round(bot.x + step);
      bot.vx = Math.round(Math.sign(dx) * speed);
      bot.face = dx < 0 ? -1 : 1;
    }
  } else {
    bot.vx = 0;
    if (bot.mode === 'dig') bot.swing = 1; // pickaxe swing animation only; recruits do not change the shared map
  }
  bot.x = Math.max(MIN_X, Math.min(MAX_X, bot.x));
  bot.y = FLOOR_Y;

  const recruits = Math.max(1, ctx.recruits || 1);
  if (now >= bot.nextChat) {
    // Spread lines so the whole room hears roughly one every BOT_CHAT_EVERY_S seconds.
    bot.nextChat = now + (BOT_CHAT_EVERY_S * recruits * (0.6 + rng() * 0.8)) * 1000;
    const text = rng() < 0.2 ? EMOTES[(rng() * EMOTES.length) | 0] : LINES[(rng() * LINES.length) | 0];
    out.push({ type: 'chat', text });
  }
  return out;
}

// A human said GM / LFG / POWER OF 9: maybe one recruit answers in kind.
export function emoteReply(text, rng = Math.random) {
  const t = String(text || '').trim().toUpperCase();
  const hit = EMOTES.find(e => t === e || t.startsWith(e + ' ') || t === e + '!');
  if (!hit) return null;
  return rng() < 0.6 ? hit : null;
}

// Public shape sent to clients in the 'states' players list.
export function publicRecruit(b) {
  return { id: b.id, bot: true, role: b.role, name: b.name, pfp: null, level: b.level, xHandle: null,
    status: 'active', x: b.x, y: b.y, vx: b.vx, vy: 0, face: b.face, swing: b.swing };
}
