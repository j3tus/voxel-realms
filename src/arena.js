// Client side of the multiplayer minigames: Gun Arena (pvp) and Spleef. The server is authoritative - this only sends intent
// (shoot / reload), predicts nothing about damage, and renders the HUD, tracers and kill feed it is told about.
import { WEAPONS } from '../shared/weapons.js';

export const ARENA_MODES = ['pvp', 'tdm', 'gungame', 'zombies', 'royale', 'ctf', 'hide', 'snd', 'bedwars', 'raid', 'td', 'parkour', 'spleef'];
const FPS = ['pvp', 'tdm', 'gungame', 'zombies', 'royale', 'ctf', 'hide', 'snd', 'bedwars', 'raid', 'td'];
const TEAMY = ['tdm', 'ctf', 'snd', 'bedwars'];
const TEAM_COL = ['#ff6b6b', '#5aa9ff'], TEAM_NAME = ['RED', 'BLUE'];

export function createArena(ctx) {
  const { THREE, scene, camera, canvas } = ctx;
  const st = { gw: -1, team: 0, mg: null, hp: 20, ammo: WEAPONS.map(w => w.mag), w: 0, reloadUntil: 0, lastShot: 0, kick: 0, down: false, alive: true, tracers: [], feed: [] };
  const el = (tag, css, parent = document.body) => { const e = document.createElement(tag); e.style.cssText = css; parent.append(e); return e; };
  const base = 'position:fixed;z-index:6;pointer-events:none;font:600 14px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000a;';
  const root = el('div', 'display:none');
  const banner = el('div', base + 'top:14px;left:50%;transform:translateX(-50%);text-align:center;font-size:18px;background:#0008;padding:6px 16px;border-radius:10px;backdrop-filter:blur(4px)', root);
  const board = el('div', base + 'top:14px;right:14px;min-width:150px;background:#0007;padding:8px 10px;border-radius:10px;font-size:13px', root);
  const feed = el('div', base + 'top:150px;right:14px;text-align:right;font-size:13px', root);
  const ammo = el('div', base + 'bottom:22px;right:22px;text-align:right;font-size:26px;background:#0007;padding:8px 14px;border-radius:12px', root);
  const TOUCH = document.body.classList.contains('touch') || matchMedia('(pointer:coarse)').matches;
  if (TOUCH) { ammo.style.cssText += 'bottom:auto;top:56px;right:auto;left:50%;transform:translateX(-50%);font-size:20px;padding:6px 12px;pointer-events:auto;'; feed.style.top = '112px'; board.style.cssText += 'top:112px;min-width:120px;font-size:11px;padding:5px 8px;'; ammo.addEventListener('pointerdown', e => { e.preventDefault(); nextWeapon(); }); }
  const bossBar = el('div', base + 'top:62px;left:50%;transform:translateX(-50%);width:min(60vw,420px);height:16px;background:#000a;border:2px solid #fff6;border-radius:9px;overflow:hidden;display:none', root);
  const bossFill = el('div', 'height:100%;width:100%;background:#c04bff;transition:width .2s', bossBar);
  const cross = el('div', base + 'top:50%;left:50%;width:22px;height:22px;transform:translate(-50%,-50%);', root);
  cross.innerHTML = '<i style="position:absolute;left:10px;top:0;width:2px;height:7px;background:#fff;box-shadow:0 0 2px #000"></i><i style="position:absolute;left:10px;bottom:0;width:2px;height:7px;background:#fff;box-shadow:0 0 2px #000"></i><i style="position:absolute;top:10px;left:0;height:2px;width:7px;background:#fff;box-shadow:0 0 2px #000"></i><i style="position:absolute;top:10px;right:0;height:2px;width:7px;background:#fff;box-shadow:0 0 2px #000"></i>';
  const mark = el('div', base + 'top:50%;left:50%;transform:translate(-50%,-50%) rotate(45deg);width:26px;height:26px;border:2px solid #fff;opacity:0;transition:opacity .15s', root);
  const dead = el('div', base + 'inset:0;display:none;place-items:center;font-size:34px;background:#4008', root);
  dead.textContent = 'Eliminated';

  // simple first-person gun
  const gun = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: .5, metalness: .7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(.07, .09, .42), mat); body.position.set(0, 0, -.1);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(.035, .035, .3), mat); barrel.position.set(0, .02, -.4);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(.06, .14, .07), mat); grip.position.set(0, -.1, .02); grip.rotation.x = .25;
  gun.add(body, barrel, grip); gun.position.set(.28, -.26, -.5); gun.visible = false; camera.add(gun);
  if (!camera.parent) scene.add(camera);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 6), flashMat); flash.position.set(0, .02, -.58); gun.add(flash);

  const active = () => ARENA_MODES.includes(ctx.mode());
  const pvp = () => FPS.includes(ctx.mode());
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // world-space visuals: Battle Royale zone wall and Capture-the-Flag flags
  const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 220, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  zoneWall.visible = false; zoneWall.frustumCulled = false; scene.add(zoneWall);
  const flagMeshes = [0, 1].map(t => { const g = new THREE.Group(), col = TEAM_COL[t];
    g.add(new THREE.Mesh(new THREE.BoxGeometry(.12, 3.2, .12), new THREE.MeshStandardMaterial({ color: 0xdddddd })));
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.3, .8, .06), new THREE.MeshBasicMaterial({ color: col })); cloth.position.set(.7, 2.6, 0); g.add(cloth);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .18, side: THREE.DoubleSide, depthWrite: false, fog: false })); beam.position.y = 30; g.add(beam);
    g.visible = false; scene.add(g); return g; });
  const siteBeam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false, fog: false })); siteBeam.visible = false; scene.add(siteBeam);
  function world3d(m) {
    const sb = m && m.kind === 'snd' && m.site; siteBeam.visible = !!sb; if (sb) { siteBeam.position.set(m.site[0], m.site[1] + 18, m.site[2]); const pl = m.bomb.st === 'planted'; siteBeam.material.color.set(pl ? 0xff3b3b : 0xffaa33); siteBeam.material.opacity = pl ? .22 + .18 * Math.sin(performance.now() / 120) : .2; }
    const z = m && m.kind === 'royale' && m.state === 'play' ? m.zone : null; zoneWall.visible = !!z; if (z) { zoneWall.position.set(z.x, ctx.P.y + 40, z.z); zoneWall.scale.set(z.r, 1, z.r); }
    const fl = m && m.kind === 'ctf' ? m.flags : null; flagMeshes.forEach((g, t) => { g.visible = !!fl; if (fl) { const f = fl[t]; g.position.set(f.x, f.y - (f.c ? 1.5 : 0), f.z); g.children[1].rotation.y = performance.now() / 400; } });
  }
  const setH = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };
  const setT = (el, txt) => { if (el._t !== txt) { el._t = txt; el.textContent = txt; } };
  const setD = (el, v) => { if (el.style.display !== v) el.style.display = v; };
  function hud() {
    const on = active() && ctx.inGame(); root.style.display = on ? 'block' : 'none'; document.body.classList.toggle('arena', active()); document.body.classList.toggle('arena-gun', on && pvp() && ctx.mode() !== 'bedwars' && ctx.mode() !== 'td'); document.body.classList.toggle('arena-builds', on && (ctx.mode() === 'bedwars' || ctx.mode() === 'td'));
    gun.visible = on && pvp() && st.alive; if (!on) return;
    const m = st.mg, wp = WEAPONS[st.w];
    if (m) {
      const playLabel = { pvp: `First to ${m.goal} kills`, tdm: m.teams ? `<b style="color:${TEAM_COL[0]}">RED ${m.teams[0]}</b> &ndash; <b style="color:${TEAM_COL[1]}">${m.teams[1]} BLUE</b> &middot; first to ${m.goal}` : '', gungame: `Ladder: ${m.goal} weapons`, spleef: 'Last one standing',
        zombies: `Wave ${m.wave} &middot; ${m.left} left`, royale: `${m.alive} alive${m.zone ? ' &middot; zone ' + Math.round(m.zone.r) + 'm' : ''}`,
        ctf: m.teams ? `<b style="color:${TEAM_COL[0]}">RED ${m.teams[0]}</b> &ndash; <b style="color:${TEAM_COL[1]}">${m.teams[1]} BLUE</b> &middot; first to ${m.goal}` : '',
        hide: m.phase === 'hide' ? (m.seeker === ctx.myId() ? `Hold still - hiders scatter ${m.hideT}s` : `HIDE! ${m.hideT}s`) : (m.seeker === ctx.myId() ? 'Find them all!' : 'The seeker is hunting'),
        parkour: `Reach the diamond platform (${m.goal})`,
        snd: m.kind === 'snd' && m.teams && m.bomb ? `<b style="color:${TEAM_COL[0]}">ATK ${m.teams[0]}</b> &ndash; <b style="color:${TEAM_COL[1]}">${m.teams[1]} DEF</b> &middot; ` + (m.rs === 'post' ? 'next round...' : m.bomb.st === 'planted' ? `<b style="color:#ff6b6b">BOMB ${m.bomb.t}s</b>${m.bomb.df > 0 ? ' defusing ' + Math.round(m.bomb.df * 100) + '%' : ''}` : m.bomb.pl > 0 ? `planting ${Math.round(m.bomb.pl * 100)}%` : `round ${m.rt}s`) : '',
        raid: m.boss ? `Boss ${Math.round(m.boss.hp / m.boss.max * 100)}%${m.boss.phase ? ' &middot; ENRAGED' + (m.boss.phase > 1 ? ' x2' : '') : ''}` : 'Boss down!',
        td: m.core !== undefined ? `Wave ${m.wave}/${m.maxWave} &middot; core <b style="color:${m.core > 50 ? '#6ee7a8' : m.core > 25 ? '#ffd75e' : '#ff6b6b'}">${m.core}%</b> &middot; ${m.left} left &middot; turrets ${m.turrets} &middot; coins ${(m.board.find(r => r.id === ctx.myId()) || {}).c ?? 0} (gold block = ${m.cost})` : '',
        bedwars: m.beds ? `<span style="color:${TEAM_COL[0]}">RED bed ${m.beds[0] ? '&#9829;' : '&#10007;'}</span> &middot; <span style="color:${TEAM_COL[1]}">BLUE bed ${m.beds[1] ? '&#9829;' : '&#10007;'}</span>` : '' }[m.kind] || '';
      const label = { lobby: 'Waiting for players...', play: playLabel, end: `Winner: ${m.winner}` }[m.state];
      const title = { pvp: 'GUN ARENA', tdm: 'TEAM DEATHMATCH', gungame: 'GUN GAME', spleef: 'SPLEEF', zombies: 'ZOMBIES', royale: 'BATTLE ROYALE', ctf: 'CAPTURE THE FLAG', hide: 'HIDE & SEEK', snd: 'SEARCH & DESTROY', bedwars: 'BED WARS', raid: 'BOSS RAID', td: 'TOWER DEFENCE', parkour: 'PARKOUR' }[m.kind] || 'ARENA';
      setH(banner, `${title} &middot; ${label}${m.state !== 'end' ? ' &middot; ' + fmt(m.time) : ''}${TEAMY.includes(m.kind) ? ` &middot; you: <b style="color:${TEAM_COL[st.team]}">${TEAM_NAME[st.team]}</b>` : ''}`);
      setH(board, m.board.map((r, i) => `<div style="${TEAMY.includes(m.kind) ? 'border-left:3px solid ' + TEAM_COL[r.team] + ';padding-left:6px;' : ''}${r.id === ctx.myId() ? 'color:#ffd75e' : ''};${r.alive ? '' : 'opacity:.5'}">${i + 1}. ${r.name.replace(/</g, '&lt;')} <b style="float:right;margin-left:12px">${m.kind === 'spleef' || m.kind === 'royale' ? (r.alive ? 'alive' : 'out') : m.kind === 'gungame' ? `L${r.lv + 1} &middot; ${r.k}` : m.kind === 'parkour' ? `${r.k}/${m.goal}` : m.kind === 'hide' ? (r.id === m.seeker ? 'SEEKER' : r.alive ? 'hiding' : 'found') : r.k}</b></div>`).join(''));
    }
    setD(ammo, pvp() ? 'block' : 'none');
    const reloading = performance.now() < st.reloadUntil;
    setH(ammo, `<div style="font-size:12px;opacity:.8">${wp.name} &middot; ${st.gw === -2 ? 'unarmed' : st.gw >= 0 ? 'ladder weapon' : TOUCH ? 'tap to swap' : 'keys 1-4'}</div>${st.gw === -2 ? '&mdash;' : reloading ? 'Reloading...' : `${st.ammo[st.w]} <span style="font-size:14px;opacity:.7">/ ${wp.mag}</span>`}<div style="font-size:12px">&#9829; ${st.hp}</div>`);
    setD(cross, pvp() && st.gw !== -2 ? 'block' : 'none');
    setD(dead, st.alive ? 'none' : 'grid'); setT(dead, m && m.kind === 'zombies' ? 'Down - revived next wave' : m && m.kind === 'royale' ? 'Eliminated' : m && m.kind === 'hide' ? 'Found!' : 'Eliminated');
    world3d(m);
    const bb = m && m.kind === 'raid' && m.state === 'play' && m.boss; bossBar.style.display = bb ? 'block' : 'none'; if (bb) { bossFill.style.width = Math.max(0, bb.hp / bb.max * 100) + '%'; bossFill.style.background = bb.phase > 1 ? '#ff2d2d' : bb.phase ? '#ff8a3c' : '#c04bff'; }
  }

  const tracerPool = [];
  function tracer(from, to) {
    let l = tracerPool.pop();
    if (!l) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)); l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: .9 })); l.frustumCulled = false; }
    const a = l.geometry.attributes.position; a.array.set(from, 0); a.array.set(to, 3); a.needsUpdate = true; l.material.opacity = .9; scene.add(l); st.tracers.push({ l, t: 0 });
  }
  function shoot() {
    if (st.gw === -2) return;
    const wp = WEAPONS[st.w], now = performance.now();
    if (!pvp() || !st.alive || !st.mg || st.mg.state !== 'play' || now < st.reloadUntil || now - st.lastShot < wp.rate * 1000) return;
    if (st.ammo[st.w] <= 0) { ctx.send({ t: 'reload', w: st.w }); return; }
    st.lastShot = now; st.ammo[st.w]--; const d = new THREE.Vector3(); camera.getWorldDirection(d);
    ctx.send({ t: 'shoot', w: st.w, dx: d.x, dy: d.y, dz: d.z });
    gun.position.z = -.4; flashMat.opacity = 1; st.kick += wp.recoil || 0; ctx.P.pitch = Math.min(1.55, ctx.P.pitch + (wp.recoil || 0)); ctx.P.yaw += (Math.random() - .5) * (wp.recoil || 0) * .5; ctx.sfx(wp.id === 'sniper' ? 70 : wp.id === 'shotgun' ? 90 : 220, .08, 'square', .08);
  }
  const nextWeapon = () => setWeapon((st.w + 1) % WEAPONS.length);
  function setWeapon(i) { if (st.gw >= 0) return; if (i >= 0 && i < WEAPONS.length && i !== st.w) { st.w = i; st.lastShot = performance.now() + 150; } }

  canvas.addEventListener('mousedown', e => { if (e.button === 0 && pvp() && ctx.canPlay()) { st.down = true; shoot(); } });
  addEventListener('mouseup', e => { if (e.button === 0) st.down = false; });
  addEventListener('keydown', e => {
    if (!pvp() || !ctx.canPlay()) return;
    if (e.code >= 'Digit1' && e.code <= 'Digit4') setWeapon(+e.code.slice(5) - 1);
    else if (e.code === 'KeyR') ctx.send({ t: 'reload', w: st.w });
  });

  return {
    active, pvp, st,
    /** modes where right-click building is part of the game (Bed Wars) */
    builds: () => ctx.mode() === 'bedwars' || ctx.mode() === 'td',
    /** Touch controls: hold = fire (auto weapons repeat), tap = single shot, plus reload / swap. */
    fire(down) { if (down) { if (!pvp()) return; st.down = true; shoot(); } else st.down = false; },
    reload() { if (pvp()) ctx.send({ t: 'reload', w: st.w }); },
    nextWeapon,
    /** Per-frame: tracer fade, recoil settle, auto-fire, HUD refresh. */
    frame(dt) {
      for (let i = st.tracers.length - 1; i >= 0; i--) { const t = st.tracers[i]; t.t += dt; t.l.material.opacity = Math.max(0, .9 - t.t * 8); if (t.t > .12) { scene.remove(t.l); tracerPool.push(t.l); st.tracers.splice(i, 1); } }
      gun.position.z += (-.5 - gun.position.z) * Math.min(1, dt * 18); flashMat.opacity = Math.max(0, flashMat.opacity - dt * 14);
      if (st.kick > 1e-4) { const r = st.kick * Math.min(1, dt * 9); st.kick -= r; ctx.P.pitch = Math.max(-1.55, ctx.P.pitch - r * .7); } // recoil settles back mostly to where you aimed
      if (st.down && WEAPONS[st.w].auto) shoot();
      st.feed = st.feed.filter(f => performance.now() - f.at < 5000); setH(feed, st.feed.map(f => f.html).join('<br>'));
      hud();
    },
    handle(m) {
      switch (m.t) {
        case 'mg': st.mg = m; if (m.state === 'lobby') st.alive = true; break;
        case 'hp': { const hurt = m.hp < st.hp; st.hp = m.hp; st.ammo = m.ammo; st.team = m.team | 0; st.gw = m.gw ?? -1; if (st.gw >= 0) st.w = st.gw; st.alive = m.hp > 0; if (hurt) ctx.flashHurt(); break; }
        case 'reload': st.reloadUntil = performance.now() + m.ms; break;
        case 'hitmark': mark.style.opacity = 1; mark.style.borderColor = m.kill ? '#ff4040' : m.head ? '#ffd75e' : '#fff'; setTimeout(() => mark.style.opacity = 0, 140); ctx.sfx(m.kill ? 520 : 380, .06, 'sine', .08); break;
        case 'shot': if (m.id !== ctx.myId()) { for (const to of m.to) tracer(m.from, to); } else for (const to of m.to) tracer([m.from[0], m.from[1] - .05, m.from[2]], to); break;
        case 'kill': { const esc = s => String(s).replace(/</g, '&lt;'); st.feed.push({ at: performance.now(), html: m.killer ? `${esc(m.killer)} <span style="opacity:.7">[${esc(m.weapon)}]</span> ${esc(m.victim)}` : `${esc(m.victim)} <span style="opacity:.7">${esc(m.weapon)}</span>` }); if (st.feed.length > 5) st.feed.shift(); break; }
      }
    },
    reset() { st.gw = -1; st.team = 0; st.mg = null; st.hp = 20; st.alive = true; st.ammo = WEAPONS.map(w => w.mag); st.reloadUntil = 0; },
  };
}
