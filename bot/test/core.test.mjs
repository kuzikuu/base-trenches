import { test } from "node:test";
import assert from "node:assert/strict";
import { Bot, parseTarget, parseCommand, normalizeXStatus, bullPost, intentUrl, esc } from "../src/core.js";
import { openDb } from "../src/sqlite-node.js";

const GROUP = -1004397164578, CHANNEL = -1003874691876, OWNER = 1465096325;
const CA = "0x" + "ab".repeat(20);
const OTHER = "0x" + "cd".repeat(20);

function pair(ca, price, chainId = "base", sym = "TRENCH") {
  return { chainId, url: `https://dexscreener.com/${chainId}/0xpair`, priceUsd: String(price), marketCap: price * 1e9, liquidity: { usd: 50000 },
    baseToken: { address: ca, symbol: sym, name: "Trench <Coin>" } };
}
async function setup() {
  const db = await openDb();
  const sent = [];
  let t = Date.UTC(2026, 9, 28, 4, 0, 0);
  const prices = { [CA]: 0.001 };
  const fetchJson = async (url) => {
    const m = url.match(/tokens\/(.+)$/);
    if (!m) return { pairs: [] };
    const out = [];
    for (const a of m[1].split(",")) {
      if (a === OTHER) out.push(pair(a, 1, "ethereum"));
      else if (prices[a] != null) out.push(pair(a, prices[a]));
    }
    return { pairs: out };
  };
  let mid = 100;
  const tg = async (method, params) => { sent.push({ method, params }); return method === "sendMessage" ? { message_id: ++mid } : true; };
  const bot = new Bot({ db, tg, fetchJson, now: () => (t += 2000), groupId: GROUP, channelId: CHANNEL, ownerIds: [OWNER] });
  let msgId = 1;
  const msg = (uid, text, chat = { id: GROUP, type: "supergroup" }) =>
    bot.handleUpdate({ update_id: msgId, message: { message_id: msgId++, chat, from: { id: uid, is_bot: false, username: "user" + uid, first_name: "U" + uid }, text } });
  return { bot, sent, msg, prices, advance: (ms) => (t += ms) };
}
const toChannel = (sent) => sent.filter((s) => s.params.chat_id === CHANNEL);

test("parsing", () => {
  assert.equal(parseTarget(`/tag ${CA.toUpperCase().replace("0X", "0x")}`).addr, CA);
  assert.equal(parseTarget(`https://dexscreener.com/base/${CA}`).addr, CA);
  assert.equal(parseTarget(`https://dexscreener.com/solana/${CA}`).error, "not_base");
  assert.equal(parseTarget(`https://basescan.org/token/${CA}`).addr, CA);
  assert.equal(parseTarget("gm"), null);
  assert.equal(parseTarget("0x" + "a".repeat(64)), null);
  assert.deepEqual(parseCommand("/tag@Powerof9BaseBot 0x1", "Powerof9BaseBot"), { cmd: "tag", arg: "0x1" });
  assert.equal(parseCommand("/tag@OtherBot x", "Powerof9BaseBot").foreign, true);
  assert.equal(normalizeXStatus("https://twitter.com/PowerOf9Base/status/1234567890"), "https://x.com/PowerOf9Base/status/1234567890");
  assert.equal(esc(`<b>&"`), "&lt;b&gt;&amp;&quot;");
  const bp = bullPost("TRENCH", CA);
  assert.ok(bp.includes("$TRENCH") && bp.includes(CA) && bp.includes("POWER OF 9") && bp.includes("https://base-trenches.pages.dev"));
  assert.ok(intentUrl(bp).startsWith("https://x.com/intent/post?text=%24TRENCH"));
});

test("one tag per user per coin; rejects non-Base and unknown", async () => {
  const { bot, sent, msg, advance } = await setup();
  await msg(1, `/tag ${CA}`);
  advance(5000);
  await msg(1, `/tag ${CA}`);
  assert.equal(bot.tagCount(CA), 1);
  assert.match(sent.at(-1).params.text, /already tagged/);
  await msg(2, `/tag ${OTHER}`);
  assert.match(sent.at(-1).params.text, /another chain/);
  await msg(3, `/tag 0x${"ee".repeat(20)}`);
  assert.match(sent.at(-1).params.text, /Couldn't find a Base pair/);
  assert.equal(bot.coin(OTHER), null);
  // user text is escaped (token name has < >)
  assert.ok(sent[0].params.text.includes("Trench &lt;Coin&gt;"));
  assert.equal(sent[0].params.parse_mode, "HTML");
});

test("9 unique tags powers up once, announces + pins in channel, echoes in group", async () => {
  const { bot, sent, msg } = await setup();
  for (let u = 1; u <= 8; u++) await msg(u, `/tag ${CA}`);
  assert.equal(bot.coin(CA).status, "tagging");
  assert.equal(toChannel(sent).length, 0);
  await msg(9, `/tag ${CA}`);
  const c = bot.coin(CA);
  assert.equal(c.status, "powered");
  assert.equal(c.first_tagger_id, 1);
  assert.equal(c.call_price, 0.001);
  assert.ok(c.powered_at && c.call_mcap);
  const ch = toChannel(sent);
  assert.equal(ch.filter((s) => s.method === "sendMessage").length, 1);
  assert.ok(ch.some((s) => s.method === "pinChatMessage"));
  const ann = ch.find((s) => s.method === "sendMessage").params.text;
  assert.match(ann, /POWERED UP/);
  assert.ok(ann.includes("https://x.com/intent/post?text="));
  assert.ok(ann.includes("@user1"));
  const groupEcho = sent.filter((s) => s.params.chat_id === GROUP && s.method === "sendMessage" && !s.params.reply_parameters);
  assert.equal(groupEcho.length, 1);
  await msg(10, `/tag ${CA}`);
  assert.equal(toChannel(sent).filter((s) => s.method === "sendMessage").length, 1, "no second power-up");
  const api = bot.apiCalls();
  assert.equal(api.items.length, 1);
  assert.equal(api.items[0].caller.telegram_handle, "@user1");
  assert.equal(bot.apiHot().items[0].taggers.length, 10);
});

test("bare CA in DM counts as a tag; ignored in group without command; foreign chats ignored", async () => {
  const { bot, msg, sent } = await setup();
  await msg(1, CA, { id: 1, type: "private" });
  assert.equal(bot.tagCount(CA), 1);
  await msg(2, CA);
  assert.equal(bot.tagCount(CA), 1);
  const n = sent.length;
  await msg(3, `/tag ${CA}`, { id: -100123, type: "supergroup" });
  assert.equal(sent.length, n);
});

test("rate limit", async () => {
  const { bot, msg, sent } = await setup();
  bot.now = (() => { let t = 1e12; return () => (t += 100); })();
  await msg(1, "/help");
  await msg(1, "/help");
  await msg(1, "/help");
  assert.equal(sent.length, 2);
  assert.match(sent[1].params.text, /Slow down/);
});

test("engagement pins at 5/8/9 only for powered calls", async () => {
  const { bot, sent, msg } = await setup();
  await msg(1, `/tag ${CA}`);
  let r = await bot.engagement({ ca: CA, replies: 9, reposts: 9, likes: 9 });
  assert.equal(r.pinned_now, false, "tagging coin is not pinned");
  for (let u = 2; u <= 9; u++) await msg(u, `/tag ${CA}`);
  r = await bot.engagement({ ca: CA, post_url: "https://x.com/PowerOf9Base/status/123456789", replies: 5, reposts: 7, likes: 9 });
  assert.equal(r.pinned_now, false);
  assert.equal(bot.coin(CA).status, "powered");
  const before = sent.length;
  r = await bot.engagement({ ca: CA, replies: 5, reposts: 8, likes: 9 });
  assert.equal(r.pinned_now, true);
  assert.equal(bot.coin(CA).status, "pinned");
  const after = sent.slice(before);
  assert.ok(after.some((s) => s.method === "pinChatMessage" && s.params.chat_id === CHANNEL));
  assert.ok(after.some((s) => s.method === "sendMessage" && s.params.chat_id === GROUP));
  r = await bot.engagement({ ca: CA, replies: 50, reposts: 80, likes: 90 });
  assert.equal(r.pinned_now, false, "pins once");
  assert.equal((await bot.engagement({ ca: "nope", replies: 1, reposts: 1, likes: 1 })).status, 400);
  assert.equal((await bot.engagement({ ca: CA, replies: -1, reposts: 1, likes: 1 })).status, 400);
});

test("anonymous admin or send-as-group gets one Send as warning (rate-limited per chat)", async () => {
  const { bot, sent } = await setup();
  const anon = (text) => bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: sent.length + 50,
      chat: { id: GROUP, type: "supergroup" },
      sender_chat: { id: GROUP, type: "supergroup", title: "Base Trenches" },
      from: { id: 1087968824, is_bot: true, username: "GroupAnonymousBot", first_name: "Group" },
      text,
    },
  });
  await anon(`/tag ${CA}`);
  assert.equal(sent.length, 1);
  assert.match(sent[0].params.text, /Send as/);
  assert.ok(sent[0].params.text.includes("personal account"));
  assert.equal(sent[0].params.parse_mode, "HTML");
  await anon(`/hot`);
  assert.equal(sent.length, 1, "rate-limited: one warning per chat");
  assert.equal(bot.tagCount(CA), 0, "anonymous tag is not applied");
  // automatic forwards stay silent
  const n = sent.length;
  await bot.handleUpdate({
    update_id: 9,
    message: {
      message_id: 9, chat: { id: GROUP, type: "supergroup" },
      sender_chat: { id: CHANNEL, type: "channel" },
      is_automatic_forward: true,
      from: { id: 777000, is_bot: true, first_name: "Telegram" },
      text: "/help",
    },
  });
  assert.equal(sent.length, n);
});

test("/events lists live and upcoming with escaped text", async () => {
  const db = await openDb();
  const sent = [];
  const events = {
    live: [{ id: "e1", title: "Raid <now>", type: "raid", start_at: Date.UTC(2026, 9, 28, 4, 0, 0), end_at: Date.UTC(2026, 9, 28, 6, 0, 0), description: "dig & duck" }],
    upcoming: [{ id: "e2", title: "AMA", type: "ama", start_at: Date.UTC(2026, 9, 29, 0, 0, 0), end_at: Date.UTC(2026, 9, 29, 1, 0, 0), description: "q&a" }],
    past: [],
  };
  const bot = new Bot({
    db,
    tg: async (method, params) => { sent.push({ method, params }); return { message_id: 1 }; },
    fetchJson: async (url) => url.endsWith("/events") ? events : { pairs: [] },
    now: () => Date.UTC(2026, 9, 28, 4, 2, 0),
    groupId: GROUP, channelId: CHANNEL,
    eventsUrl: "https://server.test/events",
    voteChatId: GROUP, announceChatId: CHANNEL,
  });
  await bot.handleUpdate({
    update_id: 1,
    message: { message_id: 1, chat: { id: GROUP, type: "supergroup" }, from: { id: 1, is_bot: false, username: "u1", first_name: "U" }, text: "/events" },
  });
  assert.match(sent.at(-1).params.text, /LIVE/);
  assert.match(sent.at(-1).params.text, /Raid &lt;now&gt;/);
  assert.match(sent.at(-1).params.text, /dig &amp; duck/);
  assert.match(sent.at(-1).params.text, /UPCOMING/);
  const announced = await bot.announceDueEvents();
  assert.ok(announced.sent.some((s) => s.when === "start"));
  assert.ok(sent.some((s) => s.params.chat_id === CHANNEL && /Starting now/.test(s.params.text)));
  assert.ok(sent.some((s) => s.params.chat_id === GROUP && /Starting now/.test(s.params.text)));
});

test("owner-only /setpost and price refresh tracks ATH and x", async () => {
  const { bot, msg, sent, prices } = await setup();
  for (let u = 1; u <= 9; u++) await msg(u, `/tag ${CA}`);
  await msg(5, `/setpost ${CA} https://x.com/PowerOf9Base/status/123456789`);
  assert.match(sent.at(-1).params.text, /Only the trench owners/);
  await msg(OWNER, `/setpost ${CA} https://x.com/PowerOf9Base/status/123456789`);
  assert.equal(bot.coin(CA).x_post_url, "https://x.com/PowerOf9Base/status/123456789");
  prices[CA] = 0.005; await bot.refreshPrices();
  prices[CA] = 0.003; await bot.refreshPrices();
  const c = bot.apiCoin(CA);
  assert.equal(c.ath_x, 5);
  assert.ok(Math.abs(c.cur_x - 3) < 1e-9);
  assert.equal(bot.apiCallers().items[0].best_x, 5);
  await msg(1, "/linkx @Caller_One");
  assert.equal(bot.apiCallers().items.find((x) => x.telegram_handle === "@user1").x_handle, "@Caller_One");
});

test("events cron: one post per milestone, no 1h post when already close, capped per run", async () => {
  const db = await openDb();
  const sent = [];
  let now = Date.UTC(2026, 9, 28, 4, 0, 0);
  const mk = (id, startMin) => ({ id, title: id, type: "raid", start_at: now + startMin * 60_000, end_at: now + (startMin + 60) * 60_000 });
  const events = { live: [], upcoming: [mk("soon10", 10), mk("in50", 50), mk("a", 45), mk("b", 46), mk("c", 47)], past: [] };
  const bot = new Bot({
    db, tg: async (method, params) => { sent.push({ method, params }); return { message_id: 1 }; },
    fetchJson: async () => events, now: () => now, groupId: GROUP, channelId: CHANNEL, eventsUrl: "https://server.test/events",
  });
  const r1 = await bot.announceDueEvents();
  assert.equal(r1.sent.length, 3, "at most 3 posts per run");
  assert.ok(!r1.sent.some((s) => s.id === "soon10"), "10 minutes out: no 'in one hour' post");
  const r2 = await bot.announceDueEvents();
  assert.ok(r2.sent.every((s) => !r1.sent.some((x) => x.id === s.id && x.when === s.when)), "never repeats");
  const again = await bot.announceDueEvents();
  assert.equal(again.sent.length, 0);
  now += 11 * 60_000; // soon10 has started
  events.live = [events.upcoming.shift()];
  const r3 = await bot.announceDueEvents();
  assert.deepEqual(r3.sent, [{ id: "soon10", when: "start" }]);
  assert.equal((await bot.announceDueEvents()).sent.length, 0);
  assert.equal(sent.filter((s) => /soon10/.test(s.params.text)).length, 2, "start post goes to group + channel once");
});

test("anonymous-admin /tag gets one rate-limited hint; other commands stay silent", async () => {
  const { bot, sent } = await setup();
  const anon = (text, id) => bot.handleUpdate({ update_id: 900 + id, message: { message_id: 900 + id, chat: { id: GROUP, type: "supergroup" }, sender_chat: { id: GROUP, type: "supergroup" }, from: { id: 1087968824, is_bot: true, username: "GroupAnonymousBot" }, text } });
  await anon("/hot", 1);
  assert.equal(sent.length, 0);
  await anon(`/tag ${CA}`, 2);
  assert.equal(sent.length, 1);
  assert.match(sent[0].params.text, /Send as/);
  await anon(`/tag ${CA}`, 3);
  assert.equal(sent.length, 1);
});
