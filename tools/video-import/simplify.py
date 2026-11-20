"""Simplify traced paths (Ramer-Douglas-Peucker) so each frame fits the database limits."""
import json, re, sys

NUM = re.compile(r"-?\d+\.?\d*")

def rings(d):
    out = []
    for part in d.split("M")[1:]:
        nums = [float(x) for x in NUM.findall(part)]
        pts = list(zip(nums[0::2], nums[1::2]))
        if len(pts) >= 3:
            out.append(pts)
    return out

def rdp(pts, tol):
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]; t2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; dx = pts[b][0] - ax; dy = pts[b][1] - ay; L = dx * dx + dy * dy
        md, mi = -1, -1
        for i in range(a + 1, b):
            px = pts[i][0] - ax; py = pts[i][1] - ay
            dd = px * px + py * py if L == 0 else (px * dy - py * dx) ** 2 / L
            if dd > md: md, mi = dd, i
        if md > t2:
            keep[mi] = True; stack.append((a, mi)); stack.append((mi, b))
    return [p for p, k in zip(pts, keep) if k]

def fmt(v):
    s = "%.1f" % v
    return s[:-2] if s.endswith(".0") else s

def simplify_d(d, tol):
    out = []
    for r in rings(d):
        q = rdp(r, tol)
        if len(q) >= 3:
            out.append("M" + "L".join(fmt(x) + "," + fmt(y) for x, y in q) + "Z")
    return "".join(out)

if __name__ == "__main__":
    o = json.load(open(sys.argv[1]))
    for tol in [float(t) for t in sys.argv[2:]]:
        sizes = []
        for f in o["res"]:
            art = sum(len(simplify_d(p["d"], tol)) for p in f["paths"])
            cur = max(len(simplify_d(r["d"], tol)) for r in f["regions"])
            sizes.append((art, cur))
        print("tol", tol, "art KB per frame:", [round(a / 1024) for a, _ in sizes], "largest curve KB:", max(c for _, c in sizes) // 1024)
