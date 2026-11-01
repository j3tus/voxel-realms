<script setup>
// High-quality live map: block-accurate hill-shaded terrain (web worker), the server's real loaded chunks on top (builds, arenas),
// smooth pan / wheel / pinch zoom, and interpolated live markers. Everything is drawn on one device-pixel-sharp canvas.
const s = useAdmin()
const wrap = ref(null), cv = ref(null)
const worldId = ref(''), selected = ref(null), followId = ref(null), tick = ref(0), cursor = ref(''), zoomText = ref(''), busy = ref(false), side = ref(true)
const layers = reactive({ builds: true, contours: false, grid: true, names: true, mobs: true, bots: true })
const V = { cx: 0, cz: 0, ppb: 3, cw: 800, ch: 560, dpr: 1, spawn: null, gesturing: false }
let worker = null, genId = 0, bmp = null, raf = 0, renderT = 0, ro = null, hits = [], needCenter = true, lastFollowRender = 0, tickT = 0
const pointers = new Map(); let pinch0 = 0

const world = () => s.worlds.find(w => w.id === worldId.value)
const isBot = n => /^\[Bot\]/i.test(n)
const players = computed(() => { tick.value; const c = liveStore.cur[worldId.value]; return c ? c.players.filter(p => layers.bots || !isBot(p[1])).sort((a, b) => isBot(a[1]) - isBot(b[1]) || a[1].localeCompare(b[1])) : [] })
const mobCount = computed(() => { tick.value; const c = liveStore.cur[worldId.value]; return c ? c.mobs.length : 0 })

/* ---------- rendering pipeline ---------- */
function requestRender(delay = 160) { clearTimeout(renderT); renderT = setTimeout(renderNow, delay) }
async function renderNow() {
  const w = world(); if (!w || !worker) { if (worker && s.status && s.status.worlds.some(x => x.id === worldId.value)) loadWorlds().then(() => requestRender(300)).catch(() => {}); return }
  const { cx, cz, ppb, cw, ch, dpr } = V
  let bps = Math.max(1, 1 / (ppb * dpr))
  const halfW = cw / 2 / ppb * 1.3, halfH = ch / 2 / ppb * 1.3, spanX = halfW * 2, spanZ = halfH * 2
  while ((spanX / bps) * (spanZ / bps) > 1.6e6) bps *= 1.25
  let x0 = cx - halfW, z0 = cz - halfH; if (bps === 1) { x0 = Math.floor(x0); z0 = Math.floor(z0) }
  const n = Math.ceil(spanX / bps), m = Math.ceil(spanZ / bps), gen = ++genId
  let chunks = []; busy.value = true
  if (layers.builds) {
    try { const r = await api('GET', `/worlds/${w.id}/map?x0=${x0}&z0=${z0}&x1=${x0 + spanX}&z1=${z0 + spanZ}`); chunks = r.chunks; if (!V.spawn || needCenter) { V.spawn = r.spawn; if (needCenter) { V.cx = r.spawn[0]; V.cz = r.spawn[2]; needCenter = false; requestRender(0); return } } } catch { /* map still renders from the generator */ }
    if (gen !== genId) return
  }
  const base = { kind: 'render', gen, seed: w.seed, type: w.type, x0, z0, chunks, builds: layers.builds, contours: layers.contours }
  worker.postMessage({ ...base, stage: 'coarse', bps: bps * 4, n: Math.ceil(n / 4), m: Math.ceil(m / 4) })
  worker.postMessage({ ...base, stage: 'fine', bps, n, m })
}
function onWorker(e) {
  const r = e.data; if (r.gen !== genId) return
  if (r.error) { busy.value = false; toast('Map render failed: ' + r.error, true); return }
  const c = document.createElement('canvas'); c.width = r.n; c.height = r.m
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.buf), r.n, r.m), 0, 0)
  bmp = { canvas: c, x0: r.x0, z0: r.z0, bps: r.bps, n: r.n, m: r.m, coarse: r.stage === 'coarse' }
  if (r.stage === 'fine') busy.value = false
}

/* ---------- drawing ---------- */
const toScreen = (x, z) => [V.cw / 2 + (x - V.cx) * V.ppb, V.ch / 2 + (z - V.cz) * V.ppb]
const toWorld = (sx, sy) => [V.cx + (sx - V.cw / 2) / V.ppb, V.cz + (sy - V.ch / 2) / V.ppb]
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
const MOB_COL = ['#ffb3c7', '#ff5a5a', '#ffd27a', '#e879f9']

function frame(now) {
  raf = requestAnimationFrame(frame)
  const g = cv.value && cv.value.getContext('2d'); if (!g || document.hidden) return
  // follow a player
  if (followId.value != null) { const p = livePos(followId.value, now); if (p) { V.cx += (p[0] - V.cx) * .14; V.cz += (p[1] - V.cz) * .14; if (now - lastFollowRender > 700 && !V.gesturing) { lastFollowRender = now; requestRender(0) } } }
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0a1019'; g.fillRect(0, 0, cv.value.width, cv.value.height)
  g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0)
  if (bmp) {
    const [sx, sy] = toScreen(bmp.x0, bmp.z0), k = bmp.bps * V.ppb
    g.imageSmoothingEnabled = bmp.coarse || V.gesturing; g.imageSmoothingQuality = 'high'
    g.drawImage(bmp.canvas, sx, sy, bmp.n * k, bmp.m * k)
  }
  if (layers.grid) drawGrid(g)
  drawLive(g, now); drawHud(g)
}
function drawGrid(g) {
  let sp = 16; for (const n of [16, 32, 64, 128, 256, 512, 1024, 2048, 4096]) { sp = n; if (n * V.ppb >= 78) break }
  const [wx0, wz0] = toWorld(0, 0), [wx1, wz1] = toWorld(V.cw, V.ch)
  g.lineWidth = 1; g.font = '10.5px "JetBrains Mono", monospace'; g.textBaseline = 'top'
  for (let x = Math.floor(wx0 / sp) * sp; x <= wx1; x += sp) { const sx = Math.round(toScreen(x, 0)[0]) + .5; g.strokeStyle = x === 0 ? 'rgba(110,231,168,.5)' : 'rgba(255,255,255,.10)'; g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, V.ch); g.stroke(); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(String(x), sx + 4, 4) }
  for (let z = Math.floor(wz0 / sp) * sp; z <= wz1; z += sp) { const sy = Math.round(toScreen(0, z)[1]) + .5; g.strokeStyle = z === 0 ? 'rgba(110,231,168,.5)' : 'rgba(255,255,255,.10)'; g.beginPath(); g.moveTo(0, sy); g.lineTo(V.cw, sy); g.stroke(); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(String(z), 4, sy + 3) }
}
function livePos(id, now) {
  const cur = liveStore.cur[worldId.value]; if (!cur) return null
  const a = cur.players.find(p => p[0] === id); if (!a) return null
  const prev = liveStore.prev[worldId.value], b = prev && prev.players.find(p => p[0] === id)
  if (!b) return [a[2], a[3]]
  const t = Math.min(1, Math.max(0, (now - liveStore.at) / 1000)); return [b[2] + (a[2] - b[2]) * t, b[3] + (a[3] - b[3]) * t]
}
function drawLive(g, now) {
  const cur = liveStore.cur[worldId.value]; hits = []
  if (V.spawn) { const [sx, sy] = toScreen(V.spawn[0], V.spawn[2]); g.strokeStyle = 'rgba(251,191,36,.9)'; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 7, 0, 6.283); g.moveTo(sx - 11, sy); g.lineTo(sx + 11, sy); g.moveTo(sx, sy - 11); g.lineTo(sx, sy + 11); g.stroke() }
  if (!cur) return
  if (layers.mobs) for (const [t, x, z] of cur.mobs) { const [sx, sy] = toScreen(x, z); if (sx < -8 || sy < -8 || sx > V.cw + 8 || sy > V.ch + 8) continue; g.fillStyle = MOB_COL[t] || '#c4b5fd'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.5; g.beginPath(); g.arc(sx, sy, t === 3 ? 6 : 3.2, 0, 6.283); g.fill(); g.stroke() }
  g.font = '600 12px Inter, sans-serif'; g.textBaseline = 'middle'
  const pulse = (now % 1600) / 1600
  for (const p of cur.players) {
    const bot = isBot(p[1]); if (bot && !layers.bots) continue
    const pos = livePos(p[0], now) || [p[2], p[3]], [sx, sy] = toScreen(pos[0], pos[1])
    if (sx < -60 || sy < -30 || sx > V.cw + 60 || sy > V.ch + 30) continue
    const sel = selected.value && selected.value.id === p[0], col = bot ? '#94a3b8' : '#6ee7a8'
    if (!bot) { g.strokeStyle = `rgba(110,231,168,${.5 * (1 - pulse)})`; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 7 + pulse * 14, 0, 6.283); g.stroke() }
    g.shadowColor = col; g.shadowBlur = sel ? 18 : 9; g.fillStyle = col; g.beginPath(); g.arc(sx, sy, sel ? 8 : 6.5, 0, 6.283); g.fill(); g.shadowBlur = 0
    g.strokeStyle = '#06101c'; g.lineWidth = 2.5; g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 2.2, 0, 6.283); g.fill()
    if (layers.names && (!bot || V.ppb > 4)) {
      const nm = p[1], w = g.measureText(nm).width + 14, x = sx + 11, y = sy - 1
      g.fillStyle = 'rgba(6,12,22,.82)'; g.beginPath(); g.roundRect(x, y - 10, w, 20, 10); g.fill(); g.strokeStyle = sel ? col : 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.stroke()
      g.fillStyle = bot ? '#cbd5e1' : '#fff'; g.fillText(nm, x + 7, y + .5)
    }
    hits.push({ sx, sy, id: p[0], name: p[1], x: pos[0], z: pos[1], y: p[4], bot })
  }
}
function drawHud(g) {
  // scale bar
  let len = NICE[0]; for (const n of NICE) { len = n; if (n * V.ppb >= 90) break }
  const px = len * V.ppb, x = 16, y = V.ch - 18
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 4; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + px, y); g.lineTo(x + px, y - 5); g.stroke()
  g.fillStyle = '#fff'; g.font = '600 11.5px Inter, sans-serif'; g.textBaseline = 'bottom'; g.fillText(len + ' blocks', x + 2, y - 7); g.shadowBlur = 0
  // compass
  const cx = V.cw - 34, cy = 34; g.fillStyle = 'rgba(6,12,22,.7)'; g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(cx, cy, 20, 0, 6.283); g.fill(); g.stroke()
  g.fillStyle = '#fb7185'; g.beginPath(); g.moveTo(cx, cy - 15); g.lineTo(cx + 5, cy + 2); g.lineTo(cx - 5, cy + 2); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.font = '700 9px Inter, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText('N', cx, cy + 10); g.textAlign = 'start'
}

/* ---------- interaction ---------- */
function settle() { V.gesturing = false; requestRender(180) }
function zoomAt(sx, sy, f) {
  const [wx, wz] = toWorld(sx, sy), np = Math.min(28, Math.max(.06, V.ppb * f)); if (np === V.ppb) return
  V.ppb = np; V.cx = wx - (sx - V.cw / 2) / np; V.cz = wz - (sy - V.ch / 2) / np; updateZoomText(); V.gesturing = true; followId.value = null; requestRender(220)
}
const updateZoomText = () => { zoomText.value = V.ppb >= 1 ? V.ppb.toFixed(V.ppb >= 10 ? 0 : 1) + ' px/block' : (1 / V.ppb).toFixed(1) + ' blocks/px' }
const rel = e => { const r = cv.value.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
function pdown(e) { cv.value.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { ...Object.fromEntries([['x', e.clientX], ['y', e.clientY]]), sx: e.clientX, sy: e.clientY, moved: false }); V.gesturing = true; if (pointers.size === 2) pinch0 = pdist() }
const pdist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
function pmove(e) {
  const [mx, my] = rel(e), [wx, wz] = toWorld(mx, my); cursor.value = `${Math.round(wx)}, ${Math.round(wz)}`
  const p = pointers.get(e.pointerId); if (!p) return
  const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 4) p.moved = true
  p.x = e.clientX; p.y = e.clientY
  if (pointers.size === 2) { const d = pdist(); if (pinch0) { const c = [...pointers.values()], r = cv.value.getBoundingClientRect(); zoomAt((c[0].x + c[1].x) / 2 - r.left, (c[0].y + c[1].y) / 2 - r.top, d / pinch0) } pinch0 = d }
  else { V.cx -= dx / V.ppb; V.cz -= dy / V.ppb; if (p.moved) followId.value = null; requestRender(220) }
}
function pup(e) {
  const p = pointers.get(e.pointerId); pointers.delete(e.pointerId); pinch0 = 0
  if (p && !p.moved && pointers.size === 0) { const [mx, my] = rel(e), h = hits.slice().reverse().find(h => Math.hypot(h.sx - mx, h.sy - my) < 14); selected.value = h ? { id: h.id, name: h.name, x: h.x, z: h.z, y: h.y, bot: h.bot } : null }
  if (!pointers.size) settle()
}
const wheel = e => { e.preventDefault(); const [mx, my] = rel(e); zoomAt(mx, my, Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0016))) }
const zoomBtn = f => zoomAt(V.cw / 2, V.ch / 2, f)
const dbl = e => { const [mx, my] = rel(e); zoomAt(mx, my, 2) }
function focus(p) { followId.value = null; V.cx = p[2]; V.cz = p[3]; if (V.ppb < 2) V.ppb = 4; updateZoomText(); selected.value = { id: p[0], name: p[1], x: p[2], z: p[3], y: p[4], bot: isBot(p[1]) }; requestRender(0) }
const follow = id => { followId.value = followId.value === id ? null : id; if (followId.value != null && V.ppb < 2) { V.ppb = 4; updateZoomText() } }
const center = () => { followId.value = null; if (V.spawn) { V.cx = V.spawn[0]; V.cz = V.spawn[2] } else { V.cx = 0; V.cz = 0 } requestRender(0) }
const key = e => { if (e.target.closest('input,select,textarea')) return; const st = 60 / V.ppb; if (e.key === '+' || e.key === '=') zoomBtn(1.4); else if (e.key === '-') zoomBtn(1 / 1.4); else if (e.key === '0') center(); else if (e.key === 'ArrowLeft') { V.cx -= st; requestRender(120) } else if (e.key === 'ArrowRight') { V.cx += st; requestRender(120) } else if (e.key === 'ArrowUp') { V.cz -= st; requestRender(120) } else if (e.key === 'ArrowDown') { V.cz += st; requestRender(120) } }

function resize() {
  const el = wrap.value; if (!el || !cv.value) return
  const r = el.getBoundingClientRect(); V.dpr = Math.min(2.5, window.devicePixelRatio || 1); V.cw = Math.max(200, r.width); V.ch = Math.max(240, r.height)
  cv.value.width = Math.round(V.cw * V.dpr); cv.value.height = Math.round(V.ch * V.dpr); cv.value.style.width = V.cw + 'px'; cv.value.style.height = V.ch + 'px'; requestRender(120)
}
const pickWorld = () => { const known = new Set(s.worlds.map(w => w.id)), live = s.status ? s.status.worlds.filter(w => w.humans && known.has(w.id)).sort((a, b) => b.humans - a.humans)[0] : null; worldId.value = (live && live.id) || (s.worlds.find(w => w.id === 'main') || s.worlds[0] || {}).id || '' }

onMounted(() => {
  worker = new Worker(new URL('../workers/map.worker.js', import.meta.url), { type: 'module' }); worker.onmessage = onWorker
  pickWorld(); updateZoomText(); resize(); ro = new ResizeObserver(resize); ro.observe(wrap.value)
  raf = requestAnimationFrame(frame); tickT = setInterval(() => { tick.value++ }, 1000); window.addEventListener('keydown', key)
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearInterval(tickT); clearTimeout(renderT); worker && worker.terminate(); ro && ro.disconnect(); window.removeEventListener('keydown', key) })
watch(() => s.worlds.map(w => w.id).join(','), () => { if (!worldId.value || !world()) { pickWorld() } else if (!bmp) requestRender(0) })
watch(worldId, () => { bmp = null; needCenter = true; V.spawn = null; selected.value = null; followId.value = null; requestRender(0) })
watch(() => [layers.builds, layers.contours], () => requestRender(0))
</script>
<template>
  <div class="mp">
    <div class="page-h"><div><h1>Live map</h1><p>Block-accurate terrain with your real builds · {{ players.filter(p => !isBot(p[1])).length }} players, {{ mobCount }} creatures</p></div>
      <div class="actions"><select v-model="worldId" class="select" style="width:220px" aria-label="World"><option v-for="w in s.worlds" :key="w.id" :value="w.id">{{ w.name }}</option></select></div></div>
    <div class="card flush stage">
      <div ref="wrap" class="cv-wrap"><canvas ref="cv" class="cv" @pointerdown="pdown" @pointermove="pmove" @pointerup="pup" @pointercancel="pup" @wheel="wheel" @dblclick="dbl" />
        <div class="hud tl"><span class="pill" :class="busy ? 'warn' : 'ok'"><i />{{ busy ? 'Rendering…' : 'Sharp' }}</span><span class="pill mono">{{ cursor || '—' }}</span><span class="pill">{{ zoomText }}</span></div>
        <div class="hud zoom"><button class="btn icon" aria-label="Zoom in" @click="zoomBtn(1.5)"><Icon name="plus" /></button><button class="btn icon" aria-label="Zoom out" @click="zoomBtn(1 / 1.5)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14" /></svg></button><button class="btn icon" aria-label="Centre on spawn" title="Centre on spawn" @click="center"><Icon name="home" /></button></div>
        <button class="btn sm side-t" @click="side = !side">{{ side ? 'Hide panel' : 'Layers & players' }}</button>
        <div v-if="selected" class="hud sel"><div class="row between"><b>{{ selected.name }}</b><button class="btn icon sm ghost" aria-label="Close" @click="selected = null"><Icon name="x" :size="14" /></button></div><div class="mono xs mut">{{ Math.round(selected.x) }}, {{ Math.round(selected.y) }}, {{ Math.round(selected.z) }}</div><div class="row" style="margin-top:8px"><button class="btn sm" @click="follow(selected.id)">{{ followId === selected.id ? 'Stop following' : 'Follow' }}</button><NuxtLink v-if="!selected.bot" to="/players" class="btn sm ghost">Manage</NuxtLink></div></div>
      </div>
      <aside v-show="side" class="panel">
        <div class="up" style="margin-bottom:8px">Layers</div>
        <label v-for="l in [['builds', 'Real builds (loaded chunks)'], ['contours', 'Contour lines'], ['grid', 'Coordinate grid'], ['names', 'Player names'], ['mobs', 'Creatures'], ['bots', 'Bots']]" :key="l[0]" class="ly"><Switch v-model="layers[l[0]]" :label="l[1]" />{{ l[1] }}</label>
        <div class="up" style="margin:18px 0 8px">Players <span class="dim">({{ players.length }})</span></div>
        <div class="pl"><button v-for="p in players" :key="p[0]" class="pr" :class="{ on: selected && selected.id === p[0] }" @click="focus(p)"><span class="avatar sm" :class="{ bot: isBot(p[1]) }">{{ (p[1].replace(/^\[Bot\]\s*/i, '')[0] || '?').toUpperCase() }}</span><span class="grow nm">{{ p[1] }}<small class="mono">{{ Math.round(p[2]) }}, {{ Math.round(p[3]) }}</small></span><span v-if="followId === p[0]" class="pill ok">following</span></button>
          <div v-if="!players.length" class="mut xs" style="padding:8px 2px">No one in this world.</div></div>
        <p class="mut xs" style="margin-top:14px">Drag to pan · scroll or pinch to zoom · double-click to zoom in · click a player to inspect.</p>
      </aside>
    </div>
  </div>
</template>
<style scoped>
.stage { display: flex; height: calc(100vh - 190px); min-height: 460px }
.cv-wrap { position: relative; flex: 1; min-width: 0; overflow: hidden; background: #0a1019; touch-action: none }
.cv { display: block; cursor: grab; touch-action: none } .cv:active { cursor: grabbing }
.hud { position: absolute; z-index: 2 } .hud.tl { top: 12px; left: 12px; display: flex; gap: 6px; flex-wrap: wrap; max-width: calc(100% - 90px) } .hud .pill { background: rgba(6, 12, 22, .78); backdrop-filter: blur(8px) }
.hud.zoom { right: 12px; bottom: 14px; display: flex; flex-direction: column; gap: 6px } .hud.zoom .btn { background: rgba(10, 16, 26, .85); backdrop-filter: blur(8px) }
.hud.sel { left: 12px; top: 52px; width: 230px; padding: 12px 14px; border-radius: 14px; background: rgba(8, 13, 22, .88); backdrop-filter: blur(12px); border: 1px solid var(--line2); box-shadow: 0 16px 40px -10px rgba(0, 0, 0, .8) }
.side-t { position: absolute; z-index: 2; top: 12px; right: 74px; background: rgba(6, 12, 22, .78); backdrop-filter: blur(8px) }
.panel { width: 272px; flex: none; padding: 16px; overflow: auto; border-left: 1px solid var(--line); background: linear-gradient(180deg, rgba(255, 255, 255, .03), transparent), var(--s1) }
.ly { display: flex; align-items: center; gap: 11px; padding: 6px 0; font-size: 13px }
.pl { display: flex; flex-direction: column; gap: 4px } .pr { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 10px; border: 1px solid transparent; background: none; color: var(--txt); text-align: left } .pr:hover { background: rgba(255, 255, 255, .05) } .pr.on { border-color: rgba(110, 231, 168, .4); background: rgba(110, 231, 168, .08) }
.pr .nm { display: flex; flex-direction: column; font-size: 13px; line-height: 1.25; overflow: hidden; text-overflow: ellipsis } .pr small { color: var(--dim); font-size: 11px }
.avatar.sm { width: 26px; height: 26px; border-radius: 8px; font-size: 11px }
@media (max-width: 860px) {
  .stage { flex-direction: column; height: calc(100vh - 150px) } .cv-wrap { flex: 1 1 60% } .panel { width: auto; max-height: 36%; border-left: 0; border-top: 1px solid var(--line) }
  .side-t { right: 12px; top: 54px } .hud.tl { max-width: 100% }
}
</style>
