// E2E: pointer-lock recovery. A refused lock must first ask for a click (not drop to drag-look for the whole session),
// only fall back after a repeated failure, and return to real capture as soon as a lock succeeds.
const {chromium}=require('playwright');
const URL=(process.argv[2]||'http://localhost:8090/')+'?e2e=1';
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:960,height:540}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto(URL); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000});
 await p.click('#b-play'); await p.click('#b-newworld'); await p.fill('#wname','Lock'); await p.fill('#seedin','lock1'); await p.click('[data-mode=survival]'); await p.click('[data-type=flat]'); await p.click('#b-create');
 await p.waitForFunction(()=>window.__eval('P.ready'),null,{timeout:60000}); await p.waitForTimeout(800); await p.click('.wcard.cur .wb button >> nth=0');
 await p.waitForFunction(()=>window.__eval('started'),null,{timeout:20000}); await p.waitForTimeout(2500);
 // headless Chromium grants the lock instantly, so simulate a browser that has none and refuses every request
 await p.evaluate(()=>document.getElementById('clickplay')&&document.getElementById('clickplay').dispatchEvent(new Event('pointerdown',{cancelable:true}))); await p.waitForTimeout(500);
 await ev(p,()=>{ window.__fail=true; window.__lock=null; Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>window.__lock});
   canvas.requestPointerLock=()=>{ if(window.__fail){ setTimeout(()=>document.dispatchEvent(new Event('pointerlockerror')),20); return Promise.reject(new Error('refused')); } window.__lock=canvas; setTimeout(()=>document.dispatchEvent(new Event('pointerlockchange')),20); return Promise.resolve(); }; lockFails=0; needClick=false; });
 await p.evaluate(()=>document.dispatchEvent(new Event('pointerlockerror')));                          // failure #1 (e.g. Esc re-lock refused)
 await p.waitForTimeout(300);
 const s1=await ev(p,()=>({fallback,needClick,lockFails}));
 ok('first failure asks for a click instead of giving up',s1.needClick===true&&s1.fallback===false&&s1.lockFails===1,JSON.stringify(s1));
 ok('click overlay is visible',await p.evaluate(()=>{ const e=document.getElementById('clickplay'); return !!e&&getComputedStyle(e).display!=='none'; }));
 await p.evaluate(()=>document.getElementById('clickplay').dispatchEvent(new Event('pointerdown',{cancelable:true})));   // user clicks; the request is refused again
 await p.waitForFunction(()=>window.__eval('lockFails>=2||fallback'),null,{timeout:12000}).catch(()=>{}); // the retry waits out the browser's re-lock cooldown; a loaded page can be slow, so wait for the condition, not a fixed time
 const s2=await ev(p,()=>({fallback,needClick,lockFails}));
 ok('repeated failure falls back to drag-look',s2.fallback===true,JSON.stringify(s2));
 // now the browser allows it: clicking the game should bring back real capture
 await ev(p,()=>{ window.__fail=false; });
 await ev(p,()=>canvas.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true})));
 await p.waitForFunction(()=>window.__eval('window.__lock===canvas'),null,{timeout:12000}).catch(()=>{});
 const s3=await ev(p,()=>({fallback,lockFails,real:window.__lock===canvas}));
 ok('a later click recovers real pointer capture',s3.fallback===false&&s3.lockFails===0&&s3.real,JSON.stringify(s3));
 ok('no page errors',errs.length===0,JSON.stringify(errs));
 console.log(fails?'FAILS '+fails:'ALL PASS'); await b.close(); process.exit(fails?1:0);
})().catch(e=>{ console.log('FAIL',e.message); process.exit(1); });
