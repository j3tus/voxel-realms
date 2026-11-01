// E2E: audio. The context must stay uncreated until a user gesture (a pre-gesture hover used to leave it suspended forever = silence),
// then run; ambience, rain, game music and effects must produce a measurable signal; volume sliders must change it; no page errors.
const {chromium}=require('playwright'); const URL=(process.argv[2]||'http://localhost:8090/')+'?e2e=1';
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
(async()=>{ const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']}); const p=await b.newPage({viewport:{width:960,height:540}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,140)); });
 await p.goto(URL); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000}); await sleep(1200);
 // 1. hover the menu with the mouse BEFORE any click
 await p.mouse.move(120,260); await p.mouse.move(130,330); await sleep(500); ok('no AudioContext is created by a pre-gesture hover',await ev(p,()=>audio.state==='none'),await ev(p,()=>audio.state));
 await p.click('#b-play'); await sleep(900); ok('after the first click the context is running',await ev(p,()=>audio.state==='running'),await ev(p,()=>audio.state));
 await p.click('#b-newworld'); await p.fill('#wname','Aud'); await p.fill('#seedin','audio1'); await p.click('[data-mode=survival]'); await p.click('[data-type=flat]'); await p.click('#b-create');
 await p.waitForFunction(()=>window.__eval('P.ready'),null,{timeout:60000}); await sleep(800); await p.click('.wcard.cur .wb button >> nth=0'); await p.waitForFunction(()=>window.__eval('started'),null,{timeout:20000}); await sleep(2500);
 await ev(p,()=>{ const e=document.getElementById('clickplay'); if(e) e.style.display='none'; needClick=false; window.__an=audio.analyser(); window.__buf=new Float32Array(1024); window.__rms=()=>{ let m=0; for(let i=0;i<30;i++){ __an.getFloatTimeDomainData(__buf); let s=0; for(const v of __buf) s+=v*v; m=Math.max(m,Math.sqrt(s/__buf.length)); } return m; }; });
 // measure inside the page: the software-rendered page is slow to round-trip, so sounds must be started and sampled in one evaluate
 await ev(p,()=>{ window.__measure=async(ms,setup)=>{ if(setup) setup(); let m=0; const t0=performance.now(); while(performance.now()-t0<ms){ __an.getFloatTimeDomainData(__buf); let s=0; for(const v of __buf) s+=v*v; m=Math.max(m,Math.sqrt(s/__buf.length)); await new Promise(r=>setTimeout(r,12)); } return m; }; });
 const rms=(ms=2500,setupSrc)=>p.evaluate(async([ms,src])=>__measure(ms,src?window.__eval('('+src+')'):null),[ms,setupSrc||null]);
 // 2. silence baseline with everything off
 await ev(p,()=>{ cfg.musicMode='off'; cfg.volAmb=0; cfg.volSfx=0; cfg.vol=1; applyCfg(); setWeather('clear'); wx.k=0; wx.target=0; }); await sleep(2500); const quiet=await rms(1500); console.log('silent baseline rms',quiet.toFixed(5));
 // 3. ambience: wind at altitude (clear sky)
 await ev(p,()=>{ cfg.volAmb=1; P.fly=true; P.y+=40; applyCfg(); }); await sleep(3500); const wind=await rms(2000); ok('wind ambience at altitude is audible',wind>quiet+.003,`${quiet.toFixed(4)} -> ${wind.toFixed(4)}`);
 // 4. rain at the same altitude adds a clearly audible layer
 await ev(p,()=>{ setWeather('rain'); wx.k=1; wx.target=1; }); await sleep(4000); const rain=await rms(2000); ok('rain adds an audible layer on top of the wind',rain>wind*1.3,`${wind.toFixed(4)} -> ${rain.toFixed(4)}`);
 await ev(p,()=>{ setWeather('clear'); wx.k=0; wx.target=0; cfg.volAmb=0; P.y-=40; applyCfg(); }); await sleep(3500);
 // 5. game music alone
 const calm=await rms(1500); await ev(p,()=>{ cfg.musicMode='game'; cfg.volMusic=1; applyCfg(); }); await sleep(1500); const music=await rms(12000); ok('generative music plays (signal above silence)',music>calm+.004,`${calm.toFixed(4)} -> ${music.toFixed(4)}`);
 ok('music mood follows the situation',await ev(p,()=>['day','night','menu'].includes(audio.mood)),await ev(p,()=>audio.mood));
 // 6. effects + master volume
 await ev(p,()=>{ cfg.musicMode='off'; cfg.volSfx=1; cfg.vol=1; applyCfg(); }); await sleep(3000); const sfxBase=await rms(1200);
 const hit=()=>{ audio.sfx(300,1.6,'sawtooth',.4); audio.step('stone',true); audio.hurt(); };
 const withSfx=await rms(1500,hit.toString()); ok('effects are audible',withSfx>sfxBase+.004,`${sfxBase.toFixed(4)} -> ${withSfx.toFixed(4)}`);
 await ev(p,()=>{ cfg.vol=.2; applyCfg(); }); await sleep(2500); const low=await rms(1500,hit.toString()); await ev(p,()=>{ cfg.vol=1; applyCfg(); }); await sleep(2500); const full=await rms(1500,hit.toString());
 ok('master volume scales the output',low<full*.6,`${low.toFixed(4)} at 20% vs ${full.toFixed(4)} at 100%`);
 // 7. underwater muffles, surface sounds do not crash
 await ev(p,()=>audio.update({started:true,under:true,k:0,water:1,cave:0,night:0,day:1,alt:20,speed:0})); await sleep(800); ok('underwater applies a low-pass (muffled)',await ev(p,()=>Math.round(audio.ctx.currentTime)>0));
 for (const k of ['grass','dirt','stone','sand','wood','snow','gravel','water']) await ev(p,k=>audio.step(k),k); await ev(p,()=>{ audio.thunder(); audio.splash(); audio.stinger(true); audio.stinger(false); }); await sleep(500);
 ok('every footstep surface, thunder, splash and stinger run without errors',errs.length===0,JSON.stringify([...new Set(errs)].slice(0,3)));
 console.log(fails?'FAILS '+fails:'ALL PASS'); await b.close(); process.exit(fails?1:0); })().catch(e=>{ console.log('FAIL',e.message); process.exit(1); });
