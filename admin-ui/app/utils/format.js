export const fmtUp = s => { s = s | 0; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m` }
export const fmtMB = b => (b / 1048576).toFixed(0) + ' MB'
export const fmtKB = b => (b / 1024).toFixed(b > 1048576 ? 0 : 1)
export const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB'
export const fmtClock = t => { const s = Math.max(0, t | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
export const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000 | 0); return s < 60 ? s + 's ago' : s < 3600 ? (s / 60 | 0) + 'm ago' : s < 86400 ? (s / 3600 | 0) + 'h ago' : (s / 86400 | 0) + 'd ago' }
export const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's')
export const GAME_TITLE = { pvp: 'Gun Arena', tdm: 'Team Deathmatch', gungame: 'Gun Game', zombies: 'Zombies', royale: 'Battle Royale', ctf: 'Capture the Flag', hide: 'Hide & Seek', snd: 'Search & Destroy', bedwars: 'Bed Wars', raid: 'Boss Raid', td: 'Tower Defence', parkour: 'Parkour', spleef: 'Spleef', lobby: 'Lobby', creative: 'Creative', survival: 'Survival' }
export const gameState = sw => {
  const g = sw && sw.game
  if (!g) return { cls: 'info', label: sw && sw.humans ? 'Open' : 'Idle', live: false }
  if (g.state === 'play') return { cls: 'ok', label: 'In play', time: fmtClock(g.time), live: true }
  if (g.state === 'end') return { cls: 'warn', label: g.winner ? 'Won: ' + g.winner : 'Round over', live: false }
  return { cls: 'info', label: sw.humans ? 'Starting ' + fmtClock(g.time) : 'Waiting', live: false }
}

export const BLOCK_NAMES = ['Air', 'Grass', 'Dirt', 'Stone', 'Sand', 'Oak Log', 'Leaves', 'Water', 'Planks', 'Glass', 'Bricks', 'Snow', 'Cobblestone', 'Coal Ore', 'Gold Ore', 'Clay', 'Gravel', 'Iron Ore', 'Diamond Ore', 'White Wool', 'Red Wool', 'Blue Wool', 'Stone Bricks', 'Dark Planks', 'Sandstone', 'Obsidian', 'Ice', 'Bookshelf', 'Glowstone', 'Gold Block', 'Diamond Block']
export const blockName = id => BLOCK_NAMES[id] || ('Block ' + id)
