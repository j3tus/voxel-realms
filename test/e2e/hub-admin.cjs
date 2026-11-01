// E2E (API level): game-hub setup, per-world portal toggle, lobby-only listing data, private bot games via /create and /join.
//   VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/hub-admin.cjs [baseUrl]
const WebSocket=require('ws'); const URL=process.argv[2]||'http://localhost:8090/'; let fails=0; const ok=(n,c,x='')=>{console.log(c?'PASS':'FAIL',n,x); if(!c)fails++;};
const H={Authorization:'Bearer testtoken123','Content-Type':'application/json'}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(m,p,b)=>{ const r=await fetch(URL+'api/admin'+p,{method:m,headers:H,body:b?JSON.stringify(b):undefined}); return r.json(); };
const join=(world,name)=>new Promise(res=>{ const ws=new WebSocket(URL.replace('http','ws')+'ws/'+world); const st={ws,msgs:[],lobby:null}; ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name,uid:'e2e-'+name+Math.random(),v:2}))); ws.on('message',d=>{ if(Buffer.isBuffer(d)&&d[0]!==123) return; let m; try{m=JSON.parse(d.toString())}catch{return} st.msgs.push(m); if(m.t==='lobby') st.lobby=m; }); setTimeout(()=>res(st),700); });
(async()=>{
 const r=await api('POST','/hub',{modes:['pvp','tdm','zombies']}); ok('hub created the lobby and the chosen games',r.ok&&r.created.includes('lobby')&&r.created.length>=3,JSON.stringify(r.created));
 const again=await api('POST','/hub',{modes:['pvp','tdm','zombies']}); ok('hub setup is idempotent',again.ok&&again.created.length===0,JSON.stringify(again.created));
 const worlds=await api('GET','/worlds'); const lobby=worlds.find(w=>w.mode==='lobby'), pvp=worlds.find(w=>w.mode==='pvp'); ok('lobby + games exist',!!lobby&&!!pvp);
 let a=await join(lobby.id,'Lia'); await sleep(1500); const before=a.lobby&&a.lobby.portals.map(p=>p.id); ok('lobby lists a portal per game',before&&before.includes(pvp.id),before&&before.join(','));
 const t=await api('PATCH',`/worlds/${pvp.id}/portal`,{show:false}); ok('portal can be switched off',t.ok&&t.lobby===false); await sleep(2500);
 const after=a.lobby.portals.map(p=>p.id); ok('lobby drops the disabled game',!after.includes(pvp.id)&&after.length===before.length-1,after.join(','));
 await api('PATCH',`/worlds/${pvp.id}/portal`,{show:true}); await sleep(2500); ok('portal can be switched back on',a.lobby.portals.map(p=>p.id).includes(pvp.id));
 // private game with bots
 a.msgs.length=0; a.ws.send(JSON.stringify({t:'chat',text:'/create pvp 3 easy'})); await sleep(1500);
 const tr=a.msgs.find(m=>m.t==='transfer'); ok('/create sends the creator into a new private game',!!tr&&/^g/.test(tr.world),tr&&tr.world);
 const priv=(await api('GET','/worlds')).find(w=>w.id===tr.world); ok('private game exists with fixed bots meta',!!priv&&priv.private===true&&priv.bots===3&&priv.botsFixed===true);
 const me=await join(tr.world,'Lia2'); await sleep(2500); const live=(await api('GET','/players')).filter(p=>p.world===tr.world); ok('bots joined the private game',live.filter(p=>/^\[Bot\]/.test(p.name)).length===3,live.map(p=>p.name).join(','));
 const lst=a.lobby.portals.map(p=>p.id); await sleep(1200); ok('private games never show up as lobby portals',!a.lobby.portals.map(p=>p.id).includes(tr.world));
 a.msgs.length=0; a.ws.send(JSON.stringify({t:'chat',text:'/join '+tr.world})); await sleep(800); ok('/join <code> sends a friend there',!!a.msgs.find(m=>m.t==='transfer'&&m.world===tr.world));
 a.msgs.length=0; a.ws.send(JSON.stringify({t:'chat',text:'/create pvp 2'})); await sleep(800); ok('only one private game per player',!a.msgs.find(m=>m.t==='transfer'));
 me.ws.close(); a.ws.close(); console.log('FAILS',fails); process.exit(fails?1:0);
})().catch(e=>{console.error('FAIL',e.message.slice(0,300));process.exit(1)});
