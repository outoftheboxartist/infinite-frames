"""Write TWOFOLD II (helix.json) to the live canvas: vector items per frame, selectable curves,
frames 1-24 (24 open), one activity line per frame, the hidden paths as places.
Run: python3 build_helix_rows.py && python3 apply_helix.py"""
import json, os, re, time, math
HERE = os.path.dirname(os.path.abspath(__file__))
H = json.load(open(os.path.join(HERE, "helix.json")))
UID = "7119d6b2-5240-4fa9-b33a-2ab1790f8361"; NAME = "outoftheboxartist"; W = "b-twofold"
CREDIT = "Story and vector art by Claude for outoftheboxartist."
TITLES = {1: "Two", 6: "Two fish", 11: "Detail", 16: "Bridges", 21: "Galaxy"}
LINES = ["two dots, turning", "they leave a trail", "still turning", "dust gathers", "the orbit shows",
         "each dot becomes an eye", "two fish, one circle", "fins", "colour arrives", "scales",
         "filling in", "a galaxy hides in the tail", "every hue", "currents", "full",
         "a bridge between them", "bonds", "rungs", "a ladder that twists", "a double helix, seen from above",
         "the helix opens", "arms of light", "the galaxy turns", "it never ends: zoom in"]
now = int(time.time() * 1000)

def bcircle(x, y, r):
    q = 0.5523 * r; n = lambda v: ("%.3f" % v).rstrip("0").rstrip(".")
    return "M%s,%sC%s,%s %s,%s %s,%sC%s,%s %s,%s %s,%sC%s,%s %s,%s %s,%sC%s,%s %s,%s %s,%sZ" % tuple(n(v) for v in (
        x, y - r, x + q, y - r, x + r, y - q, x + r, y, x + r, y + q, x + q, y + r, x, y + r,
        x - q, y + r, x - r, y + q, x - r, y, x - r, y - q, x - q, y - r, x, y - r))

CIRC = re.compile(r"^M(-?[\d.]+) (-?[\d.]+)a([\d.]+) ")
def boundary_d(d):
    m = CIRC.match(d)
    if m and d.count("M") == 1:
        x, y, r = float(m.group(1)), float(m.group(2)), float(m.group(3))
        return bcircle(x + r, y, r)
    return d.split("Z")[0] + "Z"          # outline bands: the outer loop

rows = []
for k in range(1, 25):
    shapes = H["frames"][str(k)]; t = now + k * 10
    title = TITLES[max(x for x in TITLES if x <= k)]
    chunks, cur, size = [], [], 0
    for s in shapes:
        L = len(s["d"]) + 30
        if cur and size + L > 180_000: chunks.append(cur); cur, size = [], 0
        cur.append({"d": s["d"], "color": s["color"]}); size += L
    chunks.append(cur)
    for c, paths in enumerate(chunks, 1):
        iid = "i-twofold-%02d-v%02d" % (k, c)
        rows.append(("items", iid, {"id": iid, "type": "vector", "b": W, "paths": paths, "cx": 500, "cy": 500,
            "t": {"x": 0, "y": 0, "s": 1, "r": 0}, "frameN": k, "author": NAME, "authorId": UID,
            "title": "TWOFOLD · %d · %s" % (k, title) + ("" if len(chunks) == 1 else " · part %d" % c),
            "line": LINES[k - 1], "credit": CREDIT, "at": t + c}))
    curves = [s for s in shapes if s["curve"]]
    for i, s in enumerate(curves, 1):
        bid = "b-twofold-f%02d-%03d" % (k, i); col = s["color"][:7]
        rows.append(("boundaries", bid, {"id": bid, "type": "boundary", "d": boundary_d(s["d"]), "name": "TWOFOLD · %s" % s["name"],
            "color": col, "palette": [col, "#f1f1f3"], "founder": NAME, "founderId": UID, "frameN": k,
            "frameOnly": True, "parent": W, "artwork": "TWOFOLD", "at": t + 50 + i}))
    rows.append(("events", "e-twofold-%02d" % k, {"id": "e-twofold-%02d" % k, "t": "F%d" % k,
        "text": "TWOFOLD %d · %s" % (k, LINES[k - 1]), "at": t + 40}))
    rows.append(("frames", str(k), {"n": k, "status": "open" if k == 24 else "published"}))
for i, p in enumerate(H["places"], 1):
    pid = "p-twofold-path-%s-%d" % (p["trail"], p["step"])
    rows.append(("places", pid, {**p, "id": pid, "by": NAME, "byId": UID, "at": now + 900 + i}))
rows.append(("messages", "m-twofold", {"id": "m-twofold", "who": NAME, "whoId": UID, "idea": True, "agree": 0, "disagree": 0, "at": now,
    "loc": {"x": 500, "y": 500, "z": 1.2, "label": "TWOFOLD"},
    "text": "TWOFOLD, 24 frames. Two dots turn 15 degrees a frame and become two fish, then a bridge, then a galaxy. "
            "Press play, then zoom out to 3D: the stack is a double helix. Every dot holds a galaxy that holds a galaxy. "
            "Three secret paths go all the way down: try Take me somewhere. Frame 24 is open."}))

def sql_for(batch):
    vals = ["('%s','%s',$j$%s$j$::jsonb,%s,'%s')" % (c, i, json.dumps(d, separators=(",", ":")), d.get("at", now), UID) for c, i, d in batch]
    return ("insert into public.ifm_docs (coll,id,data,at,owner) values " + ",".join(vals) +
            " on conflict (coll,id) do update set data = excluded.data, at = excluded.at, updated_at = now() returning coll")
import glob
for p in glob.glob(os.path.join(HERE, "hbatch*.sql")): os.remove(p)
batches, cur, size = [], [], 0
for r in rows:
    s = len(json.dumps(r[2]))
    if cur and size + s > 550_000: batches.append(cur); cur, size = [], 0
    cur.append(r); size += s
batches.append(cur)
for i, b in enumerate(batches): open(os.path.join(HERE, "hbatch%02d.sql" % i), "w").write(sql_for(b))
print(len(rows), "rows,", len(batches), "batches; curves", sum(r[0] == "boundaries" for r in rows),
      "items", sum(r[0] == "items" for r in rows), "largest KB", max(len(json.dumps(r[2])) for r in rows) // 1024)
