// E2E (Playwright). Needs a running server:  VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/<file> [baseUrl]
// Install the browser once with `npx playwright install chromium`. Some scripts wait out the admin brute-force lockout on purpose.
const {chromium}=require('playwright');
const URL=(process.argv[2]||'http://localhost:8090/')+'?e2e=1';
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:960,height:540}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto(URL); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000});
 await p.click('#b-play'); await p.click('#b-continue'); await p.waitForTimeout(2000);
 const scenario=async(name,setup,ms=6000)=>{
   await ev(p,setup); await sleep(800); await ev(p,()=>{ perf.update=0; perf.render=0; perf.maxUpdate=0; perf.frames=0; perf.over16=0; window.__lt=[]; });
   await p.evaluate(()=>{ window.__long=0; new PerformanceObserver(l=>{ window.__long+=l.getEntries().length; }).observe({entryTypes:['longtask']}); });
   const heap0=await p.evaluate(()=>performance.memory?performance.memory.usedJSHeapSize:0);
   await sleep(ms); const r=await ev(p,()=>({upd:+perf.update.toFixed(2),rnd:+perf.render.toFixed(2),worst:+perf.maxUpdate.toFixed(1),frames:perf.frames,over16:perf.over16,chunks:chunks.size,mobs:mobViews.size,parts:fx.soft.n+fx.glow.n+fx.n}));
   const heap1=await p.evaluate(()=>performance.memory?performance.memory.usedJSHeapSize:0), lt=await p.evaluate(()=>window.__long);
   console.log(name.padEnd(34),`JS update ${String(r.upd).padStart(5)} ms  render-submit ${String(r.rnd).padStart(5)} ms  worst ${String(r.worst).padStart(5)} ms  frames ${String(r.frames).padStart(3)}  >16ms ${String(r.over16).padStart(3)}  chunks ${r.chunks}  mobs ${r.mobs}  particles ${r.parts}  longtasks ${lt}  heapΔ ${((heap1-heap0)/1048576).toFixed(1)}MB`);
 };
 await scenario('idle (RD 7)',()=>{ cfg.time='day'; P.fly=true; });
 await scenario('fly fast, streaming chunks',()=>{ keys.KeyW=true; keys.ShiftLeft=true; },9000); await ev(p,()=>{ keys.KeyW=false; keys.ShiftLeft=false; });
 await scenario('render distance 12',()=>{ cfg.rd=12; applyCfg(); },7000);
 await scenario('40 NPCs',()=>{ cfg.rd=7; applyCfg(); for(let i=0;i<40;i++) sim.spawn(['pig','villager','zombie'][i%3],P.x+((i%8)-4)*3,P.y,P.z+((i/8|0)-2)*3); });
 await scenario('storm + night',()=>{ setWeather('storm',true); cfg.time='night'; });
 await scenario('particle spam',()=>{ setWeather('clear',true); cfg.time='day'; for(let i=0;i<40;i++) setTimeout(()=>{ fx.debris(P.x,P.y+1,P.z-3,0x886644,40); fx.spark(P.x,P.y+1,P.z-3,0xffc766,60,4); fx.dust(P.x,P.y,P.z-3,30); },i*100); },4500);
 await scenario('block edit storm (remesh)',()=>{ window.__edit=setInterval(()=>{ for(let i=0;i<6;i++){ const x=Math.floor(P.x)+((Math.random()*20)|0)-10, z=Math.floor(P.z)+((Math.random()*20)|0)-10; let y=70; while(y>0&&!getB(x,y,z)) y--; setBlock(x,y,z,Math.random()<.5?0:3); } },50); },5000); await ev(p,()=>clearInterval(window.__edit));
 await scenario('shadows off, bloom off (Low)',()=>{ Object.assign(cfg,{shadows:0,bloom:false}); applyCfg(); });
 console.log(errs.join('|')||'no page errors'); await b.close();
})();
