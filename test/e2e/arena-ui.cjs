// E2E: two browsers join a Gun Arena world, the round starts, one shoots the other (server-authoritative hit), HUD + kill feed react.
//   VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/arena-ui.cjs
const {chromium}=require('playwright');
const URL=process.argv[2]||'http://localhost:8090/';
let fails=0; const ok=(n,c,x='')=>{console.log(c?'PASS':'FAIL',n,x); if(!c)fails++;};
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
const wf=async(p,fn,arg,opt)=>{ await p.waitForFunction(()=>typeof window.__eval==='function',null,opt); return p.waitForFunction(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg],opt); };
(async()=>{
 const tok='testtoken123', name='Arena '+Date.now()%1000;
 const cr=await fetch(URL+'api/admin/worlds',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({name,seed:'arena',type:'flat',mode:'pvp',mobs:false})}); ok('pvp world created',cr.status===201,await cr.text());
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const mk=async(nm)=>{
   const ctx=await b.newContext({viewport:{width:1100,height:700}}); const p=await ctx.newPage(); p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error') p.errs.push(m.text().slice(0,200)); });
   await p.goto(URL+'?e2e=1'); await wf(p,()=>P.ready,null,{timeout:60000});
   await p.click('#b-mp'); await p.waitForTimeout(1500);
   await ev(p,(n)=>{ activeProfile().name=n; saveProfiles(); syncProfile(); },nm);
   const idx=await p.evaluate((nm)=>[...document.querySelectorAll('.srvworld')].findIndex(r=>r.textContent.includes(nm)),name); ok(nm+' sees pvp world in browser',idx>=0);
   await p.locator('.srvworld button').nth(idx).click(); await wf(p,()=>P.ready&&mp,null,{timeout:60000}); await p.waitForTimeout(1500); return p; };
 const A=await mk('Alice'), B=await mk('Bob');
 ok('arena mode active on client',await ev(A,()=>MODE==='pvp'&&arena.active()));
 await wf(A,()=>arena.st.mg&&arena.st.mg.state==='play',null,{timeout:30000}); ok('round started after lobby countdown',true);
 const banner=await A.evaluate(()=>document.body.innerText); ok('HUD shows GUN ARENA + weapon',banner.includes('GUN ARENA')&&banner.includes('Rifle')||banner.includes('Pistol'),banner.slice(0,80).replace(/\n/g,' | '));
 // shoot Bob from Alice at close range, retrying around cover
 let hit=false;
 for(const off of [[3,0],[-3,0],[0,3],[0,-3]]){
   const bp=await ev(B,()=>[P.x,P.y,P.z]); await ev(A,(a)=>{ P.x=a[0]; P.y=a[1]; P.z=a[2]; },[bp[0]+off[0],bp[1],bp[2]+off[1]]); await A.waitForTimeout(700);
   await ev(A,(o)=>{ const d=[ -o[0], -.03, -o[1] ]; const l=Math.hypot(...d); ws.send(JSON.stringify({t:'shoot',w:1,dx:d[0]/l,dy:d[1]/l,dz:d[2]/l})); },off); await A.waitForTimeout(500);
   if((await ev(B,()=>arena.st.hp))<20){ hit=true; break; }
 }
 ok('Bob took server-side damage',hit,String(await ev(B,()=>arena.st.hp)));
 ok('Alice got hit marker/ammo decreased',(await ev(A,()=>arena.st.ammo[1]))<30);
 ok('no page errors',A.errs.length+B.errs.length===0,JSON.stringify([...A.errs,...B.errs].slice(0,3)));
 await b.close(); console.log('FAILS',fails); process.exit(fails?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
