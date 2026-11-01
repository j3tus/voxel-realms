// Flowing water: source = WATER (id 7, level 8); flow ids FLOW0+L for levels 1..7. Pure JS, shared by server and offline client.
import { B, CH } from './blocks.js';
export const FLOW0 = 32; // id 33..39 = level 1..7
export const isWater = id => id === B.WATER || (id > FLOW0 && id <= FLOW0 + 7);
export const waterLevel = id => id === B.WATER ? 8 : id > FLOW0 && id <= FLOW0 + 7 ? id - FLOW0 : 0;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x, y, z) => x + ',' + y + ',' + z;

export class Fluid {
  /** get(x,y,z)->id, set(x,y,z,id) applies a change (and must persist/broadcast it). */
  constructor(get, set) { this.get = get; this.set = set; this.active = new Map(); }
  /** Call whenever a block changes. */
  poke(x, y, z) {
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const yy = y + dy; if (yy >= 0 && yy < CH) this.active.set(key(x + dx, yy, z + dz), [x + dx, yy, z + dz]);
    }
  }
  /** Process up to `budget` active cells; returns number processed. */
  step(budget = 300) {
    const cur = [...this.active.values()].slice(0, budget);
    for (const c of cur) this.active.delete(key(c[0], c[1], c[2]));
    for (const [x, y, z] of cur) this.cell(x, y, z);
    return cur.length;
  }
  fillable(id) { return id === 0 || (id > FLOW0 && id <= FLOW0 + 7); }
  put(x, y, z, L) { // spread level L into a fillable cell if it raises it
    if (y < 0 || y >= CH) return; const id = this.get(x, y, z);
    if (!(id === 0 || (waterLevel(id) && id !== B.WATER && waterLevel(id) < L))) return;
    this.set(x, y, z, FLOW0 + L); this.poke(x, y, z);
  }
  cell(x, y, z) {
    const id = this.get(x, y, z), L = waterLevel(id);
    if (L && id !== B.WATER) { // flowing cell: recompute support, retract if unsupported
      const above = isWater(this.get(x, y + 1, z));
      let want = above ? 7 : 0;
      if (!above) for (const [dx, dz] of DIRS) {
        const n = this.get(x + dx, y, z + dz), nl = waterLevel(n);
        if (nl && isWater(this.get(x + dx, y - 1, z + dz)) === false || nl === 8) want = Math.max(want, nl - 1);
        else if (nl && !this.fillable(this.get(x + dx, y - 1, z + dz))) want = Math.max(want, nl - 1);
      }
      if (want <= 0) { this.set(x, y, z, 0); this.poke(x, y, z); return; }
      if (want !== L) { this.set(x, y, z, FLOW0 + want); this.poke(x, y, z); return; }
    } else if (!L) return;
    const cl = waterLevel(this.get(x, y, z)); if (!cl) return;
    const below = this.get(x, y - 1, z);
    if (y > 0 && this.fillable(below) && below !== B.WATER) { this.put(x, y - 1, z, 7); return; }
    if (cl > 1 && y > 0 && !this.fillable(below) || (cl > 1 && isWater(below))) {
      if (this.fillable(below)) return;
      for (const [dx, dz] of DIRS) this.put(x + dx, y, z + dz, cl - 1);
    }
  }
}
