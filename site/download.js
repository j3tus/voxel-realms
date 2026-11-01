// Download page: links point at the latest GitHub Release assets (fixed names set by .github/workflows/apps.yml). No inline script, CSP-safe.
const repo = (document.querySelector('meta[name=vr-repo]')?.content || '').trim(), ready = /^[\w.-]+\/[\w.-]+$/.test(repo) && !/OWNER/.test(repo);
const base = ready ? `https://github.com/${repo}/releases/latest/download/` : '';
const ua = navigator.userAgent, plat = navigator.userAgentData?.platform || navigator.platform || '';
const os = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) || (/Mac/.test(plat) && navigator.maxTouchPoints > 1) ? 'ios' : /win/i.test(plat + ua) ? 'windows' : /mac/i.test(plat) ? 'macos' : /linux|x11/i.test(plat + ua) ? 'linux' : '';
for (const a of document.querySelectorAll('a[data-asset]')) { if (ready) { a.href = base + a.dataset.asset; a.rel = 'noopener'; } else { a.classList.add('off'); a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); } }
const card = document.querySelector(`.card[data-os="${os}"]`), primary = document.getElementById('primary');
if (card) { card.classList.add('me'); const main = card.querySelector('.btn'); const b = main.cloneNode(true); b.textContent = os === 'ios' ? 'Play in Safari' : 'Download for ' + card.querySelector('h2').textContent; primary.append(b); document.getElementById('detected').textContent = os === 'ios' ? 'There is no iOS app yet, but the browser version works great.' : 'Detected: ' + card.querySelector('h2').textContent + '. Other systems are below.'; document.getElementById('grid').prepend(card); }
else { const b = document.createElement('a'); b.className = 'btn'; b.href = '../'; b.textContent = 'Play in your browser'; primary.append(b); }
if (!ready) document.getElementById('ver').textContent = 'Downloads are not published yet. The repository link is set in this page (meta vr-repo) once the first release is out. You can already play in your browser.';
else document.getElementById('ver').innerHTML = '<a href="https://github.com/' + repo + '/releases/latest" rel="noopener" style="color:var(--b)">All releases and notes on GitHub</a>';
