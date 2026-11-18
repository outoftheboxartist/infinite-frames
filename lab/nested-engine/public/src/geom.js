// Shape geometry shared by the renderer, hit testing, the seed generator and
// the server. DOM-free so it runs in Node tests.
//
// A node's shape is one or more closed rings stored in a flat array `pts`
// ([x0, y0, x1, y1, ...]) in the node's local coordinates. `rings` (optional)
// lists how many points each ring has; without it the whole array is one ring.
// `smooth: true` means the points are control points of a closed Catmull-Rom
// curve (hand-drawn curves); otherwise they are polygon vertices (imported SVG
// paths are flattened into these).

import { apply } from "./mat.js";

export function ringSpans(node) {
  const n = node.pts.length >> 1;
  if (!node.rings || !node.rings.length) return [[0, n]];
  const out = [];
  let at = 0;
  for (const len of node.rings) {
    if (len > 0 && at + len <= n) out.push([at, len]);
    at += len;
  }
  return out.length ? out : [[0, n]];
}

// Closed Catmull-Rom ring -> cubic bezier segments [x0,y0,c1x,c1y,c2x,c2y,x1,y1]
export function bezierRing(pts, start, len) {
  const segs = [];
  const P = (i) => {
    const k = start + ((i % len) + len) % len;
    return [pts[2 * k], pts[2 * k + 1]];
  };
  for (let i = 0; i < len; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    segs.push([
      p1[0], p1[1],
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1],
    ]);
  }
  return segs;
}

function cubicAt(s, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * s[0] + b * s[2] + c * s[4] + d * s[6], a * s[1] + b * s[3] + c * s[5] + d * s[7]];
}

// Flattened local polygon rings, cached on the node (used for hit tests,
// bounds and containment). Smooth rings use 8 samples per segment.
export function localPoly(node) {
  if (node._poly && node._polyOf === node.pts) return node._poly;
  const rings = [];
  for (const [start, len] of ringSpans(node)) {
    if (node.smooth && len >= 3) {
      const out = [];
      for (const s of bezierRing(node.pts, start, len)) {
        for (let k = 0; k < 8; k++) {
          const p = cubicAt(s, k / 8);
          out.push(p[0], p[1]);
        }
      }
      rings.push(out);
    } else {
      rings.push(node.pts.slice(2 * start, 2 * (start + len)));
    }
  }
  node._poly = rings;
  node._polyOf = node.pts;
  node._bb = null;
  return rings;
}

// Local bounds [minx, miny, maxx, maxy], cached.
export function localBounds(node) {
  localPoly(node);
  if (node._bb) return node._bb;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of node._poly) {
    for (let i = 0; i < r.length; i += 2) {
      const x = r[i], y = r[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (!(x1 >= x0)) { x0 = y0 = -1; x1 = y1 = 1; }
  // Catmull-Rom curves can bulge slightly past their samples.
  const pad = node.smooth ? 0.02 * Math.max(x1 - x0, y1 - y0) : 0;
  node._bb = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  node._cx = (node._bb[0] + node._bb[2]) / 2;
  node._cy = (node._bb[1] + node._bb[3]) / 2;
  node._hr = Math.hypot(node._bb[2] - node._bb[0], node._bb[3] - node._bb[1]) / 2;
  return node._bb;
}

// Winding / even-odd point-in-shape test in local coordinates.
export function containsLocal(node, x, y) {
  const bb = localBounds(node);
  if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) return false;
  const evenodd = node.rule === "evenodd";
  let wind = 0, crossings = 0;
  for (const r of node._poly) {
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if ((yi > y) !== (yj > y)) {
        const xc = xj + ((y - yj) * (xi - xj)) / (yi - yj);
        if (x < xc) { crossings++; wind += yi > yj ? 1 : -1; }
      }
    }
  }
  return evenodd ? (crossings & 1) === 1 : wind !== 0;
}

// --- Huge-node drawing support -------------------------------------------
// When a shape is thousands of pixels across (you're zoomed deep inside it),
// handing canvas giant coordinates causes jitter and slow rasterization. We
// instead flatten it in screen space with float64, subdividing only the parts
// that cross the viewport, then clip it to the viewport.

function flattenCubicScreen(s, out, view, depth) {
  // s is in screen space. Cull or accept flat segments.
  let x0 = Math.min(s[0], s[2], s[4], s[6]), x1 = Math.max(s[0], s[2], s[4], s[6]);
  let y0 = Math.min(s[1], s[3], s[5], s[7]), y1 = Math.max(s[1], s[3], s[5], s[7]);
  const offscreen = x1 < view[0] || x0 > view[2] || y1 < view[1] || y0 > view[3];
  if (offscreen || depth > 28) { out.push(s[6], s[7]); return; }
  // flatness: distance of control points from chord
  const dx = s[6] - s[0], dy = s[7] - s[1];
  const L = Math.hypot(dx, dy) || 1e-9;
  const d1 = Math.abs((s[2] - s[0]) * dy - (s[3] - s[1]) * dx) / L;
  const d2 = Math.abs((s[4] - s[0]) * dy - (s[5] - s[1]) * dx) / L;
  if (d1 + d2 < 0.3 && L < 4000) { out.push(s[6], s[7]); return; }
  // de Casteljau split at 0.5
  const m01x = (s[0] + s[2]) / 2, m01y = (s[1] + s[3]) / 2;
  const m12x = (s[2] + s[4]) / 2, m12y = (s[3] + s[5]) / 2;
  const m23x = (s[4] + s[6]) / 2, m23y = (s[5] + s[7]) / 2;
  const ax = (m01x + m12x) / 2, ay = (m01y + m12y) / 2;
  const bx = (m12x + m23x) / 2, by = (m12y + m23y) / 2;
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  flattenCubicScreen([s[0], s[1], m01x, m01y, ax, ay, cx, cy], out, view, depth + 1);
  flattenCubicScreen([cx, cy, bx, by, m23x, m23y, s[6], s[7]], out, view, depth + 1);
}

function clipEdge(poly, inside, cross) {
  const out = [];
  const n = poly.length >> 1;
  for (let i = 0; i < n; i++) {
    const ax = poly[2 * ((i + n - 1) % n)], ay = poly[2 * ((i + n - 1) % n) + 1];
    const bx = poly[2 * i], by = poly[2 * i + 1];
    const ain = inside(ax, ay), bin = inside(bx, by);
    if (bin) {
      if (!ain) out.push(...cross(ax, ay, bx, by));
      out.push(bx, by);
    } else if (ain) out.push(...cross(ax, ay, bx, by));
  }
  return out;
}

// Sutherland-Hodgman against an axis-aligned rect. Correct for filling
// (concave shapes get zero-area seams along the border, which don't render).
export function clipToRect(poly, r) {
  let p = poly;
  const [x0, y0, x1, y1] = r;
  p = clipEdge(p, (x) => x >= x0, (ax, ay, bx, by) => [x0, ay + ((x0 - ax) * (by - ay)) / (bx - ax)]); if (!p.length) return p;
  p = clipEdge(p, (x) => x <= x1, (ax, ay, bx, by) => [x1, ay + ((x1 - ax) * (by - ay)) / (bx - ax)]); if (!p.length) return p;
  p = clipEdge(p, (x, y) => y >= y0, (ax, ay, bx, by) => [ax + ((y0 - ay) * (bx - ax)) / (by - ay), y0]); if (!p.length) return p;
  p = clipEdge(p, (x, y) => y <= y1, (ax, ay, bx, by) => [ax + ((y1 - ay) * (bx - ax)) / (by - ay), y1]);
  return p;
}

// Screen-space rings for a huge node, flattened adaptively and clipped.
export function screenRings(node, m, view) {
  const rings = [];
  for (const [start, len] of ringSpans(node)) {
    let poly;
    if (node.smooth && len >= 3) {
      poly = [];
      const segs = bezierRing(node.pts, start, len);
      const first = apply(m, segs[0][0], segs[0][1]);
      poly.push(first[0], first[1]);
      for (const s of segs) {
        const a = apply(m, s[0], s[1]), b = apply(m, s[2], s[3]), c = apply(m, s[4], s[5]), d = apply(m, s[6], s[7]);
        flattenCubicScreen([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], poly, view, 0);
      }
      poly.length -= 2; // last point repeats the first
    } else {
      poly = new Array(len * 2);
      for (let i = 0; i < len; i++) {
        const p = apply(m, node.pts[2 * (start + i)], node.pts[2 * (start + i) + 1]);
        poly[2 * i] = p[0]; poly[2 * i + 1] = p[1];
      }
    }
    const clipped = clipToRect(poly, view);
    if (clipped.length >= 6) rings.push(clipped);
  }
  return rings;
}

// --- Authoring helpers ------------------------------------------------------

// Ramer-Douglas-Peucker on an open polyline [x,y,...]
export function simplify(pts, tol) {
  const n = pts.length >> 1;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b], by = pts[2 * b + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      // closed loops start and end on the same point: measure from that point
      const d = L < 1e-12
        ? Math.hypot(pts[2 * i] - ax, pts[2 * i + 1] - ay)
        : Math.abs((pts[2 * i] - ax) * dy - (pts[2 * i + 1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

// Re-center points on their bounds center and scale to unit radius.
// Returns { pts, x, y, s } so that original = (x, y) + s * pts.
export function normalize(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let r = 0;
  for (let i = 0; i < pts.length; i += 2) r = Math.max(r, Math.hypot(pts[i] - cx, pts[i + 1] - cy));
  r = r || 1;
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = round4((pts[i] - cx) / r);
    out[i + 1] = round4((pts[i + 1] - cy) / r);
  }
  return { pts: out, x: cx, y: cy, s: r };
}

export function round4(v) {
  return Math.round(v * 1e4) / 1e4;
}

export function invalidateShape(node) {
  node._poly = null; node._polyOf = null; node._bb = null; node._path = null;
}
