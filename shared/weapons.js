import { isWater } from './fluid.js';
// Weapon definitions shared by the server (authoritative) and the client (HUD, fire rate / ammo).
export const WEAPONS = [
  { id: 'pistol', recoil: .012,  name: 'Pistol',  dmg: 6,  pellets: 1, spread: .004, rate: .32, mag: 12, reload: 1.1, range: 70,  auto: false },
  { id: 'rifle', recoil: .008,   name: 'Rifle',   dmg: 4,  pellets: 1, spread: .012, rate: .1,  mag: 30, reload: 1.8, range: 90,  auto: true },
  { id: 'shotgun', recoil: .05, name: 'Shotgun', dmg: 4,  pellets: 7, spread: .07,  rate: .85, mag: 6,  reload: 2.2, range: 24,  auto: false },
  { id: 'sniper', recoil: .07,  name: 'Sniper',  dmg: 17, pellets: 1, spread: 0,    rate: 1.4, mag: 4,  reload: 2.6, range: 160, auto: false },
];
export const HEAD_MULT = 1.6;

/** Ray vs axis-aligned box (slab method, allocation-free). Returns the entry distance or -1. */
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity, t1, t2, t;
  if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return -1; } else { t1 = (x0 - ox) / dx; t2 = (x1 - ox) / dx; if (t1 > t2) { t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return -1; } else { t1 = (y0 - oy) / dy; t2 = (y1 - oy) / dy; if (t1 > t2) { t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(dz) < 1e-9) { if (oz < z0 || oz > z1) return -1; } else { t1 = (z0 - oz) / dz; t2 = (z1 - oz) / dz; if (t1 > t2) { t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  return tmin;
}

/** Distance to the first solid block along the ray (exact voxel traversal, no tunnelling), or `max` if clear. */
export function rayBlocks(getB, ox, oy, oz, dx, dy, dz, max) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity, ty = dy ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity, tz = dz ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
  let t = 0;
  while (t < max) {
    const id = getB(x, y, z); if (id && !isWater(id)) return t;
    if (tx < ty && tx < tz) { t = tx; tx += tdx; x += sx; } else if (ty < tz) { t = ty; ty += tdy; y += sy; } else { t = tz; tz += tdz; z += sz; }
  }
  return max;
}
