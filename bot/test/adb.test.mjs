import { test } from "node:test";
import assert from "node:assert/strict";
import { Bot } from "../src/core.js";
import { AdbSink, MAX_ATTEMPTS } from "../src/adb.js";
import { openDb } from "../src/sqlite-node.js";

const GROUP = -1004397164578, CHANNEL = -1003874691876;
const CA = "0x" + "ab".repeat(20);
const EVIL = "x'); DROP TABLE bt_coins; --";

async function setup({ fail = () => false } = {}) {
  const db = await openDb();
  let t = Date.UTC(2026, 9, 28, 5, 0, 0);
  const now = () => (t += 2000);
  const calls = [];
  const fetchMock = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, auth: opts.headers.Authorization, ...body });
    const f = fail(calls.length, body);
    if (f === "http") return { ok: false, status: 503, json: async () => ({}) };
    if (f === "ora") return { ok: true, status: 200, json: async () => ({ items: [{ errorCode: 2291, errorMessage: "ORA-02291: integrity constraint violated" }] }) };
    if (/COUNT\(\*\)/.test(body.statementText)) {
      const n = /DELETE/.test(calls.at(-2)?.statementText || "") ? 0 : 1;
      return { ok: true, status: 200, json: async () => ({ items: [{ resultSet: { items: [{ n }] } }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ items: [{ result: 1 }] }) };
  };
  const sink = new AdbSink({ db, fetch: fetchMock, now: () => t, config: () => ({ url: "https://adb.example/ords/basetrenches/_/sql", user: "BASETRENCHES", password: "pw" }) });
  const fetchJson = async (u) => ({ pairs: u.split("tokens/")[1].split(",").map((a) => ({ chainId: "base", url: "https://dexscreener.com/base/0xp", priceUsd: "0.001", marketCap: 1e6, liquidity: { usd: 1 }, baseToken: { address: a, symbol: "TR", name: EVIL } })) });
  let mid = 1;
  const bot = new Bot({ db, tg: async () => ({ message_id: mid++ }), fetchJson, now, groupId: GROUP, channelId: CHANNEL, onWrite: (k, key, p) => sink.enqueue(k, key, p) });
  const msg = (uid, text, username = "user" + uid) => bot.handleUpdate({ update_id: mid, message: { message_id: mid++, chat: { id: GROUP, type: "supergroup" }, from: { id: uid, is_bot: false, username, first_name: EVIL }, text } });
  return { db, sink, bot, msg, calls, advance: (ms) => (t += ms) };
}

test("mutations enqueue ops and flush sends bind variables only (no user input in SQL text)", async () => {
  const { sink, msg, calls } = await setup();
  await msg(1, `/tag ${CA}`, "o'brien");
  assert.ok(sink.pending() >= 2);
  const r = await sink.flush();
  assert.equal(r.pending, 0);
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    assert.ok(!c.statementText.includes(EVIL) && !c.statementText.includes("o'brien") && !c.statementText.includes(CA), "SQL text must be constant");
    assert.equal(c.url, "https://adb.example/ords/basetrenches/_/sql");
    assert.equal(c.auth, "Basic " + Buffer.from("BASETRENCHES:pw").toString("base64"));
  }
  const all = calls.flatMap((c) => c.binds);
  assert.ok(all.some((b) => b.value === EVIL && b.data_type === "VARCHAR2"));
  assert.ok(all.some((b) => b.value === CA));
  assert.ok(all.some((b) => b.value === 1 && b.data_type === "NUMBER"));
  const coinCall = calls.find((c) => /MERGE INTO bt_coins/.test(c.statementText));
  assert.match(coinCall.statementText, /^BEGIN[\s\S]*MERGE INTO bt_users[\s\S]*MERGE INTO bt_coins[\s\S]*MERGE INTO bt_tags[\s\S]*END;$/);
  const names = coinCall.binds.map((b) => b.name);
  assert.equal(new Set(names).size, names.length, "bind names are unique per block");
  for (const n of names) assert.ok(coinCall.statementText.includes(":" + n), "every bind is referenced: " + n);
});

test("dedupes pending state-sync ops per key", async () => {
  const { sink } = await setup();
  assert.equal(sink.enqueue("coin", CA), true);
  assert.equal(sink.enqueue("coin", CA), false);
  assert.equal(sink.enqueue("price", null, { ca: CA, t: 1, price: 1 }), true);
  assert.equal(sink.enqueue("price", null, { ca: CA, t: 2, price: 1 }), true);
  assert.equal(sink.pending(), 3);
});

test("power-up writes bt_calls and the 9 call_taggers", async () => {
  const { sink, msg, calls } = await setup();
  for (let u = 1; u <= 9; u++) await msg(u, `/tag ${CA}`);
  await sink.flush();
  const last = calls.filter((c) => /MERGE INTO bt_calls/.test(c.statementText)).at(-1);
  assert.ok(last, "call merge sent");
  assert.equal((last.statementText.match(/MERGE INTO bt_call_taggers/g) || []).length, 9);
  const pos = last.binds.filter((b) => b.name.startsWith("pos_")).map((b) => b.value);
  assert.deepEqual(pos, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("failed write keeps FIFO order, backs off, retries, then succeeds", async () => {
  let failing = true;
  const { sink, msg, calls, advance } = await setup({ fail: () => (failing ? "http" : false) });
  await msg(1, `/tag ${CA}`);
  const before = sink.pending();
  let r = await sink.flush();
  assert.equal(r.sent, 0);
  assert.equal(sink.pending(), before, "nothing lost");
  assert.equal(calls.length, 1, "stops at the failed head to keep order");
  r = await sink.flush();
  assert.equal(calls.length, 1, "head is backing off");
  failing = false;
  advance(6000);
  r = await sink.flush();
  assert.equal(r.pending, 0);
  assert.ok(/MERGE INTO bt_users/.test(calls[1].statementText), "user op retried first");
});

test("ORA errors returned with HTTP 200 count as failures; poison op goes to dead letter", async () => {
  const { sink, db, advance } = await setup({ fail: (n, body) => (/bt_price_snapshots/.test(body.statementText) ? "ora" : false) });
  sink.enqueue("price", null, { ca: CA, t: 1, price: 1, mcap: 2 });
  sink.enqueue("user", 999); // no local row -> no statements, just dropped
  for (let i = 0; i < MAX_ATTEMPTS; i++) { await sink.flush(); advance(700000); }
  assert.equal(sink.pending(), 0);
  const dead = db.q("SELECT * FROM adb_dead");
  assert.equal(dead.length, 1);
  assert.match(dead[0].last_error, /ORA-02291/);
});

test("backfill enqueues existing users and coins once; writeCheck inserts and deletes", async () => {
  const { sink, msg, db } = await setup();
  await msg(1, `/tag ${CA}`);
  db.q("DELETE FROM adb_outbox");
  assert.deepEqual(sink.backfill(), { users: 1, coins: 1 });
  assert.equal(sink.backfill().skipped, true);
  assert.equal(sink.pending(), 2);
  assert.deepEqual(await sink.writeCheck(), { inserted: true, deleted: true });
  const h = await sink.health();
  assert.equal(h.configured, true);
  assert.equal(h.ok, true);
});

test("not configured: queue holds, nothing sent", async () => {
  const db = await openDb();
  let sent = 0;
  const sink = new AdbSink({ db, fetch: async () => { sent++; }, config: () => null });
  db.q("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
  sink.enqueue("price", null, { ca: CA, t: 1, price: 1 });
  const r = await sink.flush();
  assert.equal(r.skipped, "not configured");
  assert.equal(sent, 0);
  assert.equal(sink.pending(), 1);
});
