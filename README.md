# Voxel Realms

An infinite voxel sandbox for the browser: survival and creative modes, a villager **economy**, day/night and **weather**,
NPCs, and **authoritative multiplayer** with a proper game server and **admin panel**.

```
client  (Vite + three.js r170)        server (Fastify + ws)             shared/ (runs in both)
  src/main.js    game, UI, net          server/index.js  HTTP+WS+admin    blocks.js    block registry
  src/chunkWorker.js  gen+mesh worker   server/world.js  GameWorld        worldgen.js  deterministic terrain
  src/particles.js    GPU particles     server/store.js  persistence       mesher.js    AO/skylight/block light
  src/atlas.js        procedural PBR    server/protocol.js zod schemas      mobs.js      NPC simulation
  index.html / style.css                admin-ui/ (Nuxt) admin panel        economy.js   prices & bounties
```

## Quick start (Docker)

The game runs in a container; the only thing you need is Docker with the Compose plugin.

```bash
git clone <this repo> voxel-realms && cd voxel-realms
./vr setup          # interactive, 7 short steps: port, data folder, admin password, admin access, public access, limits
```

`./vr setup` asks, shows a summary, and only then builds and starts the game. It prints the play URL, the admin URL and a generated admin password (once; it is kept in `.env`, mode 600).
**Private by default:** the game port is published on `127.0.0.1` only, so the server is invisible to your network and the internet and you play at `http://localhost:8080/`. Choose how others connect in step 6 (`--public local|none|tailscale|cloudflare`; `none` = your LAN/VPN, which publishes the port on all interfaces). The admin panel is always on its own loopback port, and the container runs as a non-root user with all Linux capabilities dropped.
Unattended: `./vr setup --yes --game-port 8080 --data /srv/vr --password generate --admin local --public local`.
Upgrading an older install? It now binds to localhost unless `VR_GAME_BIND=0.0.0.0` is in `.env` (or re-run `./vr setup`).

| Command | Does |
|---|---|
| `./vr status` | container health, version, worlds, players, capacity |
| `./vr up` / `down` / `restart` | start / stop / restart |
| `./vr logs [-f]` | server logs |
| `./vr update` | `git pull` (if a checkout), rebuild, restart |
| `./vr backup` | tarball of the data folder into `./backups/` |
| `./vr password [new]` | change (or generate) the admin password |
| `./vr admin` / `./vr url` | admin and play/public URLs |
| `./vr loadtest on\|off` | relax per-IP limits while load-testing |
| `./vr uninstall` | remove the container and image (data is kept) |

The admin panel always listens on its own loopback port (`127.0.0.1:8185` by default), never on the public game port. Reach it from another machine privately with Tailscale (`./vr setup` can run `tailscale serve` for you) or an SSH tunnel; do not put it behind a public tunnel.
Public access for friends: Tailscale Funnel, a Cloudflare quick tunnel (a `cloudflared` container, chosen in setup), or port-forward the game port yourself.

Data (worlds, config, backups) lives in the data folder you chose (default `./data`) and is the only state. Worlds autosave every 30 s, are backed up every 30 min (last 10 kept) and saved on shutdown.

### Development

```bash
npm install
npm run dev            # client with hot reload on :5173 (proxies /api and /ws to :8080)
npm run build && npm start   # built client + server on 127.0.0.1:8080 (this machine only; set HOST=0.0.0.0 to share on your network)
npm test               # unit tests
```

## Gameplay

* **Creative**: unlimited blocks, flight. **Survival**: health, drowning, fall damage, mining time, crafting, drops.
* **Economy** (survival worlds): sell blocks to villagers for coins, buy supplies, take **bounties**. Prices react to supply and
  demand and recover over time. Killing mobs pays out. In multiplayer the *server owns the inventory and wallet*, so coins cannot be forged client-side.
* **World**: dynamic weather (rain, storms with lightning/thunder), day/night, caves, ores, oceans, glowstone lighting.
* **NPCs**: pigs, villagers (trade) and zombies (night). Simulated once in `shared/mobs.js` - locally in singleplayer, on the server online.
* **Controls**: fully rebindable (Settings -> Keybinds), press `H` in game for a cheat-sheet.

## Server architecture

* One process hosts many **worlds** (`GameWorld`), each with its own seed, terrain type, game mode, day length, NPC settings and economy.
  Create / delete / back up / restore them live from the panel.
* Fixed 20 Hz tick with drift compensation. State broadcast: players + NPCs at 10 Hz, time every 5 s, weather/blocks/chat on change.
  Clients interpolate. World time is server-authoritative (clients free-run and ease toward it).
* Clients generate terrain from the seed (cheap, deterministic) - the server only sends the list of edits.
* Protocol is JSON over WebSocket (`/ws/:world`), compressed with permessage-deflate. See `server/protocol.js`.

## Security

* Strict **CSP** and security headers (`@fastify/helmet`); no inline scripts; `eval` is never allowed (the test hook is compiled in only by `VITE_E2E=1 npm run build`, and still needs `?e2e=1` + `VR_E2E` at runtime).
* **Admin**: bearer token (scrypt-hashed, constant-time compare), per-IP brute-force lockout, rate limits, token never in URLs
  (the live stream authenticates with its first message), all panel text inserted with `textContent`.
* **Game socket**: zod validation of every message, 64 KB frame cap, flood guard, per-IP connection cap, hello timeout, heartbeat,
  teleport guard, block-reach checks, edit-rate limit, name/chat sanitising, optional join password, ban list (IP / name / device id).
* **Economy**: inventory, wallet and prices are server-side in multiplayer survival worlds. Trades/bounties verify stock.
* World ids are whitelisted (`[a-z0-9_-]`), file writes are atomic and confined to `DATA_DIR`, restore accepts backup names only (no path traversal).
* Known limits: the client is trusted for movement (position is sanity-checked, not simulated), and quick Cloudflare tunnels are ephemeral.
  Put the server behind TLS (the tunnel does this) when exposing it, and use a join password for private servers.

## Tech notes / performance

* Terrain generation and meshing run in a **web worker**; edits remesh synchronously for instant feedback.
* Mesher bakes ambient occlusion, **skylight** (caves get dark) and **block light** (flood-filled glowstone) per vertex; a small
  shader patch applies them to `MeshStandardMaterial`, so lighting is PBR with a throttled shadow map, HDR bloom and ACES tone mapping.
* Particles: instanced debris + two point-sprite layers (normal + additive), all pooled.
* Saves use IndexedDB (`idb-keyval`), so large worlds do not hit the localStorage quota.

## Admin panel

`/admin/` (a Nuxt app in `admin-ui/`, built into `server/admin-ui/`; sign in with the admin password). Pages: **Overview** (live games, TPS/tick/CPU/memory/network charts, capacity meter, Save all / Backup / Announce / Maintenance),
**Games** (every world and room, live state, lobby-portal switches, new world / new room, rename, backups, delete), **Players** (click a name for the detail drawer: ping, session, coins, inventory; message / op / mute / teleport / coins / kick / ban),
**Bots** (global enable, skill and density; per-game target, skill, fixed and auto-fill; summon, remove, clear), **Live map** (block-accurate terrain with real builds, players and creatures; works for every world and room),
**Economy** (leaderboard, bounties, price overrides, wallets), **Console** (commands with history and quick chips), **Chat**, **Security** (maintenance mode, allowlist, bans, mutes, audit log), **Backups**, **Settings** and **Help**.
Build it with `cd admin-ui && npm install && npm run build && npm run deploy`. Set `ADMIN_PORT=8185` to serve the admin ONLY on its own loopback port (the public game port then answers 404 for `/admin/` and `/api/admin/`),
and reach it over a tailnet with `tailscale serve`.

## Testing

```bash
npm test                         # 21 unit tests (shared code + protocol validation)
npm run bench                    # micro-benchmarks: terrain gen, meshing, NPC tick
npm run stress -- --bots 160     # spins up an isolated server and floods it with bots (150k-edit world, journal replay, restart check)
npm run stress -- --url https://my.server --password <admin pw> --bots 40   # same bots against a RUNNING server
node test/e2e/multiplayer.cjs    # Playwright end-to-end suites live in test/e2e (see header of each file)
```

Reference numbers (one laptop core, local): 160 bots across 4 worlds -> **0.5 ms** server tick (budget 50 ms), 0.4 ms mean event-loop lag, p95 ping 2 ms, ~11 KB/s per bot,
150k-edit world join sync in ~150 ms. Client: ~0.4 ms JavaScript per frame, no frame over 16 ms in streaming / 40-NPC / storm / particle-spam scenarios (software GL).

## Server optimisations

Binary 19-byte state records with **interest management** (players <=192 blocks, NPCs <=112 blocks), batched block edits (one message per tick), edits stored once per chunk
(no per-edit string keys), **append-only journal** persistence (O(1) per edit; snapshot compaction on backup/shutdown), streamed join sync in 4000-edit batches,
back-pressure (lossy frames dropped for slow clients), brotli/gzip for HTTP, permessage-deflate for sockets, u16 ids, 20 Hz fixed tick with drift compensation.
