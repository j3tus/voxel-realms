import { isWater } from './fluid.js';
// Weapon definitions shared by the server (authoritative) and the client (HUD, fire rate / ammo).
export const WEAPONS = [
  { id: 'pistol',  name: 'Pistol',  dmg: 6,  pellets: 1, spread: .004, rate: .32, mag: 12, reload: 1.1, range: 70,  auto: false },
  { id: 'rifle',   name: 'Rifle',   dmg: 4,  pellets: 1, spread: .012, rate: .1,  mag: 30, reload: 1.8, range: 90,  auto: true },
  { id: 'shotgun', name: 'Shotgun', dmg: 4,  pellets: 7, spread: .07,  rate: .85, mag: 6,  reload: 2.2, range: 24,  auto: false },
  { id: 'sniper',  name: 'Sniper',  dmg: 17, pellets: 1, spread: 0,    rate: 1.4, mag: 4,  reload: 2.6, range: 160, auto: false },
];
export const HEAD_MULT = 1.6;

/** Ray vs axis-aligned box (slab method). Returns the entry distance or -1. */
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  for (const [o, d, a, b] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < a || o > b) return -1; continue; }
    let t1 = (a - o) / d, t2 = (b - o) / d; if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Distance to the first solid block along the ray (0.2 step march), or `max` if clear. */
export function rayBlocks(getB, ox, oy, oz, dx, dy, dz, max) {
  for (let t = 0; t < max; t += .2) {
    const id = getB(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t));
    if (id && !isWater(id)) return t;
  }
  return max;
}
