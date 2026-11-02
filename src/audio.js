// Voxel Realms audio engine: unlock-on-gesture AudioContext, mixer buses (music / effects / ambience), layered procedural
// ambience (wind, rain, water, cave, night crickets, day birds, thunder), generative music and surface footsteps.
// Everything is synthesised, so the game ships no audio files. Nothing is created before a user gesture (a context made earlier
// stays suspended in browsers, which silently muted all sound before).

const NOTE = m => 440 * Math.pow(2, (m - 69) / 12);
const SCALES = { lydian: [0, 2, 4, 6, 7, 9, 11], pent: [0, 2, 4, 7, 9], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10] };
export const MOODS = {
  menu: { scale: 'lydian', root: 57, bpm: 58, dens: .42, pad: .9, pulse: 0 },
  lobby: { scale: 'lydian', root: 62, bpm: 84, dens: .55, pad: .7, pulse: .25 },
  day: { scale: 'pent', root: 60, bpm: 70, dens: .34, pad: .8, pulse: 0 },
  night: { scale: 'dorian', root: 53, bpm: 52, dens: .22, pad: 1, pulse: 0 },
  cave: { scale: 'minor', root: 45, bpm: 44, dens: .12, pad: 1, pulse: 0 },
  combat: { scale: 'minor', root: 50, bpm: 112, dens: .7, pad: .5, pulse: 1 },
};

export function createAudio(cfg) {
  let ctx = null, unlocked = false, master, comp, busM, busS, busA, reverb, revSend, lowpass;
  let noise = null, layers = null, musicTimer = 0, musicMood = 'menu', musicOn = false, nextBeat = 0, beat = 0, chord = [0, 2, 4];
  const listeners = [];
  const vol = k => Math.max(0, Math.min(1.5, Number.isFinite(+cfg[k]) && cfg[k] != null ? +cfg[k] : 1));
  const ramp = (p, v, t = .25) => { try { p.setTargetAtTime(v, ctx.currentTime, t); } catch { /* context closed */ } };

  function build() {
    if (ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain(); comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = .01; comp.release.value = .25;
    lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 20000; lowpass.Q.value = .4;         // underwater / cave muffling
    busM = ctx.createGain(); busS = ctx.createGain(); busA = ctx.createGain();
    busM.connect(lowpass); busS.connect(lowpass); busA.connect(lowpass); lowpass.connect(master); master.connect(comp); comp.connect(ctx.destination);
    // a small synthetic room for the music
    reverb = ctx.createConvolver(); const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    reverb.buffer = ir; revSend = ctx.createGain(); revSend.gain.value = .32; revSend.connect(reverb); reverb.connect(busM);
    applyVolumes(true);
  }
  function applyVolumes(now) {
    if (!ctx) return; const t = now ? 0 : .12;
    ramp(master.gain, vol('vol'), t); ramp(busM.gain, vol('volMusic') * .55, t); ramp(busS.gain, vol('volSfx'), t); ramp(busA.gain, vol('volAmb') * .8, t);
  }

  /* ---------- unlock: the only place a context is resumed ---------- */
  function unlock() {
    if (!unlocked) { unlocked = true; build(); }
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    if (ctx && !layers) buildAmbience();
    if (musicOn && !musicTimer) startMusic(musicMood);
    listeners.forEach(f => f());
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => {}); else if (unlocked) ctx.resume().catch(() => {}); });

  /* ---------- noise + ambience beds ---------- */
  function noiseBuf() {
    if (noise) return noise; const n = ctx.sampleRate * 6, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = .99765 * b0 + w * .099046; b1 = .963 * b1 + w * .2965164; b2 = .57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * .1848) * .22; }
    const f = Math.floor(ctx.sampleRate * .05); for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; } // crossfade the loop seam: no click
    return (noise = b);
  }
  function bed(type, freq, q, gain0 = 0) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf(); s.loop = true; s.loopStart = 0; s.loopEnd = s.buffer.duration - .05; s.playbackRate.value = .9 + Math.random() * .2;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(); g.gain.value = gain0; s.connect(f); f.connect(g); g.connect(busA); s.start(0, Math.random() * 4);
    return { s, f, g };
  }
  function buildAmbience() {
    layers = { wind: bed('bandpass', 420, .5), rain: bed('highpass', 1400, .3), water: bed('lowpass', 700, .7), cave: bed('lowpass', 160, 1.2), hum: bed('bandpass', 90, 4) };
    // slow movement in the wind so it breathes instead of hissing
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .11; lg.gain.value = 180; lfo.connect(lg); lg.connect(layers.wind.f.frequency); lfo.start();
    const lfo2 = ctx.createOscillator(), lg2 = ctx.createGain(); lfo2.frequency.value = .27; lg2.gain.value = 260; lfo2.connect(lg2); lg2.connect(layers.water.f.frequency); lfo2.start();
    scheduleChirps();
  }
  let chirpT = 0, env = { night: 0, day: 1, k: 0, storm: false, under: false, water: 0, cave: 0, alt: 0, speed: 0, started: false, quiet: false };
  function scheduleChirps() {
    clearTimeout(chirpT); chirpT = setTimeout(() => { if (ctx && ctx.state === 'running' && env.started && !env.under && !env.quiet && env.k < .25 && env.cave < .3) { if (env.night > .5) cricket(); else if (env.day > .3) bird(); } scheduleChirps(); }, 1800 + Math.random() * 4200);
  }
  function tone(type, f0, f1, dur, vol, dest, when = 0, attack = .01) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + when; o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + .05);
  }
  function bird() { const base = 1800 + Math.random() * 1800, n = 2 + (Math.random() * 3 | 0); for (let i = 0; i < n; i++) tone('sine', base * (1 + Math.random() * .25), base * (1.15 + Math.random() * .4), .09 + Math.random() * .06, .018 * vol('volAmb'), busA, i * .13); }
  function cricket() { const f = 4200 + Math.random() * 500; for (let i = 0; i < 6; i++) tone('triangle', f, f, .035, .012 * vol('volAmb'), busA, i * .07); }

  /** called every frame with the world state; all targets are smoothed, so nothing ever jumps */
  function update(e) {
    if (!ctx || !layers) return; Object.assign(env, e); const on = env.started, q = env.quiet ? .25 : 1, t = .35;
    const rain = on && !env.under ? env.k : 0, wind = on ? (.06 + Math.min(1, Math.max(0, (env.alt - 30) / 40)) * .22 + (env.storm ? .22 : 0) + env.speed * .02) * (env.cave > .5 ? .2 : 1) * q : 0;
    ramp(layers.wind.g.gain, wind, t); ramp(layers.wind.f.frequency, 380 + env.alt * 6 + (env.storm ? 300 : 0), 1.2);
    ramp(layers.rain.g.gain, rain * .6 * q, t); ramp(layers.rain.f.frequency, 1000 + (env.storm ? 700 : 300), .8);
    ramp(layers.water.g.gain, on && !env.under ? env.water * .3 * q : 0, t);
    ramp(layers.cave.g.gain, on && !env.under ? env.cave * .22 : 0, 1.2); ramp(layers.hum.g.gain, on && env.lobby ? .05 : 0, 1);
    ramp(lowpass.frequency, env.under ? 520 : env.cave > .6 ? 4200 : 20000, .25);
    // music follows the situation
    const mood = env.combat ? 'combat' : env.lobby ? 'lobby' : env.cave > .6 ? 'cave' : env.night > .5 ? 'night' : env.started ? 'day' : 'menu';
    if (mood !== musicMood) { musicMood = mood; }
  }

  /* ---------- one-shots ---------- */
  function sfx(f, dur = .09, type = 'square', v = .05) { if (!ctx || ctx.state !== 'running') return; try { tone(type, f, f, dur, v * .9, busS, 0, .004); } catch { /* ignore */ } }
  function burst(freq, q, dur, v, when = 0, type = 'bandpass') {
    if (!ctx || ctx.state !== 'running') return; const s = ctx.createBufferSource(); s.buffer = noiseBuf(); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(), t = ctx.currentTime + when;
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + dur); s.connect(f); f.connect(g); g.connect(busS); s.start(t, Math.random() * 4); s.stop(t + dur + .05);
  }
  const STEP = { grass: [900, .8, .09, .1], dirt: [600, .9, .08, .11], stone: [2200, 2.4, .05, .09], sand: [1500, .5, .12, .07], wood: [700, 3, .06, .11], snow: [1800, .6, .13, .06], gravel: [1100, 1.2, .1, .1], water: [500, .5, .22, .12] };
  function step(kind = 'grass', run = false) { const s = STEP[kind] || STEP.grass; burst(s[0] * (.85 + Math.random() * .3), s[1], s[2] * (run ? .8 : 1), s[3] * (run ? 1.2 : 1)); if (kind === 'stone' || kind === 'wood') tone('sine', 140 + Math.random() * 40, 90, .06, .03, busS); }
  function thunder() {
    if (!ctx || ctx.state !== 'running') return; const s = ctx.createBufferSource(); s.buffer = noiseBuf(); s.playbackRate.value = .5; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, ctx.currentTime); f.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 3);
    const g = ctx.createGain(), t = ctx.currentTime; g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.9, t + .08); g.gain.exponentialRampToValueAtTime(.0001, t + 3.6); s.connect(f); f.connect(g); g.connect(busA); s.start(t, Math.random() * 2); s.stop(t + 3.8);
  }
  function splash() { burst(1200, .5, .25, .12); burst(500, .8, .35, .1, .04); }
  function hurt() { burst(220, 1.5, .18, .2); tone('sawtooth', 140, 70, .2, .1, busS); }
  function stinger(win) { const seq = win ? [0, 4, 7, 12] : [7, 3, 0, -5]; seq.forEach((n, i) => tone('triangle', NOTE(62 + n), NOTE(62 + n), .5, .09, busM, i * .14, .02)); }

  /* ---------- generative music ---------- */
  function startMusic(mood) { musicMood = mood || musicMood; musicOn = true; if (!ctx || musicTimer) return; nextBeat = ctx.currentTime + .15; musicTimer = setInterval(tickMusic, 110); }
  function stopMusic() { musicOn = false; clearInterval(musicTimer); musicTimer = 0; }
  function pluck(m, when, v, dur = 1.4) {
    const t = ctx.currentTime + when, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = NOTE(m); o2.frequency.value = NOTE(m) * 2.005;
    f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(700, t + dur * .7); g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(busM); g.connect(revSend); o.start(t); o2.start(t); o.stop(t + dur + .1); o2.stop(t + dur + .1);
  }
  function pad(notes, when, dur, v) {
    const t = ctx.currentTime + when; for (const m of notes) for (const det of [-5, 6]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = NOTE(m); o.detune.value = det; f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = .5;
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + dur * .35); g.gain.linearRampToValueAtTime(.0001, t + dur); o.connect(f); f.connect(g); g.connect(busM); g.connect(revSend); o.start(t); o.stop(t + dur + .1);
    }
  }
  function kick(when, v) { const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + .14); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + .2); o.connect(g); g.connect(busM); o.start(t); o.stop(t + .25); }
  function hat(when, v) { const s = ctx.createBufferSource(); s.buffer = noiseBuf(); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = ctx.createGain(), t = ctx.currentTime + when; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + .05); s.connect(f); f.connect(g); g.connect(busM); s.start(t, Math.random() * 4); s.stop(t + .08); }
  function tickMusic() {
    if (!ctx || ctx.state !== 'running' || !musicOn || cfg.musicMode !== 'game') return; const M = MOODS[musicMood] || MOODS.menu, sc = SCALES[M.scale], spb = 60 / M.bpm / 2; // eighth notes
    while (nextBeat < ctx.currentTime + .45) {
      const when = Math.max(0, nextBeat - ctx.currentTime), bar = beat % 16, deg = i => M.root + sc[((i % sc.length) + sc.length) % sc.length] + 12 * Math.floor(i / sc.length);
      if (bar === 0) { const r = (Math.random() * sc.length) | 0; chord = [r, r + 2, r + 4]; pad(chord.map(deg), when, spb * 16, .045 * M.pad); if (Math.random() < .8) pluck(deg(chord[0]) - 24, when, .1, spb * 8); }
      if (Math.random() < M.dens * (beat % 2 ? .45 : 1)) { const pick = chord[(Math.random() * 3) | 0] + (Math.random() < .35 ? 7 : 0) + (Math.random() < .2 ? -sc.length : 0); pluck(deg(pick) + 12, when, .05 + Math.random() * .04); }
      if (M.pulse) { if (beat % 4 === 0) kick(when, .22 * M.pulse); if (beat % 2 === 1) hat(when, .04 * M.pulse); if (bar % 8 === 6) pluck(deg(chord[1]) - 12, when, .09, spb * 2); }
      nextBeat += spb; beat++;
    }
  }

  return {
    get ready() { return !!ctx && ctx.state === 'running'; }, get ctx() { return ctx; }, get state() { return ctx ? ctx.state : 'none'; },
    unlock, update, sfx, step, thunder, splash, hurt, stinger, startMusic, stopMusic, applyVolumes, noiseBuf, get mood() { return musicMood; },
    onUnlock: f => listeners.push(f), analyser() { if (!ctx) return null; const a = ctx.createAnalyser(); a.fftSize = 1024; master.connect(a); return a; },
    musicRoot() { return busM; },
  };
}
