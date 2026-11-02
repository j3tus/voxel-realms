// E2E: join the lobby hub, see portals, walk into one -> transferred into that world (page reload + auto-join), then /lobby brings you back.
//   VITE_E2E=1 npm run build   first (compiles in the test hook), then
//   VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/lobby.cjs [baseUrl] [screenshot.png]
const {chromium}=require('playwright'); const URL=process.argv[2]||'http://localhost:8090/', SHOT=process.argv[3]||''; let fails=0; const ok=(n,c,x='')=>{console.log(c?'PASS':'FAIL',n,x); if(!c)fails++;};
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
const H={Authorization:'Bearer testtoken123','Content-Type':'application/json'};
(async()=>{
 const mkw=async(name,mode,type='flat')=>{ const r=await fetch(URL+'api/admin/worlds',{method:'POST',headers:H,body:JSON.stringify({name,seed:'lb'+mode,type,mode,mobs:false,maxPlayers:16})}); return (await r.json()).id; };
 const lobbyId=await mkw('Lobby','lobby'); const pvp=await mkw('Gun Arena X','pvp'); await mkw('Spleef X','spleef'); ok('worlds created',!!lobbyId&&!!pvp);
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:900,height:520}})).newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto(URL+'?e2e=1'); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000});
 await p.evaluate(id=>window.__eval('launch(location.host,"'+id+'")'),lobbyId);
 await p.waitForFunction(()=>window.__eval('started&&mp&&MODE')==='lobby'&&window.__eval('lobbyVis.count')>=2,null,{timeout:120000}); ok('in lobby with portals',true,String(await ev(p,()=>lobbyVis.count)));
 await p.waitForTimeout(500); ok('lobby hides hotbar, held block and block prompt',await p.evaluate(()=>!window.__eval('vm.visible')&&getComputedStyle(document.getElementById('hotbar')).display==='none'&&getComputedStyle(document.getElementById('prompt')).display==='none'));
 await p.waitForTimeout(4000); if(SHOT) await p.screenshot({path:SHOT});
 // face the first portal and walk into it
 const portals=await ev(p,()=>lobbyVis.portals);
 ok('lobby snapshot lists game worlds',portals.length>=2,portals.map(x=>x.name+':'+x.n+'/'+x.max).join(', '));
 const dest=portals.find(x=>x.id===pvp)||portals[0];
 await ev(p,(d)=>{ P.x=d.x; P.z=d.z; P.y=d.y-2; },dest);
 await p.waitForNavigation({timeout:30000}).catch(()=>{});
 await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:90000});
 await p.waitForFunction(()=>window.__eval('started&&mp&&mpWorld'),null,{timeout:120000});
 ok('portal transferred us to the destination world',(await ev(p,()=>mpWorld))===dest.id,await ev(p,()=>mpWorld+' / '+MODE));
 // after an automatic transfer there was no click, so the browser would refuse mouse capture: we must ask for one (not silently fall back to drag-to-look)
 await p.waitForTimeout(800); const cp=await p.evaluate(()=>({overlay:getComputedStyle(document.getElementById('clickplay')||document.body).display==='grid'&&!!document.getElementById('clickplay'),fallback:window.__eval('fallback'),needClick:window.__eval('needClick')}));
 ok('click-to-play shown after a transfer (no broken cursor)',cp.overlay&&cp.fallback===false&&cp.needClick===true,JSON.stringify(cp));
 await p.mouse.click(450,260); await p.waitForTimeout(700); ok('overlay dismissed by the click',await p.evaluate(()=>getComputedStyle(document.getElementById('clickplay')).display==='none'&&window.__eval('needClick')===false));
 // back to the lobby via the chat command (what the menu button sends)
 await p.evaluate(()=>window.__eval('ws.send(JSON.stringify({t:"chat",text:"/lobby"}))')); await p.waitForNavigation({timeout:30000}).catch(()=>{});
 await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:90000});
 await p.waitForFunction(()=>window.__eval('started&&mp&&MODE')==='lobby',null,{timeout:120000}); ok('/lobby returned us to the lobby',true);
 ok('no page errors',errs.length===0,errs.slice(0,2).join('|')); await b.close(); console.log('FAILS',fails); process.exit(fails?1:0);
})().catch(e=>{console.error('FAIL',e.message.slice(0,300));process.exit(1)});
