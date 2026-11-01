// Server picker shown first in the desktop (Tauri) and mobile (Capacitor) apps. It stores a list of servers, shows which are online, and then
// navigates the whole window to the chosen server, so the game itself is always the server's own, current web client.
const KEY = 'vr_servers', LAST = 'vr_last', AUTO = 'vr_auto', $ = id => document.getElementById(id);
let servers = []; try { servers = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
const norm = v => { v = v.trim().replace(/\/+$/, ''); if (!v) return ''; if (!/^https?:\/\//i.test(v)) v = (/^(localhost|127\.|10\.|192\.168\.|\d+\.\d+\.\d+\.\d+)/.test(v) ? 'http://' : 'https://') + v; try { return new URL(v).origin; } catch { return ''; } };
const save = () => localStorage.setItem(KEY, JSON.stringify(servers));
const go = s => { localStorage.setItem(LAST, s.url); location.href = s.url + '/?app=1'; };
async function probe(s) { const c = new AbortController(), t = setTimeout(() => c.abort(), 4500); try { const r = await fetch(s.url + '/api/info', { signal: c.signal }); const j = await r.json(); return { ok: true, j }; } catch { return { ok: false }; } finally { clearTimeout(t); } }
function render() {
  const box = $('list'); box.textContent = '';
  if (!servers.length) { const p = document.createElement('p'); p.className = 'sub'; p.style.textAlign = 'center'; p.textContent = 'No servers yet — add one below.'; box.append(p); }
  servers.forEach((s, i) => {
    const row = document.createElement('div'); row.className = 'srv'; row.tabIndex = 0;
    row.innerHTML = '<span class="dot"></span><span class="t"><b></b><small>checking…</small></span><button class="play" type="button">Play</button><button class="rm" type="button" title="Remove" aria-label="Remove">✕</button>';
    row.querySelector('b').textContent = s.name || new URL(s.url).host; const small = row.querySelector('small'), dot = row.querySelector('.dot');
    row.addEventListener('click', e => { if (!e.target.closest('.rm')) go(s); }); row.addEventListener('keydown', e => { if (e.key === 'Enter') go(s); });
    row.querySelector('.rm').addEventListener('click', () => { servers.splice(i, 1); save(); render(); });
    box.append(row);
    probe(s).then(r => { if (!r.ok) { dot.className = 'dot off'; small.textContent = 'offline or unreachable'; return; } dot.className = 'dot on'; const n = (r.j.worlds || []).reduce((a, w) => a + (w.players || 0), 0); small.textContent = `${r.j.name || ''} · v${r.j.version || '?'} · ${n} playing${r.j.maintenance ? ' · maintenance' : ''}`; });
  });
}
$('add').addEventListener('submit', e => { e.preventDefault(); const url = norm($('u').value); if (!url) { $('hint').textContent = 'That does not look like a server address.'; return; } $('hint').textContent = '';
  if (!servers.some(s => s.url === url)) servers.push({ name: $('n').value.trim(), url }); save(); $('n').value = ''; $('u').value = ''; render(); });
$('auto').checked = localStorage.getItem(AUTO) === '1'; $('auto').addEventListener('change', () => localStorage.setItem(AUTO, $('auto').checked ? '1' : '0'));
fetch('config.json').then(r => r.ok ? r.json() : null).catch(() => null).then(cfg => {
  if (cfg && Array.isArray(cfg.defaultServers) && !localStorage.getItem(KEY) && !servers.length) { servers = cfg.defaultServers.map(s => ({ name: s.name || '', url: norm(s.url) })).filter(s => s.url); save(); }
  render();
  const last = localStorage.getItem(LAST); if (localStorage.getItem(AUTO) === '1' && last && !location.hash.includes('pick')) { const s = servers.find(x => x.url === last); if (s) go(s); }
});
