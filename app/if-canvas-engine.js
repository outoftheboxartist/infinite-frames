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

  // ---------- affine matrices [a,b,c,d,e,f] (canvas order) ----------
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const tr = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const T = (x, y) => [1, 0, 0, 1, x, y];

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
      this.hitCtx = document.createElement("canvas").getContext("2d");
      this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.kick()) : null;
      this.ro && this.ro.observe(canvas);
      setDigits(this.view.z);
      this.kick();
    }
    destroy() { cancelAnimationFrame(this.raf); clearTimeout(this.syncT); this.ro && this.ro.disconnect(); }

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
      const v = this.view, sc = Math.min(W, H) * v.z / 1e3;
      return [sc, 0, 0, sc, W / 2 - sc * v.x, H / 2 - sc * v.y];
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
      const t0 = performance.now();
      const comp = this.comp, s = comp.state, canvas = this.canvas, ctx = this.ctx;
      if (s.view !== this.view && this.ours.has(s.view)) s.view = this.view;
      const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (s.mode !== "2d") return;
      const F = this.scene(ctx, this.viewMatrix(W, H), W, H, dpr, { frame: s.viewing, live: true });
      this.stats = { ms: performance.now() - t0, shapes: F.shapes, items: F.items, frames: this.stats.frames + 1, z: this.view.z };
      if (F.animated) this.kick(); // animated GIFs keep drawing
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
      const comp = this.comp, s = comp.state, sc = V[0];
      const view = [-4, -4, W + 4, H + 4];
      const rect = { x: (0 - V[4]) / sc, y: (0 - V[5]) / sc, w: W / sc, h: H / sc };
      const F = { ctx, dpr, V, sc, view, W, H, clipCache: new Map(), animated: false, shapes: 0, items: 0 };
      this.F = F;
      const n = o.frame, isCur = n === comp.dIdx(), thumb = !!o.thumb;
      const drafts = isCur ? s.drafts : [];
      const bs = thumb ? [...s.B, ...drafts.filter((x) => x.type === "boundary")] : comp.visibleCurves(rect);
      const byId = new Map();
      for (const b of comp.allB()) byId.set(b.id, b);
      F.byId = byId;
      const selOf = (b) => !thumb && s.selected === b.id;

      // 1. windows (dark fill + outline), each clipped to its parent chain
      const px = (b) => shape(b.d).size * sc;
      const shown = bs.filter((b) => selOf(b) || px(b) >= MIN_PX);
      for (const b of shown) {
        const sel = selOf(b);
        this.withClip(px(b) < CLIP_PX ? null : b.clipParent, () => {
          const fill = b.traced ? (b.paintRegion ? b.color : null) : "rgba(5,6,9,.66)";
          this.shapeDraw(b.d, null, { fill, stroke: sel ? "#fff" : b.color, alpha: sel ? 1 : thumb ? 0.35 : 0.55, px: sel ? 3 : 1.4, dash: b.draft ? [8, 6] : null });
        });
      }
      // 2. onion-skin ghosts, 3. this frame, 4. drafts
      const pixel = 1 / sc;
      const items = (list, cull) => (cull ? comp.indexedVisible(list, rect, pixel * 0.35) : list).filter((p) => p.type !== "boundary");
      if (s.onion && !thumb) {
        const op = [0.42, 0.2, 0.09];
        for (let w = s.ghosts; w >= 1; w--) { const N = n - w; if (N >= 0 && s.frames[N]) this.drawItems(items(s.frames[N].items || [], true), op[w - 1]); }
      }
      if (s.frames[n]) this.drawItems(items(s.frames[n].items || [], !thumb), 1);
      if (drafts.length) this.drawItems(items(drafts, false), 1);
      // 5. outlines on top
      for (const b of shown) {
        const sel = selOf(b);
        this.withClip(px(b) < CLIP_PX ? null : b.clipParent, () => {
          this.shapeDraw(b.d, null, sel
            ? { fill: "rgba(255,255,255,.12)", stroke: "#ffffff", alpha: 1, px: 3.5, dash: [8, 4] }
            : { fill: null, stroke: b.color, alpha: 0.45, px: 1.2, dash: b.draft ? [8, 6] : null });
        });
      }
      if (thumb || !o.live) { ctx.setTransform(1, 0, 0, 1, 0, 0); return F; }
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
        let px = o.worldWidth != null ? o.worldWidth * (r.screen ? scaleOf(G ? mul(F.V, G) : F.V) : 1) : o.px / scaleToPx;
        if (o.worldWidth != null && !r.screen && px * r.s < 0.35) px = 0.35 / r.s;
        ctx.lineWidth = px;
        if (o.round) ctx.lineCap = ctx.lineJoin = "round";
        if (o.dash) ctx.setLineDash(o.dash.map((x) => x / scaleToPx));
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

  IFEngine.MAXZ = MAXZ;
  IFEngine._internal = { parse, shape, itemMatrix, mul, tr, screenPath, clipRect, setDigits };
  root.IFEngine = IFEngine;
})(typeof window !== "undefined" ? window : globalThis);
