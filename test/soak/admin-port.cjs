// Admin on its own port. Start:  ADMIN_PASSWORD=testtoken123 ADMIN_PORT=8185 PORT=8186 DATA_DIR=$(mktemp -d) npm start    then  node test/soak/admin-port.cjs 8186 8185
const WS=require('ws'); const os=require('os'); const GP=process.argv[2]||'8186', AP=process.argv[3]||'8185'; const G='http://127.0.0.1:'+GP, A='http://127.0.0.1:'+AP, H={Authorization:'Bearer testtoken123'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
const st=async(u,h)=>{ try{ const r=await fetch(u,{headers:h||{}}); return r.status; }catch(e){ return 'ERR '+(e.cause&&e.cause.code||e.message); } };
const wsTry=(url,msg)=>new Promise(res=>{ const ws=new WS(url); const r={open:false,msgs:[],err:null,closed:null}; ws.on('open',()=>{ r.open=true; if(msg) ws.send(JSON.stringify(msg)); }); ws.on('message',d=>{ try{ r.msgs.push(JSON.parse(d).t); }catch{} }); ws.on('unexpected-response',(q,s)=>{ r.err=s.statusCode; }); ws.on('error',e=>{ r.err=r.err||e.message; }); ws.on('close',c=>{ r.closed=c; }); setTimeout(()=>{ try{ws.close();}catch{} res(r); },1800); });
(async()=>{
 // public (game) port: no admin at all
 ok('public port: /admin/ is 404',await st(G+'/admin/')===404); ok('public port: /api/admin/status with the CORRECT token is 404',await st(G+'/api/admin/status',H)===404); ok('public port: /api/admin/bots 404',await st(G+'/api/admin/bots',H)===404); ok('public port: /admin/_nuxt asset paths 404',await st(G+'/admin/_nuxt/x.js')===404);
 const pw=await wsTry('ws://127.0.0.1:'+GP+'/api/admin/stream',{t:'auth',token:'testtoken123'}); ok('public port: admin live-stream WebSocket is refused',!pw.open||(!pw.msgs.includes('ready')),JSON.stringify(pw));
 ok('public port: the game itself still works (/api/info 200, /)',await st(G+'/api/info')===200&&await st(G+'/')===200); ok('public port: /shared and /site still served',await st(G+'/shared/worldgen.js')===200);
 const gw=await wsTry('ws://127.0.0.1:'+GP+'/ws/main',{t:'hello',name:'Probe',uid:'u-p',skin:{}}); ok('public port: a player can join over WebSocket',gw.msgs.includes('init'),gw.msgs.slice(0,3).join());
 // admin port
 ok('admin port: /admin/ is 200',await st(A+'/admin/')===200); ok('admin port: API refuses a missing token (401)',await st(A+'/api/admin/status')===401); ok('admin port: API accepts the token',await st(A+'/api/admin/status',H)===200);
 ok('admin port: serves nothing of the game (/, /api/info, /ws) -> 404',await st(A+'/')===404&&await st(A+'/api/info')===404&&await st(A+'/site/')===404);
 ok('admin port: map worker module reachable (/shared/worldgen.js)',await st(A+'/shared/worldgen.js')===200);
 const aw=await wsTry('ws://127.0.0.1:'+AP+'/api/admin/stream',{t:'auth',token:'testtoken123'}); ok('admin port: live-stream WebSocket authenticates and streams',aw.msgs.includes('ready'),JSON.stringify(aw.msgs.slice(0,3)));
 const bad=await wsTry('ws://127.0.0.1:'+AP+'/api/admin/stream',{t:'auth',token:'nope'}); ok('admin port: wrong WebSocket token is rejected',!bad.msgs.includes('ready'));
 const gm=await wsTry('ws://127.0.0.1:'+AP+'/ws/main',{t:'hello',name:'Probe2',uid:'u-p2',skin:{}}); ok('admin port: game WebSocket is NOT available there',!gm.msgs.includes('init'),JSON.stringify(gm.msgs));
 // not reachable from other interfaces
 const lan=Object.values(os.networkInterfaces()).flat().filter(i=>i.family==='IPv4'&&!i.internal).map(i=>i.address); const reach=[]; for(const ip of lan){ const r=await st('http://'+ip+':'+AP+'/admin/'); if(r===200||r===401||r===404) reach.push(ip+'='+r); }
 ok('admin port is bound to loopback only (unreachable on '+lan.length+' other addresses)',reach.length===0,JSON.stringify(reach));
 console.log(fails?'FAILS '+fails:'ALL PASS'); process.exit(fails?1:0); })();
