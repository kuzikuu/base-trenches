// Optional: run the same Power of 9 bot on a VM (e.g. Oracle Cloud) with long polling.
// Never run this while the Cloudflare webhook is set: Telegram delivers each update
// to only one place, and getUpdates fails while a webhook exists. See README.md.
import http from "node:http";
import fs from "node:fs";
import { Bot, kvGet } from "../src/core.js";
import { openDb } from "../src/sqlite-node.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN is not set"); process.exit(1); }
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const DB_PATH = process.env.DB_PATH || new URL("./bot.sqlite", import.meta.url).pathname;
const PORT = Number(process.env.PORT || 0); // 0 = no HTTP API
const ALLOWED = ["message", "my_chat_member", "channel_post"];

async function tg(method, params) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params || {}),
    signal: AbortSignal.timeout(65000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${j.error_code || r.status} ${j.description || ""}`);
  return j.result;
}
const fetchJson = async (url) => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); return r.ok ? await r.json() : null; } catch { return null; }
};

const db = await openDb(DB_PATH);
const bot = new Bot({
  db, tg, fetchJson,
  groupId: process.env.GROUP_ID || -1004397164578,
  channelId: process.env.CHANNEL_ID || -1003874691876,
  ownerIds: String(process.env.OWNER_TG_IDS || "1465096325").split(/[\s,]+/),
  log: (...a) => console.log(new Date().toISOString(), ...a),
});

// Refuse to start while the Cloudflare webhook is active.
const wh = await tg("getWebhookInfo");
if (wh.url) {
  if (process.env.FORCE_DELETE_WEBHOOK === "1") { await tg("deleteWebhook", { drop_pending_updates: false }); console.log("Deleted the webhook; the Cloudflare bot will stop receiving updates."); }
  else { console.error("A webhook is set (the Cloudflare Worker is live). Not starting. See README: deleteWebhook first, or set FORCE_DELETE_WEBHOOK=1."); process.exit(2); }
}

setInterval(() => bot.refreshPrices().catch((e) => console.error("refresh", e.message)), 10 * 60 * 1000);

if (PORT) {
  http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (o, s = 200) => { res.writeHead(s, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(o)); };
    try {
      if (req.method === "GET" && u.pathname === "/api/health") return send(bot.health());
      if (req.method === "GET" && u.pathname === "/api/hot") return send(bot.apiHot());
      if (req.method === "GET" && u.pathname === "/api/calls") return send(bot.apiCalls());
      if (req.method === "GET" && u.pathname === "/api/callers") return send(bot.apiCallers());
      if (req.method === "GET" && u.pathname.startsWith("/api/coin/")) { const c = bot.apiCoin(u.pathname.slice(10)); return c ? send(c) : send({ error: "unknown coin" }, 404); }
      if (req.method === "POST" && u.pathname === "/admin/engagement") {
        if (!ADMIN_KEY || req.headers.authorization !== "Bearer " + ADMIN_KEY) return send({ error: "unauthorized" }, 401);
        let b = ""; for await (const ch of req) b += ch;
        const r = await bot.engagement(JSON.parse(b || "{}"));
        return send(r, r.status || 200);
      }
      send({ error: "not found" }, 404);
    } catch (e) { send({ error: "server error" }, 500); }
  }).listen(PORT, () => console.log("API on port", PORT));
}

let offset = Number(kvGet(db, "vm_offset") || 0);
console.log("Polling Telegram as @Powerof9BaseBot");
for (;;) {
  try {
    const ups = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ALLOWED });
    for (const up of ups) {
      offset = up.update_id + 1;
      db.q("INSERT INTO kv (k,v) VALUES ('vm_offset',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", String(offset));
      try { await bot.handleUpdate(up); } catch (e) { console.error("update", e.message); }
    }
  } catch (e) {
    console.error("poll", e.message);
    if (/409/.test(e.message)) { console.error("Conflict: a webhook or another poller is active. Exiting."); process.exit(3); }
    await new Promise((r) => setTimeout(r, 5000));
  }
}
