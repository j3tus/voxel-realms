// Career mode: a ladder of contracts on top of survival + economy. Pure data and logic so it is unit-testable.
import { B } from './blocks.js';

export const RANKS = ['Drifter', 'Apprentice', 'Settler', 'Artisan', 'Trader', 'Hunter', 'Foreman', 'Tycoon'];

/** kind: collect (items gained), kill (mobs of `of`, or 'any'), earn (coins), place (blocks placed) */
export const MISSIONS = [
  { text: 'Chop 5 logs', kind: 'collect', of: B.LOG, n: 5, reward: 15 },
  { text: 'Dig 10 dirt or grass', kind: 'collect', of: B.DIRT, n: 10, reward: 15 },
  { text: 'Build something: place 20 blocks', kind: 'place', n: 20, reward: 25 },
  { text: 'Mine 8 cobblestone', kind: 'collect', of: B.COBBLE, n: 8, reward: 30 },
  { text: 'Hunt 3 pigs', kind: 'kill', of: 'pig', n: 3, reward: 40 },
  { text: 'Earn 100 coins from trading', kind: 'earn', n: 100, reward: 50 },
  { text: 'Find 3 coal', kind: 'collect', of: B.COAL, n: 3, reward: 60 },
  { text: 'Defeat 4 zombies', kind: 'kill', of: 'zombie', n: 4, reward: 90 },
  { text: 'Place 100 blocks', kind: 'place', n: 100, reward: 80 },
  { text: 'Mine 3 iron ore', kind: 'collect', of: B.IRON, n: 3, reward: 120 },
  { text: 'Earn 500 coins', kind: 'earn', n: 500, reward: 200 },
  { text: 'Find a diamond', kind: 'collect', of: B.DIAMOND, n: 1, reward: 400 },
];

export const newCareer = () => ({ step: 0, prog: 0, total: 0 });
export const rankOf = c => RANKS[Math.min(RANKS.length - 1, Math.floor((c?.step || 0) / 1.5))];
export const current = c => MISSIONS[c.step] || null;

/** Feed an event; returns { career, done: mission|null }. Mutates and returns the same career object. */
export function progress(c, ev) {
  const m = current(c); if (!m || ev.kind !== m.kind) return { career: c, done: null };
  if (m.of !== undefined && m.of !== ev.of && !(m.of === B.DIRT && ev.of === B.GRASS)) return { career: c, done: null };
  c.prog += ev.n ?? 1;
  if (c.prog >= m.n) { c.step++; c.prog = 0; c.total += m.reward; return { career: c, done: m }; }
  return { career: c, done: null };
}
