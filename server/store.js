// Persistence: server config + per-world files, atomic writes, an append-only edit journal, backups.
//   worlds/<id>.meta.json   settings, wallets, economy, time, weather (small, rewritten often)
//   worlds/<id>.edits.json  compact per-chunk snapshot of block edits   (rewritten only on compaction)
//   worlds/<id>.log         "x y z id" journal of edits since the snapshot (append-only, O(1) per edit)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const WORLD_DIR = path.join(DATA_DIR, 'worlds'), BACKUP_DIR = path.join(DATA_DIR, 'backups'), CONFIG_FILE = path.join(DATA_DIR, 'config.json');
for (const d of [DATA_DIR, WORLD_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

export const safeId = s => String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
function atomicWrite(file, text) { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); }
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const wp = (id, ext) => path.join(WORLD_DIR, safeId(id) + ext);

export function hashToken(token, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(token), salt, 32).toString('hex') };
}
export function checkToken(token, rec) {
  if (!token || !rec) return false;
  const h = crypto.scryptSync(String(token), rec.salt, 32), want = Buffer.from(rec.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

const DEFAULT_CONFIG = () => ({
  name: 'Voxel Realms Server', motd: 'Welcome! Build something great.', maxPlayers: 16, password: null,
  worlds: [{ id: 'main', name: 'Overworld', seed: (Math.random() * 1e9) | 0, type: 'normal', mode: 'creative', dayLength: 420, economy: false, mobs: true, hostile: true, maxPlayers: 16 }],
  bans: { names: [], ips: [], uids: [] }, ops: [], admin: null,
  mutes: [], rooms: [], bots: { enabled: true, skill: 'normal', density: 1, tuning: {} }, maintenance: { on: false, msg: 'The server is under maintenance. Please try again soon.' }, allowlist: { on: false, names: [] },
});

/** Loads config. Returns { config, newToken } - newToken is set only when an admin password was generated on this run. */
export function loadConfig() {
  let config; try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { config = DEFAULT_CONFIG(); }
  config = { ...DEFAULT_CONFIG(), ...config }; let newToken = null;
  const envPw = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN;
  if (envPw) config.admin = hashToken(envPw);
  else if (!config.admin) { newToken = crypto.randomBytes(12).toString('base64url'); config.admin = hashToken(newToken); } // first start: a random password is printed once
  saveConfig(config); return { config, newToken };
}
export function saveConfig(config) { atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 2)); try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* windows */ } }

/* ---------- edits: Map("cx,cz" -> Map(index -> id)) ---------- */
export function addEdit(ce, x, y, z, id) {
  const k = (x >> 4) + ',' + (z >> 4); let m = ce.get(k); if (!m) ce.set(k, m = new Map());
  const idx = (x & 15) + 16 * ((z & 15) + 16 * y); const fresh = !m.has(idx); m.set(idx, id); return fresh;
}
export const countEdits = ce => { let n = 0; for (const m of ce.values()) n += m.size; return n; };
export function ceToCompact(ce) { const out = []; for (const [k, m] of ce) { const [cx, cz] = k.split(',').map(Number), arr = []; for (const [idx, v] of m) arr.push(idx, v); out.push([cx, cz, arr]); } return out; }
export function compactToCe(list) { const ce = new Map(); for (const [cx, cz, arr] of list || []) { const m = new Map(); for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]); ce.set(cx + ',' + cz, m); } return ce; }

/** Returns null or { meta, wallets, eco, time, weather, ce, journalLines, migrated } */
export function loadWorld(id) {
  const meta = readJson(wp(id, '.meta.json')), legacy = readJson(wp(id, '.json'));
  if (!meta && !legacy) return null;
  const base = meta || { meta: legacy.meta, wallets: legacy.wallets, eco: legacy.eco, time: legacy.time, weather: legacy.weather };
  let ce = new Map(); const snap = readJson(wp(id, '.edits.json'));
  if (snap) ce = compactToCe(snap); else if (legacy?.edits) for (const [key, v] of legacy.edits) { const [x, y, z] = key.split(',').map(Number); addEdit(ce, x, y, z, v); }
  let lines = 0;
  try { for (const line of fs.readFileSync(wp(id, '.log'), 'utf8').split('\n')) { if (!line) continue; const [x, y, z, v] = line.split(' ').map(Number); if ([x, y, z, v].every(Number.isFinite)) { addEdit(ce, x, y, z, v); lines++; } } } catch { /* no journal */ }
  return { ...base, ce, journalLines: lines, migrated: !meta };
}
export function saveMeta(id, data) { atomicWrite(wp(id, '.meta.json'), JSON.stringify(data)); }
export function saveEditsSnapshot(id, ce) { atomicWrite(wp(id, '.edits.json'), JSON.stringify(ceToCompact(ce))); }
export function dropLegacy(id) { try { fs.unlinkSync(wp(id, '.json')); } catch { /* none */ } }
export function deleteWorld(id) { for (const e of ['.meta.json', '.edits.json', '.log', '.json']) { try { fs.unlinkSync(wp(id, e)); } catch { /* none */ } } }

/** Buffered append-only journal: appending an edit is just a string push; a timer flushes to disk. */
export function openJournal(id, existingLines = 0) {
  const file = wp(id, '.log'); let buf = [], lines = existingLines, fd = fs.openSync(file, 'a');
  const flush = () => { if (!buf.length) return; const s = buf.join(''); buf = []; try { fs.writeSync(fd, s); } catch { /* disk full etc. */ } };
  const timer = setInterval(flush, 750); timer.unref?.();
  return {
    append(x, y, z, v) { buf.push(`${x} ${y} ${z} ${v}\n`); lines++; }, flush, get lines() { return lines; },
    truncate() { flush(); try { fs.closeSync(fd); fs.truncateSync(file, 0); } catch { /* ignore */ } fd = fs.openSync(file, 'a'); lines = 0; },
    close() { clearInterval(timer); flush(); try { fs.closeSync(fd); } catch { /* ignore */ } },
  };
}

export function backupWorld(id, data) {
  const file = path.join(BACKUP_DIR, `${safeId(id)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`); atomicWrite(file, JSON.stringify(data));
  const all = listBackups(id); for (const old of all.slice(10)) { try { fs.unlinkSync(path.join(BACKUP_DIR, old.file)); } catch { /* ignore */ } }
  return path.basename(file);
}
export function listBackups(id) {
  const pre = safeId(id) + '-'; return fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith(pre) && f.endsWith('.json'))
    .map(f => ({ file: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, at: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs })).sort((a, b) => b.at - a.at);
}
export function readBackup(file) { const f = path.basename(file); if (!/^[a-z0-9_-]+-[\w-]+\.json$/.test(f)) return null; try { return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8')); } catch { return null; } }
