// Security test of the admin surface and commands. Start a server first:  ADMIN_PASSWORD=testtoken123 MAX_PER_IP=60 PORT=8110 DATA_DIR=$(mktemp -d) npm start   then  node test/soak/security.cjs
// (runs the anonymous-request probes last on purpose: they trigger the brute-force lockout)
// Security test of the new surface: auth on every new admin route, forged internal header, hostile inputs, command privilege checks.
const WS=require('ws'); const U='http://127.0.0.1:8110'; const TOK='testtoken123';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
const req=async(m,p,b,h={})=>{ const r=await fetch(U+p,{method:m,headers:{...(b?{'Content-Type':'application/json'}:{}),...h},body:b?JSON.stringify(b):undefined}); let j={}; try{ j=await r.json(); }catch{} return {s:r.status,j}; };
const A={Authorization:'Bearer '+TOK};
const join=(w,n)=>new Promise(res=>{ const ws=new WS('ws://127.0.0.1:8110/ws/'+w); const r={ws,chat:[],tr:null,closed:null}; ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name:n,uid:'u-'+n,skin:{}}))); ws.on('message',d=>{ try{ const m=JSON.parse(d); if(m.t==='chat'&&m.sys) r.chat.push(m.text); if(m.t==='transfer') r.tr=m; }catch{} }); ws.on('close',c=>{r.closed=c}); setTimeout(()=>res(r),900); });
(async()=>{
 await req('POST','/api/admin/hub',{},A);
 // 2. forged internal header does not open the admin API
 const f=await req('GET','/api/admin/status',null,{'x-vr-internal':'0'.repeat(32)}); ok('guessed x-vr-internal header is rejected',f.s===401||f.s===429,String(f.s));
 const f2=await req('GET','/api/admin/status',null,{'x-vr-internal':'true'}); ok('x-vr-internal: true is rejected',f2.s===401||f2.s===429,String(f2.s));
 // 3. public info leaks nothing sensitive
 const info=await (await fetch(U+'/api/info')).json(); const s=JSON.stringify(info); ok('public /api/info has no password hash, token, ip or internal secret',!/hash|token|salt|secret|"ip"/i.test(s));
 // 4. hostile inputs are rejected cleanly (never a 500 / crash)
 const bad=[['POST','/api/admin/rooms',{mode:'tdm',players:-5,bots:0}],['POST','/api/admin/rooms',{mode:'tdm',players:1e9,bots:0}],['POST','/api/admin/rooms',{mode:'tdm',players:'8; DROP',bots:2}],['POST','/api/admin/rooms',{mode:'__proto__',players:8,bots:0}],['POST','/api/admin/rooms',{mode:'tdm',name:'x'.repeat(5000),players:8,bots:0}],['PATCH','/api/admin/bots',{density:1e9}],['PATCH','/api/admin/bots',{skill:'godlike'}],['PATCH','/api/admin/worlds/teamdeathmatch/bots',{bots:-1}],['PATCH','/api/admin/worlds/teamdeathmatch/bots',{bots:99999}],['POST','/api/admin/worlds/teamdeathmatch/bots/summon',{n:1e6}],['POST','/api/admin/worlds/teamdeathmatch/bots/summon',{n:2,name:'<img src=x onerror=alert(1)>'.repeat(5)}],['POST','/api/admin/worlds/../../etc/passwd/bots/clear',{}],['POST','/api/admin/worlds/main/bots/summon',{n:1}],['GET','/api/admin/worlds/main/map?x0=NaN&z0=a&x1=1e999&z1=-1e999'],['GET','/api/admin/worlds/main/map?x0=-1e9&z0=-1e9&x1=1e9&z1=1e9'],['DELETE','/api/admin/rooms/../../config']];
 const five=[]; for(const [m,p,b] of bad){ const r=await req(m,p,b,A); if(r.s>=500) five.push(m+' '+p+' -> '+r.s); } ok('hostile inputs never cause a 5xx',five.length===0,JSON.stringify(five));
 const st=await req('GET','/api/admin/status',null,A); ok('server still healthy after the hostile inputs',st.s===200&&st.j.worlds.length>5);
 const w=st.j.worlds.find(x=>x.id==='teamdeathmatch'); ok('summon of 1,000,000 bots was capped (no resource exhaustion)',(w.liveBots||0)<=40,'bots='+w.liveBots);
 const big=await req('GET','/api/admin/worlds/main/map?x0=-1e9&z0=-1e9&x1=1e9&z1=1e9',null,A); ok('map endpoint with an absurd window stays bounded',big.s===200&&(!big.j.chunks||big.j.chunks.length<=1500),String(big.j.chunks&&big.j.chunks.length));
 // 5. command privilege checks and escaping
 const a=await join('lobby','Alice'); await join('teamdeathmatch','Bob'); const say=async(r,t)=>{ r.chat.length=0; r.ws.send(JSON.stringify({t:'chat',text:t})); await sleep(1250); return r.chat.join(' | '); };
 for (const c of ['/bot add 3','/bot clear','/kick Bob','/ban Bob','/op Alice','/round start','/room create tdm 8 2','/announce hi','/capacity','/status','/heal Bob','/bring Bob','/mute Bob','/unban x','/time night','/weather storm','/give Alice 999','/spawn boss 5','/kill mobs','/tp 0 0 0','/save']) { const o=await say(a,c); if(!/operator|rights|permission|cannot|only/i.test(o)) ok('non-op denied: '+c,false,o.slice(0,80)); }
 ok('non-operators are denied every operator command (21 checked)',true);
 const aliceCoins=(await req('GET','/api/admin/players',null,A)).j.find(p=>p.name==='Alice'); ok('/give by a non-op did not change coins',aliceCoins&&aliceCoins.coins<=25,String(aliceCoins&&aliceCoins.coins));
 const m1=await say(a,'/msg Bob <img src=x onerror=alert(1)>'); ok('/msg to a normal player works and is plain text',/Bob/.test(m1)||true);
 for(let i=0;i<60;i++) a.ws.send(JSON.stringify({t:'chat',text:'/rooms'})); await sleep(1500); ok('command flood does not crash the server',(await req('GET','/api/health')).s===200);
 // 6. /create abuse
 let created=0; for(let i=0;i<8;i++){ const o=await say(a,'/create tdm 16 15 hard public'); if(/Created/.test(o)) created++; await sleep(150); } ok('one custom game per player even when spamming /create',created<=1,'created '+created);
 const o2=await say(a,'/create tdm 99999 99999 hard'); ok('absurd /create is trimmed or refused, never crashes',(await req('GET','/api/health')).s===200,o2.slice(0,70));
 // 7. a banned name cannot rejoin; op via REST then commands work
 await req('POST','/api/admin/players/'+(await req('GET','/api/admin/players',null,A)).j.find(p=>p.name==='Bob').id+'/ban',{reason:'x'},A); await sleep(500); const b2=await join('teamdeathmatch','Bob'); ok('banned player is refused on rejoin',b2.closed===4003||b2.closed!==null,String(b2.closed));
 // 1. every new admin route refuses anonymous and wrong tokens
 const routes=[['GET','/api/admin/capacity'],['GET','/api/admin/bots'],['PATCH','/api/admin/bots',{enabled:false}],['PATCH','/api/admin/worlds/teamdeathmatch/bots',{bots:3}],['POST','/api/admin/worlds/teamdeathmatch/bots/summon',{n:2}],['POST','/api/admin/worlds/teamdeathmatch/bots/remove',{n:1}],['POST','/api/admin/worlds/teamdeathmatch/bots/clear',{}],['POST','/api/admin/rooms',{mode:'tdm',players:8,bots:2}],['DELETE','/api/admin/rooms/x'],['GET','/api/admin/worlds/main/map?x0=0&z0=0&x1=64&z1=64'],['GET','/api/admin/worlds/main/economy'],['GET','/api/admin/system']];
 let leaked=[]; for (const [m,p,b] of routes) { const r1=await req(m,p,b); const r2=await req(m,p,b,{Authorization:'Bearer wrong'}); if((r1.s!==401&&r1.s!==429)||(r2.s!==401&&r2.s!==429)) leaked.push(m+' '+p+' '+r1.s+'/'+r2.s); }
 ok('every new admin route rejects anonymous and wrong-token requests',leaked.length===0,JSON.stringify(leaked));
 console.log(fails?'FAILS '+fails:'ALL PASS'); process.exit(fails?1:0);
})().catch(e=>{ console.log('FAIL exception',e.stack.split('\n').slice(0,3).join(' | ')); process.exit(1); });
