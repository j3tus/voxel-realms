import { describe, it, expect } from 'vitest';
import { createWorldGen, hash3, seedFromText } from '../shared/worldgen.js';
import { meshChunk } from '../shared/mesher.js';
import { CS, CH, B } from '../shared/blocks.js';
import { MobSim, MOB } from '../shared/mobs.js';
import { newEconomy, sell, buy, quoteBuy, sellPrice, buyPrice, tickEconomy, genBounties, BASE } from '../shared/economy.js';
import { parseGame } from '../server/protocol.js';

describe('worldgen', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = createWorldGen(1234, { type: 'normal' }).genChunk(3, -2), b = createWorldGen(1234, { type: 'normal' }).genChunk(3, -2), c = createWorldGen(999, { type: 'normal' }).genChunk(3, -2);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false);
  });
  it('produces solid ground and sensible bounds', () => {
    const wg = createWorldGen(42, {}); const { data, maxY } = wg.genChunk(0, 0);
    expect(data.length).toBe(CS * CS * CH); expect(maxY).toBeGreaterThan(20);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) expect(data[x + 16 * z]).not.toBe(0);
  });
  it('flat terrain is flat', () => { const wg = createWorldGen(5, { type: 'flat' }); const hs = [0, 50, -90, 300].map(v => wg.terrainH(v, v * 2)); expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(2); });
  it('finds dry land to spawn on', () => { const [x, y, z] = createWorldGen(7, {}).findSpawn(); expect(y).toBeGreaterThan(20); expect(Number.isFinite(x + z)).toBe(true); });
  it('seed text is stable', () => { expect(seedFromText('hello')).toBe(seedFromText('hello')); expect(seedFromText('123')).toBe(123); });
  it('hash3 is uniform-ish in [0,1)', () => { let s = 0; for (let i = 0; i < 2000; i++) { const v = hash3(i, i * 3, 7, 1); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); s += v; } expect(s / 2000).toBeGreaterThan(.45); expect(s / 2000).toBeLessThan(.55); });
});

describe('mesher', () => {
  const empty = () => new Uint8Array(CS * CS * CH), one = d => [null, null, null, null, d, null, null, null, null];
  it('meshes a lone block as 6 quads', () => {
    const d = empty(); d[8 + 16 * (8 + 16 * 30)] = B.STONE; const m = meshChunk(one(d), 40);
    expect(m.O.pos.length / 3).toBe(24); expect(m.O.idx.length).toBe(36); expect(m.T).toBeNull(); expect(m.W).toBeNull(); expect(m.O.blk.length).toBe(24); expect(m.O.sky.length).toBe(24);
  });
  it('culls faces between adjacent opaque blocks', () => { const d = empty(); d[8 + 16 * (8 + 16 * 30)] = B.STONE; d[9 + 16 * (8 + 16 * 30)] = B.STONE; expect(meshChunk(one(d), 40).O.pos.length / 3).toBe(40); });
  it('routes water and glass to transparent groups', () => { const d = empty(); d[2 + 16 * (2 + 16 * 10)] = B.WATER; d[6 + 16 * (6 + 16 * 10)] = B.GLASS; const m = meshChunk(one(d), 20); expect(m.W).not.toBeNull(); expect(m.T).not.toBeNull(); expect(m.O).toBeNull(); });
  it('emissive glowstone lights nearby faces', () => { const d = empty(); d[8 + 16 * (8 + 16 * 30)] = B.GLOWSTONE; d[10 + 16 * (8 + 16 * 30)] = B.STONE; expect(Math.max(...meshChunk(one(d), 40).O.blk)).toBeGreaterThan(.3); });
  it('skylight darkens covered voxels', () => {
    const d = empty(); for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) d[x + 16 * (z + 16 * 40)] = B.STONE; d[8 + 16 * (8 + 16 * 20)] = B.STONE;
    const sky = Array.from(meshChunk(one(d), 45).O.sky); expect(Math.min(...sky)).toBeLessThan(.5); expect(Math.max(...sky)).toBeGreaterThan(.9);
  });
});

describe('economy', () => {
  it('selling lowers the price and the market recovers', () => {
    const e = newEconomy(), p0 = sellPrice(e, B.GOLD); expect(sell(e, B.GOLD, 20)).toBeGreaterThan(0); expect(sellPrice(e, B.GOLD)).toBeLessThan(p0);
    for (let i = 0; i < 5000; i++) tickEconomy(e, 1); expect(e.mult[B.GOLD]).toBeGreaterThan(.95);
  });
  it('buying costs more than selling and raises prices', () => {
    const e = newEconomy(); expect(buyPrice(e, B.PLANKS)).toBeGreaterThan(sellPrice(e, B.PLANKS)); const before = e.mult[B.PLANKS], q = quoteBuy(e, B.PLANKS, 10); expect(buy(e, B.PLANKS, 10)).toBe(q); expect(e.mult[B.PLANKS]).toBeGreaterThan(before);
  });
  it('bounties are valid and profitable', () => { const bs = genBounties(); expect(bs.length).toBe(3); for (const b of bs) { expect(BASE[b.id]).toBeGreaterThan(0); expect(b.reward).toBeGreaterThan(BASE[b.id] * b.qty); } });
});

describe('mob simulation', () => {
  const flat = { getB: (x, y) => (y <= 10 ? 3 : 0), hasChunk: () => true };
  it('mobs fall to the floor and stay there', () => {
    const sim = new MobSim(flat), m = sim.spawn('pig', 5.5, 14, 5.5); for (let i = 0; i < 100; i++) sim.update(.05, [{ id: 1, x: 5, y: 11, z: 5 }], { night: false, sunElev: 1 });
    expect(m.y).toBeCloseTo(11, 1); expect(m.onGround).toBe(true);
  });
  it('zombies attack players that stand next to them', () => {
    const sim = new MobSim(flat), z = sim.spawn('zombie', 5.5, 11, 6.5); let hit = false;
    for (let i = 0; i < 80 && !hit; i++) { sim.update(.05, [{ id: 7, x: 5.5, y: 11, z: 5.5 }], { night: true, sunElev: -.5 }); hit = sim.drainEvents().some(e => e.t === 'dmg' && e.pid === 7); }
    expect(hit).toBe(true); expect(z.hp).toBe(MOB.zombie.hp);
  });
  it('hits knock back and kill', () => { const sim = new MobSim(flat), m = sim.spawn('pig', 0, 11, 0); expect(sim.hit(m.id, 3, -1, 0).killed).toBe(false); expect(sim.hit(m.id, 99, -1, 0).killed).toBe(true); expect(sim.mobs.size).toBe(0); });
  it('daylight burns zombies', () => { const sim = new MobSim(flat); sim.spawn('zombie', 50, 11, 50); for (let i = 0; i < 200; i++) sim.update(.05, [{ id: 1, x: 0, y: 11, z: 0 }], { night: false, sunElev: 1 }); expect([...sim.mobs.values()].filter(m => m.type === 'zombie').length).toBe(0); });
  it('respects spawn caps', () => { const sim = new MobSim(flat); for (let i = 0; i < 400; i++) sim.update(.05, [{ id: 1, x: 0, y: 11, z: 0 }], { night: true, sunElev: -.5 }); expect(sim.counts().pig).toBeLessThanOrEqual(MOB.pig.cap); });
});

describe('protocol validation', () => {
  const p = o => parseGame(JSON.stringify(o));
  it('accepts well-formed messages', () => { expect(p({ t: 'block', x: 1, y: 2, z: 3, id: 5 })).toBeTruthy(); expect(p({ t: 'chat', text: 'hi' })).toBeTruthy(); expect(p({ t: 'pos', x: 1, y: 2, z: 3 })).toBeTruthy(); });
  it('rejects malformed, oversized and hostile input', () => {
    expect(parseGame('not json')).toBeNull(); expect(p({ t: 'block', x: 1.5, y: 2, z: 3, id: 5 })).toBeNull(); expect(p({ t: 'block', x: 1, y: 2, z: 3, id: 999 })).toBeNull();
    expect(p({ t: 'chat', text: 'x'.repeat(500) })).toBeNull(); expect(p({ t: 'trade', action: 'steal', id: 1, n: 1 })).toBeNull(); expect(p({ t: 'trade', action: 'buy', id: 1, n: 100000 })).toBeNull(); expect(p({ t: 'nope' })).toBeNull();
  });
});
