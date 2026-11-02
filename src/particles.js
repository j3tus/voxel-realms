// GPU-friendly particle effects: instanced block debris + two soft point-sprite layers (normal and additive).
import * as THREE from 'three';

const SOFT_VS = `
attribute float size; attribute float alpha; attribute vec3 col; varying float vA; varying vec3 vC; uniform float uScale;
void main(){ vA=alpha; vC=col; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*uScale/max(.1,-mv.z); gl_Position=projectionMatrix*mv; }`;
const SOFT_FS = `
varying float vA; varying vec3 vC;
void main(){ vec2 d=gl_PointCoord-.5; float r=length(d)*2.; if(r>1.) discard; float a=(1.-r*r)*vA; gl_FragColor=vec4(vC,a); }`;

class PointLayer {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.amax = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage); this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage); this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('col', this.aCol); g.setAttribute('size', this.aSize); g.setAttribute('alpha', this.aAlpha);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({ vertexShader: SOFT_VS, fragmentShader: SOFT_FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 400 } } });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 4; scene.add(this.pts);
  }
  add(x, y, z, vx, vy, vz, color, s0, s1, life, a, grav = 0, drag = 0) {
    let i = this.n; if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;
    const o = i * 3; this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z; this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.col[o] = color.r; this.col[o + 1] = color.g; this.col[o + 2] = color.b;
    this.s0[i] = s0; this.s1[i] = s1; this.size[i] = s0; this.life[i] = life; this.maxLife[i] = life; this.alpha[i] = a; this.grav[i] = grav; this.drag[i] = drag; this.amax[i] = a;
  }
  update(dt, scale) {
    this.mat.uniforms.uScale.value = scale;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt; const o = i * 3, k = Math.max(0, this.life[i] / this.maxLife[i]);
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      const dr = Math.max(0, 1 - this.drag[i] * dt); this.vel[o] *= dr; this.vel[o + 2] *= dr; this.vel[o + 1] = this.vel[o + 1] * dr - this.grav[i] * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * k; this.alpha[i] = this.amax[i] * Math.min(1, k * 2.2);
    }
    // compact dead tail so the draw range stays small
    while (this.n > 0 && this.life[this.n - 1] <= 0) this.n--;
    this.pts.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aCol.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene) {
    this.soft = new PointLayer(scene, 1400, false); this.glow = new PointLayer(scene, 900, true);
    // instanced debris cubes
    this.max = 520; this.n = 0;
    this.geo = new THREE.BoxGeometry(.13, .13, .13); this.mat = new THREE.MeshStandardMaterial({ roughness: .9 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, this.max); this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.castShadow = true;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); scene.add(this.mesh);
    this.p = new Float32Array(this.max * 3); this.v = new Float32Array(this.max * 3); this.r = new Float32Array(this.max * 3); this.l = new Float32Array(this.max); this.ml = new Float32Array(this.max); this.sc = new Float32Array(this.max);
    this.dummy = new THREE.Object3D(); this.tmp = new THREE.Color();
  }
  debris(x, y, z, hex, n = 12) {
    this.tmp.set(hex);
    for (let k = 0; k < n; k++) {
      let i = this.n; if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;
      const o = i * 3; this.p[o] = x + (Math.random() - .5) * .8; this.p[o + 1] = y + (Math.random() - .5) * .8; this.p[o + 2] = z + (Math.random() - .5) * .8;
      this.v[o] = (Math.random() - .5) * 5; this.v[o + 1] = Math.random() * 4.5 + 1; this.v[o + 2] = (Math.random() - .5) * 5;
      this.r[o] = Math.random() * 6; this.r[o + 1] = Math.random() * 6; this.r[o + 2] = (Math.random() - .5) * 12;
      this.l[i] = this.ml[i] = .8 + Math.random() * .6; this.sc[i] = .6 + Math.random() * .9;
      const c = this.tmp.clone().multiplyScalar(.75 + Math.random() * .4); this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dust(x, y, z, n = 6, tone = 0xb8a98c) { const c = this.tmp.set(tone).clone(); for (let i = 0; i < n; i++) this.soft.add(x + (Math.random() - .5) * .6, y + .05, z + (Math.random() - .5) * .6, (Math.random() - .5) * 1.4, .5 + Math.random() * .8, (Math.random() - .5) * 1.4, c, .22, .75, .6 + Math.random() * .4, .45, -.4, 2.2); }
  splash(x, y, z, n = 14) { const c = new THREE.Color(0x9fd4ff); for (let i = 0; i < n; i++) this.soft.add(x + (Math.random() - .5) * .5, y, z + (Math.random() - .5) * .5, (Math.random() - .5) * 2.4, 2.2 + Math.random() * 2.6, (Math.random() - .5) * 2.4, c, .16, .08, .6 + Math.random() * .3, .85, 12, .4); }
  rainSplash(x, y, z) { const c = new THREE.Color(0xcfe6ff); for (let i = 0; i < 2; i++) this.soft.add(x, y + .03, z, (Math.random() - .5) * .6, .9 + Math.random() * .5, (Math.random() - .5) * .6, c, .09, .03, .25, .7, 9, 0); }
  smoke(x, y, z, n = 10, tone = 0x666666) { const c = new THREE.Color(tone); for (let i = 0; i < n; i++) this.soft.add(x + (Math.random() - .5) * .5, y + Math.random() * 1.4, z + (Math.random() - .5) * .5, (Math.random() - .5) * .6, .8 + Math.random() * .9, (Math.random() - .5) * .6, c, .3, 1.1, 1 + Math.random() * .8, .5, -.2, 1); }
  spark(x, y, z, hex = 0xffc766, n = 8, speed = 3) { const c = new THREE.Color(hex); for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, b = Math.random() * 3.14 - 1.57; this.glow.add(x, y, z, Math.cos(a) * Math.cos(b) * speed, Math.sin(b) * speed * .8 + 1, Math.sin(a) * Math.cos(b) * speed, c, .22, .02, .35 + Math.random() * .35, 1, 6, 1.5); } }
  ember(x, y, z, hex = 0xffb347) { const c = new THREE.Color(hex); this.glow.add(x, y, z, (Math.random() - .5) * .4, .5 + Math.random() * .5, (Math.random() - .5) * .4, c, .12, .02, 1.2 + Math.random() * 1.4, .9, -.1, .6); }
  coins(x, y, z, n = 8) { this.spark(x, y, z, 0xfbbf24, n, 2.2); }
  update(dt, viewportH, fov) {
    const scale = viewportH / (2 * Math.tan(fov * Math.PI / 360));
    this.soft.update(dt, scale); this.glow.update(dt, scale);
    const d = this.dummy;
    for (let i = 0; i < this.n; i++) {
      if (this.l[i] <= 0) continue; this.l[i] -= dt; const o = i * 3;
      if (this.l[i] <= 0) { d.scale.setScalar(0); d.position.set(0, -999, 0); d.updateMatrix(); this.mesh.setMatrixAt(i, d.matrix); continue; }
      this.v[o + 1] -= 18 * dt; this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
      d.position.set(this.p[o], this.p[o + 1], this.p[o + 2]); d.rotation.set(this.r[o] * (this.ml[i] - this.l[i]), this.r[o + 1] * (this.ml[i] - this.l[i]), 0);
      d.scale.setScalar(this.sc[i] * Math.min(1, this.l[i] * 3)); d.updateMatrix(); this.mesh.setMatrixAt(i, d.matrix);
    }
    while (this.n > 0 && this.l[this.n - 1] <= 0) this.n--;
    this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}
