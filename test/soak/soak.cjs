// Leak soak: 44 room open/close cycles + 150 connection churns + idle chunk unloading. Server:  ADMIN_PASSWORD=testtoken123 MAX_PER_IP=500 PORT=8114 DATA_DIR=$(mktemp -d) npm start
const WS=require('ws'); const H={Authorization:'Bearer testtoken123','Content-Type':'application/json'}; const U='http://127.0.0.1:8114/api/admin';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
const api=async(m,p,b)=>{ const r=await fetch(U+p,{method:m,headers:b?H:{Authorization:H.Authorization},body:b?JSON.stringify(b):undefined}); return r.json().catch(()=>({})); };
const join=(w,n)=>new Promise(res=>{ const ws=new WS('ws://127.0.0.1:8114/ws/'+w); ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name:n,uid:'u-'+n,skin:{}}))); ws.on('message',()=>{}); ws.on('error',()=>{}); setTimeout(()=>res(ws),250); });
const snap=async()=>{ const s=await api('GET','/status'); return {rss:Math.round(s.rss/1048576),heap:Math.round(s.heap/1048576),worlds:s.worlds.length,chunks:s.worlds.reduce((a,w)=>a+w.chunks,0),players:s.players,bots:s.bots}; };
(async()=>{ await api('POST','/hub',{}); await sleep(3000); const base=await snap(); console.log('baseline',JSON.stringify(base));
 const modes=['pvp','tdm','gungame','zombies','raid','td','royale','hide','ctf','snd','bedwars']; let created=0;
 for(let i=0;i<44;i++){ const r=await api('POST','/rooms',{mode:modes[i%modes.length],name:'Soak '+i,players:8,bots:2}); if(r.id){ created++; const ws=[]; for(let k=0;k<3;k++) ws.push(await join(r.id,'S'+i+'_'+k)); await sleep(700); ws.forEach(x=>x.close()); await sleep(200); await api('DELETE','/rooms/'+r.id); } if(i%11===10) console.log('cycle',i+1,JSON.stringify(await snap())); }
 ok('44 room open/join/leave/close cycles ran',created===44,String(created));
 await sleep(4000); const after=await snap(); console.log('after',JSON.stringify(after));
 ok('world count returns to baseline (no leaked rooms)',after.worlds===base.worlds,`${base.worlds} -> ${after.worlds}`);
 ok('no players or bots left behind',after.players===0&&after.bots===0,`players ${after.players} bots ${after.bots}`);
 ok('memory growth stays modest after 44 room cycles (< 90 MB RSS)',after.rss-base.rss<90,`${base.rss} -> ${after.rss} MB`);
 // connection churn: 150 quick joins/leaves on the lobby
 for(let i=0;i<150;i++){ const w=await join('lobby','C'+i); w.close(); } await sleep(3000); const ch=await snap(); ok('150 connection churn leaves no players behind',ch.players===0,JSON.stringify(ch));
 ok('memory after connection churn still bounded (< 140 MB over baseline)',ch.rss-base.rss<140,`${base.rss} -> ${ch.rss} MB`);
 // idle chunk unloading: chunks should fall once worlds sit empty for >60s
 console.log('waiting 75s for idle chunk unloading...'); const c0=ch.chunks; await sleep(75000); const c1=(await snap()).chunks; ok('idle worlds unload their chunks',c1<c0||c0===0,`${c0} -> ${c1}`);
 const st=await api('GET','/status'); ok('server TPS still 20 after the soak',st.tps>=19,String(st.tps));
 console.log(fails?'FAILS '+fails:'ALL PASS'); process.exit(fails?1:0); })().catch(e=>{ console.log('FAIL exception',e.message); process.exit(1); });
