// More minigame modes layered on the Minigame engine (server/modes.js): co-op Zombies, Battle Royale, Capture the Flag,
// Hide & Seek and a Parkour race. Each is a small subclass; modes.js keeps Gun Arena / Team Deathmatch / Gun Game / Spleef.
import { B } from '../shared/blocks.js';
import { WEAPONS } from '../shared/weapons.js';
import { Minigame, ARENA_MODES, FPS_MODES } from './modes.js';

export { ARENA_MODES, FPS_MODES };
const R = 14, LOBBY = 8, END = 7, RESPAWN = 3;
const fullAmmo = () => WEAPONS.map(x => x.mag);
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Shared round loop: lobby countdown -> play -> end -> lobby. Subclasses implement onStart / playTick / timeUp. */
class RoundGame extends Minigame {
  constructor(world) { super(world); this.minPlayers = 2; this.respawns = false; this.roundTime = 180; this.title = 'Minigame'; }
  tick(dt) {
    const players = this.list(), now = Date.now();
    if (!players.length) { this.state = 'lobby'; this.t = LOBBY; return; }
    if (this.state === 'lobby') {
      if (players.length < this.minPlayers) { this.t = LOBBY; if (this.w.ticks % 40 === 0) this.broadcastBoard(); return; }
      this.t -= dt; if (this.w.ticks % 20 === 0) this.broadcastBoard(); if (this.t <= 0) this.startRound(players);
    } else if (this.state === 'play') {
      this.t -= dt;
      if (this.respawns) for (const p of players) { const g = p.mg; if (!g.alive && g.respawnAt && now >= g.respawnAt) { g.alive = true; g.hp = 20; g.ammo = fullAmmo(); g.respawnAt = 0; this.place(p); this.sendHp(p); this.broadcastBoard(); } }
      for (const p of players) if (p.mg.alive && this.fps && p.y < this.gy - 8 && this.kind !== 'royale') this.kill(p, null, 'void');
      this.playTick(players, dt, now);
      if (this.w.ticks % 20 === 0) this.broadcastBoard();
      if (this.state === 'play' && this.t <= 0) this.timeUp(players);
    } else {
      this.t -= dt; if (this.w.ticks % 20 === 0) this.broadcastBoard();
      if (this.t <= 0) { this.state = 'lobby'; this.t = LOBBY; this.resetLobby(players); }
    }
  }
  resetLobby(players) {
    for (const p of players) { const g = p.mg; g.alive = true; g.hp = 20; g.kills = 0; g.ammo = fullAmmo(); g.level = 0; this.place(p); this.sendHp(p); }
    this.onLobby(); this.broadcastBoard();
  }
  startRound(players) {
    this.round++; this.state = 'play'; this.winner = ''; this.winTeam = -1; this.t = this.roundTime;
    players.forEach((p, n) => { const g = p.mg; g.team = n % 2; g.level = 0; g.alive = true; g.hp = 20; g.kills = 0; g.deaths = 0; g.ammo = fullAmmo(); g.reloadAt = 0; g.respawnAt = 0; g.prog = 0; g.cp = 0; });
    this.onStart(players); players.forEach((p, n) => { this.place(p, n); this.sendHp(p); });
    this.w.system(`${this.title} round ${this.round} started!`); this.broadcastBoard();
  }
  kill(q, by, wname) { super.kill(q, by, wname); if (!this.respawns) q.mg.respawnAt = 0; }
  onStart() { /* hook */ } onLobby() { /* hook */ } playTick() { /* hook */ }
  timeUp() { this.endRound(this.board()[0]?.name || ''); }
}

/* ===================================================== Zombies (co-op waves) ===================================================== */
export class Zombies extends RoundGame {
  constructor(w) { super(w); this.minPlayers = 1; this.title = 'Zombies'; this.roundTime = 1800; w.sim.caps = { pig: 0, zombie: 0, villager: 0 }; this.wave = 0; this.toSpawn = 0; this.spawnT = 0; this.rest = 0; }
  canHit() { return false; } // co-op: bullets only hurt zombies
  onStart() { this.wave = 0; this.w.sim.clear(); this.nextWave(); }
  onLobby() { this.w.sim.clear(); }
  nextWave() {
    this.wave++; this.toSpawn = Math.min(48, 3 + 2 * this.wave); this.spawnT = 2.5; this.rest = 0;
    for (const p of this.list()) { const g = p.mg; if (!g.alive) { g.alive = true; this.place(p); } g.hp = Math.min(20, g.hp + 10); g.ammo = fullAmmo(); this.sendHp(p); this.w.send(p, { t: 'toast', text: `Wave ${this.wave}!` }); }
    this.broadcastBoard();
  }
  zombiesAlive() { let n = 0; for (const m of this.w.sim.mobs.values()) if (m.type === 'zombie') n++; return n; }
  playTick(players, dt) {
    this.w.time = .9; // eternal night so zombies never burn
    if (this.toSpawn > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = Math.max(.4, 1.8 - this.wave * .12); this.toSpawn--; const a = Math.random() * 6.283, x = this.cx + .5 + Math.cos(a) * (R - 2), z = this.cz + .5 + Math.sin(a) * (R - 2);
        const m = this.w.sim.spawn('zombie', x, this.gy + 1, z); m.hp = Math.round(m.hp * (1 + .18 * (this.wave - 1)));
      }
    } else if (this.zombiesAlive() === 0) { this.rest += dt; if (this.rest >= 6) this.nextWave(); }
    if (!players.some(p => p.mg.alive)) this.endRound(`Survived ${this.wave - 1} wave${this.wave === 2 ? '' : 's'}`);
  }
  mobDamage(p, n) {
    const g = p.mg; if (!g?.alive || this.state !== 'play') return; g.hp = Math.max(0, g.hp - n); this.w.send(p, { t: 'dmg', n: 0, kx: 0, kz: 0 }); this.sendHp(p);
    if (g.hp <= 0) { g.alive = false; g.deaths++; this.w.broadcast({ t: 'kill', killer: '', victim: p.name, weapon: 'zombie' }); this.broadcastBoard(); }
  }
  mobKilled(p) { if (this.state !== 'play') return; p.mg.kills++; this.w.addCoins(p, 2, 'earned'); }
  endRound(name) { if (this.state !== 'play') return; super.endRound(name); for (const p of this.list()) if (p.mg.kills) this.w.addCoins(p, Math.min(40, this.wave * 3), 'earned'); }
  snapshot() { return { ...super.snapshot(), wave: this.wave, left: this.toSpawn + (this.state === 'play' ? this.zombiesAlive() : 0) }; }
  timeUp() { this.endRound(`Survived ${this.wave} waves`); }
}

/* ===================================================== Battle Royale ===================================================== */
export class Royale extends RoundGame {
  constructor(w) { super(w); this.title = 'Battle Royale'; this.roundTime = 300; this.zone = { x: this.cx, z: this.cz, r: 70 }; this.zoneT = 0; }
  build() { this.built = true; } // natural terrain, nothing to build
  spawnPoint(i) {
    const a = i * 2.399 + Math.random() * .4, r = 38 + (i % 3) * 3, x = Math.floor(this.cx + Math.cos(a) * r), z = Math.floor(this.cz + Math.sin(a) * r);
    const y = Math.max(this.w.wg.terrainH(x, z), 20) + 2; return [x + .5, y, z + .5];
  }
  zoneRadius() { const el = this.roundTime - this.t, grace = 25; return el < grace ? 70 : Math.max(5, 70 - (el - grace) / (this.roundTime - grace - 40) * 65); }
  onStart() { this.zone = { x: this.cx + .5, z: this.cz + .5, r: 70 }; this.zoneT = 0; }
  playTick(players, dt) {
    this.zone.r = this.zoneRadius(); this.zoneT += dt;
    if (this.zoneT >= 1) { this.zoneT = 0; const stage = 1 + Math.floor((this.roundTime - this.t) / 80);
      for (const p of players) { const g = p.mg; if (!g.alive) continue; if (dist2(p.x, p.z, this.zone.x, this.zone.z) > this.zone.r) { g.hp = Math.max(0, g.hp - stage); this.sendHp(p); this.w.send(p, { t: 'dmg', n: 0, kx: 0, kz: 0 }); if (g.hp <= 0) this.kill(p, null, 'zone'); } else if (g.hp < 20 && this.w.ticks % 100 === 0) { g.hp++; this.sendHp(p); } } }
    const alive = players.filter(p => p.mg.alive); if (players.length >= 2 && alive.length <= 1) this.endRound(alive[0]?.name || 'nobody');
  }
  timeUp(players) { const a = players.filter(p => p.mg.alive).sort((x, y) => y.mg.hp - x.mg.hp); this.endRound(a[0]?.name || ''); }
  snapshot() { const z = this.zone; return { ...super.snapshot(), zone: this.state === 'play' ? { x: +z.x.toFixed(1), z: +z.z.toFixed(1), r: +z.r.toFixed(1) } : null, alive: this.list().filter(p => p.mg.alive).length }; }
}

/* ===================================================== Capture the Flag ===================================================== */
const atHome = f => f.at[0] === f.home[0] && f.at[1] === f.home[1] && f.at[2] === f.home[2]; // compare coordinates: `at` is replaced by a fresh array whenever it moves
export class Ctf extends RoundGame {
  constructor(w) { super(w); this.title = 'Capture the Flag'; this.respawns = true; this.roundTime = 360; this.caps = [0, 0]; this.flags = this.freshFlags(); }
  freshFlags() { return [0, 1].map(t => { const x = this.cx + .5 + (t === 0 ? -1 : 1) * (R - 3), h = [x, this.gy, this.cz + .5]; return { home: h, at: [...h], carrier: null, droppedAt: 0 }; }); }
  build() { super.build(); for (const t of [0, 1]) { const [hx, , hz] = this.flags[t].home; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) this.w.setBlock(Math.floor(hx) + a, this.gy - 1, Math.floor(hz) + b, t === 0 ? B.WOOL_R : B.WOOL_B); } }
  canHit(p, q) { return q.mg.team !== p.mg.team; }
  onStart() { this.caps = [0, 0]; this.flags = this.freshFlags(); }
  onLobby() { this.flags = this.freshFlags(); this.caps = [0, 0]; }
  kill(q, by, wname) { for (const f of this.flags) if (f.carrier === q.id) { f.carrier = null; f.at = [q.x, q.y, q.z]; f.droppedAt = Date.now(); this.w.system(`${q.name} dropped the flag!`); } super.kill(q, by, wname); }
  playTick(players) {
    const now = Date.now();
    for (const p of players) {
      const g = p.mg; if (!g.alive) continue; const mine = this.flags[g.team], theirs = this.flags[1 - g.team];
      if (theirs.carrier === null && dist2(p.x, p.z, theirs.at[0], theirs.at[2]) < 1.7 && Math.abs(p.y - theirs.at[1]) < 2.5) { theirs.carrier = p.id; this.w.system(`${p.name} took the ${g.team === 0 ? 'BLUE' : 'RED'} flag!`); }
      if (mine.carrier === null && !atHome(mine) && dist2(p.x, p.z, mine.at[0], mine.at[2]) < 1.7) { mine.at = [...mine.home]; this.w.system(`${p.name} returned the ${g.team === 0 ? 'RED' : 'BLUE'} flag`); }
      if (theirs.carrier === p.id && mine.carrier === null && dist2(p.x, p.z, mine.home[0], mine.home[2]) < 2.2) {
        this.caps[g.team]++; theirs.carrier = null; theirs.at = [...theirs.home]; g.kills += 3; this.w.addCoins(p, 10, 'earned'); this.w.system(`${p.name} captured the flag! RED ${this.caps[0]} - ${this.caps[1]} BLUE`);
        if (this.caps[g.team] >= 3) { this.endRound((g.team === 0 ? 'RED' : 'BLUE') + ' TEAM', g.team); return; }
      }
    }
    for (const f of this.flags) { // carried flags follow their carrier; dropped flags return home after 12 s
      if (f.carrier !== null) { const c = players.find(p => p.id === f.carrier); if (c && c.mg.alive) f.at = [c.x, c.y, c.z]; else f.carrier = null; }
      else if (!atHome(f) && now - f.droppedAt > 12000) f.at = [...f.home];
    }
  }
  timeUp() { const [r, b] = this.caps; if (r === b) { const t = this.teamScore(); this.endRound(t[0] === t[1] ? 'DRAW' : (t[0] > t[1] ? 'RED' : 'BLUE') + ' TEAM', t[0] === t[1] ? -1 : t[0] > t[1] ? 0 : 1); } else this.endRound((r > b ? 'RED' : 'BLUE') + ' TEAM', r > b ? 0 : 1); }
  snapshot() { return { ...super.snapshot(), teams: this.caps, goal: 3, flags: this.flags.map(f => ({ x: +f.at[0].toFixed(1), y: +f.at[1].toFixed(1), z: +f.at[2].toFixed(1), c: f.carrier !== null })) }; }
}

/* ===================================================== Hide & Seek ===================================================== */
export class Hide extends RoundGame {
  constructor(w) { super(w); this.title = 'Hide & Seek'; this.roundTime = 120; this.seeker = null; this.phase = 'lobby'; this.hideT = 0; this.start = null; }
  build() { super.build(); let s = this.round * 7919 + 13; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; // denser cover to hide behind
    for (let i = 0; i < 26; i++) { const x = Math.floor((rnd() * 2 - 1) * (R - 3)), z = Math.floor((rnd() * 2 - 1) * (R - 3)), h = 2 + Math.floor(rnd() * 3); for (let y = 0; y < h; y++) this.w.setBlock(this.cx + x, this.gy + y, this.cz + z, B.DARK_PLANKS); } }
  gunLock(p) { return this.state === 'play' && this.phase === 'seek' && p.id === this.seeker ? 0 : -2; } // seeker: pistol only; hiders are unarmed
  canHit() { return true; }
  damage(q, n, by, head, wname) { super.damage(q, 20, by, head, wname); } // any hit tags a hider
  onStart(players) { this.seeker = players[Math.floor(Math.random() * players.length)].id; this.phase = 'hide'; this.hideT = 15; this.start = null; this.w.system(`${players.find(p => p.id === this.seeker).name} is the seeker! Hiders have 15 seconds.`); for (const p of players) p.mg.team = p.id === this.seeker ? 1 : 0; }
  onLobby() { this.phase = 'lobby'; this.seeker = null; }
  playTick(players, dt) {
    const s = players.find(p => p.id === this.seeker);
    if (!s) { this.endRound('HIDERS'); return; }
    if (this.phase === 'hide') {
      if (!this.start) this.start = [s.x, s.y, s.z]; this.hideT -= dt;
      if (this.w.ticks % 5 === 0 && dist2(s.x, s.z, this.start[0], this.start[2]) > 2) this.w.send(s, { t: 'tp', x: this.start[0], y: this.start[1], z: this.start[2] }); // seeker is held in place while hiders scatter
      if (this.hideT <= 0) { this.phase = 'seek'; for (const p of players) this.sendHp(p); this.w.system('Ready or not - the seeker is loose!'); this.broadcastBoard(); }
    }
    const hiders = players.filter(p => p.id !== this.seeker && p.mg.alive); if (!hiders.length && players.length >= 2) this.endRound(s.name);
  }
  timeUp(players) { this.endRound('HIDERS'); for (const p of players) if (p.id !== this.seeker && p.mg.alive) { p.mg.wins++; this.w.addCoins(p, 25, 'earned'); } }
  snapshot() { return { ...super.snapshot(), seeker: this.seeker, phase: this.phase, hideT: Math.ceil(Math.max(0, this.hideT)) }; }
}


/* ===================================================== Search & Destroy ===================================================== */
export class Snd extends RoundGame {
  constructor(w) { super(w); this.title = 'Search & Destroy'; this.roundTime = 1500; this.score = [0, 0]; this.rs = 'live'; this.rt = 90; this.post = 0; this.bomb = { st: 'none', t: 0, pl: 0, df: 0 }; this.site = [this.cx + R - 7 + .5, this.gy, this.cz + .5]; }
  canHit(p, q) { return q.mg.team !== p.mg.team; }
  build() { super.build(); const sx = Math.floor(this.site[0]), sz = Math.floor(this.site[2]); for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const d = Math.hypot(a, b); if (d <= 3.2) this.w.setBlock(sx + a, this.gy - 1, sz + b, d <= 2.4 ? B.GLOWSTONE : B.OBSIDIAN); } }
  near(p) { return dist2(p.x, p.z, this.site[0], this.site[2]) < 2.8 && Math.abs(p.y - this.gy) < 2.5; }
  onStart() { this.score = [0, 0]; this.freshRound(); }
  freshRound() { this.rs = 'live'; this.rt = 90; this.post = 0; this.bomb = { st: 'none', t: 0, pl: 0, df: 0 }; }
  newRound() { const players = this.list(); this.freshRound(); players.forEach((p, n) => { const g = p.mg; g.alive = true; g.hp = 20; g.ammo = fullAmmo(); g.reloadAt = 0; g.respawnAt = 0; this.place(p, n); this.sendHp(p); }); this.w.system(`Round ${this.score[0] + this.score[1] + 1} - RED attacks, BLUE defends. First to 4.`); this.broadcastBoard(); }
  roundEnd(team, why) {
    if (this.rs !== 'live') return; this.rs = 'post'; this.post = 5; this.score[team]++;
    this.w.system(`${team === 0 ? 'RED (attackers)' : 'BLUE (defenders)'} win the round: ${why}  [${this.score[0]} - ${this.score[1]}]`);
    for (const p of this.list()) if (p.mg.team === team) this.w.addCoins(p, 2, 'earned');
    this.broadcastBoard(); if (this.score[team] >= 4) this.endRound((team === 0 ? 'RED' : 'BLUE') + ' TEAM', team);
  }
  playTick(players, dt) {
    if (this.rs === 'post') { this.post -= dt; if (this.post <= 0 && this.state === 'play') this.newRound(); return; }
    const att = players.filter(p => p.mg.team === 0 && p.mg.alive), def = players.filter(p => p.mg.team === 1 && p.mg.alive), b = this.bomb;
    if (b.st === 'none') {
      this.rt -= dt; b.pl = att.some(p => this.near(p)) ? b.pl + dt : 0;
      if (b.pl >= 3) { b.st = 'planted'; b.t = 25; b.pl = 0; this.w.system('The bomb has been planted! Defenders - defuse it!'); }
      else if (!def.length) this.roundEnd(0, 'defenders eliminated'); else if (!att.length) this.roundEnd(1, 'attackers eliminated'); else if (this.rt <= 0) this.roundEnd(1, 'time ran out');
    } else if (b.st === 'planted') {
      b.t -= dt; b.df = def.some(p => this.near(p)) ? b.df + dt : Math.max(0, b.df - dt * 2);
      if (b.df >= 4) { b.st = 'defused'; this.roundEnd(1, 'bomb defused'); } else if (b.t <= 0) { b.st = 'boom'; this.roundEnd(0, 'the bomb exploded'); } else if (!def.length) this.roundEnd(0, 'defenders eliminated');
    }
  }
  timeUp() { const [a, d] = this.score; this.endRound(a === d ? 'DRAW' : (a > d ? 'RED' : 'BLUE') + ' TEAM', a === d ? -1 : a > d ? 0 : 1); }
  snapshot() { const b = this.bomb; return { ...super.snapshot(), teams: this.score, goal: 4, site: this.site.map(v => +v.toFixed(1)), rs: this.rs, rt: Math.ceil(Math.max(0, this.rt)), bomb: { st: b.st, t: Math.ceil(Math.max(0, b.t)), pl: +(b.pl / 3).toFixed(2), df: +(b.df / 4).toFixed(2) } }; }
}

/* ===================================================== Bed Wars (gun edition) ===================================================== */
export class Bedwars extends RoundGame {
  constructor(w) { super(w); this.title = 'Bed Wars'; this.respawns = true; this.roundTime = 600; this.bedAlive = [true, true]; this.placed = new Set(); }
  bedBlocks(t) { const x = this.cx + (t === 0 ? -1 : 1) * (R - 3); return [[x, this.gy, this.cz], [x, this.gy, this.cz + 1]]; }
  canHit(p, q) { return q.mg.team !== p.mg.team; }
  buildBeds() { for (const t of [0, 1]) for (const [x, y, z] of this.bedBlocks(t)) this.w.setBlock(x, y, z, t === 0 ? B.WOOL_R : B.WOOL_B); }
  build() { super.build(); for (const t of [0, 1]) { const [bx, , bz] = this.bedBlocks(t)[0]; for (let a = -2; a <= 2; a++) for (let b = -1; b <= 2; b++) this.w.setBlock(bx + a, this.gy - 1, bz + b, t === 0 ? B.WOOL_R : B.WOOL_B); } this.buildBeds(); }
  onStart() { for (const k of this.placed) { const [x, y, z] = k.split(',').map(Number); this.w.setBlock(x, y, z, 0); } this.placed.clear(); this.bedAlive = [true, true]; this.buildBeds(); }
  /** players build with right-click (placing only); bullets chew player-built blocks and break the ENEMY bed */
  allowBlock(p, x, y, z, id) {
    if (this.state !== 'play' || !p.mg?.alive || id === 0) return false;
    if (Math.abs(x - this.cx) >= R || Math.abs(z - this.cz) >= R || y < this.gy || y > this.gy + 8 || this.w.getB(x, y, z) !== 0) return false;
    if (this.placed.size > 4000) return false; this.placed.add(x + ',' + y + ',' + z); return 2;
  }
  blockShot(p, x, y, z) {
    if (this.state !== 'play') return; const k = x + ',' + y + ',' + z;
    if (this.placed.has(k)) { this.placed.delete(k); this.w.setBlock(x, y, z, 0); return; }
    for (const t of [0, 1]) if (t !== p.mg.team && this.bedAlive[t] && this.bedBlocks(t).some(b => b[0] === x && b[1] === y && b[2] === z)) {
      this.bedAlive[t] = false; for (const [bx, by, bz] of this.bedBlocks(t)) this.w.setBlock(bx, by, bz, 0);
      this.w.system(`${t === 0 ? 'RED' : 'BLUE'} bed was destroyed by ${p.name}! No more respawns for ${t === 0 ? 'RED' : 'BLUE'}.`); this.w.addCoins(p, 5, 'earned'); this.broadcastBoard();
    }
  }
  kill(q, by, wname) { super.kill(q, by, wname); const g = q.mg; g.respawnAt = this.bedAlive[g.team] ? Date.now() + 4000 : 0; }
  playTick(players) {
    const out = [0, 1].map(t => !players.some(p => p.mg.team === t && (p.mg.alive || p.mg.respawnAt > 0)));
    if (out[0] !== out[1] && players.length >= 2) { const w = out[0] ? 1 : 0; this.endRound((w === 0 ? 'RED' : 'BLUE') + ' TEAM', w); }
  }
  timeUp() { const t = this.teamScore(), a = this.bedAlive; const w = a[0] !== a[1] ? (a[0] ? 0 : 1) : t[0] === t[1] ? -1 : t[0] > t[1] ? 0 : 1; this.endRound(w < 0 ? 'DRAW' : (w === 0 ? 'RED' : 'BLUE') + ' TEAM', w); }
  snapshot() { return { ...super.snapshot(), teams: this.teamScore(), goal: 0, beds: this.bedAlive }; }
}


/* ===================================================== Boss Raid (co-op) ===================================================== */
export class Raid extends Zombies {
  constructor(w) { super(w); this.title = 'Boss Raid'; this.respawns = true; this.roundTime = 600; this.boss = null; this.bossMax = 1; this.phase = 0; this.minionT = 0; }
  onStart(players) {
    this.w.sim.clear(); this.w.time = .9; this.phase = 0; this.toSpawn = 0; this.spawnT = 2; this.minionT = 10; this.wave = 0;
    const m = this.w.sim.spawn('boss', this.cx + .5 + R - 4, this.gy + 1, this.cz + .5); m.hp = this.bossMax = 260 + 140 * Math.max(0, players.length - 1); this.boss = m;
    this.w.system('The boss has awakened! Work together.');
  }
  nextWave() { /* no waves in a raid */ }
  mobDamage(p, n) { const g = p.mg; const was = g?.alive; super.mobDamage(p, n); if (was && !g.alive) g.respawnAt = Date.now() + 12000; }
  mobKilled(p, m) { if (this.state !== 'play') return; p.mg.kills += m.type === 'boss' ? 5 : 1; this.w.addCoins(p, m.type === 'boss' ? 30 : 1, 'earned'); }
  playTick(players, dt) {
    this.w.time = .9; const b = this.boss;
    if (b && !this.w.sim.mobs.has(b.id)) { this.boss = null; for (const p of this.list()) this.w.addCoins(p, 20, 'earned'); this.w.sim.clear(); this.endRound('BOSS DEFEATED'); return; }
    if (b) {
      const frac = b.hp / this.bossMax, ph = frac < .34 ? 2 : frac < .67 ? 1 : 0;
      if (ph > this.phase) { this.phase = ph; b.spd = 1 + .3 * ph; this.toSpawn += 3 + 2 * ph; this.w.system(ph === 2 ? 'The boss is furious! FINAL PHASE!' : 'The boss is enraged!'); this.broadcastBoard(); }
    }
    this.minionT -= dt; if (this.minionT <= 0) { this.minionT = Math.max(4, 11 - this.phase * 3); this.toSpawn += 2 + this.phase; }
    if (this.toSpawn > 0) { this.spawnT -= dt; if (this.spawnT <= 0) { this.spawnT = .9; this.toSpawn--; const a = Math.random() * 6.283; this.w.sim.spawn('zombie', this.cx + .5 + Math.cos(a) * (R - 2), this.gy + 1, this.cz + .5 + Math.sin(a) * (R - 2)); } }
    if (!players.some(p => p.mg.alive || p.mg.respawnAt > 0)) { this.w.sim.clear(); this.endRound('The boss wins'); }
  }
  timeUp() { this.w.sim.clear(); this.endRound('The boss wins'); }
  endRound(name) { if (this.state !== 'play') return; Minigame.prototype.endRound.call(this, name, -1); this.boss = null; }
  snapshot() { const b = this.boss; return { ...Minigame.prototype.snapshot.call(this), boss: b ? { hp: Math.max(0, Math.ceil(b.hp)), max: this.bossMax, phase: this.phase } : null, left: this.w.sim.mobs.size }; }
}

/* ===================================================== Tower Defence (co-op) ===================================================== */
const TD_WAVES = 10, TURRET_COST = 20, TURRET_RANGE = 12;
export class Td extends Zombies {
  constructor(w) { super(w); this.title = 'Tower Defence'; this.respawns = true; this.roundTime = 1500; this.core = 100; this.turrets = []; this.placed = new Set(); this.rest = 0; this.fireT = 0;
    this.coreP = [this.cx + .5 + R - 3, this.cz + .5]; w.sim.goal = { x: this.coreP[0], z: this.coreP[1] }; }
  build() {
    const w = this.w, { cx, cz, gy } = this;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) { const edge = Math.abs(x) === R || Math.abs(z) === R; w.setBlock(cx + x, gy - 1, cz + z, B.STONE_BRICK); for (let y = 0; y < 5; y++) w.setBlock(cx + x, gy + y, cz + z, edge ? B.STONE_BRICK : 0); }
    const [px, pz] = [Math.floor(this.coreP[0]), Math.floor(this.coreP[1])];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let y = 0; y < 3; y++) w.setBlock(px + a, gy + y, pz + b, y === 2 ? B.GLOWSTONE : B.DIAMOND_BLOCK);
    for (let b = -3; b <= 3; b++) for (let a = 0; a < 2; a++) w.setBlock(cx - R + 1 + a, gy - 1, cz + b, B.OBSIDIAN); // enemy gate
    this.built = true;
  }
  spawnPoint(i) { return [this.cx + .5 - 4 - (i % 3), this.gy, this.cz + .5 + ((i * 2) % 7) - 3]; }
  clearBuilt() { for (const k of this.placed) { const [x, y, z] = k.split(',').map(Number); this.w.setBlock(x, y, z, 0); } this.placed.clear(); this.turrets = []; }
  onStart(players) { this.clearBuilt(); this.w.sim.clear(); this.core = 100; this.wave = 0; this.rest = 0; this.toSpawn = 0; for (const p of players) { const wal = this.w.wallet(p); wal.coins = Math.max(wal.coins, 60); this.w.sendWallet(p); } this.nextWave(); }
  onLobby() { this.clearBuilt(); this.w.sim.clear(); }
  nextWave() {
    this.wave++; if (this.wave > TD_WAVES) return; this.toSpawn = 4 + 3 * this.wave; this.spawnT = 3; this.rest = 0;
    for (const p of this.list()) { const g = p.mg; if (!g.alive) { g.alive = true; g.respawnAt = 0; this.place(p); } g.ammo = fullAmmo(); g.hp = 20; this.sendHp(p); this.w.send(p, { t: 'toast', text: `Wave ${this.wave}/${TD_WAVES}` }); }
    this.broadcastBoard();
  }
  mobDamage(p, n) { const g = p.mg; const was = g?.alive; super.mobDamage(p, n); if (was && !g.alive) g.respawnAt = Date.now() + 5000; }
  mobKilled(p) { if (this.state !== 'play') return; p.mg.kills++; this.w.addCoins(p, 3, 'earned'); }
  /** Gold block = turret (costs coins); any other block builds a barricade. Nothing can be broken by hand. */
  allowBlock(p, x, y, z, id) {
    if (this.state !== 'play' || !p.mg?.alive || id === 0 || id === 7) return false;
    if (Math.abs(x - this.cx) >= R || Math.abs(z - this.cz) >= R || y < this.gy || y > this.gy + 6 || this.w.getB(x, y, z) !== 0 || this.placed.size > 600) return false;
    if (Math.hypot(x + .5 - this.coreP[0], z + .5 - this.coreP[1]) < 3) return false;
    if (id === B.GOLD_BLOCK) {
      if (this.turrets.length >= 14) { this.w.send(p, { t: 'toast', text: 'Turret limit reached (14)' }); return false; }
      if (this.w.wallet(p).coins < TURRET_COST) { this.w.send(p, { t: 'toast', text: `A turret costs ${TURRET_COST} coins` }); return false; }
      this.w.addCoins(p, -TURRET_COST, 'spent'); this.turrets.push({ x, y, z, owner: p.id, cd: 0 });
    }
    this.placed.add(x + ',' + y + ',' + z); return 2;
  }
  blockShot(p, x, y, z) { const k = x + ',' + y + ',' + z; if (this.placed.has(k) && !this.turrets.some(t => t.x === x && t.y === y && t.z === z)) { this.placed.delete(k); this.w.setBlock(x, y, z, 0); } }
  playTick(players, dt) {
    this.w.time = .9;
    if (this.wave <= TD_WAVES) {
      if (this.toSpawn > 0) { this.spawnT -= dt; if (this.spawnT <= 0) { this.spawnT = Math.max(.5, 1.8 - this.wave * .1); this.toSpawn--; const m = this.w.sim.spawn('zombie', this.cx + .5 - R + 3, this.gy + 1, this.cz + .5 + (Math.random() * 10 - 5)); m.hp = Math.round(m.hp * (1 + .12 * (this.wave - 1))); } }
      else if (this.zombiesAlive() === 0) { this.rest += dt; if (this.rest >= 12) { if (this.wave >= TD_WAVES) { this.wave++; this.winTd(); return; } this.nextWave(); } }
    }
    // zombies chewing on the core
    for (const m of this.w.sim.mobs.values()) if (m.type === 'zombie' && dist2(m.x, m.z, this.coreP[0], this.coreP[1]) < 2.6) this.core = Math.max(0, this.core - dt * 1.4);
    if (this.core <= 0) { this.w.sim.clear(); this.endRound(`The core fell on wave ${Math.min(this.wave, TD_WAVES)}`); return; }
    // turrets
    this.fireT += dt; if (this.fireT >= .25) { const step = this.fireT; this.fireT = 0; const gb = this.w.getB.bind(this.w);
      for (const t of this.turrets) { t.cd -= step; if (t.cd > 0 || this.w.getB(t.x, t.y, t.z) !== B.GOLD_BLOCK) continue;
        let best = null, bd = TURRET_RANGE; for (const m of this.w.sim.mobs.values()) { const d = Math.hypot(m.x - (t.x + .5), m.z - (t.z + .5)); if (d < bd && Math.abs(m.y - t.y) < 6) { best = m; bd = d; } }
        if (!best) continue; const ox = t.x + .5, oy = t.y + 1.3, oz = t.z + .5, dx = best.x - ox, dy = best.y + .9 - oy, dz = best.z - oz, l = Math.hypot(dx, dy, dz) || 1;
        if (rayBlocksLOS(gb, ox, oy, oz, dx / l, dy / l, dz / l, l)) continue; t.cd = .8;
        this.w.broadcast({ t: 'shot', id: 0, w: 1, from: [+ox.toFixed(2), +oy.toFixed(2), +oz.toFixed(2)], to: [[+best.x.toFixed(2), +(best.y + .9).toFixed(2), +best.z.toFixed(2)]] });
        const res = this.w.sim.hit(best.id, 4, ox, oz); if (res?.killed) { const o = this.w.players.get(t.owner); if (o?.mg) this.mobKilled(o); } }
    }
  }
  winTd() { for (const p of this.list()) this.w.addCoins(p, 30, 'earned'); this.w.sim.clear(); this.endRound('Core defended!'); }
  timeUp() { this.w.sim.clear(); this.endRound(`Survived to wave ${Math.min(this.wave, TD_WAVES)}`); }
  endRound(name) { if (this.state !== 'play') return; Minigame.prototype.endRound.call(this, name, -1); }
  board() { return super.board().map(r => ({ ...r, c: this.w.players.get(r.id) ? this.w.wallet(this.w.players.get(r.id)).coins : 0 })); }
  snapshot() { return { ...Minigame.prototype.snapshot.call(this), wave: Math.min(this.wave, TD_WAVES), maxWave: TD_WAVES, core: Math.ceil(this.core), left: this.toSpawn + this.zombiesAlive(), turrets: this.turrets.length, cost: TURRET_COST }; }
}
function rayBlocksLOS(getB, ox, oy, oz, dx, dy, dz, len) { for (let t = .6; t < len - .5; t += .4) { if (getB(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t))) return true; } return false; }

/* ===================================================== Parkour race ===================================================== */
const PK_N = 36, PK_CP = 6, PK_UP = 12; // course floats 12 blocks above the ground so a fall is a real fall
export class Parkour extends RoundGame {
  constructor(w) { super(w); this.title = 'Parkour'; this.minPlayers = 1; this.roundTime = 240; this.plats = this.course(); }
  course() { let s = 4242; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const out = []; let x = 0, y = 0, z = 0;
    for (let i = 0; i <= PK_N; i++) { out.push({ x, y, z, i, cp: i % PK_CP === 0, fin: i === PK_N }); x += 4 + Math.floor(rnd() * 2); y += i % 3 === 2 ? 1 : (rnd() < .3 ? -1 : 0); z += Math.floor(rnd() * 5) - 2; if (z > 8) z = 8; if (z < -8) z = -8; }
    return out; }
  build() {
    for (const q of this.plats) { const [wx, wy, wz] = [this.cx + q.x, this.gy - 1 + PK_UP + q.y, this.cz + q.z], r = q.fin ? 2 : 1, id = q.fin ? B.DIAMOND_BLOCK : q.cp ? B.GOLD_BLOCK : B.STONE_BRICK;
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { this.w.setBlock(wx + a, wy, wz + b, id); for (let h = 1; h < 4; h++) this.w.setBlock(wx + a, wy + h, wz + b, 0); } }
    this.built = true; }
  spawnPoint(i) { const c = this.plats[0]; return [this.cx + c.x + .5 + (i % 3 - 1) * .8, this.gy + PK_UP + c.y, this.cz + c.z + .5 + (Math.floor(i / 3) % 3 - 1) * .8]; }
  playTick(players) {
    for (const p of players) {
      const g = p.mg; if (!g.alive) continue; // reaching a platform also credits the checkpoint behind it, even if you jumped past it
      for (const q of this.plats) { if (q.i <= g.prog) continue; const wx = this.cx + q.x + .5, wz = this.cz + q.z + .5, wy = this.gy + PK_UP + q.y; if (Math.abs(p.x - wx) < (q.fin ? 2.6 : 1.6) && Math.abs(p.z - wz) < (q.fin ? 2.6 : 1.6) && p.y >= wy - .5 && p.y <= wy + 1.5) { g.prog = q.i; g.kills = q.i; g.cp = Math.max(g.cp, q.i - q.i % PK_CP); } }
      const cp = this.plats[g.cp]; if (p.y < this.gy + PK_UP + cp.y - 7) { p.x = this.cx + cp.x + .5; p.y = this.gy + PK_UP + cp.y; p.z = this.cz + cp.z + .5; this.w.send(p, { t: 'tp', x: p.x, y: p.y, z: p.z }); g.deaths++; }
      if (g.prog >= PK_N) { this.endRound(p.name); return; }
    }
  }
  kill() { /* no combat */ }
  gunLock() { return -2; }
  snapshot() { return { ...super.snapshot(), goal: PK_N }; }
}


/* ===================================================== Lobby hub (walk into portals) ===================================================== */
const LB_R = 31, LB_RING = 25, LB_SLOTS = 24, LB_KINDS = ['pvp', 'tdm', 'gungame', 'ctf', 'snd', 'bedwars', 'zombies', 'raid', 'td', 'royale', 'hide', 'parkour', 'spleef', 'survival', 'creative'];
export class Lobby extends Minigame {
  constructor(w) { super(w); this.fps = false; this.slots = this.makeSlots(); this.sig = ''; this.cool = new Map(); this.active = []; this.snapT = 0; }
  /** a ring of portals around a round hall: each is axis-aligned (the frame blocks are), turned to whichever axis is closest to the tangent */
  makeSlots() { const out = []; for (let i = 0; i < LB_SLOTS; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / LB_SLOTS, c = Math.cos(a), sn = Math.sin(a); out.push({ x: this.cx + Math.round(LB_RING * c), z: this.cz + Math.round(LB_RING * sn), ax: Math.abs(c) > Math.abs(sn) + 1e-9 ? 'z' : 'x' }); } return out; }
  build() {
    const w = this.w, { cx, cz, gy } = this, N = LB_SLOTS;
    // pads in front of each portal: a round gold-trimmed disc a little inside the ring
    const pads = this.slots.map(sl => { const dx = cx - sl.x, dz = cz - sl.z, d = Math.hypot(dx, dz) || 1; return [sl.x + dx / d * 2.6, sl.z + dz / d * 2.6]; });
    for (let x = -LB_R; x <= LB_R; x++) for (let z = -LB_R; z <= LB_R; z++) {
      const r = Math.hypot(x, z); if (r > LB_R + .5) continue;
      const ang = Math.atan2(z, x), petal = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 16) % 2, edge = r > LB_R - 1.2;
      let id;
      if (edge) id = B.OBSIDIAN;
      else if (r < 1) id = B.DIAMOND_BLOCK;
      else if (r < 7.5) id = Math.abs(r - 6.6) < .55 ? B.GOLD_BLOCK : (r > 2.4 && r < 3.4 ? B.GLOWSTONE : petal ? B.SANDSTONE : B.STONE_BRICK); // plaza: sunburst of petals, glow ring, gold rim
      else if (Math.abs(r - 8.4) < .6) id = B.GLOWSTONE;
      else if (Math.abs(r - 24.9) < .6 || Math.abs(r - 28) < .55) id = B.GOLD_BLOCK; // lines flanking the portal walkway
      else if (r > 23.6 && r < 29.4) id = B.SANDSTONE;
      else if ((x === 0 || z === 0) && r < 23.6) id = B.SANDSTONE;
      else id = Math.floor(r / 3) % 2 ? B.STONE_BRICK : B.COBBLE;
      for (const [px, pz] of pads) { const d = Math.hypot(cx + x - px, cz + z - pz); if (d < 2.4) id = d > 1.6 ? B.GOLD_BLOCK : B.SANDSTONE; }
      w.setBlock(cx + x, gy - 1, cz + z, id);
      for (let y = 0; y < 9; y++) w.setBlock(cx + x, gy + y, cz + z, edge ? (y < 2 ? B.OBSIDIAN : y < 4 ? B.STONE_BRICK : y === 4 ? B.GLASS : 0) : 0);
    }
    // lamp pillars midway between portals, topped with a glowstone cap
    for (let i = 0; i < N; i++) { const a = -Math.PI / 2 + (i + .5) * 2 * Math.PI / N, x = cx + Math.round(Math.cos(a) * 28.6), z = cz + Math.round(Math.sin(a) * 28.6); for (let y = 0; y < 5; y++) w.setBlock(x, gy + y, z, y === 4 ? B.GLOWSTONE : B.OBSIDIAN); }
    for (const sl of this.slots) this.frame(sl, false);
    this.built = true;
  }
  /** rounded archway: a 3x4 opening with its top corners cut, trimmed in obsidian, gold at the base and a glowstone keystone (open when a world is assigned, bricked up otherwise) */
  frame(sl, open) {
    const w = this.w, { gy } = this, at = (u, h, id) => w.setBlock(sl.x + (sl.ax === 'x' ? u : 0), gy + h, sl.z + (sl.ax === 'z' ? u : 0), id);
    for (let u = -3; u <= 3; u++) for (let h = 0; h <= 6; h++) at(u, h, 0); // wipe the old/previous frame
    for (let u = -2; u <= 2; u++) for (let h = 0; h <= 5; h++) {
      const au = Math.abs(u), hole = au <= 1 && h <= 3 && !(au === 1 && h === 3);
      const body = (au <= 2 && h <= 4 && !(au === 2 && h === 4)) || (au === 0 && h === 5) || (au === 1 && h === 5 && false);
      if (!body) continue;
      if (hole) at(u, h, open ? 0 : B.STONE_BRICK);
      else at(u, h, (au === 0 && h >= 4) || (au === 2 && h === 3) ? B.GLOWSTONE : au === 2 && h === 0 ? B.GOLD_BLOCK : B.OBSIDIAN);
    }
    sl.open = open;
  }
  entries() {
    const rank = m => { const i = LB_KINDS.indexOf(m); return i < 0 ? 99 : i; };
    const num = x => x.room?.n || 1;
    return (this.w.hooks.worlds?.() || []).filter(x => x.id !== this.w.meta.id && x.mode !== 'lobby' && !x.priv && x.lobby !== false).sort((a, b) => rank(a.mode) - rank(b.mode) || num(a) - num(b) || a.name.localeCompare(b.name)).slice(0, this.slots.length);
  }
  refresh(force) {
    const list = this.entries(), sig = list.map(x => x.id + '|' + x.name).join(','); if (!force && sig === this.sig) return; this.sig = sig; this.active = list;
    this.slots.forEach((sl, i) => { const open = i < list.length; if (sl.open !== open) this.frame(sl, open); });
  }
  snap() {
    return { t: 'lobby', portals: this.active.map((a, i) => { const sl = this.slots[i], live = (this.w.hooks.worlds?.() || []).find(x => x.id === a.id) || a;
      return { s: i, x: sl.x + .5, y: this.gy + 2, z: sl.z + .5, ax: sl.ax, id: a.id, name: a.name, mode: a.mode, n: live.players, b: live.bots || 0, max: live.max, st: live.st || '', t: live.t || 0, sk: live.sk || '', src: live.room?.source || 'base' }; }) };
  }
  spawnPoint(i = 0) { const a = i * 2.399, r = 1.2 + (i * 1.3) % 3; return [this.cx + .5 + Math.cos(a) * r, this.gy, this.cz + .5 + Math.sin(a) * r]; }
  place(p, i = p.id) { const [x, y, z] = this.spawnPoint(i); p.x = x; p.y = y; p.z = z; this.w.send(p, { t: 'tp', x, y, z }); }
  onJoin(p) { p.mg = null; if (!this.built) this.build(); this.refresh(true); this.place(p); this.w.send(p, this.snap()); this.w.send(p, { t: 'toast', text: 'Walk into a portal to play' }); }
  onLeave() { /* nothing to clean up */ }
  list() { return []; }
  allowBlock() { return false; }
  /** walk-in: refuse full worlds; a party leader brings every party member who is also standing in the lobby */
  enter(p, dest, now) {
    const live = (this.w.hooks.worlds?.() || []).find(x => x.id === dest.id); this.cool.set(p.id, now + 6000);
    const party = this.w.hooks.parties?.get(p.uid), group = party && party.leader === p.uid ? [...this.w.players.values()].filter(q => party.members.has(q.uid)) : [p];
    if (live && live.players + group.length > live.max) { this.cool.set(p.id, now + 3500); this.w.send(p, { t: 'toast', text: `${dest.name} is full${group.length > 1 ? ' for your party' : ''}` }); return; }
    for (const q of group) { this.cool.set(q.id, now + 6000); this.w.send(q, { t: 'transfer', world: dest.id, name: dest.name }); }
  }
  tick(dt) {
    this.w.time = .4; this.snapT += dt; if (this.w.ticks % 20 === 0) this.refresh(false);
    const now = Date.now();
    for (const p of this.w.players.values()) {
      if (p.y < this.gy - 12) { this.place(p); continue; }
      if ((this.cool.get(p.id) || 0) > now) continue;
      for (let i = 0; i < this.active.length; i++) { const sl = this.slots[i], along = sl.ax === 'x' ? p.x - (sl.x + .5) : p.z - (sl.z + .5), across = sl.ax === 'x' ? p.z - (sl.z + .5) : p.x - (sl.x + .5);
        if (Math.abs(along) < 1.4 && Math.abs(across) < 1.1 && p.y > this.gy - .6 && p.y < this.gy + 4) { this.enter(p, this.active[i], now); break; } }
    }
    if (this.snapT >= 1) { this.snapT = 0; this.w.broadcast(this.snap()); }
  }
}

export function makeMinigame(world) {
  switch (world.meta.mode) {
    case 'zombies': return new Zombies(world); case 'royale': return new Royale(world); case 'ctf': return new Ctf(world);
    case 'hide': return new Hide(world); case 'parkour': return new Parkour(world); case 'lobby': return new Lobby(world); case 'snd': return new Snd(world); case 'raid': return new Raid(world); case 'td': return new Td(world); case 'bedwars': return new Bedwars(world); default: return new Minigame(world);
  }
}
