// Extended chat / console commands. Called first by GameWorld.command(); returns true when it handled the command.
// p is null for the admin console (always admin). `say` replies to the caller and returns the text for the console.
import { MODE_TITLE, ROOM_MODES } from './rooms.js';
import { BOT_MODES, TUNABLE, sanitizeTuning } from './bots.js';

const SKILLS = ['easy', 'normal', 'hard'], clock = t => Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
const titleOf = m => MODE_TITLE[m] || m;
const num = v => (v !== undefined && /^\d+$/.test(String(v)) ? parseInt(v, 10) : null);
const modeOf = s => { s = String(s || '').toLowerCase(); return ROOM_MODES.includes(s) ? s : Object.keys(MODE_TITLE).find(k => MODE_TITLE[k].toLowerCase().replace(/[^a-z]/g, '') === s.replace(/[^a-z]/g, '')) || null; };
const ALIAS = { summon: 'bot', bots: 'bot', tell: 'msg', w: 'msg', whisper: 'msg', cap: 'capacity', hub: 'lobby', quit: 'lobby', leave: 'lobby', playnow: 'quick', play: 'quick', broadcast: 'announce', players: 'list', who: 'list', stat: 'stats', me2: 'whoami' };

const roomLine = r => `${r.name} [${r.id}] ${r.players}/${r.max}${r.bots ? ' +' + r.bots + ' bots' : ''} · ${r.state === 'play' ? 'live ' + clock(r.time) : r.state === 'end' ? 'ending' : r.players >= r.max ? 'full' : 'open'}`;

export function runExtra(w, p, raw, a, say, admin) {
  const cmd = ALIAS[raw] || raw, hooks = w.hooks;
  const target = name => hooks.findPlayer?.(name);
  const need = () => { if (admin) return false; say('You need operator rights for that.'); return true; };
  switch (cmd) {
    case 'help': {
      const topic = (a[0] || '').toLowerCase();
      const L = {
        play: ['Play: /rooms [mode] — list open games · /quick [mode] — jump into the best one · /join <code|mode> · /lobby',
          'Make your own: /create <mode> [players] [bots] [easy|normal|hard] [public] · e.g. /create tdm 12 4 hard public'],
        social: ['Social: /party (invite/accept/leave) · /msg <player> <text> · /me <text> · /list · /ping · /stats · /whoami'],
        admin: ['Moderation: /kick <p> [reason] · /ban <p> · /unban <name> · /op /deop <p> · /mute /unmute <p> · /heal [p] · /bring <p> · /tp <x y z|p>',
          'Bots: /bot add [n] [skill] [name] · /bot remove [n] · /bot clear · /bot count <n> · /bot auto · /bot skill <lvl> · /bot pause|resume · /bot list',
          'Games: /round start|end|restart · /room create <mode> [players] [bots] [name] · /room close <id> · /room list · /capacity · /status',
          'World: /time <day|night|0-1> · /weather <clear|rain|storm> · /spawn <pig|zombie|villager|boss> [n] · /kill mobs · /give <p> <coins> · /announce <text> · /say <text> · /save · /seed'],
      };
      if (L[topic] && (topic !== 'admin' || admin)) { L[topic].forEach(say); return true; }
      say('Commands, by topic: /help play · /help social' + (admin ? ' · /help admin' : '')); L.play.forEach(say); L.social.forEach(say); if (admin) say('Operator commands: /help admin'); return true;
    }
    case 'rooms': {
      const mode = a[0] ? modeOf(a[0]) : null; if (a[0] && !mode) { say('Unknown mode. Try: ' + ROOM_MODES.join(', ')); return true; }
      const list = (hooks.rooms?.() || []).filter(r => !mode || r.mode === mode).sort((x, y) => x.mode.localeCompare(y.mode) || x.name.localeCompare(y.name));
      if (!list.length) { say('No open games right now. Start one with /create <mode>.'); return true; }
      let last = ''; for (const r of list.slice(0, 20)) { if (r.mode !== last) { last = r.mode; say(`— ${titleOf(r.mode)} —`); } say('  ' + roomLine(r)); }
      const c = hooks.capacity?.(); if (c) say(`Server load: ${c.level} · room for about ${c.maxRoom} more players in a new game`); return true;
    }
    case 'quick': {
      if (!p) { say('Console cannot travel.'); return true; } const mode = a[0] ? modeOf(a[0]) : null; if (a[0] && !mode) { say('Unknown mode. Try: ' + ROOM_MODES.join(', ')); return true; }
      const rs = (hooks.rooms?.() || []).filter(r => (!mode || r.mode === mode) && r.id !== w.meta.id && r.players < r.max && r.mode !== 'parkour' && r.mode !== 'spleef');
      if (!rs.length) { say(mode ? `No open ${titleOf(mode)} game. Try /create ${mode}.` : 'No open games. Try /create <mode>.'); return true; }
      rs.sort((x, y) => (y.state === 'lobby') - (x.state === 'lobby') || (y.players / y.max) - (x.players / x.max)); const r = rs[0];
      say(`Joining ${r.name}…`); w.send(p, { t: 'transfer', world: r.id, name: r.name }); return true;
    }
    case 'lobby': return false;                                       // original handler
    case 'join': {
      const arg = String(a[0] || '').toLowerCase(); if (!arg) { say('Usage: /join <code|mode>  (see /rooms)'); return true; }
      if (!(hooks.worlds?.() || []).some(x => x.id === arg) && modeOf(arg)) return runExtra(w, p, 'quick', [arg], say, admin); return false;
    }
    case 'create': {
      if (!p) { say('Console cannot create games. Use /room create <mode> [players] [bots] [name].'); return true; } if (!hooks.createGame) return false;
      const mode = modeOf(a[0]); if (!mode) { say((a[0] ? `Unknown mode "${a[0]}". ` : '') + 'Usage: /create <mode> [players] [bots] [easy|normal|hard] [public]. Modes: ' + ROOM_MODES.join(', ')); return true; }
      const nums = [], o = { public: false }; for (const t of a.slice(1)) { const l = t.toLowerCase(), kv = l.split('='); if (SKILLS.includes(l)) o.skill = l; else if (l === 'public') o.public = true; else if (kv[0] === 'players' || kv[0] === 'p') o.players = num(kv[1]); else if (kv[0] === 'bots' || kv[0] === 'b') o.bots = num(kv[1]); else if (num(l) !== null) nums.push(num(l)); }
      if (nums.length === 1) o.bots ??= nums[0]; else if (nums.length >= 2) { o.players ??= nums[0]; o.bots ??= nums[1]; }
      const r = hooks.createGame({ mode, ...o, owner: p }); if (r.error) { say(r.error); return true; }
      say(`Created ${r.name}: ${r.players} slots, ${r.bots} bot${r.bots === 1 ? '' : 's'}${r.trimmed ? ' (trimmed to fit the server)' : ''}.${r.public ? ' It is listed in /rooms.' : ''} Friends can join with /join ${r.id}`);
      const party = hooks.parties?.get(p.uid), group = party && party.leader === p.uid ? [...w.players.values()].filter(q => party.members.has(q.uid)) : [p];
      for (const q of group) w.send(q, { t: 'transfer', world: r.id, name: r.name }); return true;
    }
    case 'list': {
      const all = admin && a[0] === 'all', ws = all ? [...(hooks.allWorlds?.() || [w])] : [w];
      for (const x of ws) { const hs = [...x.players.values()].filter(q => !q.bot).map(q => q.name + (q.op ? '*' : '')), nb = x.botCount(); say(`${all ? x.meta.name + ': ' : 'Online: '}${hs.join(', ') || 'nobody'}${nb ? ` (+${nb} bots)` : ''}`); } return true;
    }
    case 'msg': {
      if (!p) { say('Usage from the console: /announce <text>'); return true; } const t = target(a[0]); if (!t) { say('No player called "' + (a[0] || '') + '" is online.'); return true; } if (!a[1]) { say('Usage: /msg <player> <text>'); return true; }
      if (t.p.bot) { say('Bots do not read their mail.'); return true; } t.w.send(t.p, { t: 'chat', sys: true, text: `[${p.name} → you] ${a.slice(1).join(' ')}` }); say(`[you → ${t.p.name}] ${a.slice(1).join(' ')}`); return true;
    }
    case 'ping': { say(p ? `Your ping: ${p.rtt || '?'} ms · server load: ${hooks.capacity?.().level || 'ok'}` : 'pong'); return true; }
    case 'whoami': { if (!p) { say('You are the console.'); return true; } say(`${p.name}${p.op ? ' (operator)' : ''} · world ${w.meta.name} (${titleOf(w.meta.mode)})`); return true; }
    case 'stats': { if (!p) return false; const g = p.mg, wal = w.wallet?.(p); say(`Stats: ${g ? `${g.kills} kills, ${g.deaths} deaths, ${g.wins || 0} wins` : 'no match stats here'}${wal ? ` · ${wal.coins} coins` : ''}`); return true; }
    case 'seed': { say('Seed: ' + w.meta.seed); return true; }
    case 'status': { if (need()) return true; const c = hooks.capacity?.(), all = hooks.allWorlds?.() || [w]; say(`Load ${c?.level || '?'} (${c?.used}/${c?.budget} slots, scale ${c?.scale}${c?.reasons?.length ? ', limited by ' + c.reasons.join('/') : ''})`); say(`${all.filter(x => !x.idle).length} active / ${all.length} worlds · ${all.reduce((n, x) => n + x.humans(), 0)} players · ${all.reduce((n, x) => n + x.botCount(), 0)} bots`); return true; }
    case 'capacity': { if (need()) return true; const c = hooks.capacity?.(); if (!c) return false; say(`Capacity ${c.level}: ${c.used}/${c.budget} slots used, ${c.free} free · biggest new game ≈ ${c.maxRoom} players · bot fill ×${c.botDensity}${c.reasons.length ? ' · limited by ' + c.reasons.join(', ') : ''}`); return true; }
    case 'announce': { if (need()) return true; if (!a.length) { say('Usage: /announce <text>'); return true; } hooks.announce?.(a.join(' ')); say('Announced to every world.'); return true; }

    /* ---- bots ---- */
    case 'bot': {
      if (need()) return true; if (!BOT_MODES.includes(w.meta.mode)) { say('Bots do not play ' + titleOf(w.meta.mode) + '.'); return true; }
      const sub = (raw === 'summon' ? 'add' : (a[0] || 'list')).toLowerCase(), rest = raw === 'summon' ? a : a.slice(1), m = w.meta; const dir = () => (w.bots ||= hooks.newDirector?.(w));
      switch (sub) {
        case 'add': case 'spawn': { const n = Math.max(1, Math.min(16, num(rest[0]) ?? 1)); const skill = rest.find(x => SKILLS.includes(String(x).toLowerCase())), name = rest.find(x => num(x) === null && !SKILLS.includes(String(x).toLowerCase()));
          const got = dir().summon(n, { skill: skill?.toLowerCase(), name, at: p ? [p.x, p.y, p.z] : w.spawn }); w.summonUntil = Date.now() + 600000; say(`Summoned ${got.length} bot${got.length === 1 ? '' : 's'}${skill ? ' (' + skill + ')' : ''}${name ? ' named ' + name : ''}. They stay until /bot clear.`); return true; }
        case 'remove': case 'kick': { const n = Math.max(1, num(rest[0]) ?? 1); say(`Removed ${w.bots ? w.bots.removeN(n) : 0} bot(s).`); return true; }
        case 'clear': { const n = w.botCount(); w.bots?.clear(); w.summonUntil = 0; say(`Removed ${n} bot(s).`); return true; }
        case 'count': case 'fill': { const n = num(rest[0]); if (n === null) { say('Usage: /bot count <n>  (total bots to keep while humans are playing)'); return true; } m.bots = Math.min(31, n); m.botsFixed = true; m.botsPaused = false; dir(); say(`Bots will fill this game to ${m.bots}.`); return true; }
        case 'auto': { delete m.bots; delete m.botsFixed; m.botsPaused = false; dir(); say('Bot fill is back to the automatic default.'); return true; }
        case 'skill': { const s = (rest[0] || '').toLowerCase(); if (!SKILLS.includes(s)) { say('Usage: /bot skill <easy|normal|hard>'); return true; } m.botSkill = s; say(`Bot skill set to ${s} (applies to automatic bots).`); return true; }
        case 'tune': { // /bot tune                 show this world's settings
          //            /bot tune <param> <v>    e.g. /bot tune react 0.4   |   /bot tune reset
          const prof = dir().profile(null);
          if (!rest.length) { say('Bot tuning: ' + Object.keys(TUNABLE).map(k => `${k}=${+prof[k].toFixed(3)} [${TUNABLE[k].join('-')}]`).join(', ')); return true; }
          if (rest[0] === 'reset') { delete m.botTuning; say('Bot tuning reset to the skill preset.'); return true; }
          const k = String(rest[0]).toLowerCase(), v = num(rest[1]); if (!TUNABLE[k] || v === null) { say('Usage: /bot tune <' + Object.keys(TUNABLE).join('|') + '> <value> | reset'); return true; }
          m.botTuning = sanitizeTuning({ ...(m.botTuning || {}), [k]: v }); say(`Bot ${k} set to ${m.botTuning[k]} (range ${TUNABLE[k].join('-')}).`); return true; }
        case 'pause': { m.botsPaused = true; if (w.bots) while (w.bots.remove(false)); say('Automatic bots paused (summoned bots stay).'); return true; }
        case 'resume': { m.botsPaused = false; say('Automatic bots resumed.'); return true; }
        default: { const bots = [...w.players.values()].filter(q => q.bot); say(bots.length ? `${bots.length} bot(s): ` + bots.map(b => b.name.replace('[Bot] ', '') + (b.summoned ? '*' : '')).join(', ') + ' (* = summoned)' : 'No bots here.'); say(`Target: ${m.bots ?? 'auto'}${m.botsFixed ? ' (fixed)' : ''} · skill ${m.botSkill || 'default'}${m.botsPaused ? ' · PAUSED' : ''} · /help admin`); return true; }
      }
    }

    /* ---- rounds & rooms ---- */
    case 'round': {
      if (need()) return true; const mg = w.mg; if (!mg || !mg.startRound) { say('This world has no rounds.'); return true; } const sub = (a[0] || '').toLowerCase(), ps = mg.list?.() || [];
      if (sub === 'start') { if (mg.state === 'play') { say('A round is already running.'); return true; } if (!ps.length) { say('Nobody is in the game yet.'); return true; } mg.startRound(ps); say('Round started.'); return true; }
      if (sub === 'end') { if (mg.state !== 'play') { say('No round is running.'); return true; } mg.endRound('ADMIN'); say('Round ended.'); return true; }
      if (sub === 'restart') { if (mg.state === 'play') mg.endRound('ADMIN'); mg.state = 'lobby'; mg.t = 3; say('Restarting: new round in a few seconds.'); return true; }
      say('Usage: /round start|end|restart'); return true;
    }
    case 'room': {
      if (need()) return true; const sub = (a[0] || 'list').toLowerCase();
      if (sub === 'list') { (hooks.rooms?.() || []).forEach(r => say(roomLine(r) + ` · ${r.source}`)); return true; }
      if (sub === 'close') { const ok = hooks.closeRoom?.(a[1]); say(ok ? 'Room closed.' : 'No such temporary room: ' + (a[1] || '?')); return true; }
      if (sub === 'create') { const mode = modeOf(a[1]); if (!mode) { say('Usage: /room create <mode> [players] [bots] [name…]'); return true; } const players = num(a[2]) ?? 8, bots = num(a[3]) ?? 2, name = a.slice(4).join(' ') || undefined;
        const r = hooks.createRoom?.({ mode, players, bots, name, source: 'admin', pinned: true, force: true }); say(r?.error || `Opened ${r.name} [${r.id}] with ${r.players} slots and ${r.bots} bots.`); return true; }
      say('Usage: /room list | create <mode> [players] [bots] [name] | close <id>'); return true;
    }

    /* ---- moderation (goes through the same audited paths as the web panel) ---- */
    case 'kick': case 'ban': case 'op': case 'deop': case 'mute': case 'unmute': {
      if (need()) return true; const t = target(a[0]); if (!t) { say('No player called "' + (a[0] || '') + '" is online.'); return true; } if (t.p.bot) { if (cmd === 'kick') { t.w.bots?.remove?.(); t.w.leave(t.p); say('Bot removed.'); } else say('That is a bot.'); return true; }
      const body = cmd === 'kick' ? { reason: a.slice(1).join(' ') || 'Kicked by an administrator' } : cmd === 'op' ? { value: true } : cmd === 'deop' ? { value: false } : cmd === 'mute' ? { value: true } : cmd === 'unmute' ? { value: false } : { reason: 'Banned' };
      hooks.act?.('POST', `/api/admin/players/${t.p.id}/${cmd === 'deop' ? 'op' : cmd === 'unmute' ? 'mute' : cmd}`, body).catch(() => {}); say(`${cmd} ${t.p.name}: done.`); return true;
    }
    case 'unban': { if (need()) return true; if (!a[0]) { say('Usage: /unban <name>'); return true; } hooks.act?.('DELETE', '/api/admin/bans', { kind: 'names', value: a[0].toLowerCase() }).catch(() => {}); say(`Unbanned name "${a[0]}" (IP/device bans: web panel → Security).`); return true; }
    case 'heal': { if (need()) return true; const t = a[0] ? target(a[0]) : p && { w, p }; if (!t) { say('Usage: /heal [player]'); return true; } if (t.p.mg) { t.p.mg.hp = 20; t.p.mg.alive = true; t.w.mg?.sendHp?.(t.p); } say(`Healed ${t.p.name}.`); return true; }
    case 'bring': { if (need()) return true; if (!p) { say('Console cannot bring players.'); return true; } const t = target(a[0]); if (!t) { say('No player called "' + (a[0] || '') + '" is online.'); return true; } if (t.w !== w) { say('They are in another world. Use /msg or have them /join.'); return true; } t.p.x = p.x; t.p.y = p.y; t.p.z = p.z; w.send(t.p, { t: 'tp', x: p.x, y: p.y, z: p.z }); say(`Brought ${t.p.name}.`); return true; }
    default: return false;
  }
}
