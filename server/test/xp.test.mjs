import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEvent,
  scoreValidatedEvent,
  validateDig,
  validateDepth,
  createXpWindow,
  CAPS_PER_MINUTE,
  XP,
  depthFromY,
  TILE_SIZE,
  TRENCH_FLOOR_TILE,
} from "../lib/xp.js";

test("validateDig rejects already-dug tiles and tiles too far from the player", () => {
  const dug = new Set(["3,20"]);
  assert.equal(validateDig({ dugSet: dug, x: 3, y: 20 }).reason, "already_dug");
  assert.equal(validateDig({ x: "nope", y: 1 }).reason, "bad_tile");
  const far = validateDig({
    dugSet: new Set(),
    x: 30, y: 40,
    playerX: 5 * TILE_SIZE, playerY: 14 * TILE_SIZE
  });
  assert.equal(far.reason, "too_far");
  const near = validateDig({
    dugSet: new Set(),
    x: 5, y: 15,
    playerX: 5 * TILE_SIZE + 4, playerY: 15 * TILE_SIZE
  });
  assert.equal(near.ok, true);
  assert.equal(near.key, "5,15");
});

test("validateDepth requires a 5m step and matches player Y", () => {
  assert.equal(validateDepth({ depth: 4, lastAwarded: 0 }).reason, "too_soon");
  assert.equal(validateDepth({ depth: 10, lastAwarded: 0 }).ok, true);
  const y = (TRENCH_FLOOR_TILE + 8) * TILE_SIZE;
  assert.equal(validateDepth({ depth: 40, lastAwarded: 0, playerY: y }).reason, "depth_mismatch");
  assert.equal(validateDepth({ depth: 8, lastAwarded: 0, playerY: y }).ok, true);
  assert.equal(depthFromY(y), 8);
});

test("applyEvent scores known kinds and enforces per-kind + XP-per-minute caps", () => {
  let win = createXpWindow();
  const now = 1_000_000;
  const d = applyEvent(win, { kind: "dig" }, now);
  assert.equal(d.ok, true);
  assert.equal(d.xp, XP.DIG);
  const dodge = applyEvent(d.window, { kind: "dodge" }, now + 10);
  assert.equal(dodge.xp, XP.DODGE);
  const hit = applyEvent(dodge.window, { kind: "hit" }, now + 20);
  assert.equal(hit.ok, true);
  assert.equal(hit.xp, XP.HIT);

  let w = createXpWindow();
  for (let i = 0; i < CAPS_PER_MINUTE.dodge; i++) {
    const r = applyEvent(w, { kind: "dodge" }, now + i);
    assert.equal(r.ok, true);
    w = r.window;
  }
  const over = applyEvent(w, { kind: "dodge" }, now + 50);
  assert.equal(over.ok, false);
  assert.equal(over.reason, "rate_kind");

  let xpWin = createXpWindow();
  // Fill the XP cap with boss events (100 each, cap 250 → 2 ok, 3rd trips xp cap)
  let r1 = applyEvent(xpWin, { kind: "boss" }, now);
  let r2 = applyEvent(r1.window, { kind: "boss" }, now + 1);
  assert.equal(r1.ok && r2.ok, true);
  // boss cap is 2/min so a third boss is rate_kind; use mission xp to trip rate_xp
  const r3 = applyEvent(r2.window, { kind: "mission", xp: 80 }, now + 2);
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, "rate_xp");
});

test("scoreValidatedEvent ties digs to the shared map and ignores unknown kinds", () => {
  const dugSet = new Set();
  const ctx = {
    dugSet,
    playerX: 10 * TILE_SIZE,
    playerY: 20 * TILE_SIZE,
    window: createXpWindow(),
    now: 5_000
  };
  const ok = scoreValidatedEvent({ kind: "dig", x: 10, y: 20 }, ctx);
  assert.equal(ok.ok, true);
  dugSet.add("10,20");
  const dupe = scoreValidatedEvent({ kind: "dig", x: 10, y: 20 }, { ...ctx, window: ok.window });
  assert.equal(dupe.reason, "already_dug");
  const bad = scoreValidatedEvent({ kind: "hack" }, ctx);
  assert.equal(bad.ok, false);
});

test("window prunes events older than 60s so caps reset", () => {
  let win = createXpWindow();
  const t0 = 10_000;
  for (let i = 0; i < CAPS_PER_MINUTE.hit; i++) {
    const r = applyEvent(win, { kind: "hit" }, t0);
    win = r.window;
  }
  assert.equal(applyEvent(win, { kind: "hit" }, t0 + 100).ok, false);
  const later = applyEvent(win, { kind: "hit" }, t0 + 60_001);
  assert.equal(later.ok, true);
});
