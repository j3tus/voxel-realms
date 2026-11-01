// Voxel Realms website behaviour (no dependencies, CSP-friendly: no inline scripts)
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---- game catalogue ---- */
  const GAMES = [
    { n: 'Gun Arena', i: '\u{1F52B}', c: '#ff5a5a', t: 'solo', tag: 'Free-for-all', p: '2-16', d: 'Four weapons, one arena, first to 15 kills. Headshots hurt. Reload smart.' },
    { n: 'Team Deathmatch', i: '⚔️', c: '#ff8a4c', t: 'team', tag: 'Red vs Blue', p: '2-16', d: 'Balanced teams, no friendly fire, first side to 30 kills takes the round.' },
    { n: 'Gun Game', i: '\u{1F3AF}', c: '#ffd75e', t: 'solo', tag: 'Weapon ladder', p: '2-16', d: 'Every kill upgrades your weapon. Pistol, shotgun, rifle, sniper - finish the ladder to win.' },
    { n: 'Capture the Flag', i: '\u{1F6A9}', c: '#5aa9ff', t: 'team', tag: 'Objective', p: '2-16', d: 'Steal their flag, carry it home, defend your own. First to three captures.' },
    { n: 'Search & Destroy', i: '\u{1F4A3}', c: '#ff9f43', t: 'team', tag: 'One life', p: '4-16', d: 'Attackers plant, defenders defuse. One life per round, first to four wins.' },
    { n: 'Bed Wars', i: '\u{1F6CF}️', c: '#f472b6', t: 'team', tag: 'Build + fight', p: '2-16', d: 'Build cover with blocks, shoot the enemy bed. No bed means no respawns.' },
    { n: 'Zombies', i: '\u{1F9DF}', c: '#6ee7a8', t: 'coop', tag: 'Co-op waves', p: '1-16', d: 'Endless night. Each wave is bigger and tougher. How far can your squad get?' },
    { n: 'Boss Raid', i: '\u{1F409}', c: '#c084fc', t: 'coop', tag: 'Co-op boss', p: '1-16', d: 'A towering boss with three phases and a minion horde. Take it down together.' },
    { n: 'Tower Defence', i: '\u{1F3F0}', c: '#38bdf8', t: 'coop', tag: 'Co-op strategy', p: '1-16', d: 'Waves march on your core. Spend coins on gold-block turrets and barricades.' },
    { n: 'Battle Royale', i: '\u{1F451}', c: '#a78bfa', t: 'solo', tag: 'Last one standing', p: '2-16', d: 'Drop onto real terrain while the storm wall closes in. Outlast everyone.' },
    { n: 'Hide & Seek', i: '\u{1F648}', c: '#fb7185', t: 'casual', tag: 'Party game', p: '2-16', d: 'Hiders scatter, one armed seeker hunts. Survive the clock to win.' },
    { n: 'Parkour Race', i: '\u{1F3C3}', c: '#5eead4', t: 'casual', tag: 'Race', p: '1-16', d: '36 floating platforms, checkpoints, and a long way down. First to the diamond wins.' },
    { n: 'Spleef', i: '❄️', c: '#93c5fd', t: 'casual', tag: 'Last one standing', p: '2-16', d: 'Break the snow floor under everyone else - without falling yourself.' },
  ];
  const cards = $('#cards');
  cards.innerHTML = GAMES.map(g => `<article class="card reveal" data-t="${g.t}" style="--c:${g.c}"><div class="ic">${g.i}</div><h3>${g.n}</h3><p>${g.d}</p><div class="meta"><span class="t">${g.tag}</span><span>${g.p} players</span></div></article>`).join('');
  $('#ticker').innerHTML = [...GAMES, ...GAMES].map(g => `<span>${g.i} ${g.n}</span>`).join('');
  $('#chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; $$('.chip').forEach(x => x.classList.toggle('on', x === b)); $$('.card', cards).forEach(c => c.classList.toggle('hide', b.dataset.f !== 'all' && c.dataset.t !== b.dataset.f)); });

  /* ---- gallery + lightbox ---- */
  const SHOTS = [['lobby-portals', 'The lobby hub'], ['tdm-firefight', 'Team Deathmatch'], ['night-fireflies', 'Fireflies at night'], ['ctf-flag', 'Capture the Flag'], ['battle-royale', 'Battle Royale'], ['snd-site', 'Search & Destroy'], ['bedwars-arena', 'Bed Wars'], ['tower-defence', 'Tower Defence'], ['parkour-course', 'Parkour Race'], ['zombie-night', 'Zombies'], ['day-world', 'The overworld'], ['lobby-portals-side', 'Portals up close']];
  const gal = $('#gal');
  gal.innerHTML = SHOTS.map(([f, c]) => `<figure class="reveal" data-i="${f}"><img src="img/${f}.jpg" alt="${c}" loading="lazy"><figcaption>${c}</figcaption></figure>`).join('');
  $$('img', document).forEach(img => img.addEventListener('error', () => { const f = img.closest('figure'); if (f && f.parentElement === gal) f.remove(); else if (f && f.classList.contains('phone')) f.style.display = 'none'; }));
  const lb = $('#lb'), lbi = $('#lbi'), lbc = $('#lbc'); let cur = 0;
  const show = i => { const figs = $$('figure', gal); if (!figs.length) return; cur = (i + figs.length) % figs.length; const f = figs[cur]; lbi.src = f.querySelector('img').src; lbc.textContent = f.querySelector('figcaption').textContent; lb.hidden = false; document.body.style.overflow = 'hidden'; };
  const close = () => { lb.hidden = true; document.body.style.overflow = ''; };
  gal.addEventListener('click', e => { const f = e.target.closest('figure'); if (f) show($$('figure', gal).indexOf(f)); });
  $('#lbx').onclick = close; $('#lbp').onclick = () => show(cur - 1); $('#lbn').onclick = () => show(cur + 1); lb.addEventListener('click', e => { if (e.target === lb) close(); });
  addEventListener('keydown', e => { if (lb.hidden) return; if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') show(cur - 1); else if (e.key === 'ArrowRight') show(cur + 1); });

  /* ---- nav ---- */
  const nav = $('#nav'), burger = $('#burger'), links = $('#links');
  burger.onclick = () => { const o = links.classList.toggle('open'); burger.setAttribute('aria-expanded', o); };
  links.addEventListener('click', e => { if (e.target.closest('a')) { links.classList.remove('open'); burger.setAttribute('aria-expanded', false); } });

  /* ---- reveal on scroll + count-up ---- */
  const io = new IntersectionObserver(es => es.forEach(en => { if (!en.isIntersecting) return; en.target.classList.add('in'); io.unobserve(en.target); const b = en.target.querySelector && en.target.querySelector('[data-n]'); if (b) countUp(b); }), { threshold: .14, rootMargin: '0px 0px -6% 0px' });
  $$('.reveal').forEach(el => io.observe(el));
  function countUp(b) { const to = +b.dataset.n, t0 = performance.now(); const step = t => { const k = Math.min(1, (t - t0) / 1100); b.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }

  /* ---- scroll effects ---- */
  const heroBg = $('#heroBg'); let ticking = false;
  const onScroll = () => { ticking = false; const y = scrollY; nav.classList.toggle('solid', y > 30); if (y < innerHeight * 1.2) heroBg.style.transform = `translate3d(0,${y * .18}px,0) scale(1.04)`; };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true }); onScroll();

  /* ---- pointer glow + card tilt (desktop only) ---- */
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    document.body.classList.add('has-pointer'); const glow = $('#glow');
    addEventListener('pointermove', e => { glow.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, { passive: true });
    $$('.tilt').forEach(el => { el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; el.style.transform = `perspective(900px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg) scale(1.02)`; }); el.addEventListener('pointerleave', () => { el.style.transform = ''; }); });
  }

  /* ---- copy buttons ---- */
  $$('.copy-btn').forEach(b => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.copy.replace(/&amp;/g, '&')); b.textContent = 'Copied!'; setTimeout(() => (b.textContent = 'Copy'), 1500); } catch { b.textContent = 'Press Ctrl+C'; } }));
})();
