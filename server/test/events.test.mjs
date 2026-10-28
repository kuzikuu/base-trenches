import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEventInput,
  eventStatus,
  classifyEvents,
  eventsToIcs,
  icsEscape,
  authorizeAdmin,
  handleEventsApi,
  createEventStore,
  EVENT_TYPES,
} from "../lib/events.js";

const KEY = "test-admin-key-12345";
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);

test("validateEventInput accepts the four types and rejects bad payloads", () => {
  for (const type of EVENT_TYPES) {
    const v = validateEventInput({
      title: "Night " + type,
      type,
      start: "2026-10-28T18:00:00Z",
      end: "2026-10-28T20:00:00Z",
      description: "dig",
    });
    assert.equal(v.ok, true, type);
    assert.equal(v.event.type, type);
  }
  assert.equal(validateEventInput({}).ok, false);
  assert.equal(validateEventInput({ title: "x", type: "party", start: T0, end: T0 + 1 }).error.includes("type"), true);
  assert.equal(validateEventInput({ title: "x", type: "raid", start: T0, end: T0 }).error.includes("end"), true);
});

test("eventStatus and classifyEvents split upcoming / live / past", () => {
  assert.equal(eventStatus(T0 + 1000, T0 + 2000, T0), "upcoming");
  assert.equal(eventStatus(T0 - 1000, T0 + 2000, T0), "live");
  assert.equal(eventStatus(T0 - 2000, T0 - 1000, T0), "past");
  const { upcoming, live, past } = classifyEvents([
    { id: "a", title: "A", start_at: T0 + 3600_000, end_at: T0 + 7200_000, type: "ama" },
    { id: "b", title: "B", start_at: T0 - 60_000, end_at: T0 + 60_000, type: "raid" },
    { id: "c", title: "C", start_at: T0 - 7200_000, end_at: T0 - 3600_000, type: "launch" },
  ], T0);
  assert.deepEqual(upcoming.map((e) => e.id), ["a"]);
  assert.deepEqual(live.map((e) => e.id), ["b"]);
  assert.deepEqual(past.map((e) => e.id), ["c"]);
});

test("ICS feed escapes text and includes UTC stamps", () => {
  const ics = eventsToIcs([{
    id: "e1",
    title: "Raid; night, go",
    description: "Line 1\nLine 2",
    type: "raid",
    start_at: T0,
    end_at: T0 + 3600_000,
  }], { now: T0 });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART:20261028T120000Z/);
  assert.match(ics, /DTEND:20261028T130000Z/);
  assert.match(ics, /SUMMARY:Raid\\; night\\, go/);
  assert.match(ics, /DESCRIPTION:Line 1\\nLine 2/);
  assert.equal(icsEscape("a;b,c"), "a\\;b\\,c");
});

test("events API: public GET, admin POST/DELETE, ICS, live leaderboard", () => {
  const store = createEventStore();
  const get = handleEventsApi(store, { method: "GET", path: "/events", now: T0 });
  assert.equal(get.status, 200);
  assert.equal(get.body.upcoming.length, 0);

  const denied = handleEventsApi(store, {
    method: "POST", path: "/events", body: { title: "x", type: "raid", start: T0, end: T0 + 1 },
    adminKey: KEY, authHeader: "Bearer nope", now: T0,
  });
  assert.equal(denied.status, 401);

  const created = handleEventsApi(store, {
    method: "POST", path: "/events",
    body: { title: "Dig Night", type: "dig_night", start: T0 - 1000, end: T0 + 3600_000, description: "shovels" },
    adminKey: KEY, authHeader: "Bearer " + KEY, now: T0, newId: () => "evt-1",
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.event.id, "evt-1");

  store.addScore("evt-1", "did:privy:1", "Ace", 40);
  const listed = handleEventsApi(store, { method: "GET", path: "/events", now: T0 });
  assert.equal(listed.body.live.length, 1);
  assert.equal(listed.body.live[0].leaderboard[0].score, 40);

  const ics = handleEventsApi(store, { method: "GET", path: "/events.ics", now: T0 });
  assert.equal(ics.status, 200);
  assert.match(ics.ics, /Dig Night/);
  const one = handleEventsApi(store, { method: "GET", path: "/events/evt-1.ics", now: T0 });
  assert.match(one.ics, /UID:evt-1@basetrenches/);

  const del = handleEventsApi(store, {
    method: "DELETE", path: "/events/evt-1", adminKey: KEY, authHeader: "Bearer " + KEY, now: T0,
  });
  assert.equal(del.status, 200);
  assert.equal(handleEventsApi(store, { method: "GET", path: "/events", now: T0 }).body.live.length, 0);
});

test("authorizeAdmin is length-safe", () => {
  assert.equal(authorizeAdmin("Bearer " + KEY, KEY), true);
  assert.equal(authorizeAdmin("Bearer " + KEY + "x", KEY), false);
  assert.equal(authorizeAdmin("Bearer x", KEY), false);
  assert.equal(authorizeAdmin("Bearer " + KEY, ""), false);
});
