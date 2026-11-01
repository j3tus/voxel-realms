// Room planning. A "room" is one running instance of a game mode. Every mode keeps its base room (the hub world); when all of a
// mode's rooms are filling up we open automatic extra rooms, sized by what the server can still carry, and close them when empty.
// Pure functions so the policy is unit-tested; server/index.js executes the plan.
export const AUTO_MODES = ['pvp', 'tdm', 'gungame', 'zombies', 'raid', 'td', 'royale', 'hide', 'ctf', 'snd', 'bedwars'];
export const ROOM_MODES = AUTO_MODES;
export const MODE_TITLE = { pvp: 'Gun Arena', tdm: 'Team Deathmatch', gungame: 'Gun Game', zombies: 'Zombies', raid: 'Boss Raid', td: 'Tower Defence', royale: 'Battle Royale', hide: 'Hide & Seek', ctf: 'Capture the Flag', snd: 'Search & Destroy', bedwars: 'Bed Wars', parkour: 'Parkour', spleef: 'Spleef' };
export const LIMITS = { maxAutoPerMode: 3, fillAt: .6, emptyCloseMs: 120000, minRoom: 4, maxRoom: 16 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** size and bot count for a new automatic room: alternates small/large, never bigger than capacity allows, bots shrink under load */
export function roomSpec(autoCount, cap) {
  const want = autoCount % 2 === 0 ? 8 : 16, size = clamp(Math.min(want, cap.maxRoom || 0), LIMITS.minRoom, LIMITS.maxRoom);
  const bots = Math.min(Math.floor(size / 2), Math.round(size * .5 * (cap.botDensity ?? 1)));
  return { players: size, bots };
}

/**
 * rooms: [{ id, mode, humans, max, source: 'base'|'auto'|'admin'|'player', idleMs, pinned }]
 * cap: result of computeCapacity. Returns { open: [{ mode, players, bots }], close: [id] }.
 */
export function planAutoRooms(rooms, cap, limits = LIMITS) {
  const open = [], close = []; let budgetCap = cap;
  for (const mode of AUTO_MODES) {
    const group = rooms.filter(r => r.mode === mode && r.source !== 'player'), autos = group.filter(r => r.source === 'auto');
    if (!group.length) continue;                                   // modes without a base room are not part of this hub
    for (const r of autos) if (!r.humans && !r.pinned && (r.idleMs > limits.emptyCloseMs || cap.level === 'full')) close.push(r.id);
    const live = group.filter(r => !close.includes(r.id)), seats = live.filter(r => r.humans < r.max);
    const demand = live.some(r => r.humans > 0), crowded = !seats.length || seats.every(r => r.humans / r.max >= limits.fillAt);
    if (!demand || !crowded || autos.filter(r => !close.includes(r.id)).length >= limits.maxAutoPerMode || open.length >= 2) continue;
    const spec = roomSpec(autos.length, cap);
    if (!budgetCap.canOpen(spec.players, spec.bots)) continue;
    open.push({ mode, ...spec });
    budgetCap = { ...budgetCap, free: budgetCap.free - spec.players * .35 - spec.bots * .35 - 1, canOpen: (p, b) => budgetCap.level !== 'full' && budgetCap.free - spec.players * .35 - spec.bots * .35 - 1 >= p * .35 + b * .35 + 1 };
  }
  return { open, close };
}

/** clamp a player-requested custom game to what the server can carry right now. Returns { players, bots } or { error } */
export function fitCustomGame({ players, bots }, cap, { force = false } = {}) {
  const ceil = force ? 32 : Math.max(0, cap.maxRoom);
  if (!force && (cap.level === 'full' || ceil < 2)) return { error: `The server is at capacity right now (${cap.free} slots free). Try again in a minute, or join an open game with /rooms.` };
  const p = clamp(Math.floor(players ?? 8), 2, ceil), b = clamp(Math.floor(bots ?? Math.min(4, p - 1)), 0, Math.max(0, p - 1));
  const bb = force ? b : Math.min(b, Math.floor(b * (cap.botDensity ?? 1) + .5));
  if (!force && !cap.canOpen(p, bb)) return { error: `Not enough capacity for ${p} players${bb ? ' + ' + bb + ' bots' : ''}: ${cap.free} slots free. Try a smaller game (max ${Math.max(2, cap.maxRoom)}).`, hint: Math.max(2, cap.maxRoom) };
  return { players: p, bots: bb, trimmed: p !== players || bb !== bots };
}
