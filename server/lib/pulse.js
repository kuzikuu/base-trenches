// Pulse: one Durable Object for the whole game that aggregates server-validated pickups into the
// IN-GAME HOT LIST (1h / 24h / all-time), the Telegram-style feed, the Power of 9 meter + boost,
// and the daily / weekly / all-time boards (depth, gems, bosses, Power of 9 contribution).
// Rooms batch their notes (FLUSH_MS) so one busy room costs ~6 DO requests a minute, not one per gem.
import {
  P9, bucketOf, periodKeys, sanitizeTicker, collectibleKey, topKeys, sortCounts, chargeMeter, boostActive,
  mergeRow, rankRows, LB_METRICS, meterMax
} from './power9.js';

const DEFAULT_BOT_URL = 'https://base-trenches-bot.base-trenches.workers.dev';
const ALLOW_TTL_MS = 10 * 60_000;
const FEED_KINDS = new Set(['dig', 'streak', 'boss', 'manifest', 'perk']);
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));

/** In-memory state + rules. The DO persists what each call touched. Node tests use it directly. */
export class PulseCore {
  constructor(max = P9.METER_MAX) {
    this.max = max;
    this.buckets = {};      // bucket -> { key: n }   (last 24 h)
    this.allTime = {};      // key -> n
    this.boards = {};       // period -> { pid: row }
    this.feed = [];         // [{ seq, t, kind, ... }]
    this.seq = 0;
    this.meter = 0;
    this.boost = null;      // { id, start, until }
    this.charge = {};       // pid -> { name, p } contributions to the current charge
    this.lastCharge = [];   // top contributors of the last fill
    this.allow = new Set(); // hot-list tickers from the Telegram bot
  }

  /** Map a room's raw key ('GEM' | 'RELIC' | 'P:TICKER') to a hot-list key. */
  keyFor(raw) {
    if (raw === 'GEM') return 'GEM';
    if (raw === 'RELIC') return 'RELIC';
    if (typeof raw === 'string' && raw.startsWith('P:')) return collectibleKey('power', raw.slice(2), this.allow);
    if (raw === 'POWER') return 'POWER GEM';
    return null;
  }

  prune(now) {
    const keepFrom = bucketOf(now - 24 * 3600_000);
    const dropped = [];
    for (const b of Object.keys(this.buckets)) if (Number(b) < keepFrom) { delete this.buckets[b]; dropped.push(Number(b)); }
    const pk = periodKeys(now);
    const live = new Set([pk.day, pk.week, 'all']);
    const droppedPeriods = [];
    for (const p of Object.keys(this.boards)) if (!live.has(p)) { delete this.boards[p]; droppedPeriods.push(p); }
    return { dropped, droppedPeriods, keepFrom };
  }

  /**
   * batch: { counts: {raw: n}, players: [{ id, name, guest, depth, gems, boss, p9 }], feed: [...], points }
   * Returns what changed so the DO can write only that.
   */
  ingest(batch, now = Date.now()) {
    const out = { counts: [], rows: [], feed: [], fired: null, pruned: this.prune(now) };
    if (!batch || typeof batch !== 'object') return out;
    const b = bucketOf(now);
    const counts = batch.counts && typeof batch.counts === 'object' ? Object.entries(batch.counts).slice(0, P9.MAX_KEYS_PER_BATCH) : [];
    for (const [raw, v] of counts) {
      const k = this.keyFor(raw); const n = int(v, 0, P9.MAX_COUNT_PER_KEY);
      if (!k || !n) continue;
      const m = this.buckets[b] || (this.buckets[b] = {});
      m[k] = (m[k] || 0) + n;
      this.allTime[k] = (this.allTime[k] || 0) + n;
      out.counts.push([b, k, m[k]], [0, k, this.allTime[k]]);
    }
    const pk = periodKeys(now);
    let points = 0;
    const players = Array.isArray(batch.players) ? batch.players.slice(0, P9.MAX_PLAYERS_PER_BATCH) : [];
    for (const p of players) {
      if (!p || typeof p.id !== 'string' || p.id.length > 80) continue;
      const add = { name: String(p.name || 'trencher').slice(0, 24), depth: int(p.depth, 0, 1e6), gems: int(p.gems, 0, 2000), boss: int(p.boss, 0, 20), p9: int(p.p9, 0, 2000) };
      points += add.p9;
      if (add.p9) { const c = this.charge[p.guest ? 'anon' : p.id] || { name: p.guest ? 'anon trencher' : add.name, p: 0 }; c.p += add.p9; this.charge[p.guest ? 'anon' : p.id] = c; }
      if (p.guest) continue; // guests count toward the hot list and the meter, never the boards
      for (const per of [pk.day, pk.week, 'all']) {
        const board = this.boards[per] || (this.boards[per] = {});
        board[p.id] = mergeRow(board[p.id], add);
        out.rows.push([per, p.id, board[p.id]]);
      }
    }
    points += int(batch.points, 0, P9.MAX_POINTS_PER_BATCH);
    points = Math.min(points, P9.MAX_POINTS_PER_BATCH);
    const feed = Array.isArray(batch.feed) ? batch.feed.slice(0, P9.MAX_FEED_PER_BATCH) : [];
    for (const f of feed) {
      if (!f || !FEED_KINDS.has(f.kind)) continue;
      const it = { seq: ++this.seq, t: now, kind: f.kind, who: String(f.who || 'trencher').slice(0, 24) };
      if (f.kind === 'dig') { it.key = this.keyFor(f.key); it.n = int(f.n, 1, 99); if (!it.key) continue; }
      if (f.depth != null) it.depth = int(f.depth, 0, 1e6);
      if (f.kind === 'boss') it.boss = String(f.boss || 'THE BOSS').replace(/[^A-Z0-9 #]/gi, '').slice(0, 20).toUpperCase();
      if (f.kind === 'perk') { it.level = int(f.level, 1, 999); it.tier = int(f.tier, 1, P9.PERK_MAX_TIER); }
      this.pushFeed(it, out);
    }
    if (points) {
      const r = chargeMeter({ meter: this.meter, max: this.max, boost: this.boost }, points, now);
      this.meter = r.meter; this.boost = r.boost;
      if (r.fired) {
        out.fired = this.boost;
        this.lastCharge = Object.values(this.charge).sort((a, b) => b.p - a.p).slice(0, 9).map(c => ({ name: c.name, p: c.p }));
        this.charge = {};
        this.pushFeed({ seq: ++this.seq, t: now, kind: 'boost' }, out);
      }
    }
    out.points = points;
    return out;
  }

  pushFeed(it, out) {
    this.feed.push(it);
    if (this.feed.length > P9.FEED_MAX) this.feed.splice(0, this.feed.length - P9.FEED_MAX);
    if (out) out.feed.push(it);
  }

  /** What rooms and clients need every few seconds. */
  live(now = Date.now(), since = 0) {
    return {
      meter: this.meter, max: this.max, now,
      boost: boostActive(this.boost, now) || (this.boost && this.boost.start > now) ? this.boost : null,
      lastCharge: this.lastCharge,
      feed: this.feed.filter(f => f.seq > since).slice(-12)
    };
  }

  state(now = Date.now()) {
    this.prune(now);
    return {
      ...this.live(now),
      feed: this.feed.slice(-30).reverse(),
      hot: { h1: topKeys(this.buckets, now, 3600_000), h24: topKeys(this.buckets, now, 24 * 3600_000), all: sortCounts(this.allTime) },
      tickers: [...this.allow]
    };
  }

  leaders(metric, period, now = Date.now()) {
    this.prune(now);
    const pk = periodKeys(now);
    const per = period === 'day' ? pk.day : period === 'week' ? pk.week : 'all';
    const m = LB_METRICS.includes(metric) ? metric : 'p9';
    const rows = Object.entries(this.boards[per] || {}).map(([id, r]) => ({ id, ...r }));
    return { metric: m, period: period === 'day' || period === 'week' ? period : 'all', key: per, rows: rankRows(rows, m) };
  }
}

export class Pulse {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.core = new PulseCore(meterMax(env));
    this.allowAt = 0;
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS counts (bucket INTEGER NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (bucket, k))');
      this.sql.exec('CREATE TABLE IF NOT EXISTS lb (period TEXT NOT NULL, pid TEXT NOT NULL, name TEXT, depth INTEGER, gems INTEGER, boss INTEGER, p9 INTEGER, PRIMARY KEY (period, pid))');
      this.sql.exec('CREATE TABLE IF NOT EXISTS feed (seq INTEGER PRIMARY KEY, item TEXT NOT NULL)');
      const now = Date.now();
      const from = bucketOf(now - 24 * 3600_000);
      for (const r of this.sql.exec('SELECT bucket, k, n FROM counts WHERE bucket = 0 OR bucket >= ?', from).toArray()) {
        if (r.bucket === 0) this.core.allTime[r.k] = r.n;
        else (this.core.buckets[r.bucket] || (this.core.buckets[r.bucket] = {}))[r.k] = r.n;
      }
      const pk = periodKeys(now);
      for (const r of this.sql.exec('SELECT * FROM lb WHERE period IN (?, ?, ?)', pk.day, pk.week, 'all').toArray()) {
        (this.core.boards[r.period] || (this.core.boards[r.period] = {}))[r.pid] = { name: r.name, depth: r.depth, gems: r.gems, boss: r.boss, p9: r.p9 };
      }
      this.core.feed = this.sql.exec('SELECT seq, item FROM feed ORDER BY seq DESC LIMIT ?', P9.FEED_MAX).toArray().reverse()
        .map(r => { try { return { ...JSON.parse(r.item), seq: r.seq }; } catch (e) { return null; } }).filter(Boolean);
      this.core.seq = this.core.feed.length ? this.core.feed[this.core.feed.length - 1].seq : 0;
      const kv = await state.storage.get(['meter', 'allow']);
      const m = kv.get('meter');
      if (m) { this.core.meter = Math.min(m.meter || 0, this.core.max - 1); this.core.boost = m.boost || null; this.core.charge = m.charge || {}; this.core.lastCharge = m.lastCharge || []; }
      const a = kv.get('allow');
      if (a && Array.isArray(a.list)) { this.core.allow = new Set(a.list); this.allowAt = a.at || 0; }
    });
  }

  async refreshAllow(now) {
    if (now - this.allowAt < ALLOW_TTL_MS) return;
    this.allowAt = now;
    const base = String((this.env && this.env.BOT_URL) || DEFAULT_BOT_URL).replace(/\/$/, '');
    try {
      const svc = this.env && this.env.BOT && typeof this.env.BOT.fetch === 'function' ? this.env.BOT : null;
      const req = new Request(base + '/api/hot', { headers: { 'Accept': 'application/json' } });
      const r = svc ? await svc.fetch(req) : await fetch(req, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error('hot ' + r.status);
      const j = await r.json();
      const list = (j.items || []).map(h => sanitizeTicker(h.symbol)).filter(Boolean).slice(0, 60);
      this.core.allow = new Set(list);
      this.allowSource = 'bot';
      await this.state.storage.put('allow', { list, at: now });
    } catch (e) {
      this.allowSource = 'error:' + String(e && e.message || e).slice(0, 60);
    }
  }

  persist(out) {
    for (const [bucket, k, n] of out.counts) this.sql.exec('INSERT INTO counts (bucket, k, n) VALUES (?, ?, ?) ON CONFLICT(bucket, k) DO UPDATE SET n = excluded.n', bucket, k, n);
    for (const [period, pid, r] of out.rows) {
      this.sql.exec('INSERT INTO lb (period, pid, name, depth, gems, boss, p9) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(period, pid) DO UPDATE SET name = excluded.name, depth = excluded.depth, gems = excluded.gems, boss = excluded.boss, p9 = excluded.p9',
        period, pid, r.name, r.depth, r.gems, r.boss, r.p9);
    }
    for (const it of out.feed) { const { seq, ...rest } = it; this.sql.exec('INSERT OR REPLACE INTO feed (seq, item) VALUES (?, ?)', seq, JSON.stringify(rest)); }
    if (out.feed.length) this.sql.exec('DELETE FROM feed WHERE seq <= ?', this.core.seq - P9.FEED_MAX);
    if (out.pruned.dropped.length) this.sql.exec('DELETE FROM counts WHERE bucket > 0 AND bucket < ?', out.pruned.keepFrom);
    for (const p of out.pruned.droppedPeriods) this.sql.exec('DELETE FROM lb WHERE period = ?', p);
    if (out.points || out.fired) {
      return this.state.storage.put('meter', { meter: this.core.meter, boost: this.core.boost, charge: this.core.charge, lastCharge: this.core.lastCharge });
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    if (url.pathname === '/ingest' && request.method === 'POST') {
      const batch = await request.json().catch(() => null);
      await this.refreshAllow(now);
      const out = this.core.ingest(batch, now);
      await this.persist(out);
      return Response.json(this.core.live(now, Math.floor(Number(url.searchParams.get('since')) || 0)));
    }
    if (url.pathname === '/state') {
      await this.refreshAllow(now);
      return Response.json({ ...this.core.state(now), allowSource: this.allowSource || (this.core.allow.size ? 'cache' : 'none') });
    }
    if (url.pathname === '/leaders') {
      return Response.json(this.core.leaders(url.searchParams.get('metric'), url.searchParams.get('period'), now));
    }
    return new Response('not found', { status: 404 });
  }
}
