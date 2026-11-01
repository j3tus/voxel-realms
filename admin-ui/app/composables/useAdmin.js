// Single shared admin store: auth, REST client, live websocket stream, chart history, toasts and dialogs.
import { reactive } from 'vue'

const KEYS = ['players', 'bots', 'tick', 'lag', 'netIn', 'netOut', 'cpu', 'mem']
const state = reactive({
  token: '', authed: false, booting: true, loginErr: '', loggingIn: false,
  status: null, worlds: [], online: false, logs: [], chat: [], hist: Object.fromEntries(KEYS.map(k => [k, []])),
  toasts: [], dialog: null,
})
/** latest and previous 1 Hz live snapshots per world (plain objects on purpose: they are read every animation frame) */
export const liveStore = { cur: {}, prev: {}, at: 0 }
let ws = null, retryT = null, tid = 0

const push = (a, v, n = 90) => { a.push(v); if (a.length > n) a.shift() }

export async function api(method, path, body, raw) {
  const r = await fetch('/api/admin' + path, { method, headers: { Authorization: 'Bearer ' + state.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (r.status === 401) { signOut(); throw new Error('Session expired') }
  if (r.status === 429) throw new Error('Too many attempts, try again in a minute')
  if (r.status === 503) throw new Error('Admin is disabled until a strong ADMIN_PASSWORD is set')
  if (raw) return r
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || j.message || r.statusText)
  return j
}

let worldSig = '', worldBusy = false
/** rooms are created and closed while the panel is open: keep the world list (names, seeds, modes) in step with the live status */
function syncWorlds(s) {
  const live = s.worlds.map(w => w.id).sort().join(','); if (live === worldSig || worldBusy) return
  const have = state.worlds.map(w => w.id).sort().join(','); worldSig = live; if (have === live) return
  worldBusy = true; loadWorlds().catch(() => { worldSig = '' }).finally(() => { worldBusy = false })
}
function onStatus(s) {
  state.status = s; syncWorlds(s)
  const h = state.hist
  push(h.players, s.players || 0); push(h.bots, s.bots || 0); push(h.tick, s.tickMs || 0); push(h.lag, s.loopLagMs || 0)
  push(h.netIn, (s.netInBps || 0) / 1024); push(h.netOut, (s.netOutBps || 0) / 1024); push(h.cpu, s.cpu || 0); push(h.mem, (s.rss || 0) / 1048576)
}
function addLog(e) { push(state.logs, e, 300) }

function connect() {
  clearTimeout(retryT); if (ws) { ws.onclose = null; ws.close() }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/admin/stream')
  ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: state.token }))
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data) } catch { return }
    if (m.t === 'ready') { state.logs = []; m.logs.forEach(addLog); onStatus(m.status); state.online = true }
    else if (m.t === 'stats') onStatus(m)
    else if (m.t === 'log') addLog(m)
    else if (m.t === 'join' || m.t === 'leave') addLog({ at: Date.now(), level: 'info', msg: `${m.name} ${m.t === 'join' ? 'joined' : 'left'} ${m.world}` })
    else if (m.t === 'live') { liveStore.prev = liveStore.cur; liveStore.cur = m.worlds; liveStore.at = performance.now() }
    else if (m.t === 'chat') push(state.chat, { at: Date.now(), name: m.name, text: m.text, world: m.world, sys: m.sys }, 300)
  }
  ws.onclose = () => { state.online = false; if (state.authed) retryT = setTimeout(connect, 3000) }
}

export async function loadWorlds() { state.worlds = await api('GET', '/worlds') }

async function enter() {
  state.authed = true; sessionStorage.setItem('vr_admin', state.token)
  await loadWorlds().catch(() => {}); connect()
}
export async function boot() {
  state.token = sessionStorage.getItem('vr_admin') || ''
  if (state.token) { try { await api('GET', '/status'); await enter() } catch { state.authed = false } }
  state.booting = false
}
export async function signIn(pw) {
  state.loginErr = ''; state.loggingIn = true; state.token = pw.trim()
  try { await api('GET', '/status'); await enter() }
  catch (e) { state.token = ''; state.loginErr = e.message === 'Session expired' ? 'Wrong password' : e.message }
  state.loggingIn = false
}
export function signOut() { sessionStorage.removeItem('vr_admin'); state.token = ''; state.authed = false; state.online = false; if (ws) { ws.onclose = null; ws.close() } clearTimeout(retryT) }

/* ---- toasts ---- */
export function toast(msg, bad) { const id = ++tid; state.toasts.push({ id, msg, bad: !!bad }); setTimeout(() => { state.toasts = state.toasts.filter(t => t.id !== id) }, 3200) }
/** wrap an async handler so errors become toasts */
export const act = fn => async (...a) => { try { return await fn(...a) } catch (e) { toast(e.message, true) } }

/* ---- dialogs ---- */
function openDialog(d) { return new Promise(resolve => { state.dialog = { ...d, resolve } }) }
export const confirmBox = (title, text, danger = true, ok = 'Confirm') => openDialog({ kind: 'confirm', title, text, danger, ok })
export const promptBox = (title, label, value = '', type = 'text') => openDialog({ kind: 'prompt', title, label, value, type, ok: 'Save' })
export function closeDialog(v) { const d = state.dialog; state.dialog = null; if (d) d.resolve(v) }

export const useAdmin = () => state
