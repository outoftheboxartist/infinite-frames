#!/usr/bin/env python3
"""Make web/index.html from the main app (app/index.html, the claude.ai artifact).

The app's own code is copied unchanged into web/public/ (main-assets.js and main-app.js,
classic scripts loaded in order). Before them, index.html defines window.claude and loads
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
open(os.path.join(WEB, "public", "main-app.js"), "w", encoding="utf-8").write(app[len("<script>"):app.rstrip().rfind("</script>")] + "\n")

boot = """<script>/* window.claude for the main app: answered by src/claude-shim.js (Supabase) */
(function(){var r;var ready=new Promise(function(res){r=res});window.__ifShimReady=r;
window.claude={use:function(n){return ready.then(function(a){return a.use(n)})}};})();</script>
<script type="module" src="/src/claude-shim.js"></script>
<script src="/main-assets.js"></script>
<script src="/main-app.js"></script>
</body></html>
"""
open(os.path.join(WEB, "index.html"), "w", encoding="utf-8").write(head + "\n" + boot)
print("web/index.html written")
