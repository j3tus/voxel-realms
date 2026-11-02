import { describe, it, expect } from 'vitest';
import { rayBlocks, rayBox } from '../shared/weapons.js';

const solidAt = (bx, by, bz) => (x, y, z) => (x === bx && y === by && z === bz ? 1 : 0);

describe('rayBlocks (voxel traversal)', () => {
  it('hits a block straight ahead at the right distance', () => {
    expect(rayBlocks(solidAt(5, 0, 0), 0.5, 0.5, 0.5, 1, 0, 0, 20)).toBeCloseTo(4.5, 5);
  });
  it('returns max when nothing is in range', () => {
    expect(rayBlocks(solidAt(50, 0, 0), 0.5, 0.5, 0.5, 1, 0, 0, 20)).toBe(20);
  });
  it('does not tunnel through a block on a diagonal ray', () => {
    const d = Math.hypot(1, 1, 1);
    expect(rayBlocks(solidAt(3, 3, 3), 0.01, 0.01, 0.01, 1 / d, 1 / d, 1 / d, 30)).toBeLessThan(30);
  });
  it('works in negative directions', () => {
    expect(rayBlocks(solidAt(-4, 0, 0), 0.5, 0.5, 0.5, -1, 0, 0, 20)).toBeCloseTo(3.5, 5);
  });
});

describe('rayBox', () => {
  it('hits and misses', () => {
    expect(rayBox(0, 0.5, 0.5, 1, 0, 0, 3, 0, 0, 4, 1, 1)).toBeCloseTo(3);
    expect(rayBox(0, 5, 0.5, 1, 0, 0, 3, 0, 0, 4, 1, 1)).toBe(-1);
    expect(rayBox(0, 0.5, 0.5, -1, 0, 0, 3, 0, 0, 4, 1, 1)).toBe(-1);
  });
});
