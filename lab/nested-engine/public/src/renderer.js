// Canvas renderer for the nested world.
//
// Per frame:
//  1. Build exact screen matrices for the anchor and its ancestors (camera.js).
//  2. Walk the tree from the top ancestor, depth-first, drawing only what's
//     visible: off-screen subtrees are culled, regions with thousands of
//     children are queried through a per-parent spatial grid, and anything
//     smaller than `minPx` is skipped (its whole subtree is smaller still).
//  3. Normal-sized shapes draw from a cached Path2D in local coordinates, so
//     the GPU/rasterizer does the transform. Huge shapes (you're deep inside
//     them) are flattened and clipped in float64 on the CPU instead, which
//     keeps edges stable at any zoom.
//  4. minPx adapts to keep frame time under budget: under load, the smallest
//     detail fades first rather than the frame rate dropping.
//
// Nothing here waits on the network. Missing children are requested before
// they're big enough to notice (prefetch) and appear when they arrive.

import { mul, inv, apply, scaleOf } from "./mat.js";
import { localBounds, ringSpans, bezierRing, screenRings } from "./geom.js";
import { chainMatrices, localMatrix } from "./camera.js";

const HUGE_PX = 6000;
const GRID_MIN_KIDS = 48;
const IMPOSTOR_MIN_KIDS = 400; // dense leaf regions are drawn from cached tiles
const TILE = 512; // tile side (px)
const MAX_LEVEL = 65536; // beyond this zoom a dense region is sparse on screen: draw live
const TILE_PIXELS = 64 * TILE * TILE; // tile cache budget (~64 MB)
const BUILD_BUDGET_MS = 4; // per frame, spent filling tiles
const STROKE = "rgba(255,255,255,0.16)";

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.dpr = 1;
    this.W = 1; this.H = 1;
    this.minPx = 1;
    this.mats = new Map(); // id -> F-frame screen matrix (drawn this frame)
    this.drawn = []; // nodes drawn this frame, in paint order
    this.wants = new Map(); // parentId -> screen size (children to load)
    this.grids = new Map(); // parentId -> grid
    this.chain = null;
    this.stats = { drawn: 0, cpu: 0, culled: 0, gridQueries: 0, huge: 0 };
    this.budgetMs = 9;
    this.prefetchPx = 14;
    this.tiles = new Map(); // "region/level/i/j" -> tile
    this.building = new Set();
    // tiny shapes are batched into colored dots, flushed per parent
    this.dn = 0; this.dc = []; this.dxyh = new Float32Array(3 * 4096);
  }

  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
  }

  render(scene, cam, t, now) {
    const t0 = performance.now();
    const ctx = this.ctx, dpr = this.dpr, W = this.W, H = this.H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#04050a";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.mats.clear();
    this.drawn.length = 0;
    this.wants.clear();
    const st = this.stats;
    st.drawn = st.culled = st.gridQueries = st.huge = 0;

    const chain = chainMatrices(scene, cam, W, H, t);
    this.chain = chain;
    if (!chain.top) return;
    this.view = [-2, -2, W + 2, H + 2];
    this.scene = scene;
    this.t = t;
    this.now = now;
    st.impostors = 0;
    this.dn = 0;
    this.visit(chain.top, chain.mf.get(chain.top.id), 0);
    this.flushDots(0);

    st.cpu = performance.now() - t0;
    this.buildImpostors(BUILD_BUDGET_MS);
    // adaptive level of detail: shed the smallest detail first, fast; bring it back slowly
    if (st.cpu > this.budgetMs) this.minPx = Math.min(8, this.minPx * (st.cpu > 2 * this.budgetMs ? 1.35 : 1.12));
    else if (st.cpu < this.budgetMs * 0.5) this.minPx = Math.max(0.75, this.minPx / 1.03);
  }

  pushDot(color, x, y, h) {
    const i = this.dn++;
    if (3 * this.dn > this.dxyh.length) { const a = new Float32Array(this.dxyh.length * 2); a.set(this.dxyh); this.dxyh = a; }
    this.dc[i] = color;
    this.dxyh[3 * i] = x; this.dxyh[3 * i + 1] = y; this.dxyh[3 * i + 2] = h;
  }

  // Draw queued dots from index `from`, one fillStyle change per color.
  flushDots(from) {
    if (this.dn <= from) return;
    const ctx = this.ctx, dpr = this.dpr, d = this.dxyh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const groups = new Map();
    for (let i = from; i < this.dn; i++) {
      const c = this.dc[i];
      let g = groups.get(c);
      if (!g) groups.set(c, (g = []));
      g.push(i);
    }
    for (const [c, idx] of groups) {
      ctx.fillStyle = c;
      for (const i of idx) { const h = d[3 * i + 2]; ctx.fillRect(d[3 * i] - h / 2, d[3 * i + 1] - h / 2, h, h); }
    }
    this.dn = from;
  }

  visit(n, M, depth) {
    const st = this.stats;
    const bb = localBounds(n);
    const sc = scaleOf(M);
    const size = 2 * n._hr * sc;
    if (!(size >= this.minPx) || !Number.isFinite(size)) return;
    const c = apply(M, n._cx, n._cy);
    const r = n._hr * sc * (n.clip ? 1 : 1.6);
    const v = this.view;
    if (c[0] + r < v[0] || c[0] - r > v[2] || c[1] + r < v[1] || c[1] - r > v[3]) { st.culled++; return; }

    this.mats.set(n.id, M);
    this.drawn.push(n);
    this.scene.lastSeen.set(n.id, this.now);
    st.drawn++;

    const scene = this.scene;
    if (n.nchild > 0 && !scene.loadedKids.has(n.id) && size > this.prefetchPx) this.wants.set(n.id, size);

    const ctx = this.ctx, dpr = this.dpr;
    if (size < 3) {
      this.pushDot(dotColor(n, this.t), c[0], c[1], Math.max(0.6, size * 0.7));
      return;
    }
    const fill = colorOf(n, this.t);

    const huge = size > HUGE_PX;
    let screenPath = null, covers = false;
    if (huge) {
      st.huge++;
      const rings = screenRings(n, M, v);
      if (!rings.length) return; // shape doesn't touch the viewport at all
      covers = rings.length === 1 && n.rule !== "evenodd" && coversView(rings[0], v);
      if (!covers) screenPath = pathOf(rings);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = fill;
      if (covers) ctx.fillRect(v[0], v[1], v[2] - v[0], v[3] - v[1]);
      else ctx.fill(screenPath, n.rule === "evenodd" ? "evenodd" : "nonzero");
    } else {
      ctx.setTransform(dpr * M[0], dpr * M[1], dpr * M[2], dpr * M[3], dpr * M[4], dpr * M[5]);
      ctx.fillStyle = fill;
      ctx.fill(localPath(n), n.rule === "evenodd" ? "evenodd" : "nonzero");
    }

    // children
    const kids = scene.childrenOf(n.id);
    if (kids.length && size > 6) {
      const clip = n.clip && !covers;
      if (clip) {
        ctx.save();
        if (huge) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clip(screenPath, n.rule === "evenodd" ? "evenodd" : "nonzero"); }
        else ctx.clip(localPath(n), n.rule === "evenodd" ? "evenodd" : "nonzero");
      }
      const cm = this.chain.mf;
      const dotsFrom = this.dn;
      const cached = !huge && kids.length >= IMPOSTOR_MIN_KIDS && this.drawImpostor(n, kids, M, size);
      const list = cached ? cached : kids.length >= GRID_MIN_KIDS ? this.queryGrid(n, kids, M, sc) : kids;
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const k = list[i];
          const Mk = cm.get(k.id) || mul(M, localMatrix(k, this.t));
          this.visit(k, Mk, depth + 1);
        }
      }
      this.flushDots(dotsFrom);
      if (clip) ctx.restore();
    }

    // outline on top of children
    if (size > 18) {
      ctx.strokeStyle = STROKE;
      if (huge) {
        if (!covers) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 1; ctx.stroke(screenPath); }
      } else {
        ctx.setTransform(dpr * M[0], dpr * M[1], dpr * M[2], dpr * M[3], dpr * M[4], dpr * M[5]);
        ctx.lineWidth = 1 / sc;
        ctx.stroke(localPath(n));
      }
    }
  }

  // ---- region tiles ----------------------------------------------------------
  // A dense region whose children are all leaves (e.g. 20,000 stars) is drawn
  // from a tile pyramid, like a map: at zoom level L the region is an L x L
  // pixel image cut into 512 px tiles. Only tiles in view are built, a slice at
  // a time across frames (never a stall). A tile not ready yet is covered by
  // the matching piece of a coarser level, so nothing ever blanks. The region's
  // own spin/pulse is free (tiles live in its local frame). Children with their
  // own animation stay out of the tiles and are drawn live on top.
  // Returns the children still to draw live, or false to draw everything live.
  drawImpostor(n, kids, M, size) {
    const dpr = this.dpr;
    const g = this.gridFor(n, kids);
    if (!g.allLeaves) return false;
    const sq = regionSquare(n);
    const sc = scaleOf(M);
    const px = sq.side * sc * dpr;
    if (px < 64 || px > MAX_LEVEL) return false;
    const L = Math.max(256, 2 ** Math.ceil(Math.log2(px)));
    // visible part of the region, in local units
    const im = inv(M), v = this.view;
    const c = [apply(im, v[0], v[1]), apply(im, v[2], v[1]), apply(im, v[0], v[3]), apply(im, v[2], v[3])];
    const lx0 = Math.max(sq.x0, Math.min(c[0][0], c[1][0], c[2][0], c[3][0])), lx1 = Math.min(sq.x0 + sq.side, Math.max(c[0][0], c[1][0], c[2][0], c[3][0]));
    const ly0 = Math.max(sq.y0, Math.min(c[0][1], c[1][1], c[2][1], c[3][1])), ly1 = Math.min(sq.y0 + sq.side, Math.max(c[0][1], c[1][1], c[2][1], c[3][1]));
    if (lx1 <= lx0 || ly1 <= ly0) return g.animated;
    const ctx = this.ctx;
    ctx.setTransform(dpr * M[0], dpr * M[1], dpr * M[2], dpr * M[3], dpr * M[4], dpr * M[5]);
    ctx.imageSmoothingEnabled = true;
    // always keep the coarsest level around as the fallback of last resort
    this.tile(n, g, sq, 256, 0, 0, true);
    const T = Math.min(TILE, L), per = sq.side * (T / L);
    const i0 = Math.floor((lx0 - sq.x0) / per), i1 = Math.min(L / T - 1, Math.floor((lx1 - sq.x0) / per));
    const j0 = Math.floor((ly0 - sq.y0) / per), j1 = Math.min(L / T - 1, Math.floor((ly1 - sq.y0) / per));
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) return false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = this.tile(n, g, sq, L, i, j, true);
        const tx = sq.x0 + i * per, ty = sq.y0 + j * per;
        if (t && t.done) { ctx.drawImage(t.canvas, tx, ty, per, per); t.used = this.now; this.stats.impostors++; continue; }
        // fallback: the same area cut out of the nearest finished coarser tile
        for (let L2 = L / 2; L2 >= 256; L2 /= 2) {
          const T2 = Math.min(TILE, L2), per2 = sq.side * (T2 / L2);
          const i2 = Math.floor((tx + per / 2 - sq.x0) / per2), j2 = Math.floor((ty + per / 2 - sq.y0) / per2);
          const t2 = this.tile(n, g, sq, L2, i2, j2, false);
          if (!t2 || !t2.done) continue;
          const k = T2 / per2;
          const sx = (tx - (sq.x0 + i2 * per2)) * k, sy = (ty - (sq.y0 + j2 * per2)) * k;
          ctx.drawImage(t2.canvas, sx, sy, per * k, per * k, tx, ty, per, per);
          t2.used = this.now;
          break;
        }
      }
    }
    return g.animated;
  }

  // Look up (and optionally request) one tile. Stale tiles (region changed)
  // still serve as fallback until their replacement is finished.
  tile(n, g, sq, L, i, j, request) {
    const key = n.id + "/" + L + "/" + i + "/" + j;
    let t = this.tiles.get(key);
    if (t && t.ver === g.ver) return t;
    if (!request) return t && t.done ? t : null;
    if (!t || t.ver !== g.ver) {
      if (t && t.pendingVer === g.ver) return t.done ? t : null;
      const T = Math.min(TILE, L), per = sq.side * (T / L);
      const tx = sq.x0 + i * per, ty = sq.y0 + j * per, k = T / per;
      const fresh = { key, L, i, j, T, k, tx, ty, ver: g.ver, region: n, grid: g, next: 0, list: null, canvas: null, done: false, used: this.now };
      if (t && t.replacement) this.building.delete(t.replacement);
      if (t && t.done) { t.pendingVer = g.ver; t.replacement = fresh; this.building.add(fresh); return t; }
      if (t) this.building.delete(t);
      this.tiles.set(key, fresh);
      this.building.add(fresh);
      return fresh;
    }
    return t;
  }

  buildImpostors(budget) {
    if (!this.building.size) return;
    const t0 = performance.now();
    // newest requests first: what's on screen now
    const queue = [...this.building].sort((a, b) => b.used - a.used || a.L - b.L);
    for (const t of queue) {
      if (!t.canvas) {
        this.evictTiles(t.T * t.T);
        t.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(t.T, t.T) : Object.assign(document.createElement("canvas"), { width: t.T, height: t.T });
        t.ctx = t.canvas.getContext("2d");
        t.base = [t.k, 0, 0, t.k, -t.tx * t.k, -t.ty * t.k];
        t.ctx.setTransform(...t.base);
        t.ctx.clip(localPath(t.region), t.region.rule === "evenodd" ? "evenodd" : "nonzero");
        t.list = tileKids(t.grid, t.tx, t.ty, t.T / t.k);
      }
      const c2 = t.ctx, base = t.base;
      while (t.next < t.list.length) {
        for (let n = 0; n < 300 && t.next < t.list.length; n++) {
          const k = t.list[t.next++];
          if (k.anim) continue;
          localBounds(k);
          const Mk = mul(base, localMatrix(k, 0));
          const sz = 2 * k._hr * scaleOf(Mk);
          if (sz < 0.35) continue;
          if (sz < 2.5) {
            const c = apply(Mk, k._cx, k._cy), h = Math.max(0.6, sz * 0.7);
            c2.setTransform(1, 0, 0, 1, 0, 0);
            c2.fillStyle = k.fill;
            c2.fillRect(c[0] - h / 2, c[1] - h / 2, h, h);
          } else {
            c2.setTransform(Mk[0], Mk[1], Mk[2], Mk[3], Mk[4], Mk[5]);
            c2.fillStyle = k.fill;
            c2.fill(localPath(k), k.rule === "evenodd" ? "evenodd" : "nonzero");
          }
        }
        if (performance.now() - t0 > budget) return;
      }
      t.done = true;
      t.list = null; t.ctx = null; t.grid = null;
      this.building.delete(t);
      const cur = this.tiles.get(t.key);
      if (cur !== t) this.tiles.set(t.key, t); // replace a stale tile
    }
  }

  evictTiles(extra) {
    let total = extra;
    for (const t of this.tiles.values()) if (t.canvas) total += t.T * t.T;
    if (total <= TILE_PIXELS) return;
    const all = [...this.tiles.values()].filter((t) => t.canvas && !this.building.has(t)).sort((a, b) => a.used - b.used);
    for (const t of all) {
      if (total <= TILE_PIXELS) break;
      if (t.used === this.now) continue;
      this.tiles.delete(t.key);
      total -= t.T * t.T;
    }
  }

  gridFor(n, kids) {
    const ver = this.scene.kidsVersion.get(n.id) || 0;
    let g = this.grids.get(n.id);
    if (!g || g.ver !== ver || g.count !== kids.length) {
      g = buildGrid(kids, this.scene);
      g.ver = ver;
      this.grids.set(n.id, g);
    }
    return g;
  }

  // Spatial grid over a parent's children (built in parent-local coordinates,
  // rebuilt only when children move/add/remove).
  queryGrid(n, kids, M, sc) {
    const g = this.gridFor(n, kids);
    // whole region too small for any child to reach minPx? skip all of them
    if (2 * g.maxR * sc < this.minPx) return null;
    this.stats.gridQueries++;
    // viewport -> parent-local bounds
    const im = inv(M);
    const v = this.view;
    const p = [apply(im, v[0], v[1]), apply(im, v[2], v[1]), apply(im, v[0], v[3]), apply(im, v[2], v[3])];
    const pad = g.maxR;
    const x0 = Math.min(p[0][0], p[1][0], p[2][0], p[3][0]) - pad, x1 = Math.max(p[0][0], p[1][0], p[2][0], p[3][0]) + pad;
    const y0 = Math.min(p[0][1], p[1][1], p[2][1], p[3][1]) - pad, y1 = Math.max(p[0][1], p[1][1], p[2][1], p[3][1]) + pad;
    const cx0 = Math.max(0, Math.floor((x0 - g.x0) / g.cell)), cx1 = Math.min(g.nx - 1, Math.floor((x1 - g.x0) / g.cell));
    const cy0 = Math.max(0, Math.floor((y0 - g.y0) / g.cell)), cy1 = Math.min(g.ny - 1, Math.floor((y1 - g.y0) / g.cell));
    if (cx1 < cx0 || cy1 < cy0) return null;
    // fully visible region: use the ord-sorted list directly
    if (cx0 === 0 && cy0 === 0 && cx1 === g.nx - 1 && cy1 === g.ny - 1) return kids;
    const out = [];
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        const cell = g.cells[y * g.nx + x];
        if (cell) for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    if (out.length < 5000) out.sort((a, b) => a.ord - b.ord);
    return out;
  }
}

function regionSquare(n) {
  const bb = localBounds(n);
  const side = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
  return { x0: (bb[0] + bb[2]) / 2 - side / 2, y0: (bb[1] + bb[3]) / 2 - side / 2, side };
}

// children whose bounds may touch a local square (grid lookup), in paint order
function tileKids(g, x, y, w) {
  const pad = g.maxR;
  const cx0 = Math.max(0, Math.floor((x - pad - g.x0) / g.cell)), cx1 = Math.min(g.nx - 1, Math.floor((x + w + pad - g.x0) / g.cell));
  const cy0 = Math.max(0, Math.floor((y - pad - g.y0) / g.cell)), cy1 = Math.min(g.ny - 1, Math.floor((y + w + pad - g.y0) / g.cell));
  const out = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const cell = g.cells[cy * g.nx + cx]; if (cell) for (const k of cell) out.push(k); }
  out.sort((a, b) => a.ord - b.ord);
  return out;
}

function buildGrid(kids, scene) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, maxR = 0;
  let allLeaves = true;
  const animated = [];
  for (const k of kids) {
    if (k.nchild > 0 || scene.childrenOf(k.id).length) allLeaves = false;
    if (k.anim) animated.push(k);
    localBounds(k);
    const r = k._hr * k.s + Math.hypot(k._cx, k._cy) * k.s;
    maxR = Math.max(maxR, r * (k.anim && k.anim.kind === "pulse" ? 1.1 : 1));
    x0 = Math.min(x0, k.x); x1 = Math.max(x1, k.x);
    y0 = Math.min(y0, k.y); y1 = Math.max(y1, k.y);
  }
  const span = Math.max(x1 - x0, y1 - y0, 1e-9);
  const nx0 = Math.max(1, Math.min(256, Math.round(Math.sqrt(kids.length / 4))));
  const cell = span / nx0 + 1e-12;
  const nx = Math.floor((x1 - x0) / cell) + 1, ny = Math.floor((y1 - y0) / cell) + 1;
  const cells = new Array(nx * ny);
  for (const k of kids) {
    const i = Math.floor((k.y - y0) / cell) * nx + Math.floor((k.x - x0) / cell);
    (cells[i] || (cells[i] = [])).push(k);
  }
  return { x0, y0, cell, nx, ny, cells, maxR, count: kids.length, allLeaves, animated };
}

function coversView(ring, v) {
  // After clipping to the view rect, a shape covering the whole view comes back
  // as (approximately) the rect itself.
  let area = 0;
  const n = ring.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) area += (ring[2 * j] - ring[2 * i]) * (ring[2 * j + 1] + ring[2 * i + 1]);
  const full = (v[2] - v[0]) * (v[3] - v[1]);
  return Math.abs(area / 2) > full * 0.9995;
}

function pathOf(rings) {
  const p = new Path2D();
  for (const r of rings) {
    p.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
    p.closePath();
  }
  return p;
}

export function localPath(n) {
  if (n._path) return n._path;
  const p = new Path2D();
  for (const [start, len] of ringSpans(n)) {
    if (n.smooth && len >= 3) {
      const segs = bezierRing(n.pts, start, len);
      p.moveTo(segs[0][0], segs[0][1]);
      for (const s of segs) p.bezierCurveTo(s[2], s[3], s[4], s[5], s[6], s[7]);
    } else {
      p.moveTo(n.pts[2 * start], n.pts[2 * start + 1]);
      for (let i = 1; i < len; i++) p.lineTo(n.pts[2 * (start + i)], n.pts[2 * (start + i) + 1]);
    }
    p.closePath();
  }
  n._path = p;
  return p;
}

// Dots share a small quantized palette so thousands of them need only a few
// fillStyle changes.
export function dotColor(n, t) {
  if (n._dot === undefined || (n.anim && n.anim.kind === "hue")) {
    const m = /hsl\(([-\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(n.fill || "");
    if (!m) { n._dot = n.fill; return n._dot; }
    let h = Number(m[1]);
    if (n.anim && n.anim.kind === "hue") h += n.anim.speed * t;
    h = ((Math.round(h / 12) * 12) % 360 + 360) % 360;
    const l = Math.round(Number(m[3]) / 8) * 8;
    const c = `hsl(${h} ${Math.round(Number(m[2]) / 10) * 10}% ${l}%)`;
    if (n.anim && n.anim.kind === "hue") return c;
    n._dot = c;
  }
  return n._dot;
}

export function colorOf(n, t) {
  if (!n.anim || n.anim.kind !== "hue") return n.fill;
  if (n._hsl === undefined) {
    const m = /hsl\(([-\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(n.fill || "");
    n._hsl = m ? [Number(m[1]), m[2], m[3]] : null;
  }
  if (!n._hsl) return n.fill;
  const h = (n._hsl[0] + n.anim.speed * t) % 360;
  return `hsl(${h.toFixed(1)} ${n._hsl[1]}% ${n._hsl[2]}%)`;
}
