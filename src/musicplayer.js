// Real music: play a YouTube video (official embedded player, kept visible as YouTube requires), a direct audio URL, or a local file.
// Every track shows its credits (title, artist/channel, source with a link). Credits for YouTube come from the public oEmbed data.
const KEY = 'voxel_music_list', IDX = 'voxel_music_idx';
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ytId(url) {
  try { const u = new URL(url.trim()); const h = u.hostname.replace(/^www\.|^m\./, '');
    if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (h === 'youtube.com' || h === 'music.youtube.com' || h === 'youtube-nocookie.com') { if (u.searchParams.get('v')) return u.searchParams.get('v'); const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/); if (m) return m[1]; }
  } catch { /* not a URL */ }
  return /^[\w-]{11}$/.test(url.trim()) ? url.trim() : null;
}
const isAudioUrl = u => /^https?:\/\/.+\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|webm)(\?.*)?$/i.test(u.trim());

export function createMusicPlayer({ cfg, audio, onMode }) {
  const $ = id => document.getElementById(id);
  let list = [], idx = 0, cur = null, el = null, yt = null, ytReady = false, playing = false;
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]').filter(t => t && t.url); idx = Math.min(+localStorage.getItem(IDX) || 0, Math.max(0, list.length - 1)); } catch { list = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 60))); localStorage.setItem(IDX, String(idx)); } catch { /* storage full */ } };
  const volume = () => Math.max(0, Math.min(1, (cfg.volMusic ?? .5) * (cfg.vol ?? 1)));

  /* ---------- credits ---------- */
  async function fetchCredits(url) {
    for (const ep of ['https://noembed.com/embed?url=', 'https://www.youtube.com/oembed?format=json&url=']) {
      try { const c = new AbortController(), t = setTimeout(() => c.abort(), 4500); const r = await fetch(ep + encodeURIComponent(url), { signal: c.signal }); clearTimeout(t); if (!r.ok) continue; const j = await r.json();
        if (j && j.title && !j.error) return { title: j.title, artist: j.author_name || '', artistUrl: j.author_url || '', thumb: j.thumbnail_url || '' }; } catch { /* try the next endpoint */ }
    }
    return null;
  }
  function renderCredits() {
    const t = cur, mode = cfg.musicMode, pill = $('nowplaying'); if (!pill) return;
    let html = '';
    if (mode === 'game') html = '<b>♪ Voxel Realms</b><span>generative score · composed live by the game</span>';
    else if (mode === 'real' && t) html = `<b>♪ ${esc(t.title || 'Untitled')}</b><span>${esc(t.artist || 'Unknown artist')} · ${t.kind === 'youtube' ? `via <a href="https://www.youtube.com/watch?v=${esc(t.id)}" target="_blank" rel="noopener noreferrer">YouTube</a>` : t.kind === 'file' ? 'local file' : `<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">source</a>`}</span>`;
    pill.innerHTML = html; pill.style.display = html && (cfg.musicMode !== 'off') ? 'flex' : 'none';
    const c = $('mp-credits'); if (c) c.innerHTML = mode === 'real' && t ? `<div class="mp-now"><b>${esc(t.title || 'Untitled')}</b><span>${esc(t.artist || 'Unknown artist')}</span><small>${t.kind === 'youtube' ? `Source: <a href="https://www.youtube.com/watch?v=${esc(t.id)}" target="_blank" rel="noopener noreferrer">youtube.com/watch?v=${esc(t.id)}</a>` : t.kind === 'file' ? 'Source: a file on your device' : `Source: <a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(new URL(t.url).hostname)}</a>`}</small></div>` : '<div class="mp-now"><span>Nothing selected. Add a YouTube link or an audio URL below.</span></div>';
  }
  function renderList() {
    const box = $('mp-list'); if (!box) return;
    box.innerHTML = list.length ? '' : '<div class="mp-empty">Your playlist is empty.</div>';
    list.forEach((t, i) => { const row = document.createElement('div'); row.className = 'mp-row' + (i === idx ? ' on' : '');
      row.innerHTML = `<button class="mp-play" aria-label="Play ${esc(t.title || 'track')}">${i === idx && playing ? '❚❚' : '▶'}</button><div class="mp-t"><b>${esc(t.title || t.url)}</b><span>${esc(t.artist || (t.kind === 'youtube' ? 'YouTube' : t.kind === 'file' ? 'Local file' : new URL(t.url).hostname))}</span></div><button class="mp-x ghost" aria-label="Remove">✕</button>`;
      row.querySelector('.mp-play').onclick = () => play(i); row.querySelector('.mp-x').onclick = () => remove(i); box.append(row); });
    const pp = $('mp-pp'); if (pp) pp.textContent = playing ? '❚❚' : '▶';
  }

  /* ---------- playback backends ---------- */
  function ytSend(func, args = []) { if (yt && yt.contentWindow) yt.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); }
  function ensureYT(id) {
    const card = $('ytcard'); card.style.display = 'block'; let f = $('ytframe');
    if (!f) { f = document.createElement('iframe'); f.id = 'ytframe'; f.title = 'YouTube player'; f.width = '220'; f.height = '220'; f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.referrerPolicy = 'strict-origin-when-cross-origin'; $('ytbody').append(f); }
    yt = f; ytReady = false;
    f.onload = () => { ytReady = true; try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch { /* cross-origin ok */ } setTimeout(() => ytSend('setVolume', [Math.round(volume() * 100)]), 400); };
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?enablejsapi=1&autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
  }
  addEventListener('message', e => { if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return; let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (d && d.event === 'onStateChange') { if (d.info === 0) next(); else { playing = d.info === 1; renderList(); } } });
  function stopAll() { if (el) { el.pause(); el.removeAttribute('src'); el.load?.(); el = null; } if (yt) { ytSend('pauseVideo'); } const card = $('ytcard'); if (card) card.style.display = 'none'; const f = $('ytframe'); if (f) { f.src = 'about:blank'; f.remove(); } yt = null; playing = false; }

  async function play(i = idx) {
    if (!list.length) return; idx = ((i % list.length) + list.length) % list.length; cur = list[idx]; save(); stopAll();
    if (cfg.musicMode !== 'real') { cfg.musicMode = 'real'; onMode && onMode(); }
    audio.stopMusic();
    if (cur.kind === 'youtube') { ensureYT(cur.id); playing = true; }
    else { el = new Audio(); el.crossOrigin = 'anonymous'; el.src = cur.url; el.volume = volume(); el.onended = next; el.onerror = () => { playing = false; renderList(); const c = $('mp-credits'); if (c) c.insertAdjacentHTML('beforeend', '<div class="mp-err">This audio URL could not be played (it may block cross-site playback). Try another source.</div>'); }; try { await el.play(); playing = true; } catch { playing = false; } }
    renderCredits(); renderList();
  }
  function pause() { if (cur && cur.kind === 'youtube') ytSend('pauseVideo'); else if (el) el.pause(); playing = false; renderList(); }
  function resume() { if (!cur) return play(idx); if (cur.kind === 'youtube') ytSend('playVideo'); else if (el) el.play().catch(() => {}); playing = true; renderList(); }
  function next() { if (list.length) play(idx + 1); }
  function prev() { if (list.length) play(idx - 1); }
  function remove(i) { list.splice(i, 1); if (idx >= list.length) idx = Math.max(0, list.length - 1); if (!list.length) { stopAll(); cur = null; } save(); renderList(); renderCredits(); }

  async function add(url, meta = {}) {
    url = (url || '').trim(); if (!url) return { error: 'Paste a YouTube link or an audio URL first.' };
    let t;
    const id = ytId(url);
    if (id) { t = { kind: 'youtube', id, url: 'https://www.youtube.com/watch?v=' + id, title: meta.title || '', artist: meta.artist || '' };
      if (!t.title) { const c = await fetchCredits(t.url); if (c) { t.title = c.title; t.artist = c.artist; } else { t.title = 'YouTube video ' + id; t.artist = ''; t.noCredits = true; } } }
    else if (isAudioUrl(url)) { const name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'track').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '); t = { kind: 'audio', url, title: meta.title || name, artist: meta.artist || '' }; }
    else return { error: 'That does not look like a YouTube link or a direct audio file (.mp3, .ogg, .m4a, .wav, .flac).' };
    if (list.some(x => x.url === t.url)) return { error: 'That track is already in your playlist.' };
    list.push(t); save(); renderList(); return { ok: t };
  }
  function addFile(file) { const t = { kind: 'file', url: URL.createObjectURL(file), title: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '), artist: '' }; list.push(t); save(); renderList(); return t; }

  function bind() {
    let seq = 0;
    $('mp-add').onclick = async () => {
      const btn = $('mp-add'), inp = $('mp-url'), msg = $('mp-msg'), mine = ++seq; if (btn.disabled) return; btn.disabled = true; msg.textContent = 'Adding…';
      try { const r = await add(inp.value); if (r.error) { msg.textContent = r.error; return; } inp.value = ''; msg.textContent = r.ok.noCredits ? 'Added. Credits could not be fetched, so the title is generic.' : 'Added: ' + r.ok.title; if (mine === seq && (list.length === 1 || cfg.musicMode === 'real')) play(list.length - 1); }
      finally { btn.disabled = false; }
    };
    $('mp-url').onkeydown = e => { if (e.key === 'Enter') $('mp-add').click(); e.stopPropagation(); };
    $('mp-file').onchange = e => { for (const f of e.target.files) addFile(f); if (e.target.files.length && !cur) play(list.length - e.target.files.length); e.target.value = ''; };
    $('mp-pp').onclick = () => playing ? pause() : resume(); $('mp-next').onclick = next; $('mp-prev').onclick = prev;
    $('yt-close').onclick = () => { stopAll(); cfg.musicMode = 'game'; onMode && onMode(); renderCredits(); renderList(); };
    $('mp-mode').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { cfg.musicMode = b.dataset.m; onMode && onMode(); sync(); });
    sync();
  }
  function sync() {
    $('mp-mode')?.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === cfg.musicMode));
    if (cfg.musicMode !== 'real' && (el || yt)) { pause(); if (cfg.musicMode === 'off') stopAll(); const card = $('ytcard'); if (card && cfg.musicMode !== 'real') card.style.display = 'none'; }
    renderCredits(); renderList();
  }
  function setVolume() { if (el) el.volume = volume(); if (yt && ytReady) ytSend('setVolume', [Math.round(volume() * 100)]); }
  return { bind, sync, play, add, addFile, next, prev, pause, resume, setVolume, get list() { return list; }, get current() { return cur; }, get playing() { return playing; } };
}
