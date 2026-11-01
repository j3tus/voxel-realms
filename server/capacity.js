// Capacity governor. Turns live server health (tick time, event-loop lag, memory, CPU) into a budget of "player slots" and
// answers: how many rooms/players can we still host, how big may a new custom game be, and how many bots may fill games.
// A slot is roughly one human in an active game. Bots cost less, sleeping (empty) rooms almost nothing.
import fs from 'node:fs';
import os from 'node:os';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const COST = { human: 1, bot: .35, room: .05, roomBase: { lobby: .5 } };

/** memory ceiling in bytes: VR_MEM_MB, else the cgroup limit (systemd MemoryMax), else 60% of the machine */
export function memLimit(env = process.env, read = p => fs.readFileSync(p, 'utf8'), total = os.totalmem()) {
  if (+env.VR_MEM_MB > 0) return +env.VR_MEM_MB * 1048576;
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) { try { const v = +read(f).trim(); if (v > 0 && v < total) return v; } catch { /* not in a cgroup */ } }
  return total * .6;
}

/** m = { tickMs, lagP99, rss, memLimit, cpu (% of one core), cores }, rooms = [{ humans, bots, idle, mode }] */
export function computeCapacity(m, rooms = [], opts = {}) {
  const cores = Math.max(1, m.cores || 1), base = opts.base ?? clamp(cores * 10, 8, 80);
  const reasons = [];
  const tickScale = 1 - clamp(((m.tickMs || 0) - 10) / 30, 0, 1) * .9; if (tickScale < .8) reasons.push('tick time');
  const lagScale = 1 - clamp(((m.lagP99 || 0) - 20) / 80, 0, 1) * .9; if (lagScale < .8) reasons.push('event-loop lag');
  const head = m.memLimit ? 1 - (m.rss || 0) / m.memLimit : 1, memScale = clamp((head - .12) / .5, 0, 1); if (memScale < .8) reasons.push('memory');
  const cpuN = (m.cpu || 0) / cores, cpuScale = 1 - clamp((cpuN - 55) / 40, 0, 1) * .9; if (cpuScale < .8) reasons.push('cpu');
  const scale = clamp(Math.min(tickScale, lagScale, memScale, cpuScale), .1, 1), budget = base * scale;
  let used = 0, humans = 0, bots = 0, active = 0;
  for (const r of rooms) { humans += r.humans || 0; bots += r.bots || 0; if (r.idle) used += COST.room; else { active++; used += (r.humans || 0) * COST.human + (r.bots || 0) * COST.bot + (COST.roomBase[r.mode] || 0); } }
  const free = Math.max(0, budget - used), ratio = budget ? used / budget : 1;
  const level = ratio >= .9 || scale < .35 ? 'full' : ratio >= .6 || scale < .7 ? 'busy' : 'ok';
  return {
    level, scale: +scale.toFixed(2), budget: +budget.toFixed(1), used: +used.toFixed(1), free: +free.toFixed(1), humans, bots, active, reasons,
    maxRoom: clamp(Math.floor(free / 1.2), 0, 16),                  // biggest custom game that still fits
    botDensity: level === 'ok' ? 1 : level === 'busy' ? clamp(scale, .25, .7) : .2, // multiplier on automatic bot fill
    canOpen: (players = 8, bots = 0) => level !== 'full' && free >= players * .35 + bots * COST.bot + 1,
  };
}

/** live inputs from the running process */
export function readMetrics({ worlds, lagP99, rates }) {
  const mem = process.memoryUsage(); let tick = 0; for (const w of worlds) tick = Math.max(tick, w.tickMs || 0);
  return { tickMs: tick, lagP99: lagP99 || 0, rss: mem.rss, memLimit: memLimit(), cpu: rates?.cpu || 0, cores: os.cpus().length };
}
export const roomLoad = w => ({ humans: w.humans(), bots: w.botCount?.() || 0, idle: w.idle, mode: w.meta.mode });
