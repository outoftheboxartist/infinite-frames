"""TWOFOLD II: two dots become a double helix, then a galaxy. 24 frames, turning 15 degrees each.

Flat, each frame is two dots (later fish, bridges, a galaxy) about the centre. Stacked in 3D the
dots trace two strands that twist once around the stack, and the bridges become the rungs of DNA.

Every shape is smooth: circles are SVG arcs, other outlines are cubic curves (Catmull-Rom).
Colour starts as greys and adds the rainbow a hue at a time. Backgrounds are left empty.
Every dot holds a galaxy, which holds a galaxy, which holds a galaxy... (zoom in). Three hidden
paths lead down those nests; they are saved as places so "Take me somewhere" can follow them.

Output: helix.json = {"frames": {k: [shape...]}, "places": [...]}
shape = {"d", "color" (#rrggbbaa), "curve" (bool, becomes a selectable curve), "name"}
"""
import json, math, os, random, colorsys

HERE = os.path.dirname(os.path.abspath(__file__))
N = 24
STEP = math.radians(15)
TAU = 2 * math.pi
C = 500.0
RS = 165.0          # strand radius: where the two dots ride
RT = 2 * RS         # yin-yang (fish) radius: each dot is a fish's eye
RAINBOW = [0.0, 0.07, 0.14, 0.33, 0.5, 0.62, 0.78]


def phi(k):
    return (k - 1) * STEP


def sat(k):
    return 0.0 if k <= 5 else min(1.0, (k - 5) / 11.0)


def navail(k):
    return 0 if k <= 5 else min(7, math.ceil((k - 5) / 2.0))


def hexa(r, g, b, a=1.0):
    cl = lambda v: int(max(0, min(255, round(v))))
    a = round(a * 12) / 12 if a > 0.09 else round(a * 50) / 50
    return "#%02x%02x%02x%02x" % (cl(r), cl(g), cl(b), cl(a * 255))


def hls(h, l, s, a=1.0):
    r, g, b = colorsys.hls_to_rgb(h % 1.0, l, s)
    return hexa(r * 255, g * 255, b * 255, a)


def grey(v, a=1.0):
    v = round(v * 6) / 6
    return hexa(v * 255, v * 255, v * 255, a)


def strand_col(k, which, a=1.0):
    """strand A / B: grey and white at first, then walking the rainbow up the helix"""
    base_l = 0.93 if which == 0 else 0.56
    s = sat(k)
    if s == 0:
        return grey(base_l, a)
    h = 0.83 * (k - 6) / 18.0 + (0.5 if which else 0.0)
    return hls(h, 0.5 + 0.25 * (1 - s) + (0.12 if which == 0 else 0.0), s, a)


def palette_col(k, t, a=1.0, l=0.66):
    m = navail(k)
    if m == 0:
        return grey(0.4 + 0.55 * t, a)
    h = RAINBOW[min(m - 1, int(t * m))]
    return hls(h, l, max(0.35, sat(k)), a)


# ---------------- path writers ----------------
def dec_for(r):
    return max(1, min(6, 1 - math.floor(math.log10(max(r, 1e-9)))))


def f(v, d):
    s = ("%." + str(d) + "f") % v
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    if s.startswith("0."):
        s = s[1:]
    elif s.startswith("-0."):
        s = "-" + s[2:]
    return s if s not in ("", "-") else "0"


def circ(x, y, r):
    """exact circle from two arcs"""
    d = dec_for(r)
    R, D = f(r, d), f(2 * r, d)
    return "M%s %sa%s %s 0 1 0 %s 0a%s %s 0 1 0 -%s 0Z" % (f(x - r, d), f(y, d), R, R, D, R, R, D)


def smooth_closed(pts, d=2):
    m = len(pts)
    out = "M%s %s" % (f(pts[0][0], d), f(pts[0][1], d))
    for i in range(m):
        p0, p1, p2, p3 = pts[(i - 1) % m], pts[i], pts[(i + 1) % m], pts[(i + 2) % m]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out += "C%s %s %s %s %s %s" % tuple(f(v, d) for v in (*c1, *c2, *p2))
    return out + "Z"


def taiji(x, y, r, rot):
    """exact yin-yang: returns (comma A path, comma B path) built from arcs"""
    d = dec_for(r)
    c, s = math.cos(rot), math.sin(rot)
    P = lambda u, v: (f(x + u * c - v * s, d), f(y + u * s + v * c, d))
    R, H = f(r, d), f(r / 2, d)
    top, bot, mid = P(0, -r), P(0, r), P(0, 0)
    a = "M%s %sA%s %s 0 0 1 %s %sA%s %s 0 0 1 %s %sA%s %s 0 0 0 %s %sZ" % (*top, R, R, *bot, H, H, *mid, H, H, *top)
    b = "M%s %sA%s %s 0 0 0 %s %sA%s %s 0 0 1 %s %sA%s %s 0 0 0 %s %sZ" % (*top, R, R, *bot, H, H, *mid, H, H, *top)
    return a, b


def ribbon(path, w0, w1):
    L, Rr = [], []
    n = len(path)
    for i, (x, y) in enumerate(path):
        a = path[max(0, i - 1)]
        b = path[min(n - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        dd = math.hypot(dx, dy) or 1
        nx, ny = -dy / dd, dx / dd
        w = (w0 + (w1 - w0) * i / (n - 1)) / 2
        L.append((x + nx * w, y + ny * w))
        Rr.append((x - nx * w, y - ny * w))
    return L + Rr[::-1]


def band(loop, w):
    """closed loop thickened into an outline band (two loops; even-odd leaves the inside empty)"""
    L, Rr = [], []
    m = len(loop)
    for i in range(m):
        a, b = loop[(i - 1) % m], loop[(i + 1) % m]
        dx, dy = b[0] - a[0], b[1] - a[1]
        dd = math.hypot(dx, dy) or 1
        nx, ny = -dy / dd, dx / dd
        L.append((loop[i][0] + nx * w / 2, loop[i][1] + ny * w / 2))
        Rr.append((loop[i][0] - nx * w / 2, loop[i][1] - ny * w / 2))
    return smooth_closed(L) + smooth_closed(Rr[::-1])


def comma_pts(cx, cy, R, rot, k=72):
    pts = []
    for i in range(k + 1):
        a = -math.pi / 2 + math.pi * i / k
        pts.append((math.cos(a) * R, math.sin(a) * R))
    for i in range(1, k // 2 + 1):
        a = math.pi / 2 + math.pi * i / (k // 2)
        pts.append((math.cos(a) * R / 2, R / 2 + math.sin(a) * R / 2))
    for i in range(1, k // 2):
        a = math.pi / 2 - math.pi * i / (k // 2)
        pts.append((math.cos(a) * R / 2, -R / 2 + math.sin(a) * R / 2))
    c, s = math.cos(rot), math.sin(rot)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]


def inside(pt, poly):
    x, y = pt
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            c = not c
        j = i
    return c


def ellipse_pts(cx, cy, rx, ry, rot, k=18):
    c, s = math.cos(rot), math.sin(rot)
    return [(cx + math.cos(t) * rx * c - math.sin(t) * ry * s, cy + math.cos(t) * rx * s + math.sin(t) * ry * c)
            for t in (i / k * TAU for i in range(k))]


# ---------------- frame builder ----------------
class Frame:
    def __init__(self, k):
        self.k = k
        self.R = random.Random(7700 + k * 131)
        self.shapes = []      # big, named shapes in drawing order
        self.specks = {}      # colour -> list of small circles (merged into one path per colour)
        self.order = []

    def add(self, d, color, curve=False, name=""):
        self.flush()
        self.shapes.append({"d": d, "color": color, "curve": curve, "name": name})

    def poly(self, pts, color, curve=False, name=""):
        self.add(smooth_closed(pts), color, curve, name)

    def speck(self, x, y, r, color, raw=None):
        if color not in self.specks:
            self.specks[color] = []
            self.order.append(color)
        self.specks[color].append(raw or (x, y, r))

    def flush(self):
        """specks drawn so far go in before the next big shape, one path per colour"""
        for col in self.order:
            parts, cur, size = [], [], 0
            prev = None
            for p in self.specks[col]:
                if size > 40000:
                    parts.append(cur); cur, size, prev = [], 0, None
                if isinstance(p, str):
                    q, prev = p, None
                else:
                    x, y, r = p
                    d = dec_for(r)
                    R, D = f(r, d), f(2 * r, d)
                    sx, sy = x - r, y
                    mv = ("M%s %s" % (f(sx, d), f(sy, d))) if prev is None else ("m%s %s" % (f(sx - prev[0], d), f(sy - prev[1], d)))
                    mv = mv.replace(" -", "-")
                    q = "%sa%s %s 0 1 0 %s 0a%s %s 0 1 0-%s 0z" % (mv, R, R, D, R, R, D)
                    # keep the exact rounded start so relative moves don't drift
                    prev = (float(f(sx, d)) if prev is None else prev[0] + float(f(sx - prev[0], d)),
                            float(f(sy, d)) if prev is None else prev[1] + float(f(sy - prev[1], d)))
                cur.append(q); size += len(q)
            parts.append(cur)
            for pp in parts:
                self.shapes.append({"d": "".join(pp), "color": col, "curve": False, "name": ""})
        self.specks, self.order = {}, []

    def halo(self, x, y, r, colfn, rings, a=0.14, spread=0.5):
        for i in range(rings, 0, -1):
            self.add(circ(x, y, r * (1 + i * spread)), colfn(a / (i ** 0.85)))

    def galaxy(self, x, y, r, depth, rot, light, count, dark=False):
        """two-armed spiral of specks with a glowing core; another galaxy sits in the core.
        At the very bottom: a tiny yin-yang, the two dots again."""
        R = self.R
        for i in range(count):
            arm = i % 2
            t = R.random() ** 0.8
            ang = rot + arm * math.pi + t * 4.4 + (R.random() - 0.5) * 0.5
            rr = r * (0.12 + 0.88 * t)
            sz = r * (0.012 + 0.03 * R.random()) * (1.2 - t * 0.6)
            if dark:
                col = grey(0.12 + 0.2 * R.random(), 0.9)
            elif light == 0:
                col = grey(0.75 + 0.25 * R.random(), 0.9)
            else:
                col = palette_col(self.k, (t + arm * 0.5) % 1, 0.9) if R.random() < 0.6 else grey(0.95, 0.9)
            self.speck(x + math.cos(ang) * rr, y + math.sin(ang) * rr, sz, col)
        core = r * 0.1
        if depth > 1:
            self.speck(x, y, core * 1.25, grey(0.0 if dark else 1.0, 0.2))
            self.speck(x, y, core, grey(0.02 if dark else 1.0, 0.35))
        if depth > 1:
            self.galaxy(x, y, core * 0.85, depth - 1, rot + 1.1, light, max(24, int(count * 0.75)), dark)
        else:
            a, b = taiji(x, y, r * 0.42, rot)
            self.speck(0, 0, 0, strand_col(self.k, 0), a)
            self.speck(0, 0, 0, strand_col(self.k, 1), b)


def dots(fr, k, rd, rings, gal_depth=4):
    """the two strands' beads, each holding a nest of galaxies"""
    p = phi(k)
    out = []
    for which in (0, 1):
        a = p + math.pi * which
        x, y = C + math.cos(a) * RS, C + math.sin(a) * RS
        if rings:
            fr.halo(x, y, rd, lambda al, w=which: strand_col(k, w, al), rings)
        fr.add(circ(x, y, rd), strand_col(k, which), True, ("Strand A", "Strand B")[which] + " · %d" % k)
        fr.galaxy(x, y, rd * 0.82, gal_depth, p * 2 + which, light=0, count=52, dark=(which == 0 and sat(k) < 0.5))
        out.append((x, y))
    return out


def scatter_galaxies(fr, k, count, rmin, rmax, depth=2, avoid=()):
    R = fr.R
    made = 0
    while made < count:
        a = R.random() * TAU
        d = 40 + R.random() ** 0.6 * 420
        x, y = C + math.cos(a) * d, C + math.sin(a) * d
        if any(math.hypot(x - ax, y - ay) < ar for ax, ay, ar in avoid):
            continue
        fr.galaxy(x, y, rmin + R.random() * (rmax - rmin), depth if made % 3 == 0 else 1, R.random() * TAU, light=navail(k), count=20 + k // 2)
        made += 1


def dust(fr, k, count, rad, a=0.6, rmin=0.3, rmax=1.3):
    R = fr.R
    for _ in range(count):
        an = R.random() * TAU
        d = R.random() ** 0.55 * rad
        fr.speck(C + math.cos(an) * d, C + math.sin(an) * d, rmin + R.random() * (rmax - rmin), palette_col(k, R.random(), a * (0.4 + 0.6 * R.choice((0, .5, 1)))))


def fish_outline(fr, k, width, alpha, fill_alpha=0.0):
    """two fish: the S between them is drawn strong (it twists into a ribbon up the 3D stack);
    the round outer rim stays faint so the stack doesn't read as a tube"""
    p = phi(k)
    rot = p - math.pi / 2
    polys = []
    for which in (0, 1):
        pts = comma_pts(C, C, RT, rot + math.pi * which)
        polys.append(pts)
        if fill_alpha > 0:
            fr.poly(pts, strand_col(k, which, fill_alpha))
        fr.poly(ribbon(pts[:73], width * 0.6, width * 0.6), strand_col(k, which, alpha * 0.28))
        # the selectable curve is the whole fish; its line is drawn by the app
        fr.add(smooth_closed(pts[::2]), strand_col(k, which, 0), True, ("Yin fish", "Yang fish")[which] + " · %d" % k)
    s_curve = polys[0][72:] + [polys[0][0]]
    for which in (0, 1):
        off = (width * 0.55) * (1 if which == 0 else -1)
        fr.poly(ribbon(offset(s_curve, off), width, width), strand_col(k, which, alpha))
    return polys


def offset(path, o):
    out = []
    for i, (x, y) in enumerate(path):
        a = path[max(0, i - 1)]; b = path[min(len(path) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; dd = math.hypot(dx, dy) or 1
        out.append((x - dy / dd * o, y + dx / dd * o))
    return out


def fish_detail(fr, k, polys, level):
    """level 0..1: gills, fins, scales, currents"""
    R = fr.R
    p = phi(k)
    for which, poly in enumerate(polys):
        a = p + math.pi * which
        ex, ey = C + math.cos(a) * RS, C + math.sin(a) * RS
        # gill: an arc behind the eye
        g = [(ex + math.cos(a + math.pi + t) * 44, ey + math.sin(a + math.pi + t) * 44) for t in (i / 30 * 1.6 - 0.8 for i in range(31))]
        fr.poly(ribbon(g, 3.2, 0.8), strand_col(k, which, 0.7))
        # fins along the big outer curve, trailing the turn
        nf = 3 + int(level * 6)
        for i in range(nf):
            fa = a + math.pi / 2 + 0.25 + i * 0.13 + (which * 0)
            fx, fy = C + math.cos(fa) * (RT + 6), C + math.sin(fa) * (RT + 6)
            fr.poly(ellipse_pts(fx, fy, 26 - i * 1.5, 5, fa + 0.9), palette_col(k, i / nf, 0.55), i == 0 and level > 0.3, "Fin · %d" % k)
        # scales: small crescents inside the body, more with the level
        ns = int(level * 45)
        made = 0
        tries = 0
        while made < ns and tries < ns * 30:
            tries += 1
            sa = R.random() * TAU
            sr = R.random() ** 0.6 * (RT - 14)
            x, y = C + math.cos(sa) * sr, C + math.sin(sa) * sr
            if not inside((x, y), poly) or math.hypot(x - ex, y - ey) < 36:
                continue
            t0 = sa + math.pi / 2
            sc = 6 + R.random() * 5
            arc = [(x + math.cos(t0 + math.pi / 2 + u) * sc, y + math.sin(t0 + math.pi / 2 + u) * sc) for u in (j / 6 * 2.2 - 1.1 for j in range(7))]
            fr.poly(ribbon(arc, 0.4, 1.8), palette_col(k, R.random(), 0.55))
            made += 1


def bridge(fr, k, A, B, level, ticks=True):
    """the rung: two base halves meeting near the centre, with hydrogen-bond ticks between"""
    p = phi(k)
    ux, uy = math.cos(p), math.sin(p)
    gap = 7
    h1 = RAINBOW[(k - 16) % 7]
    h2 = (h1 + 0.5) % 1
    w = 9 + level * 5
    for which, (sx, sy), hue in ((0, A, h1), (1, B, h2)):
        sgn = 1 if which == 0 else -1
        ex, ey = C + ux * gap * sgn, C + uy * gap * sgn
        path = [(sx + (ex - sx) * t, sy + (ey - sy) * t) for t in (i / 20 for i in range(21))]
        fr.poly(ribbon(path, w, w * 0.8), hls(hue, 0.6, sat(k), 0.92), True, "Bridge · %d · %s" % (k, "AB"[which]))
        # sugar bead where the rung meets its strand
        fr.add(circ(sx - ux * sgn * 2, sy - uy * sgn * 2, w * 0.75), hls(hue, 0.8, 0.5, 0.9))
    nb = (2 + int(level * 2)) if ticks else 0
    for i in range(nb):
        off = (i - (nb - 1) / 2) * 3.2
        px, py = -uy, ux
        a1 = (C - ux * gap + px * off, C - uy * gap + py * off)
        b1 = (C + ux * gap + px * off, C + uy * gap + py * off)
        fr.poly(ribbon([a1, b1], 1.1, 1.1), grey(1, 0.8))
    if level > 0.4 and ticks:
        fr.halo(C, C, 12, lambda al: grey(1, al), 3, 0.12)


def galaxy_arms(fr, k, A, B, level):
    R = fr.R
    p = phi(k)
    b = 0.2
    n = int(1300 + level * 1500)
    for i in range(n):
        which = i % 2
        s = -7.0 + R.random() ** 0.8 * 10.5
        ang = p + math.pi * which + s
        rr = RS * math.exp(b * s)
        if rr > 470:
            continue
        spread = 2 + rr * 0.035
        x = C + math.cos(ang) * rr + R.gauss(0, spread)
        y = C + math.sin(ang) * rr + R.gauss(0, spread)
        fr.speck(x, y, 0.3 + R.random() * (1.3 - rr / 600), palette_col(k, (rr / 470 + R.random() * 0.15) % 1, R.choice((0.4, 0.65, 0.9))))
    for which in (0, 1):
        path = []
        for i in range(120):
            s = -6.5 + 9.5 * i / 119
            rr = RS * math.exp(b * s)
            ang = p + math.pi * which + s
            path.append((C + math.cos(ang) * rr, C + math.sin(ang) * rr))
        fr.poly(ribbon(path, 1.5, 10 * level + 3), strand_col(k, which, 0.05 + 0.03 * level), which == 0, "Arm %s · %d" % ("AB"[which], k))
    fr.halo(C, C, 14 + level * 16, lambda al: hls(0.12, 0.85, 0.6, al), 5, 0.07, 0.7)


def build(k):
    fr = Frame(k)
    p = phi(k)
    phase = (k - 1) // 5 if k <= 20 else 4     # 0 dots, 1 fish outline, 2 detail, 3 bridges, 4 galaxy
    t = ((k - 1) % 5) / 4.0 if k <= 20 else (k - 21) / 3.0
    if phase == 0:
        if k >= 2:
            # where the dots have been: short trails, longer each frame
            for which in (0, 1):
                a = p + math.pi * which
                tr = [(C + math.cos(a - u) * RS, C + math.sin(a - u) * RS) for u in (i / 24 * STEP * (k - 1) * 0.5 for i in range(25))]
                fr.poly(ribbon(tr, 0.6, 7), strand_col(k, which, 0.35))
        if k >= 4:
            dust(fr, k, 30 * (k - 3), 460, 0.5)
        if k >= 5:
            fr.add(band([(C + math.cos(u / 96 * TAU) * RS, C + math.sin(u / 96 * TAU) * RS) for u in range(96)], 0.8), grey(1, 0.18), False)
            scatter_galaxies(fr, k, 4, 6, 12)
        A, B = dots(fr, k, 13 + k, max(0, k - 2))
    elif phase == 1:
        dust(fr, k, 120 + 40 * (k - 5), 460)
        scatter_galaxies(fr, k, 4 + (k - 5) * 2, 6, 14, avoid=[])
        polys = fish_outline(fr, k, 2.2 + t * 1.6, 0.85)
        if k >= 8:
            fish_detail(fr, k, polys, t * 0.35)
        A, B = dots(fr, k, 19, 3 + int(t * 2))
    elif phase == 2:
        dust(fr, k, 400 + 90 * (k - 10), 465)
        scatter_galaxies(fr, k, 10 + (k - 10) * 3, 6, 16)
        polys = fish_outline(fr, k, 3.6, 0.9, 0.04 + 0.05 * t)
        fish_detail(fr, k, polys, 0.4 + 0.6 * t)
        if k == 12:
            # hidden path II starts in a galaxy tucked into the yang fish's tail
            a = p + math.pi + 2.0
            fr.galaxy(C + math.cos(a) * 250, C + math.sin(a) * 250, 10, 4, 0.7, light=navail(k), count=90)
        A, B = dots(fr, k, 20, 5)
    elif phase == 3:
        dust(fr, k, 700 + 80 * (k - 15), 465)
        scatter_galaxies(fr, k, 22 + (k - 15) * 3, 6, 16)
        polys = fish_outline(fr, k, 3.2, 0.75, 0.08 - 0.05 * t)
        fish_detail(fr, k, polys, 1.0 - 0.5 * t)
        A, B = [(C + math.cos(p + math.pi * w) * RS, C + math.sin(p + math.pi * w) * RS) for w in (0, 1)]
        bridge(fr, k, A, B, t)
        dots(fr, k, 20, 5)
    else:
        A, B = [(C + math.cos(p + math.pi * w) * RS, C + math.sin(p + math.pi * w) * RS) for w in (0, 1)]
        galaxy_arms(fr, k, A, B, t)
        fish_outline(fr, k, 2.2, 0.45 - 0.3 * t)
        bridge(fr, k, A, B, 1.0, ticks=k != 24)
        scatter_galaxies(fr, k, 26 + int(t * 14), 5, 18, depth=3)
        if k == 24:
            # hidden path III: the heart of the galaxy goes on forever
            fr.galaxy(C, C, 9, 4, p, light=7, count=110)
        dots(fr, k, 20, 6)
    fr.flush()
    return fr.shapes


def places():
    """hidden paths: each stop zooms one nest deeper. Views computed from the galaxies' sizes."""
    def stops(trail, title, frame, x, y, r0, hints):
        out = []
        r = r0
        for i, h in enumerate(hints, 1):
            out.append({"trail": trail, "step": i, "name": "%s · %d of %d" % (title, i, len(hints)), "hint": h,
                        "frame": frame, "view": {"x": x, "y": y, "z": round(min(50000, 1000 / (r * 2.6)), 2)},
                        "kind": "trail", "type": "path", "d": circ(x, y, max(r, 0.05))})
            r = r * 0.1 * 0.85
        return out
    p1 = phi(1)
    rd1 = 14
    pl = stops("I", "Secret path I", 1, C + math.cos(p1) * RS, C + math.sin(p1) * RS, rd1 * 0.82,
               ["inside the first dot", "a galaxy in its heart", "and another", "the two dots again"])
    a = phi(12) + math.pi + 2.0
    pl += stops("II", "Secret path II", 12, C + math.cos(a) * 250, C + math.sin(a) * 250, 10,
                ["in the yang fish's tail", "deeper", "deeper still", "where it begins"])
    pl += stops("III", "Secret path III", 24, C, C, 9,
                ["the heart of the galaxy", "a galaxy in the heart", "and in that heart", "two again"])
    return pl


if __name__ == "__main__":
    frames = {}
    tot = 0
    for k in range(1, N + 1):
        sh = build(k)
        frames[k] = sh
        kb = sum(len(s["d"]) for s in sh) / 1024
        tot += kb
        print("frame %2d  shapes %4d  curves %2d  %6.0f KB" % (k, len(sh), sum(s["curve"] for s in sh), kb))
    print("total %.0f KB" % tot)
    json.dump({"frames": frames, "places": places()}, open(os.path.join(HERE, "helix.json"), "w"))
