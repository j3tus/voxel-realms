// Terrain generation off the main thread. The tick loop never waits on noise: world.ensureChunks() asks the pool for chunks around players,
// the result arrives a few ms later as a transferred typed array and is installed between ticks. Sync generation (world.chunk) remains for
// the places that need a chunk right now (spawn, arena builds, block edits); if the pool fails, the world falls back to it.
import { Worker } from 'node:worker_threads';

const WORKER_SRC = `
import { parentPort } from 'node:worker_threads';
import { makeWorldGen } from ${JSON.stringify(new URL('./gen.js', import.meta.url).href)};
const gens = new Map();
parentPort.on('message', m => {
  const key = m.seed + '|' + m.type; let g = gens.get(key); if (!g) { g = makeWorldGen(m.seed, { type: m.type }); gens.set(key, g); if (gens.size > 24) gens.delete(gens.keys().next().value); }
  const t = performance.now(), { data, maxY } = g.genChunk(m.cx, m.cz);
  const buf = data.buffer.byteLength === data.byteLength ? data.buffer : data.slice().buffer;
  parentPort.postMessage({ id: m.id, buf, maxY, ms: performance.now() - t }, [buf]);
});
`;

export class ChunkPool {
  constructor(n = 1) {
    this.workers = []; this.pending = new Map(); this.seq = 1; this.rr = 0; this.broken = false; this.done = 0; this.genMs = 0;
    for (let i = 0; i < n; i++) this.spawn();
  }
  spawn() {
    const w = new Worker(WORKER_SRC, { eval: true, type: 'module' });
    w.on('message', m => { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); this.done++; this.genMs += m.ms; p.resolve({ data: new Uint8Array(m.buf), maxY: m.maxY }); });
    w.on('error', () => this.fail()); w.on('exit', () => this.fail());
    w.unref(); this.workers.push(w);
  }
  fail() { this.broken = true; for (const p of this.pending.values()) p.resolve(null); this.pending.clear(); }
  /** resolves with {data,maxY}, or null if the pool is broken (caller falls back to synchronous generation) */
  request(seed, type, cx, cz) {
    if (this.broken) return Promise.resolve(null);
    return new Promise(resolve => { const id = this.seq++; this.pending.set(id, { resolve }); this.workers[this.rr++ % this.workers.length].postMessage({ id, seed, type, cx, cz }); });
  }
  stats() { return { workers: this.workers.length, inflight: this.pending.size, done: this.done, avgMs: this.done ? +(this.genMs / this.done).toFixed(2) : 0, broken: this.broken }; }
  close() { for (const w of this.workers) w.terminate(); }
}
