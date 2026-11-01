import { describe, it, expect } from 'vitest';
import { GameWorld } from '../server/world.js';

const hooks = { log() {}, event() {}, motd: () => '', save() {}, worlds: () => [] };
const mk = mode => { const w = new GameWorld({ id: 't', name: 't', seed: 11, type: 'flat', mode, economy: false, mobs: false, maxPlayers: 16, bots: 0 }, null, hooks); const [sx, , sz] = w.spawn; for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) w.chunk(Math.floor(sx / 16) + a, Math.floor(sz / 16) + b); w.mg.build(); return w.mg; };
const rad = (mg, x, z) => Math.hypot(x - mg.cx - .5, z - mg.cz - .5);

describe('round arenas', () => {
  for (const mode of ['pvp', 'tdm', 'gungame', 'ctf', 'snd', 'bedwars', 'hide', 'zombies', 'raid']) {
    it(`${mode}: every spawn (both teams) is inside the wall, on open ground`, () => {
      const mg = mk(mode); for (let team = 0; team < 2; team++) for (let i = 0; i < 120; i++) { mg.spawnTeam = team; const [x, y, z] = mg.spawnPoint(i); expect(rad(mg, x, z)).toBeLessThan(13); expect(mg.w.getB(Math.floor(x), Math.floor(y), Math.floor(z))).toBe(0); expect(mg.w.getB(Math.floor(x), Math.floor(y) + 1, Math.floor(z))).toBe(0); expect(mg.w.getB(Math.floor(x), Math.floor(y) - 1, Math.floor(z))).not.toBe(0); }
    });
  }
  it('team bases (flags, bomb site, beds) sit inside the wall', () => {
    const c = mk('ctf'); for (const f of c.flags) expect(rad(c, f.home[0], f.home[2])).toBeLessThan(12.5);
    const s = mk('snd'); expect(rad(s, s.site[0], s.site[2])).toBeLessThan(12.5);
    const b = mk('bedwars'); for (const t of [0, 1]) { const [x, , z] = b.bedBlocks(t)[0]; expect(rad(b, x, z)).toBeLessThan(12.5); }
  });
});
