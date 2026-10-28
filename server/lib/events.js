// Events calendar: validation, upcoming/live/past, ICS, admin bearer check.

export const EVENT_TYPES = ['raid', 'dig_night', 'launch', 'ama'];

export function safeEq(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function authorizeAdmin(header, key) {
  if (!key || String(key).length < 8) return false;
  const got = String(header || '').replace(/^Bearer\s+/i, '');
  return safeEq(got, String(key));
}

export function parseTime(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function eventStatus(startAt, endAt, now = Date.now()) {
  if (now < startAt) return 'upcoming';
  if (now <= endAt) return 'live';
  return 'past';
}

export function validateEventInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' };
  const title = String(body.title || '').trim().slice(0, 80);
  if (!title) return { ok: false, error: 'title required' };
  const type = String(body.type || '').trim().replace(/\s+/g, '_').toLowerCase();
  if (!EVENT_TYPES.includes(type)) return { ok: false, error: 'type must be raid, dig_night, launch, or ama' };
  const startAt = parseTime(body.start || body.start_at || body.startAt);
  const endAt = parseTime(body.end || body.end_at || body.endAt);
  if (startAt == null || endAt == null) return { ok: false, error: 'start and end must be UTC timestamps' };
  if (endAt <= startAt) return { ok: false, error: 'end must be after start' };
  const description = String(body.description || '').trim().slice(0, 2000);
  return {
    ok: true,
    event: {
      title,
      type,
      start_at: startAt,
      end_at: endAt,
      description
    }
  };
}

export function classifyEvents(events, now = Date.now()) {
  const upcoming = [];
  const live = [];
  const past = [];
  for (const e of events || []) {
    const row = { ...e, status: eventStatus(e.start_at, e.end_at, now) };
    if (row.status === 'upcoming') upcoming.push(row);
    else if (row.status === 'live') live.push(row);
    else past.push(row);
  }
  upcoming.sort((a, b) => a.start_at - b.start_at);
  live.sort((a, b) => a.start_at - b.start_at);
  past.sort((a, b) => b.start_at - a.start_at);
  return { upcoming, live, past, now };
}

export function icsEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function icsUtc(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function foldIcs(line) {
  if (line.length <= 74) return line;
  let out = '';
  let rest = line;
  out += rest.slice(0, 74);
  rest = rest.slice(74);
  while (rest.length) {
    out += '\r\n ' + rest.slice(0, 73);
    rest = rest.slice(73);
  }
  return out;
}

export function eventToVevent(ev, { prodId = '-//Base Trenches//Events//EN', now = Date.now() } = {}) {
  const uid = `${ev.id || 'event'}@basetrenches`;
  const lines = [
    'BEGIN:VEVENT',
    foldIcs(`UID:${uid}`),
    foldIcs(`DTSTAMP:${icsUtc(now)}`),
    foldIcs(`DTSTART:${icsUtc(ev.start_at)}`),
    foldIcs(`DTEND:${icsUtc(ev.end_at)}`),
    foldIcs(`SUMMARY:${icsEscape(ev.title)}`),
    foldIcs(`DESCRIPTION:${icsEscape(ev.description || '')}`),
    foldIcs(`CATEGORIES:${icsEscape(ev.type || '')}`),
    foldIcs(`URL:https://base-trenches.pages.dev/#events`),
    'END:VEVENT'
  ];
  return lines.join('\r\n');
}

export function eventsToIcs(events, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const vevents = (events || []).map(e => eventToVevent(e, { ...opts, now })).join('\r\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Base Trenches//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Base Trenches',
    vevents,
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n') + '\r\n';
}

/** In-memory store used by tests (mirrors the Events DO API). */
export function createEventStore() {
  const rows = new Map();
  const scores = new Map(); // eventId -> Map(profileId -> {name, score})
  return {
    list() { return [...rows.values()]; },
    get(id) { return rows.get(id) || null; },
    put(ev) { rows.set(ev.id, ev); return ev; },
    delete(id) {
      const ok = rows.delete(id);
      scores.delete(id);
      return ok;
    },
    addScore(eventId, profileId, name, delta) {
      if (!rows.has(eventId)) return null;
      if (!scores.has(eventId)) scores.set(eventId, new Map());
      const m = scores.get(eventId);
      const cur = m.get(profileId) || { profile_id: profileId, name: name || 'Trencher', score: 0 };
      cur.score += delta;
      if (name) cur.name = name;
      m.set(profileId, cur);
      return cur;
    },
    leaderboard(eventId, limit = 20) {
      const m = scores.get(eventId);
      if (!m) return [];
      return [...m.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    }
  };
}

export function handleEventsApi(store, { method, path, body, adminKey, authHeader, now = Date.now(), newId } = {}) {
  const p = path.replace(/\/+$/, '') || '/';
  if (method === 'GET' && (p === '/events' || p === '/api/events')) {
    const classified = classifyEvents(store.list(), now);
    const live = classified.live.map(e => ({
      ...e,
      leaderboard: store.leaderboard(e.id)
    }));
    return { status: 200, body: { ...classified, live, events: store.list() } };
  }
  if (method === 'GET' && (p === '/events.ics' || p === '/api/events.ics')) {
    return { status: 200, ics: eventsToIcs(store.list(), { now }), contentType: 'text/calendar; charset=utf-8' };
  }
  const oneIcs = p.match(/^\/(?:api\/)?events\/([^/]+)\.ics$/);
  if (method === 'GET' && oneIcs) {
    const ev = store.get(decodeURIComponent(oneIcs[1]));
    if (!ev) return { status: 404, body: { error: 'not found' } };
    return { status: 200, ics: eventsToIcs([ev], { now }), contentType: 'text/calendar; charset=utf-8' };
  }
  const lb = p.match(/^\/(?:api\/)?events\/([^/]+)\/leaderboard$/);
  if (method === 'GET' && lb) {
    const id = decodeURIComponent(lb[1]);
    if (!store.get(id)) return { status: 404, body: { error: 'not found' } };
    return { status: 200, body: { leaderboard: store.leaderboard(id) } };
  }
  if ((method === 'POST' || method === 'DELETE') && !authorizeAdmin(authHeader, adminKey)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  if (method === 'POST' && (p === '/events' || p === '/api/events')) {
    const v = validateEventInput(body);
    if (!v.ok) return { status: 400, body: { error: v.error } };
    const ev = {
      id: (newId && newId()) || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(now)),
      ...v.event,
      created_at: now
    };
    store.put(ev);
    return { status: 200, body: { ok: true, event: ev } };
  }
  const del = p.match(/^\/(?:api\/)?events\/([^/]+)$/);
  if (method === 'DELETE' && del) {
    const id = decodeURIComponent(del[1]);
    if (!store.delete(id)) return { status: 404, body: { error: 'not found' } };
    return { status: 200, body: { ok: true } };
  }
  if (method === 'DELETE' && (p === '/events' || p === '/api/events') && body && body.id) {
    if (!store.delete(String(body.id))) return { status: 404, body: { error: 'not found' } };
    return { status: 200, body: { ok: true } };
  }
  return { status: 404, body: { error: 'not found' } };
}
