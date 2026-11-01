// E2E: pointer-lock behaviours of other browsers, simulated: (a) raw-input option throws (older engines), (b) request returns undefined and succeeds (no Promise API),
// (c) request accepted but neither a lock nor an error ever arrives (silent failure). The game must always end in a usable state: captured, or asking for a click.
const {chromium}=require('playwright'); const URL=(process.argv[2]||'http://localhost:8090/')+'?e2e=1';
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
(async()=>{ const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const start=async()=>{ const p=await b.newPage({viewport:{width:960,height:540}}); p._errs=[]; p.on('pageerror',e=>p._errs.push(e.message)); await p.goto(URL); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000});
   await p.click('#b-play'); await p.click('#b-newworld'); await p.fill('#wname','V'); await p.fill('#seedin','v1'); await p.click('[data-mode=survival]'); await p.click('[data-type=flat]'); await p.click('#b-create');
   await p.waitForFunction(()=>window.__eval('P.ready'),null,{timeout:60000}); await sleep(800); await p.click('.wcard.cur .wb button >> nth=0'); await p.waitForFunction(()=>window.__eval('started'),null,{timeout:20000}); await sleep(2500);
   await p.evaluate(()=>document.getElementById('clickplay')&&document.getElementById('clickplay').dispatchEvent(new Event('pointerdown',{cancelable:true}))); await sleep(600); return p; };
 const state=p=>ev(p,()=>({fallback,needClick,lockFails,real:document.pointerLockElement===canvas,cp:getComputedStyle(document.getElementById('clickplay')||document.body).display}));
 // (a) the raw-input option throws, plain request works
 { const p=await start(); await ev(p,()=>{ window.__lock=null; Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>window.__lock}); window.__calls=[]; canvas.requestPointerLock=function(o){ window.__calls.push(o?'raw':'plain'); if(o) throw new TypeError('options not supported'); window.__lock=canvas; setTimeout(()=>document.dispatchEvent(new Event('pointerlockchange')),20); return Promise.resolve(); }; lockFails=0; fallback=false; needClick=false; });
   await ev(p,()=>{ captureMouse(); }); await sleep(2200); const s=await state(p); const calls=await ev(p,()=>window.__calls);
   ok('(a) option throws: falls back to a plain request and captures the mouse',s.real&&!s.fallback&&s.lockFails===0&&calls.join()==='raw,plain',JSON.stringify({s,calls})); ok('(a) no page errors',p._errs.length===0,JSON.stringify(p._errs)); await p.close(); }
 // (b) request returns undefined (no Promise) and succeeds
 { const p=await start(); await ev(p,()=>{ window.__lock=null; Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>window.__lock}); canvas.requestPointerLock=function(){ window.__lock=canvas; setTimeout(()=>document.dispatchEvent(new Event('pointerlockchange')),20); }; lockFails=0; fallback=false; needClick=false; });
   await ev(p,()=>{ captureMouse(); }); await sleep(2200); const s=await state(p); ok('(b) no Promise return value: captured with no errors',s.real&&!s.fallback&&p._errs.length===0,JSON.stringify({s,e:p._errs})); await p.close(); }
 // (c) silent: neither lock nor error ever arrives
 { const p=await start(); await ev(p,()=>{ window.__lock=null; Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>window.__lock}); canvas.requestPointerLock=function(){ return new Promise(()=>{}); }; lockFails=0; fallback=false; needClick=false; });
   await ev(p,()=>{ captureMouse(); }); await sleep(4000); let s=await state(p); ok('(c) silent failure is noticed (watchdog) and the game asks for a click',s.needClick===true&&s.lockFails===1&&s.cp!=='none',JSON.stringify(s));
   await p.evaluate(()=>document.getElementById('clickplay').dispatchEvent(new Event('pointerdown',{cancelable:true}))); await sleep(4500); s=await state(p); ok('(c) a second silent failure ends in drag-look (never stuck)',s.fallback===true&&s.cp==='none',JSON.stringify(s));
   const canMove=await ev(p,()=>locked()); ok('(c) the player can still move and look in drag mode',canMove===true); await p.close(); }
 console.log(fails?'FAILS '+fails:'ALL PASS'); await b.close(); process.exit(fails?1:0); })().catch(e=>{ console.log('FAIL',e.message); process.exit(1); });
