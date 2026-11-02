import { describe, it, expect } from 'vitest';
import { encodeState, decodeState, NF_ENTITY } from '../shared/netframe.js';

const dv = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
describe('compact state frame', () => {
  it('round-trips positions within 1/32 block, including negative and far-from-origin coordinates', () => {
    for (const [cx, cz] of [[0, 0], [-300.7, 512.2], [100000.4, -99999.9]]) {
      const P = [{ id: 7, x: cx + 120.3, y: 41.5, z: cz - 88.123, yaw: -3141, pitch: 1500, st: 3 }, { id: 65535, x: cx - 190, y: 0.03, z: cz + 190, yaw: 12, pitch: -3000, st: 0 }];
      const M = [{ id: 9, type: 4, x: cx + 50.5, y: 63.9, z: cz - 12.25, yaw: 800, hp: 100, flags: 3 }];
      const out = decodeState(dv(encodeState(cx, cz, P, M)));
      expect(out.players).toHaveLength(2); expect(out.mobs).toHaveLength(1);
      for (let i = 0; i < 2; i++) { const a = P[i], b = out.players[i]; expect(b.id).toBe(a.id); expect(Math.abs(b.x - a.x)).toBeLessThan(1 / 32); expect(Math.abs(b.y - a.y)).toBeLessThan(1 / 32); expect(Math.abs(b.z - a.z)).toBeLessThan(1 / 32); expect(b.yaw).toBeCloseTo(a.yaw / 1000, 5); expect(b.st).toBe(a.st); }
      expect(out.mobs[0]).toMatchObject({ id: 9, type: 4, hp: 100, flags: 3 }); expect(Math.abs(out.mobs[0].x - M[0].x)).toBeLessThan(1 / 32);
    }
  });
  it('is 13 bytes per entity (vs 19) and handles empty frames', () => {
    expect(NF_ENTITY).toBe(13);
    expect(encodeState(0, 0, [], []).length).toBe(13);
    expect(encodeState(0, 0, new Array(40).fill({ id: 1, x: 1, y: 1, z: 1, yaw: 0, pitch: 0, st: 0 }), []).length).toBe(13 + 40 * 13);
  });
});
