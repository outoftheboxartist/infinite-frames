"""Turn traced.json into ifm_docs rows (SQL), one file per batch."""
import json, time, os
from simplify import simplify_d

HERE = os.path.dirname(os.path.abspath(__file__))
TOL = 0.15
UID = "7119d6b2-5240-4fa9-b33a-2ab1790f8361"   # the founder's current app identity (made the logo upload)
NAME = "outoftheboxartist"
ART = "IF logo"
o = json.load(open(os.path.join(HERE, "traced.json")))
now = int(time.time() * 1000)
rows = []   # (coll, id, data)

parent_id = "b-iflogo"
rows.append(("boundaries", parent_id, {
    "id": parent_id, "type": "boundary", "d": o["d"], "name": ART, "color": "#8fd9ff", "palette": ["#8fd9ff", "#f1f1f3"],
    "founder": NAME, "founderId": UID, "frameN": 1, "at": now}))
rows.append(("places", "p-iflogo", {
    "id": "p-iflogo", "kind": "auto", "name": ART, "type": "curve", "d": o["d"], "view": {"x": 500, "y": 210, "z": 2.4},
    "frame": 1, "by": NAME, "byId": UID, "at": now}))
rows.append(("events", "e-iflogo-0", {"id": "e-iflogo-0", "t": "F1", "text": NAME + " founded " + ART, "at": now}))

for k, f in enumerate(o["res"], start=1):
    t = now + k * 10
    paths = [{"d": simplify_d(p["d"], TOL), "color": p["color"]} for p in f["paths"]]
    paths = [p for p in paths if p["d"]]
    rows.append(("items", "i-iflogo-f%d" % k, {
        "id": "i-iflogo-f%d" % k, "type": "vector", "b": parent_id, "paths": paths, "cx": f["cx"], "cy": f["cy"],
        "t": {"x": 0, "y": 0, "s": 1, "r": 0}, "frameN": k, "author": NAME, "authorId": UID,
        "title": "%s · frame %d" % (ART, k), "at": t}))
    n = 0
    for i, r in enumerate(f["regions"]):
        d = simplify_d(r["d"], TOL)
        if not d:
            continue
        n += 1
        bid = "b-iflogo-f%d-%d" % (k, i + 1)
        rows.append(("boundaries", bid, {
            "id": bid, "type": "boundary", "d": d, "name": "%s · F%d · %d" % (ART, k, n), "color": r["color"],
            "palette": [r["color"], "#f1f1f3"], "founder": NAME, "founderId": UID, "frameN": k, "frameOnly": True,
            "parent": parent_id, "artwork": ART, "at": t + 1}))
    rows.append(("events", "e-iflogo-f%d" % k, {"id": "e-iflogo-f%d" % k, "t": "F%d" % k,
        "text": "%s traced %s frame %d into %d curves" % (NAME, ART, k, n), "at": t + 2}))
    status = "open" if k == len(o["res"]) else "published"
    rows.append(("frames", str(k), {"n": k, "status": status}))

def sql_for(batch):
    vals = []
    for coll, id_, data in batch:
        j = json.dumps(data, separators=(",", ":"))
        at = data.get("at")
        vals.append("('%s','%s',$j$%s$j$::jsonb,%s,'%s')" % (coll, id_, j, at if at is not None else "null", UID))
    return ("insert into public.ifm_docs (coll,id,data,at,owner) values " + ",".join(vals) +
            " on conflict (coll,id) do update set data = excluded.data, at = excluded.at, updated_at = now() returning coll")

batches, cur, size = [], [], 0
for r in rows:
    s = len(json.dumps(r[2]))
    if cur and size + s > 600_000:
        batches.append(cur); cur, size = [], 0
    cur.append(r); size += s
batches.append(cur)
for i, b in enumerate(batches):
    open(os.path.join(HERE, "batch%02d.sql" % i), "w").write(sql_for(b))
print(len(rows), "rows in", len(batches), "batches;", sum(1 for r in rows if r[0] == "boundaries"), "curves;",
      "largest row KB", max(len(json.dumps(r[2])) for r in rows) // 1024)
