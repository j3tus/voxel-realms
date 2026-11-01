import { describe, it, expect } from 'vitest';
import { GameWorld } from '../server/world.js';
import { WEAPONS } from '../shared/weapons.js';

const hooks = { log() {}, event() {}, motd: () => '', save() {} };
const fakeWs = () => { const sent = []; return { readyState: 1, bufferedAmount: 0, sent, send(s) { if (typeof s === 'string') sent.push(JSON.parse(s)); }, close() {}, terminate() {} }; };
function game(mode, n = 2, meta = {}) {
  const w = new GameWorld({ id: 't', name: 't', seed: 7, type: mode === 'royale' ? 'normal' : 'flat', mode, economy: false, mobs: ['zombies', 'raid', 'td'].includes(mode), bots: 0, ...meta }, null, hooks);
  const [sx, , sz] = w.spawn; for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) w.chunk((Math.floor(sx / 16)) + a, (Math.floor(sz / 16)) + b);
  const ps = []; for (let i = 0; i < n; i++) { const ws = fakeWs(); ps.push({ p: w.join(ws, { name: 'P' + i, uid: 'u' + i }, '127.0.0.1'), ws }); }
  return { w, ps };
}
const tickFor = (w, sec) => { for (let i = 0; i < sec * 20; i++) w.tick(); };
const last = (ws, t) => [...ws.sent].reverse().find(m => m.t === t);

describe('zombies (co-op waves)', () => {
  it('starts solo, spawns a wave, rewards kills, advances waves, and ends when everyone is down', () => {
    const { w, ps } = game('zombies', 1); const a = ps[0].p; tickFor(w, 9); a.mg.hp = 99999; // passive test player must survive the horde expect(w.mg.state).toBe('play'); expect(w.mg.wave).toBe(1);
    tickFor(w, 16); const zs = [...w.sim.mobs.values()].filter(m => m.type === 'zombie'); expect(zs.length).toBeGreaterThan(0); expect(w.sim.mobs.size).toBe(zs.length); // no pigs/villagers
    expect(last(ps[0].ws, 'mg').wave).toBe(1);
    for (let guard = 0; guard < 400 && (w.mg.toSpawn > 0 || w.mg.zombiesAlive() > 0); guard++) { for (const m of [...w.sim.mobs.values()]) { const r = w.sim.hit(m.id, 999, 0, 0); if (r?.killed) w.mg.mobKilled(a, r.m); } w.tick(); }
    expect(a.mg.kills).toBeGreaterThanOrEqual(5); tickFor(w, 8); expect(w.mg.wave).toBe(2);
    w.mg.mobDamage(a, 99); expect(a.mg.alive).toBe(false); tickFor(w, 1); expect(w.mg.state).toBe('end'); expect(w.mg.winner).toMatch(/Survived 1 wave/);
  });
  it('bullets do not hurt teammates and zombie hits drain player health', () => {
    const { w, ps } = game('zombies', 2); const [a, b] = ps.map(x => x.p); tickFor(w, 9); expect(w.mg.state).toBe('play');
    const { cx, cz, gy } = w.mg; a.x = cx - 5.5; a.y = gy; a.z = cz + 3.5; b.x = cx - 1.5; b.y = gy; b.z = cz + 3.5;
    w.handle(a, { t: 'shoot', w: 1, dx: 1, dy: 0, dz: 0 }); expect(b.mg.hp).toBe(20);
    w.mg.mobDamage(b, 3); expect(b.mg.hp).toBe(17);
  });
});

describe('battle royale', () => {
  it('shrinks the zone, damages players outside it, and the last one alive wins', () => {
    const { w, ps } = game('royale', 3); const [a, b, c] = ps.map(x => x.p); tickFor(w, 9); expect(w.mg.state).toBe('play');
    const r0 = w.mg.zone.r; tickFor(w, 60); expect(w.mg.zone.r).toBeLessThan(r0); expect(w.mg.snapshot().zone.r).toBeLessThan(70);
    for (const p of [a, b, c]) { expect(p.mg.alive).toBe(true); }
    const far = w.mg.cx + 500; b.x = far; c.x = far; a.x = w.mg.cx + .5; a.z = w.mg.cz + .5; tickFor(w, 25);
    expect(b.mg.alive).toBe(false); expect(c.mg.alive).toBe(false); expect(w.mg.state).toBe('end'); expect(w.mg.winner).toBe('P0');
  });
  it('dead players stay dead (no respawn)', () => {
    const { w, ps } = game('royale', 3); tickFor(w, 9); const b = ps[1].p; w.mg.kill(b, null, 'zone'); tickFor(w, 5); expect(b.mg.alive).toBe(false);
  });
});

describe('capture the flag', () => {
  it('picks up the enemy flag, captures at home, drops on death, and 3 captures win', () => {
    const { w, ps } = game('ctf', 2); const [a, b] = ps.map(x => x.p); tickFor(w, 9); expect(w.mg.state).toBe('play'); expect(a.mg.team).not.toBe(b.mg.team);
    const t = a.mg.team, mine = w.mg.flags[t], theirs = w.mg.flags[1 - t];
    b.x = w.mg.cx + (b.mg.team === 0 ? -8 : 8); b.z = w.mg.cz + 8; b.y = w.mg.gy;
    const capture = () => { a.x = theirs.home[0]; a.z = theirs.home[2]; a.y = w.mg.gy; w.mg.playTick(w.mg.list(), .05); expect(theirs.carrier).toBe(a.id); a.x = mine.home[0]; a.z = mine.home[2]; w.mg.playTick(w.mg.list(), .05); };
    capture(); expect(w.mg.caps[t]).toBe(1); expect(theirs.carrier).toBe(null); expect(theirs.at).toEqual(theirs.home);
    a.x = theirs.home[0]; a.z = theirs.home[2]; w.mg.playTick(w.mg.list(), .05); expect(theirs.carrier).toBe(a.id);
    a.x += 4; a.mg.alive = true; w.mg.kill(a, b, 'Rifle'); expect(theirs.carrier).toBe(null); expect(theirs.at).not.toEqual(theirs.home);
    a.mg.alive = true; a.x = theirs.at[0]; a.z = theirs.at[2]; w.mg.playTick(w.mg.list(), .05); expect(theirs.carrier).toBe(a.id); // walking over the dropped flag picks it up again
    theirs.carrier = null; theirs.at = [...theirs.home]; capture(); capture(); expect(w.mg.state).toBe('end'); expect(w.mg.winner).toBe((t === 0 ? 'RED' : 'BLUE') + ' TEAM');
  });
  it('does not spam chat when a flag is already home (regression: reference comparison made every tick a "return")', () => {
    const { w, ps } = game('ctf', 2); tickFor(w, 9); const a = ps[0].p, m = w.mg, mine = m.flags[a.mg.team]; a.x = mine.home[0]; a.z = mine.home[2]; a.y = m.gy;
    ps[0].ws.sent.length = 0; tickFor(w, 3); expect(ps[0].ws.sent.filter(x => x.t === 'chat' && /returned/.test(x.text || '')).length).toBe(0);
    mine.at = [mine.home[0] + 6, mine.home[1], mine.home[2]]; mine.droppedAt = Date.now(); a.x = mine.at[0]; a.z = mine.at[2]; tickFor(w, 1);
    expect(ps[0].ws.sent.filter(x => x.t === 'chat' && /returned/.test(x.text || '')).length).toBe(1); // a genuine return announces exactly once
  });
  it('friendly fire is off in CTF', () => {
    const { w, ps } = game('ctf', 3); tickFor(w, 9); const [a, b, c] = ps.map(x => x.p); const mate = [b, c].find(x => x.mg.team === a.mg.team);
    if (!mate) return; const { cx, cz, gy } = w.mg; a.x = cx - 5.5; a.y = gy; a.z = cz + 3.5; mate.x = cx - 1.5; mate.y = gy; mate.z = cz + 3.5; w.handle(a, { t: 'shoot', w: 1, dx: 1, dy: 0, dz: 0 }); expect(mate.mg.hp).toBe(20);
  });
});

describe('hide & seek', () => {
  it('seeker is held back during the hide phase, hiders are unarmed, one tag eliminates a hider, seeker wins when all are found', () => {
    const { w, ps } = game('hide', 3); tickFor(w, 9); expect(w.mg.state).toBe('play'); expect(w.mg.phase).toBe('hide');
    const seeker = ps.map(x => x.p).find(p => p.id === w.mg.seeker), hiders = ps.map(x => x.p).filter(p => p !== seeker);
    expect(last(ps.find(x => x.p === hiders[0]).ws, 'hp').gw).toBe(-2); expect(last(ps.find(x => x.p === seeker).ws, 'hp').gw).toBe(-2); // all disarmed while hiding
    const { cx, cz, gy } = w.mg; seeker.x = cx - 5.5; seeker.y = gy; seeker.z = cz + 3.5; hiders[0].x = cx - 1.5; hiders[0].y = gy; hiders[0].z = cz + 3.5;
    w.handle(seeker, { t: 'shoot', w: 0, dx: 1, dy: 0, dz: 0 }); expect(hiders[0].mg.alive).toBe(true); // can't shoot yet
    seeker.x = w.mg.start[0]; seeker.z = w.mg.start[2]; tickFor(w, 16); expect(w.mg.phase).toBe('seek'); expect(last(ps.find(x => x.p === seeker).ws, 'hp').gw).toBe(0);
    seeker.x = cx - 5.5; seeker.y = gy; seeker.z = cz + 3.5; hiders[0].x = cx - 1.5; hiders[0].y = gy; hiders[0].z = cz + 3.5; hiders[1].x = cx + 12; hiders[1].z = cz + 12;
    w.handle(seeker, { t: 'shoot', w: 0, dx: 1, dy: 0, dz: 0 }); expect(hiders[0].mg.alive).toBe(false); expect(w.mg.state).toBe('play');
    w.handle(hiders[1], { t: 'shoot', w: 0, dx: 1, dy: 0, dz: 0 }); expect(hiders[1].mg.ammo[0]).toBe(WEAPONS[0].mag); // hiders can't fire
    w.mg.kill(hiders[1], seeker, 'Pistol'); tickFor(w, 1); expect(w.mg.state).toBe('end'); expect(w.mg.winner).toBe(seeker.name);
  });
  it('hiders win if the clock runs out', () => {
    const { w } = game('hide', 2); tickFor(w, 9); w.mg.t = .05; tickFor(w, 1); expect(w.mg.state).toBe('end'); expect(w.mg.winner).toBe('HIDERS');
  });
});

describe('parkour race', () => {
  it('builds a course, tracks progress, sends fallers back to the last checkpoint, and the first to finish wins', () => {
    const { w, ps } = game('parkour', 2); const [a, b] = ps.map(x => x.p); tickFor(w, 9); expect(w.mg.state).toBe('play');
    const m = w.mg, at = i => { const q = m.plats[i]; return [m.cx + q.x + .5, m.gy + 12 + q.y, m.cz + q.z + .5]; };
    expect(w.getB(m.cx + m.plats[3].x, m.gy - 1 + 12 + m.plats[3].y, m.cz + m.plats[3].z)).not.toBe(0);
    [a.x, a.y, a.z] = at(7); tickFor(w, 1); expect(a.mg.prog).toBeGreaterThanOrEqual(7); expect(a.mg.cp).toBe(6);
    a.y = m.gy; tickFor(w, 1); expect(Math.hypot(a.x - at(6)[0], a.z - at(6)[2])).toBeLessThan(.6); expect(a.y).toBeCloseTo(at(6)[1], 0);
    [b.x, b.y, b.z] = at(36); tickFor(w, 1); expect(w.mg.state).toBe('end'); expect(w.mg.winner).toBe('P1');
  });
  it('is solo-playable and has no shooting', () => {
    const { w, ps } = game('parkour', 1); tickFor(w, 9); expect(w.mg.state).toBe('play'); const a = ps[0].p; w.handle(a, { t: 'shoot', w: 1, dx: 1, dy: 0, dz: 0 }); expect(a.mg.ammo[1]).toBe(WEAPONS[1].mag);
  });
});

describe('lobby hub', () => {
  const worldsList = [{ id: 'gunarena', name: 'Gun Arena', mode: 'pvp', players: 3, max: 16 }, { id: 'teamdeathmatch', name: 'Team Deathmatch', mode: 'tdm', players: 0, max: 16 }, { id: 'spleef', name: 'Spleef', mode: 'spleef', players: 1, max: 16 }, { id: 'main', name: 'Main', mode: 'creative', players: 0, max: 16 }];
  const lobby = () => { const h = { ...hooks, worlds: () => [...worldsList, { id: 'lobby', name: 'Lobby', mode: 'lobby', players: 1, max: 40 }] };
    const w = new GameWorld({ id: 'lobby', name: 'Lobby', seed: 3, type: 'flat', mode: 'lobby', economy: false, mobs: false, bots: 0 }, null, h);
    const [sx, , sz] = w.spawn; for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) w.chunk((Math.floor(sx / 16)) + a, (Math.floor(sz / 16)) + b);
    const ws = fakeWs(); const p = w.join(ws, { name: 'Tom', uid: 'tom' }, '127.0.0.1'); return { w, p, ws }; };
  it('opens one portal per game world (sorted by mode), bricks up the unused slots, and sends labels with live counts', () => {
    const { w, p, ws } = lobby(); const m = w.mg, snap = last(ws, 'lobby');
    expect(snap.portals.map(x => x.id)).toEqual(['gunarena', 'teamdeathmatch', 'spleef', 'main']); expect(snap.portals[0]).toMatchObject({ name: 'Gun Arena', n: 3, max: 16, mode: 'pvp' });
    const mid = i => { const sl = m.slots[i]; return w.getB(sl.x, m.gy + 1, sl.z); };
    expect(mid(0)).toBe(0); expect(mid(3)).toBe(0); expect(mid(4)).not.toBe(0); expect(mid(11)).not.toBe(0); // slots 0-3 open, 4+ bricked
    expect(Math.hypot(p.x - (m.cx + .5), p.z - (m.cz + .5))).toBeLessThan(5);
  });
  it('walking into a portal sends a transfer (once per cooldown), standing elsewhere does not', () => {
    const { w, p, ws } = lobby(); const m = w.mg; tickFor(w, 1); expect(ws.sent.some(x => x.t === 'transfer')).toBe(false);
    const sl = m.slots[1]; p.x = sl.x + .5; p.z = sl.z + .5; p.y = m.gy; tickFor(w, 1);
    const tr = ws.sent.filter(x => x.t === 'transfer'); expect(tr.length).toBe(1); expect(tr[0]).toMatchObject({ world: 'teamdeathmatch', name: 'Team Deathmatch' });
    tickFor(w, 2); expect(ws.sent.filter(x => x.t === 'transfer').length).toBe(1); // cooldown
    const dead = m.slots[8]; p.x = dead.x + .5; p.z = dead.z + .5; m.cool.clear(); tickFor(w, 1); expect(ws.sent.filter(x => x.t === 'transfer').length).toBe(1); // unused slot is a wall
  });
  it('is build-proof, daylight-locked, and rescues players who fall off', () => {
    const { w, p, ws } = lobby(); const m = w.mg; const before = w.getB(m.cx + 5, m.gy - 1, m.cz + 5);
    w.handle(p, { t: 'block', x: m.cx + 5, y: m.gy - 1, z: m.cz + 5, id: 0 }); expect(w.getB(m.cx + 5, m.gy - 1, m.cz + 5)).toBe(before);
    w.time = .9; tickFor(w, 1); expect(w.time).toBeCloseTo(.4, 1);
    p.y = m.gy - 30; tickFor(w, 1); expect(p.y).toBeGreaterThan(m.gy - 1); expect(ws.sent.filter(x => x.t === 'tp').length).toBeGreaterThan(1);
  });
  it('picks up new worlds on the fly', () => {
    const { w, ws } = lobby(); const m = w.mg; worldsList.push({ id: 'zombies', name: 'Zombies', mode: 'zombies', players: 0, max: 16 }); tickFor(w, 2);
    expect(m.active.map(x => x.id)).toContain('zombies'); expect(last(ws, 'lobby').portals.length).toBe(5); worldsList.pop();
  });
});

describe('/lobby command', () => {
  it('sends a transfer from a game world when a lobby exists, and refuses otherwise', () => {
    const h = { ...hooks, worlds: () => [{ id: 'lobby', name: 'Lobby', mode: 'lobby', players: 0, max: 40 }] };
    const w = new GameWorld({ id: 'a', name: 'a', seed: 1, type: 'flat', mode: 'pvp', economy: false, mobs: false, bots: 0 }, null, h); const ws = fakeWs(); const p = w.join(ws, { name: 'Z', uid: 'z' }, '127.0.0.1');
    w.handle(p, { t: 'chat', text: '/lobby' }); expect(last(ws, 'transfer')).toMatchObject({ world: 'lobby' });
    const w2 = new GameWorld({ id: 'b', name: 'b', seed: 1, type: 'flat', mode: 'pvp', economy: false, mobs: false, bots: 0 }, null, hooks); const ws2 = fakeWs(); const p2 = w2.join(ws2, { name: 'Y', uid: 'y' }, '127.0.0.1');
    w2.handle(p2, { t: 'chat', text: '/lobby' }); expect(last(ws2, 'transfer')).toBeUndefined(); expect(last(ws2, 'chat').text).toMatch(/no lobby/i);
  });
});

import { Parties } from '../server/parties.js';
describe('parties', () => {
  it('invite/accept/leave, leader handover, size cap, and expiry rules', () => {
    const P = new Parties(); expect(P.invite('a', 'b')).toBe(null); const pt = P.accept('b'); expect(pt.members.size).toBe(2); expect(P.get('b').leader).toBe('a');
    expect(P.invite('b', 'c')).toMatch(/leader/); expect(P.accept('zzz')).toMatch(/no pending/);
    P.invite('a', 'c'); P.accept('c'); P.leave('a'); expect(P.get('a')).toBe(null); expect(P.get('b').leader).not.toBe('a'); expect(P.get('b').members.size).toBe(2);
    P.leave('b'); expect(P.get('b')).toBe(null); expect(P.get('c')).toBe(null); // a party of one dissolves
    const Q = new Parties(); for (let i = 1; i < 8; i++) { Q.invite('L', 'm' + i); Q.accept('m' + i); } expect(Q.get('L').members.size).toBe(8); expect(Q.invite('L', 'x')).toMatch(/full/);
  });
  it('/party command flow works through chat', () => {
    const h = { ...hooks, parties: new Parties(), worlds: () => [] }; const w = new GameWorld({ id: 'p', name: 'p', seed: 1, type: 'flat', mode: 'creative', economy: false, mobs: false, bots: 0 }, null, h);
    const wa = fakeWs(), wb = fakeWs(); const a = w.join(wa, { name: 'Ann', uid: 'ua' }, '1.1.1.1'), b = w.join(wb, { name: 'Bob', uid: 'ub' }, '1.1.1.2');
    w.handle(a, { t: 'chat', text: '/party invite Bob' }); expect(last(wb, 'chat').text).toMatch(/invited you/); w.handle(b, { t: 'chat', text: '/party accept' }); expect(last(wb, 'chat').text).toMatch(/joined the party/);
    w.handle(a, { t: 'chat', text: '/party list' }); expect(last(wa, 'chat').text).toMatch(/Party \(2\).*Ann.*Bob/); w.handle(b, { t: 'chat', text: '/party leave' }); expect(h.parties.get('ub')).toBe(null);
  });
});

describe('lobby: status, full worlds, parties', () => {
  const mk = (list, parties) => { const h = { ...hooks, parties, worlds: () => [...list, { id: 'lobby', name: 'Lobby', mode: 'lobby', players: 2, max: 40 }] };
    const w = new GameWorld({ id: 'lobby', name: 'Lobby', seed: 3, type: 'flat', mode: 'lobby', economy: false, mobs: false, bots: 0 }, null, h);
    const [sx, , sz] = w.spawn; for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) w.chunk((Math.floor(sx / 16)) + a, (Math.floor(sz / 16)) + b);
    const join = n => { const ws = fakeWs(); return { p: w.join(ws, { name: n, uid: 'u' + n }, '127.0.0.1'), ws }; }; return { w, join }; };
  const into = (w, p, slot) => { const sl = w.mg.slots[slot]; p.x = sl.x + .5; p.z = sl.z + .5; p.y = w.mg.gy; };
  it('portals report round status; a full world refuses entry with a message', () => {
    const list = [{ id: 'a', name: 'Arena', mode: 'pvp', players: 16, max: 16, st: 'play', t: 83 }, { id: 'b', name: 'Open', mode: 'tdm', players: 1, max: 16, st: 'lobby', t: 6 }];
    const { w, join } = mk(list, new Parties()); const t = join('Tom'); expect(last(t.ws, 'lobby').portals[0]).toMatchObject({ st: 'play', t: 83, n: 16, max: 16 });
    into(w, t.p, 0); tickFor(w, 1); expect(t.ws.sent.some(m => m.t === 'transfer')).toBe(false); expect(last(t.ws, 'toast').text).toMatch(/full/);
    w.mg.cool.clear(); into(w, t.p, 1); tickFor(w, 1); expect(last(t.ws, 'transfer')).toMatchObject({ world: 'b' });
  });
  it('a party leader takes the whole party; a member walking in goes alone; a too-big party is refused', () => {
    const P = new Parties(); P.invite('uLea', 'uMem'); P.accept('uMem'); const list = [{ id: 'b', name: 'Open', mode: 'tdm', players: 1, max: 16, st: 'lobby', t: 6 }, { id: 'c', name: 'Tight', mode: 'ctf', players: 15, max: 16, st: 'lobby', t: 6 }];
    const { w, join } = mk(list, P); const lea = join('Lea'), mem = join('Mem'), other = join('Oth');
    into(w, lea.p, 0); tickFor(w, 1); expect(last(lea.ws, 'transfer')).toMatchObject({ world: 'b' }); expect(last(mem.ws, 'transfer')).toMatchObject({ world: 'b' }); expect(other.ws.sent.some(m => m.t === 'transfer')).toBe(false);
    lea.p.x = w.mg.cx + .5; lea.p.z = w.mg.cz + .5; w.mg.cool.clear(); mem.ws.sent.length = 0; lea.ws.sent.length = 0; into(w, mem.p, 0); tickFor(w, 1); expect(last(mem.ws, 'transfer')).toBeTruthy(); expect(lea.ws.sent.some(m => m.t === 'transfer')).toBe(false);
    mem.p.x = w.mg.cx + .5; mem.p.z = w.mg.cz + .5; w.mg.cool.clear(); mem.ws.sent.length = 0; lea.ws.sent.length = 0; into(w, lea.p, 1); tickFor(w, 1); expect(lea.ws.sent.some(m => m.t === 'transfer')).toBe(false); expect(last(lea.ws, 'toast').text).toMatch(/full for your party/);
  });
});

describe('search & destroy', () => {
  const start = () => { const { w, ps } = game('snd', 4); tickFor(w, 9); const P = ps.map(x => x.p); return { w, att: P.filter(p => p.mg.team === 0), def: P.filter(p => p.mg.team === 1) }; };
  const stand = (w, p) => { p.x = w.mg.site[0]; p.z = w.mg.site[2]; p.y = w.mg.gy; };
  it('attackers plant after standing on the site, defenders must defuse it; rounds reset and first to 4 wins', () => {
    const { w, att, def } = start(); const m = w.mg; expect(m.state).toBe('play'); expect(att.length).toBe(2); expect(def.length).toBe(2);
    stand(w, att[0]); tickFor(w, 4); expect(m.bomb.st).toBe('planted');
    for (const d of def) stand(w, d); tickFor(w, 5); expect(m.bomb.st).toBe('defused'); expect(m.score).toEqual([0, 1]); expect(m.rs).toBe('post');
    tickFor(w, 6); expect(m.rs).toBe('live'); expect(m.bomb.st).toBe('none'); for (const p of [...att, ...def]) expect(p.mg.alive).toBe(true);
    stand(w, att[0]); tickFor(w, 4); expect(m.bomb.st).toBe('planted'); for (const d of def) { d.x = m.cx - 10; } tickFor(w, 26); expect(m.score).toEqual([1, 1]); // bomb exploded
  });
  it('eliminating a team wins the round; four round wins end the match; friendly fire off', () => {
    const { w, att, def } = start(); const m = w.mg;
    for (let r = 0; r < 4; r++) { for (const d of def) { d.mg.alive = true; w.mg.kill(d, att[0], 'Rifle'); } tickFor(w, 1); if (m.state === 'play') tickFor(w, 6); }
    expect(m.score[0]).toBe(4); expect(m.state).toBe('end'); expect(m.winner).toBe('RED TEAM');
    const { w: w2, att: a2 } = start(); const { cx, cz, gy } = w2.mg; a2[0].x = cx - 5.5; a2[0].y = gy; a2[0].z = cz + 3.5; a2[1].x = cx - 1.5; a2[1].y = gy; a2[1].z = cz + 3.5; w2.handle(a2[0], { t: 'shoot', w: 1, dx: 1, dy: 0, dz: 0 }); expect(a2[1].mg.hp).toBe(20);
  });
});

describe('bed wars', () => {
  const start = () => { const { w, ps } = game('bedwars', 4); tickFor(w, 9); const P = ps.map(x => x.p); return { w, red: P.filter(p => p.mg.team === 0), blue: P.filter(p => p.mg.team === 1) }; };
  it('lets players place blocks inside the arena only, and bullets chew player-built blocks', () => {
    const { w, red } = start(); const m = w.mg, p = red[0]; p.x = m.cx; p.y = m.gy; p.z = m.cz + 4; const bx = m.cx + 2, bz = m.cz + 4;
    w.handle(p, { t: 'block', x: bx, y: m.gy, z: bz, id: 3 }); expect(w.getB(bx, m.gy, bz)).toBe(3); w.handle(p, { t: 'block', x: bx, y: m.gy, z: bz, id: 0 }); expect(w.getB(bx, m.gy, bz)).toBe(3); // no hand-breaking
    w.handle(p, { t: 'block', x: m.cx + 20, y: m.gy, z: m.cz, id: 3 }); expect(w.getB(m.cx + 20, m.gy, m.cz)).not.toBe(3);
    m.blockShot(p, bx, m.gy, bz); expect(w.getB(bx, m.gy, bz)).toBe(0);
  });
  it('only the enemy bed can be broken; without a bed there is no respawn; the last team standing wins', () => {
    const { w, red, blue } = start(); const m = w.mg; const [rx, ry, rz] = m.bedBlocks(0)[0];
    m.blockShot(red[0], rx, ry, rz); expect(m.bedAlive[0]).toBe(true); // own bed is safe
    m.blockShot(blue[0], rx, ry, rz); expect(m.bedAlive[0]).toBe(false); expect(w.getB(rx, ry, rz)).toBe(0);
    for (const r of red) { r.mg.alive = true; m.kill(r, blue[0], 'Rifle'); } expect(red.every(r => r.mg.respawnAt === 0)).toBe(true);
    const b = blue[1]; b.mg.alive = true; m.kill(b, red[0], 'Rifle'); expect(b.mg.respawnAt).toBeGreaterThan(0); // blue still has a bed -> respawns
    tickFor(w, 1); expect(m.state).toBe('end'); expect(m.winner).toBe('BLUE TEAM');
  });
});

describe('boss raid', () => {
  it('spawns a boss scaled to the party, hits hard, enrages through phases with minions, and dies for a win', () => {
    const { w, ps } = game('raid', 2); const [a, b] = ps.map(x => x.p); tickFor(w, 9); const m = w.mg; expect(m.state).toBe('play');
    const boss = [...w.sim.mobs.values()].find(x => x.type === 'boss'); expect(boss).toBeTruthy(); expect(m.bossMax).toBe(400); expect(m.snapshot().boss).toMatchObject({ hp: 400, max: 400, phase: 0 });
    a.mg.hp = 20; a.x = boss.x - 1.5; a.y = m.gy; a.z = boss.z; b.x = m.cx - 10; b.y = m.gy; b.z = m.cz; tickFor(w, 2); expect(a.mg.hp).toBeLessThanOrEqual(14); expect((20 - a.mg.hp) % 6).toBe(0); // 6 damage per swing
    boss.hp = 250; tickFor(w, 1); expect(m.phase).toBe(1); expect(boss.spd).toBeGreaterThan(1); boss.hp = 90; tickFor(w, 1); expect(m.phase).toBe(2); tickFor(w, 8); expect([...w.sim.mobs.values()].some(x => x.type === 'zombie')).toBe(true);
    const r = w.sim.hit(boss.id, 9999, 0, 0); expect(r.killed).toBe(true); m.mobKilled(b, r.m); tickFor(w, 1); expect(m.state).toBe('end'); expect(m.winner).toBe('BOSS DEFEATED'); expect(b.mg.kills).toBeGreaterThanOrEqual(5);
  });
  it('players respawn after 12 s, but if everyone is down the boss wins', () => {
    const { w, ps } = game('raid', 2); const [a, b] = ps.map(x => x.p); tickFor(w, 9); const m = w.mg;
    a.mg.hp = 99999; b.mg.hp = 2; m.mobDamage(b, 6); expect(b.mg.alive).toBe(false); expect(b.mg.respawnAt).toBeGreaterThan(Date.now() + 10000); b.mg.respawnAt = Date.now() - 1; tickFor(w, 1); expect(b.mg.alive).toBe(true);
    a.mg.hp = 1; m.mobDamage(a, 6); b.mg.hp = 1; m.mobDamage(b, 6); tickFor(w, 1); expect(a.mg.alive || b.mg.alive).toBe(false);
    a.mg.respawnAt = 0; b.mg.respawnAt = 0; tickFor(w, 1); expect(m.state).toBe('end'); expect(m.winner).toBe('The boss wins');
  });
  it('bullets actually hit the tall boss (real hit-box)', () => {
    const { w, ps } = game('raid', 2); const a = ps[0].p; tickFor(w, 9); const m = w.mg, boss = [...w.sim.mobs.values()].find(x => x.type === 'boss');
    a.x = boss.x - 6; a.y = m.gy; a.z = boss.z; w.sim.clear('zombie'); const hp0 = boss.hp; w.handle(a, { t: 'shoot', w: 1, dx: 1, dy: 0, dz: 0 }); expect(boss.hp).toBeLessThan(hp0);
  });
});

describe('tower defence', () => {
  const startTd = (n = 2) => { const { w, ps } = game('td', n); const P = ps.map(x => x.p); tickFor(w, 9); const m = w.mg; for (const p of P) { p.x = m.cx + .5 - 11; p.z = m.cz + 13.2; p.y = m.gy; } return { w, ps, P, m }; };
  it('zombies march on the core (not the players) and wear it down', () => {
    const { w, m } = startTd(); expect(m.state).toBe('play'); expect(m.wave).toBe(1); expect(w.sim.goal).toBeTruthy(); tickFor(w, 20); expect(m.core).toBeLessThan(100); expect(m.core).toBeGreaterThan(0); expect(m.state).toBe('play'); expect(m.snapshot()).toMatchObject({ wave: 1, maxWave: 10 });
  });
  it('gold block builds a turret for coins (refused when broke), turrets shoot and pay out kills, barricades are free', () => {
    const { w, ps, P, m } = startTd(); const a = P[0], wal = w.wallet(a); wal.coins = 60; const tx = m.cx - 3, tz = m.cz + 8; a.x = tx + .5; a.z = tz - 2; a.y = m.gy;
    w.handle(a, { t: 'block', x: tx, y: m.gy, z: tz, id: 29 }); expect(w.getB(tx, m.gy, tz)).toBe(29); expect(wal.coins).toBe(40); expect(m.turrets.length).toBe(1);
    wal.coins = 5; w.handle(a, { t: 'block', x: tx + 1, y: m.gy, z: tz, id: 29 }); expect(w.getB(tx + 1, m.gy, tz)).toBe(0); expect(last(ps[0].ws, 'toast').text).toMatch(/costs 20/);
    w.handle(a, { t: 'block', x: tx + 1, y: m.gy, z: tz, id: 12 }); expect(w.getB(tx + 1, m.gy, tz)).toBe(12); expect(wal.coins).toBe(5); // barricade is free
    w.handle(a, { t: 'block', x: tx + 2, y: m.gy, z: tz, id: 0 }); expect(w.getB(tx + 2, m.gy, tz)).toBe(0);
    w.sim.clear(); m.toSpawn = 0; const z = w.sim.spawn('zombie', tx + .5, m.gy + 1, tz - 5); z.hp = 8; tickFor(w, 4); expect(w.sim.mobs.has(z.id)).toBe(false); expect(wal.coins).toBe(8); // turret killed it, owner earned 3
    expect(ps[0].ws.sent.some(x => x.t === 'shot' && x.id === 0)).toBe(true);
  });
  it('losing the core ends the round; clearing the last wave wins', () => {
    const { w, m } = startTd(); m.core = .5; w.sim.spawn('zombie', m.coreP[0] - 1, m.gy + 1, m.coreP[1]); tickFor(w, 2); expect(m.state).toBe('end'); expect(m.winner).toMatch(/core fell on wave 1/);
    const g = startTd(); g.m.wave = 10; g.m.toSpawn = 0; g.w.sim.clear(); tickFor(g.w, 14); expect(g.m.state).toBe('end'); expect(g.m.winner).toBe('Core defended!');
  });
});
