// Chunk worker: terrain generation + meshing off the main thread.
import { createWorldGen } from '../shared/worldgen.js';
import { meshChunk, transferList } from '../shared/mesher.js';
import { wasmWorldGenFactory } from '../shared/wasmgen.js';
import wasmUrl from '../shared/wasm/worldgen.wasm?url';

// Terrain generation starts on the JS reference and switches to the Rust/WASM build (6x faster, bit-identical) the moment it has loaded.
let wg = null, epoch = 0, wasmFactory = null, wasmTried = false, cur = null;
const loadWasm = () => { if (wasmTried) return; wasmTried = true; fetch(wasmUrl).then(r => r.arrayBuffer()).then(b => { wasmFactory = wasmWorldGenFactory(b); if (wasmFactory && cur) wg = wasmFactory(cur.seed, cur.gen); }).catch(() => {}); };
self.onmessage = e => {
  const m = e.data;
  if (m.t === 'init') { cur = { seed: m.seed, gen: m.gen }; wg = wasmFactory ? wasmFactory(m.seed, m.gen) : createWorldGen(m.seed, m.gen); epoch = m.epoch; loadWasm(); return; }
  if (m.epoch !== epoch || !wg) return;
  if (m.t === 'gen') {
    for (const [cx, cz, ed] of m.list) {
      const { data, maxY } = wg.genChunk(cx, cz); let my = maxY;
      if (ed) for (const k in ed) { data[+k] = ed[k]; my = Math.max(my, Math.floor(k / 256) + 2); }
      self.postMessage({ t: 'gen', cx, cz, data, maxY: Math.min(80, my), epoch }, [data.buffer]);
    }
  } else if (m.t === 'mesh') {
    const r = meshChunk(m.nbrs, m.maxY);
    self.postMessage({ t: 'mesh', cx: m.cx, cz: m.cz, ver: m.ver, mesh: r, epoch }, transferList(r));
  }
};
