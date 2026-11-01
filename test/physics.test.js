import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { moveBody, overlaps } from '../shared/physics.js';

const mk = (x, y, z, vx = 0, vy = 0, vz = 0) => ({ x, y, z, vx, vy, vz, w: 0.6, h: 1.8, onGround: false });
const floor = (x, y) => y <= 10;                          // solid ground up to y=10
const hash = (x, y, z) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sparse = (x, y, z) => y <= 10 || hash(x, y, z) < 0.18; // random pillars/rubble above the floor

describe('swept-AABB physics (voxel-aabb-sweep)', () => {
  it('never ends up inside solid blocks, whatever the velocity (property)', () => {
    fc.assert(fc.property(fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: 0.004, max: 0.06, noNaN: true }), fc.integer({ min: 0, max: 200 }), (vx, vy, vz, dt, seed) => {
      const b = mk(seed * 0.37 % 40 + 0.5, 11.001, seed * 0.51 % 40 + 0.5, vx, vy, vz); let guard = 0;
      while (overlaps(sparse, b) && guard++ < 40) b.y += 1; // start in free space
      for (let i = 0; i < 8; i++) { moveBody(sparse, b, dt); if (overlaps(sparse, b)) return false; b.vy -= 28 * dt; }
      return true;
    }), { numRuns: 400 });
  });
  it('lands exactly on the floor and reports ground contact', () => {
    const b = mk(5.5, 15, 5.5, 0, -30, 0);
    for (let i = 0; i < 60; i++) { moveBody(floor, b, 1 / 60); b.vy -= 28 / 60; }
    expect(b.y).toBeCloseTo(11, 4); expect(b.onGround).toBe(true);
  });
  it('cannot tunnel through a one-block wall even at 200 blocks/s (property)', () => {
    const wall = (x, y) => y <= 10 || (x === 10 && y <= 14);
    fc.assert(fc.property(fc.double({ min: 40, max: 400, noNaN: true }), fc.double({ min: 0.01, max: 0.08, noNaN: true }), (vx, dt) => {
      const b = mk(5.5, 11, 5.5, vx, 0, 0);
      for (let i = 0; i < 20; i++) { moveBody(wall, b, dt); if (b.x + b.w / 2 > 10 + 1e-6) return false; }
      return true;
    }), { numRuns: 300 });
  });
  it('slides along a wall instead of sticking (anisotropy-free)', () => {
    const wall = (x, y) => y <= 10 || x >= 10;
    const b = mk(9, 11, 5, 5, 0, 5);
    moveBody(wall, b, 0.2);
    expect(b.vx).toBe(0); expect(b.z).toBeGreaterThan(5.9); expect(b.x + 0.3).toBeLessThanOrEqual(10 + 1e-6);
  });
  it('bonks its head on a ceiling', () => {
    const ceil = (x, y) => y <= 10 || y === 14;
    const b = mk(5.5, 11, 5.5, 0, 12, 0); const f = moveBody(ceil, b, 0.2);
    expect(f.ceiling).toBe(true); expect(b.y + b.h).toBeLessThanOrEqual(14 + 1e-6); expect(b.vy).toBe(0);
  });
  it('sneaking stops you walking off a ledge; walking does not', () => {
    const ledge = (x, y) => y <= 10 && x < 10;
    const sneaker = mk(9.2, 11, 5.5), walker = mk(9.2, 11, 5.5); sneaker.onGround = walker.onGround = true;
    for (let i = 0; i < 40; i++) { sneaker.vx = 1.3; walker.vx = 4.5; sneaker.vy = walker.vy = -0.01; moveBody(ledge, sneaker, 1 / 60, { sneak: true }); moveBody(ledge, walker, 1 / 60); }
    expect(sneaker.y).toBeCloseTo(11, 3); expect(sneaker.x).toBeLessThan(10 + 0.3);
    expect(walker.x).toBeGreaterThan(10.3);
  });
  it('terminates for vanishingly small or non-finite velocities (regression: decayed friction froze the sweep)', () => {
    for (const v of [1e-230, -3e-200, 5e-324, 1e-12, NaN, Infinity]) {
      const b = mk(5.5, 11, 5.5, v, 0, v); moveBody(floor, b, 1 / 60); expect(Number.isFinite(b.x) && Number.isFinite(b.z)).toBe(true);
    }
  });
});
