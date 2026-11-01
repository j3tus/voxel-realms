// Voxel Realms game server: Fastify HTTP + WebSocket game protocol, admin REST API + live stream, static client.
import Fastify from 'fastify';
import fstatic from '@fastify/static';
import websocket from '@fastify/websocket';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import { z } from 'zod';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Parties } from './parties.js';
import compress from '@fastify/compress';
import { ROOT, DATA_DIR, safeId, hashToken, loadConfig, saveConfig, loadWorld, saveMeta, saveEditsSnapshot, dropLegacy, openJournal, ceToCompact, compactToCe, deleteWorld, backupWorld, listBackups, readBackup, checkToken } from './store.js';
import { GameWorld } from './world.js';
import { BotDirector, BOT_MODES } from './bots.js';
import { computeCapacity, readMetrics, roomLoad } from './capacity.js';
import { planAutoRooms, fitCustomGame, MODE_TITLE, ROOM_MODES } from './rooms.js';
import { parseGame, HelloMsg } from './protocol.js';

const PORT = +process.env.PORT || 8080, HOST = process.env.HOST || '0.0.0.0', VERSION = '1.0.0';
const MAX_PER_IP = +process.env.MAX_PER_IP || 4;
const { config, newToken } = loadConfig();
const startedAt = Date.now();

/* ---------------- logging + live event stream ---------------- */
const logs = []; const adminSockets = new Set();
function log(level, msg) { const e = { at: Date.now(), level, msg }; logs.push(e); if (logs.length > 500) logs.shift(); app.log[level === 'chat' ? 'info' : level]?.(msg); pushAdmin({ t: 'log', ...e }); }
function pushAdmin(obj) { const s = JSON.stringify(obj); for (const ws of adminSockets) if (ws.readyState === 1 && ws.authed) ws.send(s); }

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, trustProxy: ['127.0.0.1', '::1'], bodyLimit: 64 * 1024 });

/* Admin on its own loopback port. With ADMIN_PORT set, /admin/ and /api/admin/ answer ONLY on that port (bound to ADMIN_HOST, default 127.0.0.1, reached over the tailnet with `tailscale serve`),
 * and the public game port answers 404 for them, so exposing the game through Funnel no longer exposes the admin. The admin port serves nothing but the admin and /shared (the map worker). */
const ADMIN_PORT = +process.env.ADMIN_PORT || 0, ADMIN_HOST = process.env.ADMIN_HOST || '127.0.0.1';
const isAdminUrl = u => u === '/admin' || u.startsWith('/admin/') || u.startsWith('/api/admin/') || u === '/api/admin';
app.addHook('onRequest', async (req, reply) => {
  if (!ADMIN_PORT) return;
  const onAdminPort = req.socket.localPort === ADMIN_PORT, admin = isAdminUrl(req.url);
  if (admin && !onAdminPort) return reply.code(404).send({ error: 'Not found' });
  if (!admin && onAdminPort && !req.url.startsWith('/shared/')) return reply.code(404).send({ error: 'Not found' });
});// Invalid request bodies (zod) are the caller's fault: answer 400 with the first issue instead of a 500
app.setErrorHandler((err, req, reply) => {
  if (err instanceof z.ZodError) { const i = err.issues[0]; return reply.code(400).send({ error: i ? `${i.path.join('.') || 'body'}: ${i.message}` : 'Invalid request' }); }
  reply.send(err);
});

/* ---------------- worlds ---------------- */
const worlds = new Map();
import { ChunkPool } from './chunkpool.js';
import { wasmActive } from './gen.js';
const chunkWorkers = process.env.VR_CHUNK_WORKERS === undefined ? 1 : +process.env.VR_CHUNK_WORKERS || 0; // terrain generation threads (0 = on the main thread)
const chunkPool = chunkWorkers > 0 ? new ChunkPool(chunkWorkers) : null;
const hooks = {
  chunkPool,
  log, event: e => pushAdmin(e), motd: () => config.motd, muted: p => config.mutes.includes(p.name.toLowerCase()),
  save: w => persist(w),
  createGame: (opts) => createPrivateGame(opts),
  botsCfg: () => ({ enabled: config.bots.enabled, skill: config.bots.skill, density: config.bots.density, capDensity: capacity().botDensity }),
  capacity: () => capacity(),
  rooms: () => roomList(), allWorlds: () => [...worlds.values()],
  findPlayer: name => { const q = String(name || '').toLowerCase(); if (!q) return null; let hit = null; for (const w of worlds.values()) for (const p of w.players.values()) { const n = p.name.toLowerCase().replace(/^\[bot\]\s*/, ''); if (p.name.toLowerCase() === q || n === q) return { w, p }; if (!hit && (n.startsWith(q) || p.name.toLowerCase().startsWith(q))) hit = { w, p }; } return hit; },
  announce: text => { for (const w of worlds.values()) w.system('[Announcement] ' + text); },
  newDirector: w => new BotDirector(w),
  act: (method, url, body) => app.inject({ method, url, headers: { 'x-vr-internal': INTERNAL, 'content-type': 'application/json' }, payload: JSON.stringify(body || {}) }),
  createRoom: o => createRoom(o), closeRoom: id => closeRoom(id),
  worlds: () => [...worlds.values()].map(w => ({ id: w.meta.id, name: w.meta.name, mode: w.meta.mode, players: w.humans(), bots: w.botCount(), idle: w.idle, priv: !!w.meta.private, lobby: w.meta.lobby !== false, max: w.meta.maxPlayers, st: w.mg?.state || '', t: w.mg ? Math.max(0, Math.ceil(w.mg.t)) : 0, room: w.meta.room || null, sk: w.meta.botSkill || '' })),
  parties: new Parties(),
};
const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
/** rolling window for the capacity governor: the lifetime histogram above would remember a startup spike forever */
const capLag = monitorEventLoopDelay({ resolution: 10 }); capLag.enable(); setInterval(() => capLag.reset(), 20000).unref();
/** server capacity, recomputed at most once a second (tick time, event-loop lag, memory, CPU -> slots free) */
let capAt = 0, capV = null;
function capacity() { const n = Date.now(); if (!capV || n - capAt > 1000) { capAt = n; const ws = [...worlds.values()]; capV = computeCapacity(readMetrics({ worlds: ws, lagP99: Math.max(0, capLag.percentile(99) / 1e6 - 10), rates }), ws.map(roomLoad)); } return capV; }
const capacityJson = () => { const { canOpen, ...c } = capacity(); return c; };
/** Fold the journal into the compact snapshot (also done on backup/shutdown) so startup replay stays short. */
function compact(w) { if (!w.journal) return; w.journal.flush(); saveEditsSnapshot(w.meta.id, w.ce); w.journal.truncate(); }
/** Cheap periodic save: only the small meta file + journal flush. Full snapshots happen on compaction/backup. */
function persist(w, backup) {
  saveMeta(w.meta.id, w.snapshotMeta()); w.dirty = false; w.journal?.flush();
  if (w.journal && w.journal.lines > 100000) compact(w);
  if (backup) { compact(w); return backupWorld(w.meta.id, { ...w.snapshotMeta(), ce: ceToCompact(w.ce) }); }
}
function openWorld(meta) {
  if (meta.ephemeral) { const w = new GameWorld(meta, null, hooks); worlds.set(w.meta.id, w); return w; } // private bot games live in memory only
  const saved = loadWorld(meta.id); const w = new GameWorld({ ...meta, ...(saved?.meta || {}) }, saved, hooks); worlds.set(w.meta.id, w);
  w.journal = openJournal(w.meta.id, saved?.journalLines || 0);
  if (saved?.migrated) { saveMeta(w.meta.id, w.snapshotMeta()); saveEditsSnapshot(w.meta.id, w.ce); w.journal.truncate(); dropLegacy(w.meta.id); log('info', `migrated world "${w.meta.id}" to the journal format`); }
  return w;
}
for (const m of config.worlds) if (!m.ephemeral) openWorld(m);
/** Rooms: temporary in-memory game worlds. source = 'player' (/create, private unless public), 'auto' (opened when games fill up) or 'admin' (pinned, survives restarts via config.rooms).
 *  Every room is sized by what the server can still carry (capacity governor). */
function nextRoomNum(mode) { const used = new Set([...worlds.values()].filter(w => w.meta.mode === mode).map(w => w.meta.room?.n || 1)); let n = 2; while (used.has(n)) n++; return n; }
function createRoom({ mode, name, players, bots, skill, source = 'player', owner, public: pub = false, pinned = false, force = false, id: forcedId }) {
  if (!ROOM_MODES.includes(mode)) return { error: 'Unknown mode. Try: ' + ROOM_MODES.join(', ') };
  if (source === 'player') {
    const mine = [...worlds.values()].filter(w => w.meta.ephemeral && w.meta.owner === owner.uid); if (mine.length >= 1) return { error: 'You already have a game running (/join ' + mine[0].meta.id + ')' };
    if ([...worlds.values()].filter(w => w.meta.ephemeral).length >= 16) return { error: 'Too many custom games are running - try again soon.' };
  }
  const fit = fitCustomGame({ players, bots }, capacity(), { force: force || source === 'admin' }); if (fit.error) return fit;
  let id = forcedId; if (!id || worlds.has(id)) do { id = (source === 'auto' ? 'r' : source === 'admin' ? 'a' : 'g') + Math.random().toString(36).slice(2, 6); } while (worlds.has(id));
  const sk = ['easy', 'normal', 'hard'].includes(skill) ? skill : config.bots.skill, n = nextRoomNum(mode);
  const title = name || (source === 'player' ? `${owner.name}'s ${MODE_TITLE[mode]}` : `${MODE_TITLE[mode]} #${n}`);
  const w = openWorld({ id, name: title, seed: Math.floor(Math.random() * 1e9), type: mode === 'royale' ? 'normal' : 'flat', mode, dayLength: 420, economy: false, mobs: ['zombies', 'raid', 'td'].includes(mode), hostile: true,
    maxPlayers: fit.players, private: source === 'player' && !pub, ephemeral: true, owner: owner?.uid, bots: fit.bots, botsFixed: true, botSkill: sk, pinned, room: { n, source, cap: fit.players } });
  log('info', `room ${id} "${title}" (${mode}, ${fit.players} slots, ${fit.bots} bots, ${source}) opened`);
  return { id, name: w.meta.name, bots: fit.bots, players: fit.players, trimmed: fit.trimmed, public: !w.meta.private };
}
function closeRoom(id) { const w = worlds.get(id); if (!w || !w.meta.ephemeral) return false; for (const p of [...w.players.values()]) { w.send(p, { t: 'transfer', world: 'lobby', name: 'Lobby' }); w.leave(p); } worlds.delete(id); log('info', `room ${id} closed`); return true; }
const createPrivateGame = o => createRoom({ ...o, source: 'player' });
const roomList = () => [...worlds.values()].filter(w => ROOM_MODES.includes(w.meta.mode) && !w.meta.private).map(w => ({ id: w.meta.id, name: w.meta.name, mode: w.meta.mode, players: w.humans(), bots: w.botCount(), max: w.meta.maxPlayers, state: w.mg?.state || '', time: w.mg ? Math.max(0, Math.ceil(w.mg.t)) : 0, source: w.meta.room?.source || 'base' }));
setTimeout(() => { for (const r of config.rooms || []) try { createRoom({ ...r, source: 'admin', pinned: true, force: true }); } catch (e) { log('warn', 'admin room ' + r.id + ' failed: ' + e.message); } }, 200); // after startup, once metrics exist
/** empty player rooms close after a minute, automatic rooms are closed by the planner, admin rooms stay */
setInterval(() => { for (const [id, w] of worlds) if (w.meta.ephemeral && !w.meta.pinned && w.meta.room?.source !== 'auto') { if (w.humans()) w.idleSince = 0; else if (!w.idleSince) w.idleSince = Date.now(); else if (Date.now() - w.idleSince > 60000) closeRoom(id); } else if (w.meta.ephemeral) { if (w.humans()) w.idleSince = 0; else if (!w.idleSince) w.idleSince = Date.now(); } }, 5000).unref();
/** automatic rooms: when every room of a game is filling up and the server has headroom, open another; close them again when empty */
setInterval(() => {
  const cap = capacity(), now = Date.now();
  const rooms = [...worlds.values()].filter(w => ROOM_MODES.includes(w.meta.mode) && w.meta.lobby !== false && !w.meta.private).map(w => ({ id: w.meta.id, mode: w.meta.mode, humans: w.humans(), max: w.meta.maxPlayers, source: w.meta.room?.source || 'base', idleMs: w.humans() ? 0 : now - (w.idleSince || now), pinned: !!w.meta.pinned }));
  const plan = planAutoRooms(rooms, cap);
  for (const o of plan.open) createRoom({ ...o, source: 'auto', public: true });
  for (const id of plan.close) closeRoom(id);
}, 2000).unref();
const defaultWorld = () => worlds.get('lobby') || worlds.get('main') || worlds.values().next().value;
const syncConfigWorlds = () => { config.worlds = [...worlds.values()].filter(w => !w.meta.ephemeral).map(w => w.meta); saveConfig(config); };

// fixed-rate simulation loop with drift compensation
let nextTick = performance.now();
setInterval(() => { const now = performance.now(); while (nextTick <= now) { for (const w of worlds.values()) w.tick(); nextTick += 50; } }, 10);
setInterval(() => { for (const w of worlds.values()) if (w.dirty && !w.meta.ephemeral) persist(w); }, 30000);
setInterval(() => { for (const w of worlds.values()) { try { persist(w, true); } catch (e) { log('error', 'backup failed: ' + e.message); } } }, 30 * 60000);
setInterval(() => { pushAdmin({ t: 'stats', ...statusObj() }); lag.reset(); }, 2000);

/* ---------------- audit log + throughput sampling ---------------- */
const auditLog = []; let netInBytes = 0;
function audit(req, action, detail) { const e = { at: Date.now(), ip: req.ip, action, detail: String(detail || '').slice(0, 200) }; auditLog.push(e); if (auditLog.length > 300) auditLog.shift(); pushAdmin({ t: 'audit', ...e }); }
const rates = { inBps: 0, outBps: 0, cpu: 0 }; let lastS = { t: Date.now(), inB: 0, outB: 0, cpu: process.cpuUsage() };
setInterval(() => {
  const now = Date.now(), dt = (now - lastS.t) / 1000, outB = [...worlds.values()].reduce((a, w) => a + w.netOut, 0), cpu = process.cpuUsage(lastS.cpu);
  rates.inBps = Math.round((netInBytes - lastS.inB) / dt); rates.outBps = Math.round((outB - lastS.outB) / dt); rates.cpu = +(((cpu.user + cpu.system) / 1000 / (dt * 1000)) * 100).toFixed(1);
  lastS = { t: now, inB: netInBytes, outB, cpu: process.cpuUsage() };
}, 2000).unref();

/* The Nuxt admin build ships one inline importmap; allow exactly that content by hash (keeps script-src strict, no unsafe-inline). */
const ADMIN_UI = path.join(ROOT, 'server', 'admin-ui');
const adminUiHashes = (() => { try { const html = fs.readFileSync(path.join(ADMIN_UI, 'index.html'), 'utf8'); return [...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`); } catch { return []; } })();

/* ---------------- security plumbing ---------------- */
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: null,   // the game is also served over plain http (Tailscale/LAN); forcing https for assets broke the page there
      defaultSrc: ["'self'"], scriptSrc: process.env.VR_E2E ? ["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'", ...adminUiHashes] : ["'self'", "'wasm-unsafe-eval'", ...adminUiHashes], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://i.ytimg.com', 'https://img.youtube.com'], frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com'], mediaSrc: ["'self'", 'blob:', 'data:', 'https:', 'http:'], connectSrc: ["'self'", 'http:', 'https:', 'ws:', 'wss:'], workerSrc: ["'self'", 'blob:'], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' },
});
await app.register(compress, { global: true, threshold: 1024, encodings: ['br', 'gzip'] });
await app.register(rateLimit, { global: true, max: 240, timeWindow: '1 minute', allowList: [] });
await app.register(websocket, { options: { maxPayload: 64 * 1024, perMessageDeflate: { threshold: 1024 } } });

const authFails = new Map();
setInterval(() => { const now = Date.now(); for (const [ip, f] of authFails) if (now > f.until && f.n === 0) authFails.delete(ip); }, 300000).unref();
const WEAK_ADMIN = new Set(['password', 'password1234', 'password123', 'admin', 'admin1234', 'changeme', '12345678', 'testtoken123']);
const adminPw = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || '';
const adminWeak = !!adminPw && (adminPw.length < 12 || WEAK_ADMIN.has(adminPw.toLowerCase()));
const adminLocked = adminWeak && !!process.env.VR_ENFORCE_STRONG_ADMIN && !process.env.VR_E2E; // opt-in: set VR_ENFORCE_STRONG_ADMIN=1 to disable admin while the password is weak
if (adminLocked) console.log('\n  !!! ADMIN DISABLED: ADMIN_PASSWORD is weak or a known default (need 12+ chars). Run `./vr password` for a strong one.\n');
else if (adminWeak) console.log('\n  !!! WARNING: ADMIN_PASSWORD is weak or a known default. Change it; set VR_ENFORCE_STRONG_ADMIN=1 to refuse weak passwords.\n');
const globalFails = []; // timestamps of failed admin logins from ANY ip: stops distributed or spoofed-source guessing
function adminThrottled(ip) { const f = authFails.get(ip); const now = Date.now(); while (globalFails.length && now - globalFails[0] > 600000) globalFails.shift(); return (f && now < f.until) || globalFails.length >= 25; }
function adminFailed(ip) { const f = authFails.get(ip) || { n: 0, until: 0 }; f.n++; if (f.n >= 5) { f.strikes = (f.strikes || 0) + 1; f.until = Date.now() + Math.min(3600000, 60000 * 2 ** (f.strikes - 1)); f.n = 0; } authFails.set(ip, f); globalFails.push(Date.now()); log('warn', `admin auth failed from ${ip}`); }
const INTERNAL = crypto.randomBytes(16).toString('hex'); // lets in-game operator commands reuse the audited REST handlers; never leaves this process
function adminAuth(req, reply) {
  if (req.headers['x-vr-internal'] === INTERNAL) return true;
  if (adminLocked) { reply.code(503).send({ error: 'Admin disabled until a strong ADMIN_PASSWORD is set' }); return false; }
  if (adminThrottled(req.ip)) { reply.code(429).send({ error: 'Too many failed attempts' }); return false; }
  const h = req.headers.authorization || ''; const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!checkToken(token, config.admin)) { adminFailed(req.ip); reply.code(401).send({ error: 'Unauthorized' }); return false; }
  authFails.delete(req.ip); return true;
}
const admin = { preHandler: (req, reply, done) => { if (!adminAuth(req, reply)) return; if (req.method !== 'GET') { const b = req.body && typeof req.body === 'object' ? JSON.stringify(req.body, (k, v) => /pass|token/i.test(k) ? '***' : v) : ''; audit(req, req.method + ' ' + req.url.split('?')[0], b); } done(); }, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } };

/* ---------------- public API ---------------- */
const lanAddrs = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address + ':' + PORT);
const publicInfo = () => ({ name: config.name, motd: config.motd, version: VERSION, locked: !!config.password, maintenance: config.maintenance.on ? config.maintenance.msg : null, capacity: (() => { const c = capacity(); return { level: c.level, free: c.free, maxRoom: c.maxRoom }; })(), uptime: Math.floor((Date.now() - startedAt) / 1000), worlds: [...worlds.values()].map(w => w.info()), lan: lanAddrs() });
const cors = (reply) => reply.header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'no-store');
app.get('/api/info', (req, reply) => { cors(reply); return publicInfo(); });
app.get('/info', (req, reply) => { cors(reply); return publicInfo(); }); // legacy
app.get('/api/health', () => ({ ok: true }));

/* ---------------- game websocket ---------------- */
const perIp = new Map();
app.get('/ws/:world', { websocket: true, config: { rateLimit: { max: +process.env.WS_RATE || 30, timeWindow: '1 minute' } } }, (ws, req) => {
  const world = worlds.get(safeId(req.params.world)) || (req.params.world === 'main' ? defaultWorld() : null), ip = req.ip;
  if (!world) { ws.close(4004, 'no such world'); return; }
  if ((perIp.get(ip) || 0) >= MAX_PER_IP) { ws.close(4029, 'too many connections'); return; }
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  let player = null, bad = 0; const helloTimer = setTimeout(() => ws.close(4001, 'hello timeout'), 8000);
  ws.on('message', raw => {
    netInBytes += raw.length;
    if (!player) {
      let h; try { h = HelloMsg.parse(JSON.parse(raw)); } catch { if (++bad > 2) ws.close(4002, 'bad hello'); return; }
      const uid = (h.uid || '').replace(/[^\w-]/g, '').slice(0, 40);
      if (config.password && !(h.password && crypto.timingSafeEqual(crypto.createHash('sha256').update(h.password).digest(), crypto.createHash('sha256').update(config.password).digest()))) { ws.send(JSON.stringify({ t: 'kick', reason: 'password required' })); ws.close(4003, 'password'); return; }
      const nm = (h.name || '').toLowerCase();
      if (config.bans.ips.includes(ip) || (uid && config.bans.uids.includes(uid)) || config.bans.names.includes(nm)) { ws.send(JSON.stringify({ t: 'kick', reason: 'You are banned from this server' })); ws.close(4003, 'banned'); return; }
      const isOp = !!uid && config.ops.includes(uid);
      if (config.maintenance.on && !isOp) { ws.send(JSON.stringify({ t: 'kick', reason: config.maintenance.msg })); ws.close(4003, 'maintenance'); return; }
      if (config.allowlist.on && !isOp && !config.allowlist.names.includes(nm)) { ws.send(JSON.stringify({ t: 'kick', reason: 'You are not on the allowlist' })); ws.close(4003, 'allowlist'); return; }
      if (world.players.size >= world.meta.maxPlayers) { ws.send(JSON.stringify({ t: 'kick', reason: 'World is full' })); ws.close(4005, 'full'); return; }
      clearTimeout(helloTimer); player = world.join(ws, { ...h, uid }, ip); player.op = config.ops.includes(uid) && !!uid; return;
    }
    const m = parseGame(raw); if (!m) { if (++bad > 20) ws.close(4002, 'protocol violations'); return; }
    try { world.handle(player, m); } catch (e) { log('error', 'handler: ' + e.message); }
  });
  ws.on('close', () => { clearTimeout(helloTimer); perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1)); if (player) world.leave(player); });
  ws.on('error', () => ws.terminate());
  ws.isAlive = true; ws.on('pong', d => { ws.isAlive = true; const t = +d.toString(); if (t && player) player.rtt = Date.now() - t; });
});
setInterval(() => { for (const w of worlds.values()) for (const p of w.players.values()) { if (p.bot) continue; if (!p.ws.isAlive) { p.ws.missed = (p.ws.missed || 0) + 1; if (p.ws.missed >= 3) { p.ws.terminate(); continue; } } else p.ws.missed = 0; /* tolerate ~30 s of silence: phones on flaky networks stall longer than one 10 s ping */ p.ws.isAlive = false; try { p.ws.ping(String(Date.now())); } catch { /* closed */ } } }, 10000);

/* ---------------- admin API ---------------- */
function statusObj() {
  const mem = process.memoryUsage(), ws = [...worlds.values()].map(w => w.stats()), tick = ws.reduce((a, w) => Math.max(a, w.tickMs), 0);
  return { loopLagMs: +Math.max(0, lag.mean / 1e6 - 10).toFixed(2), loopLagP99: +Math.max(0, lag.percentile(99) / 1e6 - 10).toFixed(1), maintenance: !!config.maintenance.on, capacity: capacityJson(), uptime: Math.floor((Date.now() - startedAt) / 1000), rss: mem.rss, heap: mem.heapUsed, tickMs: tick, tps: +Math.min(20, 1000 / Math.max(50, tick * 1)).toFixed(1), worlds: ws, players: ws.reduce((a, w) => a + w.humans, 0), bots: ws.reduce((a, w) => a + w.liveBots, 0), version: VERSION, chunkPool: chunkPool?.stats() || null, wasm: wasmActive, node: process.version, cpu: rates.cpu, netInBps: rates.inBps, netOutBps: rates.outBps, load: os.loadavg()[0], cores: os.cpus().length, freeMem: os.freemem(), totalMem: os.totalmem(), platform: process.platform };
}
const allPlayers = () => [...worlds.values()].flatMap(w => [...w.players.values()].map(p => ({ id: p.id, world: w.meta.id, mode: w.meta.mode, name: p.name, uid: p.uid, ip: p.ip, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), op: p.op, muted: config.mutes.includes(p.name.toLowerCase()), rtt: p.rtt || 0, coins: w.wallet(p).coins, earned: w.wallet(p).earned, spent: w.wallet(p).spent, inv: w.survival() ? w.inv(p) : null, joined: p.joined, skin: p.skin })));
const findPlayer = id => { for (const w of worlds.values()) { const p = w.players.get(+id); if (p) return [w, p]; } return [null, null]; };

app.get('/api/admin/status', admin, async () => statusObj());
app.get('/api/admin/players', admin, async () => allPlayers());
app.get('/api/admin/logs', admin, async (req) => logs.slice(-Math.min(500, +req.query.n || 200)));
app.get('/api/admin/config', admin, async () => ({ name: config.name, motd: config.motd, maxPlayers: config.maxPlayers, locked: !!config.password, bans: config.bans, ops: config.ops }));
app.patch('/api/admin/config', admin, async (req) => {
  const b = z.object({ name: z.string().min(1).max(40).optional(), motd: z.string().max(140).optional(), password: z.string().max(60).nullable().optional(), adminPassword: z.string().min(8).max(100).optional() }).parse(req.body || {});
  if (b.adminPassword) { if (process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN) throw new Error('The admin password is set by the ADMIN_PASSWORD environment variable; change it there (`./vr password`).'); config.admin = hashToken(b.adminPassword); log('warn', 'admin password changed'); }
  if (b.name !== undefined) config.name = b.name; if (b.motd !== undefined) config.motd = b.motd; if (b.password !== undefined) config.password = b.password || null;
  saveConfig(config); log('info', 'config updated'); return { ok: true };
});
app.post('/api/admin/players/:id/:action', admin, async (req, reply) => {
  const [w, p] = findPlayer(req.params.id); if (!p) return reply.code(404).send({ error: 'No such player' });
  const body = z.object({ reason: z.string().max(100).optional(), text: z.string().max(200).optional(), value: z.boolean().optional(), x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), delta: z.number().int().optional() }).parse(req.body || {});
  switch (req.params.action) {
    case 'kick': w.send(p, { t: 'kick', reason: body.reason || 'Kicked by an administrator' }); p.ws.close(4003, 'kicked'); log('info', `kicked ${p.name}`); break;
    case 'ban': { const nm = p.name.toLowerCase(); if (!config.bans.ips.includes(p.ip)) config.bans.ips.push(p.ip); if (p.uid && !config.bans.uids.includes(p.uid)) config.bans.uids.push(p.uid); if (!config.bans.names.includes(nm)) config.bans.names.push(nm); saveConfig(config); w.send(p, { t: 'kick', reason: body.reason || 'Banned' }); p.ws.close(4003, 'banned'); log('warn', `banned ${p.name}`); break; }
    case 'op': { p.op = body.value ?? !p.op; if (p.uid) { config.ops = config.ops.filter(u => u !== p.uid); if (p.op) config.ops.push(p.uid); saveConfig(config); } w.send(p, { t: 'chat', sys: true, text: p.op ? 'You are now an operator.' : 'You are no longer an operator.' }); break; }
    case 'msg': w.send(p, { t: 'chat', sys: true, text: `[Admin] ${body.text || ''}` }); break;
    case 'tp': if ([body.x, body.y, body.z].every(Number.isFinite)) { p.x = body.x; p.y = body.y; p.z = body.z; w.send(p, { t: 'tp', x: body.x, y: body.y, z: body.z }); } break;
    case 'coins': w.addCoins(p, body.delta || 0); break;
    case 'mute': { const nm = p.name.toLowerCase(), on = body.value ?? !config.mutes.includes(nm); config.mutes = config.mutes.filter(x => x !== nm); if (on) config.mutes.push(nm); saveConfig(config); w.send(p, { t: 'chat', sys: true, text: on ? 'You have been muted.' : 'You have been unmuted.' }); break; }
    default: return reply.code(400).send({ error: 'Unknown action' });
  }
  return { ok: true };
});
app.get('/api/admin/bans', admin, async () => config.bans);
app.post('/api/admin/bans', admin, async (req) => {
  const { kind, value } = z.object({ kind: z.enum(['names', 'ips', 'uids']), value: z.string().min(1).max(80) }).parse(req.body || {});
  const v = kind === 'names' ? value.toLowerCase() : value; if (!config.bans[kind].includes(v)) config.bans[kind].push(v); saveConfig(config);
  if (kind === 'names') for (const w of worlds.values()) for (const p of [...w.players.values()]) if (p.name.toLowerCase() === v) { w.send(p, { t: 'kick', reason: 'Banned' }); p.ws.close(4003, 'banned'); }
  log('warn', `ban added (${kind}): ${v}`); return { ok: true };
});
app.delete('/api/admin/bans', admin, async (req) => { const { kind, value } = z.object({ kind: z.enum(['names', 'ips', 'uids']), value: z.string().max(80) }).parse(req.body || {}); config.bans[kind] = config.bans[kind].filter(v => v !== value); saveConfig(config); return { ok: true }; });

const WorldBody = z.object({
  name: z.string().min(1).max(32), seed: z.union([z.number().int(), z.string().max(40)]).optional(), type: z.enum(['normal', 'flat', 'mountains', 'islands']).default('normal'),
  mode: z.enum(['creative', 'survival', 'pvp', 'tdm', 'gungame', 'zombies', 'royale', 'ctf', 'hide', 'snd', 'bedwars', 'raid', 'td', 'parkour', 'spleef', 'lobby']).default('creative'), dayLength: z.number().int().min(60).max(3600).default(420), economy: z.boolean().default(false), mobs: z.boolean().default(true), hostile: z.boolean().default(true), maxPlayers: z.number().int().min(1).max(64).default(16),
});
/** Per-world switch: does this world get a portal in the lobby? (Servers choose which games they offer.) */
app.patch('/api/admin/worlds/:id/portal', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' });
  const { show } = z.object({ show: z.boolean() }).parse(req.body || {}); w.meta.lobby = show; persist(w); log('info', `portal for "${w.meta.id}" ${show ? 'enabled' : 'disabled'}`); return { ok: true, lobby: show };
});
/** One-click game hub: creates the lobby (if missing) plus a world for each chosen game mode that does not exist yet. */
const HUB_GAMES = { pvp: ['Gun Arena', 'flat'], tdm: ['Team Deathmatch', 'flat'], gungame: ['Gun Game', 'flat'], ctf: ['Capture the Flag', 'flat'], snd: ['Search and Destroy', 'flat'], bedwars: ['Bed Wars', 'flat'], zombies: ['Zombies', 'flat'], raid: ['Boss Raid', 'flat'], td: ['Tower Defence', 'flat'], royale: ['Battle Royale', 'normal'], hide: ['Hide and Seek', 'flat'], parkour: ['Parkour Race', 'flat'], spleef: ['Spleef', 'flat'] };
app.post('/api/admin/hub', admin, async (req) => {
  const { modes } = z.object({ modes: z.array(z.enum(Object.keys(HUB_GAMES))).max(20).default(Object.keys(HUB_GAMES)) }).parse(req.body || {});
  const { seedFromText } = await import('../shared/worldgen.js'); const made = [];
  const make = (name, mode, type) => { let id = safeId(name) || mode; let n = 2; while (worlds.has(id)) id = safeId(name).slice(0, 20) + '-' + n++; const w = openWorld({ id, name, seed: seedFromText('hub-' + mode), type, mode, dayLength: 420, economy: false, mobs: ['zombies', 'raid', 'td'].includes(mode), hostile: true, maxPlayers: mode === 'lobby' ? 40 : 16 }); persist(w); made.push(id); };
  if (![...worlds.values()].some(w => w.meta.mode === 'lobby')) make('Lobby', 'lobby', 'flat');
  for (const m of modes) if (![...worlds.values()].some(w => w.meta.mode === m && !w.meta.ephemeral)) make(HUB_GAMES[m][0], m, HUB_GAMES[m][1]);
  syncConfigWorlds(); log('info', `game hub set up: ${made.join(', ') || 'nothing new'}`); return { ok: true, created: made };
});
/* ---- capacity, bots and rooms (admin) ---- */
app.get('/api/admin/capacity', admin, async () => capacityJson());
app.get('/api/admin/bots', admin, async () => ({ ...config.bots, capDensity: capacity().botDensity, total: [...worlds.values()].reduce((a, w) => a + w.botCount(), 0) }));
app.patch('/api/admin/bots', admin, async (req) => {
  const b = z.object({ enabled: z.boolean().optional(), skill: z.enum(['easy', 'normal', 'hard']).optional(), density: z.number().min(0).max(3).optional() }).parse(req.body || {});
  Object.assign(config.bots, b); saveConfig(config); log('info', 'bot settings updated: ' + JSON.stringify(b)); if (b.enabled === false) for (const w of worlds.values()) w.bots?.clear(); return config.bots;
});
const botWorld = (req, reply) => { const w = worlds.get(safeId(req.params.id)); if (!w) { reply.code(404).send({ error: 'No such world' }); return null; } if (!BOT_MODES.includes(w.meta.mode)) { reply.code(400).send({ error: 'Bots do not play this mode' }); return null; } return w; };
app.patch('/api/admin/worlds/:id/bots', admin, async (req, reply) => {
  const w = botWorld(req, reply); if (!w) return;
  const b = z.object({ bots: z.number().int().min(0).max(32).nullable().optional(), skill: z.enum(['easy', 'normal', 'hard']).nullable().optional(), fixed: z.boolean().optional(), paused: z.boolean().optional() }).parse(req.body || {}), m = w.meta;
  if (b.bots !== undefined) { if (b.bots === null) delete m.bots; else m.bots = b.bots; }
  if (b.skill !== undefined) { if (b.skill === null) delete m.botSkill; else m.botSkill = b.skill; }
  if (b.fixed !== undefined) m.botsFixed = b.fixed; if (b.paused !== undefined) m.botsPaused = b.paused;
  if (m.botsPaused && w.bots) while (w.bots.remove(false)); if (!w.bots && m.bots !== 0) w.bots = new BotDirector(w);
  if (!m.ephemeral) persist(w); else if (m.room?.source === 'admin') { const r = config.rooms.find(x => x.id === m.id); if (r) { r.bots = m.bots; r.skill = m.botSkill; saveConfig(config); } }
  log('info', `bots in ${m.id}: target=${m.bots ?? 'auto'} skill=${m.botSkill ?? 'default'} fixed=${!!m.botsFixed} paused=${!!m.botsPaused}`); return { ok: true, bots: m.bots ?? null, skill: m.botSkill ?? null, fixed: !!m.botsFixed, paused: !!m.botsPaused };
});
app.post('/api/admin/worlds/:id/bots/summon', admin, async (req, reply) => {
  const w = botWorld(req, reply); if (!w) return; const b = z.object({ n: z.number().int().min(1).max(16).default(1), skill: z.enum(['easy', 'normal', 'hard']).optional(), name: z.string().max(14).optional() }).parse(req.body || {});
  w.bots ||= new BotDirector(w); w.summonUntil = Date.now() + 600000;
  const got = w.bots.summon(b.n, { skill: b.skill, name: b.name, at: w.spawn }); w.mg?.broadcastBoard?.(); log('info', `summoned ${got.length} bot(s) into ${w.meta.id}`); return { ok: true, added: got.length, bots: w.botCount() };
});
app.post('/api/admin/worlds/:id/bots/remove', admin, async (req, reply) => { const w = botWorld(req, reply); if (!w) return; const { n } = z.object({ n: z.number().int().min(1).max(32).default(1) }).parse(req.body || {}); return { ok: true, removed: w.bots ? w.bots.removeN(n) : 0, bots: w.botCount() }; });
app.post('/api/admin/worlds/:id/bots/clear', admin, async (req, reply) => { const w = botWorld(req, reply); if (!w) return; const n = w.botCount(); w.bots?.clear(); w.summonUntil = 0; return { ok: true, removed: n }; });
app.post('/api/admin/rooms', admin, async (req, reply) => {
  const b = z.object({ mode: z.string().max(16), name: z.string().min(1).max(32).optional(), players: z.number().int().min(2).max(32).default(8), bots: z.number().int().min(0).max(31).default(0), skill: z.enum(['easy', 'normal', 'hard']).optional() }).parse(req.body || {});
  const r = createRoom({ ...b, source: 'admin', pinned: true }); if (r.error) return reply.code(400).send({ error: r.error });
  config.rooms.push({ id: r.id, mode: b.mode, name: r.name, players: r.players, bots: r.bots, skill: b.skill }); saveConfig(config); audit(req, 'room.create', `${r.name} (${b.mode})`); return r;
});
app.delete('/api/admin/rooms/:id', admin, async (req, reply) => { const id = safeId(req.params.id); if (!closeRoom(id)) return reply.code(404).send({ error: 'No such room (base worlds are deleted from Games)' }); config.rooms = config.rooms.filter(r => r.id !== id); saveConfig(config); audit(req, 'room.close', id); return { ok: true }; });

/* top-down view of the chunks that are loaded right now (real blocks: builds, arenas, edits). Columns: id of the top block, its height, and the bed height under water. */
app.get('/api/admin/worlds/:id/map', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' });
  const q = z.object({ x0: z.coerce.number(), z0: z.coerce.number(), x1: z.coerce.number(), z1: z.coerce.number() }).parse(req.query);
  const cx0 = Math.floor(q.x0 / 16), cx1 = Math.floor(q.x1 / 16), cz0 = Math.floor(q.z0 / 16), cz1 = Math.floor(q.z1 / 16), WATER = 7, out = [];
  for (const [k, c] of w.chunks) {
    const i = k.indexOf(','), cx = +k.slice(0, i), cz = +k.slice(i + 1); if (cx < cx0 || cx > cx1 || cz < cz0 || cz > cz1) continue;
    const id = new Uint8Array(256), h = new Uint8Array(256), b = new Uint8Array(256), d = c.data;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      let y = Math.min(79, c.maxY); while (y > 0 && !d[lx + 16 * (lz + 16 * y)]) y--;
      const o = lx + 16 * lz, top = d[lx + 16 * (lz + 16 * y)]; id[o] = top; h[o] = y; let yb = y; if (top === WATER) while (yb > 0 && d[lx + 16 * (lz + 16 * yb)] === WATER) yb--; b[o] = yb;
    }
    out.push([cx, cz, Buffer.from(id).toString('base64'), Buffer.from(h).toString('base64'), Buffer.from(b).toString('base64')]);
    if (out.length >= 1500) break;
  }
  return { chunks: out, spawn: w.spawn, seed: w.meta.seed, type: w.meta.type };
});
app.get('/api/admin/worlds', admin, async () => [...worlds.values()].map(w => ({ ...w.meta, ...w.stats() })));
app.post('/api/admin/worlds', admin, async (req, reply) => {
  const b = WorldBody.parse(req.body || {}); let id = safeId(b.name) || 'world'; let n = 2; while (worlds.has(id)) id = safeId(b.name).slice(0, 20) + '-' + n++;
  const { seedFromText } = await import('../shared/worldgen.js'); const w = openWorld({ id, name: b.name, seed: seedFromText(b.seed), type: b.type, mode: b.mode, dayLength: b.dayLength, economy: b.economy && b.mode === 'survival', mobs: b.mobs, hostile: b.hostile, maxPlayers: b.maxPlayers });
  persist(w); syncConfigWorlds(); log('info', `world "${id}" created`); return reply.code(201).send({ id });
});
app.patch('/api/admin/worlds/:id', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' });
  const b = WorldBody.partial().omit({ seed: true, type: true, mode: true }).parse(req.body || {}); Object.assign(w.meta, b);
  w.sim.enabled = w.meta.mobs; w.sim.hostile = w.meta.hostile; persist(w); syncConfigWorlds(); w.broadcast({ t: 'time', tt: w.time, len: w.meta.dayLength }); return { ok: true };
});
app.delete('/api/admin/worlds/:id', admin, async (req, reply) => {
  const id = safeId(req.params.id), w = worlds.get(id); if (!w) return reply.code(404).send({ error: 'No such world' });
  if (worlds.size <= 1) return reply.code(400).send({ error: 'Cannot delete the last world' });
  for (const p of [...w.players.values()]) { w.send(p, { t: 'kick', reason: 'World deleted' }); p.ws.close(4003, 'deleted'); }
  persist(w, true); w.journal?.close(); worlds.delete(id); deleteWorld(id); syncConfigWorlds(); log('warn', `world "${id}" deleted (backup kept)`); return { ok: true };
});
app.post('/api/admin/worlds/:id/command', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' });
  const { cmd } = z.object({ cmd: z.string().min(1).max(200) }).parse(req.body || {}); log('info', `console[${w.meta.id}]: ${cmd}`);
  return { output: w.command(null, cmd.startsWith('/') ? cmd : '/' + cmd) || 'ok' };
});
app.post('/api/admin/worlds/:id/save', admin, async (req, reply) => { const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' }); persist(w); return { ok: true }; });
app.post('/api/admin/worlds/:id/backup', admin, async (req, reply) => { const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' }); return { file: persist(w, true) }; });
app.get('/api/admin/worlds/:id/backups', admin, async (req) => listBackups(req.params.id));
app.post('/api/admin/worlds/:id/restore', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' });
  const { file } = z.object({ file: z.string().max(120) }).parse(req.body || {}); const data = readBackup(file); if (!data || data.meta?.id !== w.meta.id) return reply.code(400).send({ error: 'Invalid backup' });
  for (const p of [...w.players.values()]) { w.send(p, { t: 'kick', reason: 'World restored from backup' }); p.ws.close(4003, 'restore'); }
  persist(w, true); w.journal?.close(); saveMeta(w.meta.id, { meta: data.meta, wallets: data.wallets, eco: data.eco, time: data.time, weather: data.weather }); saveEditsSnapshot(w.meta.id, compactToCe(data.ce)); worlds.delete(w.meta.id); try { fs.unlinkSync(path.join(DATA_DIR, 'worlds', safeId(w.meta.id) + '.log')); } catch { /* none */ } openWorld(data.meta); log('warn', `world "${w.meta.id}" restored from ${file}`); return { ok: true };
});
app.get('/api/admin/worlds/:id/economy', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' });
  const board = Object.entries(w.wallets).map(([uid, v]) => ({ name: v.name, coins: v.coins, earned: v.earned, spent: v.spent })).sort((a, b) => b.coins - a.coins).slice(0, 25);
  return { prices: w.eco.mult, history: w.priceHist, bounties: w.eco.bounties, leaderboard: board, enabled: !!w.meta.economy };
});


/* ---------------- admin: extra endpoints (system, chat, audit, security, economy tools, backups, announcements) ---------------- */
app.get('/api/admin/system', admin, async () => ({ ...statusObj(), pid: process.pid, arch: process.arch, dataDir: DATA_DIR, cpuModel: os.cpus()[0]?.model, host: os.hostname(), lan: lanAddrs() }));
app.get('/api/admin/audit', admin, async () => auditLog.slice(-200).reverse());
app.get('/api/admin/chat', admin, async (req) => { const n = Math.min(300, +req.query.n || 100), want = req.query.world; return [...worlds.values()].filter(w => !want || w.meta.id === want).flatMap(w => w.chatLog.map(c => ({ ...c, world: w.meta.id }))).sort((a, b) => a.at - b.at).slice(-n); });
app.post('/api/admin/announce', admin, async (req) => { const { text } = z.object({ text: z.string().min(1).max(200) }).parse(req.body || {}); for (const w of worlds.values()) w.system('[Announcement] ' + text); return { ok: true }; });
app.get('/api/admin/security', admin, async () => ({ maintenance: config.maintenance, allowlist: config.allowlist, bans: config.bans, ops: config.ops, mutes: config.mutes }));
app.patch('/api/admin/security', admin, async (req) => {
  const b = z.object({ maintenance: z.object({ on: z.boolean(), msg: z.string().max(140).optional() }).optional(), allowlist: z.object({ on: z.boolean().optional(), add: z.string().max(20).optional(), remove: z.string().max(20).optional() }).optional(), unmute: z.string().max(20).optional() }).parse(req.body || {});
  if (b.maintenance) { config.maintenance.on = b.maintenance.on; if (b.maintenance.msg) config.maintenance.msg = b.maintenance.msg; if (config.maintenance.on) for (const w of worlds.values()) for (const p of [...w.players.values()]) if (!p.op) { w.send(p, { t: 'kick', reason: config.maintenance.msg }); p.ws.close(4003, 'maintenance'); } }
  if (b.allowlist) { const a = config.allowlist; if (b.allowlist.on !== undefined) a.on = b.allowlist.on; if (b.allowlist.add) { const n = b.allowlist.add.toLowerCase(); if (!a.names.includes(n)) a.names.push(n); } if (b.allowlist.remove) a.names = a.names.filter(n => n !== b.allowlist.remove.toLowerCase()); }
  if (b.unmute) config.mutes = config.mutes.filter(n => n !== b.unmute.toLowerCase());
  saveConfig(config); return { ok: true };
});
app.post('/api/admin/worlds/:id/wallet', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' });
  const b = z.object({ name: z.string().max(20), delta: z.number().int().optional(), set: z.number().int().min(0).optional() }).parse(req.body || {}); const r = w.adjustWallet(b.name, b); return r ? { ok: true, coins: r.coins } : reply.code(404).send({ error: 'No wallet for that player' });
});
app.post('/api/admin/worlds/:id/bounties', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' });
  const b = z.object({ id: z.number().int().min(1).max(40), qty: z.number().int().min(1).max(64), reward: z.number().int().min(1).max(100000) }).parse(req.body || {});
  const bounty = { ...b, taken: false, uid: Math.random().toString(36).slice(2, 8) }; w.eco.bounties.push(bounty); w.syncBounties(); return bounty;
});
app.delete('/api/admin/worlds/:id/bounties/:uid', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' });
  const n = w.eco.bounties.length; w.eco.bounties = w.eco.bounties.filter(x => x.uid !== req.params.uid); if (w.eco.bounties.length === n) return reply.code(404).send({ error: 'No such bounty' });
  w.syncBounties(); return { ok: true };
});
app.post('/api/admin/worlds/:id/economy/reroll', admin, async (req, reply) => { const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' }); w.rerollBounties(); return { ok: true }; });
app.patch('/api/admin/worlds/:id/economy', admin, async (req, reply) => {
  const w = worlds.get(safeId(req.params.id)); if (!w) return reply.code(404).send({ error: 'No such world' }); const b = z.object({ item: z.number().int(), mult: z.number().min(.35).max(2.5) }).parse(req.body || {}); return w.setMult(b.item, b.mult) ? { ok: true } : reply.code(400).send({ error: 'Unknown item' });
});
app.get('/api/admin/backups', admin, async () => [...worlds.keys()].flatMap(id => listBackups(id).map(b => ({ ...b, world: id }))).sort((a, b) => b.at - a.at));
app.get('/api/admin/backups/:file', admin, async (req, reply) => { const data = readBackup(req.params.file); if (!data) return reply.code(404).send({ error: 'No such backup' }); reply.header('Content-Disposition', `attachment; filename="${path.basename(req.params.file)}"`); return data; });
app.delete('/api/admin/backups/:file', admin, async (req, reply) => { const f = path.basename(req.params.file); if (!/^[a-z0-9_-]+-[\w-]+\.json$/.test(f)) return reply.code(400).send({ error: 'Bad name' }); try { fs.unlinkSync(path.join(DATA_DIR, 'backups', f)); } catch { return reply.code(404).send({ error: 'No such backup' }); } return { ok: true }; });
setInterval(() => { if (![...adminSockets].some(s => s.authed && s.readyState === 1)) return; const out = {}; for (const [id, w] of worlds) out[id] = w.liveSnapshot(); pushAdmin({ t: 'live', worlds: out }); }, 1000).unref();

// live admin stream: authenticate with the first message (never put tokens in URLs)
app.get('/api/admin/stream', { websocket: true, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, (ws, req) => {
  ws.authed = false; adminSockets.add(ws); const to = setTimeout(() => ws.close(4001, 'auth timeout'), 5000);
  ws.on('message', raw => {
    if (ws.authed) return; let m; try { m = JSON.parse(raw); } catch { return ws.close(); }
    if (m.t === 'auth' && !adminLocked && !adminThrottled(req.ip) && checkToken(m.token, config.admin)) { ws.authed = true; clearTimeout(to); ws.send(JSON.stringify({ t: 'ready', logs: logs.slice(-100), status: statusObj() })); } else { if (m.t === 'auth' && !adminLocked) adminFailed(req.ip); ws.close(4003, 'unauthorized'); }
  });
  ws.on('close', () => { clearTimeout(to); adminSockets.delete(ws); });
});

/* ---------------- static: game client + admin panel ---------------- */
const dist = path.join(ROOT, 'dist');
app.addHook('onSend', (req, reply, payload, done) => { if (req.url.startsWith('/assets/')) reply.header('Cache-Control', 'public, max-age=31536000, immutable'); done(null, payload); });
if (fs.existsSync(dist)) await app.register(fstatic, { root: dist, prefix: '/', cacheControl: false });
else app.get('/', async (req, reply) => reply.type('text/html').send('<h1>Voxel Realms server</h1><p>Client not built. Run <code>npm run build</code>.</p>'));
if (fs.existsSync(path.join(ADMIN_UI, 'index.html'))) await app.register(fstatic, { root: ADMIN_UI, prefix: '/admin/', decorateReply: false, cacheControl: true, maxAge: '1h', immutable: false });
else app.get('/admin/*', async (req, reply) => reply.type('text/html').send('<h1>Admin UI not built</h1><p>Run <code>cd admin-ui &amp;&amp; npm install &amp;&amp; npm run build &amp;&amp; npm run deploy</code>, then restart the server.</p>'));
if (fs.existsSync(path.join(ROOT, 'site'))) await app.register(fstatic, { root: path.join(ROOT, 'site'), prefix: '/site/', decorateReply: false, cacheControl: true, maxAge: '1h' }); // marketing website
await app.register(fstatic, { root: path.join(ROOT, 'shared'), prefix: '/shared/', decorateReply: false });
app.get('/admin', async (req, reply) => reply.redirect('/admin/'));

/* ---------------- lifecycle ---------------- */
let closing = false;
async function shutdown(sig) {
  if (closing) return; closing = true; log('info', `${sig} received - saving worlds`);
  for (const w of worlds.values()) { for (const p of w.players.values()) { w.send(p, { t: 'kick', reason: 'Server restarting' }); } try { persist(w); compact(w); w.journal?.close(); } catch (e) { console.error(e); } }
  setTimeout(() => process.exit(0), 8000).unref(); // never hang on a stuck connection: the worlds are already saved
  try { adminSrv?.closeAllConnections?.(); adminSrv?.close(); } catch { /* already closed */ }
  await app.close(); process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT')); process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', e => log('error', 'unhandledRejection: ' + (e?.stack || e)));

await app.listen({ port: PORT, host: HOST });
let adminSrv = null;
if (ADMIN_PORT) {
  adminSrv = http.createServer((req, res) => app.routing(req, res));
  adminSrv.on('upgrade', (req, socket, head) => app.server.emit('upgrade', req, socket, head)); // the admin live stream is a WebSocket route
  await new Promise((resolve, reject) => { adminSrv.once('error', reject); adminSrv.listen(ADMIN_PORT, ADMIN_HOST, resolve); });
}
console.log(`\n  Voxel Realms server v${VERSION}\n  Game:  http://localhost:${PORT}\n  Admin: ${ADMIN_PORT ? `http://${ADMIN_HOST}:${ADMIN_PORT}/admin/ (own port; not on the game port)` : `http://localhost:${PORT}/admin/`}\n  Data:  ${DATA_DIR}`);
if (newToken) console.log(`\n  *** ADMIN TOKEN (shown once - store it safely): ${newToken}\n`);
else if (process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN) console.log('  Admin password taken from the environment.');
