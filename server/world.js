// One authoritative game world: terrain, edits, players, NPCs, time, weather and the economy.
import { runExtra } from './commands.js';
import { CS, CH, STONE, BLOCK_COUNT, RECIPES, dropOf } from '../shared/blocks.js';
import { Fluid, isWater } from '../shared/fluid.js';
import { makeWorldGen } from './gen.js';
import { MobSim, MOB_TYPES, MOB } from '../shared/mobs.js';
import { encodeState } from '../shared/netframe.js';
import { addEdit, countEdits } from './store.js';
import { makeMinigame, ARENA_MODES } from './modes2.js';
import { BotDirector, BOT_MODES } from './bots.js';
import { newEconomy, sell, buy, quoteBuy, tickEconomy, genBounties, snapshotPrices, MOB_REWARD, BUYABLE, BASE } from '../shared/economy.js';

const TICK = 1 / 20;

export class GameWorld {
  constructor(meta, saved, hooks) {
    this.meta = { dayLength: 420, maxPlayers: 16, economy: true, mobs: true, hostile: true, ...meta };
    this.hooks = hooks; // {log(level,msg), event(obj)}
    this.wg = makeWorldGen(this.meta.seed, { type: this.meta.type });
    this.chunks = new Map();           // key -> {data,maxY,used}
    this.ce = saved?.ce || new Map();          // "cx,cz" -> Map(index -> id): the only copy of the edits; generating a chunk never scans them all
    this.editCount = countEdits(this.ce); this.journal = null; this.pendingBlocks = []; this.nextId = 1; this.netOut = 0; this.priceHist = {};
    this.players = new Map();          // id -> player
    this.wallets = saved?.wallets || {}; // uid -> {name,coins,earned,spent}
    this.eco = saved?.eco || newEconomy();
    this.time = saved?.time ?? .3;
    this.weather = { type: saved?.weather || 'clear', timer: 120 + Math.random() * 200 };
    this.dirty = false; this.tickMs = 0; this.tps = 20; this.ticks = 0; this.chatLog = [];
    const world = { getB: (x, y, z) => this.getB(x, y, z), hasChunk: (cx, cz) => this.chunks.has(cx + ',' + cz) };
    this.sim = new MobSim(world, { enabled: this.meta.mobs, hostile: this.meta.hostile });
    this.fluid = new Fluid((x, y, z) => this.getB(x, y, z), (x, y, z, id) => this.setBlock(x, y, z, id));
    this.spawn = this.wg.findSpawn();
    this._lastMobSend = 0; this._lastTimeSend = 0; this._lastPriceSend = 0;
    if (!this.eco.bounties?.length) this.eco.bounties = genBounties();
    this.mg = ARENA_MODES.includes(this.meta.mode) ? makeMinigame(this) : null;
    this.bots = this.mg && BOT_MODES.includes(this.meta.mode) && this.meta.bots !== 0 ? new BotDirector(this) : null; // AI players (only while a human is inside) // gun arena / spleef
  }

  /* ---------- terrain ---------- */
  chunk(cx, cz) {
    const k = cx + ',' + cz; let c = this.chunks.get(k);
    if (!c) {
      c = this.install(k, this.wg.genChunk(cx, cz));
    }
    c.used = Date.now(); return c;
  }
  /** put a generated chunk in the map and apply the persisted edits that fall in it */
  install(k, { data, maxY }) {
    const c = { data, maxY, used: Date.now() };
    const ed = this.ce.get(k); if (ed) for (const [idx, id] of ed) { data[idx] = id; c.maxY = Math.max(c.maxY, (idx >> 8) + 2); }
    this.chunks.set(k, c); return c;
  }
  getB(x, y, z) {
    if (y < 0) return STONE; if (y >= CH) return 0;
    const c = this.chunks.get((x >> 4) + ',' + (z >> 4)); if (!c) return STONE; // unloaded = solid so NPCs never fall into the void
    return c.data[(x & 15) + 16 * ((z & 15) + 16 * y)];
  }
  ensureChunks() {
    const pool = this.hooks.chunkPool && !this.hooks.chunkPool.broken ? this.hooks.chunkPool : null; let budget = pool ? 24 : 6;
    this.inflight ??= new Set();
    for (const p of this.players.values()) {
      const pcx = Math.floor(p.x / CS), pcz = Math.floor(p.z / CS);
      for (let r = 0; r <= 4 && budget > 0; r++) for (let dz = -r; dz <= r && budget > 0; dz++) for (let dx = -r; dx <= r && budget > 0; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const k = (pcx + dx) + ',' + (pcz + dz); if (this.chunks.has(k) || this.inflight.has(k)) continue;
        if (!pool || r === 0) { this.chunk(pcx + dx, pcz + dz); budget--; continue; } // the chunk a player stands in is never allowed to be missing (unloaded reads as solid)
        this.inflight.add(k); budget--; const cx = pcx + dx, cz = pcz + dz;
        pool.request(this.meta.seed, this.meta.type, cx, cz).then(res => { this.inflight.delete(k); if (res && !this.chunks.has(k)) this.install(k, res); });
      }
    }
    if (this.ticks % 200 === 0) this.unloadStale();
  }
  /** drop chunks nobody has touched for a minute (and that no player is near) */
  unloadStale() {
    const now = Date.now();
    for (const [k, c] of this.chunks) if (now - c.used > 60000) {
      const [cx, cz] = k.split(',').map(Number); let near = false;
      for (const p of this.players.values()) if (Math.abs(Math.floor(p.x / CS) - cx) <= 6 && Math.abs(Math.floor(p.z / CS) - cz) <= 6) { near = true; break; }
      if (!near) this.chunks.delete(k); else c.used = now;
    }
  }

  /* ---------- helpers ---------- */
  send(p, m) { if (p.bot) return; if (p.ws.readyState === 1) { const s = JSON.stringify(m); this.netOut += s.length; p.ws.send(s); } }
  /** Broadcast; lossy messages (positions, NPC snapshots) are skipped for clients whose socket buffer is backed up, and hopeless clients are dropped. */
  broadcast(m, except, lossy) {
    const s = JSON.stringify(m);
    for (const p of this.players.values()) {
      if (p === except || p.bot || p.ws.readyState !== 1) continue; const buf = p.ws.bufferedAmount;
      if (buf > 16 * 1024 * 1024) { p.ws.terminate(); continue; } if (lossy && buf > 262144) continue; this.netOut += s.length; p.ws.send(s);
    }
  }
  system(text) { this.broadcast({ t: 'chat', sys: true, text }); this.hooks.event({ t: 'chat', world: this.meta.id, sys: true, text }); }
  wallet(p) { return (this.wallets[p.uid] ??= { name: p.name, coins: 25, earned: 0, spent: 0, inv: {} }); }
  survival() { return this.meta.mode === 'survival'; }
  inv(p) { return (this.wallet(p).inv ??= {}); }
  sendInv(p) { if (this.survival()) this.send(p, { t: 'inv', items: this.inv(p) }); }
  addItem(p, id, n = 1) { const inv = this.inv(p); inv[id] = (inv[id] || 0) + n; this.dirty = true; }
  takeItem(p, id, n = 1) { const inv = this.inv(p); if ((inv[id] || 0) < n) return false; inv[id] -= n; if (inv[id] <= 0) delete inv[id]; this.dirty = true; return true; }
  sendWallet(p) { this.send(p, { t: 'wallet', coins: this.wallet(p).coins }); }
  humans() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }
  info() { return { id: this.meta.id, name: this.meta.name, players: this.humans(), max: this.meta.maxPlayers, mode: this.meta.mode, type: this.meta.type, economy: !!this.meta.economy }; }
  isNight() { return Math.sin((this.time - .25) * Math.PI * 2) < -.02; }
  sunElev() { return Math.sin((this.time - .25) * Math.PI * 2); }

  /* ---------- join / leave ---------- */
  join(ws, hello, ip) {
    // eslint-disable-next-line no-control-regex -- strip control chars from names
    let name = String(hello.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Player';
    const taken = new Set([...this.players.values()].map(p => p.name.toLowerCase())); let n = name, i = 2; while (taken.has(n.toLowerCase())) n = name.slice(0, 13) + '_' + i++; name = n;
    const hex = v => /^#[0-9a-fA-F]{6}$/.test(v) ? v : null, sk = hello.skin && typeof hello.skin === 'object' ? { shirt: hex(hello.skin.shirt), pants: hex(hello.skin.pants), skin: hex(hello.skin.skin), hair: hex(hello.skin.hair) } : null;
    const uid = String(hello.uid || ('anon-' + ip)).replace(/[^\w-]/g, '').slice(0, 40);
    let pid; do { pid = this.nextId = (this.nextId % 65535) + 1; } while (this.players.has(pid)); // u16 ids for binary frames
    const p = { id: pid, ws, name, uid, skin: sk, ip, op: false, x: this.spawn[0], y: this.spawn[1], z: this.spawn[2], yaw: 0, pitch: 0, compact: hello.q >= 1, joined: Date.now(), msgs: 0, blocks: 0, hits: 0, rateT: Date.now(), dead: false };
    if (hello.bot) p.bot = true;
    this.players.set(p.id, p); this.wallet(p).name = name;
    this.send(p, {
      t: 'init', id: p.id, seed: this.meta.seed, gen: { type: this.meta.type, mode: this.meta.mode }, name: this.meta.name, motd: this.hooks.motd(), spawn: this.spawn,
      time: { t: this.time, len: this.meta.dayLength }, weather: this.weather.type, economy: this.meta.economy,
      edits: [], editCount: this.editCount,
      players: [...this.players.values()].filter(q => q !== p).map(q => ({ id: q.id, name: q.name, skin: q.skin, x: q.x, y: q.y, z: q.z })),
      mobs: this.sim.snapshot(),
    });
    this.sendEdits(p); this.sendWallet(p); this.sendInv(p);
    if (this.meta.economy) this.send(p, { t: 'prices', list: snapshotPrices(this.eco), bounties: this.eco.bounties });
    if (this.mg) this.mg.onJoin(p);
    this.broadcast({ t: 'join', id: p.id, name, skin: sk, x: p.x, y: p.y, z: p.z }, p);
    if (!p.bot) { this.system(name + ' joined the world'); this.hooks.log('info', `${name} (${ip}) joined ${this.meta.id}`); }
    this.hooks.event({ t: 'join', world: this.meta.id, name, id: p.id });
    return p;
  }
  /** Stream the edit list in batches so a big world never blocks the event loop or one giant frame. */
  sendEdits(p) {
    if (!this.editCount) return; const chunks = [...this.ce.entries()]; let ci = 0; const BATCH = 4000;
    const step = () => {
      if (p.ws.readyState !== 1) return; const list = [];
      while (ci < chunks.length && list.length < BATCH) { const [k, m] = chunks[ci++], [cx, cz] = k.split(',').map(Number); for (const [idx, v] of m) list.push([cx * 16 + (idx & 15), idx >> 8, cz * 16 + ((idx >> 4) & 15), v]); }
      this.send(p, { t: 'edits', list, last: ci >= chunks.length }); if (ci < chunks.length) setImmediate(step);
    };
    setImmediate(step);
  }
  leave(p) {
    if (!this.players.delete(p.id)) return; this.mg?.onLeave(p);
    this.broadcast({ t: 'leave', id: p.id });
    if (p.bot) { delete this.wallets[p.uid]; return; }
    this.system(p.name + ' left the world'); this.hooks.log('info', `${p.name} left ${this.meta.id}`);
    this.hooks.event({ t: 'leave', world: this.meta.id, name: p.name, id: p.id }); this.dirty = true;
  }

  /* ---------- messages ---------- */
  handle(p, m) {
    const now = Date.now(); if (now - p.rateT > 1000) { p.rateT = now; p.msgs = 0; p.blocks = 0; p.hits = 0; }
    if (++p.msgs > 120) return; // flood guard
    switch (m.t) {
      case 'pos': {
        if (![m.x, m.y, m.z].every(Number.isFinite)) return;
        const d = Math.hypot(m.x - p.x, m.z - p.z); if (d > 80) { this.send(p, { t: 'tp', x: p.x, y: p.y, z: p.z }); return; } // teleport guard
        p.x = m.x; p.y = Math.max(-50, Math.min(CH + 60, m.y)); p.z = m.z; p.yaw = +m.yaw || 0; p.pitch = +m.pitch || 0; p.st = (m.st | 0) & 7; break; }
      case 'block': {
        if (++p.blocks > 40) return; const { x, y, z, id } = m;
        if (![x, y, z, id].every(Number.isInteger) || y < 0 || y >= CH || id < 0 || id >= BLOCK_COUNT || id > 32 || (id === 7 && this.meta.mode !== 'creative')) return;
        if (Math.hypot(x + .5 - p.x, y + .5 - (p.y + 1.6), z + .5 - p.z) > 12) return; // reach check
        if (this.mg) { const ok = this.mg.allowBlock(p, x, y, z, id); if (ok) this.setBlock(x, y, z, ok === 2 ? id : 0, p); else this.send(p, { t: 'block', x, y, z, id: this.getB(x, y, z) }); return; }
        if (this.survival()) { // server-authoritative inventory: breaking grants drops, placing consumes stock
          const cur = this.getB(x, y, z), inv = this.inv(p);
          if (id === 0) { if (!cur || isWater(cur)) return; if (now - (p.lastBreak || 0) < 90) return; p.lastBreak = now; this.addItem(p, dropOf(cur), 1); }
          else { if (cur && !isWater(cur)) { this.sendInv(p); return; } if (!(inv[id] > 0)) { this.sendInv(p); return; } this.takeItem(p, id, 1); }
          this.sendInv(p);
        }
        this.setBlock(x, y, z, id, p); break; }
      case 'craft': {
        if (!this.survival()) return; const rc = RECIPES[m.r]; if (!rc) return;
        const inv = this.inv(p); if (!Object.entries(rc.inp).every(([id, c]) => (inv[id] || 0) >= c)) { this.sendInv(p); return; }
        for (const [id, c] of Object.entries(rc.inp)) this.takeItem(p, +id, c); this.addItem(p, rc.out, rc.n); this.sendInv(p); break; }
      case 'chat': this.chat(p, String(m.text || '').slice(0, 200)); break;
      case 'ping': this.send(p, { t: 'pong', ts: m.ts }); break;
      case 'hit': {
        if (++p.hits > 8) return; const mob = this.sim.mobs.get(m.id); if (!mob) return;
        if (Math.hypot(mob.x - p.x, mob.z - p.z) > 7) return;
        const res = this.sim.hit(m.id, this.meta.mode === 'survival' ? 4 : 20, p.x, p.z);
        if (res?.killed && this.meta.economy) { const r = MOB_REWARD[res.m.type] || 0; if (r) { this.addCoins(p, r, 'earned'); this.send(p, { t: 'toast', text: `+${r} coins` }); } }
        break; }
      case 'trade': this.trade(p, m); break;
      case 'bounty': this.turnInBounty(p, m); break;
      case 'respawn': p.dead = false; break;
      case 'shoot': this.mg?.shoot(p, m); break;
      case 'reload': this.mg?.reload(p, m.w | 0); break;
    }
  }
  setBlock(x, y, z, id, from) {
    if (this.editCount > 1500000) return;
    if (addEdit(this.ce, x, y, z, id)) this.editCount++; this.dirty = true; this.journal?.append(x, y, z, id);
    const c = this.chunks.get((x >> 4) + ',' + (z >> 4)); if (c) { c.data[(x & 15) + 16 * ((z & 15) + 16 * y)] = id; c.maxY = Math.max(c.maxY, y + 2); }
    this.fluid.poke(x, y, z);
    this.pendingBlocks.push([x, y, z, id, from ? from.id : 0]); // flushed once per tick as one batched message
  }
  addCoins(p, n, kind) { const w = this.wallet(p); w.coins = Math.max(0, w.coins + n); if (n > 0) w.earned += n; else w.spent -= n; this.sendWallet(p); this.dirty = true; }
  trade(p, m) {
    if (!this.meta.economy) return; const id = m.id | 0, n = Math.max(1, Math.min(64, m.n | 0));
    if (m.action === 'sell' && BASE[id]) {
      const have = this.survival() ? (this.inv(p)[id] || 0) : n, q = Math.min(n, have); if (q < 1) { this.send(p, { t: 'toast', text: 'You have none to sell' }); return; }
      if (this.survival()) this.takeItem(p, id, q);
      const total = sell(this.eco, id, q); this.addCoins(p, total, 'earned'); this.sendInv(p); this.send(p, { t: 'traded', action: 'sell', id, n: q, total }); }
    else if (m.action === 'buy' && BUYABLE.includes(id)) {
      const cost = quoteBuy(this.eco, id, n), w = this.wallet(p); if (w.coins < cost) { this.send(p, { t: 'toast', text: 'Not enough coins' }); return; }
      buy(this.eco, id, n); this.addCoins(p, -cost); if (this.survival()) { this.addItem(p, id, n); this.sendInv(p); } this.send(p, { t: 'traded', action: 'buy', id, n, total: cost });
    } else return;
    this.send(p, { t: 'prices', list: snapshotPrices(this.eco), bounties: this.eco.bounties });
  }
  turnInBounty(p, m) {
    const b = this.eco.bounties.find(x => x.uid === m.uid && !x.taken); if (!b) return;
    if (this.survival() && !this.takeItem(p, b.id, b.qty)) { this.send(p, { t: 'toast', text: `You need ${b.qty} of that item` }); return; }
    b.taken = true; this.sendInv(p); this.addCoins(p, b.reward, 'earned'); this.send(p, { t: 'toast', text: `Bounty complete! +${b.reward} coins` });
    this.system(`${p.name} completed a bounty (+${b.reward} coins)`);
    if (this.eco.bounties.every(x => x.taken)) this.eco.bounties = genBounties();
    this.broadcast({ t: 'prices', list: snapshotPrices(this.eco), bounties: this.eco.bounties });
  }
  chat(p, text) {
    // eslint-disable-next-line no-control-regex -- strip control chars from chat
    text = text.replace(/[\u0000-\u001f<>]/g, '').trim(); if (!text) return;
    if (this.hooks.muted && this.hooks.muted(p)) { this.send(p, { t: 'chat', sys: true, text: 'You are muted.' }); return; }
    const now = Date.now(); p.chatT = (p.chatT || []).filter(t => now - t < 4000); if (p.chatT.length >= 5) { this.send(p, { t: 'chat', sys: true, text: 'Slow down - you are sending messages too quickly.' }); return; } p.chatT.push(now);
    if (text[0] === '/') return this.command(p, text);
    const msg = { t: 'chat', name: p.name, text }; this.broadcast(msg); this.chatLog.push({ at: Date.now(), name: p.name, text }); if (this.chatLog.length > 200) this.chatLog.shift();
    this.hooks.event({ t: 'chat', world: this.meta.id, name: p.name, text }); this.hooks.log('chat', `<${p.name}> ${text}`);
  }
  /** Commands from players (op-only for most) and from the admin console (p = null). */
  command(p, text) {
    const [cmd, ...a] = text.slice(1).trim().split(/\s+/), reply = s => p ? this.send(p, { t: 'chat', sys: true, text: s }) : s; let out = '';
    const say = s => { out += (out ? '\n' : '') + s; if (p) reply(s); };
    const admin = !p || p.op;
    try { if (runExtra(this, p, (cmd || '').toLowerCase(), a, say, admin)) return out; } catch (e) { say('Command failed: ' + e.message); return out; }
    switch ((cmd || '').toLowerCase()) {
      case 'help': say('Commands: /help /lobby /create <mode> [bots] [easy|normal|hard] /join <code> /party /list /me <text>' + (admin ? ' /time <day|night|0-1> /weather <clear|rain|storm> /tp <x y z|player> /spawn <pig|zombie|villager> [n] /kill mobs /say <text> /give <player> <coins> /save' : '')); break;
      case 'lobby': case 'hub': case 'leave': case 'quit': { if (!p) return say('Console cannot travel.'); if (this.meta.mode === 'lobby') return say('You are already in the lobby.'); if (!this.hooks.worlds?.().some(x => x.id === 'lobby')) return say('There is no lobby on this server.'); this.send(p, { t: 'transfer', world: 'lobby', name: 'Lobby' }); break; }
      case 'create': {
        if (!p) return say('Console cannot create games.'); if (!this.hooks.createGame) return say('Private games are not available here.');
        const mode = (a[0] || '').toLowerCase(), bots = a[1] === undefined ? 4 : a[1], skill = (a[2] || 'normal').toLowerCase();
        const r = this.hooks.createGame({ mode, bots, skill, owner: p }); if (r.error) return say(r.error);
        say(`Created ${r.name} with ${r.bots} bot${r.bots === 1 ? '' : 's'}. Friends can join with /join ${r.id}`);
        const party = this.hooks.parties?.get(p.uid), group = party && party.leader === p.uid ? [...this.players.values()].filter(q => party.members.has(q.uid)) : [p];
        for (const q of group) this.send(q, { t: 'transfer', world: r.id, name: r.name }); break; }
      case 'join': {
        if (!p) return say('Console cannot travel.'); const id = String(a[0] || '').toLowerCase(), live = this.hooks.worlds?.().find(x => x.id === id);
        if (!live || live.mode === 'lobby') return say('No game with that code. Usage: /join <code>'); if (live.players >= live.max) return say('That game is full.'); if (id === this.meta.id) return say('You are already there.');
        this.send(p, { t: 'transfer', world: id, name: live.name }); break; }
      case 'party': {
        if (!p) return say('The console has no party.'); const P = this.hooks.parties; if (!P) return say('Parties are not available here.'); const sub = (a[0] || 'list').toLowerCase();
        const find = fn => [...this.players.values()].find(fn), nameOf = uid => find(q => q.uid === uid)?.name || '(in another world)';
        if (sub === 'list') { const pt = P.get(p.uid); say(pt ? `Party (${pt.members.size}): ` + [...pt.members].map(u => (u === pt.leader ? '* ' : '') + nameOf(u)).join(', ') : 'You are not in a party. Try /party invite <name>'); }
        else if (sub === 'invite') { const t = find(q => q.name.toLowerCase() === (a[1] || '').toLowerCase()); if (!t) return say('Player not found in this world.'); if (t === p) return say("You can't invite yourself."); const err = P.invite(p.uid, t.uid); if (err) return say(err); say('Invited ' + t.name + '.'); this.send(t, { t: 'chat', sys: true, text: `${p.name} invited you to a party. Type /party accept` }); }
        else if (sub === 'accept') { const r = P.accept(p.uid); if (typeof r === 'string') return say(r); say('You joined the party! When the leader walks into a lobby portal, you all go together.'); for (const u of r.members) { const q = find(x => x.uid === u && x !== p); if (q) this.send(q, { t: 'chat', sys: true, text: p.name + ' joined the party' }); } }
        else if (sub === 'leave') { P.leave(p.uid); say('You left the party.'); }
        else say('Usage: /party [list | invite <name> | accept | leave]');
        break; }
      case 'list': say('Online: ' + ([...this.players.values()].map(q => q.name).join(', ') || 'nobody')); break;
      case 'me': this.system(`* ${p ? p.name : 'Server'} ${a.join(' ')}`); break;
      case 'time': { if (!admin) return say('You need operator rights.'); const v = a[0]; this.time = v === 'day' ? .4 : v === 'night' ? .85 : v === 'dawn' ? .27 : Math.max(0, Math.min(.999, parseFloat(v) || 0)); this.broadcastTime(); say('Time set.'); break; }
      case 'weather': { if (!admin) return say('You need operator rights.'); this.setWeather(['clear', 'rain', 'storm'].includes(a[0]) ? a[0] : 'clear'); say('Weather set to ' + this.weather.type); break; }
      case 'tp': {
        if (!admin) return say('You need operator rights.'); if (!p) return say('Console cannot teleport.');
        let t = null; if (a.length === 3) t = a.map(Number); else { const q = [...this.players.values()].find(q => q.name.toLowerCase() === (a[0] || '').toLowerCase()); if (q) t = [q.x, q.y, q.z]; }
        if (!t || !t.every(Number.isFinite)) return say('Usage: /tp <x y z> or /tp <player>'); p.x = t[0]; p.y = t[1]; p.z = t[2]; this.send(p, { t: 'tp', x: t[0], y: t[1], z: t[2] }); break; }
      case 'spawn': {
        if (!admin) return say('You need operator rights.'); const type = a[0], n = Math.min(10, parseInt(a[1]) || 1); const at = p || [...this.players.values()][0]; if (!at || !MOB_TYPES.includes(type)) return say('Usage: /spawn <pig|zombie|villager> [n]');
        for (let i = 0; i < n; i++) { const x = Math.floor(at.x + (Math.random() - .5) * 6), z = Math.floor(at.z + (Math.random() - .5) * 6); let y = CH - 2; while (y > 0 && !this.getB(x, y, z)) y--; this.sim.spawn(type, x + .5, y + 1, z + .5); } say(`Spawned ${n} ${type}`); break; }
      case 'kill': { if (!admin) return say('You need operator rights.'); this.sim.clear(a[1]); say('Removed mobs.'); break; }
      case 'say': { if (!admin) return say('You need operator rights.'); this.system(`[Server] ${a.join(' ')}`); break; }
      case 'give': { if (!admin) return say('You need operator rights.'); const q = [...this.players.values()].find(q => q.name.toLowerCase() === (a[0] || '').toLowerCase()), n = parseInt(a[1]); if (!q || !n) return say('Usage: /give <player> <coins>'); this.addCoins(q, n); say(`Gave ${n} coins to ${q.name}`); break; }
      case 'save': { if (!admin) return say('You need operator rights.'); this.hooks.save(this); say('World saved.'); break; }
      default: say('Unknown command. Try /help');
    }
    return out;
  }
  setWeather(type) { this.weather.type = type; this.weather.timer = 120 + Math.random() * 200; this.broadcast({ t: 'weather', type }); this.dirty = true; }
  broadcastTime() { this.broadcast({ t: 'time', tt: this.time, len: this.meta.dayLength }); }

  /* ---------- simulation ---------- */
  /** True while the world has no human in it: it sleeps (bots dropped, match reset, 1 Hz bookkeeping, chunks unloaded). */
  get idle() { return !this.humans() && !(this.summonUntil > Date.now() && this.botCount() > 0); } // summoned bots (admin) keep a room awake for 10 minutes
  idleTick() {
    this.ticks++;
    if (this.players.size) { this.bots?.clear(); for (const p of [...this.players.values()]) if (p.bot) this.leave(p); } // nobody to play against: bots go home
    if (this.ticks % 20 !== 0) return;
    const t0 = performance.now(), dt = TICK * 20;
    this.time = (this.time + dt / this.meta.dayLength) % 1;
    this.weather.timer -= dt; if (this.weather.timer <= 0) { const r = Math.random(); this.setWeather(r < .6 ? 'clear' : r < .9 ? 'rain' : 'storm'); }
    this.mg?.tick(TICK);                                    // with nobody inside this resets the match to a fresh lobby
    if (!this.emptySince) this.emptySince = Date.now(); else if (Date.now() - this.emptySince > 30000 && this.sim.mobs.size) this.sim.clear();
    if (this.fluid.active.size) this.fluid.step(200);
    if (this.ticks % 200 === 0) this.unloadStale();
    this.tickMs = this.tickMs * .95;
    void t0;
  }
  tick() {
    if (this.idle) return this.idleTick();
    if (!this.humans() && !this.players.size && this.ticks % 20 === 0) this.mg?.tick(TICK); // awake only for summoned bots that are gone: let the match reset
    const t0 = performance.now(); this.ticks++;
    { const now = Date.now(); for (const q of this.players.values()) { const h = q.hist ||= [], l = h[h.length - 1]; if (l && Math.abs(q.x - l[1]) + Math.abs(q.y - l[2]) + Math.abs(q.z - l[3]) > 6) h.length = 0; h.push([now, q.x, q.y, q.z]); if (h.length > 24) h.shift(); } } // ~1.2 s of positions for lag-compensated hit checks
    this.time = (this.time + TICK / this.meta.dayLength) % 1;
    this.weather.timer -= TICK; if (this.weather.timer <= 0) { const r = Math.random(); this.setWeather(r < .6 ? 'clear' : r < .9 ? 'rain' : 'storm'); }
    tickEconomy(this.eco, TICK); if (this.ticks % 1200 === 0) for (const id in this.eco.mult) { const h = (this.priceHist[id] ||= []); h.push(+this.eco.mult[id].toFixed(3)); if (h.length > 60) h.shift(); }
    if (!this.players.size) { if (!this.emptySince) this.emptySince = Date.now(); else if (Date.now() - this.emptySince > 30000 && this.sim.mobs.size) this.sim.clear(); } else this.emptySince = 0;
    if (this.players.size) {
      if (this.ticks % 10 === 0) this.ensureChunks();
      const plist = [...this.players.values()].map(p => ({ id: p.id, x: p.x, y: p.y, z: p.z, dead: p.dead || (p.mg ? !p.mg.alive : false) }));
      this.mg?.tick(TICK); this.bots?.tick(TICK);
      this.sim.update(TICK, plist, { night: this.isNight(), sunElev: this.sunElev() });
      for (const ev of this.sim.drainEvents()) {
        if (ev.t === 'dmg') { const p = this.players.get(ev.pid); if (p) { if (this.mg?.mobDamage) this.mg.mobDamage(p, ev.n); else this.send(p, { t: 'dmg', n: ev.n, kx: ev.kx, kz: ev.kz }); } }
        else if (ev.t === 'mobdie') this.broadcast({ t: 'fx', kind: 'mobdie', mtype: ev.mtype, x: ev.x, y: ev.y, z: ev.z, burn: !!ev.burn });
      }
      if (this.ticks % 2 === 0) this.broadcastState(); // 10 Hz binary state frames (interest-managed)
      if (this.ticks % 100 === 0) this.broadcast({ t: 'time', tt: this.time, len: this.meta.dayLength });
      if (this.ticks % 600 === 0 && this.meta.economy) this.broadcast({ t: 'prices', list: snapshotPrices(this.eco), bounties: this.eco.bounties });
    }
    if (this.ticks % 4 === 0 && this.fluid.active.size) this.fluid.step(200); // 5 Hz water flow
    this.flushBlocks();
    const ms = performance.now() - t0; this.tickMs = this.tickMs * .95 + ms * .05;
  }

  /** One batched message per tick instead of one per edit; senders never receive their own edits back. */
  flushBlocks() {
    if (!this.pendingBlocks.length) return; const pb = this.pendingBlocks; this.pendingBlocks = [];
    for (const p of this.players.values()) {
      if (p.ws.readyState !== 1) continue; const list = []; for (const b of pb) if (b[4] !== p.id) list.push([b[0], b[1], b[2], b[3]]);
      if (list.length) this.netOut += 24 + list.length * 14, p.ws.send(JSON.stringify(list.length === 1 ? { t: 'block', x: list[0][0], y: list[0][1], z: list[0][2], id: list[0][3] } : { t: 'blocks', list }));
    }
  }
  /** Binary frame per client: [3][u16 nPlayers]{id,x,y,z,yaw,pitch,st}[u16 nMobs]{id,type,x,y,z,yaw,hp,flags} - only entities near that client. */
  broadcastState() {
    const RP2 = 192 * 192, RM2 = 112 * 112, mobs = [...this.sim.mobs.values()], players = [...this.players.values()], ang = a => { a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return Math.round(a * 1000); };
    for (const p of players) {
      if (p.bot || p.ws.readyState !== 1 || p.ws.bufferedAmount > 262144) continue;
      const near = [], nm = [];
      for (const q of players) { if (q === p) continue; const dx = q.x - p.x, dz = q.z - p.z; if (dx * dx + dz * dz <= RP2) near.push(q); }
      for (const m of mobs) { const dx = m.x - p.x, dz = m.z - p.z; if (dx * dx + dz * dz <= RM2) nm.push(m); }
      if (p.compact) { // opted-in clients get the 13-byte/entity fixed-point frame
        const buf = encodeState(p.x, p.z, near.map(q => ({ id: q.id, x: q.x, y: q.y, z: q.z, yaw: ang(q.yaw), pitch: Math.max(-3000, Math.min(3000, Math.round(q.pitch * 1000))), st: q.st | 0 })),
          nm.map(m => ({ id: m.id, type: MOB_TYPES.indexOf(m.type), x: m.x, y: m.y, z: m.z, yaw: ang(m.yaw), hp: Math.max(0, Math.min(100, Math.round(m.hp / MOB[m.type].hp * 100))), flags: (m.hurt > 0 ? 1 : 0) | (m.atk > .6 ? 2 : 0) })));
        this.netOut += buf.length; p.ws.send(buf, { binary: true }); continue;
      }
      const buf = Buffer.allocUnsafe(5 + (near.length + nm.length) * 19); let o = 0;
      buf[o++] = 3; buf.writeUInt16LE(near.length, o); o += 2;
      for (const q of near) { buf.writeUInt16LE(q.id, o); buf.writeFloatLE(q.x, o + 2); buf.writeFloatLE(q.y, o + 6); buf.writeFloatLE(q.z, o + 10); buf.writeInt16LE(ang(q.yaw), o + 14); buf.writeInt16LE(Math.max(-3000, Math.min(3000, Math.round(q.pitch * 1000))), o + 16); buf[o + 18] = q.st | 0; o += 19; }
      buf.writeUInt16LE(nm.length, o); o += 2;
      for (const m of nm) { buf.writeUInt16LE(m.id, o); buf[o + 2] = MOB_TYPES.indexOf(m.type); buf.writeFloatLE(m.x, o + 3); buf.writeFloatLE(m.y, o + 7); buf.writeFloatLE(m.z, o + 11); buf.writeInt16LE(ang(m.yaw), o + 15); buf[o + 17] = Math.max(0, Math.min(100, Math.round(m.hp / MOB[m.type].hp * 100))); buf[o + 18] = (m.hurt > 0 ? 1 : 0) | (m.atk > .6 ? 2 : 0); o += 19; }
      this.netOut += buf.length; p.ws.send(buf, { binary: true });
    }
  }
  /** Positions for the admin live map. */
  liveSnapshot() { return { players: [...this.players.values()].map(p => [p.id, p.name, +p.x.toFixed(1), +p.z.toFixed(1), +p.y.toFixed(1)]), mobs: [...this.sim.mobs.values()].slice(0, 300).map(m => [MOB_TYPES.indexOf(m.type), +m.x.toFixed(1), +m.z.toFixed(1)]) }; }
  adjustWallet(name, { delta, set }) {
    const key = Object.keys(this.wallets).find(k => (this.wallets[k].name || '').toLowerCase() === String(name).toLowerCase()); if (!key) return null; const w = this.wallets[key];
    w.coins = Math.max(0, set !== undefined ? set : w.coins + (delta || 0)); this.dirty = true; const online = [...this.players.values()].find(p => p.uid === key); if (online) this.sendWallet(online); return w;
  }
  syncBounties() { this.dirty = true; this.broadcast({ t: 'prices', list: snapshotPrices(this.eco), bounties: this.eco.bounties }); }
  rerollBounties() { this.eco.bounties = genBounties(); this.dirty = true; this.broadcast({ t: 'prices', list: snapshotPrices(this.eco), bounties: this.eco.bounties }); }
  setMult(id, v) { if (!(id in this.eco.mult)) return false; this.eco.mult[id] = Math.max(.35, Math.min(2.5, v)); this.dirty = true; this.broadcast({ t: 'prices', list: snapshotPrices(this.eco), bounties: this.eco.bounties }); return true; }
  snapshotMeta() { return { meta: this.meta, wallets: this.wallets, eco: this.eco, time: this.time, weather: this.weather.type }; }
  /** compact live summary of the running match for the admin panel */
  gameInfo() { const g = this.mg; if (!g) return null; let top = null; try { const b = g.board()[0]; if (b) top = { name: b.name, k: b.k }; } catch { /* board not ready */ } return { state: g.state, time: Math.ceil(g.t), winner: g.winner || '', round: g.round | 0, top }; }
  botCount() { let n = 0; for (const p of this.players.values()) if (p.bot) n++; return n; }
  stats() { return { game: this.gameInfo(), liveBots: this.botCount(), humans: this.humans(), netOut: this.netOut, id: this.meta.id, players: this.players.size, chunks: this.chunks.size, mobs: this.sim.mobs.size, edits: this.editCount, tickMs: +this.tickMs.toFixed(2), time: +this.time.toFixed(3), weather: this.weather.type }; }
}
