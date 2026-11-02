// Headless bot-vs-bot benchmark: runs Gun Arena rounds with only bots and reports combat stats.
// Usage: node test/botsim.mjs [mode=pvp] [skill=normal] [seconds=120]
import { GameWorld } from '../server/world.js';
import { WEAPONS } from '../shared/weapons.js';
const seed = +(process.env.SEED || 1); let rs = seed >>> 0; Math.random = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const [mode = 'pvp', skill = 'normal', secs = '120'] = process.argv.slice(2);
let now = 1_700_000_000_000; Date.now = () => now; // the server rate-limits with Date.now(); drive it manually
const hooks = { log() {}, event() {}, motd: () => '', save() {}, worlds: () => [] };
const w = new GameWorld({ id: 't', name: 't', seed: 11, type: 'flat', mode, economy: false, mobs: false, maxPlayers: 16, bots: 5, botsFixed: true, botSkill: skill }, null, hooks);
const [sx, , sz] = w.spawn; for (let a = -5; a <= 5; a++) for (let b = -5; b <= 5; b++) w.chunk(Math.floor(sx / 16) + a, Math.floor(sz / 16) + b);
const ws = { readyState: 1, bufferedAmount: 0, send() {}, close() {}, terminate() {} };
w.join(ws, { name: 'Spectator', uid: 'spec' }, '127.0.0.1');
const S = { shots: 0, pellets: 0, hits: 0, kills: 0, wall: 0, deadShots: 0 };
const mg = () => w.mg;
const wrap = () => { const m = mg(); if (!m || m.__w) return; m.__w = 1;
  const bs = m.blockShot.bind(m); m.blockShot = (...a) => { S.wall++; return bs(...a); };
  const sh = m.shoot.bind(m), dm = m.damage.bind(m), kl = m.kill.bind(m);
  m.shoot = (p, msg) => { if (p.bot) { const a = p.mg.ammo[msg.w]; sh(p, msg); if (p.mg.ammo[msg.w] < a) { S.shots++; S.pellets += WEAPONS[msg.w].pellets; } } else sh(p, msg); };
  m.damage = (q, n, by, ...r) => { if (by?.bot) S.hits++; return dm(q, n, by, ...r); };
  m.kill = (...a) => { S.kills++; return kl(...a); }; };
const t0 = performance.now(); const ticks = +secs * 20;
for (let i = 0; i < ticks; i++) { now += 50; w.tick(); wrap(); }
const bots = [...w.players.values()].filter(p => p.bot).length;
console.log(JSON.stringify({ mode, skill, secs: +secs, bots, ...S, accuracy: S.pellets ? +(S.hits / S.pellets * 100).toFixed(1) : 0, wallPct: S.pellets ? +(S.wall / S.pellets * 100).toFixed(1) : 0, killsPerMin: +(S.kills / (secs / 60)).toFixed(1), simMsPerTick: +((performance.now() - t0) / ticks).toFixed(3) }));
process.exit(0);
