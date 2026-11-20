#!/usr/bin/env python3
"""Build app-foveated/index.html (IF Main (Foveated)) from the main app.

Inputs:
  app/index.html                   the main app bundle (kept unchanged)
  app-foveated/live-app-line.js    optional: the bundle line from the newer live copy
  app-foveated/_fs_original.glsl   Foveated Zoom's fragment shader, unmodified
  app-foveated/foveated-layer.js   the readable foveated module

Every patch to the compiled bundle is an exact string that must occur the stated
number of times, or the build stops. Nothing else in the bundle changes.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ZMAX = 4096  # 8^4: four 8x levels below the whole canvas

lines = open(os.path.join(ROOT, "app", "index.html"), encoding="utf-8").read().split("\n")
BUNDLE = 54  # 0-based index of the ~190 KB app line
assert lines[BUNDLE].startswith("`+l.stack}"), "bundle line moved"
live = os.path.join(HERE, "live-app-line.js")
if os.path.exists(live):
    lines[BUNDLE] = open(live, encoding="utf-8").read().rstrip("\n")
code = lines[BUNDLE]

PATCHES = [
    # expose the app instance to the foveated layer (read-only use)
    ("class Nc extends De.Component{constructor(){super(...arguments);",
     "class Nc extends De.Component{constructor(){super(...arguments);window.__ifApp=this;", 1),
    # zoom: 1x..8x becomes 1x..4096x, and path precision follows the zoom
    ("setView(n){const r=Math.max(1,Math.min(8,n.z)),",
     "setView(n){const r=Math.max(1,Math.min(%d,n.z));window.__ifDec=Math.min(5,Math.max(1,Math.ceil(Math.log10(r))+1));const " % ZMAX, 1),
    # focus() used for places and flights
    ("z:Math.max(1,Math.min(8,1e3/(Math.max(t.w,t.h)*1.3)))",
     "z:Math.max(1,Math.min(%d,1e3/(Math.max(t.w,t.h)*1.3)))" % ZMAX, 1),
    # Take me somewhere / region list can fly into small curves
    ("Math.min(4,760/Math.max(", "Math.min(%d,760/Math.max(" % ZMAX, 2),
    # brush width is in canvas units: keep it the same size on screen at any depth
    ("live:{type:\"stroke\",b:r.selected,color:r.color,w:r.brush,pts:",
     "live:{type:\"stroke\",b:r.selected,color:r.color,w:r.brush/Math.max(1,this.cv().z),pts:", 1),
    # minimum closed-loop size is on screen, not in canvas units
    ("if(i.length<4||l.w<40||l.h<40){",
     "if(i.length<4||l.w<40/this.cv().z||l.h<40/this.cv().z){", 1),
    # fast renderer: once it is running, the 2D SVG ("ifv-" prefix) stops building an
    # element per stroke and traced shape; it keeps the closed curves used for tapping.
    # 3D layers and thumbnails (other prefixes) are unchanged.
    ("v=(f,w,N)=>l(\"g\",{key:N,opacity:w},f.filter(",
     "v=(f,w,N)=>r===\"ifv-\"&&window.__ifFast?null:l(\"g\",{key:N,opacity:w},f.filter(", 1),
    # frame-strip thumbnails: a small cached picture from the fast renderer instead of an SVG copy
    ('el:i("svg",{viewBox:"0 0 1000 1000",width:"100%",height:"100%",style:{display:"block"}},...this.art(B,"t"+B+"-",{base:!0}))',
     'el:window.__ifFast&&window.__ifThumb?i("img",{src:window.__ifThumb(B),alt:"",style:{display:"block",width:"100%",height:"100%"}}):i("svg",{viewBox:"0 0 1000 1000",width:"100%",height:"100%",style:{display:"block"}},...this.art(B,"t"+B+"-",{base:!0}))', 1),
    # path coordinates keep enough decimals for the current depth
    ("function ls(e){const t=e.length,n=i=>i.toFixed(1);",
     "function ls(e){const t=e.length,n=i=>i.toFixed(window.__ifDec||1);", 1),
    ("function Di(e){const t=i=>i.toFixed(1);",
     "function Di(e){const t=i=>i.toFixed(window.__ifDec||1);", 1),
]
for old, new, n in PATCHES:
    c = code.count(old)
    if c != n:
        sys.exit("patch expected %d, found %d: %s" % (n, c, old[:70]))
    code = code.replace(old, new)
lines[BUNDLE] = code

html = "\n".join(lines)
html = html.replace("<title>Infinite Frames</title>", "<title>IF Main (Foveated)</title>", 1)

fs = open(os.path.join(HERE, "_fs_original.glsl"), encoding="utf-8").read()
assert fs.count("texture2D(u_tex,") == 9 and fs.count("texture2D(u_glow,") == 1, "shader changed"
fs = fs.replace("uniform float u_t, u_style, u_dpr;", "uniform float u_t, u_style, u_dpr; uniform vec4 u_xf;", 1)
fs = fs.replace("const vec3 BG=vec3(.039,.039,.047)", "const vec3 BG=vec3(.0196,.0235,.0275)", 1)
helpers = ("vec4 T(vec2 uv){vec2 q=uv*u_xf.xy+u_xf.zw;if(q.x<0.||q.y<0.||q.x>1.||q.y>1.)return vec4(BG,1.);return texture2D(u_tex,q);}\n"
           "vec4 TG(vec2 uv){vec2 q=uv*u_xf.xy+u_xf.zw;if(q.x<0.||q.y<0.||q.x>1.||q.y>1.)return vec4(BG,1.);return texture2D(u_glow,q);}\n")
anchor = "float h21(vec2 p)"
assert fs.count(anchor) == 1
fs = fs.replace(anchor, helpers + anchor, 1)
body, tail = fs.split(helpers, 1)
tail = tail.replace("texture2D(u_tex,", "T(").replace("texture2D(u_glow,", "TG(")
fs = body + helpers + tail
for bad in ("`", "${"):
    assert bad not in fs

layer = open(os.path.join(HERE, "foveated-layer.js"), encoding="utf-8").read()
assert layer.count("`__FS__`") == 1
layer = layer.replace("`__FS__`", "`" + fs + "`")
assert "</script" not in layer

marker = "</body></html>"
assert html.rstrip().endswith(marker)
html = html.rstrip()[: -len(marker)] + "<script>\n" + layer + "\n</script>\n" + marker + "\n"
out = os.path.join(HERE, "index.html")
open(out, "w", encoding="utf-8").write(html)
print("wrote", out, len(html), "bytes")
