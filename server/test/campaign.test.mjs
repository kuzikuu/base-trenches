import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAPTERS,
  emptyProgress,
  canComplete,
  completeMission,
  noteStat,
  chapterUnlocked,
  missionReady,
  campaignPublic,
} from "../lib/campaign.js";

test("campaign has five named chapters with 3–5 missions and a boss each", () => {
  const names = CHAPTERS.map((c) => c.name);
  assert.deepEqual(names, ["Basic Training", "The Front", "No Man's Land", "Over the Top", "The Big Push"]);
  for (const ch of CHAPTERS) {
    assert.ok(ch.missions.length >= 3 && ch.missions.length <= 5);
    assert.ok(ch.missions.some((m) => m.boss));
    assert.ok(ch.rewards.title);
    assert.ok(ch.rewards.gear);
  }
});

test("chapters stay locked until the previous boss is done", () => {
  let p = emptyProgress();
  const front = CHAPTERS[1];
  assert.equal(chapterUnlocked(p, CHAPTERS[0]), true);
  assert.equal(chapterUnlocked(p, front), false);
  assert.equal(canComplete(p, front.id, front.missions[0].id).reason, "locked_chapter");

  p = noteStat(p, "depth", 25);
  p = noteStat(p, "survive", 3);
  p = noteStat(p, "relic", 1);
  p = noteStat(p, "boss", 1);
  for (const m of CHAPTERS[0].missions) {
    const r = completeMission(p, CHAPTERS[0].id, m.id);
    assert.equal(r.ok, true, m.id);
    p = r.progress;
  }
  assert.equal(chapterUnlocked(p, front), true);
  assert.ok(p.titles.includes("Recruit"));
});

test("missions are linear inside a chapter and require matching stats", () => {
  let p = emptyProgress();
  const ch = CHAPTERS[0];
  assert.equal(canComplete(p, ch.id, ch.missions[0].id).reason, "stats");
  p = noteStat(p, "depth", 25);
  assert.equal(canComplete(p, ch.id, ch.missions[0].id).ok, true);
  assert.equal(canComplete(p, ch.id, ch.missions[1].id).reason, "locked_mission");
  const first = completeMission(p, ch.id, ch.missions[0].id);
  p = first.progress;
  assert.equal(missionReady(p, ch, ch.missions[0]), false);
  assert.equal(canComplete(p, ch.id, ch.missions[0].id).reason, "already");
  assert.equal(canComplete(p, ch.id, ch.missions[1].id).reason, "stats");
  p = noteStat(p, "survive", 3);
  assert.equal(canComplete(p, ch.id, ch.missions[1].id).ok, true);
});

test("boss completion grants title + gear once; campaignPublic reflects unlocks", () => {
  let p = emptyProgress();
  p = noteStat(p, "depth", 25);
  p = noteStat(p, "survive", 3);
  p = noteStat(p, "relic", 1);
  p = noteStat(p, "boss", 1);
  let last;
  for (const m of CHAPTERS[0].missions) {
    last = completeMission(p, CHAPTERS[0].id, m.id);
    p = last.progress;
  }
  assert.equal(last.ok, true);
  assert.equal(last.rewards.length, 1);
  assert.equal(last.rewards[0].title, "Recruit");
  assert.equal(last.rewards[0].gear.name, "Tin Helmet");
  const pub = campaignPublic(p);
  assert.equal(pub.chapters[0].missions.every((m) => m.done), true);
  assert.equal(pub.chapters[1].unlocked, true);
  assert.equal(pub.titles[0], "Recruit");
});

test("unknown mission is rejected", () => {
  assert.equal(canComplete(emptyProgress(), "nope", "x").reason, "unknown");
});
