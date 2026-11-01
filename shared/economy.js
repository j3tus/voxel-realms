// Economy rules shared by singleplayer and the server: coin prices that react to supply and demand, plus rotating bounties.
export const CURRENCY = 'Coins';
export const BASE = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 3, 6: 1, 8: 1, 9: 3, 10: 6, 11: 1, 12: 1, 13: 6, 14: 25, 15: 2, 16: 1, 17: 12, 18: 70, 19: 4, 20: 5, 21: 5, 22: 3, 23: 2, 24: 2, 25: 30, 26: 3, 27: 12, 28: 25, 29: 120, 30: 300 };
export const SELLABLE = Object.keys(BASE).map(Number);
export const BUYABLE = [1, 2, 3, 4, 5, 8, 9, 10, 12, 19, 20, 21, 22, 23, 24, 26, 27, 28];
export const MOB_REWARD = { pig: 2, zombie: 6, villager: 0 };
const BOUNTY_POOL = [5, 2, 3, 4, 12, 13, 14, 15, 16, 17, 8, 9, 19];

export function newEconomy() {
  const mult = {}; for (const id of SELLABLE) mult[id] = 1;
  return { mult, bounties: [], bountyAt: 0 };
}
export const sellPrice = (eco, id) => Math.max(1, Math.round((BASE[id] || 0) * (eco.mult[id] ?? 1)));
export const buyPrice = (eco, id) => Math.max(2, Math.round((BASE[id] || 1) * 2.2 * (eco.mult[id] ?? 1) + 1));
/** Selling floods the market: each unit lowers the price a little. Returns coins earned. */
export function sell(eco, id, n) {
  let total = 0;
  for (let i = 0; i < n; i++) { total += sellPrice(eco, id); eco.mult[id] = Math.max(.35, (eco.mult[id] ?? 1) * .985); }
  return total;
}
export function quoteBuy(eco, id, n) { let m = eco.mult[id] ?? 1, t = 0; for (let i = 0; i < n; i++) { t += Math.max(2, Math.round((BASE[id] || 1) * 2.2 * m + 1)); m = Math.min(2.5, m * 1.01); } return t; }
export function buy(eco, id, n) { const t = quoteBuy(eco, id, n); eco.mult[id] = Math.min(2.5, (eco.mult[id] ?? 1) * Math.pow(1.01, n)); return t; }
export function tickEconomy(eco, dt) { for (const id in eco.mult) eco.mult[id] += (1 - eco.mult[id]) * Math.min(1, dt * .002); }

export function genBounties(rng = Math.random, count = 3) {
  const pool = [...BOUNTY_POOL], out = [];
  while (out.length < count && pool.length) {
    const id = pool.splice(rng() * pool.length | 0, 1)[0], base = BASE[id];
    const qty = Math.max(3, Math.round((40 / Math.max(1, base)) * (.4 + rng() * .6)));
    out.push({ id, qty: Math.min(48, qty), reward: Math.round(base * qty * 1.8 + 10), taken: false, uid: Math.random().toString(36).slice(2, 8) });
  }
  return out;
}
export function snapshotPrices(eco) { const o = {}; for (const id of SELLABLE) o[id] = [sellPrice(eco, id), BUYABLE.includes(id) ? buyPrice(eco, id) : 0]; return o; }
