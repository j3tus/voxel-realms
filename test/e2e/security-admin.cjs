// E2E (Playwright). Needs a running server:  VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/<file> [baseUrl]
// Install the browser once with `npx playwright install chromium`. Some scripts wait out the admin brute-force lockout on purpose.
const {chromium}=require('playwright');
const WS=require('ws');
const BASE=process.argv[2]||'http://localhost:8090', TOKEN=process.argv[3]||'testtoken123';
let fails=0; const ok=(n,c,x='')=>{console.log(c?'PASS':'FAIL',n,x); if(!c)fails++;};
const api=(m,p,b,tok=TOKEN)=>fetch(BASE+'/api/admin'+p,{method:m,headers:{Authorization:'Bearer '+tok,...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(world='main',hello={}){ return new Promise((res,rej)=>{ const ws=new WS(BASE.replace('http','ws')+'/ws/'+world); const c={ws,msgs:[],closed:null}; ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name:'Bot',uid:'bot-'+Math.random().toString(36).slice(2,8),...hello}))); ws.on('message',(d,bin)=>{ if(bin) return; const m=JSON.parse(d); c.msgs.push(m); if(m.t==='init') res(c); if(m.t==='kick') c.kick=m.reason; }); ws.on('close',(code)=>{ c.closed=code; res(c); }); ws.on('error',()=>{}); setTimeout(()=>res(c),4000); }); }
(async()=>{
 // ----- headers -----
 const r0=await fetch(BASE+'/'); const h=Object.fromEntries(r0.headers);
 ok('CSP header present',/default-src 'self'/.test(h['content-security-policy']||''),h['content-security-policy']?.slice(0,80));
 ok('script-src has no unsafe-inline',!/script-src[^;]*unsafe-inline/.test(h['content-security-policy']||''));
 ok('nosniff + frame deny',h['x-content-type-options']==='nosniff'&&/(DENY|SAMEORIGIN)/i.test(h['x-frame-options']||'')||/frame-ancestors 'none'/.test(h['content-security-policy']));
 ok('no server version leak',!h['x-powered-by']);
 // ----- auth -----
 ok('admin API rejects no token',(await fetch(BASE+'/api/admin/status')).status===401);
 ok('admin API rejects bad token',(await api('GET','/status',null,'nope')).status===401);
 ok('admin API accepts good token',(await api('GET','/status')).status===200);
 let locked=false; for(let i=0;i<8;i++){ const r=await api('GET','/status',null,'bad'+i); if(r.status===429){ locked=true; break; } } ok('brute force lockout (429)',locked);
 ok('lockout also blocks right token briefly',(await api('GET','/status')).status===429);
 // ----- game socket hardening -----
 const c1=await client('main',{name:'<img src=x onerror=alert(1)>'}); ok('hello accepted',!!c1.msgs.find(m=>m.t==='init'));
 const init=c1.msgs.find(m=>m.t==='init'); ok('init has world info',init.gen&&init.time&&init.spawn);
 const c2=await client('main',{name:'Watcher'}); await sleep(300);
 const join=c2.msgs.find(m=>m.t==='init').players.find(p=>p.id===init.id); ok('server stripped html from name',join&&!/[<>]/.test(join.name),join&&join.name);
 c1.ws.send('}{not json'); c1.ws.send(JSON.stringify({t:'block',x:1e9,y:5,z:5,id:3})); c1.ws.send(JSON.stringify({t:'chat',text:'<script>alert(1)</script> hi'})); await sleep(400);
 ok('server survives garbage',c1.ws.readyState===1);
 const chat=c2.msgs.find(m=>m.t==='chat'&&m.name);
 ok('chat html stripped',chat&&!/[<>]/.test(chat.text),chat&&chat.text);
 c1.ws.send(JSON.stringify({t:'pos',x:5000,y:40,z:5000,yaw:0,pitch:0})); await sleep(300); ok('teleport guard sends tp back',c1.msgs.some(m=>m.t==='tp'));
 c1.ws.send(JSON.stringify({t:'pos',x:init.spawn[0],y:init.spawn[1],z:init.spawn[2],yaw:0,pitch:0})); c1.ws.send(JSON.stringify({t:'block',x:Math.floor(init.spawn[0])+40,y:40,z:Math.floor(init.spawn[2]),id:3})); await sleep(300);
 ok('out-of-reach block edit rejected',!c2.msgs.some(m=>m.t==='block'&&m.id===3&&m.x>Math.floor(init.spawn[0])+30));
 for(let i=0;i<400;i++) c1.ws.send(JSON.stringify({t:'ping',ts:i})); await sleep(500); ok('flood does not crash server',(await fetch(BASE+'/api/health')).ok);
 const big=await client('main',{}); big.ws.send('x'.repeat(200000)); await sleep(400); ok('oversized frame closes connection',big.ws.readyState!==1);
 // per-IP limit
 const many=[]; for(let i=0;i<7;i++) many.push(await client('main',{name:'M'+i})); const closedMany=many.filter(c=>c.closed===4029||c.ws.readyState>1).length; ok('per-IP connection cap enforced',closedMany>=2,closedMany); many.forEach(c=>c.ws.close());
 // unknown world
 const nw=await client('nope'); ok('unknown world rejected',nw.closed===4004||nw.ws.readyState>1);
 // ----- password gate -----
 await new Promise(r=>setTimeout(r,200)); c1.ws.close(); c2.ws.close(); await sleep(300);
 // wait out lockout window by using a fresh IP is impossible locally; skip admin calls until lock expires
 console.log('...waiting for admin lockout to expire (60s)'); await sleep(61000);
 ok('admin works again after lockout',(await api('GET','/status')).status===200);
 await api('PATCH','/config',{password:'s3cret'});
 const np=await client('main',{}); ok('password required',np.kick&&/password/i.test(np.kick),np.kick);
 const wp=await client('main',{password:'wrong'}); ok('wrong password rejected',!!wp.kick);
 const gp=await client('main',{password:'s3cret'}); ok('right password admitted',!!gp.msgs.find(m=>m.t==='init')); gp.ws.close();
 const info=await (await fetch(BASE+'/api/info')).json(); ok('info advertises locked',info.locked===true);
 await api('PATCH','/config',{clearpw:true,password:null});
 // ----- world management -----
 const cw=await api('POST','/worlds',{name:'Survival Isle',type:'islands',mode:'survival',economy:true,dayLength:300,mobs:true,hostile:true,maxPlayers:8,seed:'isle'}); ok('create world',cw.status===201,await cw.clone().text());
 const wl=await (await api('GET','/worlds')).json(); const w=wl.find(x=>x.name==='Survival Isle'); ok('world listed with economy',w&&w.economy===true&&w.mode==='survival');
 const sc=await client(w.id,{name:'Trader'}); await sleep(400); const si=sc.msgs.find(m=>m.t==='init'); ok('survival world: wallet + inv + prices sent',si&&sc.msgs.some(m=>m.t==='wallet')&&sc.msgs.some(m=>m.t==='inv')&&sc.msgs.some(m=>m.t==='prices'));
 // server-authoritative inventory: selling items you do not have fails; placing without stock fails
 sc.ws.send(JSON.stringify({t:'trade',action:'sell',id:3,n:10})); await sleep(300);
 ok('cannot sell items you do not own',!sc.msgs.some(m=>m.t==='traded'));
 const w0=sc.msgs.filter(m=>m.t==='wallet').pop().coins;
 sc.ws.send(JSON.stringify({t:'trade',action:'buy',id:8,n:1})); await sleep(300);
 const w1=sc.msgs.filter(m=>m.t==='wallet').pop().coins; ok('buying with insufficient coins is refused or deducts correctly',w1<=w0&&w1>=0,[w0,w1]);
 sc.ws.send(JSON.stringify({t:'block',x:Math.floor(si.spawn[0]),y:Math.floor(si.spawn[1])-2,z:Math.floor(si.spawn[2]),id:3})); await sleep(300);
 ok('placing without stock is refused',!sc.msgs.some(m=>m.t==='block'));
 // break a block -> gets item
 sc.ws.send(JSON.stringify({t:'pos',x:si.spawn[0],y:si.spawn[1],z:si.spawn[2],yaw:0,pitch:0})); await sleep(2500);
 const bx=Math.floor(si.spawn[0]),bz=Math.floor(si.spawn[2]); let by=Math.floor(si.spawn[1])-1;
 for(let i=0;i<4;i++){ sc.ws.send(JSON.stringify({t:'block',x:bx,y:by-i,z:bz,id:0})); await sleep(150); }
 await sleep(400); const invs=sc.msgs.filter(m=>m.t==='inv'); const last=invs[invs.length-1]; ok('breaking blocks grants server-side items',last&&Object.keys(last.items).length>0,JSON.stringify(last&&last.items));
 // sell what we have
 const idStr=Object.keys(last.items)[0]; sc.ws.send(JSON.stringify({t:'trade',action:'sell',id:+idStr,n:5})); await sleep(400); ok('selling owned items pays coins',sc.msgs.some(m=>m.t==='traded'&&m.action==='sell'));
 const eco=await (await api('GET',`/worlds/${w.id}/economy`)).json(); ok('economy endpoint has leaderboard & bounties',eco.leaderboard.length>0&&eco.bounties.length===3);
 sc.ws.close();
 await api('DELETE',`/worlds/${w.id}`); ok('delete world',!(await (await api('GET','/worlds')).json()).some(x=>x.id===w.id));
 ok('cannot delete last world',(await api('DELETE','/worlds/main')).status===400);
 // backups
 const bk=await (await api('POST','/worlds/main/backup')).json(); ok('backup created',!!bk.file); const bl=await (await api('GET','/worlds/main/backups')).json(); ok('backup listed',bl.some(b=>b.file===bk.file));
 ok('restore rejects path traversal',(await api('POST','/worlds/main/restore',{file:'../../config.json'})).status===400);
 // ----- panel UI -----
 const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1300,height:900}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto(BASE+'/admin/'); await p.waitForSelector('#pw',{timeout:8000}); ok('login screen shown',await p.isVisible('#pw'));
 await p.fill('#pw','wrong-token'); await p.click('button.primary'); await p.waitForTimeout(700); ok('bad token shows error',(await p.isVisible('.err')));
 console.log('...waiting out the (escalated, 2 min) lockout'); await sleep(125000);
 await p.fill('#pw',TOKEN); await p.click('button.primary'); await p.waitForSelector('.shell',{timeout:8000}); ok('panel opens with valid token',true);
 await p.waitForTimeout(3000); ok('live stat cards render',(await p.$$('.kpi')).length>=4); await p.screenshot({path:'admin_dash.png'});
 await p.goto(BASE+'/admin/#/games'); await p.waitForTimeout(1200); ok('games table lists main',(await p.textContent('.tbl')).includes('Overworld')); await p.screenshot({path:'admin_worlds.png'});
 await p.goto(BASE+'/admin/#/console'); await p.waitForTimeout(900); await p.fill('input[aria-label=Command]','help'); await p.click('button:has-text("Run")'); await p.waitForTimeout(700); ok('console runs commands',(await p.textContent('.term')).includes('Commands'));
 await p.fill('input[aria-label=Command]','say <b>hi</b>'); await p.click('button:has-text("Run")'); await p.waitForTimeout(500); ok('console output is escaped (no injected markup)',(await p.$$('.term b')).length===0);
 await p.goto(BASE+'/admin/#/economy'); await p.waitForTimeout(800); await p.goto(BASE+'/admin/#/settings'); await p.waitForTimeout(600); await p.screenshot({path:'admin_settings.png'});
 ok('no panel errors',errs.length===0,errs.join('|')); await b.close();
 console.log('FAILS',fails);
})();
