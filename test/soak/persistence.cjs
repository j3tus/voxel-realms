// Restart persistence test. Spawns its own server (port 8111):  node test/soak/persistence.cjs $(mktemp -d)   (run from the repo root)
const WS=require('ws'); const {spawn,execSync}=require('child_process'); const fs=require('fs');
const D=process.argv[2], PORT=8111, U='http://127.0.0.1:'+PORT; const H={Authorization:'Bearer testtoken123','Content-Type':'application/json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
const api=async(m,p,b)=>{ const r=await fetch(U+'/api/admin'+p,{method:m,headers:b?H:{Authorization:H.Authorization},body:b?JSON.stringify(b):undefined}); return r.json().catch(()=>({})); };
let proc; const start=async()=>{ proc=spawn('node',['server/index.js'],{cwd:process.cwd(),env:{...process.env,ADMIN_PASSWORD:'testtoken123',PORT:String(PORT),DATA_DIR:D,MAX_PER_IP:'40'},stdio:'ignore'}); for(let i=0;i<40;i++){ await sleep(500); try{ if((await fetch(U+'/api/health')).ok) return; }catch{} } throw new Error('no start'); };
const stop=async()=>{ proc.kill('SIGTERM'); await sleep(2500); };
const join=(w,n)=>new Promise(res=>{ const ws=new WS('ws://127.0.0.1:'+PORT+'/ws/'+w); const r={ws,chat:[]}; ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name:n,uid:'u-'+n,skin:{}}))); ws.on('message',d=>{ try{ const m=JSON.parse(d); if(m.t==='chat'&&m.sys) r.chat.push(m.text); }catch{} }); setTimeout(()=>res(r),900); });
(async()=>{
 await start(); await api('POST','/hub',{});
 const room=await api('POST','/rooms',{mode:'ctf',name:'Persist Room',players:12,bots:4,skill:'hard'}); ok('admin room created',room.players===12);
 await api('PATCH','/worlds/teamdeathmatch/bots',{bots:5,fixed:true,skill:'hard',paused:false}); await api('PATCH','/bots',{skill:'hard',density:1.5}); await api('PATCH','/worlds/main',{economy:true});
 await api('PATCH','/config',{name:'Persisted Server',motd:'hello after restart'});
 const op=await join('lobby','Maker'); op.ws.send(JSON.stringify({t:'chat',text:'/create tdm 8 2 public'})); await sleep(1500);
 const before=await api('GET','/worlds'); console.log('maker chat:',JSON.stringify(op.chat.slice(-3))); ok('player custom game exists before restart',before.some(w=>/Maker/.test(w.name)&&w.ephemeral));
 op.ws.close(); await sleep(500); await api('PATCH','/security',{maintenance:{on:true,msg:'Back later'}});
 await stop(); const cfg=JSON.parse(fs.readFileSync(D+'/config.json','utf8'));
 ok('config.json keeps no temporary rooms in worlds',!cfg.worlds.some(w=>w.ephemeral),String(cfg.worlds.length)+' worlds');
 ok('config.json stores the admin room definition',cfg.rooms&&cfg.rooms.length===1&&cfg.rooms[0].name==='Persist Room');
 ok('config.json stores bot defaults',cfg.bots&&cfg.bots.skill==='hard'&&cfg.bots.density===1.5);
 await start(); await sleep(1500);
 const w=await api('GET','/worlds'); const pr=w.find(x=>x.name==='Persist Room');
 ok('admin room is recreated after restart with its settings',pr&&pr.maxPlayers===12&&pr.room&&pr.room.source==='admin'&&pr.bots===4&&pr.botSkill==='hard',JSON.stringify(pr&&{n:pr.maxPlayers,b:pr.bots,s:pr.botSkill}));
 ok('player custom game is gone after restart (temporary)',!w.some(x=>/Maker/.test(x.name)));
 const t=w.find(x=>x.id==='teamdeathmatch'); ok('per-game bot settings persisted',t&&t.bots===5&&t.botsFixed===true&&t.botSkill==='hard',JSON.stringify(t&&{b:t.bots,f:t.botsFixed,s:t.botSkill}));
 const g=await api('GET','/bots'); ok('global bot settings persisted',g.skill==='hard'&&g.density===1.5);
 const sec=await api('GET','/security'); ok('maintenance mode persisted',sec.maintenance.on===true&&sec.maintenance.msg==='Back later');
 const info=await (await fetch(U+'/api/info')).json(); ok('server name and MOTD persisted',info.name==='Persisted Server'&&info.motd==='hello after restart'&&info.maintenance==='Back later');
 ok('economy flag persisted on main',w.find(x=>x.id==='main').economy===true);
 // lobby: round hall rebuilt, includes the admin room portal
 await api('PATCH','/security',{maintenance:{on:false}}); const lob=await new Promise(res=>{ const ws=new WS('ws://127.0.0.1:'+PORT+'/ws/lobby'); let snap=null; ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name:'Viewer',uid:'u-v',skin:{}}))); ws.on('message',d=>{ try{ const m=JSON.parse(d); if(m.t==='lobby') snap=m; }catch{} }); setTimeout(()=>{ ws.close(); res(snap); },2500); });
 ok('lobby shows a portal for the restored admin room',lob&&lob.portals.some(p=>/Persist Room/.test(p.name)),String(lob&&lob.portals.length)+' portals');
 // second restart without changes: idempotent (no duplicate rooms)
 await stop(); await start(); await sleep(1500); const w2=await api('GET','/worlds'); ok('a second restart does not duplicate admin rooms',w2.filter(x=>x.name==='Persist Room').length===1);
 const cfg2=JSON.parse(fs.readFileSync(D+'/config.json','utf8')); ok('rooms list stays a single entry',cfg2.rooms.length===1);
 await stop(); console.log(fails?'FAILS '+fails:'ALL PASS'); process.exit(fails?1:0);
})().catch(e=>{ console.log('FAIL exception',e.message); try{proc.kill();}catch{} process.exit(1); });
