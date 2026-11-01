import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameWorld } from '../server/world.js';

const cfg = { enabled: true, skill: 'normal', density: 1, capDensity: 1 };
const rooms = [{ id: 'r1', name: 'Team Deathmatch #2', mode: 'tdm', players: 3, bots: 2, max: 16, state: 'lobby', time: 0, source: 'auto' }, { id: 'full', name: 'Gun Arena', mode: 'pvp', players: 16, bots: 0, max: 16, state: 'play', time: 90, source: 'base' }];
const hooks = { log() {}, event() {}, motd: () => '', save() {}, worlds: () => [], botsCfg: () => cfg, rooms: () => rooms, capacity: () => ({ level: 'ok', maxRoom: 12, free: 20, used: 4, budget: 24, scale: 1, reasons: [], botDensity: 1 }) };
const fakeWs = () => { const sent = []; return { readyState: 1, bufferedAmount: 0, sent, send(s) { if (typeof s === 'string') sent.push(JSON.parse(s)); }, close() {}, terminate() {} }; };
function world(mode, meta = {}) {
  const w = new GameWorld({ id: 't', name: 't', seed: 11, type: 'flat', mode, economy: false, mobs: false, maxPlayers: 16, ...meta }, null, hooks);
  const [sx, , sz] = w.spawn; for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) w.chunk(Math.floor(sx / 16) + a, Math.floor(sz / 16) + b);
  const human = (n, op = false) => { const ws = fakeWs(), p = w.join(ws, { name: n, uid: 'u' + n }, '127.0.0.1'); p.op = op; return { p, ws }; };
  return { w, human };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); }); afterEach(() => { vi.useRealTimers(); });
const step = w => { vi.advanceTimersByTime(50); w.tick(); };
const tickFor = (w, s) => { for (let i = 0; i < s * 20; i++) step(w); };
const bots = w => [...w.players.values()].filter(p => p.bot);
const lastChat = ws => [...ws.sent].reverse().find(m => m.t === 'chat')?.text || '';

describe('idle worlds', () => {
  it('drop their bots at once and reset the match when the last human leaves', () => {
    const { w, human } = world('tdm'); const a = human('Ann'); tickFor(w, 8); expect(bots(w).length).toBeGreaterThan(0); w.mg.state = 'play';
    w.leave(a.p); step(w); expect(bots(w).length).toBe(0); tickFor(w, 3); expect(w.idle).toBe(true); expect(w.mg.state).toBe('lobby');
  });
  it('tick at 1 Hz while idle (cheap) and wake instantly for a visitor', () => {
    const { w, human } = world('pvp'); const t0 = w.time; for (let i = 0; i < 19; i++) step(w); expect(w.time).toBe(t0); step(w); expect(w.time).not.toBe(t0);
    human('Bo'); expect(w.idle).toBe(false);
  });
  it('stay awake for summoned bots, then idle again once they are gone', () => {
    const { w, human } = world('tdm'); const a = human('Ann', true); tickFor(w, 2); w.command(a.p, '/bot add 2'); w.leave(a.p); tickFor(w, 2);
    expect(bots(w).length).toBe(2); expect(w.idle).toBe(false); w.command(null, '/bot clear'); step(w); expect(w.idle).toBe(true);
  });
});

describe('bot commands', () => {
  it('only operators may summon, and summoned bots survive the automatic top-up', () => {
    const { w, human } = world('tdm'); const op = human('Op', true), pl = human('Pl'); tickFor(w, 8);
    w.command(pl.p, '/bot add 3'); expect(lastChat(pl.ws)).toMatch(/operator/i);
    const before = bots(w).length; w.command(op.p, '/bot add 3 hard Dummy'); tickFor(w, 4);
    expect(bots(w).length).toBe(before + 3); const s = bots(w).filter(b => b.summoned); expect(s).toHaveLength(3); expect(s[0].name).toMatch(/Dummy/); expect(s[0].botSkill).toBe('hard');
  });
  it('/bot count fixes the fill, /bot pause removes automatic bots only, /bot clear removes all', () => {
    const { w, human } = world('tdm'); const op = human('Op', true); tickFor(w, 8);
    w.command(op.p, '/bot count 2'); tickFor(w, 8); expect(bots(w).length).toBe(2);
    w.command(op.p, '/bot add 1'); w.command(op.p, '/bot pause'); tickFor(w, 3); expect(bots(w).map(b => !!b.summoned)).toEqual([true]);
    w.command(op.p, '/bot clear'); expect(bots(w).length).toBe(0);
  });
  it('/bot skill and /bot auto edit the room settings', () => {
    const { w, human } = world('pvp'); const op = human('Op', true); w.command(op.p, '/bot skill hard'); expect(w.meta.botSkill).toBe('hard');
    w.command(op.p, '/bot count 5'); expect(w.meta.bots).toBe(5); w.command(op.p, '/bot auto'); expect(w.meta.bots).toBeUndefined(); expect(w.meta.botsFixed).toBeUndefined();
  });
  it('global switch and capacity density scale automatic bots', () => {
    const { w, human } = world('tdm'); human('Ann'); tickFor(w, 8); const full = bots(w).length;
    cfg.capDensity = .5; tickFor(w, 8); expect(bots(w).length).toBeLessThan(full); cfg.capDensity = 1;
    cfg.enabled = false; tickFor(w, 8); expect(bots(w).length).toBe(0); cfg.enabled = true;
  });
  it('console commands work without a player and say when a mode has no bots', () => {
    const { w } = world('creative'); expect(w.command(null, '/bot add 2')).toMatch(/do not play/i);
  });
});

describe('player commands', () => {
  it('/rooms lists open games, /quick joins the best room of a mode, /join <mode> does the same', () => {
    const { w, human } = world('creative'); const a = human('Ann'); w.command(a.p, '/rooms'); const out = a.ws.sent.filter(m => m.t === 'chat').map(m => m.text).join('\n');
    expect(out).toMatch(/Team Deathmatch #2/); expect(out).toMatch(/\+2 bots/); expect(out).toMatch(/Server load: ok/);
    a.ws.sent.length = 0; w.command(a.p, '/quick tdm'); expect(a.ws.sent.find(m => m.t === 'transfer')).toMatchObject({ world: 'r1' });
    a.ws.sent.length = 0; w.command(a.p, '/join pvp'); expect(a.ws.sent.some(m => m.t === 'transfer')).toBe(false); expect(lastChat(a.ws)).toMatch(/No open|Joining/);
  });
  it('/create understands players, bots, skill and public in any order', () => {
    const got = []; const h = { ...hooks, createGame: o => { got.push(o); return { id: 'g1', name: 'x', players: o.players ?? 8, bots: o.bots ?? 0, public: o.public }; } };
    const w = new GameWorld({ id: 'lobby', name: 'Lobby', seed: 1, type: 'flat', mode: 'creative', economy: false, mobs: false }, null, h); const ws = fakeWs(), p = w.join(ws, { name: 'Ann', uid: 'uAnn' }, '127.0.0.1');
    w.command(p, '/create tdm 12 4 hard public'); expect(got[0]).toMatchObject({ mode: 'tdm', players: 12, bots: 4, skill: 'hard', public: true });
    w.command(p, '/create ctf players=10 b=2'); expect(got[1]).toMatchObject({ mode: 'ctf', players: 10, bots: 2, public: false });
    w.command(p, '/create gungame 3'); expect(got[2]).toMatchObject({ mode: 'gungame', bots: 3 });
  });
  it('/help is topic based and hides operator help from players', () => {
    const { w, human } = world('creative'); const a = human('Ann'), o = human('Op', true);
    w.command(a.p, '/help admin'); const mine = a.ws.sent.filter(m => m.t === 'chat').map(m => m.text).join(' '); expect(mine).toMatch(/by topic/i); expect(mine).not.toMatch(/\/bot add/); w.command(o.p, '/help admin'); expect(o.ws.sent.filter(m => m.t === 'chat').map(m => m.text).join(' ')).toMatch(/\/bot add/);
  });
});

describe('privileged legacy commands', () => {
  it('/kill, /say and /save need operator rights (no server impersonation or world wiping by players)', () => {
    const { w, human } = world('creative'); const a = human('Ann'), o = human('Op', true); let saved = 0; w.hooks.save = () => { saved++; };
    for (const c of ['/kill mobs', '/say I am the server', '/save']) { a.ws.sent.length = 0; w.command(a.p, c); expect(lastChat(a.ws)).toMatch(/operator/i); }
    expect(saved).toBe(0); expect(a.ws.sent.some(m => m.t === 'chat' && /\[Server\]/.test(m.text || ''))).toBe(false);
    w.command(o.p, '/save'); expect(saved).toBe(1); o.ws.sent.length = 0; w.command(o.p, '/say hello'); expect(o.ws.sent.some(m => m.t === 'chat' && /\[Server\] hello/.test(m.text || ''))).toBe(true);
  });
});
