// WebAssembly terrain generator (Rust, wasm/worldgen). Same interface as createWorldGen() and bit-identical output; the JS stays as the
// reference and the fallback (any load/instantiate failure just means "use the JS"). Works in browsers, workers and Node.
import { createWorldGen } from './worldgen.js';
import { CS, CH } from './blocks.js';

const TYPE = { normal: 0, flat: 1, mountains: 2, islands: 3 };
const SIZE = CS * CS * CH;

/** @param {BufferSource|WebAssembly.Module} src compiled module or wasm bytes. Returns (seed, gen) => worldgen, or null if it cannot be instantiated. */
export function wasmWorldGenFactory(src) {
  let inst; try { const mod = src instanceof WebAssembly.Module ? src : new WebAssembly.Module(src); inst = new WebAssembly.Instance(mod, {}); } catch { return null; }
  const x = inst.exports, mem = x.memory;
  return (seed, gen = {}) => {
    const js = createWorldGen(seed, gen), ty = TYPE[gen.type || 'normal'] ?? 0, s = seed | 0;
    return {
      ...js,
      terrainH: (wx, wz) => x.terrain_h(s, ty, wx, wz),
      genChunk(cx, cz) { const maxY = x.gen_chunk(s, ty, cx, cz); return { data: new Uint8Array(mem.buffer, x.out_ptr(), SIZE).slice(), maxY }; },
    };
  };
}
