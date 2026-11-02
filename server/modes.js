// Hypixel-style minigames layered on a GameWorld: 'pvp' (gun arena, free-for-all) and 'spleef' (break the snow floor, last one standing).
import { B } from '../shared/blocks.js';
import { WEAPONS, HEAD_MULT, rayBox, rayBlocks } from '../shared/weapons.js';
import { MOB } from '../shared/mobs.js';

const R = 14; // arena half-size / radius
/** Arena themes. Each room picks one from its seed, so rooms of the same game look different. */
const THEMES = [
  { name: 'Fortress', floorA: B.STONE_BRICK, floorB: B.COBBLE, wall: B.STONE_BRICK, trim: B.OBSIDIAN, cover: B.DARK_PLANKS, accent: B.GLOWSTONE, roof: B.GLASS },
  { name: 'Dunes', floorA: B.SANDSTONE, floorB: B.SAND, wall: B.SANDSTONE, trim: B.BRICK, cover: B.SANDSTONE, accent: B.GOLD_BLOCK, roof: B.GLASS },
  { name: 'Frost', floorA: B.SNOW, floorB: B.STONE, wall: B.STONE_BRICK, trim: B.ICE, cover: B.SNOW, accent: B.GLASS, roof: B.GLASS },
  { name: 'Nether', floorA: B.BRICK, floorB: B.OBSIDIAN, wall: B.BRICK, trim: B.OBSIDIAN, cover: B.OBSIDIAN, accent: B.GLOWSTONE, roof: B.GLASS },
];
const DECOR_MODES = ['pvp', 'tdm', 'gungame', 'zombies', 'hide']; // modes whose objectives do not depend on the old open layout
const ROUND_ARENAS = ['pvp', 'tdm', 'gungame', 'ctf', 'snd', 'bedwars', 'hide', 'zombies', 'raid']; // every mode built by the base class is a circular arena, so every one must spawn inside the circle
export const ARENA_MODES = ['pvp', 'tdm', 'gungame', 'zombies', 'royale', 'ctf', 'hide', 'snd', 'bedwars', 'raid', 'td', 'parkour', 'spleef', 'lobby'];
export const FPS_MODES = ['pvp', 'tdm', 'gungame', 'zombies', 'royale', 'ctf', 'hide', 'snd', 'bedwars', 'raid', 'td'];
export const TEAM_SIDE_MODES = ['tdm', 'ctf', 'snd', 'bedwars'];
const GG_ORDER = [0, 2, 1, 3]; // Gun Game ladder: pistol -> shotgun -> rifle -> sniper (a kill with the sniper wins)
const TDM_KILLS = 30;
const TEAMS = ['RED', 'BLUE'];
const PVP_KILLS = 15, PVP_TIME = 240, SPLEEF_TIME = 180, LOBBY = 8, END = 7, RESPAWN = 3;

const HIT_HW = .42; // slightly wider than the 0.6 body: forgives client/server latency on moving targets
export class Minigame {
  constructor(world) {
    this.w = world; this.kind = world.meta.mode; this.fps = FPS_MODES.includes(this.kind); this.winTeam = -1; this.state = 'lobby'; this.t = LOBBY; this.winner = ''; this.built = false; this.round = 0;
    const [sx, sy, sz] = world.spawn; this.cx = Math.floor(sx); this.cz = Math.floor(sz); this.gy = Math.floor(sy);
    this.floorY = this.gy + 9;
  }

  /* ---------- arena construction (through setBlock so it persists and syncs to clients) ---------- */
  theme() { return DECOR_MODES.includes(this.kind) ? THEMES[Math.abs(this.w.meta.seed | 0) % THEMES.length] : THEMES[0]; }
  build() {
    const w = this.w, { cx, cz, gy } = this, th = this.theme();
    if (this.fps) {
      // round arena: a circular floor and a wall ring. Anything outside the circle (e.g. the corners of an older square arena) is cleared back to ground.
      for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
        const r = Math.hypot(x, z);
        if (r > R + .5) { if (Math.abs(x) <= R && Math.abs(z) <= R) { w.setBlock(cx + x, gy - 1, cz + z, B.GRASS); for (let y = 0; y < 9; y++) w.setBlock(cx + x, gy + y, cz + z, 0); } continue; }
        const edge = r > R - 1.1, spoke = DECOR_MODES.includes(this.kind) && (x === 0 || z === 0) && r < 11;
        w.setBlock(cx + x, gy - 1, cz + z, edge ? th.trim : spoke ? th.accent === B.GLASS ? th.floorB : th.floorB : (Math.floor(r / 3) % 2 ? th.floorA : th.floorB));
        for (let y = 0; y < 9; y++) w.setBlock(cx + x, gy + y, cz + z, y < 5 && edge ? (y < 4 ? th.wall : th.roof) : 0);
      }
      if (DECOR_MODES.includes(this.kind)) this.decorate(th);
      else { const cover = [[-6, -6], [6, 6], [-6, 6], [6, -6], [0, 0], [0, -9], [0, 9], [-9, 0], [9, 0]];
        for (const [x, z] of cover) for (let y = 0; y < 3; y++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) w.setBlock(cx + x + a, gy + y, cz + z + b, y === 2 ? B.GLASS : B.DARK_PLANKS); }
    } else this.buildFloor();
    this.built = true;
  }
  /** the full layout: buttressed lit walls, raised centre with stairs, a pinwheel of low cover forming lanes, and four sniper towers with stairs */
  decorate(th) {
    const w = this.w, { cx, cz, gy } = this, put = (x, y, z, id) => w.setBlock(cx + x, gy + y, cz + z, id);
    // buttress pillars and lamps along the wall
    for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, x = Math.round(Math.cos(a) * (R - 1.6)), z = Math.round(Math.sin(a) * (R - 1.6)); for (let y = 0; y < 4; y++) put(x, y, z, th.trim); put(x, 4, z, th.accent); }
    // raised centre (two blocks high) with a stair on each side
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { const r = Math.hypot(x, z); if (r > 3.6) continue; put(x, 0, z, th.floorA); put(x, 1, z, r > 2.8 ? th.trim : th.floorA); }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let s = 0; s < 2; s++) for (let w2 = -1; w2 <= 1; w2++) { const x = dx ? dx * (4 + s) : w2, z = dz ? dz * (4 + s) : w2; for (let y = 0; y <= 1 - s; y++) put(x, y, z, th.floorB); }
    put(0, 2, 0, th.accent); put(0, 3, 0, B.AIR ?? 0);
    // pinwheel of low cover (2 high, jump-over) at r=7..8: four arcs, each with a gap so lanes stay open
    for (let k = 0; k < 4; k++) for (let d = 0; d <= 46; d += 3) { const a = (k * 90 + 12 + d) * Math.PI / 180; for (const rr of [7.2, 8.2]) { const x = Math.round(Math.cos(a) * rr), z = Math.round(Math.sin(a) * rr); for (let y = 0; y < 2; y++) put(x, y, z, y ? th.trim : th.cover); } }
    // sniper towers on the diagonals: 4 pillars, a 5x5 deck 4 up with rails, and a staircase up one side
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const tx = sx * 8, tz = sz * 8;
      for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) for (let y = 0; y < 4; y++) put(tx + px, y, tz + pz, th.trim);
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { put(tx + x, 3, tz + z, th.floorA); if (Math.abs(x) === 2 || Math.abs(z) === 2) if (!(z === 2 * -sz && Math.abs(x) <= 1)) put(tx + x, 4, tz + z, th.cover); }
      put(tx, 4, tz, 0); put(tx + 2 * sx, 5, tz + 2 * sz, th.accent);
      for (let s = 0; s < 3; s++) for (let w2 = -1; w2 <= 1; w2++) { const x = tx + w2, z = tz - sz * (3 + s); for (let y = 0; y <= s; y++) put(x, y, z, th.floorB); } // stairs leading to the deck's open edge
      for (let w2 = -1; w2 <= 1; w2++) put(tx + w2, 3, tz - sz * 3, th.floorA);
    }
  }
  buildFloor() {
    const w = this.w, { cx, cz, floorY } = this;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) { const inside = Math.hypot(x, z) <= R + .5; w.setBlock(cx + x, floorY, cz + z, inside ? B.SNOW : 0); w.setBlock(cx + x, floorY + 1, cz + z, 0); w.setBlock(cx + x, floorY + 2, cz + z, 0); } // round spleef platform
  }
  spawnPoint(i) {
    if (this.kind === 'spleef') { const a = (i * 2.399) % (Math.PI * 2), r = 3 + (i * 1.7) % 9; return [this.cx + .5 + Math.cos(a) * r, this.floorY + 1, this.cz + .5 + Math.sin(a) * r]; }
    const round = ROUND_ARENAS.includes(this.kind);
    for (let k = 0; k < 20; k++) {
      const side = TEAM_SIDE_MODES.includes(this.kind) && typeof this.spawnTeam === 'number' ? (this.spawnTeam === 0 ? -1 : 1) : 0;
      let x, z;
      if (round) { // uniform point in the circle; team modes mirror it onto their half
        const rr = (R - 3) * Math.sqrt(Math.random()), an = Math.random() * Math.PI * 2; let dx = Math.floor(rr * Math.cos(an)); if (side && Math.sign(dx || side) !== side) dx = -dx; if (side && !dx) dx = side;
        x = this.cx + dx; z = this.cz + Math.floor(rr * Math.sin(an));
      } else { x = side ? this.cx + side * (R - 3 - Math.floor(Math.random() * 3)) : this.cx + Math.floor((Math.random() * 2 - 1) * (R - 2)); z = this.cz + Math.floor((Math.random() * 2 - 1) * (R - 2)); }
      if (!this.w.getB(x, this.gy, z) && !this.w.getB(x, this.gy + 1, z)) return [x + .5, this.gy, z + .5];
    }
    return [this.cx + .5, this.gy, this.cz + 3.5];
  }

  /* ---------- players ---------- */
  onJoin(p) {
    p.mg = { hp: 20, kills: 0, deaths: 0, alive: this.state !== 'play', lastShot: 0, ammo: WEAPONS.map(x => x.mag), reloadAt: 0, respawnAt: 0, wins: 0, team: this.nextTeam(), level: 0 };
    if (!this.built) this.build();
    this.place(p); this.sendState(p); this.broadcastBoard();
  }
  onLeave() { this.broadcastBoard(); }
  nextTeam() { const c = [0, 0]; for (const q of this.list()) c[q.mg.team | 0]++; return c[0] <= c[1] ? 0 : 1; }
  place(p, i = this.w.players.size + Math.floor(Math.random() * 7)) { this.spawnTeam = p.mg?.team; const [x, y, z] = this.spawnPoint(i); p.x = x; p.y = y; p.z = z; this.w.send(p, { t: 'tp', x, y, z }); }
  list() { return [...this.w.players.values()].filter(p => p.mg); }
  teamScore() { const t = [0, 0]; for (const q of this.list()) t[q.mg.team | 0] += q.mg.kills; return t; }
  board() { return this.list().map(p => ({ id: p.id, name: p.name, k: p.mg.kills, d: p.mg.deaths, alive: p.mg.alive, w: p.mg.wins, team: p.mg.team | 0, lv: p.mg.level | 0 })).sort((a, b) => b.k - a.k || a.d - b.d); }
  snapshot() { return { t: 'mg', kind: this.kind, state: this.state, time: Math.ceil(this.t), winner: this.winner, board: this.board().slice(0, 10), goal: this.kind === 'pvp' ? PVP_KILLS : this.kind === 'tdm' ? TDM_KILLS : this.kind === 'gungame' ? GG_ORDER.length : 0, teams: this.kind === 'tdm' ? this.teamScore() : undefined }; }
  broadcastBoard() { this.w.broadcast(this.snapshot()); }
  sendState(p) { this.w.send(p, this.snapshot()); this.sendHp(p); }
  /** -1 free choice, >=0 forced weapon index, -2 disarmed (client can't fire) */
  gunLock(p) { return this.kind === 'gungame' ? GG_ORDER[Math.min(p.mg.level, GG_ORDER.length - 1)] : -1; }
  canHit(p, q) { return this.kind !== 'tdm' || q.mg.team !== p.mg.team; }
  mobKilled() { /* hook */ }
  blockShot() { /* hook: a bullet hit the block at (x, y, z) */ }
  sendHp(p) { this.w.send(p, { t: 'hp', hp: p.mg.hp, ammo: p.mg.ammo, gw: this.gunLock(p), team: p.mg.team | 0 }); }

  /* ---------- combat ---------- */
  shoot(p, m) {
    if (!this.fps || this.state !== 'play' || !p.mg.alive) return;
    let wi = m.w | 0; const lock = this.gunLock(p); if (lock === -2) return; if (lock >= 0) wi = lock; const wp = WEAPONS[wi]; if (!wp) return; const now = Date.now(), g = p.mg;
    if (now < g.reloadAt || now - g.lastShot < wp.rate * 1000 * .9 || g.ammo[wi] <= 0) return;
    const d = [m.dx, m.dy, m.dz]; if (!d.every(Number.isFinite)) return; const l = Math.hypot(...d); if (l < .5 || l > 1.5) return;
    g.lastShot = now; g.ammo[wi]--;
    const ox = p.x, oy = p.y + 1.62, oz = p.z, tracers = [];
    for (let i = 0; i < wp.pellets; i++) {
      const dx = d[0] / l + (Math.random() - .5) * wp.spread * 2, dy = d[1] / l + (Math.random() - .5) * wp.spread * 2, dz = d[2] / l + (Math.random() - .5) * wp.spread * 2, n = Math.hypot(dx, dy, dz);
      const ux = dx / n, uy = dy / n, uz = dz / n;
      let best = rayBlocks(this.w.getB.bind(this.w), ox, oy, oz, ux, uy, uz, wp.range), hit = null, head = false, mobHit = null;
      for (const q of this.list()) {
        if (q === p || !q.mg.alive || !this.canHit(p, q)) continue;
        const t = rayBox(ox, oy, oz, ux, uy, uz, q.x - HIT_HW, q.y - .05, q.z - HIT_HW, q.x + HIT_HW, q.y + 1.85, q.z + HIT_HW);
        if (t >= 0 && t < best) { best = t; hit = q; head = oy + uy * t > q.y + 1.4; }
      }
      for (const mb of this.w.sim.mobs.values()) {
        const md = MOB[mb.type] || MOB.zombie, hw = Math.max(.35, md.w / 2), t = rayBox(ox, oy, oz, ux, uy, uz, mb.x - hw, mb.y, mb.z - hw, mb.x + hw, mb.y + Math.max(1.2, md.h), mb.z + hw);
        if (t >= 0 && t < best) { best = t; hit = null; mobHit = mb; }
      }
      if (!hit && !mobHit && best < wp.range) this.blockShot(p, Math.floor(ox + ux * best), Math.floor(oy + uy * best), Math.floor(oz + uz * best));
      tracers.push([+(ox + ux * best).toFixed(2), +(oy + uy * best).toFixed(2), +(oz + uz * best).toFixed(2)]);
      if (hit) this.damage(hit, Math.round(wp.dmg * (head ? HEAD_MULT : 1)), p, head, wp.name);
      else if (mobHit) { const res = this.w.sim.hit(mobHit.id, wp.dmg, p.x, p.z); if (res?.killed) this.mobKilled(p, res.m); }
    }
    this.w.broadcast({ t: 'shot', id: p.id, w: wi, from: [+ox.toFixed(2), +(oy - .15).toFixed(2), +oz.toFixed(2)], to: tracers });
    if (g.ammo[wi] <= 0) this.reload(p, wi); else this.sendHp(p);
  }
  reload(p, wi) {
    const wp = WEAPONS[wi]; if (!wp || !p.mg || Date.now() < p.mg.reloadAt) return;
    p.mg.reloadAt = Date.now() + wp.reload * 1000;
    setTimeout(() => { if (p.mg) { p.mg.ammo[wi] = wp.mag; this.sendHp(p); } }, wp.reload * 1000);
    this.w.send(p, { t: 'reload', w: wi, ms: wp.reload * 1000 });
  }
  damage(q, n, by, head, wname) {
    const g = q.mg; if (!g.alive) return; g.hp = Math.max(0, g.hp - n); this.w.send(q, { t: 'dmg', n: 0, kx: 0, kz: 0 }); this.sendHp(q);
    this.w.send(by, { t: 'hitmark', head, kill: g.hp <= 0 });
    if (g.hp <= 0) this.kill(q, by, wname);
  }
  kill(q, by, wname) {
    const g = q.mg; g.alive = false; g.deaths++; g.respawnAt = Date.now() + RESPAWN * 1000;
    if (by && by !== q) { by.mg.kills++; this.w.addCoins(by, 5, 'earned'); if (this.kind === 'gungame') this.levelUp(by); }
    this.w.broadcast({ t: 'kill', killer: by ? by.name : '', victim: q.name, weapon: wname || '' });
    this.broadcastBoard();
    if (this.kind === 'pvp' && by && by.mg.kills >= PVP_KILLS) this.endRound(by.name);
    else if (this.kind === 'tdm' && this.state === 'play') { const t = this.teamScore(); if (t[0] >= TDM_KILLS || t[1] >= TDM_KILLS) this.endRound(TEAMS[t[0] >= t[1] ? 0 : 1] + ' TEAM', t[0] >= t[1] ? 0 : 1); }
  }

  /** Gun Game: a kill advances the ladder (new weapon, full health + ammo); a kill with the last weapon wins. */
  levelUp(by) {
    const g = by.mg; if (g.level >= GG_ORDER.length - 1) { this.endRound(by.name); return; }
    g.level++; g.hp = 20; g.ammo = WEAPONS.map(x => x.mag); g.reloadAt = 0; this.sendHp(by); this.w.send(by, { t: 'toast', text: `Level ${g.level + 1}/${GG_ORDER.length}: ${WEAPONS[GG_ORDER[g.level]].name}` });
  }

  /* ---------- round state machine (called each server tick) ---------- */
  tick(dt) {
    const players = this.list(); if (!players.length) { this.state = 'lobby'; this.t = LOBBY; return; }
    const now = Date.now();
    if (this.state === 'lobby') {
      if (players.length < 2) { this.t = LOBBY; if (this.w.ticks % 40 === 0) this.broadcastBoard(); return; }
      this.t -= dt; if (this.w.ticks % 20 === 0) this.broadcastBoard(); if (this.t <= 0) this.startRound(players);
    } else if (this.state === 'play') {
      this.t -= dt;
      for (const p of players) {
        const g = p.mg;
        if (this.fps && !g.alive && g.respawnAt && now >= g.respawnAt) { g.alive = true; g.hp = 20; g.ammo = WEAPONS.map(x => x.mag); g.respawnAt = 0; this.place(p); this.sendHp(p); this.broadcastBoard(); }
        if (this.kind === 'spleef' && g.alive && p.y < this.floorY - 2.5) { g.alive = false; g.deaths++; this.w.broadcast({ t: 'kill', killer: '', victim: p.name, weapon: 'fell' }); this.broadcastBoard(); }
        if (this.fps && g.alive && p.y < this.gy - 8) this.kill(p, null, 'void');
      }
      if (this.w.ticks % 20 === 0) this.broadcastBoard();
      if (this.kind === 'spleef') { const alive = players.filter(p => p.mg.alive); if (alive.length <= 1 && players.length >= 2) this.endRound(alive[0]?.name || ''); }
      if (this.t <= 0) { if (this.kind === 'tdm') { const t = this.teamScore(); this.endRound(t[0] === t[1] ? 'DRAW' : TEAMS[t[0] > t[1] ? 0 : 1] + ' TEAM', t[0] === t[1] ? -1 : t[0] > t[1] ? 0 : 1); } else if (this.kind === 'gungame') { const b = this.list().sort((a, c) => c.mg.level - a.mg.level || c.mg.kills - a.mg.kills)[0]; this.endRound(b?.name || ''); } else this.endRound(this.board()[0]?.name || ''); }
    } else {
      this.t -= dt; if (this.w.ticks % 20 === 0) this.broadcastBoard();
      if (this.t <= 0) { this.state = 'lobby'; this.t = LOBBY; for (const p of players) { p.mg.alive = true; p.mg.hp = 20; p.mg.kills = 0; this.place(p); this.sendHp(p); } this.broadcastBoard(); }
    }
  }
  startRound(players) {
    this.round++; this.state = 'play'; this.winner = ''; this.t = this.kind === 'tdm' ? 300 : this.fps ? PVP_TIME : SPLEEF_TIME;
    if (this.kind === 'spleef') this.buildFloor();
    let i = 0; for (const [n, p] of players.entries()) p.mg.team = n % 2; // balanced teams each round
    for (const p of players) { const g = p.mg; g.level = 0; g.alive = true; g.hp = 20; g.kills = 0; g.deaths = 0; g.ammo = WEAPONS.map(x => x.mag); g.reloadAt = 0; this.place(p, i++); this.sendHp(p); }
    this.w.system(`${{ pvp: 'Gun Arena', tdm: 'Team Deathmatch', gungame: 'Gun Game', spleef: 'Spleef' }[this.kind]} round ${this.round} started!`); this.broadcastBoard();
  }
  endRound(name, team = -1) {
    if (this.state !== 'play') return; this.state = 'end'; this.t = END; this.winner = name || 'nobody'; this.winTeam = team;
    if (team >= 0) for (const m of this.list().filter(q => q.mg.team === team)) { m.mg.wins++; this.w.addCoins(m, 25, 'earned'); this.w.send(m, { t: 'toast', text: 'Your team won! +25 coins' }); }
    const win = team >= 0 ? null : this.list().find(p => p.name === name);
    if (win) { win.mg.wins++; this.w.addCoins(win, 25, 'earned'); this.w.send(win, { t: 'toast', text: 'You won! +25 coins' }); }
    this.w.system(`Round over - winner: ${this.winner}`); this.broadcastBoard();
  }
  /** Spleef: only breaking the snow floor during a round is allowed. */
  allowBlock(p, x, y, z, id) { return this.kind === 'spleef' && this.state === 'play' && !!p.mg?.alive && id === 0 && y === this.floorY && this.w.getB(x, y, z) === B.SNOW; }
}
