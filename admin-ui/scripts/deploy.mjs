// Copies the generated admin UI into the game server (server/admin-ui). Usage: node scripts/deploy.mjs [targetDir]
import fs from 'node:fs'; import path from 'node:path'
const src = path.resolve('.output/public'), dst = path.resolve(process.argv[2] || '../server/admin-ui')
if (!fs.existsSync(path.join(src, 'index.html'))) { console.error('Run `npm run build` first'); process.exit(1) }
fs.rmSync(dst, { recursive: true, force: true }); fs.cpSync(src, dst, { recursive: true }); console.log('admin UI ->', dst)
