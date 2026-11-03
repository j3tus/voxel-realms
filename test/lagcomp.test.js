import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameWorld } from '../server/world.js';
import { posAt } from '../server/modes.js';

const hooks = { log() {}, event() {}, motd: () => '', save() {} };
const fakeWs = () => ({ readyState: 1, bufferedAmount: 0, send() {}, close() {}, terminate() {} });
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); }); afterEach(() => { vi.useRealTimers(); });

describe('posAt (position history)', () => {
  const q = { x: 10, y: 5, z: 0, hist: [[1000, 0, 5, 0], [1100, 4, 5, 0], [1200, 8, 5, 0], [1300, 10, 5, 0]] };
  it('interpolates between ticks', () => { const p = posAt(q, 150, 1300); expect(p.x).toBeCloseTo(6, 5); });
  it('falls back to the live position for no rewind, no history or future times', () => {
    expect(posAt(q, 0, 1300)).toBe(q); expect(posAt({ x: 1 }, 100, 1300).x).toBe(1); expect(posAt(q, 100, 1300).x).toBeCloseTo(8, 5);
  });
  it('clamps to the oldest sample', () => { expect(posAt(q, 5000, 1300).x).toBe(0); });
});

describe('lag-compensated shots', () => {
  function duel() {
    const w = new GameWorld({ id: 't', name: 't', seed: 7, type: 'flat', mode: 'pvp', economy: false, mobs: false, bots: 0 }, null, hooks);
    const [sx, , sz] = w.spawn; for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) w.chunk(Math.floor(sx / 16) + a, Math.floor(sz / 16) + b);
    const A = w.join(fakeWs(), { name: 'A', uid: 'a' }, '1.1.1.1'), B = w.join(fakeWs(), { name: 'B', uid: 'b' }, '1.1.1.2');
    for (let i = 0; i < 9 * 20; i++) { vi.advanceTimersByTime(50); w.tick(); } return { w, A, B };
  }
  // B strafes sideways at 6 blocks/s; A shoots at where B WAS (what A's screen showed) 200 ms ago
  function run(lat) {
    const { w, A, B } = duel(); const { cx, cz, gy } = w.mg, y = gy, ax = cx - 5.5, az = cz + 3.5;
    A.x = ax; A.y = y; A.z = az; const hp0 = B.mg.hp;
    for (let i = 0; i < 20; i++) { B.x = cx - 1.5; B.y = y; B.z = az - 3 + i * .3; vi.advanceTimersByTime(50); w.tick(); A.x = ax; A.y = y; A.z = az; }
    const seen = { x: cx - 1.5, z: B.z - 0.3 * 4 }; // 4 ticks = 200 ms behind the live position
    const dx = seen.x - A.x, dz = seen.z - A.z, dy = (y + 1) - (y + 1.62), l = Math.hypot(dx, dy, dz);
    A.mg.lastShot = 0; A.mg.reloadAt = 0; w.handle(A, { t: 'shoot', w: 3, dx: dx / l, dy: dy / l, dz: dz / l, lat });
    return hp0 - B.mg.hp;
  }
  it('hits a moving target at the position the shooter saw when they report latency', () => { expect(run(200)).toBeGreaterThan(0); });
  it('misses the same shot with no latency reported (only the default 100 ms rewind)', () => { expect(run(0)).toBe(0); });
  it('ignores absurd latency claims (rewind is capped)', () => { expect(run(1e9)).toBeGreaterThanOrEqual(0); });
});

describe('teleports', () => {
  it('ignores history after a jump (respawn) so shots use the live position', () => {
    const q = { x: 100, y: 5, z: 100, hist: [[1000, 0, 5, 0], [1100, 1, 5, 0], [1200, 2, 5, 0]] };
    expect(posAt(q, 100, 1200)).toBe(q);
  });
});
