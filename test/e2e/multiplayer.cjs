// E2E (Playwright). Needs a running server:  VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/<file> [baseUrl]
// Install the browser once with `npx playwright install chromium`. Some scripts wait out the admin brute-force lockout on purpose.
const {chromium}=require('playwright');
const URL=process.argv[2]||'http://localhost:8090/';
let fails=0; const ok=(n,c,x='')=>{console.log(c?'PASS':'FAIL',n,x); if(!c)fails++;};
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
const wf=async(p,fn,arg,opt)=>{ await p.waitForFunction(()=>typeof window.__eval==='function',null,opt); return p.waitForFunction(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg],opt); };
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const mk=async(name)=>{
   const ctx=await b.newContext({viewport:{width:1100,height:700}}); const p=await ctx.newPage(); p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error') p.errs.push(m.text().slice(0,200)); });
   await p.goto(URL+'?e2e=1'); await wf(p,()=>P.ready,null,{timeout:60000});
   await p.click('#b-mp'); await p.waitForTimeout(1500);
   await ev(p,(n)=>{ activeProfile().name=n; saveProfiles(); syncProfile(); },name);
   // server browser should have auto-detected this site
   const cards=await p.evaluate(()=>[...document.querySelectorAll('.srvcard')].map(c=>c.textContent.replace(/\s+/g,' ').slice(0,120)));
   ok(name+' browser lists server',cards.length>0,JSON.stringify(cards));
   await p.click('.srvworld button'); await wf(p,()=>P.ready&&mp,null,{timeout:60000}); await p.waitForTimeout(1500); return p; };
 const A=await mk('Alice'), B=await mk('Bob');
 ok('A in mp',await ev(A,()=>mp&&myId>0&&!!ws)); ok('same seed',(await ev(A,()=>SEED))===(await ev(B,()=>SEED)));
 await A.waitForTimeout(1200);
 ok('A sees Bob',await ev(A,()=>others.size===1)); ok('B sees Alice',await ev(B,()=>others.size===1));
 // positions
 await ev(B,()=>{P.fly=true});
 const bp=await ev(B,()=>[P.x,P.y,P.z]); await ev(A,(c)=>{P.x=c[0]+3;P.y=c[1];P.z=c[2];},bp); await A.waitForTimeout(1500);
 const seen=await ev(B,()=>{const o=[...others.values()][0];return [o.x,o.y,o.z]}); ok('B sees A pos',Math.abs(seen[0]-(bp[0]+3))<.6,JSON.stringify([seen,bp]));
 // block sync
 await ev(A,()=>{ const x=Math.floor(P.x)+2,z=Math.floor(P.z); let y=70; while(y>0&&getB(x,y,z)===0)y--; window.T=[x,y+1,z]; setBlock(x,y+1,z,28); });
 await B.waitForTimeout(800); const t=await ev(A,()=>T); ok('B got block',await ev(B,(t)=>getB(t[0],t[1],t[2])===28,t));
 // chat
 await A.keyboard.press('Enter'); await A.keyboard.type('hello from alice'); await A.keyboard.press('Enter'); await B.waitForTimeout(800);
 ok('chat relay',(await B.evaluate(()=>document.getElementById('chatlog').textContent)).includes('Alice: hello from alice'));
 // time + weather + mobs
 const tm=await ev(A,()=>[timeSync.t,timeSync.len,worldTime]); ok('time synced',tm[1]>0&&Math.abs(((tm[2]-tm[0])+1.5)%1-.5)<.1,JSON.stringify(tm));
 const t2=await ev(B,()=>[timeSync.t,worldTime]); ok('A/B time close',Math.abs(((tm[2]-t2[1])+1.5)%1-.5)<.05,JSON.stringify([tm,t2]));
 // admin command via REST changes weather+time for both
 const tok='testtoken123';
 const r1=await fetch(URL+'api/admin/worlds/main/command',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({cmd:'weather storm'})}); ok('admin cmd ok',r1.ok,await r1.text());
 await fetch(URL+'api/admin/worlds/main/command',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({cmd:'time night'})});
 await A.waitForTimeout(1500);
 ok('weather synced',(await ev(A,()=>wx.type))==='storm'&&(await ev(B,()=>wx.type))==='storm');
 ok('night synced',(await ev(A,()=>timeSync.t))>.8);
 await fetch(URL+'api/admin/worlds/main/command',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({cmd:'spawn zombie 3'})});
 await fetch(URL+'api/admin/worlds/main/command',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({cmd:'spawn pig 2'})});
 // spawn requires a player context; console has fallback to first player
 await A.waitForTimeout(2500);
 const mA=await ev(A,()=>mobViews.size), mB=await ev(B,()=>mobViews.size); ok('NPCs synced to both',mA>0&&mA===mB,[mA,mB]);
 // economy-free creative: attack mob
 const mobs=await ev(A,()=>[...mobViews.values()].map(m=>m.id+':'+m.type)); console.log('mobs',mobs.join(','));
 // admin status & players
 const st=await (await fetch(URL+'api/admin/status',{headers:{Authorization:'Bearer '+tok}})).json(); ok('admin status players=2',st.players===2,JSON.stringify(st.worlds));
 const pl=await (await fetch(URL+'api/admin/players',{headers:{Authorization:'Bearer '+tok}})).json(); ok('admin players list',pl.length===2&&pl.some(p=>p.name==='Alice'));
 // kick Bob
 const bobId=pl.find(p=>p.name==='Bob').id; const kr=await fetch(URL+`api/admin/players/${bobId}/kick`,{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:'{}'}); ok('kick ok',kr.ok);
 await A.waitForTimeout(1500); ok('A sees Bob leave',await ev(A,()=>others.size===0));
 await A.screenshot({path:'mp_final.png'});
 for(const p of [A]) ok('no page errors',p.errs.filter(e=>!/Failed to load resource|ERR_/.test(e)).length===0,p.errs.join('|'));
 console.log('FAILS',fails); await b.close();
})();
