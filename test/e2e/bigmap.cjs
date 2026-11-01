// E2E: tapping the minimap (phone) / pressing M opens the full-screen map; explored terrain beyond render distance is remembered.
//   VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/bigmap.cjs [baseUrl] [screenshotPrefix]
const {chromium}=require('playwright'); const URL=process.argv[2]||'http://localhost:8090/', SHOT=process.argv[3]||''; let fails=0; const ok=(n,c,x='')=>{console.log(c?'PASS':'FAIL',n,x); if(!c)fails++;};
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
 for(const [label,opt] of [['phone',{viewport:{width:844,height:390},hasTouch:true,isMobile:true,deviceScaleFactor:1}],['desktop',{viewport:{width:1100,height:700}}]]){
  const ctx=await b.newContext(opt); const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(URL+'?e2e=1'); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000});
  await p.click('#b-play',{timeout:120000}); await p.click('#b-newworld'); await p.fill('#wname','M'); await p.fill('#seedin','map1'); await p.click('[data-mode=creative]'); await p.click('#b-create');
  await p.waitForFunction(()=>window.__eval('P.ready'),null,{timeout:60000}); await p.click('.wcard.cur .wb button',{timeout:120000}); await p.waitForFunction(()=>window.__eval('started'),null,{timeout:60000});
  await p.waitForTimeout(4000);
  for(let i=1;i<=8&&(await ev(p,()=>mapMem.size))===0;i++){ await ev(p,()=>{ P.x+=140; P.fly=true; }); await p.waitForTimeout(3500); } // keep flying until some chunks have streamed out
  ok(label+': explored chunks remembered',(await ev(p,()=>mapMem.size))>0,String(await ev(p,()=>mapMem.size)));
  if(label==='phone'){ await p.evaluate(()=>{ const m=document.getElementById('minimap'); const o={bubbles:true,pointerId:3,pointerType:'touch'}; m.dispatchEvent(new PointerEvent('pointerdown',o)); }); }
  else await p.keyboard.press('KeyM');
  await p.waitForTimeout(1200);
  ok(label+': big map opens',await ev(p,()=>bigMap.open));
  const dim=await p.evaluate(()=>{ const c=document.getElementById('bmcv'); const r=c.getBoundingClientRect(); return [Math.round(r.width),Math.round(r.height)]; }); ok(label+': map is large',dim[0]>=300,dim.join('x'));
  if(SHOT) await p.screenshot({path:SHOT+label+'.png'});
  await p.click('#bmin'); await p.click('#bmout'); await p.click('#bmx'); ok(label+': closes',!(await ev(p,()=>bigMap.open)));
  ok(label+': no page errors',errs.length===0,errs.slice(0,2).join('|')); await ctx.close();
 }
 await b.close(); console.log('FAILS',fails); process.exit(fails?1:0);
})().catch(e=>{console.error('FAIL',e.message.slice(0,300));process.exit(1)});
