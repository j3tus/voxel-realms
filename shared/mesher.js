// Chunk mesher: turns voxel data into typed-array geometry with baked AO, skylight and block light.
// Pure JS - runs inside the chunk worker (streaming) and on the main thread (instant remesh after an edit).
import { CS, CH, OPAQUE, TILES, EMISSIVE, B } from './blocks.js';
import { isWater, waterLevel } from './fluid.js';
const { GLASS } = B;

export const ATL = 8;
const FACES = [
  { d: [-1, 0, 0], t: 0, a: [1, 2], c: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { d: [1, 0, 0], t: 0, a: [1, 2], c: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { d: [0, -1, 0], t: 2, a: [0, 2], c: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { d: [0, 1, 0], t: 1, a: [0, 2], c: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { d: [0, 0, -1], t: 0, a: [0, 1], c: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { d: [0, 0, 1], t: 0, a: [0, 1], c: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
const AO_LV = [.42, .62, .82, 1];

class FBuf {
  constructor(cap = 8192) { this.a = new Float32Array(cap); this.n = 0; }
  p(v) { if (this.n === this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  out() { return this.a.slice(0, this.n); }
}
class IBuf {
  constructor(cap = 8192) { this.a = new Uint32Array(cap); this.n = 0; }
  p(v) { if (this.n === this.a.length) { const b = new Uint32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  out(vcount) { const src = this.a.subarray(0, this.n); return vcount < 65535 ? Uint16Array.from(src) : src.slice(); }
}
const mkGroup = () => ({ pos: new FBuf(), nrm: new FBuf(), uv: new FBuf(), col: new FBuf(), blk: new FBuf(), sky: new FBuf(), idx: new IBuf(), v: 0 });
const finish = g => g.idx.n ? { pos: g.pos.out(), nrm: g.nrm.out(), uv: g.uv.out(), col: g.col.out(), blk: g.blk.out(), sky: g.sky.out(), idx: g.idx.out(g.v) } : null;

/** nbrs: array(9) of Uint8Array|null, index (dz+1)*3+(dx+1); nbrs[4] is the chunk itself. */
export function meshChunk(nbrs, maxY) {
  const self = nbrs[4];
  const get = (x, y, z) => {
    if (y < 0) return 3; if (y >= CH) return 0;
    const d = nbrs[((z >> 4) + 1) * 3 + ((x >> 4) + 1)];
    return d ? d[(x & 15) + 16 * ((z & 15) + 16 * y)] : 0;
  };

  // ---- skylight heightmap for columns -1..16 (18x18) ----
  const HW = 18, hm = new Int16Array(HW * HW);
  for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
    let y = CH - 1; while (y >= 0 && !OPAQUE[get(x, y, z)]) y--;
    hm[(z + 1) * HW + (x + 1)] = y;
  }
  const skyAt = (vx, vy, vz) => { // vertex at integer corner (vx,vy,vz): average the 4 columns around it
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const cx = vx - (k & 1), cz = vz - (k >> 1), h = hm[(Math.min(16, Math.max(-1, cz)) + 1) * HW + Math.min(16, Math.max(-1, cx)) + 1];
      s += vy > h ? 1 : Math.max(.12, 1 - (h - vy + 1) * .13);
    }
    return s * .25;
  };

  // ---- block light (only if a light source is inside the 3x3 neighbourhood) ----
  let light = null, LW = 48;
  let hasEmitter = false; for (let i = 0; i < 9 && !hasEmitter; i++) { const d = nbrs[i]; if (d) for (const e of [28]) if (d.includes(e)) { hasEmitter = true; break; } }
  if (hasEmitter) {
    light = new Uint8Array(LW * LW * CH); const q = [];
    for (let nz = 0; nz < 3; nz++) for (let nx = 0; nx < 3; nx++) {
      const d = nbrs[nz * 3 + nx]; if (!d) continue;
      for (let y = 0; y < CH; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const e = EMISSIVE[d[x + 16 * (z + 16 * y)]]; if (e) { const gx = nx * 16 + x, gz = nz * 16 + z, i = (gz * LW + gx) * CH + y; light[i] = e; q.push(i); }
      }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], l = light[i] - 1; if (l <= 0) continue; const y = i % CH, c = (i - y) / CH, gx = c % LW, gz = (c - gx) / LW;
      const tryN = (nx, ny, nz) => {
        if (nx < 0 || nz < 0 || nx >= LW || nz >= LW || ny < 0 || ny >= CH) return;
        const ni = (nz * LW + nx) * CH + ny; if (light[ni] >= l) return;
        const id = nbrs[(nz >> 4) * 3 + (nx >> 4)]?.[(nx & 15) + 16 * ((nz & 15) + 16 * ny)] ?? 0; if (OPAQUE[id]) return;
        light[ni] = l; q.push(ni);
      };
      tryN(gx - 1, y, gz); tryN(gx + 1, y, gz); tryN(gx, y - 1, gz); tryN(gx, y + 1, gz); tryN(gx, y, gz - 1); tryN(gx, y, gz + 1);
    }
  }
  const lightAt = (x, y, z) => { // local chunk coords (may be -16..31)
    if (!light || y < 0 || y >= CH) return 0; const gx = x + 16, gz = z + 16; if (gx < 0 || gz < 0 || gx >= LW || gz >= LW) return 0; return light[(gz * LW + gx) * CH + y];
  };

  const O = mkGroup(), T = mkGroup(), W = mkGroup(), inset = .012, q3 = [0, 0, 0];
  for (let y = 0; y < maxY; y++) for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const id = self[lx + 16 * (lz + 16 * y)]; if (!id) continue;
    const wat = isWater(id), g = wat ? W : id === GLASS ? T : O, plain = g !== O;
    for (const f of FACES) {
      const nb = get(lx + f.d[0], y + f.d[1], lz + f.d[2]); if (OPAQUE[nb] || nb === id || (wat && isWater(nb))) continue;
      const tile = TILES[id][f.t], tx = tile % ATL, ty = Math.floor(tile / ATL), vb = 1 - (ty + 1) / ATL, base = g.v;
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      for (let k = 0; k < 4; k++) {
        const c = f.c[k]; let py = y + c[1];
        if (wat && c[1] === 1 && !isWater(get(lx, y + 1, lz))) py = y + .88 * waterLevel(id) / 8;
        g.pos.p(lx + c[0]); g.pos.p(py); g.pos.p(lz + c[2]); g.nrm.p(f.d[0]); g.nrm.p(f.d[1]); g.nrm.p(f.d[2]);
        g.uv.p((tx + inset + c[3] * (1 - 2 * inset)) / ATL); g.uv.p(vb + (inset + c[4] * (1 - 2 * inset)) / ATL);
        let lv = 1, bl = 0;
        const a1i = f.a[0], a2i = f.a[1], o1 = c[a1i] * 2 - 1, o2 = c[a2i] * 2 - 1;
        q3[0] = lx + f.d[0]; q3[1] = y + f.d[1]; q3[2] = lz + f.d[2];
        if (!plain) {
          const ba = [q3[0], q3[1], q3[2]];
          q3[a1i] += o1; const s1 = OPAQUE[get(q3[0], q3[1], q3[2])]; const l1 = lightAt(q3[0], q3[1], q3[2]); q3[a1i] -= o1;
          q3[a2i] += o2; const s2 = OPAQUE[get(q3[0], q3[1], q3[2])]; const l2 = lightAt(q3[0], q3[1], q3[2]); q3[a1i] += o1; const cc = OPAQUE[get(q3[0], q3[1], q3[2])]; const l3 = lightAt(q3[0], q3[1], q3[2]);
          lv = AO_LV[(s1 && s2) ? 0 : 3 - (s1 + s2 + cc)];
          if (light) bl = (lightAt(ba[0], ba[1], ba[2]) + l1 + l2 + l3) * .25 / 14;
        } else if (light) bl = lightAt(q3[0], q3[1], q3[2]) / 14;
        g.col.p(lv); g.col.p(lv); g.col.p(lv); g.blk.p(bl);
        g.sky.p(skyAt(lx + c[0], y + c[1], lz + c[2]));
        if (k === 0) a0 = lv; else if (k === 1) a1 = lv; else if (k === 2) a2 = lv; else a3 = lv;
      }
      g.v += 4;
      if (a0 + a3 > a1 + a2) { g.idx.p(base + 1); g.idx.p(base + 3); g.idx.p(base); g.idx.p(base); g.idx.p(base + 3); g.idx.p(base + 2); }
      else { g.idx.p(base); g.idx.p(base + 1); g.idx.p(base + 2); g.idx.p(base + 2); g.idx.p(base + 1); g.idx.p(base + 3); }
    }
  }
  return { O: finish(O), T: finish(T), W: finish(W) };
}

export function transferList(m) {
  const out = [];
  for (const k of ['O', 'T', 'W']) { const g = m[k]; if (g) for (const a of Object.values(g)) out.push(a.buffer); }
  return out;
}
