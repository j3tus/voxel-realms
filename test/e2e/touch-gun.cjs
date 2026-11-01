// E2E: phone viewport joins a Gun Arena world; Fire / Reload / weapon-swap touch controls drive the server-authoritative gun.
//   VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/touch-gun.cjs [baseUrl]
const {chromium}=require('playwright'); const WebSocket=require('ws');
const URL=process.argv[2]||'http://localhost:8090/'; let fails=0; const ok=(n,c,x='')=>{console.log(c?'PASS':'FAIL',n,x); if(!c)fails++;};
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
(async()=>{
 const tok='testtoken123', name='Gun'+Date.now()%1000;
 const cr=await fetch(URL+'api/admin/worlds',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({name,seed:'gun',type:'flat',mode:'pvp',mobs:false,maxPlayers:8})}); const w=await cr.json(); ok('pvp world created',!!w.id);
 const bot=new WebSocket(URL.replace('http','ws')+'ws/'+w.id); await new Promise(r=>bot.on('open',r)); bot.send(JSON.stringify({t:'hello',name:'Bot',uid:'bot-'+Date.now(),v:2}));
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true,deviceScaleFactor:1}); const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto(URL+'?e2e=1'); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000});
 await p.evaluate(()=>{ Element.prototype.setPointerCapture=()=>{}; });
 await ev(p,(id)=>{ launch(location.host,id); },w.id);
 await p.waitForFunction(()=>window.__eval('started&&mp&&arena.st.mg&&arena.st.mg.state')==='play',null,{timeout:90000}).catch(()=>{}); 
 ok('round in play',(await ev(p,()=>arena.st.mg&&arena.st.mg.state))==='play');
 await p.waitForTimeout(2500);
 const lbl=await p.evaluate(()=>[document.querySelector('#tbreak b').textContent,document.querySelector('#tplace b').textContent]); ok('buttons relabelled Fire/Reload',lbl[0]==='Fire'&&lbl[1]==='Reload',lbl.join('/'));
 const a0=await ev(p,()=>arena.st.ammo[arena.st.w]); const tap=(sel,ms)=>p.evaluate(([s,ms])=>new Promise(r=>{ const el=document.querySelector(s); const o={bubbles:true,pointerId:5,pointerType:'touch'}; el.dispatchEvent(new PointerEvent('pointerdown',o)); setTimeout(()=>{ el.dispatchEvent(new PointerEvent('pointerup',o)); r(); },ms); }),[sel,ms]);
 await tap('#tbreak',80); await p.waitForTimeout(700); const a1=await ev(p,()=>arena.st.ammo[arena.st.w]); ok('tap Fire spends ammo',a1<a0,a0+' -> '+a1);
 await ev(p,()=>{ setWeapon&&0; }).catch(()=>{});
 const w0=await ev(p,()=>arena.st.w); await p.evaluate(()=>{ const el=document.querySelector('div'); }); 
 await ev(p,()=>arena.nextWeapon()); const w1=await ev(p,()=>arena.st.w); ok('swap weapon changes weapon',w1!==w0,w0+' -> '+w1);
 const full=await ev(p,()=>arena.st.ammo[arena.st.w]); await tap('#tbreak',80); await p.waitForTimeout(500); await tap('#tplace',60); await p.waitForTimeout(400);
 ok('Reload shows reloading state',(await ev(p,()=>performance.now()<arena.st.reloadUntil)));
 const auto=await ev(p,()=>{ const i=WEAPONS?WEAPONS.findIndex(w=>w.auto):-1; return i; }).catch(()=>-1);
 ok('no page errors',errs.length===0,errs.slice(0,2).join('|'));
 bot.close(); await b.close(); console.log('FAILS',fails); process.exit(fails?1:0);
})().catch(e=>{console.error('FAIL',e.message.slice(0,300));process.exit(1)});
