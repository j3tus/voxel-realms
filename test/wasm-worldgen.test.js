import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createWorldGen } from '../shared/worldgen.js';
import { wasmWorldGenFactory } from '../shared/wasmgen.js';

const bytes = fs.readFileSync(new URL('../shared/wasm/worldgen.wasm', import.meta.url));
describe('Rust/WASM terrain generator', () => {
  const f = wasmWorldGenFactory(bytes);
  it('loads', () => { expect(f).toBeTypeOf('function'); });
  it('is bit-identical to the JS reference (every world type, odd seeds, far and negative coordinates)', () => {
    let n = 0;
    for (const type of ['normal', 'flat', 'mountains', 'islands', 'unknown-type']) for (const seed of [0, 1, 42, -99999, 2147483647, -2147483648, 123456789]) {
      const a = createWorldGen(seed, { type }), b = f(seed, { type });
      for (const [cx, cz] of [[0, 0], [-1, -1], [37, -11], [-250, 400], [1999, -1999], [5, 5]]) {
        const A = a.genChunk(cx, cz), B = b.genChunk(cx, cz); n++;
        expect(B.maxY).toBe(A.maxY); expect(Buffer.compare(Buffer.from(B.data), Buffer.from(A.data))).toBe(0);
      }
      for (const [x, z] of [[0, 0], [-777, 12], [30000, -30000], [8, 8]]) expect(b.terrainH(x, z)).toBe(a.terrainH(x, z));
      expect(b.findSpawn()).toEqual(a.findSpawn());
    }
    expect(n).toBe(5 * 7 * 6);
  });
  it('returns independent buffers (the next chunk does not overwrite the previous one)', () => {
    const g = f(9, { type: 'normal' }), a = g.genChunk(0, 0), copy = a.data.slice(); g.genChunk(7, 7); expect(Buffer.compare(Buffer.from(a.data), Buffer.from(copy))).toBe(0);
  });
  it('a corrupt module just yields null so callers fall back to JS', () => { expect(wasmWorldGenFactory(new Uint8Array([0, 1, 2, 3]))).toBeNull(); });
});
