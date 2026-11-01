import { describe, it, expect } from 'vitest';
import { GameWorld } from '../server/world.js';
import { WEAPONS } from '../shared/weapons.js';

const hooks = { log() {}, event() {}, motd: () => '', save() {} };
const fakeWs = () => { const sent = []; return { readyState: 1, bufferedAmount: 0, sent, send(s) { if (typeof s === 'string') sent.push(JSON.parse(s)); }, close() {}, terminate() {} }; };
function arena(mode = 'pvp') {
  const w = new GameWorld({ id: 't', name: 't', seed: 7, type: 'flat', mode, economy: false, mobs: false, bots: 0 }, null, hooks);
  const [sx, , sz] = w.spawn; for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) w.chunk((Math.floor(sx / 16)) + a, (Math.floor(sz / 16)) + b);
  const mk = n => { const ws = fakeWs(); const p = w.join(ws, { name: n, uid: n }, '127.0.0.1'); return { p, ws }; };
  return { w, mk };
}
const tickFor = (w, sec) => { for (let i = 0; i < sec * 20; i++) w.tick(); };
const last = (ws, t) => [...ws.sent].reverse().find(m => m.t === t);

describe('gun arena (server authoritative)', () => {
  it('waits for two players, runs a countdown, then starts the round', () => {
    const { w, mk } = arena(); const a = mk('A'); tickFor(w, 12); expect(w.mg.state).toBe('lobby');
    const b = mk('B'); tickFor(w, 9); expect(w.mg.state).toBe('play'); expect(a.p.mg.alive && b.p.mg.alive).toBe(true);
  });
  it('rifle hit damages only the target, headshots hurt more, walls block shots', () => {
    const { w, mk } = arena(); const a = mk('A'), b = mk('B'); tickFor(w, 9);
    const { cx, cz, gy } = w.mg; a.p.x = cx - 5.5; a.p.y = gy; a.p.z = cz + 3.5; b.p.x = cx - 1.5; b.p.y = gy; b.p.z = cz + 3.5;
    w.handle(a.p, { t: 'shoot', w: 1, dx: 1, dy: 0, dz: 0 });
    expect(b.p.mg.hp).toBeLessThan(20); expect(a.p.mg.hp).toBe(20); expect(last(a.ws, 'hitmark')).toBeTruthy();
    // wall between shooter and target
    const hp = b.p.mg.hp; w.setBlock(cx - 3, gy + 1, cz + 3, 3); w.p = null; a.p.mg.lastShot = 0;
    w.handle(a.p, { t: 'shoot', w: 1, dx: 1, dy: 0, dz: 0 }); expect(b.p.mg.hp).toBe(hp);
  });
  it('enforces fire rate and ammo, and kills score and respawn', () => {
    const { w, mk } = arena(); const a = mk('A'), b = mk('B'); tickFor(w, 9);
    const { cx, cz, gy } = w.mg; a.p.x = cx - 5.5; a.p.y = gy; a.p.z = cz + 3.5; b.p.x = cx - 1.5; b.p.y = gy; b.p.z = cz + 3.5;
    w.handle(a.p, { t: 'shoot', w: 3, dx: 1, dy: 0, dz: 0 }); const afterOne = b.p.mg.hp;
    w.handle(a.p, { t: 'shoot', w: 3, dx: 1, dy: 0, dz: 0 }); expect(b.p.mg.hp).toBe(afterOne); // sniper cooldown 1.4s
    expect(a.p.mg.ammo[3]).toBe(WEAPONS[3].mag - 1);
    for (let i = 0; i < 4 && b.p.mg.alive; i++) { a.p.mg.lastShot = 0; w.handle(a.p, { t: 'shoot', w: 3, dx: 1, dy: 0, dz: 0 }); }
    expect(b.p.mg.alive).toBe(false); expect(a.p.mg.kills).toBe(1); b.p.mg.respawnAt = Date.now() - 1; tickFor(w, 1); expect(b.p.mg.alive).toBe(true); expect(b.p.mg.hp).toBe(20);
  });
  it('rejects shots from dead players and bogus directions', () => {
    const { w, mk } = arena(); const a = mk('A'), b = mk('B'); tickFor(w, 9); a.p.mg.alive = false;
    w.handle(a.p, { t: 'shoot', w: 1, dx: 1, dy: 0, dz: 0 }); expect(a.p.mg.ammo[1]).toBe(WEAPONS[1].mag);
    a.p.mg.alive = true; w.handle(a.p, { t: 'shoot', w: 1, dx: 'x', dy: 0, dz: 0 }); w.handle(a.p, { t: 'shoot', w: 1, dx: 0, dy: 0, dz: 0 }); w.handle(a.p, { t: 'shoot', w: 99, dx: 1, dy: 0, dz: 0 });
    expect(a.p.mg.ammo[1]).toBe(WEAPONS[1].mag); expect(b.p.mg.hp).toBe(20);
  });
  it('blocks cannot be built or broken in the gun arena', () => {
    const { w, mk } = arena(); const a = mk('A'); a.p.x = w.mg.cx; a.p.y = w.mg.gy; a.p.z = w.mg.cz + 3;
    const before = w.getB(w.mg.cx, w.mg.gy - 1, w.mg.cz + 3); w.handle(a.p, { t: 'block', x: w.mg.cx, y: w.mg.gy - 1, z: w.mg.cz + 3, id: 0 }); expect(w.getB(w.mg.cx, w.mg.gy - 1, w.mg.cz + 3)).toBe(before);
  });
});

describe('spleef', () => {
  it('only the snow floor can be broken, only during a round; falling eliminates; last player wins', () => {
    const { w, mk } = arena('spleef'); const a = mk('A'), b = mk('B'); const { cx, cz, floorY } = w.mg;
    a.p.x = cx; a.p.y = floorY + 1; a.p.z = cz; w.handle(a.p, { t: 'block', x: cx, y: floorY, z: cz, id: 0 }); expect(w.getB(cx, floorY, cz)).not.toBe(0); // lobby: not allowed
    tickFor(w, 9); expect(w.mg.state).toBe('play');
    a.p.x = cx; a.p.y = floorY + 1; a.p.z = cz; w.handle(a.p, { t: 'block', x: cx, y: floorY, z: cz, id: 0 }); expect(w.getB(cx, floorY, cz)).toBe(0);
    w.handle(a.p, { t: 'block', x: cx + 1, y: floorY, z: cz, id: 3 }); expect(w.getB(cx + 1, floorY, cz)).not.toBe(3); // no placing
    b.p.y = floorY - 5; tickFor(w, 1); expect(b.p.mg.alive).toBe(false); expect(w.mg.state).toBe('end'); expect(w.mg.winner).toBe('A');
    tickFor(w, 8); expect(w.mg.state).toBe('lobby');
  });
});

describe('team deathmatch', () => {
  const setup = () => { const { w, mk } = arena('tdm'); const a = mk('A'), b = mk('B'), c = mk('C'); tickFor(w, 9); return { w, a, b, c }; };
  it('splits players into balanced teams and spawns each team on its own side', () => {
    const { w, a, b, c } = setup(); expect(w.mg.state).toBe('play');
    const teams = [a, b, c].map(x => x.p.mg.team); expect(teams.filter(t => t === 0).length).toBe(2); expect(teams.filter(t => t === 1).length).toBe(1);
    for (const x of [a, b, c]) { const side = x.p.x - w.mg.cx; expect(x.p.mg.team === 0 ? side < 0 : side > 0).toBe(true); }
  });
  it('friendly fire is off: teammates take no damage, enemies do', () => {
    const { w, a, b, c } = setup(); const { cx, cz, gy } = w.mg;
    const mates = [a, b, c].filter(x => x.p.mg.team === 0), foe = [a, b, c].find(x => x.p.mg.team === 1);
    mates[0].p.x = cx - 6.5; mates[0].p.y = gy; mates[0].p.z = cz + 3.5; mates[1].p.x = cx - 2.5; mates[1].p.y = gy; mates[1].p.z = cz + 3.5; foe.p.x = cx + 8.5; foe.p.y = gy; foe.p.z = cz + 3.5;
    for (let x = -8; x <= 10; x++) for (let y = 0; y < 3; y++) w.setBlock(cx + x, gy + y, cz + 3, 0); // clear the firing lane of arena cover; this test is about friendly fire, not line of sight
    mates[0].p.mg.lastShot = 0; w.handle(mates[0].p, { t: 'shoot', w: 1, dx: 1, dy: 0, dz: 0 }); // teammate is in front, enemy behind him
    expect(mates[1].p.mg.hp).toBe(20); expect(foe.p.mg.hp).toBeLessThan(20);
  });
  it('team score is the sum of kills and the first team to the goal wins, rewarding all teammates', () => {
    const { w, a, b, c } = setup(); const all = [a, b, c], red = all.filter(x => x.p.mg.team === 0);
    for (let i = 0; i < 30 && w.mg.state === 'play'; i++) { const k = red[0]; const victim = all.find(x => x.p.mg.team === 1); victim.p.mg.alive = true; w.mg.kill(victim.p, k.p, 'Rifle'); }
    expect(w.mg.state).toBe('end'); expect(w.mg.winner).toBe('RED TEAM'); expect(w.mg.snapshot().teams[0]).toBe(30);
    for (const m of red) expect(m.p.mg.wins).toBe(1);
  });
});

describe('gun game', () => {
  it('forces the ladder weapon, levels up on a kill with a refill, and a kill with the last weapon wins', () => {
    const { w, mk } = arena('gungame'); const a = mk('A'), b = mk('B'); tickFor(w, 9); const { cx, cz, gy } = w.mg;
    a.p.x = cx - 5.5; a.p.y = gy; a.p.z = cz + 3.5; b.p.x = cx - 1.5; b.p.y = gy; b.p.z = cz + 3.5;
    w.handle(a.p, { t: 'shoot', w: 3, dx: 1, dy: 0, dz: 0 }); // asks for sniper, but level 0 = pistol
    expect(a.p.mg.ammo[0]).toBe(WEAPONS[0].mag - 1); expect(a.p.mg.ammo[3]).toBe(WEAPONS[3].mag);
    expect(last(a.ws, 'hp').gw).toBe(0);
    w.mg.kill(b.p, a.p, 'Pistol'); expect(a.p.mg.level).toBe(1); expect(last(a.ws, 'hp').gw).toBe(2); expect(a.p.mg.ammo[0]).toBe(WEAPONS[0].mag);
    for (let i = 0; i < 2; i++) { b.p.mg.alive = true; w.mg.kill(b.p, a.p, 'x'); }
    expect(a.p.mg.level).toBe(3); expect(w.mg.state).toBe('play');
    b.p.mg.alive = true; w.mg.kill(b.p, a.p, 'Sniper'); expect(w.mg.state).toBe('end'); expect(w.mg.winner).toBe('A');
  });
});
