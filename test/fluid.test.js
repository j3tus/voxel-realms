import { describe, it, expect } from 'vitest';
import { Fluid, isWater, waterLevel, FLOW0 } from '../shared/fluid.js';
const mk = () => {
  const m = new Map(); const get = (x, y, z) => y < 0 ? 3 : (m.get(x + ',' + y + ',' + z) ?? (y === 0 ? 3 : 0));
  const f = new Fluid(get, (x, y, z, id) => m.set(x + ',' + y + ',' + z, id));
  const run = () => { for (let i = 0; i < 200 && f.step(); i++); };
  return { m, get, f, run, put: (x, y, z, id) => { m.set(x + ',' + y + ',' + z, id); f.poke(x, y, z); } };
};
describe('fluid', () => {
  it('spreads horizontally and decays to level 1', () => {
    const t = mk(); t.put(0, 1, 0, 7); t.run();
    expect(waterLevel(t.get(1, 1, 0))).toBe(7); expect(waterLevel(t.get(7, 1, 0))).toBe(1); expect(t.get(8, 1, 0)).toBe(0);
  });
  it('falls down a hole', () => {
    const t = mk(); t.m.set('1,0,0', 0); t.m.set('1,-1,0', 3); t.put(0, 1, 0, 7); t.run();
    expect(isWater(t.get(1, 0, 0))).toBe(true);
  });
  it('retracts when the source is removed', () => {
    const t = mk(); t.put(0, 1, 0, 7); t.run(); t.put(0, 1, 0, 0); t.run();
    for (let x = -8; x <= 8; x++) expect(isWater(t.get(x, 1, 0))).toBe(false);
  });
  it('does not flood without bound', () => {
    const t = mk(); t.put(0, 1, 0, 7); t.run(); expect(t.m.size).toBeLessThan(300);
  });
  it('waterfall: source over a drop falls and spreads on the floor', () => {
    const t = mk(); t.put(0, 4, 0, 7); t.run();
    for (let y = 1; y <= 3; y++) expect(isWater(t.get(0, y, 0))).toBe(true);
    expect(isWater(t.get(1, 1, 0))).toBe(true);
  });
  it('waterfall retracts fully when the source is removed', () => {
    const t = mk(); t.put(0, 4, 0, 7); t.run(); t.put(0, 4, 0, 0); t.run();
    for (let y = 1; y <= 4; y++) for (let x = -8; x <= 8; x++) expect(isWater(t.get(x, y, 0))).toBe(false);
  });
  it('walls block flow', () => {
    const t = mk(); t.put(2, 1, 0, 3); t.put(0, 1, 0, 7); t.run();
    expect(isWater(t.get(1, 1, 0))).toBe(true); expect(t.get(2, 1, 0)).toBe(3); expect(waterLevel(t.get(3, 1, 0))).toBeLessThan(waterLevel(t.get(1, 1, 0)));
  });
  it('removing one of two sources keeps the other flowing', () => {
    const t = mk(); t.put(0, 1, 0, 7); t.put(6, 1, 0, 7); t.run(); t.put(0, 1, 0, 0); t.run();
    expect(waterLevel(t.get(5, 1, 0))).toBe(7); expect(isWater(t.get(-3, 1, 0))).toBe(false);
  });
  it('never overwrites sources', () => {
    const t = mk(); t.put(0, 1, 0, 7); t.put(2, 1, 0, 7); t.run();
    expect(t.get(0, 1, 0)).toBe(7); expect(t.get(2, 1, 0)).toBe(7);
  });
  it('is stable: a settled pool produces no more changes', () => {
    const t = mk(); t.put(0, 1, 0, 7); t.run(); const snap = JSON.stringify([...t.m]); t.f.poke(0, 1, 0); t.run();
    expect(JSON.stringify([...t.m])).toBe(snap);
  });
});
