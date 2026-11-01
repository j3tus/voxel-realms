// Micro-benchmarks of the hot shared code paths (what the worker / server run every frame or tick).
import { createWorldGen } from '../shared/worldgen.js';
import { meshChunk } from '../shared/mesher.js';
import { MobSim } from '../shared/mobs.js';
import { performance } from 'node:perf_hooks';
const wg = createWorldGen(1234, {}), time = (n, f) => { const t = performance.now(); for (let i = 0; i < n; i++) f(i); return (performance.now() - t) / n; };
const chunks = new Map(); const key = (x, z) => x + ',' + z;
const gen = time(100, i => { const x = i % 10, z = (i / 10) | 0; chunks.set(key(x, z), wg.genChunk(x, z)); });
const nb = (x, z) => { const a = []; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) a.push(chunks.get(key(x + dx, z + dz))?.data ?? null); return a; };
let tris = 0; const mesh = time(64, i => { const x = 1 + (i % 8), z = 1 + ((i / 8) | 0), c = chunks.get(key(x, z)), m = meshChunk(nb(x, z), c.maxY); for (const g of [m.O, m.T, m.W]) if (g) tris += g.idx.length / 3; });
// light-heavy chunk (glowstone present)
const lampChunk = chunks.get(key(4, 4)); lampChunk.data[8 + 16 * (8 + 16 * 40)] = 28; const lamp = time(16, () => meshChunk(nb(4, 4), 60));
const sim = new MobSim({ getB: (x, y, z) => { const c = chunks.get(key(x >> 4, z >> 4)); return c && y >= 0 && y < 80 ? c.data[(x & 15) + 16 * ((z & 15) + 16 * y)] : 3; }, hasChunk: (x, z) => chunks.has(key(x, z)) }, {});
for (let i = 0; i < 40; i++) sim.spawn(i % 3 ? 'pig' : 'zombie', 40 + i * 2, 40, 40 + (i % 5) * 3);
const tick = time(2000, () => sim.update(.05, [{ id: 1, x: 60, y: 30, z: 60 }], { night: true, sunElev: -.5 }));
const snap = time(5000, () => sim.snapshot());
console.log(`terrain gen   : ${gen.toFixed(2)} ms / chunk (worker)`);
console.log(`mesh          : ${mesh.toFixed(2)} ms / chunk avg, ${(tris / 64 | 0)} tris/chunk (worker; edits rebuild 1 chunk on the main thread)`);
console.log(`mesh + light  : ${lamp.toFixed(2)} ms / chunk with a glowstone flood-fill`);
console.log(`NPC sim tick  : ${tick.toFixed(3)} ms for ${sim.mobs.size} mobs @20Hz (${(tick / 50 * 100).toFixed(1)}% of tick budget)`);
console.log(`NPC snapshot  : ${snap.toFixed(4)} ms`);
