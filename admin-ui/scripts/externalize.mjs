// Moves Nuxt's inline bootstrap scripts into files so the game server's strict CSP (script-src 'self') allows them.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'
const dir = path.resolve('.output/public'); let n = 0
function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.html')) fix(p) } }
function fix(file) {
  let html = fs.readFileSync(file, 'utf8')
  html = html.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g, (m, attrs, body) => {
    if (/type="application\/json"/.test(attrs) || !body.trim()) return m
    if (/type="importmap"/.test(attrs)) { console.warn('inline importmap left in', file); return m }
    const name = 'boot-' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 8) + '.js'
    fs.mkdirSync(path.join(dir, '_nuxt'), { recursive: true }); fs.writeFileSync(path.join(dir, '_nuxt', name), body); n++
    return `<script${attrs} src="/admin/_nuxt/${name}"></script>`
  })
  fs.writeFileSync(file, html)
}
walk(dir); console.log('externalized', n, 'inline script(s)')
