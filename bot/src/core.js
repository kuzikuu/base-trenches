// Base Trenches "Power of 9" bot core.
// Pure logic shared by the Cloudflare Worker (Durable Object SQLite) and the
// optional Node VM poller. Everything external is injected:
//   db.q(sql, ...params) -> array of row objects (SQLite dialect)
//   tg(method, params)   -> Telegram Bot API result (throws on error)
//   fetchJson(url)       -> parsed JSON or null
//   now()                -> epoch ms

export const THRESH = { tags: 9, replies: 5, reposts: 8, likes: 9 };
export const HIT_X = 2;
export const LINKS = {
  site: "https://base-trenches.pages.dev",
  x: "https://x.com/powerof9base",
  channel: "https://t.me/powerof9base",
  group: "https://t.me/+vjKJdDAMAJQxZGYx",
};
const DAY = 86400000;

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS coins (
    ca TEXT PRIMARY KEY, symbol TEXT, name TEXT, pair_url TEXT, image TEXT,
    status TEXT NOT NULL DEFAULT 'tagging',
    first_tagger_id INTEGER, first_tagged_at INTEGER,
    powered_at INTEGER, pinned_at INTEGER,
    call_price REAL, call_mcap REAL, cur_price REAL, cur_mcap REAL,
    ath_price REAL, ath_mcap REAL, ath_at INTEGER, price_updated_at INTEGER,
    x_post_url TEXT, replies INTEGER, reposts INTEGER, likes INTEGER, engagement_at INTEGER,
    channel_msg_id INTEGER, group_msg_id INTEGER, pin_channel_msg_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    ca TEXT NOT NULL, user_id INTEGER NOT NULL, tagged_at INTEGER NOT NULL,
    chat_id INTEGER, msg_id INTEGER, PRIMARY KEY (ca, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, x_handle TEXT, created_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS rate (
    user_id INTEGER PRIMARY KEY, win_start INTEGER, n INTEGER, last_at INTEGER, warned_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
];

export function migrate(db) {
  for (const s of SCHEMA) db.q(s);
}

export function kvGet(db, k) {
  const r = db.q("SELECT v FROM kv WHERE k=?", k)[0];
  return r ? r.v : null;
}
export function kvSet(db, k, v) {
  db.q("INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v));
}

// ---------- parsing ----------
const ADDR = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
export function parseTarget(text) {
  const t = String(text || "");
  const ds = t.match(/dexscreener\.com\/([a-z0-9-]+)\/(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])/i);
  if (ds) return ds[1].toLowerCase() === "base" ? { addr: ds[2].toLowerCase(), via: "dexscreener" } : { error: "not_base" };
  const bs = t.match(/basescan\.org\/(?:token|address)\/(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])/i);
  if (bs) return { addr: bs[1].toLowerCase(), via: "basescan" };
  if (/etherscan\.io|solscan|bscscan|arbiscan|polygonscan/i.test(t) && !/basescan/i.test(t)) return { error: "not_base" };
  const a = t.match(ADDR);
  if (a) return { addr: a[0].toLowerCase(), via: "ca" };
  return null;
}

export function parseCommand(text, botUsername) {
  const m = String(text || "").trim().match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return { cmd: null, foreign: true };
  return { cmd: m[1].toLowerCase(), arg: (m[3] || "").trim() };
}

export function normalizeXHandle(h) {
  const m = String(h || "").trim().match(/^@?([A-Za-z0-9_]{1,15})$/);
  return m ? "@" + m[1] : null;
}
export function normalizeXStatus(u) {
  const m = String(u || "").trim().match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/i);
  return m ? `https://x.com/${m[1]}/status/${m[2]}` : null;
}

// ---------- DexScreener ----------
function bestBasePair(pairs, addr) {
  const mine = (pairs || []).filter((p) => p && p.chainId === "base" && String(p.baseToken?.address || "").toLowerCase() === addr);
  mine.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return mine[0] || null;
}
function tokFromPair(p, addr) {
  const price = Number(p.priceUsd);
  return {
    ca: addr,
    symbol: String(p.baseToken.symbol || "?").slice(0, 24),
    name: String(p.baseToken.name || "").slice(0, 64),
    price: Number.isFinite(price) && price > 0 ? price : null,
    mcap: Number(p.marketCap || p.fdv) || null,
    pair_url: typeof p.url === "string" ? p.url : `https://dexscreener.com/base/${addr}`,
    image: p.info?.imageUrl || null,
    liquidity: p.liquidity?.usd || 0,
  };
}
// -> {ok:true, tok} | {ok:false, reason:'not_found'|'not_base'}
export async function resolveToken(addr, fetchJson, depth = 0) {
  addr = addr.toLowerCase();
  const j = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
  const pairs = (j && j.pairs) || [];
  const p = bestBasePair(pairs, addr);
  if (p) return { ok: true, tok: tokFromPair(p, addr) };
  if (pairs.some((x) => x.chainId !== "base")) return { ok: false, reason: "not_base" };
  if (depth === 0) {
    // maybe a DexScreener pair address
    const k = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/base/${addr}`);
    const pp = ((k && (k.pairs || (k.pair ? [k.pair] : []))) || []).filter((x) => x && x.chainId === "base");
    const t = pp[0]?.baseToken?.address;
    if (t && t.toLowerCase() !== addr) return resolveToken(t, fetchJson, 1);
  }
  return { ok: false, reason: "not_found" };
}

// ---------- formatting ----------
export const fmtUsd = (n) =>
  n == null ? "—" : n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + Number(n).toFixed(0);
export const fmtPrice = (p) => {
  if (p == null) return "—";
  if (p >= 1) return "$" + p.toFixed(4);
  const s = p.toPrecision(4);
  return "$" + (s.includes("e") ? Number(s).toFixed(12).replace(/0+$/, "") : s);
};
export const fmtX = (m) => (m == null || !isFinite(m) ? "—" : m >= 100 ? m.toFixed(0) + "x" : m >= 10 ? m.toFixed(1) + "x" : m.toFixed(2) + "x");
export const bar = (n, max = THRESH.tags) => "▰".repeat(Math.min(n, max)) + "▱".repeat(Math.max(0, max - n));
const who = (u) => (u?.username ? "@" + u.username : u?.first_name || "trencher");
const whoHtml = (u) => (u?.username ? `<a href="https://t.me/${esc(u.username)}">@${esc(u.username)}</a>` : esc(u?.first_name || "trencher"));
export function multiples(c) {
  const r = (a, b) => (a != null && b != null && b > 0 ? a / b : null);
  return {
    ath_x: r(c.ath_price, c.call_price) ?? r(c.ath_mcap, c.call_mcap),
    cur_x: r(c.cur_price, c.call_price) ?? r(c.cur_mcap, c.call_mcap),
  };
}

export function bullPost(symbol, ca) {
  return `$${symbol} is POWERED UP 🔵🍃🌀🔺️\n\n9 trenchers tagged it. POWER OF 9.\n\nCA: ${ca}\n\nManifesting 589x 🔺️⏳️\n${LINKS.site}`;
}
export const intentUrl = (text) => "https://x.com/intent/post?text=" + encodeURIComponent(text);

export const HELP = `<b>BASE TRENCHES · POWER OF 9</b>
Manifesting 589x 🔺️⏳️

<b>/tag</b> &lt;Base CA or DexScreener/Basescan link&gt; tag a coin (one tag per trencher per coin)
<b>/hot</b> coins being tagged, with n/9 progress
<b>/coin</b> &lt;ca&gt; one coin's tags and stats
<b>/calls</b> powered-up calls and their x since the call
<b>/me</b> your tags and calls
<b>/linkx</b> @handle link your X so the site credits you
<b>/events</b> upcoming and live trench events

9 different trenchers tag a coin and it is POWERED UP: announced and pinned in the channel, and the first tagger is the caller. When its X post hits 5 replies, 8 reposts and 9 likes it gets PINNED.
In DM you can also just paste a CA.

Channel: ${LINKS.channel}
Board: ${LINKS.site}
X: ${LINKS.x}
Not financial advice. Most memes go to zero.`;

// ---------- the bot ----------
export class Bot {
  constructor({ db, tg, fetchJson, now = () => Date.now(), groupId, channelId, ownerIds = [], botUsername = "Powerof9BaseBot", log = () => {}, onWrite = () => {}, eventsUrl = "", voteChatId, announceChatId } = {}) {
    Object.assign(this, { db, tg, fetchJson, now, groupId: Number(groupId), channelId: Number(channelId), botUsername, log, onWrite, eventsUrl });
    this.voteChatId = Number(voteChatId != null ? voteChatId : groupId);
    this.announceChatId = Number(announceChatId != null ? announceChatId : channelId);
    this.owners = new Set([...ownerIds].map(Number).filter(Boolean));
    migrate(db);
  }
  q(s, ...p) { return this.db.q(s, ...p); }

  async safeTg(method, params) {
    try { return await this.tg(method, params); } catch (e) { this.log("tg_error", method, String(e && e.message || e)); return null; }
  }
  reply(m, html) {
    return this.safeTg("sendMessage", {
      chat_id: m.chat.id, text: html, parse_mode: "HTML",
      reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true },
      link_preview_options: { is_disabled: true },
    });
  }

  // returns 'ok' | 'drop' | 'warn'
  rateCheck(userId) {
    const t = this.now();
    const r = this.q("SELECT * FROM rate WHERE user_id=?", userId)[0];
    if (!r) { this.q("INSERT INTO rate (user_id,win_start,n,last_at,warned_at) VALUES (?,?,?,?,0)", userId, t, 1, t); return "ok"; }
    let { win_start, n } = r;
    if (t - win_start > 600000) { win_start = t; n = 0; }
    const tooFast = t - r.last_at < 1500;
    const tooMany = n >= 25;
    if (tooFast || tooMany) {
      if (t - (r.warned_at || 0) > 60000) { this.q("UPDATE rate SET warned_at=? WHERE user_id=?", t, userId); return "warn"; }
      return "drop";
    }
    this.q("UPDATE rate SET win_start=?, n=?, last_at=? WHERE user_id=?", win_start, n + 1, t, userId);
    return "ok";
  }

  upsertUser(f) {
    this.q(`INSERT INTO users (user_id,username,first_name,created_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name`,
      f.id, f.username || null, String(f.first_name || "").slice(0, 64), this.now());
    this.emit("user", f.id);
  }
  // durable write-through hook (ADB outbox); never lets a sink error break the bot
  emit(kind, key, payload) { try { this.onWrite(kind, key, payload); } catch (e) { this.log("write_hook_error", kind, String(e && e.message || e)); } }
  user(id) { return this.q("SELECT * FROM users WHERE user_id=?", id)[0] || null; }
  coin(ca) { return this.q("SELECT * FROM coins WHERE ca=?", ca)[0] || null; }
  tagCount(ca) { return this.q("SELECT COUNT(*) AS n FROM tags WHERE ca=?", ca)[0].n; }
  taggers(ca) {
    return this.q("SELECT u.user_id, u.username, u.first_name, u.x_handle, t.tagged_at FROM tags t LEFT JOIN users u ON u.user_id=t.user_id WHERE t.ca=? ORDER BY t.tagged_at, t.rowid", ca);
  }

  async handleUpdate(u) {
    if (u.message) return this.onMessage(u.message);
    if (u.my_chat_member) {
      const c = u.my_chat_member.chat;
      kvSet(this.db, "chat:" + c.id, JSON.stringify({ type: c.type, title: c.title || null, status: u.my_chat_member.new_chat_member?.status, at: this.now() }));
    }
    return null; // channel_post and others: nothing to do
  }

  warnSendAs(m) {
    const chatId = m.chat && m.chat.id;
    if (chatId == null) return null;
    const key = "sendas_warn:" + chatId;
    const last = Number(kvGet(this.db, key) || 0);
    if (this.now() - last < 600000) return null;
    kvSet(this.db, key, this.now());
    return this.reply(m, "Tags must come from a person. Switch <b>Send as</b> to your personal account (not Anonymous Admin / the group) and try the command again.");
  }

  async onMessage(m) {
    const chat = m.chat || {};
    const isPrivate = chat.type === "private";
    const inGroup = Number(chat.id) === this.groupId || Number(chat.id) === this.voteChatId;
    if (!isPrivate && !inGroup) return null;
    if (m.is_automatic_forward) return null;
    const text = m.text || m.caption || "";
    let c = parseCommand(text, this.botUsername);
    if (m.sender_chat) {
      // Anonymous admin / "send as group or channel": only identity-bound commands get the hint.
      if (c && !c.foreign && ["tag", "me", "linkx"].includes(c.cmd) && inGroup) return this.warnSendAs(m);
      return null;
    }
    if (!m.from || m.from.is_bot) return null;
    if (c && c.foreign) return null;
    if (!c) {
      if (!isPrivate) return null;
      const t = parseTarget(text);
      c = t ? { cmd: "tag", arg: text } : { cmd: "help", arg: "" };
    }
    const known = ["start", "help", "tag", "hot", "coin", "calls", "me", "linkx", "setpost", "events"];
    if (!known.includes(c.cmd)) return isPrivate ? this.reply(m, "Unknown command. Try /help") : null;
    const rl = this.rateCheck(m.from.id);
    if (rl === "drop") return null;
    if (rl === "warn") return this.reply(m, "Slow down, trencher. Try again in a few seconds 🔺️⏳️");
    this.upsertUser(m.from);
    switch (c.cmd) {
      case "start": case "help": return this.reply(m, HELP);
      case "tag": return this.cmdTag(m, c.arg);
      case "hot": return this.reply(m, this.hotText());
      case "coin": return this.cmdCoin(m, c.arg);
      case "calls": return this.reply(m, this.callsText());
      case "me": return this.reply(m, this.meText(m.from.id));
      case "linkx": return this.cmdLinkX(m, c.arg);
      case "setpost": return this.cmdSetPost(m, c.arg);
      case "events": return this.cmdEvents(m);
    }
  }

  async cmdTag(m, arg) {
    const t = parseTarget(arg);
    if (!t) return this.reply(m, "Usage: <code>/tag 0x…</code> with a Base contract address, or a DexScreener/Basescan link.");
    if (t.error === "not_base") return this.reply(m, "That link isn't on Base. The trenches only tag Base coins 🔵");
    const r = await resolveToken(t.addr, this.fetchJson);
    if (!r.ok) {
      return this.reply(m, r.reason === "not_base"
        ? "That token trades on another chain, not Base. Only Base coins count here 🔵"
        : `Couldn't find a Base pair on DexScreener for <code>${esc(t.addr)}</code>. Check the CA and try again.`);
    }
    return this.tagCoin(m, r.tok);
  }

  // Synchronous section (no awaits) so concurrent tags can't double power-up.
  applyTag(userId, tok, chatId, msgId) {
    const t = this.now();
    let coin = this.coin(tok.ca);
    if (!coin) {
      this.q(`INSERT INTO coins (ca,symbol,name,pair_url,image,status,first_tagger_id,first_tagged_at,cur_price,cur_mcap,price_updated_at)
        VALUES (?,?,?,?,?,'tagging',?,?,?,?,?)`, tok.ca, tok.symbol, tok.name, tok.pair_url, tok.image, userId, t, tok.price, tok.mcap, t);
    } else {
      this.q("UPDATE coins SET symbol=?, name=?, pair_url=?, image=COALESCE(?,image), cur_price=COALESCE(?,cur_price), cur_mcap=COALESCE(?,cur_mcap), price_updated_at=? WHERE ca=?",
        tok.symbol, tok.name, tok.pair_url, tok.image, tok.price, tok.mcap, t, tok.ca);
    }
    if (this.q("SELECT 1 AS x FROM tags WHERE ca=? AND user_id=?", tok.ca, userId).length) {
      return { result: "dupe", n: this.tagCount(tok.ca), coin: this.coin(tok.ca) };
    }
    this.q("INSERT INTO tags (ca,user_id,tagged_at,chat_id,msg_id) VALUES (?,?,?,?,?)", tok.ca, userId, t, chatId, msgId);
    this.emit("coin", tok.ca);
    const n = this.tagCount(tok.ca);
    coin = this.coin(tok.ca);
    if (coin.status === "tagging" && n >= THRESH.tags) {
      this.q(`UPDATE coins SET status='powered', powered_at=?, call_price=?, call_mcap=?, ath_price=?, ath_mcap=?, ath_at=? WHERE ca=? AND status='tagging'`,
        t, tok.price, tok.mcap, tok.price, tok.mcap, t, tok.ca);
      return { result: "powered", n, coin: this.coin(tok.ca) };
    }
    return { result: "tagged", n, coin };
  }

  async tagCoin(m, tok) {
    const r = this.applyTag(m.from.id, tok, m.chat.id, m.message_id);
    const sym = esc(r.coin.symbol);
    if (r.result === "dupe") return this.reply(m, `You already tagged <b>$${sym}</b>. One tag per trencher. ${r.n}/9 ${bar(r.n)}`);
    if (r.result === "powered") {
      await this.reply(m, `Tag ${r.n}/9 landed. <b>$${sym} is POWERED UP</b> 🔵🍃🌀🔺️`);
      await this.announcePowerUp(r.coin);
      return r;
    }
    if (r.coin.status !== "tagging") return this.reply(m, `Tagged <b>$${sym}</b>. It's already ${r.coin.status === "pinned" ? "PINNED" : "POWERED UP"} (${r.n} tags).`);
    const left = THRESH.tags - r.n;
    return this.reply(m, `Tagged <b>$${sym}</b> (${esc(r.coin.name)})\n${bar(r.n)} <b>${r.n}/9</b>\n${left} more trencher${left === 1 ? "" : "s"} to power it up.\n<code>${esc(r.coin.ca)}</code>`);
  }

  powerUpHtml(coin, withIntent) {
    const tg = this.taggers(coin.ca);
    const caller = this.user(coin.first_tagger_id);
    const intent = intentUrl(bullPost(coin.symbol, coin.ca));
    return [
      `🔵🍃🌀🔺️ <b>POWER OF 9 · $${esc(coin.symbol)} IS POWERED UP</b>`,
      ``,
      `<b>${esc(coin.name)}</b> on Base`,
      `CA: <code>${esc(coin.ca)}</code>`,
      `Call price: <b>${fmtPrice(coin.call_price)}</b> · MCap <b>${fmtUsd(coin.call_mcap)}</b>`,
      `Caller: <b>${whoHtml(caller)}</b>${caller?.x_handle ? ` (<a href="https://x.com/${esc(caller.x_handle.slice(1))}">${esc(caller.x_handle)}</a>)` : ""}`,
      `The 9: ${tg.slice(0, 9).map(whoHtml).join(", ")}`,
      ``,
      `<a href="${esc(coin.pair_url)}">Chart</a> · <a href="${LINKS.site}/#hot">Hot list</a>${withIntent ? ` · <a href="${esc(intent)}">Bull-post it on X</a>` : ""}`,
      `Manifesting 589x 🔺️⏳️ Not financial advice.`,
    ].join("\n");
  }

  async announcePowerUp(coin) {
    const html = this.powerUpHtml(coin, true);
    const opts = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    const ch = await this.safeTg("sendMessage", { chat_id: this.channelId, text: html, ...opts });
    if (ch?.message_id) {
      this.q("UPDATE coins SET channel_msg_id=? WHERE ca=?", ch.message_id, coin.ca);
      await this.safeTg("pinChatMessage", { chat_id: this.channelId, message_id: ch.message_id, disable_notification: false });
    }
    const gr = await this.safeTg("sendMessage", { chat_id: this.groupId, text: html, ...opts });
    if (gr?.message_id) this.q("UPDATE coins SET group_msg_id=? WHERE ca=?", gr.message_id, coin.ca);
    this.emit("coin", coin.ca);
    return { channel: ch?.message_id || null, group: gr?.message_id || null };
  }

  // Engagement feed: {ca, post_url, replies, reposts, likes}
  async engagement(body) {
    const ca = String(body?.ca || "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(ca)) return { status: 400, error: "bad ca" };
    const nums = ["replies", "reposts", "likes"].map((k) => Number(body[k]));
    if (nums.some((n) => !Number.isInteger(n) || n < 0)) return { status: 400, error: "replies, reposts, likes must be non-negative integers" };
    const [replies, reposts, likes] = nums;
    let post = null;
    if (body.post_url) { post = normalizeXStatus(body.post_url); if (!post) return { status: 400, error: "bad post_url" }; }
    const coin = this.coin(ca);
    if (!coin) return { status: 404, error: "unknown coin" };
    const t = this.now();
    this.q("UPDATE coins SET replies=?, reposts=?, likes=?, engagement_at=?, x_post_url=COALESCE(?,x_post_url) WHERE ca=?", replies, reposts, likes, t, post, ca);
    this.emit("engagement", null, { ca, t, post_url: post || coin.x_post_url || null, replies, reposts, likes });
    this.emit("coin", ca);
    const meets = replies >= THRESH.replies && reposts >= THRESH.reposts && likes >= THRESH.likes;
    let pinned = false;
    if (meets && coin.status === "powered") {
      this.q("UPDATE coins SET status='pinned', pinned_at=? WHERE ca=? AND status='powered'", t, ca);
      pinned = true;
      await this.announcePinned(this.coin(ca));
    }
    const c = this.coin(ca);
    return { status: 200, ok: true, ca, coin_status: c.status, meets, pinned_now: pinned, thresholds: THRESH };
  }

  async announcePinned(coin) {
    const { cur_x, ath_x } = multiples(coin);
    const html = [
      `📌 <b>PINNED · $${esc(coin.symbol)} HIT 5 · 8 · 9</b> 🔵🍃🌀🔺️`,
      ``,
      `The X post cleared ${coin.replies} replies, ${coin.reposts} reposts and ${coin.likes} likes. A game round is dug for it in the trench.`,
      `CA: <code>${esc(coin.ca)}</code>`,
      `Since call: <b>${fmtX(cur_x)}</b> now · ATH <b>${fmtX(ath_x)}</b>`,
      coin.x_post_url ? `<a href="${esc(coin.x_post_url)}">X post</a> · <a href="${LINKS.site}/#hot">Play the round</a>` : `<a href="${LINKS.site}/#hot">Play the round</a>`,
      `Manifesting 589x 🔺️⏳️`,
    ].join("\n");
    const opts = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    const ch = await this.safeTg("sendMessage", { chat_id: this.channelId, text: html, ...opts });
    if (ch?.message_id) {
      this.q("UPDATE coins SET pin_channel_msg_id=? WHERE ca=?", ch.message_id, coin.ca);
      await this.safeTg("pinChatMessage", { chat_id: this.channelId, message_id: ch.message_id, disable_notification: false });
      this.emit("coin", coin.ca);
    }
    const gr = await this.safeTg("sendMessage", { chat_id: this.groupId, text: html, ...opts });
    if (gr?.message_id) await this.safeTg("pinChatMessage", { chat_id: this.groupId, message_id: gr.message_id, disable_notification: true });
    return { channel: ch?.message_id || null, group: gr?.message_id || null };
  }

  async cmdCoin(m, arg) {
    const t = parseTarget(arg);
    if (!t || !t.addr) return this.reply(m, "Usage: <code>/coin 0x…</code>");
    const c = this.coin(t.addr);
    if (!c) return this.reply(m, `Nobody has tagged <code>${esc(t.addr)}</code> yet. Be the first: <code>/tag ${esc(t.addr)}</code>`);
    const n = this.tagCount(c.ca);
    const { cur_x, ath_x } = multiples(c);
    const lines = [
      `<b>$${esc(c.symbol)}</b> · ${esc(c.name)} · ${c.status.toUpperCase()}`,
      `${bar(n)} <b>${Math.min(n, 9)}/9</b>${n > 9 ? ` (+${n - 9})` : ""}`,
      `<code>${esc(c.ca)}</code>`,
      `First tag: ${whoHtml(this.user(c.first_tagger_id))}`,
      `Taggers: ${this.taggers(c.ca).map(whoHtml).join(", ")}`,
      `Price ${fmtPrice(c.cur_price)} · MCap ${fmtUsd(c.cur_mcap)}`,
    ];
    if (c.status !== "tagging") lines.push(`Called at ${fmtUsd(c.call_mcap)} · now <b>${fmtX(cur_x)}</b> · ATH <b>${fmtX(ath_x)}</b>`);
    if (c.x_post_url) lines.push(`X post: <a href="${esc(c.x_post_url)}">link</a> · ${c.replies ?? 0}/5 replies, ${c.reposts ?? 0}/8 reposts, ${c.likes ?? 0}/9 likes`);
    lines.push(`<a href="${esc(c.pair_url)}">Chart</a>`);
    return this.reply(m, lines.join("\n"));
  }

  hotRows(limit = 10) {
    const since = this.now() - 7 * DAY;
    return this.q(`SELECT c.*, (SELECT COUNT(*) FROM tags t WHERE t.ca=c.ca) AS n FROM coins c
      WHERE (c.status='tagging' AND c.first_tagged_at>?) OR (c.status IN ('powered','pinned') AND c.powered_at>?)
      ORDER BY CASE c.status WHEN 'pinned' THEN 0 WHEN 'powered' THEN 1 ELSE 2 END, n DESC, c.first_tagged_at DESC LIMIT ?`, since, since, limit);
  }
  hotText() {
    const rows = this.hotRows(10);
    if (!rows.length) return "The trench is quiet. Tag a Base coin with <code>/tag 0x…</code> to start the count.";
    return "<b>HOT LIST</b> · 9 tags powers it up\n\n" + rows.map((c) =>
      `${c.status === "pinned" ? "📌" : c.status === "powered" ? "🔺️" : "·"} <b>$${esc(c.symbol)}</b> ${bar(c.n)} ${Math.min(c.n, 9)}/9${c.status !== "tagging" ? " " + c.status.toUpperCase() : ""}\n<code>${esc(c.ca)}</code>`).join("\n") + `\n\n${LINKS.site}/#hot`;
  }
  callRows(limit = 50) {
    return this.q("SELECT * FROM coins WHERE status IN ('powered','pinned') ORDER BY powered_at DESC LIMIT ?", limit);
  }
  callsText() {
    const rows = this.callRows(10);
    if (!rows.length) return "No calls yet. A coin becomes a call when 9 trenchers tag it.";
    return "<b>CALLS</b> · x since the call\n\n" + rows.map((c) => {
      const { cur_x, ath_x } = multiples(c);
      return `<b>$${esc(c.symbol)}</b> by ${whoHtml(this.user(c.first_tagger_id))} · now ${fmtX(cur_x)} · ATH ${fmtX(ath_x)}${c.status === "pinned" ? " 📌" : ""}`;
    }).join("\n") + `\n\n${LINKS.site}/#calls`;
  }
  meText(uid) {
    const u = this.user(uid);
    const tags = this.q("SELECT COUNT(*) AS n FROM tags WHERE user_id=?", uid)[0].n;
    const calls = this.q("SELECT * FROM coins WHERE first_tagger_id=? AND status IN ('powered','pinned')", uid);
    const best = calls.reduce((a, c) => Math.max(a, multiples(c).ath_x || 0), 0);
    return [`<b>${whoHtml(u)}</b>`, `X: ${u?.x_handle ? esc(u.x_handle) : "not linked (use /linkx @handle)"}`, `Tags: ${tags}`, `Calls (first tag on a powered coin): ${calls.length}`, `Best ATH: ${calls.length ? fmtX(best) : "—"}`].join("\n");
  }
  cmdLinkX(m, arg) {
    const h = normalizeXHandle(arg);
    if (!h) return this.reply(m, "Usage: <code>/linkx @yourhandle</code>");
    this.q("UPDATE users SET x_handle=? WHERE user_id=?", h, m.from.id);
    this.emit("user", m.from.id);
    return this.reply(m, `Linked X <b>${esc(h)}</b>. Your calls on the site will credit it.`);
  }
  cmdSetPost(m, arg) {
    if (!this.owners.has(Number(m.from.id))) return this.reply(m, "Only the trench owners can set the X post for a call.");
    const [a, u] = arg.split(/\s+/);
    const t = parseTarget(a || "");
    const url = normalizeXStatus(u);
    if (!t?.addr || !url) return this.reply(m, "Usage: <code>/setpost 0x… https://x.com/PowerOf9Base/status/…</code>");
    const c = this.coin(t.addr);
    if (!c) return this.reply(m, "Unknown coin. Tag it first.");
    this.q("UPDATE coins SET x_post_url=? WHERE ca=?", url, c.ca);
    this.emit("coin", c.ca);
    return this.reply(m, `X post set for <b>$${esc(c.symbol)}</b>. Engagement checks will track 5 replies · 8 reposts · 9 likes.`);
  }

  eventLine(e) {
    const start = e.start_at ? new Date(e.start_at).toISOString().replace('.000Z', 'Z') : '';
    const end = e.end_at ? new Date(e.end_at).toISOString().replace('.000Z', 'Z') : '';
    return `<b>${esc(e.title)}</b> · ${esc(String(e.type || '').replace(/_/g, ' '))}\n${esc(start)} → ${esc(end)}${e.description ? `\n${esc(e.description)}` : ''}`;
  }

  async fetchEvents() {
    if (!this.eventsUrl) return { upcoming: [], live: [], past: [] };
    const data = await this.fetchJson(this.eventsUrl);
    if (!data) return { upcoming: [], live: [], past: [] };
    return {
      upcoming: data.upcoming || [],
      live: data.live || [],
      past: data.past || [],
    };
  }

  async cmdEvents(m) {
    const { upcoming, live } = await this.fetchEvents();
    if (!live.length && !upcoming.length) return this.reply(m, "No events on the board. Check the <a href=\"https://base-trenches.pages.dev/#events\">EVENTS</a> page.");
    const parts = [];
    if (live.length) parts.push("<b>LIVE</b>\n" + live.map((e) => this.eventLine(e)).join("\n\n"));
    if (upcoming.length) parts.push("<b>UPCOMING</b>\n" + upcoming.slice(0, 8).map((e) => this.eventLine(e)).join("\n\n"));
    parts.push(`<a href="${LINKS.site}/#events">Calendar</a>`);
    return this.reply(m, parts.join("\n\n"));
  }

  // Called from the 10-minute cron. Each event gets at most one "in one hour" and one
  // "starting now" post; the kv marker is written *before* sending so overlapping runs
  // can't double-post, and at most MAX_EVENT_POSTS go out per run.
  async announceDueEvents() {
    const MAX_EVENT_POSTS = 3;
    const { upcoming, live } = await this.fetchEvents();
    const t = this.now();
    const hour = 3600_000, startWindow = 15 * 60_000;
    const sent = [];
    const seen = new Set();
    const opts = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    for (const e of [...live, ...upcoming]) {
      if (sent.length >= MAX_EVENT_POSTS) break;
      if (!e || !e.id || seen.has(e.id)) continue;
      seen.add(e.id);
      const start = Number(e.start_at), end = Number(e.end_at);
      if (!Number.isFinite(start)) continue;
      const key1h = "event_announced:" + e.id + ":1h";
      const keyStart = "event_announced:" + e.id + ":start";
      // "In one hour" only when it is still 20+ minutes away; otherwise the start post covers it.
      if (start - hour <= t && start - t >= 20 * 60_000 && !kvGet(this.db, key1h)) {
        kvSet(this.db, key1h, t);
        await this.safeTg("sendMessage", { chat_id: this.voteChatId, text: `In one hour: ${this.eventLine(e)}\n<a href="${LINKS.site}/#events">EVENTS</a>`, ...opts });
        sent.push({ id: e.id, when: "1h" });
      } else if (start <= t && t < start + startWindow && (!Number.isFinite(end) || t <= end) && !kvGet(this.db, keyStart)) {
        kvSet(this.db, keyStart, t);
        kvSet(this.db, key1h, kvGet(this.db, key1h) || t);
        const text = `Starting now: ${this.eventLine(e)}\n<a href="${LINKS.site}/#events">EVENTS</a>`;
        await this.safeTg("sendMessage", { chat_id: this.voteChatId, text, ...opts });
        if (this.announceChatId && this.announceChatId !== this.voteChatId) await this.safeTg("sendMessage", { chat_id: this.announceChatId, text, ...opts });
        sent.push({ id: e.id, when: "start" });
      }
    }
    return { sent };
  }

  // ---------- cron ----------
  async refreshPrices() {
    const t = this.now();
    const rows = this.q(`SELECT ca FROM coins WHERE (status IN ('powered','pinned') AND powered_at>?) OR (status='tagging' AND first_tagged_at>?)`, t - 30 * DAY, t - 7 * DAY);
    let updated = 0;
    for (let i = 0; i < rows.length; i += 30) {
      const chunk = rows.slice(i, i + 30).map((r) => r.ca);
      const j = await this.fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);
      const pairs = (j && j.pairs) || [];
      for (const ca of chunk) {
        const p = bestBasePair(pairs, ca);
        if (!p) continue;
        const tok = tokFromPair(p, ca);
        if (tok.price == null) continue;
        this.q(`UPDATE coins SET cur_price=?, cur_mcap=COALESCE(?,cur_mcap), price_updated_at=?,
          ath_at=CASE WHEN status!='tagging' AND (ath_price IS NULL OR ?>ath_price) THEN ? ELSE ath_at END,
          ath_mcap=CASE WHEN status!='tagging' AND (ath_price IS NULL OR ?>ath_price) THEN COALESCE(?,ath_mcap) ELSE ath_mcap END,
          ath_price=CASE WHEN status!='tagging' AND (ath_price IS NULL OR ?>ath_price) THEN ? ELSE ath_price END
          WHERE ca=?`, tok.price, tok.mcap, t, tok.price, t, tok.price, tok.mcap, tok.price, tok.price, ca);
        this.emit("price", null, { ca, t, price: tok.price, mcap: tok.mcap });
        this.emit("coin", ca);
        updated++;
      }
    }
    kvSet(this.db, "last_price_refresh", JSON.stringify({ at: t, coins: rows.length, updated }));
    return { coins: rows.length, updated };
  }

  // ---------- public API ----------
  person(id) {
    const u = this.user(id);
    if (!u) return null;
    return { id: "u" + u.user_id, telegram_handle: u.username ? "@" + u.username : null, name: u.username ? "@" + u.username : u.first_name || "trencher", x_handle: u.x_handle || null };
  }
  coinOut(c, withTaggers) {
    const n = c.n ?? this.tagCount(c.ca);
    const { cur_x, ath_x } = multiples(c);
    const o = {
      ca: c.ca, symbol: c.symbol, name: c.name, status: c.status, tags: n, tags_needed: THRESH.tags,
      caller: this.person(c.first_tagger_id), first_tagged_at: iso(c.first_tagged_at), powered_at: iso(c.powered_at), pinned_at: iso(c.pinned_at),
      price_usd: c.cur_price, mcap_usd: c.cur_mcap, call_price_usd: c.call_price, call_mcap_usd: c.call_mcap,
      ath_price_usd: c.ath_price, ath_mcap_usd: c.ath_mcap, ath_at: iso(c.ath_at), ath_x, cur_x,
      price_updated_at: iso(c.price_updated_at), pair_url: c.pair_url, image: c.image,
      x_post: c.x_post_url ? { url: c.x_post_url, replies: c.replies, reposts: c.reposts, likes: c.likes, checked_at: iso(c.engagement_at) } : null,
      telegram_msg_url: c.channel_msg_id ? `${LINKS.channel}/${c.channel_msg_id}` : null,
    };
    if (withTaggers) o.taggers = this.taggers(c.ca).map((r) => ({ ...this.person(r.user_id), tagged_at: iso(r.tagged_at) }));
    return o;
  }
  apiHot() { return { example_data: false, thresholds: THRESH, items: this.hotRows(30).map((c) => this.coinOut(c, true)) }; }
  apiCalls() { return { example_data: false, hit_multiple: HIT_X, items: this.callRows(200).map((c) => this.coinOut(c, false)) }; }
  apiCoin(ca) { const c = this.coin(String(ca).toLowerCase()); return c ? this.coinOut(c, true) : null; }
  apiCallers() {
    const users = this.q("SELECT DISTINCT user_id FROM tags");
    const since = this.now() - 7 * DAY;
    const items = users.map(({ user_id }) => {
      const calls = this.q("SELECT * FROM coins WHERE first_tagger_id=? AND status IN ('powered','pinned')", user_id);
      const xs = calls.map((c) => multiples(c).ath_x || 0);
      const hits = xs.filter((x) => x >= HIT_X).length;
      const live = this.q("SELECT COUNT(*) AS n FROM tags t JOIN coins c ON c.ca=t.ca WHERE t.user_id=? AND c.status='tagging' AND c.first_tagged_at>?", user_id, since)[0].n;
      const tags = this.q("SELECT COUNT(*) AS n FROM tags WHERE user_id=?", user_id)[0].n;
      return { ...this.person(user_id), calls: calls.length, hits, hit_rate: calls.length ? hits / calls.length : 0, best_x: xs.length ? Math.max(...xs) : null, live, tags };
    }).sort((a, b) => (b.best_x || 0) - (a.best_x || 0) || b.calls - a.calls || b.tags - a.tags);
    return { example_data: false, hit_multiple: HIT_X, items };
  }
  health() {
    const n = (s) => this.q(s)[0].n;
    return {
      ok: true, bot: "@" + this.botUsername,
      configured: !!kvGet(this.db, "secret:telegram_token"),
      coins: n("SELECT COUNT(*) AS n FROM coins"), tags: n("SELECT COUNT(*) AS n FROM tags"),
      calls: n("SELECT COUNT(*) AS n FROM coins WHERE status IN ('powered','pinned')"),
      last_price_refresh: JSON.parse(kvGet(this.db, "last_price_refresh") || "null"),
      last_update_at: iso(Number(kvGet(this.db, "last_update_at")) || null),
      time: new Date(this.now()).toISOString(),
    };
  }
}
const iso = (t) => (t ? new Date(t).toISOString() : null);
