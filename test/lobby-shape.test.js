import { describe, it, expect } from 'vitest';
import { GameWorld } from '../server/world.js';

const hooks = { log() {}, event() {}, motd: () => '', save() {}, worlds: () => [] };
const mk = () => { const w = new GameWorld({ id: 'l', name: 'l', seed: 5, type: 'flat', mode: 'lobby', economy: false, mobs: false, bots: 0 }, null, hooks); const [sx, , sz] = w.spawn; for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) w.chunk(Math.floor(sx / 16) + a, Math.floor(sz / 16) + b); w.mg.build(); return w.mg; };

describe('lobby hall', () => {
  it('portal arches are rounded: opening is air when open, solid when shut, top corners are cut', () => {
    const m = mk(), sl = m.slots[0], at = (u, h) => m.w.getB(sl.x + (sl.ax === 'x' ? u : 0), m.gy + h, sl.z + (sl.ax === 'z' ? u : 0));
    expect(at(0, 1)).not.toBe(0); m.frame(sl, true);
    for (let u = -1; u <= 1; u++) for (let h = 0; h <= 2; h++) expect(at(u, h)).toBe(0);
    expect(at(0, 3)).toBe(0); expect(at(1, 3)).not.toBe(0); expect(at(2, 4)).toBe(0); expect(at(0, 5)).not.toBe(0); expect(at(2, 2)).not.toBe(0);
  });
  it('spawns and every portal approach are open ground', () => {
    const m = mk();
    for (let i = 0; i < 60; i++) { const [x, y, z] = m.spawnPoint(i); expect(m.w.getB(Math.floor(x), Math.floor(y), Math.floor(z))).toBe(0); expect(m.w.getB(Math.floor(x), Math.floor(y) - 1, Math.floor(z))).not.toBe(0); }
    for (const sl of m.slots) { m.frame(sl, true); expect(m.w.getB(sl.x, m.gy, sl.z)).toBe(0); expect(m.w.getB(sl.x, m.gy - 1, sl.z)).not.toBe(0); }
  });
});
