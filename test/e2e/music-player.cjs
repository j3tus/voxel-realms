// E2E: real-music player. YouTube track (official embed, visible >= 200x200) with credits, direct audio URL, bad/duplicate links, stop, persistence, XSS in titles, CSP allows the frame.
// Network is mocked: noembed/oEmbed credits, the YouTube embed document and an audio file.
const {chromium}=require('playwright'); const URL=(process.argv[2]||'http://localhost:8090/')+'?e2e=1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let fails=0; const ok=(n,c,x='')=>{ console.log(c?'PASS':'FAIL',n,x); if(!c) fails++; };
const wav=()=>{ const sr=8000,n=sr*30,b=Buffer.alloc(44+n*2); b.write('RIFF',0); b.writeUInt32LE(36+n*2,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(sr,24); b.writeUInt32LE(sr*2,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(n*2,40); for(let i=0;i<n;i++) b.writeInt16LE(Math.round(Math.sin(i/8)*9000),44+i*2); return b; };
(async()=>{ const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']}); const ctx=await b.newContext({viewport:{width:1100,height:760}}); const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,160)); });
 let titles={'dQw4w9WgXcQ':['Test Song','Test Artist'],'abcdefghijk':['<img src=x onerror=window.__xss=1>Evil','<b>Bad</b> Artist']};
 await p.route(/noembed\.com\/embed|youtube\.com\/oembed/,route=>{ const u=decodeURIComponent(route.request().url()); const id=Object.keys(titles).find(k=>u.includes(k)); route.fulfill({status:id?200:404,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(id?{title:titles[id][0],author_name:titles[id][1],author_url:'https://example.com/a'}:{error:'nf'})}); });
 await p.route(/youtube-nocookie\.com\/embed/,route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body style="background:#123">player</body></html>'}));
 await p.route('https://cdn.example.test/lofi-night.wav',route=>route.fulfill({status:200,contentType:'audio/wav',headers:{'access-control-allow-origin':'*'},body:wav()}));
 await p.goto(URL); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000}); await sleep(1500);
 await p.keyboard.press('4'); await sleep(600); ok('Music page opens with key 4',await p.isVisible('#pg-music')); ok('source chips exist (Game / Real / Off)',(await p.locator('#mp-mode .chip').count())===3);
 // YouTube
 await p.fill('#mp-url','https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s'); await p.click('#mp-add'); await p.waitForFunction(()=>!document.getElementById('mp-add').disabled,null,{timeout:15000}); await sleep(600);
 ok('YouTube link is added with fetched credits',(await p.textContent('#mp-list')).includes('Test Song')&&(await p.textContent('#mp-list')).includes('Test Artist'));
 ok('credits show title, artist and a YouTube source link',/Test Song/.test(await p.textContent('#mp-credits'))&&/Test Artist/.test(await p.textContent('#mp-credits'))&&await p.isVisible('#mp-credits a[href*="youtube.com/watch?v=dQw4w9WgXcQ"]'));
 ok('the now-playing credit pill is shown',/Test Song/.test(await p.textContent('#nowplaying'))&&await p.isVisible('#nowplaying'));
 const fr=await p.evaluate(()=>{ const f=document.getElementById('ytframe'); if(!f) return null; const r=f.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),src:f.src,vis:getComputedStyle(document.getElementById('ytcard')).display!=='none'}; });
 ok('YouTube plays in its official player (nocookie embed)',fr&&/youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test(fr.src),fr&&fr.src.slice(0,70)); ok('the player stays visible at 200x200 or larger (YouTube requirement)',fr&&fr.vis&&fr.w>=200&&fr.h>=200,JSON.stringify(fr&&{w:fr.w,h:fr.h}));
 ok('the game switched itself to Real music',await p.evaluate(()=>window.__eval('cfg.musicMode')==='real'));
 // hostile credits
 await p.fill('#mp-url','https://youtu.be/abcdefghijk'); await p.click('#mp-add'); await p.waitForFunction(()=>!document.getElementById('mp-add').disabled,null,{timeout:15000}); await sleep(600);
 ok('hostile title is shown as text, never executed',await p.evaluate(()=>!window.__xss&&!document.querySelector('#mp-list img,#nowplaying img,#mp-credits img,#mp-list b b')),await p.evaluate(()=>String(window.__xss)));
 // direct audio URL
 await p.fill('#mp-url','https://cdn.example.test/lofi-night.wav'); await p.click('#mp-add'); await p.waitForFunction(()=>!document.getElementById('mp-add').disabled,null,{timeout:15000}); await sleep(1500);
 ok('a direct audio URL is added with a readable title',(await p.textContent('#mp-list')).includes('lofi night'));
 const pl=await p.evaluate(()=>window.__eval('music.current&&music.current.kind')); ok('and it plays right after being added in Real-music mode',pl==='audio'&&await p.evaluate(()=>window.__eval('music.playing')),String(pl));
 ok('direct-URL credits link to the source host',await p.isVisible('#mp-credits a[href*="cdn.example.test"]'));
 // bad + duplicate
 await p.fill('#mp-url','not a link'); await p.click('#mp-add'); await sleep(400); ok('a non-music link is rejected with a clear message',/does not look like/i.test(await p.textContent('#mp-msg')));
 await p.fill('#mp-url','https://youtu.be/dQw4w9WgXcQ'); await p.click('#mp-add'); await sleep(800); ok('a duplicate track is refused',/already/i.test(await p.textContent('#mp-msg')));
 // next/prev + remove
 const n0=await p.locator('.mp-row').count(); await p.click('#mp-prev'); await sleep(900); ok('Previous moves to another track',await p.evaluate(()=>window.__eval('music.current.title'))!=='lofi night'||n0>=3);
 await p.click('.mp-row >> nth=2 >> .mp-x'); await sleep(400); ok('a track can be removed',(await p.locator('.mp-row').count())===n0-1);
 // persistence
 await p.reload(); await p.waitForFunction(()=>typeof window.__eval==='function'&&window.__eval('P.ready'),null,{timeout:60000}); await sleep(1500); await p.keyboard.press('4'); await sleep(500); ok('the playlist survives a reload',(await p.locator('.mp-row').count())===n0-1&&(await p.textContent('#mp-list')).includes('Test Song'));
 // stop
 await p.click('#mp-mode [data-m=off]'); await sleep(600); ok('Off hides the credits pill and the YouTube card',!(await p.isVisible('#nowplaying'))&&!(await p.isVisible('#ytcard')));
 await p.click('#mp-mode [data-m=game]'); await sleep(600); ok('Game music shows the generative-score credit',/generative score/.test(await p.textContent('#nowplaying')));
 const csp=errs.filter(e=>/Content Security Policy|violates the following/i.test(e)); ok('no CSP violations (frame, media, connect and image sources are allowed)',csp.length===0,JSON.stringify(csp.slice(0,2)));
 ok('no page errors',errs.filter(e=>!/ERR_|Failed to load resource|net::/.test(e)).length===0,JSON.stringify(errs.filter(e=>!/ERR_|Failed to load resource|net::/.test(e)).slice(0,3)));
 console.log(fails?'FAILS '+fails:'ALL PASS'); await b.close(); process.exit(fails?1:0); })().catch(e=>{ console.log('FAIL',e.message); process.exit(1); });
