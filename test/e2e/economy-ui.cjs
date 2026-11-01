// E2E (Playwright). Needs a running server:  VR_E2E=1 ADMIN_PASSWORD=testtoken123 PORT=8090 npm start   then   node test/e2e/<file> [baseUrl]
// Install the browser once with `npx playwright install chromium`. Some scripts wait out the admin brute-force lockout on purpose.
const {chromium}=require('playwright');
const URL=(process.argv[2]||'http://localhost:8090/')+'?e2e=1';
let fails=0; const ok=(n,c,x='')=>{console.log(c?'PASS':'FAIL',n,x); if(!c)fails++;};
const ev=(p,fn,arg)=>p.evaluate(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg]);
const wf=async(p,fn,arg,opt)=>{ await p.waitForFunction(()=>typeof window.__eval==='function',null,opt); return p.waitForFunction(([src,a])=>window.__eval('('+src+')')(a),[fn.toString(),arg],opt); };
const noise=e=>/Failed to load resource|ERR_|CORS|GL Driver|ReadPixels/.test(e);
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const ctx=await b.newContext({viewport:{width:1200,height:760}}); const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
 await p.goto(URL); await wf(p,()=>P.ready,null,{timeout:60000}); await p.waitForTimeout(1200);
 ok('title uses rail layout',await p.evaluate(()=>document.getElementById('menu').classList.contains('title')&&document.getElementById('shell').classList.contains('railmode')));
 await p.screenshot({path:'v_title.png'});
 // keyboard focus order on main menu
 await p.keyboard.press('Tab'); ok('menu items focusable',await p.evaluate(()=>document.activeElement&&document.activeElement.classList.contains('mi')));
 // create survival world
 await p.click('#b-play'); await p.click('#b-newworld'); await p.fill('#wname','Eco Test'); await p.fill('#seedin','eco1'); await p.click('[data-mode=survival]'); await p.click('[data-type=flat]'); await p.screenshot({path:'v_single.png'}); await p.click('#b-create');
 await wf(p,()=>P.ready,null,{timeout:60000}); await p.waitForTimeout(800); await p.click('.wcard.cur .wb button >> nth=0'); await wf(p,()=>started,null,{timeout:10000}); await p.waitForTimeout(1500);
 ok('survival + economy on',await ev(p,()=>survival()&&economyOn()&&GEN.mode==='survival'));
 ok('wallet visible',await p.evaluate(()=>getComputedStyle(document.getElementById('wallet')).display!=='none'));
 // give items, spawn villager, open trade
 await ev(p,()=>{ addItem(STONE,40); addItem(B.GOLD,5); addItem(SAND,12); });
 const c0=await ev(p,()=>coins);
 await ev(p,()=>{ const v=sim.spawn('villager',P.x+2,P.y,P.z); interactMob({type:'villager',id:v.id}); });
 await p.waitForTimeout(500); ok('trade modal open',await ev(p,()=>modalOpen&&document.getElementById('mtitle').textContent==='Village trader'));
 await p.screenshot({path:'v_trade_sell.png'});
 const sellBtns=await p.$$('.trade-row button'); ok('sell rows rendered',sellBtns.length>=3,sellBtns.length);
 await p.click('.trade-row:has-text("Stone") button:has-text("Sell 10")'); await p.waitForTimeout(300);
 const c1=await ev(p,()=>coins); ok('selling earns coins',c1>c0,[c0,c1]); ok('items removed',(await ev(p,()=>items[STONE]))===30);
 const pBefore=await ev(p,()=>sellPrice(eco,STONE)); await p.click('.trade-row:has-text("Stone") button:has-text("All")'); await p.waitForTimeout(200);
 ok('market price drops after dumping stock',(await ev(p,()=>sellPrice(eco,STONE)))<=pBefore);
 await p.click('.tabs span:has-text("Buy")'); await p.waitForTimeout(200);
 await ev(p,()=>setCoins(500,true)); await p.waitForTimeout(100);
 const cb=await ev(p,()=>coins); await p.click('.trade-row:has-text("Planks") button:has-text("Buy 1")'); await p.waitForTimeout(300);
 ok('buying costs coins and gives item',(await ev(p,()=>coins))<cb&&(await ev(p,()=>items[PLANKS]))===1);
 await p.screenshot({path:'v_trade_buy.png'});
 await p.click('.tabs span:has-text("Bounties")'); await p.waitForTimeout(200); await p.screenshot({path:'v_trade_bounty.png'});
 ok('3 bounties shown',(await p.$$('.bounty')).length===3);
 await ev(p,()=>{ const b=eco.bounties[0]; addItem(b.id,b.qty+1); }); await p.waitForTimeout(100); await ev(p,()=>refreshModal());
 const cbb=await ev(p,()=>coins); await p.click('.bounty:not(.done) button:not([disabled])'); await p.waitForTimeout(300); ok('bounty pays out',(await ev(p,()=>coins))>cbb);
 await p.keyboard.press('Escape'); await p.waitForTimeout(250); ok('Esc closes modal',await ev(p,()=>!modalOpen));
 // inventory with tooltips & crafting
 await p.keyboard.press('KeyE'); await p.waitForTimeout(400); ok('inventory open',await ev(p,()=>invOpen));
 await p.hover('#grid .slot:first-child'); await p.waitForTimeout(200); ok('tooltip shows price',(await p.textContent('#tooltip')).length>3,await p.textContent('#tooltip'));
 await p.screenshot({path:'v_inventory.png'}); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
 // economy persisted in IndexedDB
 await ev(p,()=>{ saveDirty=true; writeSave(); }); await p.waitForTimeout(500);
 const saveKey=await ev(p,()=>SAVE_KEY);
 const saved=await p.evaluate((saveKey)=>new Promise(res=>{ const r=indexedDB.open('keyval-store'); r.onsuccess=()=>{ const st=r.result.transaction('keyval').objectStore('keyval'), ks=st.getAllKeys(); ks.onsuccess=()=>{ const k=ks.result.find(x=>x===saveKey); if(!k) return res(null); const g=st.get(k); g.onsuccess=()=>res(g.result&&{key:k,coins:g.result.coins,hasEco:!!g.result.eco,items:Object.keys(g.result.items||{}).length,editKeys:ks.result.filter(x=>typeof x==='string'&&x.startsWith('e:')).length}); }; }; r.onerror=()=>res(null); }),saveKey);
 ok('save lives in IndexedDB with economy',!!saved&&saved.hasEco&&saved.coins>0,JSON.stringify(saved));
 // pause menu
 await ev(p,()=>openMenu('main')); await p.waitForTimeout(900); ok('pause menu styled',await p.evaluate(()=>document.getElementById('menu').classList.contains('paused')&&!document.getElementById('menu').classList.contains('title')));
 await p.screenshot({path:'v_pause.png'});
 // settings: preset + reset
 console.log('DBG',await p.evaluate(()=>{ const b=document.getElementById('b-set'), r=b.getBoundingClientRect(), e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2), s=document.getElementById('shell'); const sr=s.getBoundingClientRect(); return JSON.stringify({btn:[r.x,r.y,r.width,r.height],shell:[sr.x,sr.y,sr.width,sr.height],hit:e&&(e.id||e.className||e.tagName),scroll:s.scrollTop,mod:document.getElementById('modal').hidden,inv:getComputedStyle(document.getElementById('inv')).display,death:getComputedStyle(document.getElementById('death')).display}); }));
 await p.click('#b-set'); await p.click('.tabs span[data-tab=video]'); await p.click('#presets .chip:has-text("Low")'); ok('Low preset applied',await ev(p,()=>cfg.shadows===1&&cfg.rd===5&&cfg.bloom===false));
 await p.screenshot({path:'v_settings.png'}); await p.click('#b-resetcfg'); await p.waitForTimeout(250); await p.click('#mfoot button:has-text("Confirm")'); await p.waitForTimeout(250); ok('Reset restores defaults',await ev(p,()=>cfg.shadows===3&&cfg.rd===7));
 await p.click('.tabs span[data-tab=keys]'); await p.screenshot({path:'v_keys.png'});
 // players page
 await p.click('#pg-set [data-go=main]'); await p.click('#b-player'); await p.waitForTimeout(700); await p.screenshot({path:'v_players.png'});
 // multiplayer page
 await ev(p,()=>showPage('mp')); await p.waitForTimeout(1500); await p.screenshot({path:'v_mp.png'});
 await p.fill('#srvsearch','zzzz-none'); await p.waitForTimeout(200); ok('search filters list',(await p.textContent('#srvlist')).includes('No servers match')); await p.fill('#srvsearch','');

 ok('no page errors',errs.filter(e=>!noise(e)).length===0,errs.filter(e=>!noise(e)).join('|'));
 console.log('FAILS',fails); await b.close();
})();
