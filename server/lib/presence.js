// Presence: one entry per person, not per socket.
// A logged-in (or verified guest) player is keyed by their profile id; an unverified socket is
// its own key. Sockets that have not been heard from (state, event or 'ping' heartbeat) for
// STALE_MS are dead (sleeping laptop, dropped mobile network, closed tab whose close frame never
// arrived) and are pruned. Pure logic so it can be unit tested without a Durable Object.

export const IDLE_MS = 15_000;          // no game state for this long = IDLE in the roster
export const HEARTBEAT_MS = 25_000;     // client sends 'ping' this often (auto-answered, no DO wake)
export const STALE_MS = 150_000;        // nothing at all for this long = dead socket, close it
                                        // (> 2 min so throttled background tabs, ~1 timer/min, survive)
export const REPLACE_IDLE_MS = IDLE_MS; // on a new join, older sockets of the same person idle this long are replaced

export const CLOSE_STALE = 4001;     // server closed a dead socket
export const CLOSE_REPLACED = 4002;  // the same person joined again from a newer connection

export function presenceKey(a) {
  if (!a) return null;
  return a.verifiedProfileId ? 'p:' + a.verifiedProfileId : 's:' + (a.sessionId || a.playerId || '');
}

// Last time we heard anything from this socket (ms). autoTs = the runtime's last auto-answered 'ping'.
export function lastSeen(a, autoTs = 0) {
  return Math.max(a.lastUpdate || 0, a.lastSeen || 0, a.joined || 0, autoTs || 0);
}

// entries: [{ ref, a, autoTs }] where a is the socket attachment (only joined sockets count).
// Returns { keep: [{ref, a, seen, key, idle}], stale: [ref], dupes: [ref] }.
// keep has one entry per person: the most recently active socket (state > heartbeat), ties → newest join.
export function dedupePresence(entries, now = Date.now(), staleMs = STALE_MS) {
  const best = new Map();
  const stale = [], dupes = [];
  for (const e of entries) {
    const a = e.a;
    if (!a || !a.playerId || a.bot) continue;
    const seen = lastSeen(a, e.autoTs);
    if (now - seen > staleMs) { stale.push(e.ref); continue; }
    const key = presenceKey(a);
    const cand = { ref: e.ref, a, seen, key, idle: !a.lastUpdate || now - a.lastUpdate > IDLE_MS };
    const cur = best.get(key);
    if (!cur) { best.set(key, cand); continue; }
    const better = (cand.a.lastUpdate || 0) > (cur.a.lastUpdate || 0) ||
      ((cand.a.lastUpdate || 0) === (cur.a.lastUpdate || 0) && (cand.a.joined || 0) > (cur.a.joined || 0));
    if (better) { dupes.push(cur.ref); best.set(key, cand); } else dupes.push(cand.ref);
  }
  return { keep: [...best.values()], stale, dupes };
}

// On join: which other sockets of the same person should be closed (idle ones = orphans from a
// reconnect or a forgotten tab). An actively playing second tab is kept (it is hidden from the roster).
export function socketsToReplace(entries, joining, now = Date.now()) {
  const key = presenceKey(joining);
  if (!key || !joining.verifiedProfileId) return [];
  const out = [];
  for (const e of entries) {
    const a = e.a;
    if (!a || a === joining || !a.playerId || a.sessionId === joining.sessionId) continue;
    if (presenceKey(a) !== key) continue;
    if (!a.lastUpdate || now - a.lastUpdate > REPLACE_IDLE_MS) out.push(e.ref);
  }
  return out;
}
