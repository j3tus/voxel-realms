import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameWorld } from '../server/world.js';

const hooks = { log() {}, event() {}, motd: () => '', save() {}, worlds: () => [] };
const fakeWs = () => { const sent = []; return { readyState: 1, bufferedAmount: 0, sent, send(s) { if (typeof s === 'string') sent.push(JSON.parse(s)); }, close() {}, terminate() {} }; };
function world(mode, meta = {}) {
  const w = new GameWorld({ id: 't', name: 't', seed: 11, type: mode === 'royale' ? 'normal' : 'flat', mode, economy: false, mobs: ['zombies', 'raid', 'td'].includes(mode), maxPlayers: 16, ...meta }, null, hooks);
  const [sx, , sz] = w.spawn; for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) w.chunk((Math.floor(sx / 16)) + a, (Math.floor(sz / 16)) + b);
  const human = n => { const ws = fakeWs(); return { p: w.join(ws, { name: n, uid: 'u' + n }, '127.0.0.1'), ws }; };
  return { w, human };
}
// the server rate-limits with Date.now(), so advance a fake wall clock in step with the game ticks
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); }); afterEach(() => { vi.useRealTimers(); });
const step = w => { vi.advanceTimersByTime(50); w.tick(); };
const tickFor = (w, s) => { for (let i = 0; i < s * 20; i++) step(w); };
const bots = w => [...w.players.values()].filter(p => p.bot);

describe('bots fill games', () => {
  it('tops a public game up to its target when a human is inside, and stays out of chat and counts', () => {
    const { w, human } = world('pvp'); const a = human('Ann'); tickFor(w, 6);
    expect(bots(w).length).toBe(3); expect(w.players.size).toBe(4); expect(w.humans()).toBe(1); expect(w.info().players).toBe(1);
    expect(a.ws.sent.some(m => m.t === 'chat' && /Bot/.test(m.text || ''))).toBe(false); expect(bots(w)[0].name).toMatch(/^\[Bot\]/);
  });
  it('makes room for real players (a bot leaves for each human) and removes every bot when the last human goes', () => {
    const { w, human } = world('tdm'); const a = human('Ann'); tickFor(w, 8); expect(w.players.size).toBe(6);
    const b = human('Bob'); tickFor(w, 3); expect(w.players.size).toBe(6); expect(bots(w).length).toBe(4);
    w.leave(a.p); w.leave(b.p); tickFor(w, 8); expect(bots(w).length).toBe(0); expect(w.players.size).toBe(0);
  });
  it('does nothing in an empty world, in non-bot modes, or when bots are switched off', () => {
    const e = world('pvp'); tickFor(e.w, 5); expect(e.w.players.size).toBe(0);
    const p = world('parkour'); p.human('A'); tickFor(p.w, 5); expect(bots(p.w).length).toBe(0);
    const off = world('pvp', { bots: 0 }); off.human('A'); tickFor(off.w, 5); expect(bots(off.w).length).toBe(0);
  });
  it('fixed bot counts (private games) stay the same as people join', () => {
    const { w, human } = world('pvp', { bots: 3, botsFixed: true }); human('A'); tickFor(w, 6); expect(bots(w).length).toBe(3); human('B'); tickFor(w, 4); expect(bots(w).length).toBe(3);
  });
  it('team modes put bots on balanced teams', () => {
    const { w, human } = world('tdm'); const a = human('Ann'); tickFor(w, 12); expect(w.mg.state).toBe('play');
    const t = [0, 0]; for (const p of w.players.values()) t[p.mg.team]++; expect(Math.abs(t[0] - t[1])).toBeLessThanOrEqual(1); expect(a.p.mg.team === 0 || a.p.mg.team === 1).toBe(true);
  });
});

describe('bot brains', () => {
  it('a lone player gets a real match: bots start the round, chase and shoot the human, and rack up kills', () => {
    const { w, human } = world('pvp', { botSkill: 'hard' }); const a = human('Ann'); tickFor(w, 12); expect(w.mg.state).toBe('play');
    const start = bots(w).map(b => [b.x, b.z]); let hurt = false, killed = false; a.p.mg.hp = 20;
    for (let i = 0; i < 90 * 20; i++) { step(w); if (a.p.mg.hp < 20) hurt = true; if (a.p.mg.deaths > 0) killed = true; if (w.mg.state !== 'play') break; }
    const moved = bots(w).some((b, i) => start[i] && Math.hypot(b.x - start[i][0], b.z - start[i][1]) > 2);
    expect(moved).toBe(true); expect(hurt || killed).toBe(true); expect(bots(w).reduce((s, b) => s + b.mg.kills + b.mg.deaths, 0)).toBeGreaterThan(0);
  });
  it('bots only shoot enemies: teammates are safe in team deathmatch', () => {
    const { w, human } = world('tdm', { botSkill: 'hard' }); const a = human('Ann'); tickFor(w, 12);
    const mates = bots(w).filter(b => b.mg.team === a.p.mg.team); for (let i = 0; i < 40 * 20; i++) step(w);
    // damage a human takes can only come from the other team's bots
    expect(mates.length).toBeGreaterThan(0); expect(mates.every(m => m.mg.kills >= 0)).toBe(true);
    let friendly = 0; for (const b of mates) for (const q of w.players.values()) if (q !== b && q.mg.team === b.mg.team && q.mg.hp < 20 && q.mg.alive && q.mg.deaths === 0) friendly++; expect(friendly).toBe(0);
  });
  it('co-op modes: bots fight the zombies next to the human', () => {
    const { w, human } = world('zombies', { botSkill: 'hard' }); const a = human('Ann'); a.p.mg && (a.p.mg.hp = 99999); tickFor(w, 10); a.p.mg.hp = 99999;
    for (let i = 0; i < 50 * 20; i++) { step(w); a.p.mg.hp = 99999; }
    expect(bots(w).length).toBe(1); expect(bots(w)[0].mg.kills).toBeGreaterThan(0);
  });
  it('bots respect the lock-out rules: unarmed hiders never fire, a seeker bot hunts and tags hiders', () => {
    const { w, human } = world('hide', { botSkill: 'hard' }); human('Ann'); tickFor(w, 12); expect(w.mg.state).toBe('play');
    for (const b of bots(w)) if (b.id !== w.mg.seeker) expect(b.mg.ammo.every((x, i) => x === [12, 30, 6, 4][i])).toBe(true);
    tickFor(w, 40); for (const b of bots(w)) if (b.id !== w.mg.seeker) expect(b.mg.ammo.every((x, i) => x === [12, 30, 6, 4][i])).toBe(true);
  });
  it('snd attacker bots push for the bomb site (once the defenders are out of the way)', () => {
    const { w, human } = world('snd', { botSkill: 'hard' }); human('Ann'); for (let i = 0; i < 400 && w.mg.state !== 'play'; i++) step(w); const att = bots(w).filter(b => b.mg.team === 0 && b.mg.alive);
    for (const q of w.players.values()) if (q.mg.team === 1) q.mg.alive = false; // no defenders: the attackers should simply walk to the site
    let near = false; for (let i = 0; i < 40 * 20 && !near; i++) { step(w); near = att.length > 0 && att.some(b => Math.hypot(b.x - w.mg.site[0], b.z - w.mg.site[2]) < 6); }
    expect(att.length).toBeGreaterThan(0); expect(near).toBe(true);
  });
});

describe('private games', () => {
  const hk = (log) => ({ ...hooks, createGame: o => { log.push(o); return o.mode === 'bogus' ? { error: 'Unknown mode.' } : { id: 'g1ab2', name: `${o.owner.name}'s game`, bots: +o.bots }; }, worlds: () => [{ id: 'g1ab2', name: 'x', mode: 'pvp', players: 1, max: 16 }, { id: 'full', name: 'f', mode: 'pvp', players: 16, max: 16 }, { id: 'lobby', name: 'Lobby', mode: 'lobby', players: 0, max: 40 }] });
  it('/create sends the creator (and party) into the new game; /join checks codes and capacity', () => {
    const log = []; const w = new GameWorld({ id: 'lobby', name: 'Lobby', seed: 1, type: 'flat', mode: 'creative', economy: false, mobs: false }, null, hk(log)); const ws = fakeWs(); const p = w.join(ws, { name: 'Ann', uid: 'a' }, '1.1.1.1');
    w.handle(p, { t: 'chat', text: '/create tdm 5 hard' }); expect(log[0]).toMatchObject({ mode: 'tdm', bots: 5, skill: 'hard' }); expect([...ws.sent].reverse().find(m => m.t === 'transfer')).toMatchObject({ world: 'g1ab2' });
    ws.sent.length = 0; w.handle(p, { t: 'chat', text: '/create bogus' }); expect(ws.sent.some(m => m.t === 'transfer')).toBe(false); expect([...ws.sent].reverse().find(m => m.t === 'chat').text).toMatch(/Unknown mode/);
    ws.sent.length = 0; w.handle(p, { t: 'chat', text: '/join g1ab2' }); expect(ws.sent.find(m => m.t === 'transfer')).toMatchObject({ world: 'g1ab2' });
    ws.sent.length = 0; w.handle(p, { t: 'chat', text: '/join full' }); expect(ws.sent.some(m => m.t === 'transfer')).toBe(false); expect(ws.sent.find(m => m.t === 'chat').text).toMatch(/full/);
    ws.sent.length = 0; w.handle(p, { t: 'chat', text: '/join nope' }); expect(ws.sent.find(m => m.t === 'chat').text).toMatch(/No game/);
  });
});
