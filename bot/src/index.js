// Cloudflare Worker entry for the Base Trenches "Power of 9" Telegram bot.
// All state lives in one SQLite-backed Durable Object ("main").
import { DurableObject } from "cloudflare:workers";
import { Bot, kvGet, kvSet } from "./core.js";

const ALLOWED_ORIGINS = ["https://base-trenches.pages.dev", "https://kuzikuu.github.io"];
const cors = (req) => {
  const o = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": o && (ALLOWED_ORIGINS.includes(o) || /^https:\/\/[a-z0-9-]+\.base-trenches\.pages\.dev$/.test(o)) ? o : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
};
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

function safeEq(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export class BotDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.db = { q: (s, ...p) => ctx.storage.sql.exec(s, ...p).toArray() };
    this.bot = new Bot({
      db: this.db,
      tg: (m, p) => this.tg(m, p),
      fetchJson: async (url) => {
        try {
          const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
          return r.ok ? await r.json() : null;
        } catch { return null; }
      },
      groupId: env.GROUP_ID, channelId: env.CHANNEL_ID,
      ownerIds: String(env.OWNER_TG_IDS || "").split(/[\s,]+/),
      botUsername: env.BOT_USERNAME || "Powerof9BaseBot",
      log: (...a) => console.log(JSON.stringify(a)),
    });
  }

  async tg(method, params) {
    const token = kvGet(this.db, "secret:telegram_token");
    if (!token) throw new Error("bot token not configured");
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`${method}: ${j.error_code || r.status} ${j.description || ""}`);
    return j.result;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    const c = cors(req);

    if (p === "/__cron" && req.headers.get("x-internal-cron") === "1") return json(await this.bot.refreshPrices());

    if (p === "/__bootstrap") {
      const key = this.env.BOOTSTRAP_KEY;
      if (!key || key.length < 24 || req.method !== "POST" || !safeEq(req.headers.get("x-bootstrap-key"), key)) return json({ error: "not found" }, 404);
      const b = await req.json().catch(() => ({}));
      const stored = [];
      for (const k of ["telegram_token", "webhook_secret", "webhook_path", "admin_key"]) {
        if (typeof b[k] === "string" && b[k].length >= 16) { kvSet(this.db, "secret:" + k, b[k]); stored.push(k); }
      }
      return json({ ok: true, stored });
    }

    if (p.startsWith("/tg/") && req.method === "POST") {
      const path = kvGet(this.db, "secret:webhook_path");
      const sec = kvGet(this.db, "secret:webhook_secret");
      if (!path || !sec || !safeEq(p.slice(4), path) || !safeEq(req.headers.get("X-Telegram-Bot-Api-Secret-Token"), sec)) return json({ error: "not found" }, 404);
      const u = await req.json().catch(() => null);
      if (!u || typeof u.update_id !== "number") return json({ ok: true });
      const last = Number(kvGet(this.db, "last_update_id") || 0);
      if (u.update_id <= last) return json({ ok: true, dupe: true });
      kvSet(this.db, "last_update_id", u.update_id);
      kvSet(this.db, "last_update_at", Date.now());
      try { await this.bot.handleUpdate(u); } catch (e) { console.log(JSON.stringify(["update_error", String(e && e.message || e)])); }
      return json({ ok: true });
    }

    if (p.startsWith("/admin/")) {
      const admin = kvGet(this.db, "secret:admin_key");
      const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!admin || !safeEq(auth, admin)) return json({ error: "unauthorized" }, 401);
      if (p === "/admin/engagement" && req.method === "POST") {
        const r = await this.bot.engagement(await req.json().catch(() => ({})));
        return json(r, r.status || 200);
      }
      if (p === "/admin/pending" && req.method === "GET") {
        // calls still waiting on 5/8/9, for the X engagement routine
        const items = this.bot.callRows(200).filter((x) => x.status === "powered").map((x) => ({ ca: x.ca, symbol: x.symbol, post_url: x.x_post_url, powered_at: new Date(x.powered_at).toISOString() }));
        return json({ items });
      }
      if (p === "/admin/refresh" && req.method === "POST") return json(await this.bot.refreshPrices());
      return json({ error: "not found" }, 404);
    }

    if (req.method === "GET" && p.startsWith("/api/")) {
      let body = null;
      if (p === "/api/health") body = this.bot.health();
      else if (p === "/api/hot") body = this.bot.apiHot();
      else if (p === "/api/calls") body = this.bot.apiCalls();
      else if (p === "/api/callers") body = this.bot.apiCallers();
      else if (p.startsWith("/api/coin/")) {
        const ca = decodeURIComponent(p.slice(10));
        if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) return json({ error: "bad ca" }, 400, c);
        body = this.bot.apiCoin(ca);
        if (!body) return json({ error: "unknown coin" }, 404, c);
      }
      if (body) return json(body, 200, { ...c, "Cache-Control": "public, max-age=15" });
    }
    return json({ error: "not found" }, 404, c);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors(req), "Access-Control-Max-Age": "86400" } });
    if (url.pathname === "/") return new Response("Base Trenches · Power of 9 bot. API: /api/health /api/hot /api/calls /api/callers /api/coin/:ca\n", { headers: { "Content-Type": "text/plain" } });
    if (url.pathname === "/__cron") return json({ error: "not found" }, 404);
    const stub = env.BOT.get(env.BOT.idFromName("main"));
    return stub.fetch(req);
  },
  async scheduled(_ev, env, ctx) {
    const stub = env.BOT.get(env.BOT.idFromName("main"));
    ctx.waitUntil(stub.fetch("https://bot.internal/__cron", { method: "POST", headers: { "x-internal-cron": "1" } }));
  },
};
