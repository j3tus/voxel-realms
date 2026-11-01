// E2E: phone viewport - analog joystick speed scales with deflection; sprint at full push.
const {chromium,devices}=require('playwright');
const URL=(process.argv[2]||'http://localhost:8090/')+'?e2e=1';
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
(async()=>{
 const b=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const ctx=await b.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true,deviceScaleFactor:2,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'});
 const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto(URL); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000});
 await p.click('#b-play'); await p.click('#b-newworld'); await p.fill('#wname','Mob'); await p.fill('#seedin','mob1'); await p.click('[data-mode=creative]'); await p.click('[data-type=flat]'); await p.click('#b-create');
 await p.waitForFunction(()=>window.__eval('P.ready'),null,{timeout:60000}); await p.click('.wcard.cur .wb button'); await p.waitForFunction(()=>window.__eval('started'),null,{timeout:30000});
 console.log('cfg',JSON.stringify(await ev(p,()=>({rd:cfg.rd,shadows:cfg.shadows,ao:cfg.ao,bloom:cfg.bloom}))));
 await ev(p,()=>{ P.fly=false; P.y+=4; P.vy=0; }); await p.waitForFunction(()=>window.__eval('P.onGround'),null,{timeout:20000});
 await p.evaluate(()=>{ Element.prototype.setPointerCapture=()=>{}; });
 const stick=(type,dx,dy)=>p.evaluate(([t,dx,dy])=>{ const el=document.getElementById('tstick'); const o={bubbles:true,pointerId:7,clientX:150+dx,clientY:250+dy,pointerType:'touch'}; el.dispatchEvent(new PointerEvent(t,o)); },[type,dx,dy]);
 const run=async(dy)=>{ await ev(p,()=>{P.vx=0;P.vz=0;}); const a=await ev(p,()=>({x:P.x,z:P.z})); await stick('pointerdown',0,0); await stick('pointermove',0,dy); await p.waitForTimeout(2500);
   const m=await ev(p,()=>({x:P.x,z:P.z,v:Math.hypot(P.vx,P.vz)})); await stick('pointerup',0,dy); await p.waitForTimeout(400); return +m.v.toFixed(2); };
 const half=await run(-36), full=await run(-72), tiny=await run(-12);
 console.log('speed tiny/half/full',tiny,half,full);
 if(!(tiny<half&&half<full)) throw new Error('speed does not scale with stick'); if(full<6) throw new Error('full push too slow: '+full);
 if(errs.length) throw new Error('page errors: '+errs.join('; '));
 console.log('PASS'); await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
