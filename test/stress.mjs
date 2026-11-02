// Load / stress test for the game server - bots join real worlds, move, build, chat and trade.
//
//   node test/stress.mjs                       local: spins up an isolated server + a 150k-edit world, 96 bots, 40 s
//   node test/stress.mjs --bots 200 --seconds 60
//   node test/stress.mjs --url https://my.server --password <admin password> --bots 40   target a RUNNING server (e.g. the deployed one)
//
// Reports tick time, event-loop lag, bandwidth (per message kind), latency percentiles, join time, memory and persistence.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const BOTS = +arg('bots', process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 96), SECONDS = +arg('seconds', 40), REMOTE = arg('url', ''), PW = arg('password', 'stress-token-123');
const PORT = 8091, ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = REMOTE ? REMOTE.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`, WSBASE = BASE.replace(/^http/, 'ws'), sleep = ms => new Promise(r => setTimeout(r, ms));
const api = (m, p, b) => fetch(BASE + '/api/admin' + p, { method: m, headers: { Authorization: 'Bearer ' + PW, ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

let srv = null, DATA = null, srvErr = '';
if (!REMOTE) {
  DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-stress-')); fs.mkdirSync(path.join(DATA, 'worlds'), { recursive: true });
  // a world with 150k pre-existing edits (compact per-chunk snapshot) to test join sync + chunk generation with a big edit index
  const per = new Map(); for (let i = 0; i < 150000; i++) { const x = (Math.random() * 480 - 240) | 0, z = (Math.random() * 480 - 240) | 0, y = 20 + ((Math.random() * 30) | 0), k = (x >> 4) + ',' + (z >> 4); let a = per.get(k); if (!a) per.set(k, a = []); a.push((x & 15) + 16 * ((z & 15) + 16 * y), 1 + (i % 12)); }
  fs.writeFileSync(path.join(DATA, 'worlds', 'big.edits.json'), JSON.stringify([...per].map(([k, a]) => [...k.split(',').map(Number), a])));
  fs.writeFileSync(path.join(DATA, 'worlds', 'big.meta.json'), JSON.stringify({ meta: { id: 'big', name: 'Big', seed: 42, type: 'normal', mode: 'creative' }, wallets: {}, time: .3, weather: 'clear' }));
  fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify({ name: 'Stress', motd: 'x', maxPlayers: 64, password: null, worlds: [{ id: 'big', name: 'Big', seed: 42, type: 'normal', mode: 'creative', dayLength: 420, maxPlayers: 64, mobs: true, hostile: true, economy: false }], bans: { names: [], ips: [], uids: [] }, ops: [], admin: null }));
  srv = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_PASSWORD: PW, MAX_PER_IP: '1000', WS_RATE: '100000', LOG_LEVEL: 'error' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => srvErr += d);
}
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* starting */ } await sleep(250); }

const stats = { sent: 0, recv: 0, bytes: 0, kinds: {}, rtts: [], drops: 0, joined: 0, joinMs: [], states: 0, stateBytes: 0 };
const bots = [];
function bot(world, i, mode) {
  return new Promise(res => {
    const ws = new WebSocket(`${WSBASE}/ws/${world}`, { perMessageDeflate: true }); const b = { ws, id: 0, x: 0, y: 0, z: 0, t0: Date.now(), done: false }; const timers = [];
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Bot' + i, uid: 'u' + world + i, v: 2, q: process.env.NO_COMPACT ? 0 : 1 })));
    ws.on('message', (d, isBin) => {
      stats.recv++; stats.bytes += d.length;
      if (isBin) { stats.kinds.state = (stats.kinds.state || 0) + d.length; stats.states++; stats.stateBytes += d.length; return; }
      const m = JSON.parse(d); stats.kinds[m.t] = (stats.kinds[m.t] || 0) + d.length;
      if (m.t === 'init') {
        b.id = m.id; [b.x, b.y, b.z] = m.spawn; stats.joined++; stats.joinMs.push(Date.now() - b.t0); res(b);
        const send = o => { if (ws.readyState === 1) { ws.send(JSON.stringify(o)); stats.sent++; } };
        let ang = Math.random() * 6.28;
        timers.push(setInterval(() => { ang += (Math.random() - .5) * .4; b.x += Math.cos(ang) * .3; b.z += Math.sin(ang) * .3; send({ t: 'pos', x: b.x, y: b.y, z: b.z, yaw: ang, pitch: 0, st: 0 }); }, 66)); // 15 Hz like a real client
        timers.push(setInterval(() => { const x = Math.floor(b.x) + ((Math.random() * 6) | 0) - 3, z = Math.floor(b.z) + ((Math.random() * 6) | 0) - 3; send({ t: 'block', x, y: Math.floor(b.y) - 1, z, id: Math.random() < .5 ? 0 : 3 }); }, 1800)); // ~0.5 edits/s
        timers.push(setInterval(() => send({ t: 'chat', text: 'hello from bot ' + i }), 9000 + Math.random() * 6000));
        timers.push(setInterval(() => send({ t: 'ping', ts: Date.now() }), 2000));
        if (mode === 'survival') timers.push(setInterval(() => send({ t: 'trade', action: 'buy', id: 8, n: 1 }), 4000));
      } else if (m.t === 'pong') stats.rtts.push(Date.now() - m.ts);
    });
    ws.on('close', () => { timers.forEach(clearInterval); if (b.id && !b.done) stats.drops++; }); ws.on('error', () => res(b)); b.stop = () => { b.done = true; ws.close(); };
    setTimeout(() => res(b), 20000);
  });
}

console.log(REMOTE ? `target: ${BASE} (remote)` : `local server pid ${srv.pid}, data ${DATA}`);
const s0 = await api('GET', '/status').catch(() => null); if (!s0 || s0.error) { console.log('cannot read admin status - check --url/--password', JSON.stringify(s0), srvErr.slice(0, 400)); process.exit(2); }
let worldIds;
let created = [];
{
  worldIds = []; for (const [name, mode, eco] of [['stress-alpha', 'creative', false], ['stress-beta', 'survival', true], ['stress-gamma', 'creative', false]]) { const r = await fetch(BASE + '/api/admin/worlds', { method: 'POST', headers: { Authorization: 'Bearer ' + PW, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type: 'normal', mode, economy: eco, maxPlayers: 64, mobs: true, hostile: true, seed: name }) }).then(r => r.json()); worldIds.push(r.id); created.push(r.id); }
  await api('POST', `/worlds/${worldIds[0]}/command`, { cmd: 'time night' });
}
if (!REMOTE) {
  // join a client to the 150k-edit world and time the full edit sync
  const t = Date.now(); let batches = 0, last = false; const ws = new WebSocket(`${WSBASE}/ws/big`); let initMs = 0;
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'BigJoin', uid: 'bigjoin' }))); ws.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d); if (m.t === 'init') initMs = Date.now() - t; if (m.t === 'edits') { batches++; if (m.last) last = true; } });
  for (let i = 0; i < 400 && !last; i++) await sleep(25); console.log(`150k-edit world: init after ${initMs} ms, all ${batches} edit batches synced in ${Date.now() - t} ms`); ws.close();
}
const target = REMOTE ? worldIds : worldIds;
for (let i = 0; i < BOTS; i++) { const wi = i % target.length; bots.push(bot(target[wi], i, wi % 3 === 1 ? 'survival' : 'creative')); if (i % 12 === 11) await sleep(250); }
await Promise.all(bots);
console.log(`${stats.joined}/${BOTS} bots joined, avg join ${Math.round(stats.joinMs.reduce((a, b) => a + b, 0) / Math.max(1, stats.joinMs.length))} ms`);

const samples = [], base = { recv: stats.recv, bytes: stats.bytes, sent: stats.sent, kinds: { ...stats.kinds } }, t0 = Date.now();
for (let s = 0; s < SECONDS / 2; s++) { await sleep(2000); const st = await api('GET', '/status'); samples.push({ tick: st.tickMs, lag: st.loopLagMs ?? 0, lag99: st.loopLagP99 ?? 0, rss: st.rss, heap: st.heap, players: st.players, mobs: st.worlds.reduce((a, w) => a + w.mobs, 0) }); }
const el = (Date.now() - t0) / 1000, avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)] ?? 0, mb = n => (n / 1048576).toFixed(1) + ' MB';
const down = (stats.bytes - base.bytes) / el;
console.log('\n=== results ===');
console.log(`players online      : ${samples.at(-1).players}, NPCs ${samples.at(-1).mobs}`);
console.log(`server tick (ms)    : avg ${avg(samples.map(s => s.tick)).toFixed(2)}  max ${Math.max(...samples.map(s => s.tick)).toFixed(2)}   (budget 50 ms)`);
console.log(`event-loop lag (ms) : mean ${avg(samples.map(s => s.lag)).toFixed(2)}  p99 ${Math.max(...samples.map(s => s.lag99)).toFixed(1)}`);
console.log(`server memory       : rss ${mb(s0.rss)} -> ${mb(samples.at(-1).rss)}   heap ${mb(samples.at(-1).heap)}`);
console.log(`ping RTT (ms)       : avg ${avg(stats.rtts).toFixed(1)}  p95 ${pct(stats.rtts, .95)}  p99 ${pct(stats.rtts, .99)}  max ${Math.max(0, ...stats.rtts)}`);
console.log(`bandwidth           : ${(down / 1024).toFixed(0)} KB/s downstream total = ${(down / Math.max(1, stats.joined) / 1024).toFixed(2)} KB/s per bot;  upstream ${((stats.sent - base.sent) / el).toFixed(0)} msg/s`);
console.log(`downstream by kind  : ${Object.entries(stats.kinds).map(([k, v]) => [k, v - (base.kinds[k] || 0)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${(v / el / 1024).toFixed(0)}KB/s`).join('  ')}`);
console.log(`state frames        : ${stats.states} binary frames, avg ${(stats.stateBytes / Math.max(1, stats.states)).toFixed(0)} B`);
console.log(`dropped connections : ${stats.drops}`);
if (!REMOTE) console.log(`server stderr       : ${srvErr.trim() ? srvErr.trim().slice(0, 300) : 'clean'}`);

const dropsAtEnd = stats.drops; let persistOk = true;
if (!REMOTE) {
  const w0 = (await api('GET', '/worlds')).find(w => w.id === worldIds[0]); await api('POST', `/worlds/${worldIds[0]}/save`); const bk = await api('POST', `/worlds/${worldIds[0]}/backup`);
  srv.kill(); await sleep(800);
  // restart from disk and make sure every edit survived (journal replay + snapshot)
  const srv2 = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_PASSWORD: PW, LOG_LEVEL: 'error' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* starting */ } await sleep(250); }
  const w1 = (await api('GET', '/worlds')).find(w => w.id === worldIds[0]); persistOk = w1 && w1.edits >= w0.edits - 60; console.log(`persistence         : ${w0.edits} edits live -> ${w1 ? w1.edits : '?'} after restart (backup ${bk.file ? 'ok' : 'failed'}) ${persistOk ? 'OK' : 'LOSS'}`);
  srv2.kill(); await sleep(300); fs.rmSync(DATA, { recursive: true, force: true });
}
bots.forEach(async p => (await p).stop?.());
if (REMOTE) { await sleep(500); for (const id of created) await api('DELETE', `/worlds/${id}`).catch(() => {}); console.log('cleaned up temporary stress worlds'); }
const ok = avg(samples.map(s => s.tick)) < 25 && dropsAtEnd === 0 && pct(stats.rtts, .95) < 400 && persistOk && stats.joined >= BOTS * .98;
console.log(ok ? '\nSTRESS TEST PASSED' : '\nSTRESS TEST NEEDS ATTENTION'); process.exit(ok ? 0 : 1);
