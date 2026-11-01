import { describe, it, expect } from 'vitest';
import { ChunkPool } from '../server/chunkpool.js';
import { createWorldGen } from '../shared/worldgen.js';
import { GameWorld } from '../server/world.js';

describe('chunk pool', () => {
  it('generates exactly what the main thread would', async () => {
    const pool = new ChunkPool(1);
    try {
      for (const [seed, type, cx, cz] of [[7, 'normal', 0, 0], [7, 'normal', -3, 5], [99, 'flat', 2, 2], [12345, 'normal', 10, -8]]) {
        const a = await pool.request(seed, type, cx, cz), b = createWorldGen(seed, { type }).genChunk(cx, cz);
        expect(a.maxY).toBe(b.maxY); expect(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data))).toBe(0);
      }
      expect(pool.stats().done).toBe(4);
    } finally { pool.close(); }
  });
  it('world streams outer chunks through the pool, keeps the own chunk synchronous and applies saved edits', async () => {
    const pool = new ChunkPool(1);
    try {
      const hooks = { log() {}, event() {}, motd: () => '', save() {}, worlds: () => [], chunkPool: pool };
      const w = new GameWorld({ id: 'p', name: 'p', seed: 5, type: 'normal', mode: 'creative', economy: false, mobs: false, bots: 0 }, { ce: new Map([['4,0', new Map([[5 + 16 * (3 + 16 * 70), 7]])]]) }, hooks);
      w.players.set(1, { id: 1, x: 8, y: 80, z: 8, bot: false });
      w.ensureChunks();
      expect(w.chunks.has('0,0')).toBe(true);
      expect(w.chunks.has('4,0')).toBe(false);
      for (let i = 0; i < 60 && !w.chunks.has('4,0'); i++) { await new Promise(r => setTimeout(r, 50)); w.ensureChunks(); } // budgeted: a few rings per call, like every 10th tick
      for (let i = 0; i < 20 && w.chunks.size < 41; i++) { await new Promise(r => setTimeout(r, 50)); w.ensureChunks(); }
      expect(w.chunks.has('4,0')).toBe(true); expect(w.chunks.get('4,0').data[5 + 16 * (3 + 16 * 70)]).toBe(7);
      expect(w.chunks.size).toBeGreaterThan(40);
    } finally { pool.close(); }
  });
  it('falls back to synchronous generation when the pool is broken', () => {
    const pool = new ChunkPool(1); pool.fail(); pool.close();
    const hooks = { log() {}, event() {}, motd: () => '', save() {}, worlds: () => [], chunkPool: pool };
    const w = new GameWorld({ id: 'q', name: 'q', seed: 5, type: 'normal', mode: 'creative', economy: false, mobs: false, bots: 0 }, null, hooks);
    w.players.set(1, { id: 1, x: 8, y: 80, z: 8, bot: false }); w.ensureChunks(); expect(w.chunks.size).toBeGreaterThanOrEqual(6);
  });
});
