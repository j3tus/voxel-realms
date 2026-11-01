import { describe, it, expect } from 'vitest';
import { computeCapacity, memLimit, COST } from '../server/capacity.js';

const healthy = { tickMs: 2, lagP99: 3, rss: 200e6, memLimit: 4e9, cpu: 20, cores: 4 };
describe('capacity governor', () => {
  it('has plenty of room on a healthy, empty server', () => {
    const c = computeCapacity(healthy, []); expect(c.level).toBe('ok'); expect(c.free).toBe(c.budget); expect(c.maxRoom).toBeGreaterThanOrEqual(16); expect(c.botDensity).toBe(1);
  });
  it('counts humans as 1 slot, bots as less, sleeping rooms as almost nothing', () => {
    const c = computeCapacity(healthy, [{ humans: 4, bots: 4, mode: 'tdm' }, { idle: true }, { idle: true }]);
    expect(c.used).toBeCloseTo(4 * COST.human + 4 * COST.bot + 2 * COST.room, 5);
  });
  it('shrinks the budget when ticks run long, lag spikes, memory or CPU run hot', () => {
    const base = computeCapacity(healthy, []).budget;
    for (const [k, v] of [['tickMs', 40], ['lagP99', 90], ['rss', 3.6e9], ['cpu', 380]]) { const c = computeCapacity({ ...healthy, [k]: v }, []); expect(c.budget).toBeLessThan(base); expect(c.reasons.length).toBeGreaterThan(0); }
  });
  it('turns full under heavy load and refuses new rooms', () => {
    const rooms = Array.from({ length: 6 }, () => ({ humans: 6, bots: 4, mode: 'tdm' }));
    const c = computeCapacity(healthy, rooms); expect(c.level).toBe('full'); expect(c.canOpen(8, 2)).toBe(false); expect(c.botDensity).toBeLessThan(.5);
  });
  it('lets custom games grow into what is left', () => {
    const a = computeCapacity(healthy, [{ humans: 10, bots: 0, mode: 'pvp' }]).maxRoom, b = computeCapacity(healthy, [{ humans: 30, bots: 0, mode: 'pvp' }]).maxRoom;
    expect(b).toBeLessThan(a); expect(a).toBeLessThanOrEqual(16);
  });
  it('reads memory limits from env, then cgroup, then a share of RAM', () => {
    expect(memLimit({ VR_MEM_MB: '2048' })).toBe(2048 * 1048576);
    expect(memLimit({}, () => '5368709120\n', 8e9)).toBe(5368709120);
    expect(memLimit({}, () => 'max\n', 8e9)).toBe(8e9 * .6);
    expect(memLimit({}, () => { throw new Error('none'); }, 8e9)).toBe(8e9 * .6);
  });
});
