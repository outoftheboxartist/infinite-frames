"""Build the TWOFOLD canvas rows (SQL) from uploaded.json and out/meta.json."""
import json, os, time
HERE = os.path.dirname(os.path.abspath(__file__))
up = json.load(open(os.path.join(HERE, "uploaded.json")))
meta = json.load(open(os.path.join(HERE, "out", "meta.json")))
UID = "7119d6b2-5240-4fa9-b33a-2ab1790f8361"     # the founder's current app identity
NAME = "outoftheboxartist"
CREDIT = "Story and rendering by Claude for outoftheboxartist. Yin n Yang fish and IF logo by outoftheboxartist."
now = int(time.time() * 1000)

# circular window, centre (500,500), radius 470, four cubic arcs
cx = cy = 500; r = 470; k = 0.5523 * r
d = (f"M{cx},{cy-r} C{cx+k},{cy-r} {cx+r},{cy-k} {cx+r},{cy} C{cx+r},{cy+k} {cx+k},{cy+r} {cx},{cy+r} "
     f"C{cx-k},{cy+r} {cx-r},{cy+k} {cx-r},{cy} C{cx-r},{cy-k} {cx-k},{cy-r} {cx},{cy-r} Z")
W = "b-twofold"
rows = [
    ("boundaries", W, {"id": W, "type": "boundary", "d": d, "name": "TWOFOLD", "color": "#cfd8ff",
                       "palette": ["#cfd8ff", "#f1f1f3"], "founder": NAME, "founderId": UID, "frameN": 1, "at": now}),
    ("places", "p-twofold", {"id": "p-twofold", "kind": "auto", "name": "TWOFOLD", "type": "curve", "d": d,
                             "view": {"x": 500, "y": 500, "z": 1}, "frame": 1, "by": NAME, "byId": UID, "at": now}),
    ("messages", "m-twofold", {"id": "m-twofold", "who": NAME, "whoId": UID, "idea": True, "at": now,
        "text": "TWOFOLD, a film in 20 frames: two small lights become the Yin n Yang fish, then a helix, a galaxy, "
                "and a pattern that never ends. Press play to watch it. Zoom in on any frame: each one hides tiny "
                "galaxies and orbiting pairs. Frame 20 is open. Continue the story.",
        "loc": {"x": 500, "y": 500, "z": 1.2, "label": "TWOFOLD"}}),
    ("events", "e-twofold-0", {"id": "e-twofold-0", "t": "F1", "text": NAME + " founded TWOFOLD", "at": now}),
]
for f in up["files"]:
    n = f["k"]; m = meta[n - 1]; t = now + n * 10
    rows.append(("items", "i-twofold-%02d" % n, {
        "id": "i-twofold-%02d" % n, "type": "image", "b": W, "src": f["url"], "asset": f["path"], "gif": False, "mime": "image/webp",
        "x": 30, "y": 30, "w": 940, "h": 940, "cx": 500, "cy": 500, "t": {"x": 0, "y": 0, "s": 1, "r": 0},
        "frameN": n, "author": NAME, "authorId": UID, "title": "TWOFOLD · %d · %s" % (n, m["title"]), "line": m["line"],
        "credit": CREDIT, "at": t}))
    rows.append(("events", "e-twofold-%02d" % n, {"id": "e-twofold-%02d" % n, "t": "F%d" % n,
                 "text": "%s · %s" % (m["title"], m["line"]), "at": t + 1}))
    rows.append(("frames", str(n), {"n": n, "status": "open" if n == len(up["files"]) else "published"}))

vals = []
for coll, id_, data in rows:
    vals.append("('%s','%s',$j$%s$j$::jsonb,%s,'%s')" % (coll, id_, json.dumps(data, separators=(",", ":")), data.get("at") or "null", UID))
sql = ("insert into public.ifm_docs (coll,id,data,at,owner) values " + ",".join(vals) +
       " on conflict (coll,id) do update set data = excluded.data, at = excluded.at, updated_at = now() returning coll")
open(os.path.join(HERE, "rows.sql"), "w").write(sql)
print(len(rows), "rows")
