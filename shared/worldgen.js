// Deterministic terrain generation. Pure JS (no DOM / THREE) so the browser, the chunk worker and the Node server all agree.
import { CS, CH, SEA, B } from './blocks.js';
const { STONE, SAND, GRASS, DIRT, SNOW, CLAY, GRAVEL, COAL, IRON, GOLD, DIAMOND, WATER, LEAVES, LOG } = B;

export function hash3(a, b, c, s = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
export const smooth = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };

export function seedFromText(t) {
  t = String(t ?? '').trim();
  if (!t) return (Math.random() * 1e9) | 0;
  if (/^-?\d+$/.test(t)) return parseInt(t) | 0;
  let h = 5381; for (const c of t) h = (Math.imul(h, 33) + c.charCodeAt(0)) | 0; return h;
}

export function createWorldGen(seed, gen = {}) {
  const type = gen.type || 'normal';
  const vn2 = (x, z, o) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = fade(x - ix), fz = fade(z - iz);
    return lerp(lerp(hash3(ix, iz, o, seed), hash3(ix + 1, iz, o, seed), fx), lerp(hash3(ix, iz + 1, o, seed), hash3(ix + 1, iz + 1, o, seed), fx), fz);
  };
  const vn3 = (x, y, z, o) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
    const h = (a, b, c) => hash3(ix + a, iy + b, iz + c, seed + o);
    return lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), fx), lerp(h(0, 1, 0), h(1, 1, 0), fx), fy),
      lerp(lerp(h(0, 0, 1), h(1, 0, 1), fx), lerp(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
  };
  const fbm2 = (x, z, oct, o) => { let s = 0, a = 1, t = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * vn2(x * f, z * f, o + i * 31); t += a; a *= .5; f *= 2; } return s / t; };

  function terrainH(x, z) {
    const base = fbm2(x * .0035, z * .0035, 4, 1);
    const mnt = Math.pow(Math.max(0, fbm2(x * .008 + 100, z * .008 + 100, 4, 2) - .45) * 2.2, 1.6);
    let h = 16 + (base - .35) * 40 + mnt * 42 + fbm2(x * .04, z * .04, 3, 3) * 5;
    if (type === 'flat') h = 24 + fbm2(x * .05, z * .05, 2, 3) * 1.5;
    else if (type === 'mountains') h = SEA + (h - SEA) * 1.7 + 4;
    else if (type === 'islands') h -= 10;
    return Math.max(2, Math.min(CH - 12, Math.floor(h)));
  }

  /** Returns { data: Uint8Array(CS*CS*CH), maxY } for the chunk. Index = x + 16*(z + 16*y). */
  function genChunk(cx, cz) {
    const data = new Uint8Array(CS * CS * CH); let maxY = 0;
    const I = (x, y, z) => x + 16 * (z + 16 * y);
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const wx = cx * CS + lx, wz = cz * CS + lz, h = terrainH(wx, wz);
      const sandy = h <= SEA + 1, top = sandy ? (h < SEA - 1 && hash3(wx >> 2, wz >> 2, 41, seed) > .72 ? CLAY : SAND) : h > 56 ? SNOW : h > 46 ? STONE : GRASS;
      for (let y = 0; y <= h; y++) {
        let id;
        if (y === h) id = top;
        else if (y > h - 4) id = sandy ? (top === CLAY ? CLAY : SAND) : (top === STONE || top === SNOW ? STONE : DIRT);
        else {
          id = STONE; const r = hash3(wx, y, wz, seed + 5);
          if (y < 44 && r < .012) id = COAL; else if (y < 40 && r > .975 && r < .99) id = IRON; else if (y < 22 && r > .9965) id = GOLD; else if (y < 14 && r > .9985) id = DIAMOND; else if (y < 46 && r > .94 && r < .95) id = GRAVEL;
        }
        if (y > 2 && y < h - 3 && Math.abs(vn3(wx * .045, y * .07, wz * .045, 11) - .5) < .04 && Math.abs(vn3(wx * .045, y * .07, wz * .045, 23) - .5) < .05) id = 0;
        data[I(lx, y, lz)] = id;
      }
      for (let y = h + 1; y <= SEA; y++) data[I(lx, y, lz)] = WATER;
      maxY = Math.max(maxY, h + 1, SEA + 1);
      if (top === GRASS && lx >= 2 && lx <= 13 && lz >= 2 && lz <= 13 && hash3(wx, wz, 7, seed) < .014) {
        const th = 4 + Math.floor(hash3(wx, wz, 8, seed) * 3), tp = h + th;
        for (let dy = -2; dy <= 1; dy++) {
          const r = dy === 1 ? 1 : 2;
          for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 1 || hash3(wx + dx, wz + dz, dy, seed) > .5)) continue;
            const y = tp + dy; if (y < CH && data[I(lx + dx, y, lz + dz)] === 0) { data[I(lx + dx, y, lz + dz)] = LEAVES; maxY = Math.max(maxY, y + 1); }
          }
        }
        for (let y = h + 1; y <= tp; y++) data[I(lx, y, lz)] = LOG;
      }
    }
    return { data, maxY: Math.min(CH, maxY + 1) };
  }

  /** First dry land near the origin, used for spawning. */
  function findSpawn() {
    for (let r = 0; r < 400; r += 8) for (let a = 0; a < (r ? 12 : 1); a++) {
      const x = Math.round(Math.cos(a / 12 * 6.283) * r), z = Math.round(Math.sin(a / 12 * 6.283) * r), h = terrainH(x, z);
      if (h > SEA + 2 && h < 44) return [x + .5, h + 3, z + .5];
    }
    return [8.5, SEA + 10, 8.5];
  }
  return { terrainH, genChunk, findSpawn, seed, type };
}
