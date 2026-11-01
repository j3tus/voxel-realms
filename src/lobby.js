// Lobby hub visuals. Every open frame gets a living portal: swirling vortex, glowing frame halo, a beam of light into the sky,
// a pulsing floor pad, rising sparkles and a floating label (icon, name, blurb, live player pips and round status).
const COL = { pvp: '#ff5a5a', tdm: '#ff8a4c', gungame: '#ffd75e', ctf: '#5aa9ff', snd: '#ff9f43', bedwars: '#f472b6', zombies: '#6ee7a8', raid: '#c084fc', td: '#38bdf8', royale: '#a78bfa', hide: '#fb7185', parkour: '#5eead4', spleef: '#93c5fd', creative: '#fde68a', survival: '#86efac' };
const ICON = { pvp: '\u{1F52B}', tdm: '⚔️', gungame: '\u{1F3AF}', ctf: '\u{1F6A9}', snd: '\u{1F4A3}', bedwars: '\u{1F6CF}️', zombies: '\u{1F9DF}', raid: '\u{1F409}', td: '\u{1F3F0}', royale: '\u{1F451}', hide: '\u{1F648}', parkour: '\u{1F3C3}', spleef: '❄️', creative: '\u{1F9F1}', survival: '\u{1F332}' };
const BLURB = { pvp: 'Free-for-all gunfight', tdm: 'Red vs Blue deathmatch', gungame: 'Climb the weapon ladder', ctf: 'Steal the enemy flag', snd: 'Plant or defuse the bomb', bedwars: 'Protect your bed, wreck theirs', zombies: 'Co-op wave survival', raid: 'Co-op boss fight', td: 'Defend the core with turrets', royale: 'Last one standing', hide: 'Hide & seek with guns', parkour: 'Race to the finish', spleef: 'Break the floor', creative: 'Free build sandbox', survival: 'Survive & trade' };
const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function createLobby({ THREE, scene }) {
  const items = new Map(); // slot -> item
  const vert = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
  const vortexFrag = `uniform float t;uniform vec3 col;varying vec2 vUv;
    void main(){vec2 p=vUv*2.-1.;p.y*=.78;float r=length(p),a=atan(p.y,p.x);
      float s1=.5+.5*sin(a*4.+log(r+.03)*9.-t*3.2),s2=.5+.5*sin(a*7.-r*18.+t*4.1),ring=.5+.5*sin(r*26.-t*5.);
      float edge=smoothstep(0.,.1,vUv.x)*smoothstep(1.,.9,vUv.x)*smoothstep(0.,.06,vUv.y)*smoothstep(1.,.94,vUv.y);
      float core=pow(1.-clamp(r*.9,0.,1.),1.6);
      vec3 c=col*(.35+.65*s1)+vec3(1.)*s2*.14*core+col*core*1.1+vec3(1.)*pow(ring,8.)*.22*(1.-r);
      gl_FragColor=vec4(c,(.4+.5*core+.12*s1)*edge);}`;
  const haloFrag = `uniform float t;uniform vec3 col;varying vec2 vUv;
    void main(){vec2 d=abs(vUv-.5)*vec2(5.4,6.4);float ox=max(d.x-1.5,0.),oy=max(d.y-2.,0.),o=length(vec2(ox,oy));
      float g=exp(-o*1.9)*(.7+.3*sin(t*2.1+vUv.y*6.));float inside=1.-smoothstep(0.,.25,max(d.x-1.5,d.y-2.)*-1.+.0);
      gl_FragColor=vec4(col*g*1.5,g*.55);}`;
  const beamFrag = `uniform float t;uniform vec3 col;varying vec2 vUv;
    void main(){float f=pow(1.-vUv.y,2.2),flow=.75+.25*sin(vUv.y*20.-t*3.);gl_FragColor=vec4(col*1.2,f*.2*flow);}`;
  const padFrag = `uniform float t;uniform vec3 col;varying vec2 vUv;
    void main(){vec2 p=vUv*2.-1;float r=length(p);float ring=smoothstep(.78,.86,r)*(1.-smoothstep(.9,1.,r));float pulse=.5+.5*sin(t*2.4-r*8.);float fill=(1.-smoothstep(.2,.8,r))*.25*pulse;
      float a=atan(p.y,p.x);float dash=step(.5,.5+.5*sin(a*14.+t*1.5))*ring;gl_FragColor=vec4(col*(ring*1.4+dash*.6+fill*1.5),(ring*.8+fill)*(1.-step(1.,r)));}`;
  const mat = (frag, col, extra = {}) => new THREE.ShaderMaterial({ uniforms: { t: { value: 0 }, col: { value: col } }, vertexShader: vert, fragmentShader: frag, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, ...extra });
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const roundRect = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };

  function paint(it, p) {
    const g = it.cv.getContext('2d'), W = it.cv.width, H = it.cv.height, c = COL[p.mode] || '#ffffff'; g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(14,20,34,.9)'); bg.addColorStop(1, 'rgba(6,9,16,.9)');
    g.fillStyle = bg; roundRect(g, 6, 6, W - 12, H - 12, 30); g.fill(); g.lineWidth = 5; g.strokeStyle = c; g.stroke();
    g.fillStyle = c + '33'; g.beginPath(); g.arc(88, H / 2, 58, 0, 6.283); g.fill(); g.lineWidth = 4; g.strokeStyle = c; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.font = '62px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.fillText(ICON[p.mode] || '\u{1F3AE}', 88, H / 2 + 4);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = '#fff'; g.font = '800 50px system-ui,"Segoe UI",sans-serif'; let name = p.name; while (g.measureText(name).width > W - 190 && name.length > 3) name = name.slice(0, -2); if (name !== p.name) name += '…'; g.fillText(name, 168, 70);
    g.fillStyle = c; g.font = '600 27px system-ui,sans-serif'; g.fillText((BLURB[p.mode] || p.mode) + (p.sk ? '  ·  bots: ' + p.sk : ''), 168, 108);
    // player pips + count
    const pips = Math.min(10, p.max), on = Math.min(pips, p.n); for (let i = 0; i < pips; i++) { g.beginPath(); g.arc(178 + i * 24, 142, 8, 0, 6.283); g.fillStyle = i < on ? c : 'rgba(255,255,255,.16)'; g.fill(); }
    g.fillStyle = p.n >= p.max ? '#ff7b7b' : '#bfe9ff'; g.font = '700 26px system-ui,sans-serif'; g.fillText(`${p.n}/${p.max}`, 178 + pips * 24 + 8, 151); if (p.b) { g.fillStyle = 'rgba(191,233,255,.6)'; g.font = '600 22px system-ui,sans-serif'; g.fillText(`+${p.b} bots`, 178 + pips * 24 + 8 + g.measureText(`${p.n}/${p.max}`).width + 26, 151); }
    const chip = p.n >= p.max ? ['FULL', '#ff5a5a'] : p.st === 'play' ? ['LIVE ' + clock(p.t), '#ffd75e'] : p.st === 'end' ? ['ENDING', '#9aa7b8'] : p.st === 'lobby' ? ['OPEN', '#6ee7a8'] : null;
    if (chip) { g.font = '800 24px system-ui,sans-serif'; const w = g.measureText(chip[0]).width + 34; g.fillStyle = chip[1]; roundRect(g, W - 24 - w, 22, w, 38, 19); g.fill(); g.fillStyle = '#0b1220'; g.textAlign = 'center'; g.fillText(chip[0], W - 24 - w / 2, 49); }
    it.tex.needsUpdate = true;
  }
  function make(p) {
    const g = new THREE.Group(), col = new THREE.Color(COL[p.mode] || '#ffffff'), mats = [];
    const m = (frag, extra) => { const x = mat(frag, col.clone(), extra); mats.push(x); return x; };
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), m(vortexFrag)); g.add(plane);
    for (const z of [.56, -.56]) { const h = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 6.4), m(haloFrag)); h.position.z = z; g.add(h); }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.3, 36, 20, 1, true), m(beamFrag)); beam.position.y = 20; g.add(beam);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), m(padFrag)); pad.rotation.x = -Math.PI / 2; pad.position.y = -1.97; g.add(pad);
    // sparkles drifting up through the opening
    const N = 26, pos = new Float32Array(N * 3), vel = new Float32Array(N); for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - .5) * 2.6; pos[i * 3 + 1] = -2 + Math.random() * 4.4; pos[i * 3 + 2] = (Math.random() - .5) * .6; vel[i] = .5 + Math.random() * 1.1; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sp = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, color: col.clone().lerp(new THREE.Color('#ffffff'), .35), size: .22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })); sp.frustumCulled = false; g.add(sp);
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 210; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); spr.scale.set(6.4, 2.1, 1); spr.position.set(0, 4.1, 0); g.add(spr);
    const light = new THREE.PointLight(col, 1.6, 11); light.position.set(0, 0, 1.2); g.add(light);
    scene.add(g); return { g, mats, tex, cv, key: '', plane, beam, pad, sp, pos, vel, spr, light, geos: [plane.geometry, beam.geometry, pad.geometry, geo] };
  }
  return {
    handle(m) {
      const seen = new Set();
      for (const p of m.portals) {
        seen.add(p.s); let it = items.get(p.s); if (!it) { it = make(p); items.set(p.s, it); }
        it.g.position.set(p.x, p.y, p.z); it.g.rotation.y = p.ax === 'z' ? Math.PI / 2 : 0; it.p = p;
        const key = p.name + '|' + p.mode + '|' + p.n + '|' + p.b + '|' + p.max + '|' + p.st + '|' + (p.st === 'play' ? p.t : 0);
        if (key !== it.key) { it.key = key; const c = new THREE.Color(COL[p.mode] || '#ffffff'); for (const x of it.mats) x.uniforms.col.value.copy(c); it.light.color.copy(c); it.sp.material.color.copy(c).lerp(new THREE.Color('#ffffff'), .35); paint(it, p); }
      }
      for (const [s, it] of [...items]) if (!seen.has(s)) this.drop(s, it);
    },
    drop(s, it) { scene.remove(it.g); for (const x of it.geos) x.dispose(); for (const x of it.mats) x.dispose(); it.sp.material.dispose(); it.spr.material.dispose(); it.tex.dispose(); items.delete(s); },
    frame(t, dt = .016) {
      for (const it of items.values()) {
        for (const x of it.mats) x.uniforms.t.value = t;
        const a = it.pos, v = it.vel; for (let i = 0; i < v.length; i++) { a[i * 3 + 1] += v[i] * dt; a[i * 3] += Math.sin(t * 1.3 + i) * dt * .25; if (a[i * 3 + 1] > 2.4) { a[i * 3 + 1] = -2; a[i * 3] = (Math.random() - .5) * 2.6; } } it.sp.geometry.attributes.position.needsUpdate = true;
        it.light.intensity = 1.4 + Math.sin(t * 2.2 + it.p.s) * .35; it.spr.position.y = 4.1 + Math.sin(t * 1.4 + it.p.s) * .08;
      }
    },
    clear() { for (const [s, it] of [...items]) this.drop(s, it); },
    get count() { return items.size; },
    get portals() { return [...items.values()].map(it => it.p); },
  };
}
