// NPC simulation shared by the singleplayer client and the authoritative game server.
// The sim only needs a `world` with getB(x,y,z) and hasChunk(cx,cz).
import { CH, SEA, B } from './blocks.js';
import { moveBody } from './physics.js';
const { WATER, LEAVES } = B;
import { isWater } from './fluid.js';

export const MOB = {
  pig: { hp: 6, speed: 1.4, w: .7, h: .85, cap: 6 },
  zombie: { hp: 10, speed: 2.2, w: .6, h: 1.8, cap: 4, hostile: true },
  villager: { hp: 14, speed: 1.0, w: .6, h: 1.8, cap: 2 },
  boss: { hp: 400, speed: 2.4, w: 1.3, h: 3.6, cap: 0, hostile: true, reach: 2.5, dmg: 6 }, // raid boss (only spawned by game modes)
};
export const MOB_TYPES = ['pig', 'zombie', 'villager', 'boss']; // index travels as a u8 in binary frames - append only
export const VILLAGER_LINES = ['Hello, traveller!', 'Lovely weather for building.', 'Watch out for zombies at night.', 'Have you found any diamonds?', 'I sell... nothing. Sorry.', 'Mind the water, it is deeper than it looks.', 'The stars are beautiful tonight.', 'Hrmm.'];

export class MobSim {
  constructor(world, opts = {}) {
    this.world = world; this.mobs = new Map(); this.nextId = 1; this.spawnT = 0; this.events = []; this.goal = null; // goal {x,z}: hostile mobs march on it unless a player is close (tower defence)
    this.caps = { pig: MOB.pig.cap, zombie: MOB.zombie.cap, villager: MOB.villager.cap, ...(opts.caps || {}) };
    this.enabled = opts.enabled !== false; this.hostile = opts.hostile !== false;
  }
  boxCollide(x, y, z, w, h) {
    const g = this.world.getB, x0 = Math.floor(x - w / 2), x1 = Math.floor(x + w / 2 - 1e-6), y0 = Math.floor(y), y1 = Math.floor(y + h - 1e-6), z0 = Math.floor(z - w / 2), z1 = Math.floor(z + w / 2 - 1e-6);
    for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) { const id = g(a, b, c); if (id && !isWater(id)) return true; }
    return false;
  }
  spawn(type, x, y, z) {
    let id; do { id = this.nextId = (this.nextId % 65535) + 1; } while (this.mobs.has(id)); // ids travel as u16 in binary frames
    const m = { id, type, x, y, z, vx: 0, vy: 0, vz: 0, yaw: Math.random() * 6.283, hp: MOB[type].hp, dirT: 0, walk: false, atk: 0, hurt: 0, onGround: false };
    this.mobs.set(m.id, m); return m;
  }
  remove(id) { this.mobs.delete(id); }
  clear(type) { for (const [id, m] of this.mobs) if (!type || m.type === type) this.mobs.delete(id); }
  hit(id, dmg, fx, fz) {
    const m = this.mobs.get(id); if (!m) return null;
    m.hp -= dmg; m.hurt = .35; const dx = m.x - fx, dz = m.z - fz, l = Math.hypot(dx, dz) || 1; m.vx = dx / l * 7; m.vz = dz / l * 7; m.vy = 5.5;
    if (m.hp <= 0) { this.mobs.delete(id); this.events.push({ t: 'mobdie', mtype: m.type, x: m.x, y: m.y, z: m.z }); return { killed: true, m }; }
    return { killed: false, m };
  }
  counts() { const c = { pig: 0, zombie: 0, villager: 0, boss: 0 }; for (const m of this.mobs.values()) c[m.type]++; return c; }

  trySpawn(players, env) {
    if (!players.length) return;
    const p = players[Math.random() * players.length | 0], counts = this.counts(), scale = Math.min(3, players.length);
    const want = [];
    if (counts.pig < this.caps.pig * scale) want.push('pig');
    if (counts.villager < this.caps.villager * scale) want.push('villager');
    if (env.night && this.hostile && counts.zombie < this.caps.zombie * scale) { want.push('zombie'); want.push('zombie'); }
    if (!want.length) return;
    const type = want[Math.random() * want.length | 0], a = Math.random() * 6.283, d = 18 + Math.random() * 18;
    const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
    if (!this.world.hasChunk(x >> 4, z >> 4)) return;
    const g = this.world.getB; let y = CH - 2; while (y > 0 && !g(x, y, z)) y--;
    const gb = g(x, y, z); if (isWater(gb) || gb === LEAVES || !gb || y < SEA) return; if (g(x, y + 1, z) || g(x, y + 2, z)) return;
    this.spawn(type, x + .5, y + 1, z + .5);
  }

  /** players: [{id,x,y,z,dead}] ; env: {night, sunElev}. Pushes damage events to this.events. */
  update(dt, players, env) {
    if (!this.enabled || !players.length) return;
    this.spawnT += dt; if (this.spawnT > 1.6) { this.spawnT = 0; this.trySpawn(players, env); }
    const g = this.world.getB, solid = (x, y, z) => { const id = g(x, y, z); return id && !isWater(id); };
    for (const m of [...this.mobs.values()]) {
      const def = MOB[m.type]; m.hurt = Math.max(0, m.hurt - dt); m.atk -= dt;
      let np = null, nd = 1e9; for (const p of players) { if (p.dead) continue; const d = Math.hypot(p.x - m.x, p.z - m.z); if (d < nd) { nd = d; np = p; } }
      if (!np) { np = players[0]; nd = Math.hypot(np.x - m.x, np.z - m.z); }
      const dist = nd; let tx = 0, tz = 0;
      if (dist > 75 || m.y < -10 || (m.type === 'zombie' && env.sunElev > .3 && (m.hp -= dt * 4) <= 0)) { if (m.hp <= 0) this.events.push({ t: 'mobdie', mtype: m.type, x: m.x, y: m.y, z: m.z, burn: true }); this.mobs.delete(m.id); continue; }
      const dx = np.x - m.x, dz = np.z - m.z; let hunt = def.hostile && this.hostile && dist < 22 && !np.dead, hx = dx, hz = dz;
      if (this.goal && def.hostile && this.hostile && (dist > 7 || np.dead)) { hx = this.goal.x - m.x; hz = this.goal.z - m.z; hunt = true; } // march on the objective unless a player is close
      if (hunt) {
        const sp = def.speed * (m.spd || 1); m.yaw = Math.atan2(hx, hz); tx = Math.sin(m.yaw) * sp; tz = Math.cos(m.yaw) * sp;
        if (dist < (def.reach || 1.15) && Math.abs(np.y - m.y) < (def.h > 2.5 ? 2.8 : 1.6) && !np.dead && m.atk <= 0) { m.atk = 1; this.events.push({ t: 'dmg', pid: np.id, n: def.dmg || 3, kx: Math.sin(m.yaw) * 6, kz: Math.cos(m.yaw) * 6, mid: m.id }); }
      } else {
        m.dirT -= dt; if (m.dirT <= 0) { m.dirT = 2 + Math.random() * 4; m.walk = Math.random() < .6; m.yaw = Math.random() * 6.283; }
        if (m.type === 'villager' && dist < 5) { m.yaw = Math.atan2(dx, dz); m.walk = false; }
        if (m.walk) { tx = Math.sin(m.yaw) * def.speed * .6; tz = Math.cos(m.yaw) * def.speed * .6; }
      }
      m.vx += (tx - m.vx) * Math.min(1, dt * 8); m.vz += (tz - m.vz) * Math.min(1, dt * 8);
      const inW = isWater(g(Math.floor(m.x), Math.floor(m.y + .2), Math.floor(m.z)));
      if (inW) { m.vy = Math.max(m.vy - 6 * dt, -1.5); if (tx || tz) m.vy = 2.2; } else m.vy = Math.max(m.vy - 28 * dt, -40);
      m.w = def.w; m.h = def.h;
      const ivx = m.vx, ivz = m.vz, f = moveBody(solid, m, dt);
      if ((m.onGround || inW) && ((f.x && !this.boxCollide(m.x + Math.sign(ivx) * .1, m.y + 1.1, m.z, def.w, def.h)) || (f.z && !this.boxCollide(m.x, m.y + 1.1, m.z + Math.sign(ivz) * .1, def.w, def.h)))) m.vy = 8.4;
    }
  }
  snapshot() {
    const out = [];
    for (const m of this.mobs.values()) out.push([m.id, MOB_TYPES.indexOf(m.type), +m.x.toFixed(2), +m.y.toFixed(2), +m.z.toFixed(2), +m.yaw.toFixed(2), +(m.hp / MOB[m.type].hp).toFixed(2), m.hurt > 0 ? 1 : 0, m.atk > .6 ? 1 : 0]);
    return out;
  }
  drainEvents() { const e = this.events; this.events = []; return e; }
}
