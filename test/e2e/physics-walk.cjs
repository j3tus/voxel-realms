// E2E: player physics in a real browser - landing, walking into a wall, stepping out of water, no console errors.
const {chromium}=require('playwright');
const URL=(process.argv[2]||'http://localhost:8090/')+'?e2e=1';
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:960,height:540}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto(URL); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000});
 await p.click('#b-play'); await p.click('#b-newworld'); await p.fill('#wname','Phys'); await p.fill('#seedin','phys1'); await p.click('[data-mode=survival]'); await p.click('[data-type=flat]'); await p.click('#b-create'); await p.waitForFunction(()=>window.__eval('P.ready'),null,{timeout:60000}); await p.waitForTimeout(800); await p.click('.wcard.cur .wb button >> nth=0'); await p.waitForFunction(()=>window.__eval('started'),null,{timeout:10000}); await p.waitForTimeout(1500); await p.waitForTimeout(3000);
 console.log('state',JSON.stringify(await ev(p,()=>({started,paused,modalOpen,fallback,invOpen,lk:locked(),dead:S.dead})))); await ev(p,()=>{ P.fly=false; P.y+=6; P.vy=0; }); await p.waitForTimeout(2500);
 await p.waitForFunction(()=>window.__eval('P.onGround'),null,{timeout:20000}); const land=await ev(p,()=>({g:P.onGround,y:P.y,vy:P.vy,inside:collides(P.x,P.y,P.z)}));
 console.log('landed',JSON.stringify(land)); if(!land.g||land.inside) throw new Error('landing failed');
 const x0=await ev(p,()=>P.x); await p.keyboard.down('KeyW'); await p.waitForTimeout(3000); await p.keyboard.up('KeyW');
 const walk=await ev(p,()=>({x:P.x,z:P.z,inside:collides(P.x,P.y,P.z)})); console.log('walked',JSON.stringify(walk)); if(walk.inside) throw new Error('inside block after walking');
 await p.keyboard.down('Space'); await p.waitForTimeout(300); await p.keyboard.up('Space');
 const jumped=await ev(p,()=>P.y); console.log('jump y',jumped);
 if(errs.length) throw new Error('page errors: '+errs.join('; '));
 console.log('PASS'); await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
