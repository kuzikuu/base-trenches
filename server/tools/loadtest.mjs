// Load test for the PREVIEW server only. Usage (needs `npm i ws`): RATE_MS=100 node tools/loadtest.mjs <clients> <room> <seconds> [procs]
// WebSocket load test for the PREVIEW TrenchRoom only.
// usage: node loadtest.mjs <clients> <room> <seconds> [procs]
import { fork } from 'node:child_process';
import WebSocket from 'ws';
const HOST = 'wss://base-trenches-server-preview.base-trenches.workers.dev';
if (!HOST.includes('preview')) throw new Error('preview only');

if (process.argv[2] === '--child') {
  const [, , , n, room, secs, offset] = process.argv;
  runChild(+n, room, +secs, +offset).then(r => { process.send(r); process.exit(0); });
} else {
  const N = +(process.argv[2] || 25), room = process.argv[3] || 'lt', secs = +(process.argv[4] || 30);
  const procs = Math.min(+(process.argv[5] || 8), N);
  const per = Math.ceil(N / procs); const res = []; let left = N, off = 0;
  const kids = [];
  for (let i = 0; i < procs && left > 0; i++) {
    const n = Math.min(per, left); left -= n;
    kids.push(new Promise(ok => { const c = fork(new URL(import.meta.url).pathname, ['--child', String(n), room, String(secs), String(off)]); c.on('message', m => { res.push(m); ok(); }); c.on('exit', () => ok()); }));
    off += n;
  }
  await Promise.all(kids);
  const all = res.flatMap(r => r.rtts); all.sort((a, b) => a - b);
  const q = p => all.length ? all[Math.min(all.length - 1, Math.floor(p * all.length))] : null;
  const sum = k => res.reduce((s, r) => s + r[k], 0);
  const conn = res.flatMap(r => r.connMs).sort((a, b) => a - b);
  const out = {
    N, room, secs, rate_ms: +(process.env.RATE_MS || 100), connected: sum('connected'), rejected503: sum('rejected'), errors: sum('errors'), earlyCloses: sum('closes'),
    connect_ms_p50: conn[Math.floor(conn.length / 2)] || null, connect_ms_p95: conn[Math.floor(conn.length * 0.95)] || null,
    dig_rtt_ms: { n: all.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: all[all.length - 1] || null },
    digs_sent: sum('digsSent'), digs_lost_pct: +(100 * (1 - all.length / Math.max(1, sum('digsSent')))).toFixed(1),
    states_hz_per_client: +(sum('states') / Math.max(1, sum('connected')) / secs).toFixed(2),
    avg_states_bytes: Math.round(sum('stateBytes') / Math.max(1, sum('states'))),
    rx_kB_s_per_client: +(sum('bytes') / Math.max(1, sum('connected')) / secs / 1024).toFixed(1),
    playerCount_seen_max: Math.max(...res.map(r => r.maxCount)),
    close_codes: res.reduce((o, r) => { for (const [k, v] of Object.entries(r.closeCodes)) o[k] = (o[k] || 0) + v; return o; }, {}),
  };
  console.log(JSON.stringify(out));
}

async function runChild(n, room, secs, offset) {
  const r = { connected: 0, rejected: 0, errors: 0, closes: 0, rtts: [], connMs: [], closeCodes: {}, digsSent: 0, states: 0, stateBytes: 0, bytes: 0, maxCount: 0 };
  const socks = []; let measuring = false; const stopAt = { t: 0 };
  const pending = new Map();
  await Promise.all(Array.from({ length: n }, (_, i) => new Promise(done => {
    setTimeout(() => {
      const t0 = Date.now();
      const ws = new WebSocket(`${HOST}/api/ws?room=${encodeURIComponent(room)}`, { headers: { Origin: 'https://base-trenches.pages.dev' } });
      let ok = false;
      ws.on('unexpected-response', (req, res) => { if (res.statusCode === 503) r.rejected++; else r.errors++; done(); });
      ws.on('error', () => { if (!ok) { r.errors++; done(); } });
      ws.on('open', () => {
        ok = true; r.connected++; r.connMs.push(Date.now() - t0);
        ws.send(JSON.stringify({ type: 'join', name: 'LT' + (offset + i) }));
        socks.push(ws); done();
      });
      ws.on('close', (code, reason) => { if (ok && measuring && Date.now() < stopAt.t - 500) { r.closes++; const k = code + ' ' + String(reason).slice(0, 80); r.closeCodes[k] = (r.closeCodes[k] || 0) + 1; } });
      ws.on('message', (buf) => {
        if (!measuring) return;
        r.bytes += buf.length;
        // cheap prefix checks instead of parsing every big states frame
        if (buf[9] === 0x73 && buf.toString('latin1', 0, 16).startsWith('{"type":"states"')) {
          r.states++; r.stateBytes += buf.length;
          const str = buf.toString('latin1'); const at = str.lastIndexOf('"playerCount":');
          const m = at >= 0 ? /^"playerCount":(\d+)/.exec(str.slice(at, at + 24)) : null;
          if (m) r.maxCount = Math.max(r.maxCount, +m[1]);
        } else if (buf.toString('latin1', 0, 13) === '{"type":"dig"') {
          const d = JSON.parse(buf); const k = d.x + ',' + d.y; const p = pending.get(k);
          if (p && p.ws === ws) { r.rtts.push(Date.now() - p.t); pending.delete(k); }
        }
      });
    }, Math.floor(Math.random() * Math.min(8000, 40 * n)));
  })));
  // steady state
  measuring = true; stopAt.t = Date.now() + secs * 1000;
  const timers = [];
  socks.forEach((ws, i) => {
    let x = 30 + Math.random() * 400, face = 1;
    timers.push(setInterval(() => {
      if (ws.readyState !== 1) return;
      if (Math.random() < 0.05) face = -face; x = Math.max(20, Math.min(460, x + face * 4));
      ws.send(JSON.stringify({ type: 'state', x: Math.round(x), y: 157, vx: face * 60, vy: 0, face, swing: Math.random() < 0.3 ? 1 : 0, level: 3 }));
    }, +(process.env.RATE_MS || 100)));
    timers.push(setInterval(() => {
      if (ws.readyState !== 1) return;
      const bx = 1 + ((Math.random() * 38) | 0), by = 3000 + ((Math.random() * 1e6) | 0);
      pending.set(bx + ',' + by, { ws, t: Date.now() }); r.digsSent++;
      ws.send(JSON.stringify({ type: 'dig', x: bx, y: by }));
    }, 1500 + Math.random() * 1000));
    timers.push(setInterval(() => { if (ws.readyState === 1 && Math.random() < 0.3) ws.send(JSON.stringify({ type: 'chat', text: 'GM' })); }, 30000));
  });
  await new Promise(ok => setTimeout(ok, secs * 1000));
  measuring = false; timers.forEach(clearInterval);
  socks.forEach(ws => { try { ws.close(1000); } catch (e) {} });
  await new Promise(ok => setTimeout(ok, 500));
  return r;
}
