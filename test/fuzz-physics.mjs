// Fuzzer for shared/physics.js: runs random swept moves in a worker and reports the exact input if the sweep ever stops making progress.
//   node test/fuzz-physics.mjs [seconds]
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { moveBody, overlaps } from '../shared/physics.js';

const hash = (x, y, z) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sparse = (x, y, z) => y <= 10 || hash(x, y, z) < 0.18;

if (isMainThread) {
  const secs = +process.argv[2] || 10, counter = new Int32Array(new SharedArrayBuffer(4)), info = new Uint8Array(new SharedArrayBuffer(512));
  new Worker(new URL(import.meta.url), { workerData: { counter, info } });
  let last = -1, stuck = 0; const t0 = Date.now();
  setInterval(() => {
    const c = Atomics.load(counter, 0);
    if (c === last) { if (++stuck >= 3) { const txt = new TextDecoder().decode(info.slice(0, info.indexOf(0))); console.log(`HANG after ${c} moves. Input: ${txt}`); process.exit(1); } } else { stuck = 0; last = c; }
    if (Date.now() - t0 > secs * 1000) { console.log(`no hang in ${last} moves`); process.exit(0); }
  }, 500);
} else {
  const { counter, info } = workerData, enc = new TextEncoder();
  const fc = (await import('fast-check')).default;
  fc.assert(fc.property(fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: 0.004, max: 0.06, noNaN: true }), fc.integer({ min: 0, max: 200 }), (vx, vy, vz, dt, seed) => {
    const b = { x: seed * 0.37 % 40 + 0.5, y: 11.001, z: seed * 0.51 % 40 + 0.5, vx, vy, vz, w: 0.6, h: 1.8, onGround: false };
    let g = 0; while (overlaps(sparse, b) && g++ < 40) b.y += 1;
    for (let i = 0; i < 8; i++) {
      const bytes = enc.encode(JSON.stringify({ dt, b })); info.fill(0); info.set(bytes.slice(0, 500));
      moveBody(sparse, b, dt); b.vy -= 28 * dt; Atomics.add(counter, 0, 1);
    }
    return true;
  }), { numRuns: 100000 });
}
