// Write-through from the bot's Durable Object SQLite to Oracle Autonomous Database
// (schema BASETRENCHES) over ORDS REST-enabled SQL. The DO stays the fast state and
// serialization point; every mutation enqueues an op in a local outbox, and flush()
// replays the outbox to ADB strictly in order, with retry/backoff and a dead-letter table.
// All values travel as ORDS bind variables; SQL text is constant.

const OUTBOX = [
  `CREATE TABLE IF NOT EXISTS adb_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, key TEXT, payload TEXT,
    attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, started INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS adb_dead (
    id INTEGER PRIMARY KEY, kind TEXT, key TEXT, payload TEXT, attempts INTEGER, last_error TEXT, created_at INTEGER, dead_at INTEGER)`,
];
export const MAX_ATTEMPTS = 10;

const bind = (name, value) => ({
  name,
  data_type: typeof value === "number" ? "NUMBER" : "VARCHAR2",
  value: value === undefined ? null : value,
});

const SQL = {
  user: `MERGE INTO bt_users u USING (SELECT :id AS telegram_id FROM dual) s ON (u.telegram_id = s.telegram_id)
WHEN MATCHED THEN UPDATE SET username = :username, first_name = :first_name, x_handle = :x_handle, updated_at = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT (telegram_id, username, first_name, x_handle, created_at)
  VALUES (s.telegram_id, :username, :first_name, :x_handle, NVL(bt_ts(:created_at), SYSTIMESTAMP))`,
  coin: `MERGE INTO bt_coins c USING (SELECT :ca AS ca FROM dual) s ON (c.ca = s.ca)
WHEN MATCHED THEN UPDATE SET symbol = :symbol, name = :name, pair_url = :pair_url, image = :image, status = :status,
  first_tagger_id = :first_tagger_id, first_tagged_at = bt_ts(:first_tagged_at), cur_price_usd = :cur_price,
  cur_mcap_usd = :cur_mcap, price_updated_at = bt_ts(:price_updated_at), updated_at = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT (ca, symbol, name, pair_url, image, status, first_tagger_id, first_tagged_at, cur_price_usd, cur_mcap_usd, price_updated_at)
  VALUES (s.ca, :symbol, :name, :pair_url, :image, :status, :first_tagger_id, bt_ts(:first_tagged_at), :cur_price, :cur_mcap, bt_ts(:price_updated_at))`,
  tag: `MERGE INTO bt_tags t USING (SELECT :ca AS ca, :uid AS telegram_id FROM dual) s
  ON (t.ca = s.ca AND t.telegram_id = s.telegram_id)
WHEN NOT MATCHED THEN INSERT (ca, telegram_id, tagged_at, chat_id, msg_id) VALUES (s.ca, s.telegram_id, bt_ts(:tagged_at), :chat_id, :msg_id)`,
  call: `MERGE INTO bt_calls k USING (SELECT :ca AS ca FROM dual) s ON (k.ca = s.ca)
WHEN MATCHED THEN UPDATE SET caller_id = :caller_id, status = :status, called_at = bt_ts(:called_at), call_price_usd = :call_price,
  call_mcap_usd = :call_mcap, ath_price_usd = :ath_price, ath_mcap_usd = :ath_mcap, ath_at = bt_ts(:ath_at),
  cur_price_usd = :cur_price, cur_mcap_usd = :cur_mcap, x_post_url = :x_post_url, replies = :replies, reposts = :reposts,
  likes = :likes, engagement_at = bt_ts(:engagement_at), pinned_at = bt_ts(:pinned_at), channel_msg_id = :channel_msg_id,
  group_msg_id = :group_msg_id, pin_channel_msg_id = :pin_channel_msg_id, updated_at = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT (ca, caller_id, status, called_at, call_price_usd, call_mcap_usd, ath_price_usd, ath_mcap_usd, ath_at,
  cur_price_usd, cur_mcap_usd, x_post_url, replies, reposts, likes, engagement_at, pinned_at, channel_msg_id, group_msg_id, pin_channel_msg_id)
  VALUES (s.ca, :caller_id, :status, bt_ts(:called_at), :call_price, :call_mcap, :ath_price, :ath_mcap, bt_ts(:ath_at),
  :cur_price, :cur_mcap, :x_post_url, :replies, :reposts, :likes, bt_ts(:engagement_at), bt_ts(:pinned_at), :channel_msg_id, :group_msg_id, :pin_channel_msg_id)`,
  call_tagger: `MERGE INTO bt_call_taggers x USING (SELECT :ca AS ca, :uid AS telegram_id FROM dual) s
  ON (x.ca = s.ca AND x.telegram_id = s.telegram_id)
WHEN NOT MATCHED THEN INSERT (ca, telegram_id, position, tagged_at) VALUES (s.ca, s.telegram_id, :pos, bt_ts(:tagged_at))`,
  price: `MERGE INTO bt_price_snapshots p USING (SELECT :ca AS ca, :t AS captured_ms FROM dual) s
  ON (p.ca = s.ca AND p.captured_ms = s.captured_ms)
WHEN NOT MATCHED THEN INSERT (ca, price_usd, mcap_usd, captured_ms, captured_at) VALUES (s.ca, :price, :mcap, s.captured_ms, bt_ts(:t))`,
  engagement: `MERGE INTO bt_engagement_snapshots e USING (SELECT :ca AS ca, :t AS captured_ms FROM dual) s
  ON (e.ca = s.ca AND e.captured_ms = s.captured_ms)
WHEN NOT MATCHED THEN INSERT (ca, post_url, replies, reposts, likes, captured_ms, captured_at)
  VALUES (s.ca, :post_url, :replies, :reposts, :likes, s.captured_ms, bt_ts(:t))`,
};
export { SQL as ADB_SQL };

export class AdbSink {
  // db: bot's local SQLite adapter; fetch: fetch impl; config(): {url, user, password} or null
  constructor({ db, fetch, config, now = () => Date.now(), log = () => {} }) {
    Object.assign(this, { db, fetchImpl: fetch, config, now, log });
    for (const s of OUTBOX) db.q(s);
    this.busy = null;
    this.lastOkAt = null; this.lastError = null; this.lastErrorAt = null;
    this.pingCache = null;
  }
  q(s, ...p) { return this.db.q(s, ...p); }

  enqueue(kind, key = null, payload = null) {
    if (key != null && this.q("SELECT 1 AS x FROM adb_outbox WHERE kind=? AND key=? AND started=0", kind, String(key)).length) return false;
    this.q("INSERT INTO adb_outbox (kind,key,payload,created_at) VALUES (?,?,?,?)", kind, key == null ? null : String(key), payload == null ? null : JSON.stringify(payload), this.now());
    return true;
  }

  // One ORDS REST-enabled SQL call. Throws on HTTP or ORA errors (ORDS returns 200 with errorCode).
  async exec(statementText, binds = []) {
    const cfg = this.config();
    if (!cfg) throw new Error("adb not configured");
    const r = await this.fetchImpl(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${cfg.user}:${cfg.password}`) },
      body: JSON.stringify({ statementText, binds }),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
    });
    if (!r.ok) throw new Error(`ords http ${r.status}`);
    const j = await r.json();
    const bad = (j.items || []).find((it) => it.errorCode);
    if (bad) throw new Error(`ORA-${String(bad.errorCode).padStart(5, "0")} ${String(bad.errorMessage || "").split("\n")[0].slice(0, 160)}`);
    return j;
  }

  // Build the statements for one outbox row from the CURRENT local state (idempotent upserts).
  build(row) {
    const p = row.payload ? JSON.parse(row.payload) : null;
    const st = [];
    const userStmt = (u) => [SQL.user, [bind("id", u.user_id), bind("username", u.username), bind("first_name", u.first_name), bind("x_handle", u.x_handle), bind("created_at", u.created_at)]];
    if (row.kind === "user") {
      const u = this.q("SELECT * FROM users WHERE user_id=?", Number(row.key))[0];
      if (u) st.push(userStmt(u));
    } else if (row.kind === "coin") {
      const c = this.q("SELECT * FROM coins WHERE ca=?", row.key)[0];
      if (!c) return st;
      const tags = this.q("SELECT t.*, u.user_id AS uid FROM tags t JOIN users u ON u.user_id=t.user_id WHERE t.ca=? ORDER BY t.tagged_at, t.rowid", c.ca);
      const uids = new Set([c.first_tagger_id, ...tags.map((t) => t.user_id)].filter((x) => x != null));
      for (const id of uids) { const u = this.q("SELECT * FROM users WHERE user_id=?", id)[0]; if (u) st.push(userStmt(u)); }
      st.push([SQL.coin, [bind("ca", c.ca), bind("symbol", c.symbol), bind("name", c.name), bind("pair_url", c.pair_url), bind("image", c.image),
        bind("status", c.status), bind("first_tagger_id", c.first_tagger_id), bind("first_tagged_at", c.first_tagged_at), bind("cur_price", c.cur_price),
        bind("cur_mcap", c.cur_mcap), bind("price_updated_at", c.price_updated_at)]]);
      for (const t of tags) st.push([SQL.tag, [bind("ca", c.ca), bind("uid", t.user_id), bind("tagged_at", t.tagged_at), bind("chat_id", t.chat_id), bind("msg_id", t.msg_id)]]);
      if (c.status !== "tagging" && c.powered_at) {
        st.push([SQL.call, [bind("ca", c.ca), bind("caller_id", c.first_tagger_id), bind("status", c.status), bind("called_at", c.powered_at),
          bind("call_price", c.call_price), bind("call_mcap", c.call_mcap), bind("ath_price", c.ath_price), bind("ath_mcap", c.ath_mcap), bind("ath_at", c.ath_at),
          bind("cur_price", c.cur_price), bind("cur_mcap", c.cur_mcap), bind("x_post_url", c.x_post_url), bind("replies", c.replies), bind("reposts", c.reposts),
          bind("likes", c.likes), bind("engagement_at", c.engagement_at), bind("pinned_at", c.pinned_at), bind("channel_msg_id", c.channel_msg_id),
          bind("group_msg_id", c.group_msg_id), bind("pin_channel_msg_id", c.pin_channel_msg_id)]]);
        tags.slice(0, 9).forEach((t, i) => st.push([SQL.call_tagger, [bind("ca", c.ca), bind("uid", t.user_id), bind("pos", i + 1), bind("tagged_at", t.tagged_at)]]));
      }
    } else if (row.kind === "price" && p) {
      st.push([SQL.price, [bind("ca", p.ca), bind("t", p.t), bind("price", p.price), bind("mcap", p.mcap)]]);
    } else if (row.kind === "engagement" && p) {
      st.push([SQL.engagement, [bind("ca", p.ca), bind("t", p.t), bind("post_url", p.post_url), bind("replies", p.replies), bind("reposts", p.reposts), bind("likes", p.likes)]]);
    }
    return st;
  }

  // Wrap several statements in one PL/SQL block. Bind names are suffixed per statement so they
  // never collide; ORDS commits the block as one unit.
  static combine(stmts) {
    if (stmts.length === 1) return { sql: stmts[0][0], binds: stmts[0][1] };
    const parts = [], binds = [];
    stmts.forEach(([sql, bs], i) => {
      let s = sql;
      const names = bs.map((b) => b.name).sort((a, b) => b.length - a.length);
      for (const n of names) s = s.replace(new RegExp(`:${n}\\b`, "g"), `:${n}_${i}`);
      parts.push(s + ";");
      for (const b of bs) binds.push({ ...b, name: `${b.name}_${i}` });
    });
    return { sql: "BEGIN\n" + parts.join("\n") + "\nEND;", binds };
  }

  flush(max = 50) {
    if (this.busy) return this.busy;
    this.busy = this._flush(max).finally(() => { this.busy = null; });
    return this.busy;
  }
  async _flush(max) {
    if (!this.config()) return { sent: 0, skipped: "not configured" };
    let sent = 0;
    for (let i = 0; i < max; i++) {
      const row = this.q("SELECT * FROM adb_outbox ORDER BY id LIMIT 1")[0];
      if (!row) break;
      if (row.next_at > this.now()) break; // head of queue is backing off; keep order
      this.q("UPDATE adb_outbox SET started=1 WHERE id=?", row.id);
      try {
        const stmts = this.build(row);
        if (stmts.length) { const { sql, binds } = AdbSink.combine(stmts); await this.exec(sql, binds); }
        this.q("DELETE FROM adb_outbox WHERE id=?", row.id);
        this.lastOkAt = this.now(); sent++;
      } catch (e) {
        const msg = String((e && e.message) || e).slice(0, 300);
        const attempts = row.attempts + 1;
        this.lastError = msg; this.lastErrorAt = this.now();
        this.log("adb_error", row.kind, row.key, msg);
        if (attempts >= MAX_ATTEMPTS) {
          this.q("INSERT INTO adb_dead (id,kind,key,payload,attempts,last_error,created_at,dead_at) VALUES (?,?,?,?,?,?,?,?)", row.id, row.kind, row.key, row.payload, attempts, msg, row.created_at, this.now());
          this.q("DELETE FROM adb_outbox WHERE id=?", row.id);
          continue;
        }
        const backoff = Math.min(600000, 5000 * 2 ** (attempts - 1));
        this.q("UPDATE adb_outbox SET attempts=?, next_at=?, started=0, last_error=? WHERE id=?", attempts, this.now() + backoff, msg, row.id);
        break;
      }
    }
    return { sent, pending: this.pending() };
  }

  pending() { return this.q("SELECT COUNT(*) AS n FROM adb_outbox")[0].n; }
  nextRetryAt() { const r = this.q("SELECT MIN(next_at) AS t FROM adb_outbox")[0]; return r && r.t != null ? r.t : null; }

  // One-time: enqueue every user and coin already in the DO.
  backfill(force = false) {
    const done = this.q("SELECT v FROM kv WHERE k='adb_backfilled'")[0];
    if (done && !force) return { skipped: true };
    const users = this.q("SELECT user_id FROM users ORDER BY user_id");
    const coins = this.q("SELECT ca FROM coins ORDER BY first_tagged_at");
    for (const u of users) this.enqueue("user", u.user_id);
    for (const c of coins) this.enqueue("coin", c.ca);
    this.q("INSERT INTO kv (k,v) VALUES ('adb_backfilled',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", String(this.now()));
    return { users: users.length, coins: coins.length };
  }

  async ping() {
    if (this.pingCache && this.now() - this.pingCache.at < 60000) return this.pingCache.ok;
    let ok = false;
    try { await this.exec("SELECT 1 AS ok FROM dual"); ok = true; this.lastOkAt = this.now(); } catch (e) { this.lastError = String(e.message || e); this.lastErrorAt = this.now(); }
    this.pingCache = { at: this.now(), ok };
    return ok;
  }

  // Write test: insert a synthetic row in bt_health_checks, read it back, delete it.
  async writeCheck() {
    const id = "hc-" + this.now() + "-" + Math.random().toString(36).slice(2, 8);
    await this.exec("INSERT INTO bt_health_checks (id, note) VALUES (:id, :note)", [bind("id", id), bind("note", "write check")]);
    const j = await this.exec("SELECT COUNT(*) AS n FROM bt_health_checks WHERE id = :id", [bind("id", id)]);
    const n = j.items?.[0]?.resultSet?.items?.[0]?.n;
    await this.exec("DELETE FROM bt_health_checks WHERE id = :id", [bind("id", id)]);
    const j2 = await this.exec("SELECT COUNT(*) AS n FROM bt_health_checks WHERE id = :id", [bind("id", id)]);
    return { inserted: n === 1, deleted: j2.items?.[0]?.resultSet?.items?.[0]?.n === 0 };
  }

  async health() {
    const configured = !!this.config();
    const ok = configured ? await this.ping() : false;
    const dead = this.q("SELECT COUNT(*) AS n FROM adb_dead")[0].n;
    const iso = (t) => (t ? new Date(t).toISOString() : null);
    return { configured, ok, pending: this.pending(), dead, last_ok_at: iso(this.lastOkAt), last_error: this.lastError, last_error_at: iso(this.lastErrorAt) };
  }
}
