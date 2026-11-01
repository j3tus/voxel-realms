// Capacity under 38 simulated players. Server:  ADMIN_PASSWORD=testtoken123 MAX_PER_IP=500 WS_RATE=5000 PORT=8121 DATA_DIR=$(mktemp -d) npm start   (WS_RATE: the default limits new sockets to 30/min per IP)
const WS=require('ws'); const A={Authorization:'Bearer testtoken123','Content-Type':'application/json'}; const U='http://127.0.0.1:8121';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
const api=async(m,p,b)=>{ const r=await fetch(U+'/api/admin'+p,{method:m,headers:b?A:{Authorization:A.Authorization},body:b?JSON.stringify(b):undefined}); return r.json().catch(()=>({})); };
const join=(w,n)=>new Promise(res=>{ const ws=new WS('ws://127.0.0.1:8121/ws/'+w); const r={ws,chat:[]}; ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name:n,uid:'u-'+n,skin:{}}))); ws.on('message',d=>{ try{ const m=JSON.parse(d); if(m.t==='chat'&&m.sys) r.chat.push(m.text); }catch{} }); ws.on('error',e=>{ r.err=e.message; }); setTimeout(()=>res(r),120); });
const cap=async()=>{ const s=await api('GET','/status'); return {...s.capacity,bots:s.bots,players:s.players,rooms:s.worlds.length,tps:s.tps}; };
(async()=>{ await api('POST','/hub',{}); await sleep(2000); const c0=await cap(); console.log('idle   ',JSON.stringify({l:c0.level,used:c0.used,free:c0.free,maxRoom:c0.maxRoom,dens:c0.botDensity}));
 const ids=['gunarena','teamdeathmatch','gungame','capturetheflag','zombies','bedwars']; const hs=[]; for(let i=0;i<38;i++) hs.push(await join(ids[i%ids.length],'L'+i)); await sleep(9000);
 const c1=await cap(); console.log('38 humans',JSON.stringify({l:c1.level,used:c1.used,free:c1.free,maxRoom:c1.maxRoom,dens:c1.botDensity,bots:c1.bots,rooms:c1.rooms,tps:c1.tps}));
 ok('capacity moves to busy/full under 38 humans',c1.level==='busy'||c1.level==='full',c1.level); ok('used slots reflect the crowd',c1.used>=30,String(c1.used)); ok('bot fill is scaled down under load',c1.botDensity<1,String(c1.botDensity));
 ok('server keeps 20 TPS while loaded',c1.tps>=19,String(c1.tps)); ok('automatic rooms opened for the crowded games but within limits (<= 3 extra per game)',c1.rooms<=15+3*6+2,String(c1.rooms)+' worlds');
 // new custom game while loaded
 const maker=await join('lobby','Maker'); await sleep(900); maker.ws.send(JSON.stringify({t:'chat',text:'/create ctf 16 8 hard public'})); await sleep(1400);
 const msg=maker.chat.filter(t=>/Created|capacity|trimmed|busy|slots/.test(t)).slice(-1)[0]||''; console.log('create under load ->',msg.slice(0,150));
 ok('under load a custom game is trimmed or refused with a clear message',/trimmed|capacity|busy|free/i.test(msg),msg.slice(0,80));
 const big=await api('POST','/rooms',{mode:'tdm',players:30,bots:10}); ok('admin can still force a bigger room than capacity allows',big.players===30,JSON.stringify(big).slice(0,70)); if(big.id) await api('DELETE','/rooms/'+big.id);
 // everyone leaves
 hs.forEach(h=>h.ws.close()); maker.ws.close(); await sleep(7000); const c2=await cap(); console.log('after   ',JSON.stringify({l:c2.level,used:c2.used,free:c2.free,bots:c2.bots,players:c2.players,rooms:c2.rooms}));
 ok('capacity recovers to ok after the crowd leaves',c2.level==='ok'&&c2.used<c1.used/3,`${c1.used} -> ${c2.used}`); ok('all bots gone after everyone left',c2.bots===0&&c2.players===0);

 console.log(fails?'FAILS '+fails:'ALL PASS'); process.exit(fails?1:0); })().catch(e=>{ console.log('FAIL exception',e.message); process.exit(1); });
