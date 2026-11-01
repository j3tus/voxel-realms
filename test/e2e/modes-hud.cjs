// E2E: join every minigame mode in a real browser (with a bot opponent) and fail on any page error - catches HUD / world3d regressions per mode.
//   VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/modes-hud.cjs [baseUrl]
const {chromium}=require('playwright'); const WebSocket=require('ws'); const URL=process.argv[2]||'http://localhost:8090/'; let fails=0; const ok=(n,c,x='')=>{console.log(c?'PASS':'FAIL',n,x); if(!c)fails++;};
const H={Authorization:'Bearer testtoken123','Content-Type':'application/json'}; const MODES=['pvp','tdm','gungame','zombies','royale','ctf','hide','snd','bedwars','raid','td','parkour','spleef'];
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
 for(const mode of MODES){
  const r=await fetch(URL+'api/admin/worlds',{method:'POST',headers:H,body:JSON.stringify({name:'H'+mode,seed:'h'+mode,type:mode==='royale'?'normal':'flat',mode,mobs:['zombies','raid','td'].includes(mode),maxPlayers:8})}); const w=await r.json(); if(!w.id){ ok(mode+' world',false,JSON.stringify(w)); continue; }
  const bot=new WebSocket(URL.replace('http','ws')+'ws/'+w.id); await new Promise(res=>bot.on('open',res)); bot.send(JSON.stringify({t:'hello',name:'Bot',uid:'bot'+mode,v:2}));
  const p=await (await b.newContext({viewport:{width:640,height:360}})).newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(URL+'?e2e=1'); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000});
  await p.evaluate(id=>window.__eval('launch(location.host,"'+id+'")'),w.id);
  await p.waitForFunction(()=>window.__eval('started&&mp&&arena.st.mg&&arena.st.mg.state')==='play',null,{timeout:120000}).catch(()=>{}); await p.waitForTimeout(4000);
  const st=await p.evaluate(()=>window.__eval('({kind:arena.st.mg&&arena.st.mg.kind,state:arena.st.mg&&arena.st.mg.state,banner:document.body.innerText.slice(0,160).replace(/\\n/g," | ")})'));
  const ui=await p.evaluate(()=>window.__eval('({vm:vm.visible,hot:getComputedStyle(document.getElementById("hotbar")).display!=="none",prompt:getComputedStyle(document.getElementById("prompt")).display!=="none",h0:hotbar[0]})'));
  const gun=['pvp','tdm','gungame','zombies','royale','ctf','hide','snd','raid'].includes(mode), builds=['bedwars','td'].includes(mode);
  if(gun) ok(mode+': no held block / hotbar / block prompt in a gun mode',!ui.vm&&!ui.hot&&!ui.prompt,JSON.stringify(ui));
  if(builds) ok(mode+': building mode keeps its hotbar with a block kit',ui.hot&&ui.h0===(mode==='td'?29:12),JSON.stringify(ui));
  ok(mode+': round running, HUD error-free',st.kind===mode&&st.state==='play'&&errs.length===0,errs.length?errs[0]:st.banner.slice(0,70)); bot.close(); await p.context().close();
 }
 await b.close(); console.log('FAILS',fails); process.exit(fails?1:0);
})().catch(e=>{console.error('FAIL',e.message.slice(0,300));process.exit(1)});
