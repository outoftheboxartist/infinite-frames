"""TWOFOLD vector rows: replace each frame's image item with smooth vector chunks + per-frame selectable curves.
The original painted frame stays attached as `orig` on chunk 1, so 'Trace' can still run on it later."""
import json, os, time, glob
HERE = os.path.dirname(os.path.abspath(__file__))
V = json.load(open(os.path.join(HERE, "vector.json")))
up = json.load(open(os.path.join(HERE, "uploaded.json")))
meta = json.load(open(os.path.join(HERE, "out", "meta.json")))
UID = "7119d6b2-5240-4fa9-b33a-2ab1790f8361"; NAME = "outoftheboxartist"; W = "b-twofold"
CREDIT = "Story and vector art by Claude for outoftheboxartist. Yin n Yang fish and IF logo by outoftheboxartist."
now = int(time.time() * 1000)
rows = []
for f in up["files"]:
    n = f["k"]; m = meta[n - 1]; t = now + n * 10; shapes = V[str(n)]
    orig = {"type": "image", "src": f["url"], "asset": f["path"], "gif": False, "mime": "image/webp", "x": 30, "y": 30, "w": 940, "h": 940}
    chunks, cur, size = [], [], 0
    for s in shapes:
        L = len(s["d"]) + 30
        if cur and size + L > 180_000: chunks.append(cur); cur, size = [], 0
        cur.append({"d": s["d"], "color": s["color"]}); size += L
    chunks.append(cur)
    for c, paths in enumerate(chunks, 1):
        iid = "i-twofold-%02d-v%02d" % (n, c)
        item = {"id": iid, "type": "vector", "b": W, "paths": paths, "cx": 500, "cy": 500, "t": {"x": 0, "y": 0, "s": 1, "r": 0},
                "frameN": n, "author": NAME, "authorId": UID, "title": "TWOFOLD · %d · %s" % (n, m["title"]) + ("" if len(chunks) == 1 else " · part %d" % c),
                "line": m["line"], "credit": CREDIT, "at": t + c}
        if c == 1: item["orig"] = orig
        rows.append(("items", iid, item))
    curves = [s for s in shapes if s["curve"]]
    for i, s in enumerate(curves, 1):
        bid = "b-twofold-f%02d-%03d" % (n, i)
        rows.append(("boundaries", bid, {"id": bid, "type": "boundary", "d": s["d"], "name": "TWOFOLD · %d · %s" % (n, s["name"] or "curve %d" % i),
            "color": s["color"][:7], "palette": [s["color"][:7], "#f1f1f3"], "founder": NAME, "founderId": UID, "frameN": n,
            "frameOnly": True, "parent": W, "artwork": "TWOFOLD", "at": t + 50 + i}))
    rows.append(("events", "e-twofold-%02d" % n, {"id": "e-twofold-%02d" % n, "t": "F%d" % n,
        "text": "%s · %s · %d shapes, %d curves" % (m["title"], m["line"], len(shapes), len(curves)), "at": t + 40}))

def sql_for(batch):
    vals = ["('%s','%s',$j$%s$j$::jsonb,%s,'%s')" % (c, i, json.dumps(d, separators=(",", ":")), d["at"], UID) for c, i, d in batch]
    return ("insert into public.ifm_docs (coll,id,data,at,owner) values " + ",".join(vals) +
            " on conflict (coll,id) do update set data = excluded.data, at = excluded.at, updated_at = now() returning coll")
for p in glob.glob(os.path.join(HERE, "vbatch*.sql")): os.remove(p)
batches, cur, size = [], [], 0
for r in rows:
    s = len(json.dumps(r[2]))
    if cur and size + s > 550_000: batches.append(cur); cur, size = [], 0
    cur.append(r); size += s
batches.append(cur)
for i, b in enumerate(batches): open(os.path.join(HERE, "vbatch%02d.sql" % i), "w").write(sql_for(b))
print(len(rows), "rows", len(batches), "batches; items", sum(r[0] == "items" for r in rows), "curves", sum(r[0] == "boundaries" for r in rows),
      "largest KB", max(len(json.dumps(r[2])) for r in rows) // 1024)
