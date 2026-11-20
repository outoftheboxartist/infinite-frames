#!/usr/bin/env python3
"""Make web/index.html from the main app (app/index.html, the claude.ai artifact).

The app's own code is copied into web/public/ (main-assets.js and main-app.js, classic
scripts loaded in order), with a few exact patches listed below that hook src/if-flow.js. Before them, index.html defines window.claude and loads
src/claude-shim.js, which answers the app's database, presence, identity and upload calls
from Supabase. Run after app/index.html changes:  python3 web/scripts/import-main-app.py
"""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE); ROOT = os.path.dirname(WEB)
lines = open(os.path.join(ROOT, "app", "index.html"), encoding="utf-8").read().split("\n")

head = "\n".join(lines[0:14])              # doctype, head, styles, <div id="root">
assert head.rstrip().endswith('<div id="root"></div>'), "layout changed"
assets = lines[14]; assert assets.startswith("<script>") and assets.endswith("</script>")
app = "\n".join(lines[15:56]); assert app.startswith("<script>") and app.rstrip().endswith("</script>")
assert "\n".join(lines[56:]).strip() == "</body></html>"

# the assets line holds several <script> blocks; join their bodies in order
bodies = re.findall(r"<script>(.*?)</script>", assets, re.S)
assert "".join("<script>" + b + "</script>" for b in bodies) == assets, "unexpected assets line"
open(os.path.join(WEB, "public", "main-assets.js"), "w", encoding="utf-8").write(";\n".join(bodies) + "\n")
code = app[len("<script>"):app.rstrip().rfind("</script>")]

# Small, exact patches (each string must occur the stated number of times).
# They hook the image flow in src/if-flow.js; everything else in the app is unchanged.
PATCHES = [
    # let src/if-flow.js reach the app
    ("class Nc extends De.Component{constructor(){super(...arguments);",
     "class Nc extends De.Component{constructor(){super(...arguments);window.__ifApp=this;", 1),
    # an uploaded or photographed image is traced straight away, then placed for moving and scaling
    ("this.setState(z=>({drafts:z.drafts.map(x=>x.id===id?{...x,fname:r.name,mime:r.type}:x)})),this.upAsset(r,id)}",
     "this.setState(z=>({drafts:z.drafts.map(x=>x.id===id?{...x,fname:r.name,mime:r.type}:x)})),this.upAsset(r,id),window.__ifAfterImage&&window.__ifAfterImage(this,id)}", 1),
    # with no curve selected the app spreads the image into a new rectangle window: trace that too
    ('if(!this.selOk()){this.batchImport([r]);return}this.setState({toast:"Adding image…"})',
     'if(!this.selOk()){this.batchImport([r]).then(()=>window.__ifAfterBatch&&window.__ifAfterBatch(this));return}this.setState({toast:"Adding image…"})', 1),
    # before publishing: name the artwork, optional prompt, traced regions become nested curves
    ('U(this,"publish",async()=>{if(this.busy)return;',
     'U(this,"publish",async()=>{if(this.busy)return;if(window.__ifBeforePublish&&!(await window.__ifBeforePublish(this)))return;', 1),
    # keep a curve's own name when it has one
    ('name:"Window "+(o.B.length+w+1),frameN:c}',
     'name:p.name&&p.name!=="New window"?p.name:"Window "+(o.B.length+w+1),frameN:c}', 1),
    # nested curves point at their parent's published id
    ('o.drafts.filter(f=>f.type==="boundary").forEach((f,w)=>{y[f.id]=h[w].id});',
     'o.drafts.filter(f=>f.type==="boundary").forEach((f,w)=>{y[f.id]=h[w].id});h.forEach(b=>{b.parent&&y[b.parent]&&(b.parent=y[b.parent])});', 1),
    # traced regions: one activity line for the artwork instead of one per region
    ('k=[];h.forEach(f=>k.push({id:this.newId("e"),t:"F"+c,text:o.name+" founded "+f.name})),',
     'k=[];h.filter(f=>!f.parent).forEach(f=>k.push({id:this.newId("e"),t:"F"+c,text:o.name+" founded "+f.name})),h.some(f=>f.parent)&&k.push({id:this.newId("e"),t:"F"+c,text:o.name+" traced "+(h.find(f=>f.parent).artwork||"an image")+" into "+h.filter(f=>f.parent).length+" curves"}),', 1),
    # and saved places only for top-level curves, not every traced region
    ('this.autoPlaces(h,v,c),', 'this.autoPlaces(h.filter(b=>!b.parent),v,c),', 1),
    # after publishing, post the optional "continue here" prompt
    ('this.autoPlaces(h.filter(b=>!b.parent),v,c),this.flashToast("Published to Frame "+c+". Locked in place.")',
     'this.autoPlaces(h.filter(b=>!b.parent),v,c),window.__ifAfterPublish&&window.__ifAfterPublish(this,h,v,c),this.flashToast("Published to Frame "+c+". Locked in place.")', 1),
]
for old, new, n in PATCHES:
    k = code.count(old)
    assert k == n, "patch expected %d, found %d: %s" % (n, k, old[:60])
    code = code.replace(old, new)
open(os.path.join(WEB, "public", "main-app.js"), "w", encoding="utf-8").write(code + "\n")

boot = """<script>/* window.claude for the main app: answered by src/claude-shim.js (Supabase) */
(function(){var r;var ready=new Promise(function(res){r=res});window.__ifShimReady=r;
window.claude={use:function(n){return ready.then(function(a){return a.use(n)})}};})();</script>
<script type="module" src="/src/claude-shim.js"></script>
<script type="module" src="/src/if-flow.js"></script>
<script src="/main-assets.js"></script>
<script src="/main-app.js"></script>
</body></html>
"""
open(os.path.join(WEB, "index.html"), "w", encoding="utf-8").write(head + "\n" + boot)
print("web/index.html written")
