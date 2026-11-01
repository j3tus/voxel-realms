const {chromium}=require('playwright'); const fs=require('fs'); const D='/home/claude/workspace/reports/session-2026-10-31/';
(async()=>{ const [n,w,q]=[process.argv[2],+process.argv[3],+process.argv[4]]; const b=await chromium.launch(); const p=await b.newPage(); fs.mkdirSync('/tmp/emb',{recursive:true});
 const png=fs.readFileSync(D+n+'.png').toString('base64');
 const out=await p.evaluate(async ([png,w,q])=>{ const img=new Image(); img.src='data:image/png;base64,'+png; await img.decode(); const h=Math.round(img.height*w/img.width); const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); g.imageSmoothingQuality='high'; g.drawImage(img,0,0,w,h); return {h, d:c.toDataURL('image/jpeg',q).split(',')[1]}; },[png,w,q]);
 fs.writeFileSync('/tmp/emb/'+n+'.b64',out.d); console.log(n,'w',w,'h',out.h,'chars',out.d.length); await b.close(); })();
