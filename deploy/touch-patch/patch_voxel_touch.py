import os, re, shutil, sys
root = os.path.expanduser("~/voxel-realms"); stamp = "bak-20261028"
js = open("/tmp/voxel_touch.js.txt").read(); css = open("/tmp/voxel_touch.css.txt").read()
for f in ("src/main.js", "src/style.css", "index.html"):
    if not os.path.exists(f"{root}/{f}.{stamp}"): shutil.copy2(f"{root}/{f}", f"{root}/{f}.{stamp}")
m = open(f"{root}/src/main.js").read()
if "touch controls (phones" in m: sys.exit("already patched")
anchor = "addEventListener('keyup',ev=>{ const e=remapEv(ev); keys[e.code]=false; if(e.code==='Tab'){ plistOn=false; plistEl.style.display='none'; } });"
assert anchor in m, "keyup anchor not found"
open(f"{root}/src/main.js", "w").write(m.replace(anchor, anchor + "\n" + js, 1))
c = open(f"{root}/src/style.css").read(); open(f"{root}/src/style.css", "w").write(c.rstrip("\n") + "\n" + css)
h = open(f"{root}/index.html").read()
h = h.replace('<meta name="viewport" content="width=device-width,initial-scale=1">', '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">\n<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Voxel Realms">', 1)
open(f"{root}/index.html", "w").write(h); print("patched main.js, style.css, index.html")
