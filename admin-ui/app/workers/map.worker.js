// Map renderer (runs off the main thread). Builds a height field for the requested window, from the world generator
// plus the server's real loaded chunks (builds, arenas, edits), then shades it: hillshade, water depth, contours, structure outlines.
const SEA = 20, WATER = 7
const PAL = [[0, 0, 0], [95, 160, 74], [139, 106, 70], [138, 143, 153], [226, 212, 160], [107, 78, 46], [63, 125, 53], [59, 130, 196], [184, 146, 90], [191, 227, 238], [165, 80, 63], [242, 246, 251], [120, 124, 132], [74, 77, 85], [217, 184, 74], [163, 169, 181], [141, 138, 134], [182, 154, 134], [94, 216, 224], [238, 238, 238], [210, 59, 59], [59, 100, 210], [125, 131, 141], [74, 51, 31], [216, 197, 138], [30, 22, 48], [168, 216, 240], [122, 90, 54], [255, 216, 119], [242, 201, 76], [79, 224, 232]]
const BUILT = new Set([8, 9, 10, 12, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
let wgMod = null, wg = null, wgKey = '', latest = 0

const b64 = s => { const bin = atob(s), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a }
const hash = (x, z) => { let h = (x * 374761393 + z * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v

async function ensureGen(seed, type) {
  const key = seed + '|' + type; if (wg && key === wgKey) return wg
  wgMod ||= await import(/* @vite-ignore */ self.location.origin + '/shared/worldgen.js')
  wg = wgMod.createWorldGen(seed, { type }); wgKey = key; return wg
}

async function render(m) {
  const { gen, n, m: rows, x0, z0, bps, contours, builds } = m
  const g = await ensureGen(m.seed, m.type)
  const chunks = new Map(); if (builds) for (const [cx, cz, id, h, b] of m.chunks) chunks.set(cx + ',' + cz, { id: b64(id), h: b64(h), b: b64(b) })
  const W = n + 2, Hh = rows + 2, H = new Float32Array(W * Hh), ID = new Uint8Array(W * Hh), BED = new Float32Array(W * Hh)
  for (let j = 0; j < Hh; j++) {
    if (j % 24 === 0) { await new Promise(r => setTimeout(r)); if (gen !== latest) return null } // yield so a newer request can supersede this one
    const wz = z0 + (j - 1) * bps, bz = Math.floor(wz)
    for (let i = 0; i < W; i++) {
      const wx = x0 + (i - 1) * bps, bx = Math.floor(wx), o = i + W * j
      const c = chunks.size ? chunks.get((bx >> 4) + ',' + (bz >> 4)) : null
      if (c) { const k = (bx & 15) + 16 * (bz & 15); ID[o] = c.id[k]; H[o] = c.h[k]; BED[o] = c.b[k]; continue }
      const h = g.terrainH(wx, wz)
      if (h < SEA) { ID[o] = WATER; H[o] = SEA; BED[o] = h } else { ID[o] = h <= SEA + 1 ? 4 : h > 56 ? 11 : h > 46 ? 3 : 1; H[o] = h; BED[o] = h }
    }
  }
  const out = new Uint8ClampedArray(n * rows * 4), norm = 1 / (2 * Math.max(1, bps))
  for (let j = 1; j <= rows; j++) for (let i = 1; i <= n; i++) {
    const o = i + W * j, id = ID[o], h = H[o]; let r, gC, b
    if (id === WATER) {
      const d = clamp((h - BED[o]) / 14, 0, 1), t = d * d * (3 - 2 * d)
      r = 76 + (24 - 76) * t; gC = 195 + (68 - 195) * t; b = 224 + (132 - 224) * t
      const edge = ID[o + 1] !== WATER || ID[o + W] !== WATER || ID[o - 1] !== WATER || ID[o - W] !== WATER; if (edge && bps <= 2) { r += 30; gC += 22; b += 14 }
    } else {
      const p = PAL[id] || PAL[3]; r = p[0]; gC = p[1]; b = p[2]
      const lit = (H[o + 1 + W] - H[o - 1 - W]) * norm, sh = 1 + clamp(lit * 0.5, -0.42, 0.42), tone = 0.9 + clamp((h - SEA) / 44, 0, 1) * 0.22
      let f = sh * tone; if (bps <= 2) f += (hash(Math.floor(x0 + (i - 1) * bps), Math.floor(z0 + (j - 1) * bps)) - 0.5) * 0.07
      if (BUILT.has(id) && bps <= 3 && (ID[o + 1] !== id || ID[o + W] !== id || ID[o - 1] !== id || ID[o - W] !== id)) f *= 0.8 // outline structures
      if (contours && Math.floor(h / 4) !== Math.floor(H[o + 1] / 4) || contours && Math.floor(h / 4) !== Math.floor(H[o + W] / 4)) f *= 0.86
      r *= f; gC *= f; b *= f
    }
    const q = ((j - 1) * n + (i - 1)) * 4; out[q] = r; out[q + 1] = gC; out[q + 2] = b; out[q + 3] = 255
  }
  return { gen, n, m: rows, x0, z0, bps, stage: m.stage, buf: out.buffer }
}

self.onmessage = async e => {
  const m = e.data; if (m.kind !== 'render') return
  latest = m.gen
  try { const r = await render(m); if (r) self.postMessage(r, [r.buf]) } catch (err) { self.postMessage({ gen: m.gen, error: String(err && err.message || err) }) }
}
