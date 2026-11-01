import { CHANGELOG } from './changelog.js';
import { createAudio } from './audio.js';
import { createMusicPlayer } from './musicplayer.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CS, CH, SEA, B, NAMES, TILES, HARD, dropOf, CATS, RECIPES, DEFAULT_HOTBAR } from '../shared/blocks.js';
import { createWorldGen, hash3, lerp, fade, smooth, seedFromText } from '../shared/worldgen.js';
import { meshChunk as meshData } from '../shared/mesher.js';
import { MobSim, MOB, MOB_TYPES, VILLAGER_LINES } from '../shared/mobs.js';
import { makeAtlas, blockColors, TS, ATL } from './atlas.js';
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, getMany as idbGetMany } from 'idb-keyval';
import { newEconomy, sellPrice, buyPrice, sell as ecoSell, buy as ecoBuy, quoteBuy, tickEconomy, genBounties, MOB_REWARD, BASE as ECO_BASE, BUYABLE } from '../shared/economy.js';
import { moveBody } from '../shared/physics.js';
import { newCareer, progress as careerProgress, rankOf, current as careerCurrent } from '../shared/career.js';
import { createArena } from './arena.js';
import { createLobby } from './lobby.js';
import { Particles } from './particles.js';
import './style.css';
import { isWater, Fluid } from '../shared/fluid.js';
const { AIR, GRASS, DIRT, STONE, SAND, LOG, WATER, PLANKS, BRICK, SNOW, COBBLE } = B;

const $=id=>document.getElementById(id);
/* ============================ save data ============================ */
const UID=(()=>{ try{ let u=localStorage.getItem('voxel_uid'); if(!u){ u=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now()); localStorage.setItem('voxel_uid',u); } return u; }catch(e){ return 'anon'; } })(); // stable device id (identifies you to servers; never shared)
const WORLDS_KEY='voxel_worlds', CUR_KEY='voxel_cur', LEGACY_KEY='voxel_realms_v1';
let worldIndex=[]; try{ worldIndex=JSON.parse(localStorage.getItem(WORLDS_KEY))||[]; }catch(e){}
const saveIndex=()=>{ try{ localStorage.setItem(WORLDS_KEY,JSON.stringify(worldIndex)); }catch(e){} };
const newWorldId=()=>'w'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
let save = null, legacyEdits=false;
// one-time migration of the old single-slot save into world slot "w1"
if(!worldIndex.length){
  let old=null; try{ old=await idbGet(LEGACY_KEY); }catch(e){} if(!old){ try{ old=JSON.parse(localStorage.getItem(LEGACY_KEY)); }catch(e){} }
  const id='w1'; worldIndex.push({id,name:'My World',seed:old?.seed??(Math.random()*1e9|0),gen:old?.gen??{type:'normal',mode:'creative'},created:Date.now(),lastPlayed:Date.now()});
  if(old){ try{ const legacyChunkEdits=old.edits; delete old.edits; await idbSet('w:'+id,old); if(legacyChunkEdits) for(const k in legacyChunkEdits) await idbSet('e:'+id+':'+k,legacyChunkEdits[k]);
      for(const k of await idbKeys()) if(typeof k==='string'&&/^e:[^:]+$/.test(k)){ const v=await idbGet(k); await idbSet('e:'+id+':'+k.slice(2),v); await idbDel(k); }
      await idbDel(LEGACY_KEY); try{ localStorage.removeItem(LEGACY_KEY); }catch(e){} }catch(e){} }
  saveIndex(); try{ localStorage.setItem(CUR_KEY,id); }catch(e){}
}
let curId=null; try{ curId=localStorage.getItem(CUR_KEY); }catch(e){}
if(!worldIndex.find(w=>w.id===curId)) curId=worldIndex.slice().sort((a,b)=>b.lastPlayed-a.lastPlayed)[0].id;
try{ localStorage.setItem(CUR_KEY,curId); }catch(e){}
const curEntry=()=>worldIndex.find(w=>w.id===curId);
const SAVE_KEY='w:'+curId, EDIT_PREFIX='e:'+curId+':';
try { save = await idbGet(SAVE_KEY); } catch(e){}
if(save){ save.edits={}; try{ const ks=(await idbKeys()).filter(k=>typeof k==='string'&&k.startsWith(EDIT_PREFIX)); const vals=await idbGetMany(ks); ks.forEach((k,i)=>{ save.edits[k.slice(EDIT_PREFIX.length)]=vals[i]; }); }catch(e){} } // edits live in per-chunk keys so autosaves only write what changed
const dirtyChunks=new Set();
let SEED = save?.seed ?? curEntry().seed;
let GEN = save?.gen ?? curEntry().gen ?? {type:'normal'};
const edits = save?.edits ?? {};          // chunkKey -> {idx: id}
let wg = createWorldGen(SEED, GEN);
const terrainH = (x,z)=>wg.terrainH(x,z);
let saveDirty = false;
setTimeout(()=>{ saveDirty=true; },0);
const CFG_KEY='voxel_cfg';
const cfg={ao:false,ui_crosshair:true,ui_hotbar:true,ui_chat:true,ui_vitals:true,ui_prompt:true,time:'cycle',day:420,rd:7,fly:1,shadows:2,fov:75,bright:1,scale:1,fog:1,curve:.0002,round:1,bump:1.6,clouds:true,vig:true,sens:1,inv:false,vol:1,volMusic:.5,volSfx:1,volAmb:.8,musicMode:'game',debug:false,hints:true,coords:true,bob:true,bloom:false,cine:false,adaptive:true,minimap:true,weather:true};
const IS_TOUCH=(navigator.maxTouchPoints>0&&matchMedia('(pointer:coarse)').matches)||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
if(IS_TOUCH) Object.assign(cfg,{rd:5,shadows:1,ao:false,bloom:false,scale:.85,clouds:false,bump:1,round:0}); // phones: lighter defaults (user changes still win)
const DEFAULT_CFG=JSON.parse(JSON.stringify(cfg));
const audio=createAudio(cfg);
const music=createMusicPlayer({cfg,audio,onMode:()=>{ saveCfg(); applyCfg(); }});
try{ Object.assign(cfg,JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); }catch(e){}
const saveCfg=()=>{ try{ localStorage.setItem(CFG_KEY,JSON.stringify(cfg)); }catch(e){} };
// what the adaptive governor learned on this device last time (stack of {k:setting,v:old value,n:lowered value}); applied up-front so a weak device never re-lags
const AUTO_KEY='voxel_auto'; let autoStack=[], autoBlocked=[]; const FIRST_RUN=!localStorage.getItem(CFG_KEY);
try{ const a=JSON.parse(localStorage.getItem(AUTO_KEY)||'{}'); autoBlocked=a.blocked||[]; if(cfg.adaptive!==false) for(const e of (a.stack||[])) if(cfg[e.k]===e.v||(!FIRST_RUN&&cfg[e.k]>e.n)){ cfg[e.k]=e.n; autoStack.push(e); } }catch(e){}
const saveAuto=()=>{ try{ localStorage.setItem(AUTO_KEY,JSON.stringify({stack:autoStack,blocked:autoBlocked})); }catch(e){} };
let noSave=false;
function writeSave(){
  if(!saveDirty||mp||noSave) return; saveDirty = false;
  try {
    idbSet(SAVE_KEY,{seed:SEED, gen:GEN, pos:[P.x,P.y,P.z], yaw:P.yaw, pitch:P.pitch, time:worldTime, hot:hotbar, items, hp:S.hp, weather:wx.type, coins, eco, career}).catch(()=>{});
    for(const k of dirtyChunks) idbSet(EDIT_PREFIX+k,edits[k]).catch(()=>{}); dirtyChunks.clear();
  } catch(e){}
}
const lastCfgTouch = 0; // (reserved)


const atlas = makeAtlas();
const BLOCK_COLOR = blockColors(atlas);


/* ============================ renderer / scene ============================ */
const renderer = new THREE.WebGLRenderer({antialias:!(navigator.maxTouchPoints>0&&matchMedia('(pointer:coarse)').matches), powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,(navigator.maxTouchPoints>0&&matchMedia('(pointer:coarse)').matches)?1.5:2));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const GPU=(()=>{ try{ const gl=renderer.getContext(), e=gl.getExtension('WEBGL_debug_renderer_info'); return String(e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):''); }catch(e){ return ''; } })();
/** 0 potato .. 3 strong, from GPU string, cores, memory, screen. Auto never picks Ultra (opt-in). */
function deviceTier(){
  let t=2; const cores=navigator.hardwareConcurrency||4, mem=navigator.deviceMemory||4, px=screen.width*screen.height*Math.min(devicePixelRatio,2)**2;
  if(/swiftshader|llvmpipe|software|softpipe|basic render/i.test(GPU)) t=0;
  else if(/nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro|vii)|amd radeon rx|arc a|apple m\d/i.test(GPU)&&!IS_TOUCH) t=3;
  else if(/intel/i.test(GPU)) t=/iris xe|arc/i.test(GPU)?2:1;
  else if(/mali-?[gt]?[1-5]\d\d?\b|adreno \(tm\) [2-4]\d\d|powervr|videocore/i.test(GPU)) t=0;
  else if(IS_TOUCH) t=/apple|adreno \(tm\) [67]\d\d|mali-g(7|8|9)/i.test(GPU)?2:1;
  if(cores<=2||mem<=2) t--; if(px>3.5e6&&t<3) t--; // very high pixel counts need more headroom
  return Math.max(0,Math.min(3,t));
}
const TIER_CFG=[{rd:4,shadows:0,scale:.7,bump:0,clouds:false,fog:.8,ao:false,bloom:false,cine:false},{rd:5,shadows:1,scale:.85,bump:0,clouds:false,fog:.9,ao:false,bloom:false,cine:false},{rd:7,shadows:2,scale:1,bump:1,clouds:true,fog:1,ao:false,bloom:false,cine:false},{rd:9,shadows:3,scale:1,bump:1.2,clouds:true,fog:1,ao:true,bloom:true,cine:false}];
const TIER=deviceTier(); window.__tier=TIER; window.__gpu=GPU;
if(FIRST_RUN){ Object.assign(cfg,TIER_CFG[TIER]); }
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // refreshed manually and throttled (see loop)
document.body.prepend(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c7f5);
scene.fog = new THREE.Fog(0x87c7f5, 60, 110);
const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, .08, 1400);
camera.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6b5a45, 2.4); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 3.6);
sun.castShadow = true; sun.shadow.mapSize.set(4096,4096);
Object.assign(sun.shadow.camera,{left:-64,right:64,top:64,bottom:-64,near:1,far:360});
sun.shadow.bias = -.0004; sun.shadow.normalBias = .05;
scene.add(sun, sun.target);

const atlasTex = new THREE.CanvasTexture(atlas);
atlasTex.colorSpace = THREE.SRGBColorSpace;
atlasTex.magFilter = THREE.NearestFilter; atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
atlasTex.anisotropy = Math.min(IS_TOUCH?4:16, renderer.capabilities.getMaxAnisotropy());
// relief: bump map from atlas luminance
const bumpCv=document.createElement('canvas'); bumpCv.width=bumpCv.height=TS*ATL;
let bumpLevel=-1;
/** relief from atlas luminance; level 1/2 multiplies in a per-tile "pillow" profile so block edges slope away and light bevels them (rounded blocks) */
function buildBump(level){
  if(level===bumpLevel) return; bumpLevel=level;
  const g=bumpCv.getContext('2d',{willReadFrequently:true}), W=TS*ATL, bevel=level===2?.9:level===1?.55:0; g.clearRect(0,0,W,W); g.drawImage(atlas,0,0);
  const im=g.getImageData(0,0,W,W), d=im.data;
  for(let y=0;y<W;y++) for(let x=0;x<W;x++){ const i=(y*W+x)*4, l=d[i]*.3+d[i+1]*.59+d[i+2]*.11; let h=l;
    if(bevel){ const lx=x%TS, ly=y%TS, e=Math.min(lx,TS-1-lx,ly,TS-1-ly), p=Math.min(1,(e+.5)/(TS*.26)), pp=p*p*(3-2*p); h=l*(1-.5*bevel)+255*.5*bevel*pp; }
    d[i]=d[i+1]=d[i+2]=h; d[i+3]=255; }
  g.putImageData(im,0,0); if(bumpReady) bumpTex.needsUpdate=true;
}
let bumpReady=false;
const bumpTex=new THREE.CanvasTexture(bumpCv); bumpTex.anisotropy=atlasTex.anisotropy;
buildBump(cfg.round); bumpReady=true;

// shared uniforms for the voxel shader patch: night amount (boosts block light) and lightning flash
const lightU={uNight:{value:0},uFlash:{value:0}};
// rounded world: the horizon bends away like a small planet (dropped in WORLD space by horizontal distance from the camera, so pitching the camera does not warp it)
// and block faces get a soft rounded-edge shade. Both are uniforms, so changing them never recompiles anything.
const curveU={uCurve:{value:cfg.curve}}, roundU={uRound:{value:cfg.round?(cfg.round===2?1:.6):0}};
const PV_CURVED=THREE.ShaderChunk.project_vertex.replace('mvPosition = modelViewMatrix * mvPosition;','vec4 cwp=modelMatrix*mvPosition; vec3 cdv=cwp.xyz-cameraPosition; cwp.y-=uCurve*dot(cdv.xz,cdv.xz); mvPosition=viewMatrix*cwp;');
function addCurve(sh){ sh.uniforms.uCurve=curveU.uCurve; sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uCurve;').replace('#include <project_vertex>',PV_CURVED); }
THREE.Material.prototype.onBeforeCompile=function(sh){ addCurve(sh); }; // every standard/basic/points/line material (mobs, avatars, clouds, particles, outline...) follows the curve too
function patchVoxelMaterial(mat){
  mat.onBeforeCompile=sh=>{
    sh.uniforms.uNight=lightU.uNight; sh.uniforms.uFlash=lightU.uFlash;
    addCurve(sh); sh.uniforms.uRound=roundU.uRound;
    sh.vertexShader=sh.vertexShader
      .replace('#include <common>','#include <common>\nattribute float blk;\nattribute float sky;\nvarying float vBlk;\nvarying float vSky;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvBlk=blk;vSky=sky;');
    sh.fragmentShader=sh.fragmentShader
      .replace('#include <common>','#include <common>\nvarying float vBlk;\nvarying float vSky;\nuniform float uNight;\nuniform float uFlash;\nuniform float uRound;')
      .replace('#include <map_fragment>','#include <map_fragment>\n{ vec2 rl=fract(vMapUv*'+ATL+'.); float red=min(min(rl.x,1.-rl.x),min(rl.y,1.-rl.y)); diffuseColor.rgb*=mix(1.,.7+.3*smoothstep(0.,.22,red),uRound); }')
      .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*vBlk*vBlk*vec3(1.25,.85,.5)*(.25+uNight*.9)*1.6;')
      .replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.indirectDiffuse*=mix(.22,1.,vSky);\nreflectedLight.directDiffuse*=mix(.12,1.,vSky*vSky);\nreflectedLight.indirectDiffuse+=diffuseColor.rgb*uFlash*vSky*.5;');
  };
  mat.customProgramCacheKey=()=>'voxel';
  return mat;
}
const matO = patchVoxelMaterial(new THREE.MeshStandardMaterial({map:atlasTex, bumpMap:bumpTex, bumpScale:1.2, roughness:.94, metalness:0, vertexColors:true, alphaTest:.5}));
const waterU={uTime:{value:0}};
function patchWater(mat){
  const base=mat.onBeforeCompile;
  mat.onBeforeCompile=sh=>{
    base(sh); sh.uniforms.uTime=waterU.uTime;
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\n{ vec3 wp=(modelMatrix*vec4(position,1.)).xyz; float top=step(.5,objectNormal.y); transformed.y+=top*(sin(wp.x*1.7+uTime*1.6)+sin(wp.z*2.1+uTime*1.3)+sin((wp.x+wp.z)*.9+uTime*.8))*.03-top*.07; }');
    sh.fragmentShader=sh.fragmentShader
      .replace('#include <opaque_fragment>','{ float fres=pow(1.-clamp(abs(dot(normalize(vNormal),normalize(vViewPosition))),0.,1.),3.); outgoingLight+=vec3(.22,.38,.5)*fres*(.35+.65*vSky); }\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey=()=>'voxel-water';
  return mat;
}
const matT = patchVoxelMaterial(new THREE.MeshStandardMaterial({map:atlasTex, roughness:.08, metalness:.1, vertexColors:true, transparent:true, depthWrite:false}));
const matW = patchWater(patchVoxelMaterial(new THREE.MeshStandardMaterial({map:atlasTex, roughness:.04, metalness:.25, vertexColors:true, transparent:true, depthWrite:false})));

// post-processing (HDR bloom + tone mapping), created lazily
let composer=null, bloomPass=null, gtaoPass=null, cinePass=null;
function ensureComposer(){
  if(composer) return;
  const w=innerWidth,h=innerHeight, pr=renderer.getPixelRatio();
  const rt=new THREE.WebGLRenderTarget(w*pr,h*pr,{type:THREE.HalfFloatType,samples:4});
  composer=new EffectComposer(renderer,rt); composer.setPixelRatio(pr); composer.setSize(w,h);
  composer.addPass(new RenderPass(scene,camera));
  gtaoPass=new GTAOPass(scene,camera,w,h); gtaoPass.blendIntensity=.85; // screen-space ambient occlusion: contact shadows in corners, under overhangs and around blocks
  gtaoPass.updateGtaoMaterial({radius:.55,distanceExponent:1.2,thickness:1.2,scale:1.1,samples:10}); gtaoPass.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:4,rings:2,samples:8});
  gtaoPass.enabled=!!cfg.ao; composer.addPass(gtaoPass);
  bloomPass=new UnrealBloomPass(new THREE.Vector2(w,h),.26,.45,.97); bloomPass.enabled=!!cfg.bloom; composer.addPass(bloomPass);
  // cinematic finishing pass (GPU heavy, opt-in): light shafts toward the sun, chromatic fringing, colour grade, soft film grain
  cinePass=new ShaderPass({ uniforms:{tDiffuse:{value:null},sun:{value:new THREE.Vector2(.5,.8)},shaft:{value:0},aber:{value:.0016},time:{value:0},aspect:{value:1}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform sampler2D tDiffuse;uniform vec2 sun;uniform float shaft;uniform float aber;uniform float time;uniform float aspect;varying vec2 vUv;
      float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){
        vec2 d=vUv-vec2(.5);float r2=dot(d*vec2(aspect,1.),d*vec2(aspect,1.));
        vec3 c=vec3(texture2D(tDiffuse,vUv+d*aber*(1.+r2*4.)).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-d*aber*(1.+r2*4.)).b);
        if(shaft>0.001){ vec2 dir=(sun-vUv)/28.;vec2 uv=vUv;float w=1.;vec3 acc=vec3(0.);
          for(int i=0;i<28;i++){uv+=dir;vec3 s=texture2D(tDiffuse,uv).rgb;float l=dot(s,vec3(.3,.55,.15));acc+=s*smoothstep(.9,2.2,l)*w;w*=.955;}
          float fall=clamp(1.-length((vUv-sun)*vec2(aspect,1.))*.9,0.,1.);c+=acc/28.*shaft*(.25+fall)*vec3(1.,.9,.7);}
        c=mix(vec3(dot(c,vec3(.3,.59,.11))),c,1.12);c=(c-.5)*1.05+.5+vec3(.012,.004,-.01);c*=1.-r2*.35;c+=(hash(vUv*1280.+time)-.5)*.012;
        gl_FragColor=vec4(max(c,0.),1.);}` });
  cinePass.enabled=!!cfg.cine; composer.addPass(cinePass);
  composer.addPass(new OutputPass());
}



// gradient sky dome
const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,
  uniforms:{top:{value:new THREE.Color(0x3a8ee6)},bot:{value:new THREE.Color(0x87c7f5)},sd:{value:new THREE.Vector3(0,1,0)},sk:{value:1}},
  vertexShader:'varying float h;varying vec3 v;void main(){v=position;h=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:'uniform vec3 top;uniform vec3 bot;uniform vec3 sd;uniform float sk;varying float h;varying vec3 v;void main(){float t=pow(clamp(h,0.,1.),.5);vec3 c=mix(bot,top,t);float s=max(dot(normalize(v),sd),0.);c+=vec3(1.,.78,.45)*(pow(s,300.)*2.+pow(s,24.)*.35+pow(s,4.)*.12)*sk;float hz=exp(-abs(h)*7.);c=mix(c,bot*1.08,hz*.5);gl_FragColor=vec4(c,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
const skyDome=new THREE.Mesh(new THREE.SphereGeometry(1000,32,16),skyMat); skyDome.renderOrder=-10; skyDome.frustumCulled=false; scene.add(skyDome);
// sky bodies
function glowTex(inner,outer){
  const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d');
  const gr=g.createRadialGradient(64,64,0,64,64,64); gr.addColorStop(0,inner); gr.addColorStop(.35,inner); gr.addColorStop(.37,outer); gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=gr; g.fillRect(0,0,128,128); const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
}
const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex('#fffbe0','rgba(255,220,140,.35)'),fog:false,depthWrite:false,transparent:true}));
const moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex('#e8eeff','rgba(170,190,255,.22)'),fog:false,depthWrite:false,transparent:true}));
sunSpr.scale.setScalar(240); moonSpr.scale.setScalar(150); scene.add(sunSpr, moonSpr);
const starGeo = new THREE.BufferGeometry(), sp=[];
for(let i=0;i<1400;i++){ const u=Math.random()*2-1, a=Math.random()*6.283, r=Math.sqrt(1-u*u); sp.push(r*Math.cos(a)*1000,u*1000,r*Math.sin(a)*1000); }
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp,3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({color:0xffffff,size:1.8,sizeAttenuation:false,fog:false,transparent:true,depthWrite:false}));
stars.frustumCulled=false; scene.add(stars);

// clouds
const cloudCv=document.createElement('canvas'); cloudCv.width=cloudCv.height=256;
{ const g=cloudCv.getContext('2d'), im=g.createImageData(256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    let s=0,a=1,t=0,f=1; for(let i=0;i<4;i++){ // tileable fbm
      const n=8*f, gx=x/256*n, gy=y/256*n, ix=Math.floor(gx), iy=Math.floor(gy), fx=fade(gx-ix), fy=fade(gy-iy);
      const h=(p,q)=>hash3(((p%n)+n)%n,((q%n)+n)%n,i,99);
      s+=a*lerp(lerp(h(ix,iy),h(ix+1,iy),fx),lerp(h(ix,iy+1),h(ix+1,iy+1),fx),fy); t+=a; a*=.5; f*=2; }
    const al=smooth(.52,.68,s/t); const i=(y*256+x)*4; im.data[i]=im.data[i+1]=im.data[i+2]=255; im.data[i+3]=al*235;
  } g.putImageData(im,0,0); }
const cloudTex=new THREE.CanvasTexture(cloudCv); cloudTex.wrapS=cloudTex.wrapT=THREE.RepeatWrapping; cloudTex.repeat.set(5,5);
const cloudMat=new THREE.MeshBasicMaterial({map:cloudTex,transparent:true,depthWrite:false,opacity:.9});
const clouds=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800).rotateX(-Math.PI/2), cloudMat); clouds.position.y=115; clouds.renderOrder=2; scene.add(clouds);

// block outline
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004,1.004,1.004)), new THREE.LineBasicMaterial({color:0x000000,transparent:true,opacity:.7}));
outline.visible=false; scene.add(outline);

/* ============================ particles ============================ */
const fx=new Particles(scene);
function addParticle(x,y,z,col){ fx.debris(x,y,z,col,1); }
function updateParticles(dt){ fx.update(dt,innerHeight*renderer.getPixelRatio(),camera.fov); }
function burst(x,y,z,id){ fx.debris(x+.5,y+.5,z+.5,BLOCK_COLOR[id],14); fx.dust(x+.5,y+.2,z+.5,5,BLOCK_COLOR[id]); }
let landFx=0, wasInWater=false;
function scanLamps(c){ const L=[]; const d=c.data; let i=-1; while((i=d.indexOf(28,i+1))!==-1) L.push([c.cx*16+(i&15), i>>8, c.cz*16+((i>>4)&15)]); c.lamps=L; }
function ambientFx(dt){
  if(!P.ready||!started) return;
  if(landFx>0){ fx.dust(P.x,P.y+.05,P.z,Math.min(16,(landFx*1.4)|0),0xb8a98c); landFx=0; }
  const wnow=isWater(getB(Math.floor(P.x),Math.floor(P.y+.2),Math.floor(P.z))); if(wnow!==wasInWater){ wasInWater=wnow; fx.splash(P.x,P.y+(wnow?.4:1),P.z,18); audio.splash(); }
  if(P.onGround&&!P.fly&&keys.KeyW&&(keys.ShiftLeft||keys.ShiftRight)&&(frame%5===0)) fx.dust(P.x,P.y+.05,P.z,2,0xb8a98c);
  if(wx.k>.12&&!underwater&&(frame&1)===0){ const a=Math.random()*6.283,d=2+Math.random()*13, x=P.x+Math.cos(a)*d, z=P.z+Math.sin(a)*d; let y=Math.floor(P.y+10); while(y>0&&!getB(Math.floor(x),y,Math.floor(z))) y--; fx.rainSplash(x,y+1,z); }
  if((frame%4)===0){ const pcx=Math.floor(P.x/CS), pcz=Math.floor(P.z/CS); for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){ const c=chunks.get(ck(pcx+a,pcz+b)); if(c&&c.lamps&&c.lamps.length){ const L=c.lamps[Math.random()*c.lamps.length|0]; if(Math.hypot(L[0]-P.x,L[2]-P.z)<18&&Math.random()<.5) fx.ember(L[0]+.2+Math.random()*.6,L[1]+1,L[2]+.2+Math.random()*.6); } } }
}

/* ---- ambient life + motion feel: fireflies at night, drifting pollen by day, sprint FOV kick and dust trail ---- */
const AMB_N=IS_TOUCH?70:150, ambPos=new Float32Array(AMB_N*3), ambCol=new Float32Array(AMB_N*3), ambPh=new Float32Array(AMB_N*2), ambGeo=new THREE.BufferGeometry();
for(let i=0;i<AMB_N;i++){ ambPos[i*3]=(Math.random()-.5)*36; ambPos[i*3+1]=Math.random()*7-1; ambPos[i*3+2]=(Math.random()-.5)*36; ambPh[i*2]=Math.random()*6.283; ambPh[i*2+1]=.4+Math.random()*1.2; }
ambGeo.setAttribute('position',new THREE.BufferAttribute(ambPos,3)); ambGeo.setAttribute('color',new THREE.BufferAttribute(ambCol,3));
const ambMat=new THREE.PointsMaterial({map:glowTex('#ffffff','rgba(255,255,255,.5)'),size:.34,sizeAttenuation:true,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:true});
const ambient=new THREE.Points(ambGeo,ambMat); ambient.frustumCulled=false; ambient.visible=false; scene.add(ambient);
let fovK=0, dustT=0, ambInit=false;
function lifeFx(dt,t){
  const elev=Math.sin((worldTime-.25)*Math.PI*2), night=THREE.MathUtils.clamp(-elev*3+.3,0,1), day=THREE.MathUtils.clamp(elev*2,0,1)*(1-wx.k);
  const on=started&&!underwater&&wx.k<.35&&(night>.05||day>.05)&&!document.body.classList.contains('nohud'); ambient.visible=on;
  if(started){ // sprint FOV kick + dust trail
    const hs=Math.hypot(P.vx,P.vz), want=(!P.fly&&hs>6.3)?Math.min(9,(hs-6)*3.2):0; fovK+=(want-fovK)*Math.min(1,dt*6);
    const f=cfg.fov+fovK; if(Math.abs(camera.fov-f)>.05){ camera.fov=f; camera.updateProjectionMatrix(); }
    dustT-=dt; if(dustT<=0&&P.onGround&&!P.fly&&hs>6.3){ dustT=.14; fx.dust(P.x,P.y+.03,P.z,2); }
  }
  if(!on) return;
  const px=P.x, py=P.y, pz=P.z, firefly=night>day;
  if(!ambInit){ ambInit=true; for(let i=0;i<AMB_N;i++){ ambPos[i*3]+=px; ambPos[i*3+1]+=py; ambPos[i*3+2]+=pz; } }
  ambMat.size=firefly?.46:.24;
  for(let i=0;i<AMB_N;i++){
    const o=i*3, ph=ambPh[i*2], sp=ambPh[i*2+1];
    ambPos[o]+=Math.sin(t*sp+ph)*dt*.5; ambPos[o+1]+=Math.cos(t*sp*.7+ph*2)*dt*(firefly?.35:.2)+(firefly?0:.05*dt); ambPos[o+2]+=Math.cos(t*sp+ph*1.3)*dt*.5;
    for(let a=0;a<3;a+=2){ const lim=18, d=ambPos[o+a]-(a===0?px:pz); if(d>lim) ambPos[o+a]-=lim*2; else if(d<-lim) ambPos[o+a]+=lim*2; } // wrap around the player so the swarm follows without popping
    const dy=ambPos[o+1]-py; if(dy>7) ambPos[o+1]-=8; else if(dy<-1.5) ambPos[o+1]+=8;
    const blink=firefly?Math.max(0,Math.sin(t*sp*2.1+ph*3))**3:.55+.45*Math.sin(t*sp+ph), k=(firefly?night:day*.5)*blink;
    if(firefly){ ambCol[o]=.62*k; ambCol[o+1]=k; ambCol[o+2]=.25*k; } else { ambCol[o]=k; ambCol[o+1]=.95*k; ambCol[o+2]=.75*k; }
  }
  ambGeo.attributes.position.needsUpdate=true; ambGeo.attributes.color.needsUpdate=true;
}
/* ============================ weather: rain, storms, lightning ============================ */
const wx={type:'clear',k:0,target:0,flash:0,thunderT:6,timer:90};
const RAIN_N=3000, rainGeo=new THREE.BufferGeometry();
{ const p=new Float32Array(RAIN_N*6), sg=new Float32Array(RAIN_N*2);
  for(let i=0;i<RAIN_N;i++){ const x=Math.random()*40,y=Math.random()*30,z=Math.random()*40; p.set([x,y,z,x,y,z],i*6); sg[i*2]=0; sg[i*2+1]=1; }
  rainGeo.setAttribute('position',new THREE.BufferAttribute(p,3)); rainGeo.setAttribute('seg',new THREE.BufferAttribute(sg,1)); }
const rainMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:false,uniforms:{uT:{value:0},uK:{value:0},uCam:{value:new THREE.Vector3()},uCol:{value:new THREE.Color(.75,.82,.95)}},
  vertexShader:'attribute float seg;uniform float uT;uniform vec3 uCam;varying float vA;void main(){vec3 p=position;float y=mod(p.y-uT*24.,30.);p.x=mod(p.x-uCam.x,40.)-20.+uCam.x;p.z=mod(p.z-uCam.z,40.)-20.+uCam.z;p.y=uCam.y-14.+y+seg*.9;vA=1.-length(p.xz-uCam.xz)/22.;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
  fragmentShader:'uniform float uK;uniform vec3 uCol;varying float vA;void main(){gl_FragColor=vec4(uCol,clamp(vA,0.,1.)*uK*.38);}'});
const rain=new THREE.LineSegments(rainGeo,rainMat); rain.frustumCulled=false; rain.visible=false; rain.renderOrder=3; scene.add(rain);
function setWeather(type,snap){
  if(!{clear:1,rain:1,storm:1}[type]) type='clear';
  if(wx.type!==type&&!snap&&started) showToast({clear:'The weather clears up',rain:'It starts to rain',storm:'A storm is rolling in!'}[type]);
  wx.type=type; wx.target={clear:0,rain:.7,storm:1}[type]; if(snap) wx.k=wx.target;
}
const thunder=()=>audio.thunder();

/* ---- audio environment: what the engine needs to know (throttled to 5 Hz) ---- */
let audT=0, audCave=0, audWater=0;
function feedAudio(dt){
  audT-=dt; if(audT>0) return; audT=.2;
  if(!P.ready||!started){ audio.update({started:false,k:0,under:false,water:0,cave:0,night:0,day:1,alt:0,speed:0,lobby:false,combat:false,quiet:false}); return; }
  const px=Math.floor(P.x), pz=Math.floor(P.z); let blocked=false; for(let y=Math.floor(P.y+2),top=Math.min(CH,y+30);y<top;y++){ const id=getB(px,y,pz); if(id&&!isWater(id)&&id!==B.LEAVES){ blocked=true; break; } }
  let near=0; for(let a=0;a<8;a++){ const dx=Math.round(Math.cos(a*.785)*4), dz=Math.round(Math.sin(a*.785)*4); if(isWater(getB(px+dx,Math.floor(P.y)-1,pz+dz))||isWater(getB(px+dx,Math.floor(P.y),pz+dz))) near++; }
  const elev=Math.sin((worldTime-.25)*Math.PI*2), night=THREE.MathUtils.clamp(-elev*3+.3,0,1), day=THREE.MathUtils.clamp(elev*2,0,1);
  const playing=inArena()&&arena.pvp()&&arena.st&&arena.st.mg&&arena.st.mg.state==='play';
  audio.update({started:true,k:wx.k,storm:wx.type==='storm',under:underwater,water:Math.min(1,near/4),cave:blocked?1:0,night,day,alt:P.y,speed:Math.hypot(P.vx,P.vz),lobby:MODE==='lobby',combat:!!playing,quiet:paused||menu.style.display!=='none'});
}
function updateWeather(dt){
  if(!mp){
    if(cfg.weather&&GEN.weather!==false&&started){ wx.timer-=dt; if(wx.timer<=0){ wx.timer=90+Math.random()*180; const r=Math.random(); setWeather(r<.6?'clear':r<.9?'rain':'storm'); } }
    else if((!cfg.weather||GEN.weather===false)&&wx.type!=='clear') setWeather('clear');
  }
  wx.k+=(wx.target-wx.k)*Math.min(1,dt*.4); if(Math.abs(wx.k-(updateWeather.fk??-1))>.01){ updateWeather.fk=wx.k; applyFog(); }
  const show=wx.k>.03&&!underwater; rain.visible=show; rainMat.uniforms.uT.value+=dt; rainMat.uniforms.uK.value=wx.k; rainMat.uniforms.uCam.value.copy(camera.position);
  if(wx.type==='storm'&&started){ wx.thunderT-=dt; if(wx.thunderT<=0){ wx.thunderT=6+Math.random()*14; wx.flash=1; setTimeout(thunder,300+Math.random()*1500); } }
  wx.flash=Math.max(0,wx.flash-dt*3.2); lightU.uFlash.value=wx.flash>.6?wx.flash:wx.flash*.5;
}

/* ============================ minimap ============================ */
const mmCv=document.getElementById('minimap'), mmCtx=mmCv.getContext('2d'), MM=mmCv.width;
const mmImg=mmCtx.createImageData(MM,MM); let mmT=0, mmZoom=1;
const BC=[0,...Array.from({length:40},(_,i)=>BLOCK_COLOR[i+1]||0)];
let mmTerr=0, mmLastZoom=0;
function drawMinimap(dt){
  mmT-=dt; if(mmT>0) return; mmT=.1; mmTerr-=.1;
  mmCv.style.display=cfg.minimap&&started&&!document.body.classList.contains('nohud')?'block':'none'; if(mmCv.style.display==='none') return;
  const half=MM/2/mmZoom*.5, px=Math.floor(P.x), pz=Math.floor(P.z), d=mmImg.data; // 1 pixel = 1/mmZoom*... blocks
  const scale=2/mmZoom; // blocks per pixel
  let lcx=1e9, lcz=1e9, lc=null, lt=null;
  if(mmTerr<=0||mmLastZoom!==mmZoom){ mmTerr=.5; mmLastZoom=mmZoom; // terrain scan is the costly part; arrow and dots below refresh 5x faster
  for(let j=0;j<MM;j++) for(let i=0;i<MM;i++){
    const wx_=Math.floor(P.x+(i-MM/2)*scale), wz_=Math.floor(P.z+(j-MM/2)*scale), o=(j*MM+i)*4, ccx=wx_>>4, ccz=wz_>>4;
    if(ccx!==lcx||ccz!==lcz){ lcx=ccx; lcz=ccz; lc=chunks.get(ck(ccx,ccz)); lt=lc?chunkTop(lc):null; }
    const c=lc; if(!c){ d[o]=14;d[o+1]=18;d[o+2]=26;d[o+3]=255; continue; }
    const t=lt, li=(wx_&15)+16*(wz_&15), id=t.id[li], h=t.h[li], col=BC[id]||0, sh=.62+Math.min(.5,(h-SEA+6)*.02);
    d[o]=((col>>16)&255)*sh; d[o+1]=((col>>8)&255)*sh; d[o+2]=(col&255)*sh; d[o+3]=255;
  }
  }
  mmCtx.putImageData(mmImg,0,0);
  const dot=(x,z,col,r)=>{ const mx=MM/2+(x-P.x)/scale, mz=MM/2+(z-P.z)/scale; if(mx<2||mz<2||mx>MM-2||mz>MM-2) return; mmCtx.fillStyle=col; mmCtx.beginPath(); mmCtx.arc(mx,mz,r,0,6.283); mmCtx.fill(); };
  for(const v of mobViews.values()) dot(v.x,v.z,v.type==='boss'?'#ff2dff':v.type==='zombie'?'#ff5a5a':v.type==='pig'?'#ffb3c7':'#ffd27a',v.type==='boss'?4:2);
  for(const o of others.values()) dot(o.x,o.z,'#fff',3);
  mmCtx.save(); mmCtx.translate(MM/2,MM/2); mmCtx.rotate(-P.yaw); mmCtx.fillStyle='#6ee7a8'; mmCtx.strokeStyle='#000'; mmCtx.beginPath(); mmCtx.moveTo(0,-6); mmCtx.lineTo(4.5,5); mmCtx.lineTo(0,2.5); mmCtx.lineTo(-4.5,5); mmCtx.closePath(); mmCtx.fill(); mmCtx.stroke(); mmCtx.restore();
}

/* ---- full-screen map: tap the minimap (or press M). Remembers explored terrain beyond render distance. ---- */
const mapMem=new Map(); // "cx,cz" -> {id,h} top-down snapshot of chunks that were unloaded
const bigMap=(()=>{
  const wrap=document.createElement('div'); wrap.id='bigmap'; wrap.style.cssText='position:fixed;inset:0;z-index:60;display:none;place-items:center;background:rgba(4,7,12,.88);backdrop-filter:blur(6px);touch-action:none';
  wrap.innerHTML='<div id="bmbox" style="position:relative"><canvas id="bmcv" style="display:block;border-radius:18px;border:2px solid rgba(255,255,255,.25);image-rendering:pixelated;box-shadow:0 12px 40px rgba(0,0,0,.6)"></canvas>'
    +'<div id="bmbar" style="position:absolute;left:10px;right:10px;top:10px;display:flex;gap:8px;align-items:center;pointer-events:none;font:700 13px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000"><span id="bmpos" style="background:#0009;padding:6px 10px;border-radius:10px"></span><span style="flex:1"></span>'
    +'<button id="bmout" style="pointer-events:auto;width:40px;height:40px;border-radius:12px;border:1px solid #fff4;background:#000a;color:#fff;font:700 22px system-ui">&minus;</button><button id="bmin" style="pointer-events:auto;width:40px;height:40px;border-radius:12px;border:1px solid #fff4;background:#000a;color:#fff;font:700 22px system-ui">+</button><button id="bmx" style="pointer-events:auto;width:40px;height:40px;border-radius:12px;border:1px solid #fff4;background:#000a;color:#fff;font:700 20px system-ui">&times;</button></div>'
    +'<div style="position:absolute;left:10px;bottom:10px;font:600 11px system-ui,sans-serif;color:#fffc;text-shadow:0 1px 3px #000;pointer-events:none">Explored areas stay on the map &middot; M or &times; to close</div></div>';
  document.body.append(wrap);
  const cv=wrap.querySelector('#bmcv'), g=cv.getContext('2d'), posEl=wrap.querySelector('#bmpos'); let open=false, zoom=1, N=0, img=null, t=0;
  const LV=[.5,1,2,4]; // blocks per pixel
  const size=()=>{ const S=Math.max(220,Math.min(innerWidth-20,innerHeight-20,760)); const n=Math.min(380,Math.round(S/2)*2/ (S>420?2:1)); N=Math.max(160,n); cv.width=N; cv.height=N; cv.style.width=cv.style.height=S+'px'; img=g.createImageData(N,N); };
  function draw(){
    const sc=LV[zoom], d=img.data; let lcx=1e9,lcz=1e9,top=null;
    for(let j=0;j<N;j++) for(let i=0;i<N;i++){
      const wx_=Math.floor(P.x+(i-N/2)*sc), wz_=Math.floor(P.z+(j-N/2)*sc), o=(j*N+i)*4, ccx=wx_>>4, ccz=wz_>>4;
      if(ccx!==lcx||ccz!==lcz){ lcx=ccx; lcz=ccz; const c=chunks.get(ck(ccx,ccz)); top=c?chunkTop(c):(mapMem.get(ck(ccx,ccz))||null); }
      if(!top){ d[o]=14;d[o+1]=18;d[o+2]=26;d[o+3]=255; continue; }
      const li=(wx_&15)+16*(wz_&15), col=BC[top.id[li]]||0, sh=.62+Math.min(.5,(top.h[li]-SEA+6)*.02);
      d[o]=((col>>16)&255)*sh; d[o+1]=((col>>8)&255)*sh; d[o+2]=(col&255)*sh; d[o+3]=255;
    }
    g.putImageData(img,0,0);
    const dot=(x,z,col,r)=>{ const mx=N/2+(x-P.x)/sc, mz=N/2+(z-P.z)/sc; if(mx<3||mz<3||mx>N-3||mz>N-3) return; g.fillStyle=col; g.strokeStyle='#000'; g.lineWidth=1; g.beginPath(); g.arc(mx,mz,r,0,6.283); g.fill(); g.stroke(); };
    for(const v of mobViews.values()) dot(v.x,v.z,v.type==='boss'?'#ff2dff':v.type==='zombie'?'#ff5a5a':v.type==='pig'?'#ffb3c7':'#ffd27a',v.type==='boss'?5:2.5);
    for(const o of others.values()) dot(o.x,o.z,'#fff',4);
    g.save(); g.translate(N/2,N/2); g.rotate(-P.yaw); g.fillStyle='#6ee7a8'; g.strokeStyle='#000'; g.lineWidth=1.2; g.beginPath(); g.moveTo(0,-8); g.lineTo(6,7); g.lineTo(0,3.5); g.lineTo(-6,7); g.closePath(); g.fill(); g.stroke(); g.restore();
    posEl.textContent='X '+Math.floor(P.x)+'  Z '+Math.floor(P.z)+'  ·  '+(LV[zoom]<1?'zoom 2x':LV[zoom]===1?'zoom 1x':'1/'+LV[zoom]+' scale');
  }
  const show=v=>{ open=v; wrap.style.display=v?'grid':'none'; if(v){ size(); draw(); t=0; if(document.pointerLockElement) document.exitPointerLock&&document.exitPointerLock(); } };
  const setZ=dz=>{ zoom=Math.max(0,Math.min(LV.length-1,zoom+dz)); if(open) draw(); };
  wrap.querySelector('#bmx').onclick=()=>show(false); wrap.querySelector('#bmin').onclick=()=>setZ(-1); wrap.querySelector('#bmout').onclick=()=>setZ(1);
  wrap.addEventListener('pointerdown',e=>{ if(e.target===wrap) show(false); });
  wrap.addEventListener('wheel',e=>{ e.preventDefault(); setZ(e.deltaY>0?1:-1); },{passive:false});
  addEventListener('resize',()=>{ if(open){ size(); draw(); } });
  addEventListener('keydown',e=>{ if(e.code==='KeyM'&&started&&!chatOpen&&!modalOpen&&!e.repeat&&!/INPUT|TEXTAREA/.test((document.activeElement||{}).tagName||'')){ show(!open); e.preventDefault(); } else if(e.code==='Escape'&&open) show(false); });
  mmCv.style.pointerEvents='auto'; mmCv.style.cursor='zoom-in'; mmCv.addEventListener('pointerdown',e=>{ e.preventDefault(); e.stopPropagation(); show(true); });
  return { tick(dt){ if(!open) return; t-=dt; if(t<=0){ t=.5; draw(); } }, get open(){ return open; }, show };
})();


/* ============================ world: chunk streaming (web worker) ============================ */
const chunks = new Map();            // "cx,cz" -> {cx,cz,data,maxY,meshes[],meshed,ver,top}
const ck=(cx,cz)=>cx+','+cz;
const genReq=new Set(), meshReq=new Set();
let lastChunk=null, worker=null, epoch=0;
function getB(x,y,z){
  if(y<0) return STONE; if(y>=CH) return AIR;
  const cx=x>>4, cz=z>>4; let c=lastChunk;
  if(!c||c.cx!==cx||c.cz!==cz){ c=chunks.get(cx+','+cz); if(!c) return AIR; lastChunk=c; }
  return c.data[(x&15)+16*((z&15)+16*y)];
}
const hasChunk=(cx,cz)=>chunks.has(ck(cx,cz));
function startWorker(){
  if(worker) worker.terminate();
  epoch++; genReq.clear(); meshReq.clear();
  worker=new Worker(new URL('./chunkWorker.js', import.meta.url),{type:'module'});
  worker.onmessage=onWorkerMsg; worker.postMessage({t:'init',seed:SEED,gen:GEN,epoch});
}
function onWorkerMsg(e){
  const m=e.data; if(m.epoch!==epoch) return;
  if(m.t==='gen'){ streamDirty=true; const k=ck(m.cx,m.cz); genReq.delete(k); if(chunks.has(k)) return; const nc={cx:m.cx,cz:m.cz,data:m.data,maxY:m.maxY,meshes:[],meshed:false,ver:0,top:null,lamps:[]};
    { const ed=edits[k]; if(ed) for(const i in ed){ nc.data[i]=ed[i]; const y=(i|0)>>8; if(y+2>nc.maxY) nc.maxY=Math.min(CH-1,y+2); } } // edits that arrived while this chunk was generating (arenas/lobby are built right after join)
    scanLamps(nc); chunks.set(k,nc); }
  else if(m.t==='mesh'){ streamDirty=true; const k=ck(m.cx,m.cz), c=chunks.get(k); meshReq.delete(k); if(c&&c.ver===m.ver){ applyMesh(c,m.mesh); c.meshed=true; } }
}
const SPHERE=new THREE.Sphere(new THREE.Vector3(8,40,8),48);
function geoFrom(g){
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(g.pos,3)); geo.setAttribute('normal',new THREE.BufferAttribute(g.nrm,3));
  geo.setAttribute('uv',new THREE.BufferAttribute(g.uv,2)); geo.setAttribute('color',new THREE.BufferAttribute(g.col,3));
  geo.setAttribute('blk',new THREE.BufferAttribute(g.blk,1)); geo.setAttribute('sky',new THREE.BufferAttribute(g.sky,1));
  geo.setIndex(new THREE.BufferAttribute(g.idx,1)); geo.boundingSphere=SPHERE; return geo;
}
function disposeMeshes(c){ for(const m of c.meshes){ scene.remove(m); m.geometry.dispose(); } c.meshes=[]; }
function applyMesh(c,mesh){
  disposeMeshes(c);
  for(const [g,mat,tr] of [[mesh.O,matO,false],[mesh.T,matT,true],[mesh.W,matW,true]]){
    if(!g) continue;
    const m=new THREE.Mesh(geoFrom(g),mat); m.position.set(c.cx*CS,0,c.cz*CS);
    m.castShadow=!tr; m.receiveShadow=true; if(tr) m.renderOrder=1; m.matrixAutoUpdate=false; m.updateMatrix();
    scene.add(m); c.meshes.push(m);
  }
  shadowDirty=true;
}
function neighborData(cx,cz,copy){
  const nb=[]; for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++){ const c=chunks.get(ck(cx+dx,cz+dz)); nb.push(c?(copy?c.data.slice():c.data):null); }
  return nb;
}
function remeshNow(c){ c.ver++; meshReq.delete(ck(c.cx,c.cz)); applyMesh(c,meshData(neighborData(c.cx,c.cz,false),c.maxY)); c.meshed=true; c.top=null; }
let shadowDirty=true;
const offlineFluid=new Fluid((x,y,z)=>getB(x,y,z),(x,y,z,id)=>setBlock(x,y,z,id)); let fluidAcc=0;
let deferMesh=false; const remeshQ=new Set(); // remeshes for network/fluid changes are queued and time-budgeted so a flowing lake can't stall a frame
function processRemesh(){ if(!remeshQ.size) return; const t0=performance.now(); for(const c of remeshQ){ remeshQ.delete(c); if(c.meshed&&chunks.get(ck(c.cx,c.cz))===c) remeshNow(c); if(performance.now()-t0>4) break; } }
function stepFluid(dt){ if(ws&&ws.readyState===1) return; fluidAcc+=dt; if(fluidAcc>=.2){ fluidAcc=0; if(offlineFluid.active.size){ deferMesh=true; try{ offlineFluid.step(120); }finally{ deferMesh=false; } } } }
function setBlock(x,y,z,id,fromNet){
  if(y<0||y>=CH) return;
  if(!ws||ws.readyState!==1) offlineFluid.poke(x,y,z);
  const cx=x>>4, cz=z>>4, c=chunks.get(ck(cx,cz));
  if(ws&&ws.readyState===1&&!fromNet) ws.send(JSON.stringify({t:'block',x,y,z,id}));
  const idx=(x&15)+16*((z&15)+16*y);
  if(!c){ if(fromNet) (edits[ck(cx,cz)] ??= {})[idx]=id; return; }
  const prevId=c.data[idx]; c.data[idx]=id; c.maxY=Math.max(c.maxY,y+2); if(prevId===28||id===28) scanLamps(c);
  (edits[ck(cx,cz)] ??= {})[idx]=id; saveDirty=true; dirtyChunks.add(ck(cx,cz));
  const re=new Set([c]); const lx=x&15, lz=z&15;
  if(lx===0)re.add(chunks.get(ck(cx-1,cz))); if(lx===15)re.add(chunks.get(ck(cx+1,cz)));
  if(lz===0)re.add(chunks.get(ck(cx,cz-1))); if(lz===15)re.add(chunks.get(ck(cx,cz+1)));
  // light/skylight spread a few blocks: remesh diagonal neighbours too when an emitter changes
  for(const r of re) if(r){ if(r===c&&r.meshed){ if(fromNet||deferMesh) remeshQ.add(r); else{ remeshQ.delete(r); remeshNow(r); } } else { r.ver++; meshReq.delete(ck(r.cx,r.cz)); r.meshed=false; streamDirty=true; } } // neighbours rebuild in the worker; their old mesh stays until the new one arrives
}
function resetWorld(seed,gen,newEdits){
  mapMem.clear();
  for(const c of chunks.values()) disposeMeshes(c);
  chunks.clear(); lastChunk=null; streamDirty=true; SEED=seed; GEN=gen; wg=createWorldGen(SEED,GEN);
  for(const k in edits) delete edits[k]; if(newEdits) for(const k in newEdits) edits[k]=newEdits[k];
  startWorker();
}

let RD = 7, spiral = [];
function buildSpiral(){ streamDirty=true; spiral=[]; const R=RD+1; for(let dz=-R;dz<=R;dz++)for(let dx=-R;dx<=R;dx++){ const d=Math.hypot(dx,dz); if(d<=R+.5) spiral.push([dx,dz,d]); } spiral.sort((a,b)=>a[2]-b[2]); }
let lastPcx=1e9, lastPcz=1e9, streamDirty=true;
function updateChunks(fast){
  const pcx=Math.floor(P.x/CS), pcz=Math.floor(P.z/CS);
  if(!fast&&!streamDirty&&pcx===lastPcx&&pcz===lastPcz&&genReq.size===0&&meshReq.size===0&&(frame&31)!==0) return; // nothing to do: skip the whole scan
  lastPcx=pcx; lastPcz=pcz; streamDirty=false;
  // 1) generation requests (nearest first)
  let want=[]; const maxOut=fast?64:24;
  for(const [dx,dz] of spiral){ if(genReq.size+want.length>=maxOut) break; const x=pcx+dx, z=pcz+dz, k=ck(x,z); if(!chunks.has(k)&&!genReq.has(k)){ want.push([x,z,edits[k]||null]); genReq.add(k); } }
  if(want.length) worker.postMessage({t:'gen',list:want,epoch});
  // 2) mesh requests once the 3x3 neighbourhood exists
  let budget=fast?8:2;
  for(const [dx,dz,d] of spiral){
    if(budget<=0||meshReq.size>=(fast?12:4)) break; if(d>RD+.5) continue;
    const k=ck(pcx+dx,pcz+dz), c=chunks.get(k); if(!c||c.meshed||meshReq.has(k)) continue;
    let ok=true; for(let a=-1;a<=1&&ok;a++)for(let b=-1;b<=1;b++) if(!chunks.has(ck(c.cx+a,c.cz+b))){ok=false;break;}
    if(!ok) continue;
    const nbrs=neighborData(c.cx,c.cz,true); worker.postMessage({t:'mesh',cx:c.cx,cz:c.cz,ver:c.ver,nbrs,maxY:c.maxY,epoch},nbrs.filter(Boolean).map(a=>a.buffer));
    meshReq.add(k); budget--;
  }
  // 3) unload far chunks
  if((frame&31)===0) for(const [k,c] of chunks) if(Math.max(Math.abs(c.cx-pcx),Math.abs(c.cz-pcz))>RD+3){ mapMem.set(k,chunkTop(c)); if(mapMem.size>6000) mapMem.delete(mapMem.keys().next().value); disposeMeshes(c); chunks.delete(k); if(lastChunk===c) lastChunk=null; }
}
/** top-down view of a chunk for the minimap: {id[256],h[256]} */
function chunkTop(c){
  if(c.top) return c.top; const id=new Uint8Array(256), h=new Uint8Array(256);
  for(let z=0;z<16;z++) for(let x=0;x<16;x++){ let y=Math.min(CH-1,c.maxY); while(y>0&&!c.data[x+16*(z+16*y)]) y--; id[x+16*z]=c.data[x+16*(z+16*y)]; h[x+16*z]=y; }
  return c.top={id,h};
}


/* ============================ player ============================ */
const P={x:8.5,y:80,z:8.5,vx:0,vy:0,vz:0,w:.6,h:1.8,yaw:0,pitch:0,onGround:false,fly:false,ready:false};
const keys={};
const solidAt=(x,y,z)=>{ const id=getB(x,y,z); return id&&!isWater(id); };
function collides(x,y,z){
  const x0=Math.floor(x-.3),x1=Math.floor(x+.3-1e-6),y0=Math.floor(y),y1=Math.floor(y+1.8-1e-6),z0=Math.floor(z-.3),z1=Math.floor(z+.3-1e-6);
  for(let a=x0;a<=x1;a++)for(let b=y0;b<=y1;b++)for(let c=z0;c<=z1;c++){ const id=getB(a,b,c); if(id&&!isWater(id)) return true; }
  return false;
}
const axis={on:false,x:0,y:0}; // analog touch stick, magnitude 0..1 (y>0 = backwards); overrides WASD while held
function stepPlayer(h,sprint){
  const fxm=axis.on?axis.x:(keys.KeyD?1:0)-(keys.KeyA?1:0), fzm=axis.on?axis.y:(keys.KeyS?1:0)-(keys.KeyW?1:0);
  const len=Math.max(1,Math.hypot(fxm,fzm)), s=Math.sin(P.yaw), c=Math.cos(P.yaw);
  const wf=isWater(getB(Math.floor(P.x),Math.floor(P.y+.2),Math.floor(P.z))), wb=isWater(getB(Math.floor(P.x),Math.floor(P.y+.9),Math.floor(P.z))), inWater=wf||wb;
  const speed=P.fly?(sprint?22:12)*cfg.fly:inWater?3.4:sprint?(axis.on?8.6:7.4):(axis.on?6:4.6);
  const tx=(fxm*c+fzm*s)/len*speed, tz=(-fxm*s+fzm*c)/len*speed;
  const k=1-Math.exp(-h*(P.onGround||P.fly||inWater?11:3)); // exact exponential approach: same feel at any frame rate
  P.vx+=(tx-P.vx)*k; P.vz+=(tz-P.vz)*k;
  if(P.fly){ const ty=((keys.Space?1:0)-((keys.ShiftLeft||keys.ShiftRight)?1:0))*(sprint?14:9); P.vy+=(ty-P.vy)*Math.min(1,h*8); }
  else if(inWater){ if(keys.Space&&!wb) P.vy=Math.max(P.vy,8.4); else{ const tv=keys.Space?4.2:(wb?-1.3:-2.6); P.vy+=(tv-P.vy)*Math.min(1,h*(keys.Space?7:3)); } }
  else { P.vy=Math.max(-55,P.vy-28*h); if(keys.Space&&P.onGround) P.vy=8.6; }
  const sneak=!P.fly&&!inWater&&P.onGround&&!sprint&&!axis.on&&!!(keys.ShiftLeft||keys.ShiftRight);
  if(sneak){ P.vx*=.45; P.vz*=.45; }
  const ivx=P.vx, ivz=P.vz;
  const f=moveBody(solidAt,P,h,{sneak});
  if(inWater&&(fxm||fzm)&&((f.x&&!collides(P.x+Math.sign(ivx)*.1,P.y+1.05,P.z))||(f.z&&!collides(P.x,P.y+1.05,P.z+Math.sign(ivz)*.1)))) P.vy=Math.max(P.vy,8.4);
}

/* ============================ interaction ============================ */
function raycast(o,dir,max){
  let x=Math.floor(o.x),y=Math.floor(o.y),z=Math.floor(o.z);
  const sx=Math.sign(dir.x),sy=Math.sign(dir.y),sz=Math.sign(dir.z);
  const td=[Math.abs(1/dir.x),Math.abs(1/dir.y),Math.abs(1/dir.z)];
  const tm=[dir.x?((sx>0?x+1-o.x:o.x-x)*td[0]):Infinity, dir.y?((sy>0?y+1-o.y:o.y-y)*td[1]):Infinity, dir.z?((sz>0?z+1-o.z:o.z-z)*td[2]):Infinity];
  const n=[0,0,0]; let t=0;
  while(t<=max){
    const id=getB(x,y,z); if(id&&!isWater(id)) return {x,y,z,id,n:n.slice()};
    const a=tm[0]<tm[1]?(tm[0]<tm[2]?0:2):(tm[1]<tm[2]?1:2);
    t=tm[a]; tm[a]+=td[a]; n[0]=n[1]=n[2]=0;
    if(a===0){x+=sx;n[0]=-sx;} else if(a===1){y+=sy;n[1]=-sy;} else {z+=sz;n[2]=-sz;}
  }
  return null;
}
let MODE=GEN.mode||'creative';
const survival=()=>MODE==='survival'||MODE==='career';
let hit=null, hotbar=MODE==='survival'?[0,0,0,0,0,0,0,0,0]:[...DEFAULT_HOTBAR], slot=0;
if(save?.hot) hotbar=save.hot;
const items=save?.items||{};                    // survival item counts: id -> n
const S={hp:save?.hp??20,air:10,dead:false,regenT:0,drownT:0,peak:0};
const career=save?.career||newCareer(); let careerPaying=false;
let coins=save?.coins??0; const eco=save?.eco||newEconomy(); if(!eco.bounties||!eco.bounties.length) eco.bounties=genBounties(); let mpEconomy=false, mpPrices={}, mpBounties=[];
const economyOn=()=>survival()&&(mp?mpEconomy:GEN.economy!==false);
function setCoins(n,silent){ const d=n-coins; if(d>0&&!careerPaying) careerEvent({kind:'earn',n:d}); coins=n; if(d>0&&started&&typeof fx!=='undefined') fx.coins(P.x,P.y+1.3,P.z,10); const el=document.getElementById('coins'); if(el) el.textContent=coins; if(!silent&&d>0&&started) showToast('+'+d+' coins'); saveDirty=true; const w=document.getElementById('wallet'); if(w){ w.style.display=economyOn()&&started?'flex':'none'; if(d){ w.classList.remove('pulse'); void w.offsetWidth; w.classList.add('pulse'); } } }
const addCoins=(n)=>setCoins(Math.max(0,coins+n));
/** MP survival: the server owns the inventory; replace local counts and repair the hotbar. */
function syncItems(obj){
  for(const k in items) delete items[k]; for(const k in obj) items[k]=obj[k];
  hotbar=hotbar.map(id=>id&&!items[id]?0:id);
  for(const id of Object.keys(items)) if(!hotbar.includes(+id)){ const i=hotbar.indexOf(0); if(i>=0) hotbar[i]=+id; }
  renderHotbar(); if(invOpen) renderInv(); if(modalOpen&&typeof refreshModal==='function') refreshModal();
}
const careerEl=document.createElement('div'); careerEl.id='career'; careerEl.style.cssText='position:fixed;top:62px;left:14px;z-index:6;pointer-events:none;font:600 13px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000a;background:#0007;padding:8px 12px;border-radius:10px;max-width:260px;display:none'; document.body.append(careerEl);
function renderCareer(){
  const on=MODE==='career'&&!mp&&started; careerEl.style.display=on?'block':'none'; if(!on) return;
  const m=careerCurrent(career); careerEl.innerHTML=`<div style="opacity:.75;font-size:11px">CAREER &middot; ${rankOf(career)}</div>`+(m?`<div>${m.text}</div><div style="height:5px;background:#fff3;border-radius:3px;margin:5px 0 2px"><div style="height:5px;width:${Math.min(100,career.prog/m.n*100)}%;background:#ffd75e;border-radius:3px"></div></div><div style="opacity:.75;font-size:11px">${career.prog}/${m.n} &middot; reward ${m.reward} coins</div>`:'<div>All contracts complete - you are a Tycoon!</div>');
}
function careerEvent(ev){
  if(MODE!=='career'||mp||careerPaying) return; const r=careerProgress(career,ev); saveDirty=true;
  if(r.done){ careerPaying=true; setCoins(coins+r.done.reward,true); careerPaying=false; showToast('Contract complete: '+r.done.text+'  +'+r.done.reward+' coins'); sfx(660,.2,'triangle',.1); fx.coins(P.x,P.y+1.3,P.z,16); }
  renderCareer();
}
setInterval(()=>{ if(MODE==='career') renderCareer(); },1000);
function addItem(id,n=1){ if(mp) return; careerEvent({kind:'collect',of:id,n}); items[id]=(items[id]||0)+n; if(!hotbar.includes(id)){ const i=hotbar.indexOf(0); if(i>=0) hotbar[i]=id; } renderHotbar(); saveDirty=true; }
function useItem(id){ if(mp) return; if(--items[id]<=0){ delete items[id]; hotbar=hotbar.map(h=>h===id?0:h); } renderHotbar(); saveDirty=true; }
// block-breaking crack overlay
const crackTex=[]; for(let st=0;st<10;st++){ const c=document.createElement('canvas'); c.width=c.height=64; const g=c.getContext('2d'); g.strokeStyle='rgba(0,0,0,.8)'; g.lineWidth=1.6;
  let sd=7; const rnd=()=>(sd=(sd*16807)%2147483647)/2147483647;
  for(let k=0;k<(st+1)*3;k++){ let x=32+(rnd()-.5)*10,y=32+(rnd()-.5)*10; g.beginPath(); g.moveTo(x,y); for(let j=0;j<4;j++){ x+=(rnd()-.5)*28; y+=(rnd()-.5)*28; g.lineTo(x,y); } g.stroke(); }
  crackTex.push(new THREE.CanvasTexture(c)); }
const crack=new THREE.Mesh(new THREE.BoxGeometry(1.012,1.012,1.012),new THREE.MeshBasicMaterial({map:crackTex[0],transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
crack.visible=false; scene.add(crack);
const mine={x:0,y:0,z:0,p:0};
let thirdP=0, selfAv=null;
function sfx(f,dur=.09,type='square',vol=.05){ audio.sfx(f,dur,type,vol); }

function breakBlock(){
  if(!hit||MODE==='lobby'||(inArena()&&arena.pvp())) return; tut.broke=true; vmPunch(); const id=hit.id; setBlock(hit.x,hit.y,hit.z,AIR); burst(hit.x,hit.y,hit.z,id); sfx(110+Math.random()*60,.12,'sawtooth');
  if(survival()) addItem(dropOf(id)); // no-op online: the server grants the drop
}
function placeBlock(){
  if(!hit||(inArena()&&!arena.builds())||MODE==='lobby') return; const bid=hotbar[slot]; if(!bid) return; if(survival()&&!(items[bid]>0)) return;
  const x=hit.x+hit.n[0], y=hit.y+hit.n[1], z=hit.z+hit.n[2], cur=getB(x,y,z);
  if(cur&&!isWater(cur)) return;
  if(x+1>P.x-.3&&x<P.x+.3&&y+1>P.y&&y<P.y+1.8&&z+1>P.z-.3&&z<P.z+.3) return;
  tut.placed=true; vmPunch(); fx.dust(x+.5,y+.1,z+.5,4,BLOCK_COLOR[bid]); setBlock(x,y,z,bid); sfx(230,.07,'triangle',.07); if(survival()) useItem(bid); careerEvent({kind:'place',n:1});
}
const tut={moved:0,jumped:false,broke:false,placed:false,inv:false,help:false};
const TUT=[['Move with {forward} {left} {back} {right}',()=>tut.moved>5],['Press {jump} to jump',()=>tut.jumped],['Left click to break a block',()=>tut.broke],['Right click to place a block',()=>tut.placed],['Press {inventory} to open your inventory',()=>tut.inv],['Press {help} any time for the controls',()=>tut.help]];
let tutStep=0; try{ if(localStorage.getItem('voxel_tut')==='1') tutStep=TUT.length; }catch(e){}
function tutText(t){ return t.replace(/\{(\w+)\}/g,(m,id)=>'<b>'+K(id)+'</b>'); }
function tutTick(){
  const el=document.getElementById('objective'); if(keys.Space&&P.onGround&&started&&locked()) tut.jumped=true;
  if(!cfg.hints||tutStep>=TUT.length||!started||!P.ready||S.dead){ el.style.display='none'; return; }
  if(TUT[tutStep][1]()){ tutStep++; sfx(660,.12,'triangle',.08); setTimeout(()=>sfx(880,.15,'triangle',.08),110); if(tutStep>=TUT.length){ try{ localStorage.setItem('voxel_tut','1'); }catch(e){} el.style.display='none'; showToast('Tutorial complete!'); return; } }
  const h='<span>Tip '+(tutStep+1)+'/'+TUT.length+'</span>'+tutText(TUT[tutStep][0]); if(el.innerHTML!==h) el.innerHTML=h; el.style.display='block';
}
const promptEl=document.getElementById('prompt'); let lastPrompt='';
const MOBNAME={pig:'Pig',zombie:'Zombie',villager:'Villager',boss:'BOSS'};
function updatePrompt(){
  let t=''; if(started&&P.ready&&!invOpen&&!S.dead&&locked()){
    if(targetEnt) t=MOBNAME[targetEnt.type]+'<small>LMB Attack'+(targetEnt.type==='villager'?(economyOn()?' &middot; RMB Trade':' &middot; RMB Talk'):'')+'</small>';
    else if(hit&&hit.id) t=NAMES[hit.id]+'<small>'+(IS_TOUCH?'Hold to Break &middot; Tap to Place':'LMB Break &middot; RMB Place')+'</small>'; }
  if(t!==lastPrompt){ lastPrompt=t; promptEl.innerHTML=t; }
  document.getElementById('cross').classList.toggle('hot',!!t);
}
let infoT=0; const DIRS=['N','NE','E','SE','S','SW','W','NW'];
function updateInfo(dt){
  infoT+=dt; if(infoT<.25||!cfg.coords) return; infoT=0;
  const b=((-P.yaw*57.2958)%360+360)%360, hrs=(worldTime*24)%24, hh=Math.floor(hrs), mm=Math.floor((hrs-hh)*60);
  document.getElementById('hudinfo').textContent=DIRS[Math.round(b/45)%8]+'   X '+Math.floor(P.x)+'  Y '+Math.floor(P.y)+'  Z '+Math.floor(P.z)+'   '+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
}
let stepAcc=0, fpsClass=false;
function footsteps(dt){
  const sp=Math.hypot(P.vx,P.vz); if(!P.onGround||sp<1.2||P.fly){ return; } stepAcc+=sp*dt;
  if(stepAcc>2.3){ stepAcc=0; const b=getB(Math.floor(P.x),Math.floor(P.y-.1),Math.floor(P.z)); audio.step(isWater(b)?'water':b===SAND?'sand':b===SNOW?'snow':b===STONE||b===COBBLE||b===BRICK||b===B.STONE_BRICK?'stone':b===PLANKS||b===LOG||b===B.DARK_PLANKS?'wood':b===B.GRAVEL?'gravel':b===DIRT?'dirt':'grass',!!(keys.ShiftLeft||keys.ShiftRight)); }
}
/* ---- modal system (focus trap, Esc to close, restores pointer lock) ---- */
let modalState=null, modalPrevFocus=null;
function openModal({title,render,actions=[],onClose,wide}){
  if(modalOpen) closeModal(true);
  modalState={title,render,actions,onClose}; modalOpen=true; mouseL=false; for(const k in keys) keys[k]=false;
  if(document.pointerLockElement) document.exitPointerLock();
  modalPrevFocus=document.activeElement; $('modal').hidden=false; $('mtitle').textContent=title; $('modal').querySelector('.modal-card').style.width=wide?'min(780px,94vw)':'';
  refreshModal(); setTimeout(()=>{ const f=$('mbody').querySelector('input,button')||$('mclose'); f&&f.focus(); },30);
}
function refreshModal(){
  if(!modalState) return; const body=$('mbody'), st=body.scrollTop; body.replaceChildren(); modalState.render(body);
  const foot=$('mfoot'); foot.replaceChildren(); for(const a of modalState.actions){ const b=document.createElement('button'); b.textContent=a.label; if(!a.primary) b.className='ghost'; if(a.danger) b.className='danger'; b.onclick=()=>{ if(a.onClick) a.onClick(); if(a.close!==false) closeModal(); }; foot.append(b); }
  body.scrollTop=st;
}
function closeModal(silent){
  if(!modalOpen) return; modalOpen=false; $('modal').hidden=true; const cb=modalState&&modalState.onClose; modalState=null; if(cb&&!silent) cb();
  if(modalPrevFocus&&modalPrevFocus.focus) try{ modalPrevFocus.focus(); }catch(e){}
  if(started&&!invOpen&&!paused&&!fallback&&menu.style.display==='none') captureMouse();
}
$('mclose').onclick=()=>closeModal();
$('modal').addEventListener('mousedown',e=>{ if(e.target===$('modal')) closeModal(); });
document.addEventListener('keydown',e=>{
  if(!modalOpen) return; e.stopPropagation();
  if(e.key==='Escape'){ e.preventDefault(); closeModal(); }
  else if(e.key==='Tab'){ const f=[...$('modal').querySelectorAll('button:not([disabled]),input,select')]; if(!f.length) return; const i=f.indexOf(document.activeElement); e.preventDefault(); f[(i+(e.shiftKey?-1:1)+f.length)%f.length].focus(); }
},true);
function confirmModal(title,text,onYes,danger){ openModal({title,render:b=>{ const p=document.createElement('p'); p.textContent=text; b.append(p); },actions:[{label:'Cancel'},{label:'Confirm',primary:!danger,danger,onClick:onYes}]}); }
function promptModal(title,label,type,onOk){
  let inp; openModal({title,render:b=>{ const l=document.createElement('label'); l.textContent=label; l.style.display='block'; l.style.marginBottom='8px'; inp=document.createElement('input'); inp.type=type||'text'; inp.style.width='100%'; inp.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter'){ const v=inp.value; closeModal(); onOk(v); } }; b.append(l,inp); },actions:[{label:'Cancel'},{label:'OK',primary:true,onClick:()=>onOk(inp.value)}]});
}
const iconCanvas=(id,size)=>{ const c=icon(id,size); c.style.width=c.style.height=size+'px'; return c; };

/* ---- trading (villagers) ---- */
let tradeTab='sell';
const sellP=id=>mp?(mpPrices[id]?mpPrices[id][0]:0):sellPrice(eco,id);
const buyP=id=>mp?(mpPrices[id]?mpPrices[id][1]:0):buyPrice(eco,id);
const bountiesNow=()=>mp?mpBounties:eco.bounties;
function doSell(id,n){
  n=Math.min(n,items[id]||0); if(n<1) return;
  if(mp){ ws&&ws.readyState===1&&ws.send(JSON.stringify({t:'trade',action:'sell',id,n})); return; }
  const total=ecoSell(eco,id,n); items[id]-=n; if(items[id]<=0){ delete items[id]; hotbar=hotbar.map(h=>h===id?0:h); } addCoins(total); renderHotbar(); sfx(700,.1,'triangle',.08); showToast('Sold '+n+' '+NAMES[id]); refreshModal(); saveDirty=true;
}
function doBuy(id,n){
  if(mp){ ws&&ws.readyState===1&&ws.send(JSON.stringify({t:'trade',action:'buy',id,n})); return; }
  const cost=quoteBuy(eco,id,n); if(coins<cost){ showToast('Not enough coins'); sfx(120,.15,'sawtooth',.06); return; }
  ecoBuy(eco,id,n); addCoins(-cost); addItem(id,n); sfx(420,.1,'triangle',.08); showToast('Bought '+n+' '+NAMES[id]); refreshModal();
}
function doBounty(b){
  if(mp){ ws&&ws.readyState===1&&ws.send(JSON.stringify({t:'bounty',uid:b.uid})); return; }
  if((items[b.id]||0)<b.qty){ showToast('You need '+b.qty+' '+NAMES[b.id]); return; }
  items[b.id]-=b.qty; if(items[b.id]<=0){ delete items[b.id]; hotbar=hotbar.map(h=>h===b.id?0:h); } b.taken=true; addCoins(b.reward); renderHotbar();
  if(eco.bounties.every(x=>x.taken)) eco.bounties=genBounties(); sfx(880,.15,'triangle',.08); showToast('Bounty complete! +'+b.reward+' coins'); refreshModal(); saveDirty=true;
}
function openTrade(){
  openModal({title:'Village trader',wide:true,actions:[{label:'Close'}],render:body=>{
    const tabs=document.createElement('div'); tabs.className='tabs';
    for(const [k,l] of [['sell','Sell'],['buy','Buy'],['bounty','Bounties']]){ const t=document.createElement('span'); t.textContent=l; if(tradeTab===k) t.className='on'; t.onclick=()=>{ tradeTab=k; refreshModal(); }; tabs.append(t); }
    const bal=document.createElement('div'); bal.className='stat-row'; bal.innerHTML='<span>Your coins</span><b style="color:var(--gold)">'+coins+'</b>'; body.append(tabs,bal);
    const list=document.createElement('div'); list.style.marginTop='12px'; body.append(list);
    const row=(id,price,btns,sub)=>{ const d=document.createElement('div'); d.className='trade-row'; d.append(iconCanvas(id,34)); const nm=document.createElement('span'); nm.className='nm'; nm.textContent=NAMES[id]+(sub?'  '+sub:''); const pr=document.createElement('span'); pr.className='pr'; pr.textContent=price+' c'; d.append(nm,pr); for(const [lab,fn,dis] of btns){ const b=document.createElement('button'); b.textContent=lab; b.disabled=!!dis; b.onclick=fn; d.append(b); } list.append(d); };
    if(tradeTab==='sell'){ const have=Object.keys(items).map(Number).filter(id=>items[id]>0&&(mp?mpPrices[id]:ECO_BASE[id])); if(!have.length) list.innerHTML='<div class="empty">Nothing to sell yet. Mine some blocks!</div>'; for(const id of have) row(id,sellP(id),[['Sell 1',()=>doSell(id,1)],['Sell 10',()=>doSell(id,10),items[id]<10],['All',()=>doSell(id,items[id])]],'x'+items[id]); }
    else if(tradeTab==='buy'){ for(const id of BUYABLE) { const p=buyP(id); if(p) row(id,p,[['Buy 1',()=>doBuy(id,1),coins<p],['Buy 10',()=>doBuy(id,10),coins<p*10]]); } }
    else { const bs=bountiesNow(); if(!bs.length) list.innerHTML='<div class="empty">No bounties right now.</div>'; for(const b of bs){ const d=document.createElement('div'); d.className='bounty'+(b.taken?' done':''); d.append(iconCanvas(b.id,38)); const t=document.createElement('div'); t.style.flex='1'; t.innerHTML='<b>Deliver '+b.qty+' '+esc(NAMES[b.id])+'</b><div style="opacity:.7;font-size:12px">You have '+(items[b.id]||0)+' &middot; reward <span style="color:var(--gold)">'+b.reward+' coins</span></div>'; const btn=document.createElement('button'); btn.textContent=b.taken?'Done':'Turn in'; btn.disabled=b.taken||(items[b.id]||0)<b.qty; btn.style.margin='0'; btn.onclick=()=>doBounty(b); d.append(t,btn); list.append(d); } }
  }});
}

/* ---- player modal ---- */
const muted=new Set();
function openPlayerModal(o){
  let pv=null;
  openModal({title:o.name,render:body=>{
    const wrap=document.createElement('div'); wrap.className='pmodal'; const cv=document.createElement('canvas'); cv.width=360; cv.height=480; wrap.append(cv);
    const info=document.createElement('div'); const dist=Math.hypot(o.x-P.x,o.z-P.z)|0;
    info.innerHTML='<div class="stat-row"><span>Distance</span><b>'+dist+' m</b></div><div class="stat-row"><span>Position</span><b>'+(o.x|0)+', '+(o.y|0)+', '+(o.z|0)+'</b></div><div class="stat-row"><span>Status</span><b>Online</b></div>';
    const act=document.createElement('div'); act.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:14px';
    const b1=document.createElement('button'); b1.className='ghost'; b1.style.margin='0'; b1.textContent=muted.has(o.name)?'Unmute':'Mute'; b1.onclick=()=>{ muted.has(o.name)?muted.delete(o.name):muted.add(o.name); closeModal(); showToast((muted.has(o.name)?'Muted ':'Unmuted ')+o.name); };
    const b2=document.createElement('button'); b2.className='ghost'; b2.style.margin='0'; b2.textContent='Whisper tag'; b2.onclick=()=>{ closeModal(); openChat(); chatIn.value='@'+o.name+' '; };
    act.append(b1,b2); info.append(act); wrap.append(info); body.append(wrap);
    // live 3D preview
    const r=new THREE.WebGLRenderer({canvas:cv,alpha:true,antialias:true}); r.setSize(180,240,false); r.outputColorSpace=THREE.SRGBColorSpace;
    const sc=new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff,0x667788,3.4)); const dl=new THREE.DirectionalLight(0xffffff,2.8); dl.position.set(2,3,4); sc.add(dl);
    const cam=new THREE.PerspectiveCamera(28,.75,.1,50); cam.position.set(0,1.1,5.2); cam.lookAt(0,1.05,0); const av=makeAvatar('',o.id,o.skin,true); sc.add(av);
    pv={r,sc,cam,av,run:true}; const loop=()=>{ if(!pv||!pv.run) return; av.rotation.y+=.02; r.render(sc,cam); requestAnimationFrame(loop); }; loop();
  },actions:[{label:'Close'}],onClose:()=>{ if(pv){ pv.run=false; pv.r.dispose(); pv=null; } }});
}
document.addEventListener('click',e=>{ if(e.target.closest&&e.target.closest('button,.tabs span,.srv,.pl')) sfx(520,.04,'triangle',.05); });
function mineUpdate(dt){
  if(fpsClass){ mine.p=0; return; }
  const sv=survival();
  if(!mouseL||!hit||!locked()||invOpen||S.dead){ mine.p=0; crack.visible=false; return; }
  if(!sv){ mineT+=dt; if(mineT>.2){ mineT=0; breakBlock(); } crack.visible=false; return; }
  if(mine.x!==hit.x||mine.y!==hit.y||mine.z!==hit.z){ mine.x=hit.x; mine.y=hit.y; mine.z=hit.z; mine.p=0; }
  mine.p+=dt/(HARD[hit.id]||1);
  crack.visible=true; crack.position.set(hit.x+.5,hit.y+.5,hit.z+.5); crack.material.map=crackTex[Math.min(9,Math.floor(mine.p*10))];
  if(((mine.p*20)|0)!==(((mine.p-dt/(HARD[hit.id]||1))*20)|0)) sfx(150+Math.random()*40,.05,'square',.03);
  if(mine.p>=1){ mine.p=0; crack.visible=false; breakBlock(); }
}
function hurt(n){
  if(!survival()||S.dead) return; S.hp=Math.max(0,S.hp-n); S.regenT=0; shakeT=.4; sfx(90,.2,'sawtooth',.1);
  const h=document.getElementById('hurt'); h.style.opacity=1; setTimeout(()=>h.style.opacity=0,120); renderVitals();
  if(S.hp<=0){ S.dead=true; mouseL=false; document.exitPointerLock(); document.getElementById('death').style.display='grid'; }
}
function survivalTick(dt,headWater,feetWater){
  if(!survival()||S.dead) return;
  if(P.onGround||feetWater){ const d=S.peak-P.y; if(d>3.4&&P.onGround&&!feetWater) hurt(Math.floor(d-3)); S.peak=P.y; } else S.peak=Math.max(S.peak,P.y);
  if(headWater){ S.air=Math.max(0,S.air-dt); if(S.air<=0){ S.drownT+=dt; if(S.drownT>=1){ S.drownT=0; hurt(2); } } } else { S.air=Math.min(10,S.air+dt*5); S.drownT=0; }
  if(S.hp<20){ S.regenT+=dt; if(S.regenT>4){ S.regenT=0; S.hp++; renderVitals(); } }
  if(((S.air*2)|0)!==S.airShown){ S.airShown=(S.air*2)|0; renderVitals(); }
}
function renderVitals(){
  const v=document.getElementById('vitals'); if(!survival()){ v.style.display='none'; return; }
  let h='<span>'; for(let i=0;i<10;i++) h+=`<span class="hp ${S.hp>=i*2+2?'':S.hp===i*2+1?'half':'empty'}${S.hp<=6&&S.hp>i*2?' low':''}">&#9829;</span>`;
  h+='</span>'; if(S.air<10) { h+='<span>'; for(let i=0;i<10;i++) h+=`<span class="air" style="opacity:${S.air>i?1:.15}">&#9679;</span>`; h+='</span>'; }
  v.innerHTML=h; v.style.display='flex';
}

/* ============================ viewmodel & camera feel ============================ */
scene.add(camera);
const vm=new THREE.Group(); camera.add(vm); vm.position.set(.36,-.32,-.6);
const vmArm=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.5),new THREE.MeshStandardMaterial({color:0xe0b48f,roughness:.85,depthTest:false,depthWrite:false}));
vmArm.position.set(.04,-.14,.18); vmArm.rotation.x=.55; vmArm.renderOrder=100; vm.add(vmArm);
const vmTexCache={};
function tileTex(tile){ let t=vmTexCache[tile]; if(!t){ const c=document.createElement('canvas'); c.width=c.height=64; c.getContext('2d').drawImage(atlas,(tile%ATL)*TS,Math.floor(tile/ATL)*TS,TS,TS,0,0,64,64); t=new THREE.CanvasTexture(c); t.magFilter=THREE.NearestFilter; t.colorSpace=THREE.SRGBColorSpace; vmTexCache[tile]=t; } return t; }
const vmMatCache={};
function vmMaterials(id){ if(vmMatCache[id]) return vmMatCache[id]; const [side,top,bot]=TILES[id], mk=t=>new THREE.MeshStandardMaterial({map:tileTex(t),emissive:0xffffff,emissiveMap:tileTex(t),emissiveIntensity:.18,roughness:1,depthTest:false,depthWrite:false,transparent:true}); const sm=mk(side); return vmMatCache[id]=[sm,sm,mk(top),mk(bot),sm,sm]; } let swayX=0, swayY=0, vmId=-1, vmEquip=0, vmSwing=0, vmPhase=0, camPhase=0, landDip=0, shakeT=0, deadT=0, wasGround=true, vyBefore=0;
const vmBlock=new THREE.Mesh(new THREE.BoxGeometry(.15,.15,.15),new THREE.MeshStandardMaterial({roughness:1,depthTest:false,depthWrite:false})); vmBlock.position.set(-.02,.02,-.1); vmBlock.rotation.set(.35,.7,0); vmBlock.renderOrder=101; vm.add(vmBlock);
function vmPunch(){ vmSwing=1; if(selfAv) selfAv.swing=1; }
function camEffects(dt){
  const sp=P.onGround&&!P.fly?Math.hypot(P.vx,P.vz):0, amp=cfg.bob?Math.min(1,sp/5):0;
  camPhase+=sp*dt*2.3; shakeT=Math.max(0,shakeT-dt); landDip=Math.max(0,landDip-dt*1.6);
  if(S.dead) deadT+=dt; else deadT=0;
  let roll=0, dy=0;
  if(!thirdP){ dy=(Math.abs(Math.sin(camPhase))*.045-.02)*amp - landDip*.8*Math.min(1,landDip*3+.3); roll=Math.sin(camPhase)*.005*amp; }
  if(shakeT>0){ roll+=Math.sin(shakeT*70)*shakeT*.1; }
  if(S.dead){ roll=Math.min(1.45,deadT*2.2); dy-=Math.min(1.3,deadT*2); }
  if(underwater) roll+=Math.sin(tNow()*1.3)*.008;
  camera.position.y+=dy; camera.rotation.z=roll;
}
function updateViewmodel(dt){
  vm.visible=started&&P.ready&&thirdP===0&&!S.dead&&!invOpen&&!document.body.classList.contains('nohud')&&!document.body.classList.contains('arena-gun')&&!fpsClass&&MODE!=='lobby'; // gun modes and the lobby: no held block / arm
  if(!vm.visible) return;
  const id=hotbar[slot]; if(id!==vmId){ vmId=id; vmEquip=1; if(id) vmBlock.material=vmMaterials(id); vmBlock.visible=!!id; }
  vmEquip=Math.max(0,vmEquip-dt*4.5);
  if((mouseL&&locked()&&(hit||targetEnt))&&vmSwing<=.25) vmPunch();
  vmSwing=Math.max(0,vmSwing-dt*3.6); const sw=Math.sin((1-vmSwing)*Math.PI)*(vmSwing>0?1:0);
  const sp=P.onGround&&!P.fly?Math.hypot(P.vx,P.vz):0, amp=cfg.bob?Math.min(1,sp/5):0; vmPhase+=sp*dt*2.3;
  const sprint=!!(keys.ShiftLeft||keys.ShiftRight)&&keys.KeyW;
  vm.position.set(.36+Math.sin(vmPhase)*.012*amp-sw*.1, -.32-Math.abs(Math.cos(vmPhase))*.016*amp-vmEquip*.5+Math.sin(tNow()*1.6)*.003-landDip*.12, -.6-sw*.18);
  swayX*=Math.max(0,1-dt*7); swayY*=Math.max(0,1-dt*7);
  vm.position.x+=swayX*.9; vm.position.y+=swayY*.9;
  vm.rotation.set(-sw*1.05+(sprint?.25:0)+vmEquip*.4+swayY*.8, sw*.35+swayX*.9, -sw*.2+swayX*.5);
  vmArm.visible=true;
}

/* ============================ NPC mobs (client views) ============================ */
// Singleplayer runs the shared MobSim locally; online, the server owns the sim and streams snapshots.
const mobViews=new Map(); let targetEnt=null, sunElev=1;
const sim=new MobSim({getB,hasChunk}); sim.enabled=GEN.mobs!==false; sim.hostile=GEN.hostile!==false;
function buildMob(type){
  const M=c=>new THREE.MeshStandardMaterial({color:c,roughness:.8}); let g;
  if(type==='pig'){
    g=new THREE.Group(); g.legs=[]; g.phase=Math.random()*6;
    const add=(w,h,d,x,y,z,c,parent=g)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),M(c)); m.position.set(x,y,z); m.castShadow=true; parent.add(m); return m; };
    g.bodyMesh=add(.62,.5,.95,0,.55,0,0xf2a6b4);
    const head=new THREE.Group(); head.position.set(0,.72,.45); g.add(head); g.head=head;
    add(.42,.42,.4,0,0,.15,0xf5b3c0,head); add(.22,.16,.1,0,-.06,.38,0xe58aa0,head); add(.06,.06,.02,-.12,.06,.36,0x222222,head); add(.06,.06,.02,.12,.06,.36,0x222222,head);
    for(const [x,z] of [[-.2,.3],[.2,.3],[-.2,-.3],[.2,-.3]]){ const p=new THREE.Group(); p.position.set(x,.3,z); g.add(p); add(.16,.3,.16,0,-.15,0,0xe08fa0,p); g.legs.push(p); }
  } else {
    const skins={boss:{shirt:'#7a1020',pants:'#2a0a12',skin:'#b83a3a',hair:'#1a0508'},zombie:{shirt:'#2e7d9e',pants:'#3a3f8f',skin:'#6aa84f',hair:'#2d4a1e'},villager:{shirt:'#7b5a3a',pants:'#5a3f28',skin:'#d9a37c',hair:'#3b2a1a'}};
    g=makeAvatar('',0,skins[type],true);
    if(type==='villager'){ const n=new THREE.Mesh(new THREE.BoxGeometry(.12,.2,.14),M(0xc08860)); n.position.set(0,.2,.28); g.head.add(n); }
    if(type==='zombie'||type==='boss') g.armsUp=true;
    if(type==='boss') g.scale.setScalar(2);
  }
  return g;
}
function disposeObj(g){ g.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material){ (o.material.map)&&o.material.map.dispose(); o.material.dispose(); } }); }
/** states: [{id,type,x,y,z,yaw,hurt,atk}] */
function applyMobStates(states,dt,snap){
  const seen=new Set(), t=tNow();
  for(const s of states){
    seen.add(s.id); let v=mobViews.get(s.id);
    if(!v){ const g=buildMob(s.type); scene.add(g); g.position.set(s.x,s.y,s.z); v={id:s.id,type:s.type,g,x:s.x,y:s.y,z:s.z,yaw:s.yaw,sp:0,atk:0,hurt:0}; mobViews.set(s.id,v); }
    const k=snap?1:Math.min(1,dt*(mp?10:22)), px=v.x, pz=v.z;
    v.x+=(s.x-v.x)*k; v.y+=(s.y-v.y)*k; v.z+=(s.z-v.z)*k;
    const spd=Math.hypot(v.x-px,v.z-pz)/Math.max(dt,1e-3); v.sp+=(spd-v.sp)*Math.min(1,dt*10);
    let dy=s.yaw-v.g.rotation.y; dy=Math.atan2(Math.sin(dy),Math.cos(dy)); v.g.rotation.y+=dy*Math.min(1,dt*10);
    v.g.position.set(v.x,v.y,v.z);
    if(s.atk&&!v.atk&&v.g.rig) v.g.swing=1; v.atk=s.atk;
    if(v.type==='pig') animatePig(v.g,v.sp,dt,t); else animateRig(v.g,v.sp,dt,t);
    const dist=Math.hypot(P.x-v.x,P.z-v.z);
    if(v.g.head&&dist<8&&v.type!=='zombie') v.g.head.rotation.x=Math.max(-.5,Math.min(.5,-(P.y+1.6-(v.y+1.6))/Math.max(dist,1)));
    const hurt=s.hurt?1:0; if(hurt!==v.hurt){ v.hurt=hurt; const em=hurt?0xaa1111:0x000000; v.g.traverse(o=>{ if(o.material&&o.material.emissive) o.material.emissive.setHex(em); }); }
  }
  for(const [id,v] of mobViews) if(!seen.has(id)){ scene.remove(v.g); disposeObj(v.g); mobViews.delete(id); if(targetEnt===v) targetEnt=null; }
}
function clearMobViews(){ for(const v of mobViews.values()){ scene.remove(v.g); disposeObj(v.g); } mobViews.clear(); targetEnt=null; }
function burstColor(x,y,z,col,n=14){ fx.debris(x,y+.7,z,col,n); fx.smoke(x,y,z,8,0x8a8f96); fx.spark(x,y+.8,z,0xffffff,6,2.5); }
const MOB_COLOR={pig:0xf2a6b4,zombie:0x6aa84f,villager:0xd9a37c};
let simAcc=0;
function updateMobs(dt){
  if(!started||!P.ready){ targetEnt=null; return; }
  if(!mp){ // local simulation at a fixed 20 Hz
    simAcc=Math.min(.25,simAcc+dt);
    while(simAcc>=.05){ simAcc-=.05; sim.update(.05,[{id:'me',x:P.x,y:P.y,z:P.z,dead:S.dead}],{night:sunElev<-.02,sunElev}); }
    for(const ev of sim.drainEvents()){
      if(ev.t==='dmg'){ hurt(ev.n); P.vx+=ev.kx; P.vz+=ev.kz; P.vy=Math.max(P.vy,4); }
      else if(ev.t==='mobdie') { burstColor(ev.x,ev.y,ev.z,ev.burn?0x777777:MOB_COLOR[ev.mtype],20); if(!ev.burn) sfx(90,.2,'sawtooth',.1); }
    }
    const st=[]; for(const m of sim.mobs.values()) st.push({id:m.id,type:m.type,x:m.x,y:m.y,z:m.z,yaw:m.yaw,hurt:m.hurt>0,atk:m.atk>.6});
    applyMobStates(st,dt,false);
  } else applyMobStates(netMobTargets,dt,false);
  // what is under the crosshair?
  targetEnt=null; if(locked()&&!invOpen){ let best=1e9; const o=camera.position, d=camDir;
    for(const m of mobViews.values()){ const def=MOB[m.type], mn=[m.x-def.w/2,m.y,m.z-def.w/2], mx=[m.x+def.w/2,m.y+def.h,m.z+def.w/2]; let t0=0,t1=4.8, okk=true; const oo=[o.x,o.y,o.z], dd=[d.x,d.y,d.z];
      for(let a=0;a<3;a++){ if(Math.abs(dd[a])<1e-6){ if(oo[a]<mn[a]||oo[a]>mx[a]) okk=false; } else { let a0=(mn[a]-oo[a])/dd[a], a1=(mx[a]-oo[a])/dd[a]; if(a0>a1) [a0,a1]=[a1,a0]; t0=Math.max(t0,a0); t1=Math.min(t1,a1); if(t0>t1) okk=false; } }
      if(okk&&t0<best){ best=t0; targetEnt=m; } }
    if(targetEnt&&hit){ const hd=Math.hypot(hit.x+.5-o.x,hit.y+.5-o.y,hit.z+.5-o.z)-.5; if(hd<best) targetEnt=null; } }
}
function attackMob(m){
  vmPunch(); fx.spark(m.x,m.y+(MOB[m.type].h*.6),m.z,0xff6b6b,10,3); const dmg=survival()?4:20; sfx(m.type==='pig'?260:170,.1,'sawtooth',.08);
  if(!mp&&economyOn()&&m.type!=='villager'){ const mob=sim.mobs.get(m.id); if(mob&&mob.hp-dmg<=0&&MOB_REWARD[m.type]) addCoins(MOB_REWARD[m.type]); }
  if(mp){ if(ws&&ws.readyState===1) ws.send(JSON.stringify({t:'hit',id:m.id,dmg})); }
  else{ const r=sim.hit(m.id,dmg,P.x,P.z); if(r&&r.killed){ targetEnt=null; careerEvent({kind:'kill',of:m.type}); } }
}
function interactMob(m){
  if(m.type==='villager'&&economyOn()){ sfx(330,.1,'triangle',.06); openTrade(); return; }
  if(m.type==='villager'){ showToast('Villager: "'+VILLAGER_LINES[Math.random()*VILLAGER_LINES.length|0]+'"'); sfx(330,.1,'triangle',.06); }
  else if(m.type==='pig'){ sfx(200,.12,'square',.06); setTimeout(()=>sfx(170,.1,'square',.06),120); showToast('Oink!'); }
}

/* ============================ avatars ============================ */
const DEF_SKIN={shirt:'#3c8dd9',pants:'#2d3a63',skin:'#e0b48f',hair:'#4a3020'};
function makeAvatar(name,id,sk,notag){
  const k=Object.assign({},DEF_SKIN,Object.fromEntries(Object.entries(sk||{}).filter(([,v])=>v)));
  if(!sk) k.shirt='#'+new THREE.Color().setHSL((id*.137)%1,.6,.5).getHexString();
  const g=new THREE.Group(), M=c=>new THREE.MeshStandardMaterial({color:c,roughness:.75});
  const piv=(x,y,z,parent=g)=>{ const p=new THREE.Group(); p.position.set(x,y,z); parent.add(p); return p; };
  const box=(w,h,d,x,y,z,m,parent)=>{ const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m); b.position.set(x,y,z); b.castShadow=true; parent.add(b); return b; };
  const torso=piv(0,0,0); box(.5,.7,.28,0,1.05,0,M(k.shirt),torso);
  const legL=piv(-.13,.7,0), legR=piv(.13,.7,0); box(.22,.7,.22,0,-.35,0,M(k.pants),legL); box(.22,.7,.22,0,-.35,0,M(k.pants),legR);
  const armL=piv(-.36,1.38,0,torso), armR=piv(.36,1.38,0,torso);
  for(const a of [armL,armR]){ box(.2,.62,.22,0,-.31,0,M(k.shirt),a); box(.2,.12,.22,0,-.68,0,M(k.skin),a); }
  const head=piv(0,1.4,0,torso);
  box(.45,.45,.45,0,.25,0,M(k.skin),head); box(.48,.16,.48,0,.45,0,M(k.hair),head); box(.48,.4,.12,0,.23,-.2,M(k.hair),head);
  box(.07,.07,.02,-.1,.28,.23,M('#222'),head); box(.07,.07,.02,.1,.28,.23,M('#222'),head);
  g.head=head; g.rig={torso,legL,legR,armL,armR,head}; g.phase=Math.random()*6; g.swing=0; g.armsUp=false;
  if(!notag){ const c=document.createElement('canvas'); c.width=256; c.height=64; const x=c.getContext('2d'); x.font='600 32px Inter,sans-serif'; x.textAlign='center';
    x.fillStyle='rgba(0,0,0,.55)'; x.fillRect(0,8,256,48); x.fillStyle='#fff'; x.fillText(name,128,44);
    const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true})); sp.scale.set(1.6,.4,1); sp.position.y=2.2; sp.renderOrder=5; g.add(sp); }
  return g;
}
const tNow=()=>performance.now()/1000;
function animateRig(g,speed,dt,t){
  const r=g.rig, amp=Math.min(1,speed/3.2); g.phase+=speed*dt*2.6;
  const sw=Math.sin(g.phase)*.95*amp, idle=Math.sin(t*1.7)*.035;
  r.legL.rotation.x+=((sw)-r.legL.rotation.x)*Math.min(1,dt*18); r.legR.rotation.x+=((-sw)-r.legR.rotation.x)*Math.min(1,dt*18);
  const st=g.state|0, tl=1-Math.min(1,dt*10);
  if(g.armsUp){ r.armL.rotation.x=r.armR.rotation.x=-1.45+Math.sin(g.phase)*.1*amp+idle; r.armL.rotation.z=.08; r.armR.rotation.z=-.08; }
  else if(st===1||st===4){ r.armL.rotation.x=-.4; r.armR.rotation.x=-.4; r.armL.rotation.z=.9; r.armR.rotation.z=-.9; r.legL.rotation.x=-.45; r.legR.rotation.x=.35; }
  else if(st===2){ const sp2=Math.sin(t*5+g.phase); r.armL.rotation.x=-2.2+sp2*.9; r.armR.rotation.x=-2.2-sp2*.9; r.armL.rotation.z=.35; r.armR.rotation.z=-.35; r.legL.rotation.x=sp2*.6; r.legR.rotation.x=-sp2*.6; }
  else { const k2=st===3?1.35:1; r.armL.rotation.x=-sw*.9*k2+idle; r.armR.rotation.x=sw*.9*k2-idle; r.armL.rotation.z=.05+idle*.6; r.armR.rotation.z=-.05-idle*.6; }
  g.rotation.x+=(((st===2?.9:st===3?.14:st===4?.5:0))-g.rotation.x)*Math.min(1,dt*8);
  if(g.swing>0){ g.swing=Math.max(0,g.swing-dt*3.4); const p=1-g.swing; r.armR.rotation.x=-1.2-Math.sin(p*Math.PI)*1.1; r.armR.rotation.z=-.1-Math.sin(p*Math.PI)*.25; r.torso.rotation.y=Math.sin(p*Math.PI)*.25; }
  else r.torso.rotation.y=Math.sin(g.phase)*.1*amp;
  r.torso.position.y=Math.abs(Math.cos(g.phase))*.05*amp+Math.sin(t*1.7)*.006;
}
function animatePig(g,speed,dt,t){
  const amp=Math.min(1,speed/1.6); g.phase+=speed*dt*7; const sw=Math.sin(g.phase)*.8*amp;
  g.legs[0].rotation.x=sw; g.legs[3].rotation.x=sw; g.legs[1].rotation.x=-sw; g.legs[2].rotation.x=-sw;
  g.bodyMesh.position.y=.55+Math.abs(Math.cos(g.phase))*.025*amp; g.head.rotation.z=Math.sin(g.phase)*.06*amp; g.head.rotation.x+=(Math.sin(t*2)*.02);
}

/* ============================ multiplayer ============================ */
let ws=null, myId=null, mp=false, mpAddr=null, mpWorld=null, mpMotd=''; const others=new Map();
let netMobTargets=[]; const timeSync={t:0,len:420,at:0};
function addOther(p){ if(p.id===myId||others.has(p.id)) return; const mesh=makeAvatar(p.name||'Player',p.id,p.skin); scene.add(mesh); mesh.position.set(p.x||0,p.y||0,p.z||0); others.set(p.id,{seen:performance.now(),name:p.name||'Player',mesh,x:p.x||0,y:p.y||0,z:p.z||0,yaw:0,pitch:0}); }
function removeOther(id){ const o=others.get(id); if(o){ scene.remove(o.mesh); disposeObj(o.mesh); others.delete(id); } }
function handleNet(m){
  switch(m.t){
    case 'init': {
      mp=true; myId=m.id; mpMotd=m.motd||''; mpEconomy=!!m.economy; kickReason='';
      const byChunk={}; for(const [x,y,z,id] of m.edits) (byChunk[ck(x>>4,z>>4)] ??= {})[(x&15)+16*((z&15)+16*y)]=id;
      clearMobViews(); lobbyVis.clear(); for(const id of [...others.keys()]) removeOther(id);
      resetWorld(m.seed,m.gen||{type:'normal'},byChunk);
      MODE=GEN.mode||'creative'; arena.reset(); document.body.classList.toggle('mode-lobby',MODE==='lobby'); P.fly=false; if(!survival()){ if(!hotbar.some(Boolean)) hotbar=[...DEFAULT_HOTBAR]; } else { hotbar=[0,0,0,0,0,0,0,0,0]; for(const k in items) delete items[k]; }
      if(MODE==='bedwars') hotbar=[12,8,3,9,23,22,24,20,21]; else if(MODE==='td') hotbar=[29,12,22,23,3,9,0,0,0]; // building modes: sensible block kits (td slot 1 = gold block = turret)
      setCoins(0,true);
      timeSync.t=m.time.t; timeSync.len=m.time.len; timeSync.at=performance.now(); worldTime=m.time.t;
      setWeather(m.weather||'clear',true);
      m.players.forEach(addOther); netMobTargets=(m.mobs||[]).map(decodeMob); renderHotbar(); setMpStatus(true);
      if(m.spawn) [P.x,P.y,P.z]=m.spawn; P.ready=false; P.vx=P.vy=P.vz=0;
      break; }
    case 'join': addOther(m); break;
    case 'leave': removeOther(m.id); break;
    case 'players': for(const p of m.list){ const o=others.get(p[0]); if(o){ o.x=p[1];o.y=p[2];o.z=p[3];o.yaw=p[4];o.pitch=p[5];o.st=p[6]|0; } } break;
    case 'mobs': netMobTargets=m.list.map(decodeMob); break;
    case 'block': setBlock(m.x,m.y,m.z,m.id,true); break;
    case 'blocks': for(const b of m.list) setBlock(b[0],b[1],b[2],b[3],true); break;
    case 'chat': if(!muted.has(m.name)) addChat(m.name,m.text,m.sys); break;
    case 'pong': pingMs=Math.round(performance.now()-m.ts); break;
    case 'time': timeSync.t=m.tt; timeSync.len=m.len; timeSync.at=performance.now(); break;
    case 'edits': for(const [x,y,z,id] of m.list) setBlock(x,y,z,id,true); break;
    case 'inv': syncItems(m.items||{}); break;
    case 'wallet': setCoins(m.coins|0); break;
    case 'prices': mpPrices=m.list||{}; mpBounties=m.bounties||[]; if(modalOpen&&typeof refreshModal==='function') refreshModal(); break;
    case 'traded': showToast((m.action==='sell'?'Sold ':'Bought ')+m.n+' '+NAMES[m.id]+' ('+(m.action==='sell'?'+':'-')+m.total+' coins)'); sfx(m.action==='sell'?700:420,.1,'triangle',.08); break;
    case 'mg': case 'hp': case 'reload': case 'hitmark': case 'shot': case 'kill': arena.handle(m); break;
    case 'lobby': lobbyVis.handle(m); break;
    case 'transfer': travel(m); break;
    case 'toast': showToast(m.text); break;
    case 'weather': setWeather(m.type); break;
    case 'dmg': hurt(m.n); P.vx+=m.kx||0; P.vz+=m.kz||0; P.vy=Math.max(P.vy,4); break;
    case 'fx': if(m.kind==='mobdie'){ burstColor(m.x,m.y,m.z,m.burn?0x777777:MOB_COLOR[m.mtype],20); if(!m.burn) sfx(90,.2,'sawtooth',.1); } break;
    case 'tp': [P.x,P.y,P.z]=[m.x,m.y,m.z]; P.vx=P.vy=P.vz=0; break;
    case 'kick': intentionalClose=true; kickReason=String(m.reason||'Disconnected').slice(0,120); showToast('Disconnected: '+kickReason); break;
  }
}
/** Binary state frame from the server: [3][u16 n]{u16 id,f32 x,y,z,i16 yaw,i16 pitch,u8 st} [u16 n]{u16 id,u8 type,f32 x,y,z,i16 yaw,u8 hp,u8 flags} */
function handleBinary(buf){
  const dv=new DataView(buf); if(dv.getUint8(0)!==3) return; let o=1; const now=performance.now(), np=dv.getUint16(o,true); o+=2;
  for(let i=0;i<np;i++,o+=19){ const ob=others.get(dv.getUint16(o,true)); if(!ob) continue; ob.x=dv.getFloat32(o+2,true); ob.y=dv.getFloat32(o+6,true); ob.z=dv.getFloat32(o+10,true); ob.yaw=dv.getInt16(o+14,true)/1000; ob.pitch=dv.getInt16(o+16,true)/1000; ob.st=dv.getUint8(o+18); ob.seen=now; }
  const nm=dv.getUint16(o,true); o+=2; const list=new Array(nm);
  for(let i=0;i<nm;i++,o+=19){ const fl=dv.getUint8(o+18); list[i]={id:dv.getUint16(o,true),type:MOB_TYPES[dv.getUint8(o+2)],x:dv.getFloat32(o+3,true),y:dv.getFloat32(o+7,true),z:dv.getFloat32(o+11,true),yaw:dv.getInt16(o+15,true)/1000,hurt:!!(fl&1),atk:!!(fl&2)}; }
  netMobTargets=list;
}
const decodeMob=a=>({id:a[0],type:MOB_TYPES[a[1]],x:a[2],y:a[3],z:a[4],yaw:a[5],hurt:!!a[7],atk:!!a[8]});
const chatEl=document.getElementById('chat'), chatLog=document.getElementById('chatlog'), chatIn=document.getElementById('chatin'), plistEl=document.getElementById('plist'), netEl=document.getElementById('net');
let chatOpen=false, pingMs=0, plistOn=false;
function addChat(name,text,sys){
  const d=document.createElement('div'); d.className='msg'+(sys?' sys':'');
  if(!sys){ const b=document.createElement('b'); b.textContent=name+': '; d.append(b); } d.append(document.createTextNode(text));
  chatLog.append(d); while(chatLog.children.length>60) chatLog.firstChild.remove(); chatLog.scrollTop=1e9; setTimeout(()=>d.classList.add('old'),9000);
}
function openChat(){ if(!ws||chatOpen) return; chatOpen=true; chatEl.classList.add('open'); chatIn.style.display='block'; chatIn.value=''; for(const k in keys) keys[k]=false; mouseL=false; chatIn.focus(); }
function closeChat(send){
  if(send&&chatIn.value.trim()&&ws&&ws.readyState===1) ws.send(JSON.stringify({t:'chat',text:chatIn.value.trim().slice(0,200)}));
  chatOpen=false; chatEl.classList.remove('open'); chatIn.style.display='none'; chatIn.blur(); chatIn.value='';
}
function renderPlist(){
  const colour=id=>'hsl('+((id*49)%360)+',60%,55%)';
  const rows=[`<div class="p"><span><span class="dotc" style="background:var(--acc)"></span>${esc(nickShown())} (you)</span><i>${pingMs} ms${economyOn()?' &middot; '+coins+' c':''}</i></div>`];
  for(const [id,o] of others) rows.push(`<div class="p" data-pid="${id}"><span><span class="dotc" style="background:${colour(id)}"></span>${esc(o.name)}${muted.has(o.name)?' (muted)':''}</span><i>${Math.hypot(o.x-P.x,o.z-P.z)|0} m</i></div>`);
  plistEl.innerHTML='<h3>Players - '+(others.size+1)+'</h3>'+rows.join('')+'<div style="opacity:.5;font-size:11px;margin-top:8px">Release Tab &middot; hold Alt+Tab list to click a player</div>';
}
plistEl.addEventListener('click',e=>{ const row=e.target.closest('[data-pid]'); if(row){ const o=others.get(+row.dataset.pid); if(o) openPlayerModal({...o,id:+row.dataset.pid}); } });
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nickShown=()=>(document.getElementById('nick').value.trim()||'Player').slice(0,16);
function setMpStatus(on,msg){
  const bar=document.getElementById('mpbar'), local=/^(localhost|127\.|\[)/.test(location.hostname);
  bar.classList.add('on'); document.getElementById('mpdot').classList.toggle('bad',!on);
  document.getElementById('mptxt').textContent=on?'Connected'+(mpWorld?' to '+mpWorld:'')+' - '+(others.size+1)+' player(s)':(msg||'Disconnected');
  document.getElementById('invite').style.display=on&&location.protocol.startsWith('http')&&!local?'':'none';
  document.getElementById('reco').style.display=on?'none':'';
  netEl.style.display=on?'block':'none';
}
document.getElementById('invite').onclick=()=>{ try{ navigator.clipboard.writeText(location.origin); showToast('Invite link copied'); }catch(e){ showToast(location.origin); } };
document.getElementById('reco').onclick=()=>location.reload();
let intentionalClose=false, kickReason='', pendingPassword='';
function connectServer(url,name){
  return new Promise(res=>{
    let done=false, sock; try{ sock=new WebSocket(url); }catch(e){ return res(false); }
    const fin=v=>{ if(done) return; done=true; clearTimeout(to); if(!v){ try{sock.close();}catch(e){} } res(v); };
    const to=setTimeout(()=>fin(false),5000);
    sock.onopen=()=>sock.send(JSON.stringify({t:'hello',name,skin:activeProfile().skin,uid:UID,password:pendingPassword||undefined,v:2}));
    sock.binaryType='arraybuffer';
    sock.onmessage=ev=>{ netInB+=(typeof ev.data==='string'?ev.data.length:ev.data.byteLength||0); const nt=performance.now(); if(nt-netInT>1000){ netInRate=netInB*1000/(nt-netInT); netInB=0; netInT=nt; } if(typeof ev.data!=='string'){ handleBinary(ev.data); return; } let m; try{ m=JSON.parse(ev.data); }catch(e){ return; } if(m.t==='init'){ ws=sock; } handleNet(m); if(m.t==='init') fin(true); };
    sock.onerror=()=>fin(false);
    sock.onclose=()=>{ if(ws===sock){ ws=null; handleDisconnect(); } fin(false); };
  });
}
let reconnecting=false;
async function handleDisconnect(){
  if(intentionalClose){ // kicked by the server (maintenance, ban, ...): don't sit in a frozen world, go back to the menu and say why
    intentionalClose=false; const why=kickReason||'Disconnected'; mp=false;
    if(started){ if(document.pointerLockElement) document.exitPointerLock(); for(const id of [...others.keys()]) removeOther(id); clearMobViews(); closeChat(false); openMenu('main'); openModal({title:'Disconnected',render:b=>{ const p=document.createElement('p'); p.textContent=why; b.append(p); },actions:[{label:'OK',primary:true}]}); }
    return; }
  setMpStatus(false,'Connection lost - reconnecting...'); showToast('Connection lost - reconnecting...');
  if(reconnecting||!mpAddr) return; reconnecting=true; mp=false;
  for(let i=0;i<6;i++){
    await new Promise(r=>setTimeout(r,1500+i*1000));
    if(await connectServer(wsUrl(mpAddr,mpWorld),nickShown())){ reconnecting=false; showToast('Reconnected'); setMpStatus(true); return; }
  }
  reconnecting=false; setMpStatus(false,'Lost connection to server');
  if(started&&document.pointerLockElement) document.exitPointerLock(); openMenu('main'); closeChat(false);
  for(const id of [...others.keys()]) removeOther(id); clearMobViews();
}
function updateOthers(dt){
  const t=tNow(), nowMs=performance.now();
  for(const o of others.values()){ const m=o.mesh, k=Math.min(1,dt*12), ox=m.position.x, oz=m.position.z; m.visible=nowMs-o.seen<2500; if(!m.visible) continue;
    m.position.x+=(o.x-m.position.x)*k; m.position.y+=(o.y-m.position.y)*k; m.position.z+=(o.z-m.position.z)*k;
    const sp=Math.hypot(m.position.x-ox,m.position.z-oz)/Math.max(dt,1e-3); o.sp=(o.sp||0)+(sp-(o.sp||0))*Math.min(1,dt*8);
    let dy=o.yaw+Math.PI-m.rotation.y; dy=Math.atan2(Math.sin(dy),Math.cos(dy)); m.rotation.y+=dy*Math.min(1,dt*14);
    m.head.rotation.x=-o.pitch*.6; m.state=o.st|0; animateRig(m,o.sp,dt,t); }
}
let posT=0, netTick=0;
/** movement state flags shared with other players so their avatars can animate: 0 ground, 1 air, 2 swim, 3 sprint, 4 fly */
function moveState(){ if(P.fly) return 4; const w=isWater(getB(Math.floor(P.x),Math.floor(P.y+.9),Math.floor(P.z))); if(w) return 2; if(!P.onGround) return 1; return (keys.ShiftLeft||keys.ShiftRight)&&keys.KeyW?3:0; }



/* ============================ HUD ============================ */
function icon(id,size=38){
  const c=document.createElement('canvas'); c.width=c.height=size*2; const g=c.getContext('2d'); const t=TILES[id][id===GRASS?1:0];
  g.imageSmoothingQuality='high'; g.drawImage(atlas,(t%ATL)*TS,Math.floor(t/ATL)*TS,TS,TS,0,0,size*2,size*2); return c;
}
const hbEl=document.getElementById('hotbar'), toast=document.getElementById('toast');
function renderHotbar(){
  hbEl.innerHTML=''; const sv=survival();
  hotbar.forEach((id,i)=>{ const s=document.createElement('div'); s.className='slot'+(i===slot?' sel':'');
    if(id){ s.appendChild(icon(id)); if(sv){ const c=document.createElement('em'); c.textContent=items[id]||0; s.appendChild(c); if(!items[id]) s.style.opacity=.45; } }
    const n=document.createElement('i'); n.textContent=i+1; s.appendChild(n); hbEl.appendChild(s); });
  renderVitals();
}
let toastT; function showToast(t){ toast.textContent=t; toast.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>toast.classList.remove('show'),1900); }
function selectSlot(i){ slot=(i+9)%9; renderHotbar(); if(hotbar[slot]) showToast(NAMES[hotbar[slot]]); saveDirty=true; }
renderHotbar();

/* ============================ input / UI ============================ */
const toggleDebug=()=>{ cfg.debug=!cfg.debug; saveCfg(); dbg.style.display=cfg.debug?'block':'none'; };
document.getElementById('hudinfo').addEventListener('pointerdown',e=>{ if(IS_TOUCH){ e.preventDefault(); toggleDebug(); } });
const menu=document.getElementById('menu'), inv=document.getElementById('inv'), dbg=document.getElementById('debug'), waterEl=document.getElementById('water');
let started=false, invOpen=false, mouseL=false, mineT=0;
let needClick=false; // true after an automatic transfer: browsers refuse pointer lock without a click, so ask for one instead of dropping to drag-to-look
let fallback=false, paused=false; // fallback: pointer lock unavailable (embedded browsers)
/* ---- pointer capture: one routine that retries instead of giving up for the whole session ---- */
let lockFails=0, lastUnlockAt=0, lockWatch=0;
let lockMode='';
function requestLock(raw){
  lockMode=raw?'raw':'plain';
  try{ const pr=raw?canvas.requestPointerLock({unadjustedMovement:true}):canvas.requestPointerLock(); if(pr&&pr.catch) pr.catch(()=>{}); } // raw input = smoother aim; a refusal arrives as a pointerlockerror, handled below
  catch(e){ if(raw) requestLock(false); }
}
function captureMouse(){
  if(IS_TOUCH||!canvas.requestPointerLock){ fallback=true; return; } // touch screens / browsers without Pointer Lock: drag-to-look is the control scheme
  clearTimeout(lockWatch);
  const wait=Math.max(0,1350-(performance.now()-lastUnlockAt)); // Chrome refuses a re-lock for ~1.25 s after the user leaves with Esc
  setTimeout(()=>{
    if(realLock()) return;
    requestLock(true);
    lockWatch=setTimeout(()=>{ if(!realLock()&&started&&!needClick) lockFailed(); },1800);  // neither lock nor error arrived: treat as a failure
  },wait);
}
function lockFailed(){
  lockFails++;
  if(lockFails<=1){ needClick=true; showClickPlay(); }                 // first failure: almost always "needs a click": ask for one
  else { fallback=true; paused=false; closeMenu(); showToast('No mouse capture: drag to look, click to break. Click the game to try capturing again.'); }
}
let modalOpen=false;
const lobbyVis=createLobby({THREE,scene});
/** Walk into a lobby portal (or /lobby): remember where to go, then reload for a clean slate and auto-join there. */
function travel(m){ try{ sessionStorage.setItem('voxel_autojoin',JSON.stringify({addr:mpAddr,world:m.world,pw:pendingPassword||''})); }catch(e){} showToast('Entering '+(m.name||m.world)+'...'); intentionalClose=true; saveDirty=true; try{ writeSave(); }catch(e){} setTimeout(()=>location.reload(),250); }
const arena=createArena({THREE,scene,camera,P,canvas,mode:()=>MODE,myId:()=>myId,send:o=>{ if(ws&&ws.readyState===1) ws.send(JSON.stringify(o)); },sfx:(...a)=>sfx(...a),inGame:()=>started&&mp,canPlay:()=>started&&locked()&&!chatOpen&&!modalOpen,flashHurt:()=>{ const h=document.getElementById('hurt'); h.style.opacity=1; setTimeout(()=>h.style.opacity=0,120); }});
window.__arena=arena; const inArena=()=>mp&&arena.active();
/** gun-only modes (everything FPS except Bed Wars / Tower Defence): no block outline, held block, hotbar, mining or block raycast. Derived from the mode every frame so it is right from the very first frame. */
function fpsOnly(){ return inArena()&&arena.pvp()&&!arena.builds(); }
const locked=()=>!modalOpen&&(document.pointerLockElement===canvas || (fallback&&started&&!paused&&!invOpen));
let invCat='all';
const tipEl=document.getElementById('tooltip');
function bindTip(el,id){
  el.onmouseenter=el.onmousemove=e=>{
    let h='<b>'+esc(NAMES[id])+'</b>'; if(survival()&&items[id]) h+='<div>You have '+items[id]+'</div>';
    if(economyOn()){ const sp=sellP(id), bp=buyP(id); if(sp) h+='<div class="g">Sells for '+sp+' c'+(bp?' &middot; buy '+bp+' c':'')+'</div>'; }
    tipEl.innerHTML=h; tipEl.style.display='block'; tipEl.style.left=Math.min(innerWidth-250,e.clientX+16)+'px'; tipEl.style.top=(e.clientY+16)+'px'; };
  el.onmouseleave=()=>{ tipEl.style.display='none'; };
}
function renderInv(){
  tipEl.style.display='none';
  const sv=survival(), g=document.getElementById('grid'), q=document.getElementById('invsearch').value.trim().toLowerCase();
  document.getElementById('invtitle').textContent=sv?'Survival inventory':'Creative inventory';
  document.getElementById('invbody').classList.toggle('sv',sv);
  const tabs=document.getElementById('invtabs'); tabs.style.display=sv?'none':'flex'; tabs.innerHTML='';
  for(const k of Object.keys(CATS)){ const t=document.createElement('span'); t.textContent=k[0].toUpperCase()+k.slice(1); if(k===invCat) t.className='on'; t.onclick=()=>{ invCat=k; renderInv(); }; tabs.append(t); }
  g.innerHTML=''; let n=0;
  for(let id=1;id<NAMES.length;id++){
    if(isWater(id)&&(id!==WATER||sv)) continue; if(sv&&!items[id]) continue; if(!sv&&CATS[invCat]&&!CATS[invCat].includes(id)) continue; if(q&&!NAMES[id].toLowerCase().includes(q)) continue;
    const s=document.createElement('div'); s.className='slot'; s.appendChild(icon(id,44)); bindTip(s,id); s.draggable=true; s.ondragstart=e=>{ e.dataTransfer.setData('text/plain',String(id)); e.dataTransfer.effectAllowed='copy'; };
    if(sv){ const c=document.createElement('em'); c.textContent=items[id]; s.appendChild(c); }
    s.onclick=()=>{ hotbar[slot]=id; renderHotbar(); renderInv(); showToast(NAMES[id]); saveDirty=true; }; g.append(s); n++;
  }
  if(!n){ g.innerHTML='<div class="empty" style="grid-column:1/-1">'+(sv?'Nothing yet - go mine some blocks!':'No blocks match.')+'</div>'; }
  const cr=document.getElementById('craft'); cr.innerHTML='';
  if(sv){ const h=document.createElement('h3'); h.textContent='Crafting'; h.style.margin='0 0 8px'; cr.append(h);
    for(const rc of RECIPES){ const can=Object.entries(rc.inp).every(([id,c])=>(items[id]||0)>=c);
      const row=document.createElement('div'); row.className='rec'; row.appendChild(icon(rc.out,30));
      const info=document.createElement('div'); info.className='ing'; info.innerHTML='<b style="opacity:1">'+rc.n+'x '+NAMES[rc.out]+'</b><br>'+Object.entries(rc.inp).map(([id,c])=>c+' '+NAMES[id]).join(', ');
      const b=document.createElement('button'); b.textContent='Craft'; b.disabled=!can;
      b.onclick=()=>{ if(mp){ ws&&ws.readyState===1&&ws.send(JSON.stringify({t:'craft',r:RECIPES.indexOf(rc)})); sfx(300,.08,'triangle',.06); return; } for(const [id,c] of Object.entries(rc.inp)){ items[id]-=c; if(items[id]<=0){ delete items[id]; hotbar=hotbar.map(h=>h===+id?0:h); } } addItem(rc.out,rc.n); sfx(300,.08,'triangle',.06); renderInv(); };
      row.append(info,b); cr.append(row); } }
  const bar=document.getElementById('invbar'); bar.innerHTML='';
  hotbar.forEach((id,i)=>{ const s=document.createElement('div'); s.className='slot'+(i===slot?' sel':''); if(id){ s.appendChild(icon(id,44)); if(sv){ const c=document.createElement('em'); c.textContent=items[id]||0; s.appendChild(c); } }
    const nn=document.createElement('i'); nn.textContent=i+1; s.appendChild(nn); s.onclick=()=>{ selectSlot(i); renderInv(); }; if(id) bindTip(s,id);
    s.ondragover=e=>{ e.preventDefault(); s.style.background='rgba(94,234,212,.3)'; }; s.ondragleave=()=>{ s.style.background=''; };
    s.ondrop=e=>{ e.preventDefault(); const d=+e.dataTransfer.getData('text/plain'); if(d>0&&d<NAMES.length){ hotbar[i]=d; slot=i; renderHotbar(); renderInv(); saveDirty=true; sfx(500,.05,'triangle',.05); } };
    bar.append(s); });
}
function toggleInv(){
  tipEl.style.display='none'; invOpen=!invOpen; inv.style.display=invOpen?'grid':'none';
  if(invOpen){ tut.inv=true; for(const k in keys) keys[k]=false; mouseL=false; renderInv(); document.exitPointerLock(); } else if(!fallback) captureMouse();
}
document.getElementById('invsearch').oninput=renderInv;
document.getElementById('invsearch').onkeydown=e=>{ e.stopPropagation(); if(e.key==='Escape') toggleInv(); };
document.addEventListener('pointerlockerror',()=>{ if(lockMode==='raw'&&!realLock()){ requestLock(false); return; } /* raw input unsupported here: retry plain, not a failure */ clearTimeout(lockWatch); lockMode=''; if(needClick||!started) return; lockFailed(); });
const loadEl=document.getElementById('load'), nickEl=document.getElementById('nick');
let curPage='main';
const ACTIONS=[['forward','Move forward','KeyW'],['back','Move backward','KeyS'],['left','Strafe left','KeyA'],['right','Strafe right','KeyD'],['jump','Jump / swim up','Space'],['sprint','Sprint / fly down','ShiftLeft'],['fly','Toggle flight','KeyF'],['inventory','Inventory','KeyE'],['chat','Chat (multiplayer)','Enter'],['players','Player list','Tab'],['view','Camera view','F5'],['hud','Hide interface','F1'],['shot','Screenshot','F2'],['debug','Debug info','F3'],['help','Controls overlay','KeyH'],['skip','Skip time','KeyN']];
let binds={}; try{ binds=JSON.parse(localStorage.getItem('voxel_binds'))||{}; }catch(e){}
const bindOf=a=>binds[a[0]]||a[2];
let tr={}, defaultSet=new Set(ACTIONS.map(a=>a[2]));
function buildTr(){ tr={}; for(const a of ACTIONS) tr[bindOf(a)]=a[2]; }
buildTr();
function remapEv(ev){ const code=tr[ev.code]??(defaultSet.has(ev.code)?'None':ev.code); return new Proxy(ev,{get(t,k){ if(k==='code') return code; const v=t[k]; return typeof v==='function'?v.bind(t):v; }}); }
function keyName(c){ return ({ShiftLeft:'Shift',ShiftRight:'Shift',ControlLeft:'Ctrl',ControlRight:'Ctrl',AltLeft:'Alt',Space:'Space',Backquote:'`',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right'})[c]||c.replace(/^Key|^Digit/,''); }
const K=id=>keyName(bindOf(ACTIONS.find(a=>a[0]===id)));
function helpRows(){ return ACTIONS.map(a=>`<div class="kr"><span>${a[1]}</span><kbd>${keyName(bindOf(a))}</kbd></div>`).join('')+'<div class="kr"><span>Break / attack</span><kbd>LMB</kbd></div><div class="kr"><span>Place / talk</span><kbd>RMB</kbd></div><div class="kr"><span>Pick block</span><kbd>MMB</kbd></div><div class="kr"><span>Hotbar</span><kbd>1-9 / Wheel</kbd></div>'; }
function renderBinds(){
  const box=$('tab-keys'); box.innerHTML='';
  for(const a of ACTIONS){ const row=document.createElement('div'); row.className='row bindrow'; row.innerHTML='<span>'+a[1]+'</span>'; const b=document.createElement('button'); b.textContent=keyName(bindOf(a));
    b.onclick=()=>{ b.textContent='Press a key...'; b.classList.add('cap');
      const h=ev=>{ ev.preventDefault(); ev.stopImmediatePropagation(); removeEventListener('keydown',h,true); b.classList.remove('cap');
        if(ev.code!=='Escape'){ const old=bindOf(a), other=ACTIONS.find(o=>o!==a&&bindOf(o)===ev.code); if(other) binds[other[0]]=old; binds[a[0]]=ev.code; try{ localStorage.setItem('voxel_binds',JSON.stringify(binds)); }catch(e){} buildTr(); }
        renderBinds(); renderHelp(); };
      addEventListener('keydown',h,true); };
    row.append(b); box.append(row); }
  const rs=document.createElement('button'); rs.className='ghost'; rs.style.margin='12px 0 0'; rs.textContent='Reset to defaults'; rs.onclick=()=>{ binds={}; try{ localStorage.removeItem('voxel_binds'); }catch(e){} buildTr(); renderBinds(); renderHelp(); }; box.append(rs);
}
function renderHelp(){ $('helpkeys').innerHTML=helpRows(); $('keyhelp').innerHTML='<h3>Controls</h3>'+helpRows()+'<div class="sub" style="margin:8px 0 0;font-size:11px">Press '+K('help')+' to close</div>'; }
renderBinds(); renderHelp();
const TIPS=['Hold the left mouse button to mine blocks in survival mode.','Press F5 to switch between first and third person.','Press F2 to save a screenshot.','Trees give logs - craft them into planks.','Sand next to water is a great place for clay.','Press Tab in multiplayer to see who is online.','Fall more than three blocks and it will hurt.','You can change the time of day in Settings.','Use the middle mouse button to pick a block.','Press F1 to hide the interface.'];
const setLoad=m=>$('loadmsg').textContent=m;
let tipTimer=0;
function showLoad(msg,pct){ setLoad(msg); const tip=$('loadtip'); tip.textContent='Tip: '+TIPS[Math.random()*TIPS.length|0]; const p=pct||5; $('loadbar').style.width=p+'%'; $('loadpct').textContent=Math.round(p)+'%'; loadEl.style.opacity=1; loadEl.style.pointerEvents='none';
  clearInterval(tipTimer); tipTimer=setInterval(()=>{ if(loadEl.style.opacity==='0'){ clearInterval(tipTimer); return; } tip.style.opacity=0; setTimeout(()=>{ tip.textContent='Tip: '+TIPS[Math.random()*TIPS.length|0]; tip.style.opacity=.6; },350); },4200); }
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('on',p.id==='pg-'+id)); curPage=id;
  if(id==='mp') startBrowser(); else stopBrowser();
  if(id==='main') refreshMain(); if(id==='single') refreshSingle();
  styleMenu();
}
function openMenu(page='main'){ tipEl.style.display='none'; if(document.pointerLockElement) document.exitPointerLock(); menu.style.display='grid'; showPage(page); styleMenu(); }
function styleMenu(){ const rail=!started&&curPage==='main'; menu.classList.toggle('title',rail); menu.classList.toggle('paused',started); $('shell').classList.toggle('railmode',rail); }
function closeMenu(){ menu.style.display='none'; stopBrowser(); }
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>showPage(b.dataset.go));
function refreshMain(){
  $('b-play').querySelector('span').textContent=started?'Resume':'Singleplayer'; $('b-mp').style.display=started?'none':''; $('b-quit').style.display=started?'':'none'; $('b-lobby').style.display=(started&&ws&&MODE!=='lobby')?'':'none';
  $('b-quit').querySelector('span').textContent=ws?'Disconnect & quit':'Save & quit to title';
  $('tagline').textContent=ws?'Playing online':started?'Game paused':'An infinite procedurally generated block world';
}
const TYPE_NAMES={normal:'Normal',flat:'Superflat',mountains:'Mountains',islands:'Islands'};
const previewCache=new Map();
/** Paint a top-down colour map of the terrain a seed would generate (cheap: just the height function). */
function paintWorldPreview(cv,seed,type){
  const key=cv.width+':'+seed+':'+type; const g=cv.getContext('2d'), N=cv.width;
  if(previewCache.has(key)){ g.putImageData(previewCache.get(key),0,0); return; }
  const w=createWorldGen(seed,{type}), img=g.createImageData(N,N), step=Math.max(2,Math.round(480/N));
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const h=w.terrainH((i-N/2)*step,(j-N/2)*step), o=(j*N+i)*4; let r,gg,b;
    if(h<=SEA){ const d=Math.min(1,(SEA-h)/12); r=40-d*25; gg=110-d*50; b=190-d*60; }
    else if(h<=SEA+1){ r=222;gg=208;b=158; }
    else if(h>56){ r=240;gg=244;b=250; } else if(h>46){ const t=(h-46)/10; r=118+t*60;gg=118+t*60;b=124+t*60; }
    else { const t=Math.min(1,(h-SEA)/26); r=78+t*30; gg=152-t*34; b=52+t*14; }
    img.data[o]=r; img.data[o+1]=gg; img.data[o+2]=b; img.data[o+3]=255;
  }
  const sp=w.findSpawn(); g.putImageData(img,0,0); previewCache.set(key,g.getImageData(0,0,N,N));
}
const ago=t=>{ const m=(Date.now()-t)/60000|0; return m<1?'just now':m<60?m+' min ago':m<1440?(m/60|0)+' h ago':(m/1440|0)+' days ago'; };
function refreshSingle(){ renderWorldList(); }
function renderWorldList(){
  const box=$('worldlist'); box.replaceChildren();
  const list=worldIndex.slice().sort((a,b)=>(b.id===curId)-(a.id===curId)||b.lastPlayed-a.lastPlayed);
  for(const w of list){
    const cur=w.id===curId, card=document.createElement('div'); card.className='wcard'+(cur?' cur':'');
    const cv=document.createElement('canvas'); cv.width=cv.height=39; card.append(cv); try{ paintWorldPreview(cv,w.seed,w.gen?.type||'normal'); }catch(e){}
    const info=document.createElement('div'); info.className='wi';
    const sv=w.gen?.mode==='survival'||w.gen?.mode==='career', modeName=w.gen?.mode==='career'?'career':sv?'survival':'creative';
    info.innerHTML='<div class="wn2">'+esc(w.name)+'</div><div class="wm2"><span class="badge '+(sv?'sv':'cr')+'">'+modeName+'</span>'+(sv&&w.gen?.economy!==false?'<span class="badge eco">economy</span>':'')+'</div><div class="ws">'+(TYPE_NAMES[w.gen?.type]||'Normal')+' &middot; seed '+esc(String(w.seed))+' &middot; played '+ago(w.lastPlayed)+(cur&&Object.keys(edits).length?' &middot; '+Object.keys(edits).length+' edited chunks':'')+'</div>';
    const btns=document.createElement('div'); btns.className='wb';
    const play=document.createElement('button'); play.textContent=cur?'Continue':'Play'; if(!cur) play.className='ghost';
    play.onclick=()=>{ if(cur) launch(''); else switchWorld(w.id); };
    const more=document.createElement('div'); more.style.cssText='display:flex;gap:6px';
    const ren=document.createElement('button'); ren.className='ghost'; ren.textContent='Rename'; ren.style.cssText='flex:1;padding:6px 10px;font-size:12px'; ren.onclick=()=>promptModal('Rename world','World name','text',v=>{ v=(v||'').trim().slice(0,28); if(v){ w.name=v; saveIndex(); renderWorldList(); } });
    const del=document.createElement('button'); del.className='ghost'; del.textContent='Delete'; del.style.cssText='flex:1;padding:6px 10px;font-size:12px;color:var(--bad)'; del.disabled=worldIndex.length<2; del.title=worldIndex.length<2?'Create another world first':'';
    del.onclick=()=>confirmModal('Delete world','Delete "'+w.name+'" forever? Its terrain edits, inventory and coins will be lost.',()=>deleteWorld(w.id),true);
    more.append(ren,del); btns.append(play,more); card.append(info,btns); box.append(card);
  }
}
function switchWorld(id){ try{ localStorage.setItem(CUR_KEY,id); sessionStorage.setItem('voxel_page','single'); }catch(e){} noSave=true; location.reload(); }
async function deleteWorld(id){
  try{ await idbDel('w:'+id); for(const k of await idbKeys()) if(typeof k==='string'&&k.startsWith('e:'+id+':')) await idbDel(k); }catch(e){}
  worldIndex=worldIndex.filter(w=>w.id!==id); saveIndex();
  if(id===curId){ const next=worldIndex.slice().sort((a,b)=>b.lastPlayed-a.lastPlayed)[0]; switchWorld(next.id); } else renderWorldList();
}
/* ---- world creation wizard ---- */
const wiz={mode:'creative',type:'normal',seed:null};
function wizSeed(){ const t=$('seedin').value.trim(); if(!t){ if(wiz.seed===null) wiz.seed=Math.random()*1e9|0; return wiz.seed; } return seedFrom(t); }
let prevT=0; function wizPreview(){ clearTimeout(prevT); prevT=setTimeout(()=>{ const seed=wizSeed(); paintWorldPreview($('prevworld'),seed,wiz.type); $('previnfo').textContent=TYPE_NAMES[wiz.type]+' - seed '+seed; },90); }
function openWizard(){
  const n=worldIndex.length+1; $('wname').value='World '+n; $('seedin').value=''; wiz.seed=Math.random()*1e9|0; wiz.mode='creative'; wiz.type='normal';
  syncWizCards(); showPage('create'); wizPreview(); setTimeout(()=>$('wname').select(),50);
}
function syncWizCards(){
  for(const b of $('modecards').children){ const on=b.dataset.mode===wiz.mode; b.classList.toggle('on',on); b.setAttribute('aria-checked',on); }
  for(const b of $('typecards').children){ const on=b.dataset.type===wiz.type; b.classList.toggle('on',on); b.setAttribute('aria-checked',on); }
  $('gentype').value=wiz.type; $('genmode').value=wiz.mode; $('row-eco').style.display=wiz.mode==='survival'||wiz.mode==='career'?'':'none';
  $('opt-hostile').disabled=!$('opt-npc').checked;
}
$('b-newworld').onclick=openWizard;
$('modecards').addEventListener('click',e=>{ const b=e.target.closest('.card2'); if(b){ wiz.mode=b.dataset.mode; syncWizCards(); } });
$('typecards').addEventListener('click',e=>{ const b=e.target.closest('.card2'); if(b){ wiz.type=b.dataset.type; syncWizCards(); wizPreview(); } });
$('b-dice').onclick=()=>{ $('seedin').value=''; wiz.seed=Math.random()*1e9|0; wizPreview(); sfx(500,.06,'triangle',.05); };
$('seedin').addEventListener('input',wizPreview); $('opt-npc').onchange=syncWizCards;
$('opt-day').oninput=()=>{ const v=+$('opt-day').value; $('daylbl').textContent=(v/60<10?(v/60).toFixed(1).replace('.0',''):Math.round(v/60))+' min'; };
$('wname').onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter') $('b-create').click(); };
$('b-create').onclick=()=>{
  const id=newWorldId(), name=($('wname').value||'').trim().slice(0,28)||('World '+(worldIndex.length+1)), seed=wizSeed();
  const gen={type:wiz.type,mode:wiz.mode,mobs:$('opt-npc').checked,hostile:$('opt-npc').checked&&$('opt-hostile').checked,weather:$('opt-weather').checked,economy:wiz.mode==='survival'&&$('opt-eco').checked,day:+$('opt-day').value,startTime:+$('opt-time').value};
  worldIndex.push({id,name,seed,gen,created:Date.now(),lastPlayed:Date.now()}); saveIndex(); switchWorld(id);
};
function showClickPlay(){
  let el=document.getElementById('clickplay'); if(!el){ el=document.createElement('div'); el.id='clickplay'; el.innerHTML='<div class="cp-box"><div class="cp-ico"></div><b>Click to play</b><span>Your mouse will be captured. Press Esc any time to release it.</span></div>'; document.body.append(el); }
  el.style.display='grid'; const go=e=>{ e.preventDefault(); needClick=false; el.style.display='none'; el.removeEventListener('pointerdown',go); captureMouse(); }; el.addEventListener('pointerdown',go);
}
function resume(){
  paused=false; closeMenu();
  if(needClick&&!IS_TOUCH){ showClickPlay(); return; }
  captureMouse();
}

const schemeFor=a=>/^https?:\/\//.test(a)?a.split(':')[0]:(location.protocol==='https:'||/\.(trycloudflare\.com|workers\.dev|ngrok[a-z.-]*)(:|$)/.test(a)||/:443$/.test(a))?'https':'http';
const baseUrl=a=>/^https?:\/\//.test(a)?a.replace(/\/$/,''):schemeFor(a)+'://'+a;
const wsBase=a=>/^wss?:\/\//.test(a)?a.replace(/\/+$/,''):baseUrl(a).replace(/^http/,'ws');
const wsUrl=(a,w)=>wsBase(a)+'/ws/'+encodeURIComponent(w||'main');
async function launch(addr,world,password){
  if(!started&&addr){
    pendingPassword=password||''; kickReason='';
    showLoad('Connecting to server...',15); $('mperr').textContent='';
    const ok=await connectServer(wsUrl(addr,world),nickShown());
    if(!ok){
      loadEl.style.opacity=0; intentionalClose=false;
      if(/password/i.test(kickReason)){ promptModal(password?'Wrong password':'Password required','This server is private. Enter the join password:','password',pw=>{ if(pw) launch(addr,world,pw); }); return false; }
      $('mperr').textContent=kickReason?('Could not join: '+kickReason):'Could not connect to '+addr; showToast(kickReason||'Could not connect to server'); return false; }
    mpAddr=addr; mpWorld=world||'main';
    try{ localStorage.setItem('voxel_nick',nickEl.value); }catch(e){}
    rememberServer(addr); showLoad('Generating world...',30);
  }
  if(!addr){ showLoad('Entering world...',100); setTimeout(()=>{ if(P.ready) loadEl.style.opacity=0; },900); }
  { const ce=curEntry(); if(ce&&!addr){ ce.lastPlayed=Date.now(); saveIndex(); } }
  started=true; document.body.classList.remove('title'); S.peak=P.y; renderHotbar();
  if(survival()) showToast('Survival mode'); resume(); return true;
}


$('b-play').onclick=()=>started?resume():showPage('single');
$('b-mp').onclick=()=>showPage('mp'); $('b-set').onclick=()=>showPage('set'); $('b-help').onclick=()=>showPage('help');
$('b-log').onclick=()=>{ $('logbody').innerHTML=CHANGELOG.map(r=>'<div class="panel"><b>v'+r.v+' · '+r.date+'</b> — '+r.title+'<ul style="margin:8px 0 0 18px;padding:0;font-size:13px;opacity:.85">'+r.items.map(i=>'<li>'+i.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</li>').join('')+'</ul></div>').join(''); showPage('log'); };

/* ---- game-style menu polish: key hints + number shortcuts, NEW badge, hint row, soft UI sounds ---- */
{ const ids=['b-play','b-mp','b-set','b-music','b-help','b-log']; music.bind(); $('b-music').onclick=()=>showPage('music');
  ids.forEach((id,k)=>{ const b=$(id); if(b&&!b.querySelector('.kh')){ const kh=document.createElement('span'); kh.className='kh'; kh.textContent=String(k+1); b.append(kh); } });
  let seen=''; try{ seen=localStorage.getItem('voxel_log_seen')||''; }catch(e){}
  const lb=$('b-log'); if(lb&&seen!==CHANGELOG[0].v){ const n=document.createElement('span'); n.className='nw'; n.textContent='NEW'; lb.querySelector('span')?.after(n); lb.addEventListener('click',()=>{ try{ localStorage.setItem('voxel_log_seen',CHANGELOG[0].v); }catch(e){} n.remove(); }); }
  const pc=$('b-player'); if(pc&&!document.querySelector('.menu-hint')){ const h=document.createElement('div'); h.className='menu-hint'; h.innerHTML='<span><kbd>1</kbd>-<kbd>6</kbd> select</span><span><kbd>Esc</kbd> back</span><span><kbd>Enter</kbd> confirm</span>'; pc.after(h); }
  addEventListener('keydown',e=>{ if(started||menu.style.display==='none'||e.ctrlKey||e.metaKey||e.altKey||/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'')||modalOpen) return;
    if(curPage==='main'){ const k=ids[+e.key-1]; if(k){ e.preventDefault(); $(k).click(); } }
    else if(e.key==='Escape'||e.key==='Backspace'){ e.preventDefault(); showPage('main'); } });
  let tickT=0; const tick=(f,v)=>{ const n=performance.now(); if(n-tickT<45) return; tickT=n; try{ sfx(f,.035,'triangle',v); }catch(e){} };
  menu.addEventListener('pointerover',e=>{ if(e.target.closest&&e.target.closest('button,.chip,.tabs span,.mi,.card2,.wcard')&&!e.pointerType?.startsWith('touch')) tick(560,.018); });
  menu.addEventListener('pointerdown',e=>{ if(e.target.closest&&e.target.closest('button,.chip,.tabs span,.mi,.card2')) tick(340,.03); }); }$('b-lobby').onclick=()=>{ if(ws&&ws.readyState===1) ws.send(JSON.stringify({t:'chat',text:'/lobby'})); };
$('b-quit').onclick=()=>{ saveDirty=true; writeSave(); location.reload(); };
$('b-respawn').onclick=()=>{ S.hp=20; S.dead=false; S.air=10; [P.x,P.y,P.z]=findSpawn(); P.vx=P.vy=P.vz=0; S.peak=P.y; $('death').style.display='none'; renderVitals(); resume(); };
const seedFrom=seedFromText;
/* ---- server browser ---- */
const SRV_KEY='voxel_servers'; let brTimer=null; const entries=new Map();
const savedList=()=>{ try{ return JSON.parse(localStorage.getItem(SRV_KEY))||[]; }catch(e){ return []; } };
const setSaved=l=>{ try{ localStorage.setItem(SRV_KEY,JSON.stringify(l)); }catch(e){} };
const normAddr=a=>a.trim().replace(/^(https?|wss?):\/\//,'').replace(/\/+$/,'');
function rememberServer(a){ a=normAddr(a); if(!a) return; const l=savedList(); if(!l.includes(a)&&a!==location.host) setSaved([...l,a]); }
const isLocalPage=()=>location.protocol==='file:'||/^(localhost|127\.|\[)/.test(location.hostname);
function buildEntries(){
  const add=(addr,tag,saved)=>{ const e=entries.get(addr); if(e){ if(saved) e.saved=true; return; } entries.set(addr,{addr,tag,state:'wait',info:null,saved:!!saved}); };
  if(location.protocol.startsWith('http')&&location.port!=='5173') add(location.host,'This site');
  if(location.protocol==='file:'||location.port==='5173') for(let p=8080;p<=8085;p++) add('localhost:'+p,'Local');
  for(const a of savedList()) add(a,'Saved',true);
}
async function probe(addr,ms=2500){
  const ctl=new AbortController(), t0=performance.now(), to=setTimeout(()=>ctl.abort(),ms);
  try{ const r=await fetch(baseUrl(addr)+'/api/info',{signal:ctl.signal,cache:'no-store'}); const j=await r.json(); return {ok:true,ping:Math.round(performance.now()-t0),info:j}; }
  catch(e){ return {ok:false}; } finally{ clearTimeout(to); }
}
async function refreshEntry(e){ const r=await probe(e.addr); e.state=r.ok?'on':'off'; e.info=r.info||null; e.ping=r.ping; renderBrowser(); }
function refreshBrowser(){ for(const e of entries.values()) refreshEntry(e); }
function startBrowser(){ buildEntries(); renderBrowser(); refreshBrowser(); stopBrowser(); brTimer=setInterval(refreshBrowser,8000); }
function stopBrowser(){ clearInterval(brTimer); brTimer=null; }
let srvFilter='all';
$('srvfilters').addEventListener('click',e=>{ const c=e.target.closest('.chip'); if(!c) return; srvFilter=c.dataset.f; for(const x of $('srvfilters').children) x.classList.toggle('on',x===c); renderBrowser.last=null; renderBrowser(); });
const pingBars=ms=>{ const n=ms<60?4:ms<120?3:ms<220?2:1; return '<span class="bars" title="'+ms+' ms">'+[1,2,3,4].map(i=>'<i class="'+(i<=n?'on':'')+'"></i>').join('')+'</span>'; };
function joinWorld(e,w){ if(e.info&&e.info.maintenance){ showToast('Under maintenance: '+e.info.maintenance); return; } const needPw=e.info&&e.info.locked; if(needPw) promptModal('Password required','This server is private. Enter the join password:','password',pw=>{ if(pw) launch(e.addr,w.id,pw); }); else launch(e.addr,w.id); }
function renderBrowser(){
  const q=($('srvsearch').value||'').trim().toLowerCase(), sort=$('srvsort').value;
  let list=[...entries.values()].filter(e=>e.state!=='off'||e.saved);
  const f=srvFilter; if(f==='fav') list=list.filter(e=>e.saved); else if(f==='players') list=list.filter(e=>(e.info?.worlds||[]).some(w=>w.players>0)); else if(f==='survival'||f==='creative') list=list.filter(e=>(e.info?.worlds||[]).some(w=>w.mode===f)); else if(f==='economy') list=list.filter(e=>(e.info?.worlds||[]).some(w=>w.economy));
  if(q) list=list.filter(e=>((e.info?.name||'')+' '+e.addr+' '+(e.info?.motd||'')+' '+(e.info?.worlds||[]).map(w=>w.name+' '+w.mode+' '+w.type).join(' ')).toLowerCase().includes(q));
  const players=e=>(e.info?.worlds||[]).reduce((a,w)=>a+w.players,0);
  list.sort((a,b)=>(a.saved===b.saved?0:a.saved?-1:1)||(a.state==='on'?0:1)-(b.state==='on'?0:1)||(sort==='players'?players(b)-players(a):sort==='name'?(a.info?.name||a.addr).localeCompare(b.info?.name||b.addr):(a.ping||1e9)-(b.ping||1e9)));
  const sig=srvFilter+JSON.stringify(list.map(e=>[e.addr,e.state,e.saved,e.tag,Math.round((e.ping||0)/30),e.info&&[e.info.name,e.info.motd,e.info.locked,e.info.maintenance,(e.info.worlds||[]).map(w=>[w.id,w.players,w.max])]]))+q+sort;
  if(sig===renderBrowser.last) return; renderBrowser.last=sig; // avoid rebuilding (and detaching buttons under the cursor) when nothing changed
  const box=$('srvlist');
  if(!list.length){ box.innerHTML='<div class="empty">'+(entries.size&&q?'No servers match your search.':'<b>No servers found yet</b><br>Add one below, scan your network, or host your own with <code>npm start</code>.')+'</div>'; return; }
  box.replaceChildren();
  for(const e of list){
    const i=e.info||{}, card=document.createElement('div'); card.className='srvcard';
    const lan=(i.lan&&i.lan.length)?' - LAN '+i.lan.join(', '):'', total=players(e);
    const head=document.createElement('div'); head.className='srv';
    head.innerHTML=`<span class="dot ${e.state}"></span><div class="meta"><div class="nm">${esc(i.name||e.addr)}${i.locked?' &#128274;':''}${i.maintenance?' <span class="tag" style="background:#fbbf24;color:#1a1200">maintenance</span>':''}<span class="tag">${esc(e.tag)}</span></div><div class="mo">${e.state==='on'?esc(i.motd||'')+esc(lan):e.state==='wait'?'<span class="spin"></span> Pinging...':'Offline - '+esc(e.addr)}</div></div><div class="st">${e.state==='on'?(total+' online'+pingBars(e.ping||0)+'<br><span style="opacity:.6">'+e.ping+' ms</span>'):''}</div>`;
    const star=document.createElement('button'); star.className='star'+(e.saved?' on':''); star.textContent=e.saved?'\u2605':'\u2606'; star.title=e.saved?'Remove from favourites':'Add to favourites';
    star.onclick=()=>{ if(e.saved){ setSaved(savedList().filter(a=>a!==e.addr)); e.saved=false; if(e.tag==='Saved') entries.delete(e.addr); } else { rememberServer(e.addr); e.saved=true; } renderBrowser(); };
    head.append(star); card.append(head);
    if(e.state==='on'){
      let worlds=i.worlds&&i.worlds.length?i.worlds:[{id:'main',name:'World',players:0,max:16,mode:'creative',type:'normal'}];
      const hub=worlds.find(w=>w.mode==='lobby'); if(hub){ const others=worlds.filter(w=>w.mode!=='lobby'&&!w.private), here=worlds.reduce((a,w)=>a+w.players,0); worlds=[{...hub,agg:true,games:others.length,total:here}]; } // servers with a lobby show just the lobby: everything else is a portal inside it
      for(const w of worlds){ const r=document.createElement('div'); r.className='srvworld'+(w.agg?' hub':'');
        if(w.agg){ r.innerHTML=`<span class="wn">&#127918; Game Lobby<small>${w.games} game${w.games===1?'':'s'} &middot; ${w.total} playing &middot; walk into a portal to play</small></span><span class="wp">${w.players}/${w.max}</span>`; const j=document.createElement('button'); j.textContent=w.players>=w.max?'Full':'Enter'; j.disabled=w.players>=w.max; j.onclick=()=>joinWorld(e,w); r.append(j); card.append(r); continue; }
        r.innerHTML=`<span class="wn">${esc(w.name)}</span><span class="badge ${w.mode!=='creative'?'sv':'cr'}">${esc(w.mode)}</span>${w.economy?'<span class="badge eco">economy</span>':''}<span class="wm">${esc(w.type)}</span><span class="wp">${w.players}/${w.max}</span>`;
        const j=document.createElement('button'); j.textContent=w.players>=w.max?'Full':'Join'; j.disabled=w.players>=w.max; j.onclick=()=>joinWorld(e,w); r.append(j); card.append(r); }
    }
    box.append(card);
  }
}
$('srvsearch').oninput=renderBrowser; $('srvsort').onchange=renderBrowser; $('srvsearch').onkeydown=e=>e.stopPropagation();
$('b-quick').onclick=()=>{
  const best=[...entries.values()].filter(e=>e.state==='on'&&!(e.info&&e.info.locked)).flatMap(e=>(e.info.worlds||[{id:'main',players:0,max:16}]).filter(w=>w.players<w.max).map(w=>({e,w,score:(e.ping||200)-w.players*25}))).sort((a,b)=>a.score-b.score)[0];
  if(!best){ $('mperr').textContent='No open servers found to quick-join.'; return; } launch(best.e.addr,best.w.id);
};
$('b-refresh').onclick=()=>{ for(const e of entries.values()) e.state='wait'; renderBrowser(); refreshBrowser(); };
$('b-add').onclick=()=>{ const a=normAddr($('direct').value); if(!a) return; rememberServer(a); $('direct').value=''; buildEntries(); renderBrowser(); refreshBrowser(); };
$('b-join').onclick=()=>{ const a=normAddr($('direct').value); if(a) launch(a,'main'); };
$('direct').onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter') $('b-join').click(); };
$('b-scan').onclick=async()=>{
  const pre=$('scanpre').value.trim().replace(/\.$/,''); if(!/^\d+\.\d+\.\d+$/.test(pre)){ $('mperr').textContent='Enter the first three numbers of your network, e.g. 192.168.1'; return; }
  if(location.protocol==='https:'){ $('mperr').textContent='LAN scanning needs the page opened over http or from the file.'; return; }
  try{ localStorage.setItem('voxel_scan',pre); }catch(e){} $('mperr').textContent=''; const btn=$('b-scan'); btn.disabled=true; let done=0, found=0;
  await Promise.all(Array.from({length:254},async(_,k)=>{ const a=pre+'.'+(k+1)+':8080'; const r=await probe(a,900); done++; btn.textContent='Scanning '+done+'/254';
    if(r.ok){ found++; entries.set(a,{addr:a,tag:'LAN',state:'on',info:r.info,ping:r.ping,saved:false}); renderBrowser(); } }));
  btn.disabled=false; btn.textContent='Scan port 8080'; $('mperr').textContent=found?'':'No servers found on '+pre+'.x';
};


for(const id of ['pname','seedin','scanpre']) $(id).onkeydown=e=>e.stopPropagation();
{ const m=/^(\d+\.\d+\.\d+)\.\d+$/.exec(location.hostname); try{ $('scanpre').value=m?m[1]:(localStorage.getItem('voxel_scan')||''); }catch(e){} }
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===canvas){ clearTimeout(lockWatch); lockFails=0; if(fallback){ fallback=false; showToast('Mouse captured'); } return; }
  lastUnlockAt=performance.now();
  if(!fallback&&!needClick&&!locked()&&!invOpen&&!modalOpen&&started&&!S.dead){ openMenu('main'); mouseL=false; }
});
let drag=null; const realLock=()=>document.pointerLockElement===canvas, clampM=v=>Math.max(-120,Math.min(120,v||0));
function look(dx,dy){ swayX=Math.max(-.12,Math.min(.12,swayX-dx*.0012)); swayY=Math.max(-.08,Math.min(.08,swayY-dy*.0012)); const sn=.0022*cfg.sens; P.yaw-=dx*sn; P.pitch=Math.max(-1.55,Math.min(1.55,P.pitch-dy*sn*(cfg.inv?-1:1))); }
addEventListener('mousemove',e=>{
  if(realLock()){ look(clampM(e.movementX),clampM(e.movementY)); return; }
  if(drag&&locked()){ const dx=e.clientX-drag.x, dy=e.clientY-drag.y; drag.x=e.clientX; drag.y=e.clientY; drag.moved+=Math.abs(dx)+Math.abs(dy); look(dx*1.4,dy*1.4); }
});
canvas.addEventListener('mousedown',e=>{
  if(fallback&&!IS_TOUCH&&started&&!realLock()&&!paused&&!invOpen&&!modalOpen&&!chatOpen) captureMouse(); // a click is a valid gesture: try to get the real lock back
  if(!locked()||chatOpen) return;
  if(targetEnt&&(e.button===0||e.button===2)){ if(e.button===0) attackMob(targetEnt); else interactMob(targetEnt); return; }
  if(!realLock()){ // no pointer lock: drag to look, click to break
    if(e.button===0) drag={x:e.clientX,y:e.clientY,moved:0}; else if(e.button===2) placeBlock(); return; }
  if(e.button===0){ mouseL=true; mineT=0; mine.p=0; if(!survival()) breakBlock(); } else if(e.button===2) placeBlock(); else if(e.button===1&&hit){ hotbar[slot]=hit.id; renderHotbar(); } });
addEventListener('mouseup',e=>{ if(e.button===0){ mouseL=false; if(drag&&drag.moved<6) breakBlock(); drag=null; } });
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',e=>{ if(locked()) selectSlot(slot+Math.sign(e.deltaY)); });
addEventListener('keydown',ev=>{ const e=remapEv(ev);
  if(chatOpen){ if(e.code==='Enter'){ e.preventDefault(); closeChat(true); } else if(e.code==='Escape'){ closeChat(false); } return; }
  if(e.code==='Enter'&&ws&&started&&locked()){ e.preventDefault(); openChat(); return; }
  if(e.code==='Tab'&&ws&&started){ e.preventDefault(); plistOn=true; renderPlist(); plistEl.style.display='block'; return; }
  if(e.code==='F3'){ e.preventDefault(); toggleDebug(); return; }
  if(e.code==='Tab'&&started&&locked()) e.preventDefault();
  if(e.code==='KeyP'&&started&&fallback){ paused=!paused; if(paused) openMenu('main'); else closeMenu(); mouseL=false; return; }
  if((e.code==='KeyE'||(e.code==='Escape'&&invOpen))&&started&&!S.dead){ toggleInv(); return; }
  if(!locked()) return;
  keys[e.code]=true;
  if(/^Digit[1-9]$/.test(e.code)) selectSlot(+e.code.slice(5)-1);
  if(e.code==='KeyF'){ if(survival()||inArena()) showToast('Flying is creative-only'); else{ P.fly=!P.fly; showToast(P.fly?'Flight on':'Flight off'); } }
  if(e.code==='KeyH'){ const kh=$('keyhelp'); kh.style.display=kh.style.display==='block'?'none':'block'; tut.help=true; }
  if(e.code==='F1'){ e.preventDefault(); document.body.classList.toggle('nohud'); }
  if(e.code==='F2'){ e.preventDefault(); renderFrame(); canvas.toBlob(b=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='voxel-realms-'+Date.now()+'.png'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }); showToast('Screenshot saved'); }
  if(e.code==='F5'){ e.preventDefault(); thirdP=(thirdP+1)%3; showToast(['First person','Third person (back)','Third person (front)'][thirdP]); }
  if(e.code==='KeyN'&&!mp){ worldTime=(worldTime+.12)%1; }
  if(e.code==='Space'||e.code.startsWith('Arrow')) e.preventDefault();
});
document.addEventListener('keydown',e=>{ // arrow-key navigation through the menu buttons
  if(menu.style.display==='none'||modalOpen||(e.key!=='ArrowDown'&&e.key!=='ArrowUp')) return;
  const items=[...menu.querySelectorAll('.page.on button:not([disabled]),.page.on .pl,.page.on select')].filter(x=>x.offsetParent); if(!items.length) return;
  const i=items.indexOf(document.activeElement); if(document.activeElement&&/INPUT|SELECT/.test(document.activeElement.tagName)) return;
  e.preventDefault(); items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
});
addEventListener('keyup',ev=>{ const e=remapEv(ev); keys[e.code]=false; if(e.code==='Tab'){ plistOn=false; plistEl.style.display='none'; } });

/* ---------------- touch controls (phones / tablets) ---------------- */
const TOUCH=(navigator.maxTouchPoints>0&&matchMedia('(pointer:coarse)').matches)||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
if(TOUCH){
  document.body.classList.add('touch');
  canvas.requestPointerLock=()=>{};                               // no pointer lock on touch screens: the game's drag-to-look fallback is used
  TUT.splice(0,TUT.length,['Drag on the left to move',()=>tut.moved>5],['Tap Jump to jump',()=>tut.jumped],['Hold the screen (or Break) to dig a block',()=>tut.broke],['Tap the screen (or Place) to build',()=>tut.placed],['Open the Bag to pick blocks',()=>tut.inv],['Tap Menu any time to pause',()=>tut.help]);
  const SV=p=>`<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const IC={ break:SV('<path d="M4 20l9-9"/><path d="M9.5 6.5C12.5 3.5 17 3.5 20.5 7.5"/><path d="M14.5 3.5c.5 4 3.5 7 6 6.5"/>'),
    place:SV('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>'),
    jump:SV('<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>'), menu:SV('<path d="M5 7h14M5 12h14M5 17h14"/>'),
    bag:SV('<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>'),
    down:SV('<path d="M6 11l6 6 6-6M6 5l6 6 6-6"/>'),
    run:SV('<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>'), fly:SV('<path d="M3 11.5L21 4l-7 17-3-7z"/>'),
    view:SV('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'), chat:SV('<path d="M4 5h16v11H9l-5 4z"/>') };
  let gunLbl=false;
  const btn=(id,ic,label)=>`<button id="${id}" aria-label="${label}"><i>${IC[ic]}</i><b>${label}</b></button>`;
  const ui=document.createElement('div'); ui.id='tui'; ui.style.display='none';
  ui.innerHTML='<div id="tlook"></div><i id="tghost"></i><div id="tstick"><i id="tring"></i><i id="tknob"></i></div>'
    +'<div id="tbtns">'+btn('tbreak','break','Break')+btn('tplace','place','Place')+btn('tjump','jump','Jump')+btn('tdown','down','Down')+'</div>'
    +'<div id="ttop">'+btn('tmenu','menu','Menu')+btn('tinv','bag','Bag')+btn('tsprint','run','Run')+btn('tfly','fly','Fly')+btn('tview','view','View')+btn('tchat','chat','Chat')+'</div>';
  document.body.appendChild(ui);
  const T=id=>document.getElementById(id), R=72, vib=n=>{ try{ navigator.vibrate&&navigator.vibrate(n); }catch(e){} };
  const live=()=>started&&!S.dead&&!invOpen&&!modalOpen&&!paused&&!chatOpen&&menu.style.display==='none';
  const fit=()=>{ const s=Math.min(1,(innerWidth-14)/(hbEl.offsetWidth||1),innerHeight<460?.62:1); hbEl.style.setProperty('--hbs',s.toFixed(3)); const r=hbEl.getBoundingClientRect(); ui.style.setProperty('--hbh',Math.max(0,innerHeight-r.top)+'px'); };
  addEventListener('resize',fit); addEventListener('orientationchange',()=>setTimeout(fit,250));
  setInterval(()=>{ const on=live(); ui.style.display=on?'block':'none'; T('tchat').style.display=ws?'':'none'; T('tfly').style.display=(survival()||inArena())?'none':''; T('tdown').style.display=P.fly?'':'none'; { const g=gunOn(); if(g!==gunLbl){ gunLbl=g; T('tbreak').lastChild.textContent=g?'Fire':'Break'; T('tplace').lastChild.textContent=g&&!arena.builds()?'Reload':'Place'; } } T('tsprint').style.display=P.fly?'none':''; fit();
    if(!on){ axis.on=false; axis.x=axis.y=0; for(const k of ['KeyW','KeyA','KeyS','KeyD','Space']) keys[k]=false; mouseL=false; } },150);
  ui.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
  ui.addEventListener('contextmenu',e=>e.preventDefault());

  // floating joystick: the first touch in the left zone becomes the stick origin
  let sid=null, ox=0, oy=0, latch=false;
  const stick=T('tstick'), ring=T('tring'), knob=T('tknob');
  const setMove=(dx,dy)=>{ const d=Math.hypot(dx,dy), n=Math.min(d,R), ux=d?dx/d*n:0, uy=d?dy/d*n:0; knob.style.transform=`translate(${ux}px,${uy}px)`;
    const m=Math.max(0,(n/R-.1)/.9); // 10% dead zone, then speed scales with how far the stick is pushed
    axis.on=true; axis.x=d?dx/d*m:0; axis.y=d?dy/d*m:0;
    keys.KeyW=axis.y<-.12; keys.KeyS=axis.y>.12; keys.KeyA=axis.x<-.12; keys.KeyD=axis.x>.12;
    keys.ShiftLeft=latch||(m>.96&&axis.y<-.6); };
  stick.addEventListener('pointerdown',e=>{ if(sid!==null) return; sid=e.pointerId; stick.setPointerCapture(e.pointerId); ox=e.clientX; oy=e.clientY; ui.classList.add('moving');
    for(const el of [ring,knob]){ el.style.left=ox+'px'; el.style.top=oy+'px'; } setMove(0,0); e.preventDefault(); });
  stick.addEventListener('pointermove',e=>{ if(e.pointerId!==sid) return; setMove(e.clientX-ox,e.clientY-oy); e.preventDefault(); });
  const endStick=e=>{ if(e.pointerId!==sid) return; sid=null; axis.on=false; axis.x=axis.y=0; ui.classList.remove('moving'); keys.KeyW=keys.KeyA=keys.KeyS=keys.KeyD=false; keys.ShiftLeft=latch; knob.style.transform=''; };
  stick.addEventListener('pointerup',endStick); stick.addEventListener('pointercancel',endStick);

  // look: drag anywhere on the right (with a little acceleration); tap = place / interact, press and hold = break / attack
  let lid=null, lx=0, ly=0, lt=0, lm=0, holdT=0, holding=false; const look_=T('tlook');
  const gunOn=()=>inArena()&&arena.pvp();
  const startHold=()=>{ if(lid===null||lm>10||!live()) return; holding=true; vib(14); if(gunOn()){ arena.fire(true); return; } if(targetEnt) attackMob(targetEnt); else { mouseL=true; mineT=0; mine.p=0; if(!survival()) breakBlock(); } };
  look_.addEventListener('pointerdown',e=>{ if(lid!==null) return; lid=e.pointerId; look_.setPointerCapture(e.pointerId); lx=e.clientX; ly=e.clientY; lt=performance.now(); lm=0; holding=false; clearTimeout(holdT); holdT=setTimeout(startHold,320); e.preventDefault(); });
  look_.addEventListener('pointermove',e=>{ if(e.pointerId!==lid) return; const dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY; const v=Math.hypot(dx,dy); lm+=v; if(lm>10&&!holding) clearTimeout(holdT); const k=1.15+Math.min(1,v/22); look(dx*k,dy*k); e.preventDefault(); });
  const endLook=e=>{ if(e.pointerId!==lid) return; lid=null; clearTimeout(holdT);
    if(holding){ holding=false; mouseL=false; arena.fire(false); return; }
    if(e.type==='pointerup'&&lm<8&&performance.now()-lt<260&&live()){ vib(10); if(gunOn()){ arena.fire(true); arena.fire(false); } else if(targetEnt) interactMob(targetEnt); else placeBlock(); } };
  look_.addEventListener('pointerup',endLook); look_.addEventListener('pointercancel',endLook);

  // action buttons
  const press=(id,down,up)=>{ const b=T(id); b.addEventListener('pointerdown',e=>{ e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('on'); down(); });
    const rel=()=>{ b.classList.remove('on'); if(up) up(); }; b.addEventListener('pointerup',rel); b.addEventListener('pointercancel',rel); };
  press('tbreak',()=>{ vib(10); if(gunOn()){ arena.fire(true); return; } if(targetEnt){ attackMob(targetEnt); return; } mouseL=true; mineT=0; mine.p=0; if(!survival()) breakBlock(); },()=>{ mouseL=false; arena.fire(false); });
  press('tplace',()=>{ vib(10); if(gunOn()&&!arena.builds()){ arena.reload(); return; } if(targetEnt) interactMob(targetEnt); else placeBlock(); });
  press('tjump',()=>{ keys.Space=true; vib(8); },()=>{ keys.Space=false; });
  press('tdown',()=>{ keys.ShiftLeft=true; },()=>{ keys.ShiftLeft=latch; });
  const tap=(id,fn)=>T(id).addEventListener('click',e=>{ e.preventDefault(); fn(); });
  tap('tmenu',()=>{ tut.help=true; paused=true; mouseL=false; openMenu('main'); });
  tap('tinv',()=>{ if(started&&!S.dead) toggleInv(); });
  tap('tchat',()=>openChat());
  tap('tsprint',()=>{ latch=!latch; keys.ShiftLeft=latch; T('tsprint').classList.toggle('latched',latch); showToast(latch?'Sprint on':'Sprint off'); });
  tap('tfly',()=>{ if(survival()||inArena()){ showToast('Flying is creative-only'); return; } P.fly=!P.fly; T('tfly').classList.toggle('latched',P.fly); showToast(P.fly?'Flight on':'Flight off'); });
  tap('tview',()=>{ thirdP=(thirdP+1)%3; showToast(['First person','Third person (back)','Third person (front)'][thirdP]); });
  // hotbar slots become tappable (the bar is rebuilt on every change, so delegate)
  if(new URLSearchParams(location.search).has('e2e')) window.__tdbg=()=>({lid,sid,holding,lm,live:live()});
  hbEl.addEventListener('pointerdown',e=>{ const s=e.target.closest('.slot'); if(!s) return; const i=[...hbEl.children].indexOf(s); if(i>=0){ selectSlot(i); e.preventDefault(); } });
}

addEventListener('blur',()=>{ for(const k in keys) keys[k]=false; mouseL=false; if(started&&fallback&&!paused&&!modalOpen&&!invOpen&&!S.dead){ paused=true; openMenu('main'); } });
addEventListener('resize',()=>{ renderer.setSize(innerWidth,innerHeight); camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); if(composer) composer.setSize(innerWidth,innerHeight); });


/* ============================ day / night + weather lighting ============================ */
let worldTime = save?.time ?? GEN.startTime ?? .32;
if(save?.weather) { wx.type=save.weather; wx.target={clear:0,rain:.7,storm:1}[wx.type]||0; wx.k=wx.target; }
const DAY=new THREE.Color(0x87c7f5), NIGHT=new THREE.Color(0x050914), DUSK=new THREE.Color(0xff8a4c), OVERCAST=new THREE.Color(0x7b8794), skyC=new THREE.Color(), tmpC=new THREE.Color(), sunCol=new THREE.Color(), tmpV=new THREE.Vector3(), sunDirV=new THREE.Vector3();
let underwater=false;
function applyFog(){ const f=1-.5*wx.k; scene.fog.near=underwater?1:RD*16*cfg.fog*.5*f; scene.fog.far=underwater?26:RD*16*cfg.fog*(1-.25*wx.k)-6; }
let lastSunKey='';
function updateSky(dt){
  if(mp){ // server-authoritative clock: free-run between sync packets, then ease toward the server's value
    const exp=(timeSync.t+(performance.now()-timeSync.at)/1000/timeSync.len)%1; let err=exp-worldTime; err=err-Math.round(err);
    worldTime=(worldTime+dt/timeSync.len+err*Math.min(1,dt*2)+1)%1;
  } else if(cfg.time==='cycle') worldTime=(worldTime+dt/(GEN.day||cfg.day))%1; else worldTime={day:.4,night:.85,dusk:.27}[cfg.time];
  const ang=(worldTime-.25)*Math.PI*2, elev=Math.sin(ang), dir=sunDirV.set(Math.cos(ang),elev,.28).normalize();
  const k=smooth(-.12,.25,elev), dusk=Math.exp(-Math.pow(elev/.14,2))*.65, wk=wx.k;
  skyC.copy(NIGHT).lerp(DAY,k).lerp(DUSK,dusk*(1-wk*.6));
  if(wk>0){ tmpC.copy(OVERCAST).multiplyScalar(.15+.85*k); skyC.lerp(tmpC,Math.min(.85,wk*.85)); }
  if(underwater){ tmpC.setRGB(.05,.22,.4).multiplyScalar(.25+.75*k); skyC.copy(tmpC); }
  const fl=wx.flash; if(fl>0){ skyC.lerp(tmpC.setRGB(.9,.92,1),fl*.6); }
  scene.background.copy(skyC); scene.fog.color.copy(skyC);
  skyMat.uniforms.bot.value.copy(skyC); skyMat.uniforms.top.value.copy(skyC).multiply(tmpC.setRGB(.55+.2*(1-k),.72,1.05)); skyDome.position.copy(camera.position); skyMat.uniforms.sd.value.copy(dir); skyMat.uniforms.sk.value=smooth(-.05,.2,elev)*(1-wk*.9);
  hemi.intensity=(.4+1.55*k)*(1-.5*wk)+fl*2; hemi.color.setHSL(.58,.6*(1-wk*.5),.5+.3*k);
  const night=elev<-.02, ld=night?tmpV.copy(dir).negate():dir;
  sunCol.set(night?0x7f9bff:0xfff1d6); if(!night) sunCol.lerp(tmpC.set(0xffa860),dusk);
  sun.color.copy(sunCol);
  sun.intensity=(night?.7*(1-k):4.4*smooth(-.02,.22,elev)+.15)*(1-.8*wk);
  const sr=[0,32,48,64][cfg.shadows]||64, step=Math.max(1,(sr*2)/sun.shadow.mapSize.x*8);
  const tx=Math.round(P.x/step)*step, ty=Math.round(P.y/step)*step, tz=Math.round(P.z/step)*step;
  sun.target.position.set(tx,ty,tz); sun.position.set(tx+ld.x*130,ty+Math.max(ld.y,.12)*130,tz+ld.z*130); sun.target.updateMatrixWorld();
  const key=((ld.x*50)|0)+','+((ld.y*50)|0)+','+tx+','+tz; if(key!==lastSunKey){ lastSunKey=key; shadowDirty=true; }
  lightU.uNight.value=1-k; sunElev=elev;
  sunSpr.position.copy(camera.position).addScaledVector(dir,700); moonSpr.position.copy(camera.position).addScaledVector(dir,-700);
  sunSpr.material.opacity=smooth(-.2,.05,elev)*(1-wk*.9); moonSpr.material.opacity=(1-smooth(-.1,.15,elev))*(1-wk*.8);
  stars.position.copy(camera.position); stars.rotation.z=worldTime*Math.PI*2; stars.material.opacity=(1-k)*.9*(1-wk);
  clouds.position.x=camera.position.x; clouds.position.z=camera.position.z;
  cloudTex.offset.set(camera.position.x/1800*5+worldTime*18,-camera.position.z/1800*5);
  cloudMat.color.setScalar(.25+.75*k).lerp(tmpC.set(0x555d68),wk*.7).lerp(DUSK,dusk*.35); cloudMat.opacity=.9+.1*wk;
}




/* ============================ main loop ============================ */
let titleT=0, frame=0, last=performance.now(), fpsT=0, fps=0, fpsN=0, saveT=0;
const camDir=new THREE.Vector3();
function findSpawn(){
  for(let r=0;r<400;r+=8) for(let a=0;a<(r?12:1);a++){
    const x=Math.round(Math.cos(a/12*6.283)*r), z=Math.round(Math.sin(a/12*6.283)*r), h=terrainH(x,z);
    if(h>SEA+2&&h<44) return [x+.5,h+3,z+.5];
  }
  return [8.5,SEA+10,8.5];
}
[P.x,P.y,P.z]=findSpawn();
if(save?.pos){ [P.x,P.y,P.z]=save.pos; P.yaw=save.yaw||0; P.pitch=save.pitch||0; }
const SCHEMA={
  world:[['time','Time of day','sel',[['cycle','Day / night cycle'],['day','Always day'],['night','Always night'],['dusk','Always sunset']]],['day','Day length (seconds)','rng',60,1200,30],['rd','Render distance (chunks)','rng',3,14,1],['fly','Flight speed','rng',.5,3,.1]],
  video:[['shadows','Shadow quality','sel',[[0,'Off'],[1,'Low'],[2,'Medium'],[3,'High']]],['fov','Field of view','rng',50,110,1],['bright','Brightness','rng',.6,1.8,.05],['scale','Render scale','rng',.5,1.5,.05],['fog','Fog distance','rng',.4,1,.05],['curve','Curved horizon','sel',[[0,'Off'],[0.0002,'Soft'],[0.0006,'Planet']]],['round','Rounded blocks','sel',[[0,'Off'],[1,'Soft'],[2,'Pillow']]],['bump','Texture relief','rng',0,3,.1],['clouds','Clouds','chk'],['bloom','Bloom & HDR glow','chk'],['ao','Ambient occlusion (GTAO)','chk'],['cine','Cinematic: light shafts, grade, fringing (heavy GPU)','chk'],['adaptive','Auto-lower quality when slow','chk'],['vig','Vignette','chk']],
  audio:[['vol','Master volume','rng',0,1,.05],['volMusic','Music volume','rng',0,1,.05],['volSfx','Effects volume','rng',0,1,.05],['volAmb','Ambience volume','rng',0,1,.05],['musicMode','Music','sel',[['game','Game music'],['real','Real music (Music page)'],['off','Off']]]],
  ctrl:[['sens','Mouse sensitivity','rng',.2,3,.05],['inv','Invert Y axis','chk'],['debug','Show debug info','chk'],['bob','Camera bobbing & hand animation','chk']],
  ui:[['ui_crosshair','Crosshair','chk'],['ui_hotbar','Hotbar','chk'],['ui_vitals','Health, air & coins','chk'],['ui_chat','Chat','chk'],['ui_prompt','Target name & hints','chk'],['minimap','Minimap','chk'],['coords','Coordinates & compass','chk'],['hints','Tutorial tips','chk'],['weather','Dynamic weather (singleplayer)','chk']]
};
let drs=1, drsT=0, drsLast=0, drsEma=16.7, drsSlow=0, drsFast=0, drsCalm=0; // adaptive resolution multiplier (0.55..1) + effect ladder
const SHED=[['ao',v=>v?false:null,'ambient occlusion'],['cine',v=>v?false:null,'cinematic effects'],['bloom',v=>v?false:null,'bloom'],['shadows',v=>v>1?v-1:null,'shadow quality'],['rd',v=>v>5?v-1:null,'render distance'],['clouds',v=>v?false:null,'clouds'],['shadows',v=>v>0?0:null,'shadows'],['rd',v=>v>4?v-1:null,'render distance']];
function shedOne(now){
  for(const [k,f,label] of SHED){ const n=f(cfg[k]); if(n===null||n===undefined) continue;
    autoStack.push({k,v:cfg[k],n}); cfg[k]=n; if(autoStack.length>24) autoStack.shift(); saveAuto();
    drs=.85; drsSlow=drsFast=drsCalm=0; drsT=now; drsEma=20; window.__drs=drs; applyCfg(); showToast('Auto-lowered '+label+' for smoother play'); return true; }
  return false;
}
function restoreOne(now){ // plenty of headroom for a long time: give one lowered effect back (never again once it caused slowness)
  for(let i=autoStack.length-1;i>=0;i--){ const e=autoStack[i]; if(autoBlocked.includes(e.k+':'+e.v)||cfg[e.k]!==e.n) { autoStack.splice(i,1); continue; }
    autoStack.splice(i,1); cfg[e.k]=e.v; lastRestore={k:e.k,v:e.v,n:e.n,at:now}; saveAuto(); drsFast=drsCalm=0; drsT=now; drsEma=20; applyCfg(); return true; }
  return false;
}
let lastRestore=null;
function stepDRS(now){
  const dt=now-drsLast; drsLast=now; if(cfg.adaptive===false){ if(drs!==1){ drs=1; window.__drs=1; applyCfg(); } return; } if(dt>1500||dt<=0||document.hidden||now-drsT<1500) return; drsEma+=(dt-drsEma)*.08;
  if(drsEma>30){ drsSlow++; drsFast=0; drsCalm=0; } else if(drsEma<19){ drsFast++; drsSlow=0; drsCalm++; } else drsSlow=drsFast=0;
  if(drsSlow>20&&drs<=.72){ // resolution already low and still slow: shed an effect
    if(lastRestore&&now-lastRestore.at<90000){ autoBlocked.push(lastRestore.k+':'+lastRestore.v); lastRestore=null; } // the thing we just gave back was too much: don't try again
    if(shedOne(now)) return;
  }
  let nd=drs; if(drsSlow>20) nd=Math.max(.55,drs*.88); else if(drsFast>240) nd=Math.min(1,drs*1.08);
  if(nd>=.999&&drs>=.999&&drsCalm>3600&&autoStack.length&&restoreOne(now)) return; // ~1 min of smooth play at full resolution
  if(Math.abs(nd-drs)>.02){ drs=nd; drsSlow=drsFast=0; drsT=now; drsEma=20; window.__drs=drs; renderer.setPixelRatio(Math.min(devicePixelRatio,IS_TOUCH?1.5:2)*cfg.scale*drs); renderer.setSize(innerWidth,innerHeight); if(composer){ composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth,innerHeight); } }
}
function applyCfg(){
  audio.applyVolumes(); if(cfg.musicMode==='game') audio.startMusic(); else audio.stopMusic(); music.setVolume(); music.sync();
  RD=cfg.rd; buildSpiral(); applyFog();
  curveU.uCurve.value=cfg.curve; roundU.uRound.value=cfg.round?(cfg.round===2?1:.6):0; buildBump(cfg.round|0);
  camera.fov=cfg.fov; camera.updateProjectionMatrix();
  renderer.toneMappingExposure=cfg.bright;
  renderer.setPixelRatio(Math.min(devicePixelRatio,IS_TOUCH?1.5:2)*cfg.scale*drs); renderer.setSize(innerWidth,innerHeight);
  const sz=[0,1024,2048,4096][cfg.shadows]|0, sr=[0,32,48,64][cfg.shadows]|0;
  renderer.shadowMap.enabled=sun.castShadow=sz>0;
  if(sz){ sun.shadow.mapSize.set(sz,sz); Object.assign(sun.shadow.camera,{left:-sr,right:sr,top:sr,bottom:-sr}); sun.shadow.camera.updateProjectionMatrix(); if(sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map=null; } }
  shadowDirty=true;
  for(const m of [matO,matT,matW]) m.needsUpdate=true;
  matO.bumpScale=cfg.bump; clouds.visible=cfg.clouds;
  if(cfg.bloom||cfg.ao||cfg.cine){ ensureComposer(); bloomPass.enabled=!!cfg.bloom; gtaoPass.enabled=!!cfg.ao; cinePass.enabled=!!cfg.cine; bloomPass.strength=cfg.scale>1.2?.14:.26; cinePass.uniforms.aber.value=cfg.scale>1.2?.0008:.0016; composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth,innerHeight); }
  for(const k of ['crosshair','hotbar','chat','vitals','prompt']) document.body.classList.toggle('hide-'+k,!cfg['ui_'+k]);
  document.body.classList.toggle('hide-minimap',!cfg.minimap); document.body.classList.toggle('hide-coords',!cfg.coords);
  document.body.classList.toggle('novig',!cfg.vig); document.getElementById('hudinfo').style.display=cfg.coords?'block':'none'; dbg.style.display=cfg.debug?'block':'none';
}
function buildSettings(){
for(const [pane,items] of Object.entries(SCHEMA)){
  const box=document.getElementById('tab-'+pane); box.querySelectorAll(':scope>.row').forEach(n=>n.remove());
  for(const [key,label,type,a,b,step] of items){
    const row=document.createElement('div'); row.className='row'; row.innerHTML='<span>'+label+'</span>'; const wrap=document.createElement('span'); let el,out;
    if(type==='rng'){ el=document.createElement('input'); el.type='range'; el.min=a; el.max=b; el.step=step; el.value=cfg[key]; const fillP=()=>el.style.setProperty('--p',((+el.value-a)/(b-a)*100)+'%'); fillP(); el.addEventListener('input',fillP); out=document.createElement('b'); out.textContent=cfg[key]; wrap.append(el,' ',out); }
    else if(type==='chk'){ el=document.createElement('input'); el.type='checkbox'; el.checked=cfg[key]; wrap.append(el); }
    else { el=document.createElement('select'); for(const [v,t] of a){ const o=document.createElement('option'); o.value=v; o.textContent=t; el.append(o); } el.value=cfg[key]; wrap.append(el); }
    el.oninput=el.onchange=()=>{ cfg[key]=type==='chk'?el.checked:typeof cfg[key]==='number'?+el.value:el.value; if(out) out.textContent=cfg[key]; saveCfg(); applyCfg(); };
    row.append(wrap); box.append(row);
  }
}
}
buildSettings();
document.querySelectorAll('.tabs span').forEach(t=>t.onclick=()=>{ document.querySelectorAll('.tabs span,.pane').forEach(x=>x.classList.remove('on')); t.classList.add('on'); document.getElementById('tab-'+t.dataset.tab).classList.add('on'); });
try{ nickEl.value=localStorage.getItem('voxel_nick')||''; }catch(e){}
nickEl.onchange=()=>{ try{ localStorage.setItem('voxel_nick',nickEl.value); }catch(e){} };
const PRESETS={Low:{round:0,curve:0,shadows:1,rd:5,bloom:false,ao:false,cine:false,adaptive:true,scale:.75,bump:0,clouds:false,fog:.8},Medium:{round:1,curve:.0002,shadows:2,rd:7,bloom:false,ao:false,cine:false,adaptive:true,scale:1,bump:1,clouds:true,fog:1},High:{round:1,curve:.0002,shadows:3,rd:9,bloom:true,ao:true,cine:false,adaptive:true,scale:1,bump:1.2,clouds:true,fog:1},Ultra:{round:2,curve:.0004,shadows:3,rd:12,bloom:true,ao:true,cine:true,adaptive:false,scale:1.4,bump:2,clouds:true,fog:1}};
for(const [name,v] of Object.entries(PRESETS)){ const c=document.createElement('span'); c.className='chip'; c.textContent=name+' preset'; c.onclick=()=>{ Object.assign(cfg,v); saveCfg(); applyCfg(); buildSettings(); showToast(name+' graphics applied'); }; document.getElementById('presets').append(c); }
$('b-resetcfg').onclick=()=>confirmModal('Reset settings','Restore every setting to its default value?',()=>{ Object.assign(cfg,JSON.parse(JSON.stringify(DEFAULT_CFG))); saveCfg(); applyCfg(); buildSettings(); showToast('Settings reset'); });
applyCfg();
/* ---- player profiles & skins ---- */
const PKEY='voxel_profiles';
let profiles; try{ profiles=JSON.parse(localStorage.getItem(PKEY)); }catch(e){}
if(!Array.isArray(profiles)||!profiles.length){ let nm='Player'; try{ nm=localStorage.getItem('voxel_nick')||'Player'; }catch(e){} profiles=[{name:nm,skin:{...DEF_SKIN}}]; }
let pIdx=0; try{ pIdx=Math.min(profiles.length-1,+localStorage.getItem('voxel_profile')||0); }catch(e){}
const activeProfile=()=>profiles[pIdx];
const saveProfiles=()=>{ try{ localStorage.setItem(PKEY,JSON.stringify(profiles)); localStorage.setItem('voxel_profile',pIdx); localStorage.setItem('voxel_nick',activeProfile().name); }catch(e){} };
function syncProfile(){ const p=activeProfile(); nickEl.value=p.name; $('pbtn').textContent=p.name; $('whoami').textContent=p.name; $('pcsw').innerHTML=`<i style="background:${p.skin.hair};flex:.5"></i><i style="background:${p.skin.skin}"></i><i style="background:${p.skin.shirt};flex:1.6"></i><i style="background:${p.skin.pants};flex:1.3"></i>`; }
let prev=null;
function initPreview(){
  if(prev) return; const r=new THREE.WebGLRenderer({canvas:$('prevcv'),alpha:true,antialias:true}); r.setPixelRatio(Math.min(devicePixelRatio,2)); r.setSize(240,300,false); r.outputColorSpace=THREE.SRGBColorSpace;
  const sc=new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff,0x667788,3.4)); const dl=new THREE.DirectionalLight(0xffffff,2.8); dl.position.set(2,3,4); sc.add(dl);
  const cam=new THREE.PerspectiveCamera(28,240/300,.1,50); cam.position.set(0,1.1,5.2); cam.lookAt(0,1.05,0); prev={r,sc,cam,av:null,running:false};
}
function rebuildPreview(){ if(!prev) return; if(prev.av){ prev.sc.remove(prev.av); } const old=prev.av?prev.av.rotation.y:.5; prev.av=makeAvatar('',0,activeProfile().skin,true); prev.av.rotation.y=old; prev.sc.add(prev.av); }
function previewLoop(){ if(curPage!=='players'||menu.style.display==='none'){ prev.running=false; return; } prev.av.rotation.y+=.014; prev.r.render(prev.sc,prev.cam); requestAnimationFrame(previewLoop); }
function renderProfiles(){
  const box=$('pllist'); box.innerHTML='';
  profiles.forEach((p,i)=>{ const d=document.createElement('div'); d.className='pl'+(i===pIdx?' on':'');
    d.innerHTML=`<div class="sw"><i style="background:${p.skin.hair};flex:.5"></i><i style="background:${p.skin.skin}"></i><i style="background:${p.skin.shirt};flex:1.6"></i><i style="background:${p.skin.pants};flex:1.3"></i></div><div style="flex:1"><b>${esc(p.name)}</b><div style="font-size:12px;opacity:.6">${i===pIdx?'Selected':'Click to select'}</div></div>`;
    d.onclick=()=>{ pIdx=i; saveProfiles(); syncProfile(); renderProfiles(); loadEditor(); rebuildPreview(); }; box.append(d); });
  $('b-pdel').disabled=profiles.length<2;
}
function loadEditor(){ const p=activeProfile(); $('pname').value=p.name; for(const k of ['shirt','pants','skin','hair']) $('c-'+k).value=p.skin[k]; }
function openPlayers(){ showPage('players'); initPreview(); renderProfiles(); loadEditor(); rebuildPreview(); if(!prev.running){ prev.running=true; previewLoop(); } }
$('b-player').onclick=openPlayers; $('b-who').onclick=openPlayers;
$('pname').oninput=()=>{ activeProfile().name=$('pname').value.slice(0,16)||'Player'; saveProfiles(); syncProfile(); renderProfiles(); };
for(const k of ['shirt','pants','skin','hair']) $('c-'+k).oninput=()=>{ activeProfile().skin[k]=$('c-'+k).value; saveProfiles(); rebuildPreview(); renderProfiles(); selfAv&&(scene.remove(selfAv),selfAv=null); };
$('b-pnew').onclick=()=>{ profiles.push({name:'Player '+(profiles.length+1),skin:{...DEF_SKIN}}); pIdx=profiles.length-1; saveProfiles(); syncProfile(); renderProfiles(); loadEditor(); rebuildPreview(); };
$('b-rand').onclick=()=>{ const rc=()=>'#'+new THREE.Color().setHSL(Math.random(),.55,.5).getHexString(); const tones=['#f1c9a5','#e0b48f','#c68e63','#8d5a3c','#5a3a28']; Object.assign(activeProfile().skin,{shirt:rc(),pants:rc(),skin:tones[Math.random()*5|0],hair:rc()}); saveProfiles(); loadEditor(); rebuildPreview(); renderProfiles(); selfAv&&(scene.remove(selfAv),selfAv=null); };
$('b-pdel').onclick=()=>{ if(profiles.length<2) return; profiles.splice(pIdx,1); pIdx=0; saveProfiles(); syncProfile(); renderProfiles(); loadEditor(); rebuildPreview(); };
syncProfile(); saveProfiles();
startWorker(); showLoad('Generating world...',5);
{ let pg=null; try{ pg=sessionStorage.getItem('voxel_page'); sessionStorage.removeItem('voxel_page'); }catch(e){} showPage(pg||'main'); }
if(!save) P.pitch=-.1;

const perf={update:0,render:0,maxUpdate:0,frames:0,over16:0};
// ---- performance HUD (F3, or tap the coordinates on touch): FPS + 1% lows, frame-time graph, CPU split, net rate, draw load, quality governor state
const FT_N=180, ftBuf=new Float32Array(FT_N); let ftI=0, ftLast=0, dbgT=0, netInB=0, netInRate=0, netInT=0;
dbg.innerHTML='<canvas id="pgraph" width="240" height="54"></canvas><div id="dbgtxt"></div>';
const pgraph=dbg.querySelector('#pgraph'), pgx=pgraph.getContext('2d'), dbgtxt=dbg.querySelector('#dbgtxt');
function perfSample(now){ if(ftLast){ const d=now-ftLast; if(d<1000){ ftBuf[ftI++%FT_N]=d; } } ftLast=now; }
function perfStats(){ const n=Math.min(ftI,FT_N); if(!n) return null; const a=Array.from(ftBuf.subarray(0,n)).sort((x,y)=>x-y), avg=a.reduce((s,x)=>s+x,0)/n, p99=a[Math.min(n-1,Math.floor(n*.99))]; return {avg,p99,max:a[n-1],fps:1000/avg,low:1000/p99}; }
function drawPerfGraph(st){
  const W=pgraph.width, H=pgraph.height; pgx.clearRect(0,0,W,H); pgx.fillStyle='rgba(255,255,255,.07)'; pgx.fillRect(0,H-H*(16.7/50),W,1); pgx.fillRect(0,H-H*(33.3/50),W,1);
  const n=Math.min(ftI,FT_N); for(let i=0;i<n;i++){ const v=ftBuf[(ftI-n+i+FT_N*4)%FT_N], h=Math.min(H,v/50*H); pgx.fillStyle=v<18?'#6ee7a8':v<34?'#ffd75e':'#ff6b6b'; pgx.fillRect(i*(W/FT_N),H-h,Math.max(1,W/FT_N-.5),h); }
  if(st){ pgx.fillStyle='#fff'; pgx.font='600 10px ui-monospace,monospace'; pgx.fillText('16.7ms',W-44,H-H*(16.7/50)-2); }
}
function perfText(st){
  const mem=performance.memory?`${(performance.memory.usedJSHeapSize/1048576).toFixed(0)} MB heap`:'', lowered=autoStack.map(e=>e.k).join(', ')||'none';
  const q=`tier ${TIER} - ${Math.round(100*cfg.scale*(window.__drs||1))}% res - shadows ${cfg.shadows} - view ${cfg.rd}${cfg.ao?' - AO':''}${cfg.bloom?' - bloom':''}${cfg.cine?' - cinematic':''}`;
  return `FPS ${st?st.fps.toFixed(0):'-'}   1% low ${st?st.low.toFixed(0):'-'}   frame ${st?st.avg.toFixed(1):'-'} ms (worst ${st?st.max.toFixed(0):'-'})
CPU: update ${perf.update.toFixed(1)} ms - submit ${perf.render.toFixed(1)} ms  ${st&&st.avg-perf.update-perf.render>6?'(GPU-bound)':'(CPU-bound)'}
${mp?`Net: ${pingMs} ms ping - ${(netInRate/1024).toFixed(1)} KB/s down - ${others.size+1} online\n`:''}Draw: ${renderer.info.render.calls} calls - ${(renderer.info.render.triangles/1000).toFixed(0)}k tris - ${chunks.size} chunks (${genReq.size}/${meshReq.size} pending)
Mobs ${mobViews.size} - ${mem}
Quality: ${q}
Auto-lowered: ${lowered}
GPU: ${GPU.replace(/ANGLE \(|\)$/g,'').slice(0,46)||'unknown'}
XYZ ${P.x.toFixed(1)} ${P.y.toFixed(1)} ${P.z.toFixed(1)} - ${MODE}${mp?' @ '+(mpWorld||''):''} - ${(worldTime*24).toFixed(1)}h ${wx.type}${P.fly?' - FLYING':''}`;
}
function loop(now){
  requestAnimationFrame(loop); const tf0=performance.now(); stepDRS(tf0); bigMap.tick(Math.min(.1,(tf0-(window.__lastBM||tf0))/1000)); window.__lastBM=tf0; lifeFx(Math.min(.1,(tf0-(window.__lastAm||tf0))/1000),tf0/1000); window.__lastAm=tf0; lobbyVis.frame(tf0/1000,Math.min(.1,(tf0-(window.__lastLb||tf0))/1000)); window.__lastLb=tf0; waterU.uTime.value=tf0/1000; stepFluid(Math.min(.1,(tf0-(window.__lastFluid||tf0))/1000)); processRemesh(); window.__lastFluid=tf0; arena.frame(Math.min(.1,(tf0-(window.__lastArena||tf0))/1000)); window.__lastArena=tf0;
  const dt=Math.min(.05,(now-last)/1000); last=now; frame++;
  fpsT+=dt; fpsN++; if(fpsT>.5){ fps=Math.round(fpsN/fpsT); fpsT=0; fpsN=0; }
  updateChunks(!P.ready);
  const pc=chunks.get(ck(Math.floor(P.x/CS),Math.floor(P.z/CS)));
  if(!P.ready){ let n=0; const px=Math.floor(P.x/CS), pz=Math.floor(P.z/CS); for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++){ const c=chunks.get(ck(px+a,pz+b)); if(c&&c.meshed) n++; } document.getElementById('loadbar').style.width=Math.max(8,n/25*100)+'%'; }
  if(!P.ready && pc&&pc.meshed&&(!started||!ws||true)){ if(!P.ready){ P.ready=true; document.getElementById('loadbar').style.width='100%'; setTimeout(()=>document.getElementById('load').style.opacity=0,started?150:400); } }
  if(P.ready && started && locked() && !S.dead){
    const sprint=!!(keys.ShiftLeft||keys.ShiftRight)&&(keys.KeyW);
    P.yaw+=((keys.ArrowLeft?1:0)-(keys.ArrowRight?1:0))*dt*2.2; P.pitch=Math.max(-1.55,Math.min(1.55,P.pitch+((keys.ArrowUp?1:0)-(keys.ArrowDown?1:0))*dt*2.2));
    vyBefore=P.vy; const n=Math.ceil(dt/.015); for(let i=0;i<n;i++) stepPlayer(dt/n,sprint);
    if(P.onGround&&!wasGround&&vyBefore<-6){ landDip=Math.min(.4,-vyBefore*.014); landFx=-vyBefore; if(vyBefore<-9) sfx(90,.12,'sine',.1); } wasGround=P.onGround;
    if(P.y<-30){ P.y=CH; P.vy=0; }
    camera.fov+= ((cfg.fov+(sprint?9:0))-camera.fov)*Math.min(1,dt*8); camera.updateProjectionMatrix();
    survivalTick(dt,isWater(getB(Math.floor(P.x),Math.floor(P.y+1.62),Math.floor(P.z))),isWater(getB(Math.floor(P.x),Math.floor(P.y+.3),Math.floor(P.z))));
  }
  camera.position.set(P.x,P.y+1.62,P.z); camera.rotation.set(P.pitch,P.yaw,0);
  if(!started){ const R=26, a=titleT*.05; camera.position.set(P.x+Math.cos(a)*R,P.y+13+Math.sin(titleT*.2)*1.5,P.z+Math.sin(a)*R); camera.lookAt(P.x,P.y+3,P.z); camera.rotation.z=0; }
  camera.getWorldDirection(camDir);
  const fo=fpsOnly(); if(fo!==fpsClass){ fpsClass=fo; document.body.classList.toggle('fps-only',fo); }
  hit = (P.ready&&started&&!fo)? raycast(camera.position,camDir,6) : null;
  if(thirdP){ const sg=thirdP===1?-1:1; let d=0; while(d<4&&!(getB(Math.floor(P.x+camDir.x*sg*(d+.3)),Math.floor(P.y+1.62+camDir.y*sg*(d+.3)),Math.floor(P.z+camDir.z*sg*(d+.3))))) d+=.2;
    camera.position.set(P.x+camDir.x*sg*d,P.y+1.62+camDir.y*sg*d,P.z+camDir.z*sg*d); if(thirdP===2) camera.rotation.set(-P.pitch,P.yaw+Math.PI,0); }
  if(!selfAv){ selfAv=makeAvatar('',0,activeProfile().skin,true); scene.add(selfAv); }
  selfAv.visible=thirdP>0; if(thirdP){ selfAv.position.set(P.x,P.y,P.z); selfAv.rotation.y=P.yaw+Math.PI; selfAv.head.rotation.x=-P.pitch*.6; selfAv.state=moveState(); animateRig(selfAv,P.onGround||selfAv.state===2?Math.hypot(P.vx,P.vz):0,dt,tNow()); }
  camEffects(dt); updateViewmodel(dt); mineUpdate(dt); updateMobs(dt); updatePrompt(); updateInfo(dt); if(P.ready&&started&&locked()&&!S.dead){ footsteps(dt); tut.moved+=Math.hypot(P.vx,P.vz)*dt*(P.onGround?1:.3); tutTick(); } else tutTick();
  outline.visible=!!hit; if(hit) outline.position.set(hit.x+.5,hit.y+.5,hit.z+.5);
  const uw=isWater(getB(Math.floor(P.x),Math.floor(P.y+1.62),Math.floor(P.z)));
  if(uw!==underwater){ underwater=uw; waterEl.style.display=uw?'block':'none'; applyFog(); }
  updateParticles(dt); ambientFx(dt); updateWeather(dt); feedAudio(dt); drawMinimap(dt); if(!mp&&started) tickEconomy(eco,dt);
  { const w=document.getElementById('wallet'); if(w){ const on=economyOn()&&started&&!document.body.classList.contains('nohud'); if((w.style.display==='flex')!==on) w.style.display=on?'flex':'none'; } }
  if(!started){ titleT+=dt; }
  updateOthers(dt);
  if(ws&&ws.readyState===1){ netTick+=dt; if(netTick>2){ netTick=0; ws.send(JSON.stringify({t:'ping',ts:performance.now()})); netEl.textContent=pingMs+' ms - '+(others.size+1)+' online'; setMpStatus(true); } if(plistOn) renderPlist(); }
  posT+=dt; if(ws&&ws.readyState===1&&P.ready&&posT>.066){ posT=0; ws.send(JSON.stringify({t:'pos',x:+P.x.toFixed(2),y:+P.y.toFixed(2),z:+P.z.toFixed(2),yaw:+P.yaw.toFixed(3),pitch:+P.pitch.toFixed(3),st:moveState()})); }
  updateSky(dt);
  saveT+=dt; if(saveT>4){ saveT=0; writeSave(); }
  perfSample(tf0);
  if(dbg.style.display==='block'){ dbgT-=dt; if(dbgT<=0){ dbgT=.25; const st=perfStats(); dbgtxt.textContent=perfText(st); drawPerfGraph(st); } else drawPerfGraph(null); }
  if(false){
    dbg.textContent=`${fps} fps\nXYZ ${P.x.toFixed(1)} ${P.y.toFixed(1)} ${P.z.toFixed(1)}\nChunks ${chunks.size}  Draw calls ${renderer.info.render.calls}\nTime ${(worldTime*24).toFixed(1)}h  ${MODE}${mp?' (online '+(mpWorld||'')+')':''}  weather ${wx.type}\nCPU update ${perf.update.toFixed(1)} ms  render submit ${perf.render.toFixed(1)} ms  (worst ${perf.maxUpdate.toFixed(0)} ms)
Workers ${chunks.size} chunks, ${genReq.size}/${meshReq.size} pending, ${renderer.info.render.triangles|0} tris ${P.fly?'FLYING':''}\n${hit?'Looking at '+NAMES[hit.id]:''}`;
  }
  const tf1=performance.now(); renderFrame(); const tf2=performance.now();
  perf.update+=((tf1-tf0)-perf.update)*.05; perf.render+=((tf2-tf1)-perf.render)*.05; perf.frames++; if(tf1-tf0>perf.maxUpdate) perf.maxUpdate=tf1-tf0; if(tf1-tf0>16) perf.over16++;
}
function renderFrame(){
  if(renderer.shadowMap.enabled&&(shadowDirty||(frame&1)===0)){ renderer.shadowMap.needsUpdate=true; shadowDirty=false; }
  if((cfg.bloom||cfg.ao||cfg.cine)&&composer){
    if(cfg.cine&&cinePass){ const u=cinePass.uniforms; tmpV.copy(sunDirV).multiplyScalar(900).add(camera.position).project(camera); const front=tmpV.z<1;
      u.sun.value.set(tmpV.x*.5+.5,tmpV.y*.5+.5); u.shaft.value=front&&!underwater?Math.max(0,sunDirV.y+.1)*(1-wx.k)*.22:0; u.time.value=(performance.now()%1000)/1000; u.aspect.value=innerWidth/innerHeight; }
    composer.render();
  } else renderer.render(scene,camera);
}
addEventListener('beforeunload',()=>{ saveDirty=true; writeSave(); });
requestAnimationFrame(loop);

// finish a portal / /lobby transfer: the previous page reloaded after stashing where to go
{ let aj=null; try{ aj=JSON.parse(sessionStorage.getItem('voxel_autojoin')||'null'); sessionStorage.removeItem('voxel_autojoin'); }catch(e){}
  if(aj&&aj.addr&&aj.world){ needClick=!IS_TOUCH; let tries=0; const iv=setInterval(()=>{ if(++tries>200){ clearInterval(iv); return; } if(P.ready&&!started){ clearInterval(iv); launch(aj.addr,aj.world,aj.pw||undefined); } },300); } }
// test hook (only with ?e2e=1; production CSP forbids eval anyway)
if(new URLSearchParams(location.search).has('e2e')) window.__eval=src=>eval(src);
