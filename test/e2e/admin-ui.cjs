// E2E (optional 3rd arg = game port when the admin runs on its own ADMIN_PORT): drives the real admin panel (Nuxt) with clicks and verifies server-side state through the API. Needs: VR_E2E=1 ADMIN_PASSWORD=testtoken123 npm start   then   node test/e2e/admin-ui.cjs http://127.0.0.1:8090
const { chromium } = require('playwright'); const WS=require('ws');
const U=(process.argv[2]||'http://127.0.0.1:8090').replace(/\/$/,''), PORT=process.argv[3]||new URL(U).port; const H={Authorization:'Bearer testtoken123','Content-Type':'application/json'};
const api=async(m,p,b)=>{ const r=await fetch(U+'/api/admin'+p,{method:m,headers:b?H:{Authorization:H.Authorization},body:b?JSON.stringify(b):undefined}); return r.json().catch(()=>({})); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
const join=(w,n)=>new Promise(res=>{ const ws=new WS('ws://127.0.0.1:'+PORT+'/ws/'+w); const r={ws,msgs:[],closed:null}; ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name:n,uid:'u-'+n,skin:{}}))); ws.on('message',d=>{ try{ r.msgs.push(JSON.parse(d)); }catch{} }); ws.on('close',c=>{ r.closed=c; }); setTimeout(()=>res(r),900); });
(async()=>{
 await api('POST','/hub',{}); const alice=await join('teamdeathmatch','Alice'); await sleep(3000);
 const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}}); const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message)); p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,140)); });
 const step=async(name,fn)=>{ try{ await fn(); }catch(e){ ok(name,false,'exception: '+e.message.split('\n')[0].slice(0,120)); } };
 const dlg=async(text)=>{ await p.waitForSelector('.dl-card',{timeout:5000}); if(text!==undefined){ await p.fill('.dl-card input.input',text); } await p.click('.dl-card button[type=submit]'); await sleep(500); };
 const toast=async(re)=>{ const t=await p.locator('.t-i').allTextContents(); return t.some(x=>re.test(x)); };
 // ---- login
 await step('login',async()=>{ await p.goto(U+'/admin/'); await p.fill('#pw','wrong-password'); await p.click('button.primary'); await sleep(800); ok('wrong password is rejected with a message',await p.isVisible('.err'));
   await p.fill('#pw','testtoken123'); await p.click('button.primary'); await p.waitForSelector('.shell',{timeout:8000}); ok('login works',true); });
 // ---- overview actions
 await step('overview',async()=>{ await sleep(2500);
   await p.click('button:has-text("Announce")'); await dlg('Server test announcement'); ok('Announce is delivered to players in game',alice.msgs.some(m=>m.t==='chat'&&/Server test announcement/.test(m.text||'')));
   await p.click('button:has-text("Save all")'); await sleep(2500); ok('Save all toasts',await toast(/saved/i));
   await p.click('button:has-text("Backup")'); await sleep(900); ok('Backup toasts',await toast(/backup/i));
   await p.click('button:has-text("Maintenance")'); await dlg(); await sleep(900); let s=await api('GET','/security'); ok('Maintenance turns on (confirm dialog)',s.maintenance&&s.maintenance.on===true);
   ok('Alice (not op) was kicked by maintenance',alice.closed===4003||alice.msgs.some(m=>m.t==='kick'));
   await p.waitForSelector('button:has-text("End maintenance")',{timeout:6000}); await p.click('button:has-text("End maintenance")'); await sleep(900); s=await api('GET','/security'); ok('Maintenance turns off',s.maintenance.on===false);
   ok('capacity card renders',await p.isVisible('text=player slots in use')); });
 // ---- games
 await step('games',async()=>{ await p.goto(U+'/admin/#/games'); await sleep(1500);
   await p.click('button:has-text("New room")'); await p.selectOption('form.rf select >> nth=0','ctf'); await p.fill('form.rf input[placeholder*="#2"]','UI Test CTF'); await p.fill('form.rf input[type=number] >> nth=0','10'); await p.fill('form.rf input[type=number] >> nth=1','3'); await p.click('form.rf button:has-text("Open room")'); await sleep(1200);
   let w=await api('GET','/worlds'); const room=w.find(x=>x.name==='UI Test CTF'); ok('New room creates a pinned CTF room with 10 slots',room&&room.maxPlayers===10&&room.room&&room.room.source==='admin',JSON.stringify(room&&{n:room.maxPlayers,s:room.room}));
   await p.click('button:has-text("New world")'); await p.fill('form.cf:not(.rf) input.input','UI World'); await p.click('form.cf:not(.rf) button:has-text("Create")'); await sleep(2500);
   w=await api('GET','/worlds'); ok('New world is created',w.some(x=>x.name==='UI World'));
   await p.fill('input[aria-label="Search worlds"]','UI World'); await sleep(300); ok('search filters the table',(await p.locator('tbody tr').count())===1);
   await p.click('tbody tr:has-text("UI World") .mn button'); await p.click('.mn-pop button:has-text("Rename")'); await dlg('UI World 2'); await sleep(600); w=await api('GET','/worlds'); ok('Rename works',w.some(x=>x.name==='UI World 2'));
   await p.fill('input[aria-label="Search worlds"]','UI World 2'); await sleep(300); await p.click('tbody tr:has-text("UI World 2") .mn button'); await p.click('.mn-pop button:has-text("Delete world")'); await dlg(); await sleep(1200); w=await api('GET','/worlds'); ok('Delete world (with confirm) removes it',!w.some(x=>x.name==='UI World 2'));
   await p.fill('input[aria-label="Search worlds"]','UI Test CTF'); await sleep(300); await p.click('tbody tr:has-text("UI Test CTF") .sw input'); await sleep(800); w=await api('GET','/worlds'); ok('lobby portal switch hides the room from the lobby',w.find(x=>x.name==='UI Test CTF').lobby===false);
   await p.click('tbody tr:has-text("UI Test CTF") .mn button'); await p.click('.mn-pop button:has-text("Close room")'); await dlg(); await sleep(1000); w=await api('GET','/worlds'); ok('Close room removes it',!w.some(x=>x.name==='UI Test CTF')); });
 // ---- players
 await step('players',async()=>{ const a2=await join('teamdeathmatch','Mallory'); await p.goto(U+'/admin/#/players'); await sleep(4000); ok('players page lists the human',await p.isVisible('tbody tr:has-text("Mallory")'));
   await p.click('tbody tr:has-text("Mallory") .mn button'); await p.click('.mn-pop button:has-text("Mute")'); await sleep(900); let pl=await api('GET','/players'); ok('Mute works',pl.find(x=>x.name==='Mallory').muted===true);
   await p.click('tbody tr:has-text("Mallory") .mn button'); await p.click('.mn-pop button:has-text("Make operator")'); await sleep(900); pl=await api('GET','/players'); ok('Make operator works',pl.find(x=>x.name==='Mallory').op===true);
   await p.click('tbody tr:has-text("Mallory") .mn button'); await p.click('.mn-pop button:has-text("Kick")'); await dlg('bye'); await sleep(1500); ok('Kick disconnects the player with the reason',a2.closed!==null&&a2.msgs.some(m=>m.t==='kick'&&/bye/.test(m.reason))); });
 // ---- bots
 await step('bots',async()=>{ await p.goto(U+'/admin/#/bots'); await sleep(2500); await p.click('tbody tr:has-text("Team Deathmatch") button:has-text("Summon")'); await dlg('2'); await sleep(1500); let st=await api('GET','/status'); let tdm=st.worlds.find(x=>x.id==='teamdeathmatch');
   const before=tdm.liveBots; ok('Summon adds bots',before>=2,String(before)); await p.click('tbody tr:has-text("Team Deathmatch") button:has-text("−1")'); await sleep(1000); st=await api('GET','/status'); ok('−1 removes one bot',st.worlds.find(x=>x.id==='teamdeathmatch').liveBots===before-1);
   await p.click('tbody tr:has-text("Team Deathmatch") button:has-text("Clear")'); await dlg(); await sleep(1000); st=await api('GET','/status'); ok('Clear removes them all',st.worlds.find(x=>x.id==='teamdeathmatch').liveBots===0);
   await p.click('tbody tr:has-text("Team Deathmatch") select'); await p.selectOption('tbody tr:has-text("Team Deathmatch") select','hard'); await sleep(700); const w=await api('GET','/worlds'); ok('per-game skill select saves',w.find(x=>x.id==='teamdeathmatch').botSkill==='hard');
   await p.click('button.chip:has-text("easy")'); await sleep(700); ok('global default skill saves',(await api('GET','/bots')).skill==='easy'); });
 // ---- security
 await step('security',async()=>{ await p.goto(U+'/admin/#/security'); await sleep(1800); await p.fill('input[placeholder="Value to ban"]','troll'); await p.click('button.danger:has-text("Ban")'); await sleep(800); let s=await api('GET','/security'); ok('Ban adds a name ban',s.bans.names.includes('troll'));
   await p.click('button[aria-label="Unban troll"]'); await sleep(800); s=await api('GET','/security'); ok('Unban removes it',!s.bans.names.includes('troll'));
   await p.fill('input[placeholder="Player name"]','Friend'); await p.click('button:has-text("Add")'); await sleep(700); s=await api('GET','/security'); ok('Allowlist add works',s.allowlist.names.includes('friend')); await api('PATCH','/security',{allowlist:{remove:'friend'}});
   ok('audit log lists admin actions',(await p.locator('table:last-of-type tbody tr').count())>=3); });
 // ---- backups
 await step('backups',async()=>{ await p.goto(U+'/admin/#/backups'); await sleep(1500); await p.click('button:has-text("Create backup")'); await sleep(1500); const l=await api('GET','/backups'); ok('Create backup produces a file',l.length>=1,String(l.length));
   const [dl]=await Promise.all([p.waitForEvent('download',{timeout:8000}).catch(()=>null),p.click('tbody tr >> nth=0 >> button[aria-label="Download"]')]); ok('Download button saves the backup',!!dl);
   await p.click('tbody tr >> nth=0 >> button[aria-label="Delete"]'); await dlg(); await sleep(800); ok('Delete backup removes it',(await api('GET','/backups')).length<l.length); });
 // ---- settings, console, chat
 await step('settings',async()=>{ await p.goto(U+'/admin/#/settings'); await sleep(1500); await p.fill('label:has-text("Message of the day") + input','Hello from the UI test'); await p.click('button:has-text("Save changes")'); await sleep(900); ok('Settings save the MOTD',(await api('GET','/config')).motd==='Hello from the UI test'); });
 await step('console',async()=>{ await p.goto(U+'/admin/#/console'); await sleep(1500); await p.fill('input[aria-label=Command]','capacity'); await p.click('button:has-text("Run")'); await sleep(900); ok('Console runs /capacity',/Capacity|slots/i.test(await p.textContent('.term')));
   await p.click('button.chip:has-text("status")'); await sleep(900); ok('quick chip runs /status',/worlds/i.test(await p.textContent('.term'))); });
 await step('chat',async()=>{ await p.goto(U+'/admin/#/chat'); await sleep(1500); await p.fill('input[aria-label=Announcement]','chat page ping'); await p.click('button:has-text("Announce")'); await sleep(900); ok('Chat page announce works',await toast(/announce/i)); });
 await step('economy',async()=>{ await api('PATCH','/worlds/main',{economy:true}); await p.goto(U+'/admin/#/economy'); await sleep(2000);
   ok('economy page shows leaderboard, bounties and market',await p.isVisible('text=Leaderboard')&&await p.isVisible('text=Active bounties')&&await p.isVisible('text=Market'));
   const n0=(await api('GET','/worlds/main/economy')).bounties.length; await p.fill('input[aria-label=Reward]','77'); await p.click('form:has(input[aria-label=Reward]) button.primary'); await sleep(1000);
   const e=await api('GET','/worlds/main/economy'); ok('Add bounty creates it with the reward',e.bounties.length===n0+1&&e.bounties.some(b=>b.reward===77));
   await p.click('tbody tr:has-text("77 c") button:has-text("Remove")'); await sleep(900); ok('Remove bounty works',(await api('GET','/worlds/main/economy')).bounties.length===n0);
   await p.click('button:has-text("Re-roll bounties")'); await sleep(900); ok('Re-roll toasts',await toast(/re-rolled/i));
   await p.click('.mk .pg >> nth=0'); await dlg('1.5'); await sleep(900); const e2=await api('GET','/worlds/main/economy'); ok('price override saves a multiplier',Object.values(e2.prices).some(v=>Math.abs(v-1.5)<.01)); });
 await step('player drawer',async()=>{ const a3=await join('teamdeathmatch','Drawer'); await p.goto(U+'/admin/#/players'); await sleep(4000); await p.click('tbody tr:has-text("Drawer") td >> nth=0'); await sleep(600);
   ok('clicking a player opens the detail drawer',await p.isVisible('.drawer')&&await p.isVisible('.drawer >> text=Device id'));
   await p.click('.drawer button:has-text("Coins")'); await dlg('250'); await sleep(900); const pl=await api('GET','/players'); ok('drawer Coins action adds coins',pl.find(x=>x.name==='Drawer').coins>=250);
   await p.click('.drawer button:has-text("Teleport")'); await dlg('5 40 5'); await sleep(900); ok('drawer Teleport sends the player there',a3.msgs.some(m=>m.t==='tp'&&Math.abs(m.x-5)<.1));
   await p.click('.drawer button[aria-label=Close]'); await sleep(400); ok('drawer closes',!(await p.isVisible('.drawer'))); a3.ws.close(); });
 await step('help',async()=>{ await p.goto(U+'/admin/#/help'); await sleep(900); ok('help page lists the bot commands',(await p.textContent('body')).includes('/bot add')); });
 await step('map: custom room created after the panel opened',async()=>{ await p.goto(U+'/admin/#/'); await sleep(2500);
   const r=await api('POST','/rooms',{mode:'ctf',name:'Map Custom Room',players:10,bots:2}); const g=await join(r.id,'MapWalker'); await sleep(5000);
   await p.goto(U+'/admin/#/map'); await sleep(3500); const opts=await p.$$eval('select.select option',o=>o.map(x=>x.textContent));
   ok('the new room is in the map world list without reloading the panel',opts.includes('Map Custom Room'),opts.length+' options');
   await p.selectOption('select.select',{label:'Map Custom Room'}); await sleep(8000);
   ok('the room is listed with its players on the map',(await p.locator('.pl .pr:has-text("MapWalker")').count())===1);
   const painted=await p.evaluate(()=>{ const c=document.querySelector('canvas.cv'); const g=c.getContext('2d'); const d=g.getImageData(0,0,c.width,c.height).data; let col=0,n=0; for(let i=0;i<d.length;i+=4*97){ n++; if(d[i+1]>d[i]+25&&d[i+1]>d[i+2]+10) col++; } return col/n; });
   ok('terrain is painted for the custom room (not a blank map)',painted>.05,'green share '+painted.toFixed(2)); g.ws.close(); await api('DELETE','/rooms/'+r.id); });
 await step('no classic panel',async()=>{ const r=await fetch(U+'/admin/classic/'); const t=await r.text(); ok('classic panel is gone',!/loginForm/.test(t)); });
 await step('map',async()=>{ await p.goto(U+'/admin/#/map'); await sleep(7000); ok('map canvas renders',await p.isVisible('canvas.cv')); });
 const real=errs.filter(e=>!/401/.test(e)); ok('no console or page errors (the deliberate wrong-password 401 is ignored)',real.length===0,JSON.stringify([...new Set(real)].slice(0,4)));
 console.log(fails?'FAILS '+fails:'ALL PASS'); await b.close(); alice.ws.close(); process.exit(fails?1:0);
})().catch(e=>{ console.log('FAIL exception',e.message); process.exit(1); });
