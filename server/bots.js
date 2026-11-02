// AI players. Bots are real players in the world (they have p.mg, teams, scores, positions in state frames) - the only difference
// is a fake socket and a server-side brain. A BotDirector keeps a game topped up whenever at least one human is inside.
import { moveBody } from '../shared/physics.js';
import { isWater } from '../shared/fluid.js';
import { WEAPONS, rayBlocks } from '../shared/weapons.js';

export const BOT_MODES = ['pvp', 'tdm', 'gungame', 'zombies', 'raid', 'td', 'royale', 'hide', 'ctf', 'snd', 'bedwars'];
/** default TOTAL players (humans + bots) a public game tries to keep */
const TARGET = { pvp: 4, tdm: 6, gungame: 4, zombies: 2, raid: 3, td: 2, royale: 8, hide: 4, ctf: 6, snd: 6, bedwars: 4 };
// react = seconds before a bot fires at a newly spotted target; rof = fire-interval multiplier (1 = the weapon's full rate)
const SKILL = { easy: { err: .075, think: .5, fire: .6, speed: .8, react: .6, rof: 1.8 }, normal: { err: .035, think: .22, fire: .95, speed: .95, react: .28, rof: 1.2 }, hard: { err: .015, think: .12, fire: 1, speed: 1.05, react: .18, rof: 1.08 } };
const NAMES = ['Rex', 'Nova', 'Blitz', 'Echo', 'Ghost', 'Viper', 'Zed', 'Mako', 'Jinx', 'Onyx', 'Pixel', 'Rogue', 'Sable', 'Tank', 'Vex', 'Wraith'];
const SKINS = [{ shirt: '#c0392b', pants: '#2c3e50', skin: '#e0b48f', hair: '#2b1d0e' }, { shirt: '#2980b9', pants: '#34495e', skin: '#c68642', hair: '#111111' }, { shirt: '#27ae60', pants: '#1e3a2a', skin: '#f1c27d', hair: '#7a4b1e' }, { shirt: '#8e44ad', pants: '#2d1b3d', skin: '#8d5524', hair: '#0b0b0b' }, { shirt: '#f39c12', pants: '#5d4037', skin: '#ffdbac', hair: '#a0522d' }];
const fakeWs = () => ({ readyState: 1, bufferedAmount: 0, isAlive: true, send() {}, close() {}, terminate() {}, ping() { this.isAlive = true; } });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class BotDirector {
  constructor(world) { this.w = world; this.bots = []; this.fillT = 0; this.n = 0; }
  cfg() { return this.w.hooks.botsCfg?.() || { enabled: true, skill: 'normal', density: 1, capDensity: 1 }; }
  skill() { return SKILL[this.w.meta.botSkill] || SKILL[this.cfg().skill] || SKILL.normal; }
  humans() { let n = 0; for (const p of this.w.players.values()) if (!p.bot) n++; return n; }
  /** automatic bots only: summoned ones stay until an admin removes them (or the room empties) */
  auto() { return this.bots.filter(p => !p.summoned); }
  /** how many automatic bots we want right now */
  want() {
    const m = this.w.meta, c = this.cfg(), hs = this.humans(); if (!hs || !c.enabled || m.botsPaused || m.bots === 0 || m.bots === false) return 0;
    const room = m.maxPlayers - hs - (this.bots.length - this.auto().length);
    if (m.botsFixed || typeof m.bots === 'number') return Math.max(0, Math.min(Math.round((+m.bots || 0) * Math.min(1, c.capDensity)), room));
    return Math.max(0, Math.min(Math.round((TARGET[m.mode] || 0) * c.density * c.capDensity) - hs, room));
  }
  add(opts = {}) {
    const i = this.n++, base = opts.name || NAMES[(i + Math.floor(Math.random() * NAMES.length)) % NAMES.length], name = '[Bot] ' + base.replace(/^\[Bot\]\s*/i, '').slice(0, 14);
    const p = this.w.join(fakeWs(), { name, uid: 'bot-' + this.w.meta.id + '-' + i, skin: SKINS[i % SKINS.length], bot: true }, 'bot');
    p.bot = true; p.summoned = !!opts.summoned; if (opts.skill) p.botSkill = opts.skill; p.body = { x: p.x, y: p.y, z: p.z, w: .6, h: 1.8, vx: 0, vy: 0, vz: 0, onGround: false };
    if (opts.at) { p.x = p.body.x = opts.at[0]; p.y = p.body.y = opts.at[1]; p.z = p.body.z = opts.at[2]; }
    p.ai = { t: 0, target: null, wp: null, wpT: 0, shootT: 0, strafe: Math.random() < .5 ? 1 : -1, strafeT: 0, jumpT: 0, stuck: 0, detourT: 0, detourDir: 1 };
    this.bots.push(p); return p;
  }
  /** admin: spawn n bots on demand (next to `at`), regardless of the automatic fill target */
  summon(n, opts = {}) { const out = []; for (let i = 0; i < n && this.w.players.size < this.w.meta.maxPlayers + 8; i++) out.push(this.add({ ...opts, summoned: true, at: opts.at && [opts.at[0] + (Math.random() - .5) * 3, opts.at[1], opts.at[2] + (Math.random() - .5) * 3] })); return out; }
  remove(onlySummoned) { const i = this.bots.map((p, k) => [p, k]).reverse().find(([p]) => onlySummoned === undefined || !!p.summoned === onlySummoned); if (!i) return false; this.bots.splice(i[1], 1); this.w.leave(i[0]); return true; }
  removeN(n) { let k = 0; while (k < n && this.remove()) k++; return k; }
  clear() { while (this.bots.length) this.remove(); }
  tick(dt) {
    this.fillT -= dt; if (this.fillT <= 0) { this.fillT = 1; const want = this.want(), have = this.auto().length; if (have < want) this.add(); else if (have > want) this.remove(false); }
    this.bots = this.bots.filter(p => this.w.players.has(p.id)); if (!this.bots.length) return;
    const solid = (x, y, z) => { const id = this.w.getB(x, y, z); return id && !isWater(id); };
    for (const p of this.bots) this.think(p, dt, solid);
  }

  /* ---------- brains ---------- */
  enemies(p) { // other players this bot may attack
    const mg = this.w.mg, out = []; if (!mg) return out;
    for (const q of this.w.players.values()) { if (q === p || !q.mg?.alive || !mg.canHit(p, q)) continue; if (mg.kind === 'hide' && mg.seeker !== p.id) continue; out.push(q); }
    return out;
  }
  mobTargets() { const out = []; for (const m of this.w.sim.mobs.values()) out.push(m); return out; }
  think(p, dt, solid) {
    const mg = this.w.mg, ai = p.ai, b = p.body, sk = SKILL[p.botSkill] || this.skill(), g = p.mg;
    if (!g) return;
    if (Math.abs(p.x - b.x) > .9 || Math.abs(p.z - b.z) > .9 || Math.abs(p.y - b.y) > 2.5) { b.x = p.x; b.y = p.y; b.z = p.z; b.vx = b.vz = b.vy = 0; } // teleported (respawn / round start)
    if (!g.alive || (mg.state !== 'play' && mg.state !== 'lobby')) { b.vx = b.vz = 0; return; }
    if (ai.target && ((ai.target.mg && !ai.target.mg.alive) || (ai.target.id !== undefined && !ai.target.mg && !this.w.sim.mobs.has(ai.target.id)))) { ai.target = null; ai.t = 0; ai.eng = 0; } // target died / despawned: re-plan now, don't shoot a corpse
    ai.t -= dt; ai.shootT -= dt; ai.strafeT -= dt; ai.jumpT -= dt;
    const coop = ['zombies', 'raid', 'td'].includes(mg.kind), hiderBot = mg.kind === 'hide' && mg.seeker !== p.id;
    if (ai.t <= 0) { // re-plan
      ai.t = sk.think * (.7 + Math.random() * .6); let best = null, bd = 1e9;
      const pool = coop ? this.mobTargets() : this.enemies(p); const eye = { x: b.x, y: b.y + 1.5, z: b.z };
      for (const q of pool) { const d = dist(q, b); if (d < bd && d < (coop ? 40 : 60)) { const ty = q.y + (q.mg ? 1.4 : (q.h || 1.8) * .55); const dx = q.x - eye.x, dy = ty - eye.y, dz = q.z - eye.z, l = Math.hypot(dx, dy, dz) || 1;
          if (rayBlocks((x, y, z) => this.w.getB(x, y, z), eye.x, eye.y, eye.z, dx / l, dy / l, dz / l, l - .4) >= l - .5) { best = q; bd = d; } else if (!best && d < 25 && !ai.wp) ai.wp = { x: q.x, z: q.z }; } } // no line of sight: head that way anyway
      if ((best && best.id) !== (ai.target && ai.target.id)) ai.eng = 0; // new target: reaction timer restarts
      ai.target = best; ai.bd = bd; ai.obj = mg.kind === 'snd' || mg.kind === 'ctf' ? this.objective(p, mg) : null; if (!best && (!ai.wp || ai.wpT <= 0)) { ai.wp = this.objective(p, mg) || { x: mg.cx + (Math.random() * 2 - 1) * 11, z: mg.cz + (Math.random() * 2 - 1) * 11 }; ai.wpT = 3 + Math.random() * 3; }
    }
    ai.wpT -= dt;
    // ---- movement intent
    let mx = 0, mz = 0, speed = 4.6 * sk.speed; const tgt = ai.target; let aimX = 0, aimY = 0, aimZ = 0, hasAim = false;
    if (hiderBot && mg.phase === 'hide' && !ai.hid) { ai.hid = ai.hid || { x: mg.cx + (Math.random() * 2 - 1) * 12, z: mg.cz + (Math.random() * 2 - 1) * 12 }; }
    if (hiderBot) { const h = ai.hid; if (h && dist(h, b) > 1.2 && mg.phase === 'hide') { mx = h.x - b.x; mz = h.z - b.z; } else if (mg.phase !== 'hide') { /* freeze: stay put and hope */ } }
    else if (ai.obj && (!tgt || ai.bd > 14)) { const dx = ai.obj.x - b.x, dz = ai.obj.z - b.z; if (Math.hypot(dx, dz) > 1.4) { mx = dx; mz = dz; } if (tgt) { aimX = tgt.x; aimZ = tgt.z; aimY = tgt.y + (tgt.mg ? 1.4 : (tgt.h || 1.8) * .55); hasAim = true; } } // objective first, shoot on the way
    else if (tgt) {
      const dx = tgt.x - b.x, dz = tgt.z - b.z, d = Math.hypot(dx, dz) || 1, hold = coop ? 7 : mg.kind === 'hide' ? 2 : 9;
      if (d > hold + 2) { mx = dx; mz = dz; } else if (d < hold - 2 && !coop) { mx = -dx; mz = -dz; } else { if (ai.strafeT <= 0) { ai.strafeT = .8 + Math.random(); ai.strafe = -ai.strafe; } mx = -dz * ai.strafe; mz = dx * ai.strafe; }
      aimX = tgt.x; aimZ = tgt.z; aimY = tgt.y + (tgt.mg ? 1.4 : (tgt.h || 1.8) * .55); hasAim = true;
    } else if (ai.wp) { const dx = ai.wp.x - b.x, dz = ai.wp.z - b.z; if (Math.hypot(dx, dz) > 1.5) { mx = dx; mz = dz; } else ai.wpT = 0; }
    if (mg.kind === 'royale' && mg.zone && dist(mg.zone, b) > mg.zone.r - 6) { mx = mg.zone.x - b.x; mz = mg.zone.z - b.z; } // run for the safe zone
    const ml = Math.hypot(mx, mz); if (ml > .01) { mx /= ml; mz /= ml; }
    if (ai.detourT > 0) { ai.detourT -= dt; const ox = mx; mx = -mz * ai.detourDir; mz = ox * ai.detourDir; } // sidestep an obstacle we were stuck on
    const k = Math.min(1, dt * 9); b.vx += (mx * speed - b.vx) * k; b.vz += (mz * speed - b.vz) * k;
    b.vy = Math.max(b.vy - 28 * dt, -40); const ivx = b.vx, ivz = b.vz, f = moveBody(solid, b, dt);
    if (b.onGround && ((f.x && Math.abs(ivx) > .5) || (f.z && Math.abs(ivz) > .5) || (ai.jumpT <= 0 && tgt && Math.random() < .004))) { b.vy = 8.4; ai.jumpT = .8; }
    if (ml > .01 && (f.x || f.z) && b.onGround) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt * 2);
    if (ai.stuck > .6) { ai.stuck = 0; ai.detourT = .9; ai.detourDir = Math.random() < .5 ? 1 : -1; }
    p.x = b.x; p.y = b.y; p.z = b.z;
    // ---- facing
    const fx = hasAim ? aimX - b.x : mx, fz = hasAim ? aimZ - b.z : mz; if (Math.hypot(fx, fz) > .05) { const want = Math.atan2(-fx, -fz); let dy = want - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); p.yaw += dy * Math.min(1, dt * 12); }
    p.pitch = hasAim ? Math.asin(Math.max(-1, Math.min(1, (aimY - (b.y + 1.5)) / (Math.hypot(aimX - b.x, aimY - (b.y + 1.5), aimZ - b.z) || 1)))) : 0;
    p.st = !b.onGround ? 1 : Math.hypot(b.vx, b.vz) > 6 ? 3 : 0;
    // ---- shooting
    if (hasAim) ai.eng = (ai.eng || 0) + dt; else ai.eng = 0;
    if (hasAim && ai.shootT <= 0 && ai.eng >= sk.react && mg.fps && mg.state === 'play' && Math.random() < sk.fire) {
      const lock = mg.gunLock(p); if (lock === -2) return;
      const d3 = Math.hypot(aimX - b.x, aimY - (b.y + 1.5), aimZ - b.z); let wi = lock >= 0 ? lock : d3 < 9 ? 2 : d3 < 38 ? 1 : 3; if (lock < 0 && Math.random() < .12) wi = 0;
      if (g.ammo[wi] <= 0) { const alt = g.ammo.findIndex(a => a > 0); if (lock < 0 && alt >= 0) wi = alt; else { mg.reload(p, wi); ai.shootT = .5; return; } }
      const eyeY = b.y + 1.5, ll = Math.hypot(aimX - b.x, aimY - eyeY, aimZ - b.z) || 1;
      if (rayBlocks((x, y, z) => this.w.getB(x, y, z), b.x, eyeY, b.z, (aimX - b.x) / ll, (aimY - eyeY) / ll, (aimZ - b.z) / ll, ll - .5) < ll - .6) { ai.t = 0; return; } // wall in the way: don't waste ammo, look for a new target
      const wp = WEAPONS[wi], settle = 1 + 1.5 * Math.max(0, 1 - (ai.eng - sk.react) / 1.0), err = (sk.err + d3 * .0009) * settle, // aim tightens over the first second on target
        ex = (Math.random() - .5) * err * 2, ey = (Math.random() - .5) * err * 2, ez = (Math.random() - .5) * err * 2;
      const dx = aimX - b.x + ex * d3, dy = aimY - (b.y + 1.5) + ey * d3, dz = aimZ - b.z + ez * d3, l = Math.hypot(dx, dy, dz) || 1;
      mg.shoot(p, { t: 'shoot', w: wi, dx: dx / l, dy: dy / l, dz: dz / l }); ai.shootT = wp.rate * (sk.rof + Math.random() * .35) + (wp.auto ? 0 : .05);
    }
  }
  /** mode objectives so bots do more than deathmatch */
  objective(p, mg) {
    if (mg.kind === 'snd') { const att = p.mg.team === 0; return att ? { x: mg.site[0], z: mg.site[2] } : { x: mg.site[0] + (Math.random() * 6 - 3), z: mg.site[2] + (Math.random() * 6 - 3) }; }
    if (mg.kind === 'ctf') { const mine = mg.flags[p.mg.team], theirs = mg.flags[1 - p.mg.team]; const carrying = theirs.carrier === p.id; const f = carrying ? mine.home : theirs.at; return { x: f[0], z: f[2] }; }
    if (mg.kind === 'td') return { x: mg.coreP[0] - 4 - Math.random() * 3, z: mg.coreP[1] + (Math.random() * 10 - 5) };
    return null;
  }
}
