import { describe, it, expect } from 'vitest';
import { computeCapacity } from '../server/capacity.js';
import { planAutoRooms, roomSpec, fitCustomGame } from '../server/rooms.js';

const ok = { tickMs: 2, lagP99: 3, rss: 2e8, memLimit: 4e9, cpu: 20, cores: 4 };
const cap = (rooms = []) => computeCapacity(ok, rooms);
const base = (mode, humans, max = 16, extra = {}) => ({ id: mode, mode, humans, max, source: 'base', idleMs: 0, ...extra });

describe('automatic rooms', () => {
  it('opens nothing for an empty or comfortable game', () => {
    expect(planAutoRooms([base('tdm', 0)], cap()).open).toEqual([]);
    expect(planAutoRooms([base('tdm', 4)], cap()).open).toEqual([]);          // 25% full: seats are plentiful
  });
  it('opens an extra room once every room of a mode is mostly full', () => {
    const r = [base('tdm', 11)], p = planAutoRooms(r, cap(r)); expect(p.open).toHaveLength(1); expect(p.open[0].mode).toBe('tdm'); expect(p.open[0].players).toBe(8);
  });
  it('does not open while another room still has space', () => {
    const r = [base('tdm', 14), { id: 'a1', mode: 'tdm', humans: 2, max: 8, source: 'auto', idleMs: 0 }]; expect(planAutoRooms(r, cap(r)).open).toEqual([]);
  });
  it('caps extra rooms per mode and alternates sizes', () => {
    expect(roomSpec(0, cap()).players).toBe(8); expect(roomSpec(1, cap()).players).toBe(16);
    const autos = [1, 2, 3].map(i => ({ id: 'a' + i, mode: 'tdm', humans: 8, max: 8, source: 'auto', idleMs: 0 }));
    const r = [base('tdm', 16), ...autos]; expect(planAutoRooms(r, cap(r)).open).toEqual([]);
  });
  it('never opens a room the server cannot carry', () => {
    const busy = [base('pvp', 14), base('tdm', 16), base('ctf', 16), base('zombies', 16), base('snd', 16)], c = computeCapacity({ ...ok, tickMs: 45, cpu: 380 }, busy);
    expect(planAutoRooms(busy, c).open).toEqual([]);
  });
  it('shrinks automatic rooms and their bots as capacity shrinks', () => {
    const small = roomSpec(1, { maxRoom: 6, botDensity: .4 }); expect(small.players).toBe(6); expect(small.bots).toBeLessThanOrEqual(2);
  });
  it('closes empty automatic rooms after a grace period, or at once when full', () => {
    const r = [base('tdm', 3), { id: 'a1', mode: 'tdm', humans: 0, max: 8, source: 'auto', idleMs: 130000 }, { id: 'a2', mode: 'tdm', humans: 0, max: 8, source: 'auto', idleMs: 10000 }];
    expect(planAutoRooms(r, cap(r)).close).toEqual(['a1']);
    const full = computeCapacity({ ...ok, tickMs: 50, lagP99: 120, cpu: 400 }, r); expect(full.level).toBe('full');
    expect(planAutoRooms(r, full).close.sort()).toEqual(['a1', 'a2']);
  });
  it('never closes pinned (admin) rooms or rooms with people in them', () => {
    const r = [base('tdm', 3), { id: 'x', mode: 'tdm', humans: 0, max: 8, source: 'auto', idleMs: 999999, pinned: true }, { id: 'y', mode: 'tdm', humans: 2, max: 8, source: 'auto', idleMs: 999999 }];
    expect(planAutoRooms(r, cap(r)).close).toEqual([]);
  });
});

describe('player custom games', () => {
  it('fits a request to the capacity that is left', () => {
    const r = fitCustomGame({ players: 16, bots: 8 }, cap()); expect(r.players).toBe(16);
    const tight = computeCapacity(ok, [{ humans: 24, bots: 0, mode: 'pvp' }]), t = fitCustomGame({ players: 16, bots: 6 }, tight);
    expect(t.players ?? 0).toBeLessThanOrEqual(tight.maxRoom);
  });
  it('refuses cleanly when the server is full', () => {
    const rooms = Array.from({ length: 8 }, () => ({ humans: 8, bots: 4, mode: 'tdm' })), full = computeCapacity(ok, rooms);
    expect(fitCustomGame({ players: 8, bots: 2 }, full).error).toMatch(/capacity/i);
  });
  it('lets admins exceed the normal limits', () => { expect(fitCustomGame({ players: 24, bots: 10 }, cap(), { force: true }).players).toBe(24); });
  it('keeps bots below the player count', () => { expect(fitCustomGame({ players: 4, bots: 20 }, cap()).bots).toBeLessThanOrEqual(3); });
});
