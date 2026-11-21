"""TWOFOLD as vector art: smooth closed curves only, detail rising with the frame number.

Every shape is a closed SVG path made of cubic curves (Catmull-Rom through sampled points), so it
stays smooth at any zoom. Glow is built from stacked translucent circles. Each frame returns a list
of shapes: {"d", "color" (#rrggbbaa), "curve" (selectable?), "name", "area"}.
Canvas units: 0..1000, centre (500,500); the TWOFOLD window is a circle of radius 470.
"""
import json, math, os, random, colorsys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TAU = 2 * math.pi
C = 500.0
WIN_R = 470

def n(v):
    s = "%.1f" % v
    s = s.rstrip("0").rstrip(".")
    return s if s not in ("-0", "") else "0"

def hexa(r, g, b, a=1.0):
    return "#%02x%02x%02x%02x" % (int(max(0, min(255, r))), int(max(0, min(255, g))), int(max(0, min(255, b))), int(max(0, min(255, a * 255))))

def prism(t, a=1.0, l=0.62, s=0.95):
    r, g, b = colorsys.hls_to_rgb(t % 1.0, l, s)
    return hexa(r * 255, g * 255, b * 255, a)

YIN = (143, 166, 214)      # cool silver-blue
YANG = (255, 207, 122)     # warm gold light
def yin(a=1.0): return hexa(*YIN, a)
def yang(a=1.0): return hexa(*YANG, a)
def silver(a=1.0): return hexa(214, 222, 236, a)

# ---------- smooth closed path through points (Catmull-Rom -> cubic) ----------
def smooth_closed(pts):
    m = len(pts)
    if m < 3:
        return ""
    out = "M%s,%s" % (n(pts[0][0]), n(pts[0][1]))
    for i in range(m):
        p0, p1, p2, p3 = pts[(i - 1) % m], pts[i], pts[(i + 1) % m], pts[(i + 2) % m]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out += "C%s,%s %s,%s %s,%s" % (n(c1[0]), n(c1[1]), n(c2[0]), n(c2[1]), n(p2[0]), n(p2[1]))
    return out + "Z"

def poly_area(pts):
    a = 0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2

def circle_pts(cx, cy, r, k=None):
    k = k or max(8, min(40, int(r * 1.2) + 8))
    return [(cx + math.cos(i / k * TAU) * r, cy + math.sin(i / k * TAU) * r) for i in range(k)]

def circle(cx, cy, r):
    # four-arc cubic circle: compact, exact enough
    q = 0.5523 * r
    return ("M%s,%sC%s,%s %s,%s %s,%sC%s,%s %s,%s %s,%sC%s,%s %s,%s %s,%sC%s,%s %s,%s %s,%sZ" % tuple(n(v) for v in (
        cx, cy - r, cx + q, cy - r, cx + r, cy - q, cx + r, cy, cx + r, cy + q, cx + q, cy + r, cx, cy + r,
        cx - q, cy + r, cx - r, cy + q, cx - r, cy, cx - r, cy - q, cx - q, cy - r, cx, cy - r)))

def ellipse_pts(cx, cy, rx, ry, rot, k=20):
    c, s = math.cos(rot), math.sin(rot)
    return [(cx + math.cos(t) * rx * c - math.sin(t) * ry * s, cy + math.cos(t) * rx * s + math.sin(t) * ry * c)
            for t in (i / k * TAU for i in range(k))]

def ribbon_pts(path, w0, w1):
    """closed outline around a polyline, width w0 -> w1, rounded ends"""
    if len(path) < 2:
        return []
    L, R = [], []
    for i, (x, y) in enumerate(path):
        a = path[max(0, i - 1)]; b = path[min(len(path) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; d = math.hypot(dx, dy) or 1
        nx, ny = -dy / d, dx / d
        w = (w0 + (w1 - w0) * i / (len(path) - 1)) / 2
        L.append((x + nx * w, y + ny * w)); R.append((x - nx * w, y - ny * w))
    return L + R[::-1]

def band_closed(path, w):
    """a closed loop path thickened into a band (two loops, even-odd)"""
    L, R = [], []
    m = len(path)
    for i in range(m):
        a = path[(i - 1) % m]; b = path[(i + 1) % m]
        dx, dy = b[0] - a[0], b[1] - a[1]; d = math.hypot(dx, dy) or 1
        nx, ny = -dy / d, dx / d
        L.append((path[i][0] + nx * w / 2, path[i][1] + ny * w / 2)); R.append((path[i][0] - nx * w / 2, path[i][1] - ny * w / 2))
    return smooth_closed(L) + smooth_closed(R[::-1]), poly_area(L) - poly_area(R)

def resample(path, step):
    out = [path[0]]; acc = 0
    for i in range(1, len(path)):
        x0, y0 = out[-1]; x1, y1 = path[i]; d = math.hypot(x1 - x0, y1 - y0)
        if d >= step: out.append(path[i])
    if out[-1] != path[-1]: out.append(path[-1])
    return out

def spiral(cx, cy, a0, r0, r1, turns, k=160):
    return [(cx + math.cos(a0 + t * turns * TAU) * r0 * (r1 / r0) ** t, cy + math.sin(a0 + t * turns * TAU) * r0 * (r1 / r0) ** t) for t in (i / k for i in range(k + 1))]

def arc(cx, cy, rx, ry, a0, a1, k=80):
    return [(cx + math.cos(a0 + (a1 - a0) * i / k) * rx, cy + math.sin(a0 + (a1 - a0) * i / k) * ry) for i in range(k + 1)]

def comma_pts(cx, cy, R, rot, k=56):
    pts = []
    for i in range(k + 1):
        a = -math.pi / 2 + math.pi * i / k; pts.append((math.cos(a) * R, math.sin(a) * R))
    for i in range(k // 2 + 1):
        a = math.pi / 2 + math.pi * i / (k // 2); pts.append((math.cos(a) * R / 2, R / 2 + math.sin(a) * R / 2))
    for i in range(k // 2 + 1):
        a = math.pi / 2 - math.pi * i / (k // 2); pts.append((math.cos(a) * R / 2, -R / 2 + math.sin(a) * R / 2))
    c, s = math.cos(rot), math.sin(rot)
    out, seen = [], set()
    for x, y in pts:
        p = (round(cx + x * c - y * s, 2), round(cy + x * s + y * c, 2))
        if p not in seen: seen.add(p); out.append(p)
    return out

# ---------- shape list builder ----------
class Frame:
    def __init__(self, k, seed):
        self.k = k; self.R = random.Random(seed); self.shapes = []
    def add(self, d, color, area, curve=False, name=""):
        if d: self.shapes.append({"d": d, "color": color, "area": area, "curve": curve, "name": name})
    def poly(self, pts, color, curve=False, name=""):
        if len(pts) >= 3: self.add(smooth_closed(pts), color, poly_area(pts), curve, name)
    def disc(self, x, y, r, color, curve=False, name=""):
        self.add(circle(x, y, r), color, math.pi * r * r, curve, name)
    def halo(self, x, y, r, rgb, rings, a=0.16, spread=0.42):
        steps = rings * 3
        for i in range(steps, 0, -1):
            self.disc(x, y, r * (1 + i * spread / 3), hexa(*rgb, a * 0.5 * (1 - i / (steps + 1)) ** 1.6))
    def sphere(self, x, y, r, rgb, rings, name, highlight=True):
        self.halo(x, y, r, rgb, rings)
        self.disc(x, y, r, hexa(*rgb, 1), True, name)
        if highlight:
            self.disc(x - r * 0.33, y - r * 0.36, r * 0.22, hexa(255, 255, 255, 0.85))
    def ribbon(self, path, w0, w1, color, curve=False, name=""):
        self.poly(ribbon_pts(resample(path, 3), w0, w1), color, curve, name)
    def dust(self, count, rad, colfn, rmin=0.35, rmax=1.4):
        for _ in range(count):
            a = self.R.random() * TAU; d = self.R.random() ** 0.6 * rad
            self.disc(C + math.cos(a) * d, C + math.sin(a) * d, rmin + self.R.random() * (rmax - rmin), colfn(self.R.random(), d / rad))
    def micro_galaxy(self, x, y, r, count=40):
        turn = self.R.random() * TAU
        for i in range(count):
            arm = i % 2; t = self.R.random(); ang = turn + arm * math.pi + t * 4.2
            self.disc(x + math.cos(ang) * t * r, y + math.sin(ang) * t * r, 0.12 + self.R.random() * 0.22, prism(t, 0.8) if arm else silver(0.8))
        self.disc(x, y, max(0.2, r * 0.1), hexa(255, 255, 255, 0.9))
    def micro_pair(self, x, y, r, ang):
        dx, dy = math.cos(ang) * r, math.sin(ang) * r
        self.disc(x + dx, y + dy, max(0.15, r * 0.3), yin(0.95)); self.disc(x - dx, y - dy, max(0.15, r * 0.3), yang(0.95))
    def hidden_life(self, count, rad):
        for _ in range(count):
            a = self.R.random() * TAU; d = self.R.random() ** 0.5 * rad
            x, y = C + math.cos(a) * d, C + math.sin(a) * d
            if self.R.random() < 0.5: self.micro_galaxy(x, y, 1.5 + self.R.random() * 4, 24 + int(self.k * 2))
            else: self.micro_pair(x, y, 0.8 + self.R.random() * 2, self.R.random() * TAU)

def orb(k): return -0.55 + k * 0.62

# ---------- traced sources (the founder's fish and IF logo) ----------
SRC = json.load(open(os.path.join(HERE, "sources.json")))
def rdp(pts, tol):
    if len(pts) < 4: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]; t2 = tol * tol
    while st:
        a, b = st.pop(); ax, ay = pts[a]; dx = pts[b][0] - ax; dy = pts[b][1] - ay; L = dx * dx + dy * dy
        md, mi = -1, -1
        for i in range(a + 1, b):
            px = pts[i][0] - ax; py = pts[i][1] - ay
            dd = px * px + py * py if L == 0 else (px * dy - py * dx) ** 2 / L
            if dd > md: md, mi = dd, i
        if md > t2: keep[mi] = True; st += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]
import re
NUM = re.compile(r"-?\d+\.?\d*")
def traced(fr, name, cx, cy, size, rot=0.0, alpha=1.0, tol=1.6, min_area=6.0, curve_names=None):
    """place a traced source: 1000x1000 source space -> centred square of `size`, rotated"""
    s = size / 1000.0; c, sn = math.cos(rot), math.sin(rot)
    for layer in SRC[name]["paths"]:
        rgb = tuple(int(layer["color"][i:i + 2], 16) for i in (1, 3, 5))
        for part in layer["d"].split("M")[1:]:
            v = [float(x) for x in NUM.findall(part)]; pts = list(zip(v[0::2], v[1::2]))
            pts = rdp(pts, tol / max(s, 1e-6))
            if len(pts) < 3: continue
            P = [(cx + ((x - 500) * c - (y - 500) * sn) * s, cy + ((x - 500) * sn + (y - 500) * c) * s) for x, y in pts]
            a = poly_area(P)
            if a < min_area: continue
            fr.poly(P, hexa(*rgb, alpha), curve_names is not None, (curve_names or "") )

# ---------- the frames ----------
def build(k):
    f = Frame(k, 9301 + k * 7919); R = f.R
    a = orb(k)
    if k == 1:
        d = 193
        f.sphere(C + math.cos(a) * d, C + math.sin(a) * d * 0.42, 22, YIN, 0, "Yin", highlight=False)
        f.sphere(C - math.cos(a) * d, C - math.sin(a) * d * 0.42, 20, YANG, 0, "Yang", highlight=False)
        return f
    if k == 2:
        d = 172
        p1 = (C + math.cos(a) * d, C + math.sin(a) * d * 0.55); p2 = (C - math.cos(a) * d, C - math.sin(a) * d * 0.55)
        f.ribbon(arc(C, C, d, d * 0.55, a, a - 1.1), 7, 0.6, yin(0.55), True, "Yin trail")
        f.ribbon(arc(C, C, d, d * 0.55, a + math.pi, a + math.pi - 1.1), 7, 0.6, prism(0.08, 0.6), True, "Yang trail")
        f.sphere(*p1, 22, YIN, 2, "Yin"); f.sphere(*p2, 20, YANG, 2, "Yang")
        f.dust(12, 440, lambda q, t: silver(0.4))
        return f
    if k == 3:
        d = 150
        for j in range(2):
            f.ribbon(spiral(C, C, a + j * 0.05, d, d * 1.8, -0.42), 9 - j * 4, 0.5, yin(0.5 - j * 0.2), True, "Yin path")
            f.ribbon(spiral(C, C, a + math.pi + j * 0.05, d, d * 1.8, -0.42), 9 - j * 4, 0.5, prism(0.6 + j * 0.1, 0.55 - j * 0.2), True, "Yang path")
        f.sphere(C + math.cos(a) * d, C + math.sin(a) * d, 24, YIN, 3, "Yin"); f.sphere(C - math.cos(a) * d, C - math.sin(a) * d, 22, YANG, 3, "Yang")
        f.dust(40, 440, lambda q, t: silver(0.35) if q < 0.5 else prism(q, 0.45)); f.hidden_life(6, 430)
        return f
    if k == 4:
        d = 118
        for j in range(5):
            f.ribbon(spiral(C, C, a + j * 0.06, d * 0.25, d * 3.4, 0.85), 11 - j * 2, 0.5, yin(0.55 - j * 0.08), True, "Yin comma %d" % (j + 1))
            f.ribbon(spiral(C, C, a + math.pi + j * 0.06, d * 0.25, d * 3.4, 0.85), 11 - j * 2, 0.5, prism(j / 5, 0.6), True, "Yang comma %d" % (j + 1))
        f.sphere(C + math.cos(a) * d, C + math.sin(a) * d, 24, YIN, 3, "Yin"); f.sphere(C - math.cos(a) * d, C - math.sin(a) * d, 22, YANG, 3, "Yang")
        f.dust(80, 450, lambda q, t: silver(0.3) if q < 0.5 else prism(q, 0.4)); f.hidden_life(10, 430)
        return f
    if k in (5, 15, 16, 20):
        helices = {5: [(260, 55, 7, a, 7, 60)], 15: [(300, 70, 11, a, 8, 120), (195, 42, 8, -a * 1.3, 6, 90), (108, 24, 5, a * 1.7, 4, 60)],
                   16: [(300, 70, 11, a, 4, 90)], 20: [(420, 18, 9, a, 2.5, 60)]}[k]
        for hi, (rad, amp, tw, rot, w, rungs) in enumerate(helices):
            for si, ph0 in enumerate((0, math.pi)):
                path = [(C + math.cos(rot + t * TAU) * (rad + math.sin(t * tw * TAU + ph0) * amp), C + math.sin(rot + t * TAU) * (rad + math.sin(t * tw * TAU + ph0) * amp)) for t in (i / 600 for i in range(600))]
                dd, ar = band_closed(path, w)
                f.add(dd, (yin(0.85) if si == 0 else prism(0.55 + hi * 0.15, 0.85)) if k != 16 else silver(0.35), ar, True, "Helix %d strand %s" % (hi + 1, "AB"[si]))
            for i in range(rungs):
                t = i / rungs; ang = rot + t * TAU; o1 = math.sin(t * tw * TAU) * amp
                p1 = (C + math.cos(ang) * (rad + o1), C + math.sin(ang) * (rad + o1)); p2 = (C + math.cos(ang) * (rad - o1), C + math.sin(ang) * (rad - o1))
                if abs(o1) > amp * 0.15:
                    f.ribbon([p1, p2], w * 0.35, w * 0.35, prism(t * 2 % 1, 0.45 if k != 16 else 0.2))
                f.disc((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, w * 0.4, prism(t * 3 % 1, 0.9 if k != 16 else 0.4), k in (5, 15), "Bead %d.%d" % (hi + 1, i + 1))
        if k == 5:
            f.sphere(C + math.cos(a) * 260, C + math.sin(a) * 260, 22, YIN, 3, "Yin"); f.sphere(C - math.cos(a) * 260, C - math.sin(a) * 260, 20, YANG, 3, "Yang")
            f.dust(140, 450, lambda q, t: prism(q, 0.4)); f.hidden_life(14, 430)
        if k == 15:
            f.dust(900, 450, lambda q, t: prism(q, 0.45), 0.25, 0.9); f.hidden_life(60, 440)
        if k == 16:
            for i in range(44):
                t = i / 44; ang = a + t * TAU; rr = 300 + math.sin(t * 11 * TAU) * 35
                x, y = C + math.cos(ang) * rr, C + math.sin(ang) * rr; s = 10 + R.random() * 12; h = R.random()
                f.halo(x, y, s * 0.8, tuple(int(c * 255) for c in colorsys.hls_to_rgb(h, 0.6, 0.9)), 3, 0.14)
                for p in range(9):
                    pa = p / 9 * TAU + R.random() * 0.2
                    f.poly(ellipse_pts(x + math.cos(pa) * s * 0.6, y + math.sin(pa) * s * 0.6, s * 0.55, s * 0.22, pa, 14), hexa(245, 238, 255, 0.55), p == 0, "Flower %d" % (i + 1))
                f.disc(x, y, s * 0.28, prism(h, 1, 0.55), True, "Flower %d heart" % (i + 1))
            for _ in range(1400):
                x = C - 330 + R.random() * 660; base = C + 55 * math.sin((x - C) / 120) - 36 * math.cos((x - C) / 64)
                f.disc(x, base + (R.random() - 0.5) * 32 * R.random(), 0.25 + R.random() * 0.7, silver(0.5) if R.random() < 0.75 else prism(R.random(), 0.7))
            f.hidden_life(70, 440)
        if k == 20:
            d = 175; p1 = (C + math.cos(a) * d, C + math.sin(a) * d * 0.5); p2 = (C - math.cos(a) * d, C - math.sin(a) * d * 0.5)
            f.ribbon(arc(C, C, d, d * 0.5, 0, TAU, 160), 1.2, 1.2, silver(0.4))
            f.sphere(*p1, 34, YIN, 6, "Yin, holding the fish")
            f.sphere(*p2, 31, YANG, 6, "Yang, holding a galaxy")
            traced(f, "fish", p1[0], p1[1], 46, a, 1.0, tol=0.15, min_area=0.02)
            f.micro_galaxy(p2[0], p2[1], 18, 260)
            # echoes of the whole story around the orbit
            for i in range(20):
                t = i / 20; ang = a + t * TAU; x, y = C + math.cos(ang) * 330, C + math.sin(ang) * 330
                f.micro_pair(x, y, 4 + t * 4, ang * 3) if i % 2 else f.micro_galaxy(x, y, 6 + t * 4, 60)
            # the whole film folded inside the last frame
            for i in range(260):
                r0 = 30 + R.random() ** 0.8 * 280; a0 = R.random() * TAU
                f.ribbon(arc(C, C, r0, r0 * 0.62, a0, a0 + 0.3 + R.random() * 0.7, 22), 1.6, 0.2, hexa(215, 230, 255, 0.28) if i % 2 else prism(R.random(), 0.32))
            for j, pts in enumerate((comma_pts(C, C, 250, a), comma_pts(C, C, 250, a + math.pi))):
                f.poly(pts, yin(0.10) if j == 0 else yang(0.08), True, ("Yin field", "Yang field")[j])
            for i in range(1400):
                arm = i % 2; t = R.random() ** 0.7; ang = a + arm * math.pi + t * 3.6 + (R.random() - 0.5) * 0.8
                rr = 12 + t * 300
                f.disc(C + math.cos(ang) * rr, C + math.sin(ang) * rr * 0.5, 0.2 + R.random() * 0.8, prism((t + R.random() * 0.1) % 1, 0.5) if arm else silver(0.5))
            for i in range(30):
                t = i / 30; ang = a + t * TAU; x, y = C + math.cos(ang) * 395, C + math.sin(ang) * 395; s = 5 + (i % 3) * 2
                for p in range(7):
                    pa = p / 7 * TAU
                    f.poly(ellipse_pts(x + math.cos(pa) * s * 0.6, y + math.sin(pa) * s * 0.6, s * 0.55, s * 0.22, pa, 12), hexa(245, 238, 255, 0.5))
                f.disc(x, y, s * 0.28, prism(t, 1, 0.55), True, "Bloom %d" % (i + 1))
            f.dust(2400, 455, lambda q, t: prism(q, 0.6), 0.25, 1.0); f.hidden_life(140, 445)
        return f
    if k == 6:
        rot = a
        yinc = comma_pts(C, C, 300, rot); yangc = comma_pts(C, C, 300, rot + math.pi)
        f.poly(yinc, yin(0.42), True, "Yin body"); f.poly(yangc, prism(0.12, 0.18), True, "Yang body")
        for j, pts in enumerate((yinc, yangc)):
            dd, ar = band_closed(resample(pts + [pts[0]], 4)[:-1], 3)
            f.add(dd, silver(0.8) if j == 0 else prism(0.6, 0.8), ar)
        for i in range(70):
            r0 = 40 + R.random() * 250; a0 = R.random() * TAU
            f.ribbon(arc(C, C, r0, r0, a0, a0 + 0.3 + R.random() * 0.5, 20), 2.2, 0.3, silver(0.35) if i % 2 else prism(R.random(), 0.45), i < 12, "Current %d" % (i + 1))
        f.sphere(C + math.cos(rot + math.pi / 2) * 150, C + math.sin(rot + math.pi / 2) * 150, 22, YIN, 4, "Yin eye")
        f.sphere(C + math.cos(rot - math.pi / 2) * 150, C + math.sin(rot - math.pi / 2) * 150, 20, YANG, 4, "Yang eye")
        f.dust(200, 450, lambda q, t: prism(q, 0.4)); f.hidden_life(24, 440)
        return f
    if k == 7:
        rot = a
        traced(f, "fish", C, C, 780, rot * 0.3 - 0.6, 0.25, tol=1.8, min_area=20)
        for j in range(9):
            f.ribbon(spiral(C, C, rot + j * 0.11, 55, 350, 0.62), 10 - j, 0.5, yin(0.5 - j * 0.04), j < 5, "Yin fin %d" % (j + 1))
            f.ribbon(spiral(C, C, rot + math.pi + j * 0.11, 55, 350, 0.62), 10 - j, 0.5, prism(j / 9, 0.6), j < 5, "Yang fin %d" % (j + 1))
        for side, base in ((0, rot), (1, rot + math.pi)):
            for p in range(7):
                pa = base + 2.2 + (p - 3) * 0.16; x, y = C + math.cos(pa) * 330, C + math.sin(pa) * 330
                f.poly(ellipse_pts(x, y, 60, 9, pa + 1.2, 18), yin(0.35) if side == 0 else prism(p / 7, 0.4), True, "Fin ray %d" % (p + 1))
        for _ in range(140):
            ang = rot + math.pi - 0.3 + R.random() * 1.9; d = 320 * (0.75 + R.random() * 0.4)
            x, y = C + math.cos(ang) * d, C + math.sin(ang) * d; w = 3 + R.random() * 32; h = 0.7 + R.random() * 1.8
            f.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], prism(R.random(), 0.7))
        f.sphere(C + math.cos(rot) * 75, C + math.sin(rot) * 75, 16, YIN, 4, "Yin"); f.sphere(C - math.cos(rot) * 75, C - math.sin(rot) * 75, 14, YANG, 4, "Yang")
        f.hidden_life(30, 440)
        return f
    if k == 8:
        traced(f, "fish", C, C, 872, 0, 1.0, tol=0.6, min_area=3, curve_names="Yin n Yang")
        f.dust(260, 455, lambda q, t: prism(q, 0.4)); f.hidden_life(34, 440)
        return f
    if k in (9, 10):
        rot = 0.72 if k == 9 else 1.44
        if k == 9:
            for _ in range(560):
                ang = R.random() * TAU; d = 350 * (0.75 + R.random() * 0.45); x, y = C + math.cos(ang) * d, C + math.sin(ang) * d
                w = 3 + R.random() * 32; h = 0.7 + R.random() * 1.8
                f.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], prism(R.random(), 0.75))
            for i in range(90):
                r0 = 80 + R.random() * 360; a0 = R.random() * TAU
                f.ribbon(arc(C, C, r0, r0, a0, a0 + 0.4 + R.random() * 0.6, 24), 2.4, 0.3, prism(R.random(), 0.5), i < 10, "Current %d" % (i + 1))
            traced(f, "fish", C, C, 803, rot, 1.0, tol=0.5, min_area=2, curve_names="Current fish")
            f.hidden_life(40, 440)
        else:
            traced(f, "fish", C, C, 735, rot, 0.55, tol=0.5, min_area=2)
            w, h = 193, 690; x0, y0 = C - w / 2, C - h / 2
            for j in range(4):
                f.poly([(x0 - j * 3, y0 - j * 3), (x0 + w + j * 3, y0 - j * 3), (x0 + w + j * 3, y0 + h + j * 3), (x0 - j * 3, y0 + h + j * 3)], hexa(235, 245, 255, 0.07), j == 0, "Threshold")
            for _ in range(2400):
                x = x0 + R.random() * w; y = y0 + R.random() ** 1.1 * h; e = min(x - x0, x0 + w - x) / (w / 2)
                f.disc(x + (R.random() - 0.5) * 6 * (1 - e), y, 0.2 + R.random() * 1.0 * (1 - e * 0.6), hexa(235, 245, 255, 0.3 + 0.5 * R.random()) if R.random() < 0.7 else prism(R.random(), 0.8))
            f.disc(C, C + 116, 2.8, hexa(14, 16, 22, 1), True, "Walker")
            f.poly([(C - 2.3, C + 119), (C + 2.3, C + 119), (C + 2.3, C + 135), (C - 2.3, C + 135)], hexa(14, 16, 22, 1))
            f.hidden_life(44, 440)
        return f
    if k == 11:
        r, dx = 257, 138
        for j, cxr in enumerate((C - dx, C + dx)):
            dd, ar = band_closed(circle_pts(cxr, C, r, 160), 3.2)
            f.add(dd, prism(0.55 + j * 0.3, 0.9), ar, True, ("Discipline", "Surrender")[j])
        made = 0
        while made < 170:
            r0 = 10 + R.random() * 240; a0 = R.random() * TAU
            pts = arc(C, C, r0, r0 * 1.9, a0, a0 + 0.5 + R.random() * 0.8, 26)
            if all(math.hypot(x - (C - dx), y - C) < r - 4 and math.hypot(x - (C + dx), y - C) < r - 4 for x, y in pts):
                f.ribbon(pts, 2.4, 0.3, hexa(220, 235, 255, 0.55) if made % 3 else prism(R.random(), 0.6), made < 20, "Flow %d" % (made + 1)); made += 1
        f.sphere(C - dx - r * 0.55, C, 16, YIN, 4, "Yin"); f.sphere(C + dx + r * 0.55, C, 14, YANG, 4, "Yang")
        f.hidden_life(50, 440)
        return f
    if k == 12:
        for i in range(520):
            r0 = 6 + R.random() ** 0.8 * 440; a0 = R.random() * TAU
            f.ribbon(arc(C, C, r0, r0, a0, a0 + 0.35 + R.random() * 0.9, 26), 2.6 * (1 - r0 / 520), 0.25,
                     hexa(215, 230, 255, 0.5) if i % 2 else prism((r0 / 440 + R.random() * 0.2) % 1, 0.55), i < 24, "Flow line %d" % (i + 1))
        f.halo(C, C, 50, (255, 255, 255), 5, 0.2)
        f.sphere(C + math.cos(a) * 42, C + math.sin(a) * 42, 9, YIN, 3, "Yin"); f.sphere(C - math.cos(a) * 42, C - math.sin(a) * 42, 8, YANG, 3, "Yang")
        f.hidden_life(60, 440)
        return f
    if k == 13:
        f.halo(C, C, 90, (200, 190, 255), 4, 0.05)
        for i in range(2600):
            arm = i % 2; t = R.random() ** 0.7; ang = a + arm * math.pi + t * 3.6 + (R.random() - 0.5) * (1.1 - t * 0.5)
            rr = 18 + t * 410
            f.disc(C + math.cos(ang) * rr, C + math.sin(ang) * rr * 0.78, 0.25 + R.random() * 1.1 * (1 - t * 0.5),
                   prism((t * 1.3 + R.random() * 0.1) % 1, 0.25 + 0.6 * (1 - t)) if arm else silver(0.25 + 0.6 * (1 - t)))
        for arm in range(2):
            f.ribbon([(C + math.cos(a + arm * math.pi + t * 3.6) * (18 + t * 410), C + math.sin(a + arm * math.pi + t * 3.6) * (18 + t * 410) * 0.78) for t in (i / 200 for i in range(201))], 26, 3, yin(0.18) if arm == 0 else prism(0.75, 0.16), True, ("Silver arm", "Prism arm")[arm])
        f.halo(C, C, 26, (255, 248, 235), 5, 0.35)
        for i in range(90):
            t = R.random(); ang = a + (i % 2) * math.pi + t * 3.6; f.micro_galaxy(C + math.cos(ang) * (28 + t * 400), C + math.sin(ang) * (28 + t * 400) * 0.78, 2 + R.random() * 5, 50)
        f.sphere(C + math.cos(a) * 21, C + math.sin(a) * 16, 7, YIN, 2, "Yin"); f.sphere(C - math.cos(a) * 21, C - math.sin(a) * 16, 6, YANG, 2, "Yang")
        return f
    if k == 14:
        pts = []
        for _ in range(300):
            an = R.random() * TAU; dd = math.sqrt(R.random()) * 420; pts.append((C + math.cos(an) * dd, C + math.sin(an) * dd))
        for i, p in enumerate(pts):
            near = sorted(((math.hypot(q[0] - p[0], q[1] - p[1]), j) for j, q in enumerate(pts) if j != i))[:3]
            for dd, j in near:
                if j < i: continue
                q = pts[j]; mx = (p[0] + q[0]) / 2 + (R.random() - 0.5) * dd * 0.5; my = (p[1] + q[1]) / 2 + (R.random() - 0.5) * dd * 0.5
                curve = [((1 - t) ** 2 * p[0] + 2 * (1 - t) * t * mx + t * t * q[0], (1 - t) ** 2 * p[1] + 2 * (1 - t) * t * my + t * t * q[1]) for t in (s / 14 for s in range(15))]
                f.ribbon(curve, 1.3, 1.3, hexa(235, 240, 250, 0.7))
        for i, (x, y) in enumerate(pts):
            f.halo(x, y, 2.2, tuple(int(c * 255) for c in colorsys.hls_to_rgb(R.random(), 0.6, 0.9)), 2, 0.25)
            f.disc(x, y, 1.6, hexa(255, 255, 255, 0.95), i < 140, "Node %d" % (i + 1))
        f.hidden_life(90, 440)
        return f
    if k == 17:
        f.dust(700, 455, lambda q, t: prism(q, 0.35), 0.25, 0.9)
        traced(f, "iflogo", C, C, 688, 0, 1.0, tol=0.45, min_area=2, curve_names="IF")
        for _ in range(500):
            an = R.random() * TAU; dd = 258 + R.random() * 175; f.micro_pair(C + math.cos(an) * dd, C + math.sin(an) * dd, 1.4 + R.random() * 3.2, R.random() * TAU)
        f.hidden_life(60, 440)
        return f
    if k == 18:
        traced(f, "iflogo", C, C, 688, 0, 0.22, tol=0.8, min_area=4)
        im = Image.open(os.path.join(HERE, "src", "iflogo.png")).convert("RGBA").resize((100, 100))
        px = im.load(); made = 0
        for y in range(100):
            for x in range(100):
                if px[x, y][3] < 90: continue
                X = C + (x / 100 - 0.5) * 688 + (R.random() - 0.5) * 2; Y = C + (y / 100 - 0.5) * 688 + (R.random() - 0.5) * 2
                ang = R.random() * TAU + x * 0.05; r = 1.2 + R.random() * 1.8
                dx, dy = math.cos(ang) * r, math.sin(ang) * r
                f.disc(X + dx, Y + dy, r * 0.32, yin(0.95), made < 70, "Pair %d yin" % (made + 1))
                f.disc(X - dx, Y - dy, r * 0.32, yang(0.95), made < 70, "Pair %d yang" % (made + 1)); made += 1
        f.hidden_life(50, 440)
        return f
    if k == 19:
        count = [0]
        def level(cx, cy, r, depth, rot):
            yinc = comma_pts(cx, cy, r, rot, 40 if depth < 2 else 24)
            f.poly(yinc, yin(0.32 + 0.08 * depth), depth <= 1, "Yin %d.%d" % (depth, count[0]))
            dd, ar = band_closed(circle_pts(cx, cy, r, 90 if depth < 2 else 40), max(0.3, r * 0.012))
            f.add(dd, prism((depth * 0.21 + rot / TAU) % 1, 0.85), ar, depth == 0, "Whole")
            count[0] += 1
            if depth >= 2 or r < 4:
                f.micro_pair(cx, cy, r * 0.45, rot); return
            level(cx + math.cos(rot + math.pi / 2) * r / 2, cy + math.sin(rot + math.pi / 2) * r / 2, r * 0.22, depth + 1, rot * 1.6 + 1)
            level(cx - math.cos(rot + math.pi / 2) * r / 2, cy - math.sin(rot + math.pi / 2) * r / 2, r * 0.22, depth + 1, -rot * 1.6 - 1)
            for j in range(6):
                an = rot + j / 6 * TAU; level(cx + math.cos(an) * r * 0.78, cy + math.sin(an) * r * 0.78, r * 0.16, depth + 1, an)
        level(C, C, 420, 0, orb(19))
        f.hidden_life(60, 440)
        return f
    raise ValueError(k)

if __name__ == "__main__":
    import sys
    frames = {}
    for k in range(1, 21):
        fr = build(k)
        cap = 2 + 8 * (k - 1)
        cs = sorted((s for s in fr.shapes if s["curve"]), key=lambda s: -s["area"])
        for s in cs[cap:]: s["curve"] = False
        frames[k] = fr.shapes
        kb = sum(len(s["d"]) for s in fr.shapes) // 1024
        print("frame", k, "shapes", len(fr.shapes), "curves", sum(1 for s in fr.shapes if s["curve"]), "KB", kb)
    json.dump(frames, open(os.path.join(HERE, "vector.json"), "w"))
