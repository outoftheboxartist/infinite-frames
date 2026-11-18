/* Infinite Frames canvas engine for the original app's 2D view.
   Transplanted from lab/nested-engine (see lab/nested-engine/ARCHITECTURE.md).

   What it replaces: the 2D canvas used to be one big React-rendered <svg>
   (art() via prismWrap) rebuilt on every pan/zoom step, and zoom stopped at
   256x. The <svg> element is still there, empty, for pointer events. This
   engine draws the same picture (windows, clipping, frame items, onion ghosts,
   drafts, selection, live stroke) into a <canvas> behind it.

   How it stays smooth and precise:
   - The view is owned here and redrawn on the next animation frame. React
     only hears about it a few times a second (HUD readouts, viewport loading).
   - Every SVG path is parsed once and stored relative to its own center, so
     the numbers the GPU sees stay small at any zoom (no float32 jitter).
   - Shapes much bigger than the screen are flattened and clipped to the
     screen in float64 before drawing, so their edges stay exact.
   - Anything off screen or under half a pixel is skipped.
   Data format, publishing, frames, chat, profiles, uploads and 3D are untouched. */
(function (root) {
  "use strict";
  const MAXZ = 1e8;           // deepest zoom (was 256). float64 world coords hold ~1e11.
  const HUGE_PX = 4000;       // above this on-screen size, draw via screen-space clipping
  const SYNC_MS = 160;        // React hears about view changes this long after they stop
  const MIN_PX = 0.75;        // skip anything smaller than this on screen
  const CLIP_PX = 16;         // smaller than this, clipping can't visibly change it: skip the clip
  const TILES = true;         // map-style tile cache for settled content
  const TILE = 256;           // tile side in device pixels
  const TILE_BUDGET_MS = 6;   // per frame, spent painting tiles
  const MAX_TILES = 160;      // ~42 MB of tiles at most

  // ---------- affine matrices [a,b,c,d,e,f] (canvas order) ----------
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const tr = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const T = (x, y) => [1, 0, 0, 1, x, y];
  const inv = (m) => {
    const det = m[0] * m[3] - m[1] * m[2], a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  };

  // SVG item transform used by art(): translate(t.x,t.y) translate(cx,cy) rotate(r) scale(s) translate(-cx,-cy)
  function itemMatrix(f) {
    if (!f || !f.t) return null;
    const t = f.t, cx = f.cx || 0, cy = f.cy || 0, a = ((t.r || 0) * Math.PI) / 180, s = t.s == null ? 1 : t.s;
    const c = Math.cos(a) * s, n = Math.sin(a) * s;
    return [c, n, -n, c, (t.x || 0) + cx - (c * cx - n * cy), (t.y || 0) + cy - (n * cx + c * cy)];
  }

  // ---------- SVG path parsing -> subpaths of lines/cubics (float64) ----------
  const TOK = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
  function parse(d) {
    const tk = String(d || "").match(TOK) || [];
    const subs = [];
    let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, cur = null, lc = null, lq = null;
    const num = () => +tk[i++];
    const isNum = () => i < tk.length && !/[A-Za-z]/.test(tk[i]);
    const start = (px, py) => { cur = { x: px, y: py, segs: [], closed: false }; subs.push(cur); sx = px; sy = py; };
    const ensure = () => { if (!cur) start(x, y); };
    while (i < tk.length) {
      if (/[A-Za-z]/.test(tk[i])) cmd = tk[i++];
      const rel = cmd >= "a", C = cmd.toUpperCase();
      if (C === "Z") { if (cur) { cur.closed = true; cur = null; } x = sx; y = sy; lc = lq = null; continue; }
      if (!isNum()) { i++; continue; }
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === "M") { x = ox + num(); y = oy + num(); start(x, y); cmd = rel ? "l" : "L"; lc = lq = null; continue; }
      ensure();
      if (C === "L") { x = ox + num(); y = oy + num(); cur.segs.push([x, y]); lc = lq = null; }
      else if (C === "H") { x = ox + num(); cur.segs.push([x, y]); lc = lq = null; }
      else if (C === "V") { y = oy + num(); cur.segs.push([x, y]); lc = lq = null; }
      else if (C === "C" || C === "S") {
        let x1, y1;
        if (C === "C") { x1 = ox + num(); y1 = oy + num(); } else if (lc) { x1 = 2 * x - lc[0]; y1 = 2 * y - lc[1]; } else { x1 = x; y1 = y; }
        const x2 = ox + num(), y2 = oy + num(), ex = ox + num(), ey = oy + num();
        cur.segs.push([x1, y1, x2, y2, ex, ey]); lc = [x2, y2]; lq = null; x = ex; y = ey;
      } else if (C === "Q" || C === "T") {
        let qx, qy;
        if (C === "Q") { qx = ox + num(); qy = oy + num(); } else if (lq) { qx = 2 * x - lq[0]; qy = 2 * y - lq[1]; } else { qx = x; qy = y; }
        const ex = ox + num(), ey = oy + num();
        cur.segs.push([x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
        lq = [qx, qy]; lc = null; x = ex; y = ey;
      } else if (C === "A") {
        const rx = num(), ry = num(), rot = num(), fa = num(), fs = num(), ex = ox + num(), ey = oy + num();
        arc(cur.segs, x, y, rx, ry, rot, fa, fs, ex, ey); x = ex; y = ey; lc = lq = null;
      } else i++;
    }
    return subs;
  }

  // SVG endpoint arc -> cubic segments (<= 90 degrees each)
  function arc(out, x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry || (x1 === x2 && y1 === y2)) { out.push([x2, y2]); return; }
    const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    let co = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
    if (fa === fs) co = -co;
    const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
    const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
    const P = (t) => [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp];
    const D = (t) => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp];
    for (let j = 0; j < n; j++) {
      const a = t1 + j * step, b = a + step, pa = P(a), pb = P(b), da = D(a), db = D(b);
      out.push([pa[0] + k * da[0], pa[1] + k * da[1], pb[0] - k * db[0], pb[1] - k * db[1], pb[0], pb[1]]);
    }
  }

  // ---------- shapes: parsed once, stored relative to their own center ----------
  const shapes = new Map();
  function shape(d) {
    let e = shapes.get(d);
    if (e) return e;
    const subs = parse(d);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const s of subs) { grow(s.x, s.y); for (const g of s.segs) for (let k = 0; k < g.length; k += 2) grow(g[k], g[k + 1]); }
    if (!(x1 >= x0)) { x0 = y0 = x1 = y1 = 0; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const path = typeof Path2D !== "undefined" ? new Path2D() : null;
    if (path) {
      for (const s of subs) {
        path.moveTo(s.x - cx, s.y - cy);
        for (const g of s.segs) g.length === 2 ? path.lineTo(g[0] - cx, g[1] - cy) : path.bezierCurveTo(g[0] - cx, g[1] - cy, g[2] - cx, g[3] - cy, g[4] - cx, g[5] - cy);
        if (s.closed) path.closePath();
      }
    }
    e = { subs, cx, cy, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2, size: Math.max(x1 - x0, y1 - y0), path };
    shapes.set(d, e);
    if (shapes.size > 30000) shapes.delete(shapes.keys().next().value);
    return e;
  }

  // ---------- screen-space path for shapes far bigger than the screen ----------
  function flatten(s, out, v, depth) {
    const x0 = Math.min(s[0], s[2], s[4], s[6]), x1 = Math.max(s[0], s[2], s[4], s[6]);
    const y0 = Math.min(s[1], s[3], s[5], s[7]), y1 = Math.max(s[1], s[3], s[5], s[7]);
    if (x1 < v[0] || x0 > v[2] || y1 < v[1] || y0 > v[3] || depth > 28) { out.push(s[6], s[7]); return; }
    const dx = s[6] - s[0], dy = s[7] - s[1], L = Math.hypot(dx, dy) || 1e-9;
    const f = (Math.abs((s[2] - s[0]) * dy - (s[3] - s[1]) * dx) + Math.abs((s[4] - s[0]) * dy - (s[5] - s[1]) * dx)) / L;
    if (f < 0.3 && L < 4000) { out.push(s[6], s[7]); return; }
    const a = [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2], b = [(s[2] + s[4]) / 2, (s[3] + s[5]) / 2], c = [(s[4] + s[6]) / 2, (s[5] + s[7]) / 2];
    const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], m = [(ab[0] + bc[0]) / 2, (ab[1] + bc[1]) / 2];
    flatten([s[0], s[1], a[0], a[1], ab[0], ab[1], m[0], m[1]], out, v, depth + 1);
    flatten([m[0], m[1], bc[0], bc[1], c[0], c[1], s[6], s[7]], out, v, depth + 1);
  }
  function clipEdge(p, inside, cross) {
    const out = [], n = p.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + n - 1) % n, ax = p[2 * j], ay = p[2 * j + 1], bx = p[2 * i], by = p[2 * i + 1];
      const ai = inside(ax, ay), bi = inside(bx, by);
      if (bi) { if (!ai) out.push(...cross(ax, ay, bx, by)); out.push(bx, by); } else if (ai) out.push(...cross(ax, ay, bx, by));
    }
    return out;
  }
  function clipRect(p, r) {
    p = clipEdge(p, (x) => x >= r[0], (ax, ay, bx, by) => [r[0], ay + ((r[0] - ax) * (by - ay)) / (bx - ax)]); if (!p.length) return p;
    p = clipEdge(p, (x) => x <= r[2], (ax, ay, bx, by) => [r[2], ay + ((r[2] - ax) * (by - ay)) / (bx - ax)]); if (!p.length) return p;
    p = clipEdge(p, (x, y) => y >= r[1], (ax, ay, bx, by) => [ax + ((r[1] - ay) * (bx - ax)) / (by - ay), r[1]]); if (!p.length) return p;
    return clipEdge(p, (x, y) => y <= r[3], (ax, ay, bx, by) => [ax + ((r[3] - ay) * (bx - ax)) / (by - ay), r[3]]);
  }
  function screenPath(e, M, v) {
    const out = new Path2D();
    let any = false;
    for (const s of e.subs) {
      let prev = tr(M, s.x - e.cx, s.y - e.cy);
      const poly = [prev[0], prev[1]];
      for (const g of s.segs) {
        if (g.length === 2) { prev = tr(M, g[0] - e.cx, g[1] - e.cy); poly.push(prev[0], prev[1]); continue; }
        const c1 = tr(M, g[0] - e.cx, g[1] - e.cy), c2 = tr(M, g[2] - e.cx, g[3] - e.cy), p2 = tr(M, g[4] - e.cx, g[5] - e.cy);
        flatten([prev[0], prev[1], c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]], poly, v, 0);
        prev = p2;
      }
      const ring = s.closed ? clipRect(poly, v) : poly;
      if (ring.length < 4) continue;
      out.moveTo(ring[0], ring[1]);
      for (let k = 2; k < ring.length; k += 2) out.lineTo(ring[k], ring[k + 1]);
      if (s.closed) out.closePath();
      any = true;
    }
    return any ? out : null;
  }

  const sizes = new WeakMap();
  function itemSize(p) {
    let v = sizes.get(p);
    if (v === undefined) {
      if (p.type === "image") v = Math.max(p.w || 0, p.h || 0);
      else if (p.type === "vector") { v = 0; for (const q of p.paths || []) v = Math.max(v, shape(q.d).size); if (p.sourceRect) v = Math.max(v, p.sourceRect.w, p.sourceRect.h); }
      else v = shape(p.d).size + (p.w || 0);
      sizes.set(p, v);
    }
    return v;
  }

  // ---------- the engine ----------
  class IFEngine {
    constructor(comp, canvas) {
      this.comp = comp;
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.view = comp.state.view;
      this.ours = new WeakSet([this.view]);
      this.images = new Map();
      this.stats = { ms: 0, shapes: 0, items: 0, frames: 0 };
      this.raf = 0;
      this.syncT = 0;
      this.tiles = new Map(); this.queue = []; this.queued = new Map(); this.gen = 0; this.sig = null; this.L = null;
      this.hitCtx = document.createElement("canvas").getContext("2d");
      this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.kick()) : null;
      this.ro && this.ro.observe(canvas);
      setDigits(this.view.z);
      this.kick();
    }
    destroy() { cancelAnimationFrame(this.raf); clearTimeout(this.syncT); this.ro && this.ro.disconnect(); }

    byIdFor(comp) {
      const B = comp.state.B, D = comp.state.drafts;
      if (this._byB !== B || this._byD !== D) {
        const m = new Map();
        for (const b of comp.allB()) m.set(b.id, b);
        this._byB = B; this._byD = D; this._byId = m;
      }
      return this._byId;
    }

    // React may hand us a new <canvas> element (e.g. after a layout change).
    setCanvas(canvas) {
      this.ro && this.ro.disconnect();
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.ro && this.ro.observe(canvas);
      this.kick();
    }

    // setView() calls this after writing comp.state.view
    viewChanged(v) {
      this.view = v;
      this.ours.add(v);
      setDigits(v.z);
      this.kick();
      // Re-rendering the whole app costs tens of ms, so React (HUD readouts,
      // viewport loading) hears about the view once it settles, not mid-gesture.
      clearTimeout(this.syncT);
      this.syncT = setTimeout(() => { this.syncT = 0; this.comp.setState({ view: this.view }); }, SYNC_MS);
      if (this.comp.state.streaming && this.comp.scheduleViewportLoad) this.comp.scheduleViewportLoad();
    }

    // after React updates: adopt deliberate outside view changes (e.g. leaving
    // 3D resets the view); re-assert ours if React handed back an older one.
    afterUpdate() {
      const v = this.comp.state.view;
      if (v !== this.view) {
        if (this.ours.has(v)) this.comp.state.view = this.view;
        else { this.view = v; this.ours.add(v); setDigits(v.z); }
      }
      this.kick();
    }

    kick() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }

    // world -> CSS-pixel screen matrix (same letterboxing as the old SVG viewBox)
    viewMatrix(W, H) {
      const v = this.view, sc = Math.min(W, H) * v.z / 1e3, r = v.r || 0;
      const c = Math.cos(r) * sc, s = Math.sin(r) * sc;
      return [c, s, -s, c, W / 2 - (c * v.x - s * v.y), H / 2 - (s * v.x + c * v.y)];
    }

    // ---------- navigation (same feel as lab/nested-engine) ----------
    // Drag at any zoom, glide after release, pinch/scroll zoom toward the
    // fingers/cursor, two-finger rotate (eases back upright at whole canvas).
    // Zooming out past the whole canvas still feeds the 3D "pull" as before.
    dims() { return [this.canvas.clientWidth || 1, this.canvas.clientHeight || 1]; }
    local(cx, cy) { const r = this.canvas.getBoundingClientRect(); return [cx - r.left, cy - r.top]; }
    toWorld(cx, cy) {
      const [W, H] = this.dims(), p = this.local(cx, cy), q = tr(inv(this.viewMatrix(W, H)), p[0], p[1]);
      return { x: q[0], y: q[1] };
    }
    setV(x, y, z, r) { this.comp.setView({ x, y, z, r }); }
    panScreen(dx, dy) {
      const v = this.view, [W, H] = this.dims(), sc = Math.min(W, H) * v.z / 1e3, c = Math.cos(v.r || 0), s = Math.sin(v.r || 0);
      this.setV(v.x - (c * dx + s * dy) / sc, v.y - (-s * dx + c * dy) / sc, v.z, v.r || 0);
    }
    zoomAt(f, sx, sy, dr = 0) {
      const comp = this.comp, st = comp.state;
      if (st.mode !== "2d" || !(f > 0)) return;
      if (f < 1 && this.view.z <= 1.001) { comp.addPull((1 - f) * 4.5); return; }
      if (f > 1 && st.pull > 0) { comp.setState({ pull: Math.max(0, st.pull - (f - 1) * 1.6) }); return; }
      const [W, H] = this.dims(), q = tr(inv(this.viewMatrix(W, H)), sx, sy), v = this.view;
      const z = Math.max(1, Math.min(MAXZ, v.z * f)), r = (v.r || 0) + dr;
      const sc = Math.min(W, H) * z / 1e3, c = Math.cos(r), s = Math.sin(r), dx = sx - W / 2, dy = sy - H / 2;
      this.setV(q[0] - (c * dx + s * dy) / sc, q[1] - (-s * dx + c * dy) / sc, z, r);
    }
    stop() { this.vel = null; this.zoomQ = 0; this.samples = []; }
    dragMove(e, drag) {
      if (!drag.moved) return; // the first move past the 5 px threshold catches up from the start point
      const lx = drag.lx ?? drag.sx, ly = drag.ly ?? drag.sy, dx = e.clientX - lx, dy = e.clientY - ly;
      drag.lx = e.clientX; drag.ly = e.clientY;
      this.panScreen(dx, dy);
      const t = performance.now();
      (this.samples || (this.samples = [])).push([t, dx, dy]);
      while (this.samples.length && t - this.samples[0][0] > 100) this.samples.shift();
    }
    pinch(a, b, p) {
      const A = this.local(a.x, a.y), B = this.local(b.x, b.y);
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, d = Math.hypot(A[0] - B[0], A[1] - B[1]), ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
      this.vel = null;
      if (p.mx == null) { Object.assign(p, { mx, my, d, ang }); return; }
      this.panScreen(mx - p.mx, my - p.my);
      let da = ang - p.ang;
      if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      this.zoomAt(d / (p.d || d), mx, my, da);
      Object.assign(p, { mx, my, d, ang });
    }
    release(drag, comp) {
      const s = this.samples || [];
      this.samples = [];
      if (!drag || !drag.moved || comp.pinch || comp.adj || comp.state.live) return;
      const t = performance.now();
      if (!s.length || t - s[s.length - 1][0] > 90) return;
      const span = Math.max(16, t - s[0][0]) / 1000;
      let dx = 0, dy = 0; for (const q of s) { dx += q[1]; dy += q[2]; }
      const vx = dx / span, vy = dy / span;
      if (Math.hypot(vx, vy) > 60) { this.vel = [vx, vy]; this.kick(); }
    }
    wheel(e) {
      const p = this.local(e.clientX, e.clientY);
      this.vel = null;
      this.zoomQ = (this.zoomQ || 0) - Math.max(-60, Math.min(60, e.deltaY)) * 0.0022 * (e.ctrlKey ? 2.5 : 1);
      this.zf = p;
      this.kick();
    }
    // per-frame motion: glide, smoothed wheel zoom, ease rotation upright at whole canvas
    tick() {
      const now = performance.now(), dt = Math.min(0.05, (now - (this.lastTick || now)) / 1000);
      this.lastTick = now;
      let moving = false;
      if (this.vel && !this.comp.ptrs.size) {
        this.panScreen(this.vel[0] * dt, this.vel[1] * dt);
        const k = Math.exp(-dt * 5); this.vel[0] *= k; this.vel[1] *= k;
        if (Math.hypot(this.vel[0], this.vel[1]) < 10) this.vel = null; else moving = true;
      }
      if (Math.abs(this.zoomQ || 0) > 1e-4) {
        const step = this.zoomQ * (1 - Math.exp(-dt * 16));
        this.zoomQ -= step;
        this.zoomAt(Math.exp(step), this.zf[0], this.zf[1]);
        moving = true;
      } else this.zoomQ = 0;
      const r = this.view.r || 0;
      if (r && this.view.z <= 1.001 && this.comp.ptrs.size < 2) {
        const nr = Math.abs(r) < 0.002 ? 0 : r * Math.exp(-dt * 6);
        this.setV(this.view.x, this.view.y, this.view.z, nr);
        moving = moving || nr !== 0;
      }
      return moving;
    }

    hit(b, p) {
      const e = shape(b.d);
      if (!e.path) return false;
      return this.hitCtx.isPointInPath(e.path, p.x - e.cx, p.y - e.cy, "evenodd");
    }

    image(src) {
      let im = this.images.get(src);
      if (!im) {
        im = new Image();
        im.decoding = "async";
        im.onload = () => this.kick();
        im.src = src;
        this.images.set(src, im);
        if (this.images.size > 300) this.images.delete(this.images.keys().next().value);
      }
      return im.complete && im.naturalWidth ? im : null;
    }

    draw() {
      const moving = this.tick();
      const t0 = performance.now();
      const comp = this.comp, s = comp.state, canvas = this.canvas, ctx = this.ctx;
      if (s.view !== this.view && this.ours.has(s.view)) s.view = this.view;
      const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (s.mode !== "2d") return;
      const V = this.viewMatrix(W, H);
      const tiled = TILES && IFEngine.tilesOn !== false && this.drawTiles(ctx, V, W, H, dpr);
      const F = this.scene(ctx, V, W, H, dpr, { frame: s.viewing, live: true, overlay: tiled });
      const drawMs = performance.now() - t0;
      const built = this.buildTiles(TILE_BUDGET_MS);
      this.stats = { ms: drawMs, shapes: F.shapes, items: F.items, frames: this.stats.frames + 1, z: this.view.z, tiled, tiles: this.tiles.size, built };
      if (F.animated || moving || this.queue.length) this.kick(); // GIFs, glides and unfinished tiles keep drawing
      else if (this.view.z < 1.3) this.warmLayers();
    }

    // Near the whole canvas the 3D box is one pinch away: paint its frame
    // layers ahead of time, one per idle moment, so the swap has nothing to do.
    warmLayers() {
      if (this._warm) return;
      const idle = root.requestIdleCallback || ((fn) => setTimeout(fn, 60));
      this._warm = idle(() => {
        this._warm = 0;
        const s = this.comp.state;
        if (s.mode !== "2d" || this.view.z >= 1.3) return;
        for (let f = 0; f < s.frames.length; f++) {
          const fr = s.frames[f], hit = this._layers && this._layers.get(fr.items);
          if (hit && hit.B === s.B && hit.f0 === (f === 0)) continue;
          if (s.framePreviews && s.framePreviews[fr.n]) continue;
          this.layer(f);
          this.warmLayers();
          return;
        }
      });
    }

    // ---------- map-style tile cache (from lab/nested-engine) ----------
    // Settled content (windows, published items, onion ghosts) is painted once
    // into 256 px tiles per zoom level and reused while you pan and zoom. Only
    // what changes (selection, drafts, the live stroke, GIFs) is drawn live on
    // top. A tile that isn't ready yet is covered by a stretched piece of a
    // coarser level; if nothing covers the view yet, the frame is drawn live.
    contentSig() {
      const s = this.comp.state, f = s.frames;
      return [s.B, f, s.viewing, s.onion, s.ghosts, s.tr, ...f.map((x) => x.items)];
    }
    drawTiles(ctx, V, W, H, dpr) {
      const s = this.comp.state, sig = this.contentSig();
      if (!this.sig || sig.length !== this.sig.length || sig.some((x, i) => x !== this.sig[i])) { this.sig = sig; this.gen++; this.queue = []; }
      const sc = scaleOf(V) * dpr, want = Math.log2(sc);
      this.screenDensity = sc;
      if (this.L == null || want > this.L + 0.35 || want < this.L - 1.1) this.L = Math.ceil(want - 0.35);
      const L = this.L, k = 2 ** L, w = TILE / k;
      const iv = inv(V), cs = [tr(iv, 0, 0), tr(iv, W, 0), tr(iv, 0, H), tr(iv, W, H)];
      const x0 = Math.min(...cs.map((q) => q[0])), x1 = Math.max(...cs.map((q) => q[0])), y0 = Math.min(...cs.map((q) => q[1])), y1 = Math.max(...cs.map((q) => q[1]));
      const i0 = Math.floor(x0 / w), i1 = Math.floor(x1 / w), j0 = Math.floor(y0 / w), j1 = Math.floor(y1 / w);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 80) return false;
      const now = performance.now(), plan = [];
      let covered = true;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const key = s.viewing + "/" + L + "/" + i + "/" + j;
        const t = this.tiles.get(key);
        if (!t || t.gen !== this.gen) this.request(key, s.viewing, L, i, j);
        if (t) { plan.push([t, L, i, j, null]); continue; }
        // stretch a piece of the nearest finished coarser tile
        let fb = null;
        for (let L2 = L - 1; L2 >= L - 8 && !fb; L2--) {
          const k2 = 2 ** L2, w2 = TILE / k2, t2 = this.tiles.get(s.viewing + "/" + L2 + "/" + Math.floor((i * w + w / 2) / w2) + "/" + Math.floor((j * w + w / 2) / w2));
          if (t2) fb = [t2, L2];
        }
        if (fb) plan.push([fb[0], L, i, j, fb[1]]); else covered = false;
      }
      if (!covered) return false;
      ctx.imageSmoothingEnabled = true;
      for (const [t, L1, i, j, Lsrc] of plan) {
        t.used = now;
        const M = mul(V, [1 / k, 0, 0, 1 / k, i * w - 1 / k, j * w - 1 / k]);
        ctx.setTransform(dpr * M[0], dpr * M[1], dpr * M[2], dpr * M[3], dpr * M[4], dpr * M[5]);
        if (Lsrc == null) ctx.drawImage(t.canvas, 0, 0);
        else {
          const k2 = 2 ** Lsrc, w2 = TILE / k2, ti = Math.floor(t.i), tj = Math.floor(t.j);
          const sx = (i * w - ti * w2) * k2 + 1, sy = (j * w - tj * w2) * k2 + 1, sw = TILE * k2 / k;
          ctx.drawImage(t.canvas, sx, sy, sw, sw, 1, 1, TILE, TILE);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return true;
    }
    request(key, frame, L, i, j) {
      if (this.queued.has(key) && this.queued.get(key) === this.gen) return;
      this.queued.set(key, this.gen);
      this.queue.push({ key, frame, L, i, j, gen: this.gen });
    }
    buildTiles(budget) {
      const t0 = performance.now();
      let n = 0;
      while (this.queue.length && performance.now() - t0 < budget) {
        const q = this.queue.shift();
        this.queued.delete(q.key);
        if (q.gen !== this.gen) continue;
        const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(TILE + 2, TILE + 2) : Object.assign(document.createElement("canvas"), { width: TILE + 2, height: TILE + 2 });
        const ctx = c.getContext("2d"), k = 2 ** q.L, prev = this.F;
        // tile pixel (1,1) = world (i*w, j*w); computed in float64
        this.scene(ctx, [k, 0, 0, k, 1 - q.i * TILE, 1 - q.j * TILE], TILE + 2, TILE + 2, 1, { frame: q.frame, tile: true, pxs: k / (this.screenDensity || k) });
        this.F = prev;
        this.tiles.set(q.key, { canvas: c, gen: q.gen, i: q.i, j: q.j, L: q.L, used: performance.now() });
        n++;
      }
      if (this.tiles.size > MAX_TILES) {
        const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used);
        for (let k = 0; k < old.length && this.tiles.size > MAX_TILES * 0.85; k++) this.tiles.delete(old[k][0]);
      }
      return n;
    }

    // 3D box layers, painted by the engine instead of a giant SVG per frame
    layer(f) {
      const s = this.comp.state, fr = s.frames[f];
      if (!fr) return "";
      this._layers || (this._layers = new WeakMap());
      const hit = this._layers.get(fr.items);
      if (hit && hit.B === s.B && hit.f0 === (f === 0)) return hit.url;
      const N = 600, c = document.createElement("canvas");
      c.width = c.height = N;
      const prev = this.F;
      this.scene(c.getContext("2d"), [N / 1e3, 0, 0, N / 1e3, 0, 0], N, N, 1, { frame: f, layer: true });
      this.F = prev;
      const url = c.toDataURL("image/png");
      this._layers.set(fr.items, { B: s.B, f0: f === 0, url });
      return url;
    }

    // Frame-strip thumbnail (replaces a full SVG copy of the world per frame,
    // which made every React render cost tens of milliseconds). Called from a
    // ref on each render; redraws only when that frame's content changed.
    thumb(canvas, frame) {
      if (!canvas) return;
      const s = this.comp.state, f = s.frames[frame];
      if (!f) return;
      const drafts = frame === this.comp.dIdx() ? s.drafts : null;
      const W = canvas.clientWidth || 40, H = canvas.clientHeight || 40, dpr = Math.min(2, root.devicePixelRatio || 1);
      const key = canvas.__ifKey;
      if (key && key[0] === s.B && key[1] === f.items && key[2] === drafts && key[3] === W && key[4] === H) return;
      canvas.__ifKey = [s.B, f.items, drafts, W, H];
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      const ctx = canvas.getContext("2d");
      const sc = Math.min(W, H) / 1e3;
      const prev = this.F;
      this.scene(ctx, [sc, 0, 0, sc, W / 2 - sc * 500, H / 2 - sc * 500], W, H, dpr, { frame, thumb: true });
      this.F = prev;
    }

    // Draws one frame of the world into ctx (mirrors the old art() SVG).
    scene(ctx, V, W, H, dpr, o) {
      const comp = this.comp, s = comp.state, sc = scaleOf(V);
      const view = [-4, -4, W + 4, H + 4];
      const iv = inv(V), cs = [tr(iv, 0, 0), tr(iv, W, 0), tr(iv, 0, H), tr(iv, W, H)];
      const rx0 = Math.min(...cs.map((q) => q[0])), ry0 = Math.min(...cs.map((q) => q[1]));
      const rect = { x: rx0, y: ry0, w: Math.max(...cs.map((q) => q[0])) - rx0, h: Math.max(...cs.map((q) => q[1])) - ry0 };
      // pxs: canvas pixels per screen pixel (tiles are painted at their own
      // resolution, so outline widths given in screen pixels must scale)
      const F = { ctx, dpr, V, sc, view, W, H, clipCache: new Map(), animated: false, shapes: 0, items: 0, pxs: o.pxs || 1 };
      this.F = F;
      const n = o.frame, isCur = n === comp.dIdx(), thumb = !!(o.thumb || o.layer), tile = !!o.tile, overlay = !!o.overlay;
      const drafts = isCur && !tile && !o.layer ? s.drafts : [];
      const draftB = drafts.filter((x) => x.type === "boundary");
      const sel = !thumb && !tile && s.selected ? (s.B.find((b) => b.id === s.selected) || draftB.find((b) => b.id === s.selected)) : null;
      let bs;
      if (thumb) bs = [...s.B, ...draftB];
      else if (tile) bs = comp.indexedVisible(s.B, rect, 0.5 / sc);
      else if (overlay) bs = draftB;
      else bs = comp.visibleCurves(rect);
      const byId = this.byIdFor(comp);
      F.byId = byId;
      const selOf = (b) => !thumb && !tile && s.selected === b.id;
      // GIFs animate, so they're never baked into tiles
      const isGif = (p) => p.type === "image" && p.gif;

      // 1. windows (dark fill + outline), each clipped to its parent chain
      const px = (b) => shape(b.d).size * sc;
      const shown = bs.filter((b) => selOf(b) || px(b) >= MIN_PX);
      const layerFills = !o.layer || n === 0;
      for (const b of shown) {
        const sel = selOf(b);
        if (!layerFills) break;
        this.withClip(px(b) < CLIP_PX ? null : b.clipParent, () => {
          const fill = b.traced ? (b.paintRegion ? b.color : null) : "rgba(5,6,9,.66)";
          this.shapeDraw(b.d, null, { fill, stroke: sel ? "#fff" : b.color, alpha: sel ? 1 : thumb ? 0.35 : 0.55, px: sel ? 3 : 1.4, dash: b.draft ? [8, 6] : null });
        });
      }
      // 2. onion-skin ghosts, 3. this frame, 4. drafts
      const pixel = 1 / sc;
      const items = (list, cull) => (cull ? comp.indexedVisible(list, rect, pixel * 0.35) : list).filter((p) => p.type !== "boundary" && (tile ? !isGif(p) : overlay ? isGif(p) : true));
      if (s.onion && !thumb && !overlay) {
        const op = [0.42, 0.2, 0.09];
        for (let w = s.ghosts; w >= 1; w--) { const N = n - w; if (N >= 0 && s.frames[N]) this.drawItems(items(s.frames[N].items || [], true), op[w - 1]); }
      }
      if (s.frames[n]) this.drawItems(items(s.frames[n].items || [], !thumb), 1);
      if (drafts.length) this.drawItems(drafts.filter((p) => p.type !== "boundary"), 1);
      // 5. outlines on top (overlay mode adds the selected window's highlight)
      for (const b of overlay && sel && !draftB.includes(sel) ? [...shown, sel] : shown) {
        const sel = selOf(b);
        this.withClip(px(b) < CLIP_PX ? null : b.clipParent, () => {
          this.shapeDraw(b.d, null, sel
            ? { fill: "rgba(255,255,255,.12)", stroke: "#ffffff", alpha: 1, px: 3.5, dash: [8, 4] }
            : { fill: null, stroke: b.color, alpha: 0.45, px: 1.2, dash: b.draft ? [8, 6] : null });
        });
      }
      if (thumb || tile || !o.live) { ctx.setTransform(1, 0, 0, 1, 0, 0); return F; }
      // 6. placement box of the active draft
      if (s.tool === "adjust" && s.active) {
        const f = drafts.find((x) => x.id === s.active);
        if (f) {
          const bx = comp.itemBox(f), G = itemMatrix(f), M = G ? mul(V, G) : V;
          ctx.setTransform(dpr * M[0], dpr * M[1], dpr * M[2], dpr * M[3], dpr * M[4], dpr * M[5]);
          ctx.beginPath(); ctx.rect(bx.x - 6 / sc, bx.y - 6 / sc, bx.w + 12 / sc, bx.h + 12 / sc);
          ctx.setLineDash([6 / scaleOf(M), 5 / scaleOf(M)]); ctx.lineWidth = 1.5 / scaleOf(M); ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.setLineDash([]);
        }
      }
      // 7. the stroke or loop being drawn right now
      if (s.live && s.live.pts && s.live.pts.length > 1) {
        const f = s.live, pts = f.pts;
        const run = () => {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.beginPath();
          for (let k = 0; k < pts.length; k++) { const q = tr(V, pts[k][0], pts[k][1]); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
          ctx.lineCap = ctx.lineJoin = "round";
          if (f.type === "stroke") { ctx.strokeStyle = f.color; ctx.lineWidth = Math.max(0.5, f.w * sc); ctx.stroke(); }
          else { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]); }
          ctx.lineCap = ctx.lineJoin = "butt";
        };
        f.type === "stroke" ? this.withClip(f.b, run) : run();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return F;
    }

    drawItems(list, opacity) {
      const s = this.comp.state, F = this.F, ctx = F.ctx;
      ctx.globalAlpha = opacity;
      const clipOf = (p) => {
        if (p.type === "vector" && p.placementPending) return null;
        const G = itemMatrix(p), px = itemSize(p) * (G ? scaleOf(G) : 1) * F.sc;
        return px < CLIP_PX ? null : p.b;
      };
      list = list.filter((p) => { const G = itemMatrix(p); return itemSize(p) * (G ? scaleOf(G) : 1) * F.sc >= MIN_PX; });
      // consecutive items in the same window share one clip
      let i = 0;
      while (i < list.length) {
        const b = clipOf(list[i]);
        let j = i;
        while (j < list.length && clipOf(list[j]) === b) j++;
        const group = list.slice(i, j);
        this.withClip(b, () => { for (let p of group) { p = (s.tr && s.tr[p.id]) || p; this.drawItem(p); } });
        i = j;
      }
      ctx.globalAlpha = 1;
    }

    drawItem(p) {
      const F = this.F, ctx = F.ctx, G = itemMatrix(p);
      F.items++;
      if (p.type === "stroke") {
        this.shapeDraw(p.d, G, { fill: null, stroke: p.color, alpha: 1, worldWidth: p.w, round: true });
      } else if (p.type === "vector") {
        if (p.preferOriginal && p.renderSrc && p.sourceRect) {
          const G2 = itemMatrix({ t: p.sourceTransform, cx: p.sourceCx, cy: p.sourceCy });
          this.imageDraw(p.renderSrc, p.sourceRect, G2);
        } else for (const q of p.paths || []) this.shapeDraw(q.d, G, { fill: q.color, rule: "evenodd" });
      } else if (p.type === "image") {
        if (p.gif) F.animated = true;
        this.imageDraw(p.src, p, G);
      }
    }

    imageDraw(src, r, G) {
      const F = this.F, ctx = F.ctx, im = src && this.image(src);
      if (!im) return;
      const M = G ? mul(F.V, G) : F.V;
      if (!this.visible(M, r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2)) return;
      // preserveAspectRatio="xMidYMid slice": cover the box, crop the overflow
      const ia = im.naturalWidth / im.naturalHeight, ba = r.w / r.h;
      let sw = im.naturalWidth, sh = im.naturalHeight, sx = 0, sy = 0;
      if (ia > ba) { sw = sh * ba; sx = (im.naturalWidth - sw) / 2; } else { sh = sw / ba; sy = (im.naturalHeight - sh) / 2; }
      // draw relative to the box center to keep numbers small
      const L = mul(M, T(r.x + r.w / 2, r.y + r.h / 2)), d = F.dpr;
      ctx.setTransform(d * L[0], d * L[1], d * L[2], d * L[3], d * L[4], d * L[5]);
      ctx.drawImage(im, sx, sy, sw, sh, -r.w / 2, -r.h / 2, r.w, r.h);
    }

    // is a box (center cx,cy, half sizes hw,hh, in M's input space) on screen and big enough?
    visible(M, cx, cy, hw, hh) {
      const v = this.F.view, s = scaleOf(M), c = tr(M, cx, cy), r = Math.hypot(hw, hh) * s;
      return !(c[0] + r < v[0] || c[0] - r > v[2] || c[1] + r < v[1] || c[1] - r > v[3]);
    }

    // Prepare a path for drawing/clipping: local Path2D under a transform, or a
    // float64 screen-space path for huge shapes. Returns null when off screen.
    prep(d, G) {
      const F = this.F, e = shape(d);
      const M = mul(G ? mul(F.V, G) : F.V, T(e.cx, e.cy));
      const s = scaleOf(M), size = e.size * s;
      if (!this.visible(M, 0, 0, e.hw, e.hh)) return null;
      if (size > HUGE_PX) {
        const p = screenPath(e, M, F.view);
        return p ? { path: p, M: [1, 0, 0, 1, 0, 0], s: 1, size, screen: true } : null;
      }
      return e.path ? { path: e.path, M, s, size, screen: false } : null;
    }

    shapeDraw(d, G, o) {
      const F = this.F, ctx = F.ctx;
      const r = this.prep(d, G);
      if (!r || r.size < 0.4) return;
      F.shapes++;
      const M = r.M, dp = F.dpr;
      ctx.setTransform(dp * M[0], dp * M[1], dp * M[2], dp * M[3], dp * M[4], dp * M[5]);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(r.path, o.rule || "nonzero"); }
      if (o.stroke) {
        const ga = ctx.globalAlpha;
        ctx.globalAlpha = ga * (o.alpha == null ? 1 : o.alpha);
        ctx.strokeStyle = o.stroke;
        // non-scaling outlines are in px; item strokes are in world units
        const scaleToPx = r.screen ? 1 : r.s;
        let px = o.worldWidth != null ? o.worldWidth * (r.screen ? scaleOf(G ? mul(F.V, G) : F.V) : 1) : (o.px * F.pxs) / scaleToPx;
        if (o.worldWidth != null && !r.screen && px * r.s < 0.35) px = 0.35 / r.s;
        ctx.lineWidth = px;
        if (o.round) ctx.lineCap = ctx.lineJoin = "round";
        if (o.dash) ctx.setLineDash(o.dash.map((x) => (x * F.pxs) / scaleToPx));
        ctx.stroke(r.path);
        if (o.dash) ctx.setLineDash([]);
        if (o.round) ctx.lineCap = ctx.lineJoin = "butt";
        ctx.globalAlpha = ga;
      }
    }

    // Run fn with the canvas clipped to window `bid` and all its ancestors.
    withClip(bid, fn) {
      if (!bid) { fn(); return; }
      const F = this.F, ctx = F.ctx, chain = [];
      for (let b = F.byId.get(bid), k = 0; b && k < 32; b = b.clipParent ? F.byId.get(b.clipParent) : null, k++) chain.push(b);
      if (!chain.length) { fn(); return; }
      ctx.save();
      for (let k = chain.length - 1; k >= 0; k--) {
        const b = chain[k];
        let r = F.clipCache.get(b.id);
        if (r === undefined) { r = this.prep(b.d, null); F.clipCache.set(b.id, r); }
        if (!r) { ctx.restore(); return; } // window off screen: nothing inside it is visible
        const M = r.M, dp = F.dpr;
        ctx.setTransform(dp * M[0], dp * M[1], dp * M[2], dp * M[3], dp * M[4], dp * M[5]);
        ctx.clip(r.path);
      }
      fn();
      ctx.restore();
    }
  }

  // Path text written by smooth()/line() carries enough decimals for the
  // current zoom (it used to be fixed at 1, which collapsed deep drawings).
  function setDigits(z) { root.__ifDigits = Math.max(1, Math.min(12, Math.ceil(Math.log10(Math.max(1, z))) + 2)); }

  // ---------- image trace: geometry from the image ----------
  // labels: per-pixel colour cluster (or -1 for transparent/background).
  // Every connected patch of one colour is a shape (holes included). The
  // smallest shapes merge into the neighbour they share the longest edge with
  // until at most `maxShapes` remain, so the artwork and the selectable curves
  // are the same list. Isolated specks smaller than minPx are dropped.
  function shapeTrace(labels, W, H, minPx, maxShapes) {
    const N = W * H, comp = new Int32Array(N).fill(-1), stack = new Int32Array(N), regs = [];
    for (let p = 0; p < N; p++) {
      if (labels[p] < 0 || comp[p] >= 0) continue;
      const id = regs.length, lab = labels[p];
      let sp = 0, area = 0, edge = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      stack[sp++] = p; comp[p] = id;
      while (sp) {
        const q = stack[--sp], x = q % W, y = (q / W) | 0;
        area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x === 0 || x === W - 1 || y === 0 || y === H - 1 || labels[q - 1] !== lab || labels[q + 1] !== lab || labels[q - W] !== lab || labels[q + W] !== lab) edge++;
        if (x > 0 && comp[q - 1] < 0 && labels[q - 1] === lab) { comp[q - 1] = id; stack[sp++] = q - 1; }
        if (x < W - 1 && comp[q + 1] < 0 && labels[q + 1] === lab) { comp[q + 1] = id; stack[sp++] = q + 1; }
        if (y > 0 && comp[q - W] < 0 && labels[q - W] === lab) { comp[q - W] = id; stack[sp++] = q - W; }
        if (y < H - 1 && comp[q + W] < 0 && labels[q + W] === lab) { comp[q + W] = id; stack[sp++] = q + W; }
      }
      regs.push({ label: lab, area, edge, x0, y0, x1, y1 });
    }
    const adj = regs.map(() => new Map());
    const link = (a, b) => { adj[a].set(b, (adj[a].get(b) || 0) + 1); adj[b].set(a, (adj[b].get(a) || 0) + 1); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, a = comp[p];
      if (a < 0) continue;
      if (x < W - 1) { const b = comp[p + 1]; if (b >= 0 && b !== a) link(a, b); }
      if (y < H - 1) { const b = comp[p + W]; if (b >= 0 && b !== a) link(a, b); }
    }
    const parent = new Int32Array(regs.length).map((_, i) => i);
    // binary min-heap of [area, id]
    const heap = [];
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
    let alive = regs.length;
    // merge region id into the neighbour it shares the longest edge with
    const merge = (id) => {
      const R = regs[id];
      let best = -1, bl = 0;
      for (const [n, l] of adj[id]) if (l > bl || (l === bl && regs[n].area > regs[best].area)) { bl = l; best = n; }
      R.dead = true; alive--;
      if (best < 0) { R.dropped = true; return -1; }
      const B = regs[best];
      B.area += R.area; B.edge += R.edge;
      B.x0 = Math.min(B.x0, R.x0); B.y0 = Math.min(B.y0, R.y0); B.x1 = Math.max(B.x1, R.x1); B.y1 = Math.max(B.y1, R.y1);
      parent[id] = best;
      for (const [n, l] of adj[id]) {
        if (n === best) continue;
        adj[best].set(n, (adj[best].get(n) || 0) + l);
        const an = adj[n]; an.delete(id); an.set(best, (an.get(best) || 0) + l);
      }
      adj[best].delete(id); adj[id] = null;
      return best;
    };
    // 1. anti-aliasing fringes: patches ~1 px thick hugging a real shape's edge
    //    (area / edge pixels < 1.6, under 1% of the image) fold into the shape they hug
    regs.map((r, i) => i).sort((a, b) => regs[a].area - regs[b].area).forEach((i) => {
      const R = regs[i];
      if (!R.dead && R.area < N * 0.01 && R.area / Math.max(1, R.edge) < 1.6 && adj[i].size) merge(i);
    });
    // 2. smallest first until at most maxShapes remain and none is a speck
    regs.forEach((r, i) => { if (!r.dead) push([r.area, i]); });
    const target = Math.max(1, maxShapes | 0);
    while (heap.length) {
      const [area, id] = pop(), R = regs[id];
      if (R.dead || R.area !== area) continue;
      if (alive <= target && area >= minPx) break;
      const best = merge(id);
      if (best >= 0) push([regs[best].area, best]);
    }
    const find = (i) => { let r = i; while (parent[r] !== r) r = parent[r]; while (parent[i] !== r) { const n = parent[i]; parent[i] = r; i = n; } return r; };
    const out = [], index = new Int32Array(regs.length).fill(-1);
    regs.forEach((r, i) => { if (!r.dead) { index[i] = out.length; out.push({ id: out.length, label: r.label, area: r.area, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }); } });
    const ids = new Int32Array(N).fill(-1);
    for (let p = 0; p < N; p++) { const c = comp[p]; if (c < 0) continue; const r = find(c); ids[p] = regs[r].dropped ? -1 : index[r]; }
    out.sort((a, b) => b.area - a.area);
    return { ids, regions: out };
  }

  // ---------- trace detail rules (engagement) ----------
  // How many shapes a person may cut an image into. Change the numbers here.
  const TRACE_RULES = { base: 40, perPiece: 20, perPoints: 10, pointsStep: 10, cap: 600, owner: 2000 };
  function traceLimit({ owner = false, published = 0, points = 0 } = {}) {
    const R = TRACE_RULES;
    if (owner) return { limit: R.owner, owner: true, published, points, text: "Owner: up to " + R.owner + " shapes" };
    const limit = Math.min(R.cap, R.base + R.perPiece * published + R.perPoints * Math.floor(points / R.pointsStep));
    const more = limit >= R.cap ? "Maximum detail unlocked" : "+" + R.perPiece + " per published piece, +" + R.perPoints + " per " + R.pointsStep + " points";
    return { limit, owner: false, published, points, text: "Your limit: " + limit + " shapes (" + published + " published, " + points + " pts). " + more };
  }

  IFEngine.MAXZ = MAXZ;
  IFEngine.shapeTrace = shapeTrace;
  IFEngine.traceLimit = traceLimit;
  IFEngine.TRACE_RULES = TRACE_RULES;
  IFEngine._internal = { parse, shape, itemMatrix, mul, tr, inv, screenPath, clipRect, setDigits };
  root.IFEngine = IFEngine;
})(typeof window !== "undefined" ? window : globalThis);
