/* Infinite Frames: fast foveated renderer.
 *
 * Ported from the Foveated Zoom prototype. The main app still owns all state and
 * interaction: curves, drafts, Publish, frames, onion skin, chat, places, 3D. What
 * changes is how the flat 2D canvas is drawn:
 *
 *  - The app's SVG keeps only the closed-curve shapes it needs for tapping a curve
 *    (isPointInFill), and stops painting (opacity 0). React no longer builds an SVG
 *    element for every stroke and traced shape.
 *  - This module draws the same picture straight to a <canvas>: boundaries, onion
 *    ghosts, the current frame, drafts, outlines, the adjust box and the live stroke,
 *    in the app's order. It skips anything off screen or smaller than a pixel, and
 *    simplifies shapes more the further they are from your finger (detail levels
 *    built once per shape and cached), as Foveated Zoom does.
 *  - A WebGL pass then runs the Foveated Zoom shader on that canvas: sharp near your
 *    finger, prism sparkles or dithered blocks toward the edges. "Off" shows the
 *    plain canvas. Near the 3D threshold the shader steps aside and the plain canvas
 *    shows.
 *  - A readout shows depth in 8x levels and magnification, with the style switch.
 *
 * It reads the app through window.__ifApp. If anything here throws, it switches
 * itself off and hands drawing back to the app's own SVG.
 */
(() => {
  "use strict";
  const LV = 8, STYLES = ["Off", "Blocks", "Prism"], BGHEX = "#050507";
  const ONION = [0.42, 0.2, 0.09];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let style = 2;
  try { const s = localStorage.getItem("if-fov-style"); if (s != null && STYLES[+s]) style = +s; } catch (e) {}

  const FS = `__FS__`;
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

  /* ---------- shapes: parse SVG path data once, cache bounds and detail levels ---------- */
  const SHAPES = new Map();
  function shape(d) {
    let s = SHAPES.get(d);
    if (s) return s;
    if (SHAPES.size > 6000) SHAPES.clear();
    // bounds from every number in the path (control points included, so never too small)
    const nums = d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const bb = [1e9, 1e9, -1e9, -1e9];
    if (!/[aAhHvV]/.test(d)) for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = +nums[i], y = +nums[i + 1];
      if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
    } else for (const r of flatten(d)) for (let i = 0; i < r.length; i += 2) {
      const x = r[i], y = r[i + 1];
      if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
    }
    s = { d, rings: null, bb, n: nums.length >> 1, exact: null, lod: [] };
    SHAPES.set(d, s);
    return s;
  }
  function exactPath(s) { return s.exact || (s.exact = new Path2D(s.d)); }
  // detail level k keeps detail down to 0.15 * 2^k canvas units (same rule as Foveated Zoom)
  function lodPath(s, k, closed) {
    if (k <= 0 || s.n < 24) return exactPath(s);
    let p = s.lod[k];
    if (p) return p;
    p = new Path2D();
    const tol = 0.15 * Math.pow(2, k);
    if (!s.rings) s.rings = flatten(s.d);
    for (const r of s.rings) {
      const q = rdp(r, tol);
      if (q.length < 4) continue;
      p.moveTo(q[0], q[1]);
      for (let i = 2; i < q.length; i += 2) p.lineTo(q[i], q[i + 1]);
      if (closed) p.closePath();
    }
    return (s.lod[k] = p);
  }
  function rdp(p, tol) {
    const n = p.length >> 1; if (n < 3) return p;
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [0, n - 1], t2 = tol * tol;
    while (st.length) {
      const b = st.pop(), a = st.pop();
      const ax = p[2 * a], ay = p[2 * a + 1], dx = p[2 * b] - ax, dy = p[2 * b + 1] - ay, L = dx * dx + dy * dy;
      let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const px = p[2 * i] - ax, py = p[2 * i + 1] - ay;
        let dd; if (L === 0) dd = px * px + py * py; else { const c = px * dy - py * dx; dd = c * c / L; }
        if (dd > md) { md = dd; mi = i; }
      }
      if (md > t2) { keep[mi] = 1; st.push(a, mi, mi, b); }
    }
    const o = []; for (let i = 0; i < n; i++) if (keep[i]) o.push(p[2 * i], p[2 * i + 1]); return o;
  }
  // SVG path data -> polylines (curves sampled), for bounds and simplified levels
  function flatten(d) {
    const tok = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const rings = []; let cur = null, i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, last = "";
    const num = () => +tok[i++], isNum = () => i < tok.length && !/[a-zA-Z]/.test(tok[i]);
    const start = (px, py) => { if (cur && cur.length >= 4) rings.push(cur); cur = [px, py]; sx = px; sy = py; };
    const push = (px, py) => { if (!cur) start(x, y); cur.push(px, py); };
    while (i < tok.length) {
      if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
      const rel = cmd !== cmd.toUpperCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === "Z") { if (cur) { cur.push(sx, sy); rings.push(cur); cur = null; } x = sx; y = sy; last = "Z"; continue; }
      if (!isNum()) { i++; continue; }
      if (C === "M") { x = ox + num(); y = oy + num(); start(x, y); cmd = rel ? "l" : "L"; }
      else if (C === "L") { x = ox + num(); y = oy + num(); push(x, y); }
      else if (C === "H") { x = ox + num(); push(x, y); }
      else if (C === "V") { y = oy + num(); push(x, y); }
      else if (C === "Q" || C === "T") {
        let qx, qy;
        if (C === "Q") { qx = ox + num(); qy = oy + num(); } else if (last === "Q" || last === "T") { qx = 2 * x - lcx; qy = 2 * y - lcy; } else { qx = x; qy = y; }
        const ex = ox + num(), ey = oy + num();
        for (let k = 1; k <= 6; k++) { const t = k / 6, u = 1 - t; push(u * u * x + 2 * u * t * qx + t * t * ex, u * u * y + 2 * u * t * qy + t * t * ey); }
        lcx = qx; lcy = qy; x = ex; y = ey;
      } else if (C === "C" || C === "S") {
        let c1x, c1y;
        if (C === "C") { c1x = ox + num(); c1y = oy + num(); } else if (last === "C" || last === "S") { c1x = 2 * x - lcx; c1y = 2 * y - lcy; } else { c1x = x; c1y = y; }
        const c2x = ox + num(), c2y = oy + num(), ex = ox + num(), ey = oy + num();
        for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
          push(a * x + b * c1x + c * c2x + e * ex, a * y + b * c1y + c * c2y + e * ey); }
        lcx = c2x; lcy = c2y; x = ex; y = ey;
      } else if (C === "A") { num(); num(); num(); num(); num(); x = ox + num(); y = oy + num(); push(x, y); }
      else { i++; }
      last = C;
    }
    if (cur && cur.length >= 4) rings.push(cur);
    return rings;
  }

  /* ---------- images (photos placed on the canvas) ---------- */
  const IMGS = new Map();
  function img(src) {
    let m = IMGS.get(src);
    if (!m) { m = new Image(); m.onload = () => { dirty = true; }; m.src = src; IMGS.set(src, m); if (IMGS.size > 200) IMGS.delete(IMGS.keys().next().value); }
    return m.complete && m.naturalWidth ? m : null;
  }

  /* ---------- state ---------- */
  let app = null, svg = null, host = null, c2d = null, g2 = null, cgl = null, gl = null, U = {}, tex = null, gtex = null;
  let glOK = false, off = false, dirty = true, hud = null, hudDepth = null, hudMag = null, hudBtn = null;
  const gMid = document.createElement("canvas"), gSm = document.createElement("canvas");
  const gMidC = gMid.getContext("2d"), gSmC = gSm.getContext("2d");
  const focus = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, lx: -1, ly: -1, hover: -1e9 };
  let dpr = Math.min(devicePixelRatio || 1, 2), glS = dpr, fps = 60, qT = 0, last = performance.now();
  let lastKey = null, lastView = "", W = 0, H = 0, vw = { sc: 1, ox: 0, oy: 0 };
  let rv = null, viewChangedAt = 0, lastFull = 0, cssScale = 1;   // rv: the view the canvas was last drawn at
  const stats = { drawn: 0, culled: 0, ms: 0 };
  window.__ifRender = stats;

  function initGL() {
    try { gl = cgl.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false }); } catch (e) { gl = null; }
    if (!gl) return;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    try {
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ["u_tex", "u_glow", "u_gt", "u_res", "u_f", "u_t", "u_style", "u_dpr", "u_xf"]) U[n] = gl.getUniformLocation(pr, n);
      const mk = (unit, filter) => { const t = gl.createTexture(); gl.activeTexture(unit); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      tex = mk(gl.TEXTURE0, gl.NEAREST); gl.uniform1i(U.u_tex, 0);
      gtex = mk(gl.TEXTURE1, gl.LINEAR); gl.uniform1i(U.u_glow, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform4f(U.u_xf, 1, 1, 0, 0);
      glOK = true;
    } catch (e) { console.warn("Foveated shader off:", e); gl = null; glOK = false; }
  }

  function mount() {
    host = svg.parentNode;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const css = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;z-index:1";
    c2d = document.createElement("canvas"); c2d.setAttribute("aria-hidden", "true"); c2d.style.cssText = css;
    cgl = document.createElement("canvas"); cgl.setAttribute("aria-hidden", "true"); cgl.style.cssText = css;
    svg.insertAdjacentElement("afterend", c2d); c2d.insertAdjacentElement("afterend", cgl);
    g2 = c2d.getContext("2d");
    hud = document.createElement("div");
    hud.style.cssText = "position:absolute;left:10px;top:10px;z-index:2;display:flex;align-items:center;gap:8px;pointer-events:none;font:500 10px 'JetBrains Mono',ui-monospace,monospace;color:#9aa0aa;text-shadow:0 0 4px #050507,0 0 10px #050507";
    hud.innerHTML = '<span><b style="font-weight:600;color:#e9eaee;font-size:13px">DEPTH <span data-d>0</span></b> <span data-m>×1.0</span></span>';
    hudBtn = document.createElement("button");
    hudBtn.type = "button"; hudBtn.title = "Edge style: Prism, Blocks or Off";
    hudBtn.style.cssText = "pointer-events:auto;height:26px;padding:0 10px;border-radius:13px;border:1px solid rgba(255,255,255,.18);background:rgba(10,12,16,.7);color:#e9eaee;font:600 11px Manrope,system-ui,sans-serif;cursor:pointer";
    hudBtn.onclick = (e) => { e.stopPropagation(); setStyle((style + 2) % 3); };
    hud.appendChild(hudBtn); host.appendChild(hud);
    hudDepth = hud.querySelector("[data-d]"); hudMag = hud.querySelector("[data-m]");
    setStyle(style);
    initGL();
    // hand drawing over: the SVG keeps only the curve shapes used for tapping
    svg.style.opacity = "0";
    window.__ifFast = true;
    app.forceUpdate();
    addEventListener("pointermove", onPtr, { passive: true });
    addEventListener("pointerdown", onPtr, { passive: true });
    dirty = true;
  }

  function giveBack(err) {
    console.warn("Fast renderer off, using the app's SVG:", err);
    off = true; window.__ifFast = false;
    if (svg) svg.style.opacity = "";
    if (c2d) c2d.style.display = "none"; if (cgl) cgl.style.display = "none";
    try { app && app.forceUpdate(); } catch (e) {}
  }

  function setStyle(v) {
    style = v; hudBtn.textContent = STYLES[v]; hudBtn.setAttribute("aria-pressed", v > 0 ? "true" : "false");
    try { localStorage.setItem("if-fov-style", String(v)); } catch (e) {}
    dirty = true;
  }

  function onPtr(e) {
    if (!host) return;
    const r = host.getBoundingClientRect();
    if (e.clientX < r.left || e.clientY < r.top || e.clientX > r.right || e.clientY > r.bottom) return;
    focus.tx = (e.clientX - r.left) / r.width; focus.ty = (e.clientY - r.top) / r.height; focus.hover = performance.now();
  }

  /* ---------- drawing (mirrors the app's art() for the 2D view) ---------- */
  function keyOf(s) { return [s.B, s.frames, s.drafts, s.selected, s.viewing, s.onion, s.ghosts, s.tool, s.active, s.live, s.tr, s.dFrame]; }
  function sameKey(a, b) { if (!a || !b) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

  function itemTransform(p) {
    if (!p.t) return;
    const t = p.t;
    g2.translate(t.x, t.y); g2.translate(p.cx, p.cy); g2.rotate(t.r * Math.PI / 180); g2.scale(t.s, t.s); g2.translate(-p.cx, -p.cy);
  }
  // detail level for a box at screen rect (x0,y0,x1,y1): sharp near focus, coarse far away
  function levelFor(x0, y0, x1, y1) {
    let tolPx = 0.45;
    if (style > 0) {
      const fx = focus.x * W, fy = focus.y * H, R = Math.max(120, 0.36 * Math.min(W, H));
      const dx = Math.max(x0 - fx, 0, fx - x1), dy = Math.max(y0 - fy, 0, fy - y1);
      const t = Math.min(1, Math.max(0, (Math.hypot(dx, dy) / R - 0.6) / 1.2));
      tolPx = 0.45 + 5 * t * t * (3 - 2 * t);
    }
    const k = Math.floor(Math.log2(tolPx / vw.sc / 0.15));
    return k < 0 ? 0 : k > 16 ? 16 : k;
  }
  // screen rect of a shape's bounds (item transform t applied when given), or null when off screen
  function onScreen(bb, pad, p) {
    let x0 = bb[0] - pad, y0 = bb[1] - pad, x1 = bb[2] + pad, y1 = bb[3] + pad;
    if (p && p.t) {
      const t = p.t, a = t.r * Math.PI / 180, c = Math.cos(a) * t.s, s = Math.sin(a) * t.s;
      let X0 = 1e9, Y0 = 1e9, X1 = -1e9, Y1 = -1e9;
      for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        const dx = px - p.cx, dy = py - p.cy, X = t.x + p.cx + c * dx - s * dy, Y = t.y + p.cy + s * dx + c * dy;
        if (X < X0) X0 = X; if (Y < Y0) Y0 = Y; if (X > X1) X1 = X; if (Y > Y1) Y1 = Y;
      }
      x0 = X0; y0 = Y0; x1 = X1; y1 = Y1;
    }
    x0 = x0 * vw.sc + vw.ox; y0 = y0 * vw.sc + vw.oy; x1 = x1 * vw.sc + vw.ox; y1 = y1 * vw.sc + vw.oy;
    if (x0 > W || y0 > H || x1 < 0 || y1 < 0) return null;
    return [x0, y0, x1, y1];
  }
  // detail level, also accounting for an item's own scale
  function levelForItem(r, p) { const k = levelFor(r[0], r[1], r[2], r[3]) - (p && p.t && p.t.s > 0 ? Math.round(Math.log2(p.t.s)) : 0); return k < 0 ? 0 : k; }

  function drawItems(list, alpha, Bmap) {
    if (!list || !list.length) return;
    const st = app.state;
    g2.globalAlpha = alpha;
    let clipB = undefined;
    for (let idx = 0; idx < list.length; idx++) {
      let p = list[idx];
      if (p.type === "boundary") continue;
      p = (st.tr && st.tr[p.id]) || p;
      const b = p.b || null;
      if (b !== clipB) {
        if (clipB !== undefined) g2.restore();
        g2.save(); clipB = b;
        if (b && Bmap.has(b)) g2.clip(exactPath(shape(Bmap.get(b).d)));
      }
      g2.save();
      itemTransform(p);
      if (p.type === "stroke") {
        const s = shape(p.d), pad = (p.w || 1) / 2;
        const r = onScreen(s.bb, pad, p);
        if (!r) { stats.culled++; g2.restore(); continue; }
        g2.strokeStyle = p.color; g2.lineWidth = p.w || 1; g2.lineCap = "round"; g2.lineJoin = "round";
        g2.stroke(lodPath(s, levelForItem(r, p), false)); stats.drawn++;
      } else if (p.type === "vector") {
        for (const c of p.paths || []) {
          const s = shape(c.d);
          const r = onScreen(s.bb, 0, p);
          if (!r || (r[2] - r[0] < 0.6 && r[3] - r[1] < 0.6)) { stats.culled++; continue; }
          g2.fillStyle = c.color; g2.fill(lodPath(s, levelForItem(r, p), true), "evenodd"); stats.drawn++;
        }
      } else if (p.type === "image" && p.src) {
        const im = img(p.src);
        if (im) {
          const ar = im.naturalWidth / im.naturalHeight, box = p.w / p.h;
          let sw = im.naturalWidth, sh = im.naturalHeight, sx = 0, sy = 0;
          if (ar > box) { sw = sh * box; sx = (im.naturalWidth - sw) / 2; } else { sh = sw / box; sy = (im.naturalHeight - sh) / 2; }
          g2.drawImage(im, sx, sy, sw, sh, p.x, p.y, p.w, p.h); stats.drawn++;
        }
      }
      g2.restore();
    }
    if (clipB !== undefined) g2.restore();
    g2.globalAlpha = 1;
  }

  function outline(d, color, alpha, px, dash) {
    g2.globalAlpha = alpha; g2.strokeStyle = color; g2.lineWidth = px / vw.sc;
    g2.setLineDash(dash ? dash.map(v => v / vw.sc) : []);
    g2.stroke(exactPath(shape(d)));
    g2.setLineDash([]); g2.globalAlpha = 1;
  }

  // regions, onion ghosts, the frame's pieces, drafts and outlines, in the app's order.
  // thumb: the frame-strip look (no onion, no selection, thinner outlines)
  function paint(n, thumb) {
    const st = app.state;
    const isD = n === app.dIdx(), drafts = isD ? st.drafts : [];
    const Bs = [...st.B, ...drafts.filter(f => f.type === "boundary")];
    const Bmap = new Map(); for (const b of Bs) Bmap.set(b.id, b);
    for (const b of Bs) {
      const s = shape(b.d); if (!onScreen(s.bb, 2)) continue;
      const sel = !thumb && st.selected === b.id;
      g2.fillStyle = "rgba(5,6,9,.66)"; g2.fill(exactPath(s));
      outline(b.d, b.color, thumb ? 0.35 : sel ? 1 : 0.55, sel ? 3 : 1.4, b.draft ? [8, 6] : null);
    }
    if (!thumb && st.onion) for (let w = st.ghosts; w >= 1; w--) { const N = n - w; if (N >= 0 && st.frames[N]) drawItems(st.frames[N].items, ONION[w - 1], Bmap); }
    if (st.frames[n]) drawItems(st.frames[n].items, 1, Bmap);
    if (drafts.length) drawItems(drafts, 1, Bmap);
    if (!thumb) for (const b of Bs) { if (!onScreen(shape(b.d).bb, 2)) continue; outline(b.d, b.color, st.selected === b.id ? 0.9 : 0.45, 1.2, b.draft ? [8, 6] : null); }
    return { drafts, Bmap };
  }

  // frame-strip thumbnails as small cached pictures instead of a full SVG copy of each frame
  const THUMBS = new Map(), tc = document.createElement("canvas"), TS = 120;
  tc.width = tc.height = TS;
  window.__ifThumb = (n) => {
    try {
      const st = app && app.state; if (!st || !st.frames[n] || off) return "";
      const isD = n === app.dIdx(), key = [st.frames[n].items, st.B, isD ? st.drafts : null, st.tr];
      const hit = THUMBS.get(n);
      if (hit && sameKey(hit.key, key)) return hit.url;
      const save = { g2, vw: { ...vw }, W, H, style };
      g2 = tc.getContext("2d"); W = H = TS; vw.sc = TS / 1000; vw.ox = 0; vw.oy = 0; style = 0;
      g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, TS, TS);
      g2.setTransform(vw.sc, 0, 0, vw.sc, 0, 0);
      paint(n, true);
      g2 = save.g2; vw.sc = save.vw.sc; vw.ox = save.vw.ox; vw.oy = save.vw.oy; W = save.W; H = save.H; style = save.style;
      const url = tc.toDataURL("image/png");
      THUMBS.set(n, { key, url });
      return url;
    } catch (e) { return ""; }
  };

  function render() {
    const t0 = performance.now();
    stats.drawn = stats.culled = 0;
    const st = app.state, n = st.viewing;
    const v = app.cv(), k = 1000 / v.z;
    rv = { x: v.x, y: v.y, z: v.z }; lastFull = performance.now();
    c2d.style.transform = ""; cgl.style.transform = "";
    vw.sc = Math.min(W / k, H / k);
    vw.ox = W / 2 - (v.x) * vw.sc; vw.oy = H / 2 - (v.y) * vw.sc;
    g2.setTransform(1, 0, 0, 1, 0, 0);
    g2.fillStyle = BGHEX; g2.fillRect(0, 0, c2d.width, c2d.height);
    g2.setTransform(dpr * vw.sc, 0, 0, dpr * vw.sc, dpr * vw.ox, dpr * vw.oy);
    const { drafts, Bmap } = paint(n, false);
    // the draft being adjusted
    if (st.tool === "adjust" && st.active) {
      const f = drafts.find(x => x.id === st.active);
      if (f && app.itemBox) {
        const bx = app.itemBox(f);
        g2.save(); itemTransform(f);
        g2.strokeStyle = "#fff"; g2.lineWidth = 1.5 / vw.sc / ((f.t && f.t.s) || 1); g2.setLineDash([6 / vw.sc, 5 / vw.sc]);
        g2.strokeRect(bx.x - 6, bx.y - 6, bx.w + 12, bx.h + 12); g2.setLineDash([]); g2.restore();
      }
    }
    // the line being drawn right now
    if (st.live && st.live.pts && st.live.pts.length) {
      const f = st.live, d = app.line(f.pts), path = new Path2D(d);
      g2.save();
      if (f.type === "stroke") {
        if (f.b && Bmap.has(f.b)) g2.clip(exactPath(shape(Bmap.get(f.b).d)));
        g2.strokeStyle = f.color; g2.lineWidth = f.w; g2.lineCap = "round"; g2.lineJoin = "round"; g2.stroke(path);
      } else {
        g2.strokeStyle = "#fff"; g2.lineWidth = 2 / vw.sc; g2.setLineDash([6 / vw.sc, 5 / vw.sc]); g2.stroke(path); g2.setLineDash([]);
      }
      g2.restore();
    }
    stats.ms = performance.now() - t0;
    focus.lx = focus.x; focus.ly = focus.y;
  }

  function upload() {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2d);
    if (style === 2) {
      const mw = Math.max(1, Math.ceil(c2d.width / 3)), mh = Math.max(1, Math.ceil(c2d.height / 3));
      const sw = Math.max(1, Math.ceil(c2d.width / 6)), sh = Math.max(1, Math.ceil(c2d.height / 6));
      if (gMid.width !== mw || gMid.height !== mh) { gMid.width = mw; gMid.height = mh; }
      if (gSm.width !== sw || gSm.height !== sh) { gSm.width = sw; gSm.height = sh; }
      gMidC.drawImage(c2d, 0, 0, mw, mh); gSmC.drawImage(gMid, 0, 0, sw, sh);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, gtex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gSm);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  function hudUpdate(z) {
    const d = Math.max(0, Math.floor(Math.log(z) / Math.log(LV) + 1e-9));
    hudDepth.textContent = d;
    const m = z < 1000 ? z.toFixed(z < 10 ? 1 : 0) : (z / 1000).toFixed(1) + "K";
    hudMag.textContent = "×" + m + " · " + (z / Math.pow(LV, d)).toFixed(2) + " of 8×";
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (off) return;
    try { step(now); } catch (e) { giveBack(e); }
  }

  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; fps = fps * 0.92 + 0.08 / Math.max(dt, 1e-3);
    const a = window.__ifApp;
    if (!a) return;
    if (a !== app || !a.svgEl || a.svgEl !== svg) {
      const s = a.svgEl; if (!s || !s.parentNode) return;
      for (const el of [c2d, cgl, hud]) if (el && el.parentNode) el.remove();
      app = a; svg = s; mount();
    }
    if (svg.style.opacity !== "0") svg.style.opacity = "0";
    const st = app.state;
    const z = app.cv().z || 1;
    const in2d = st.mode === "2d";
    hud.style.display = in2d && !(st.pull > 0.02) ? "flex" : "none";
    if (in2d) hudUpdate(z);

    // size the canvases to the host box (layout pixels; the app may scale its frame with CSS)
    const r = host.getBoundingClientRect();
    const cw = host.clientWidth || r.width, ch = host.clientHeight || r.height;
    const scaleCss = cw ? r.width / cw : 1; cssScale = scaleCss;
    const want2 = Math.max(1, Math.round(cw * scaleCss * dpr)), wantH = Math.max(1, Math.round(ch * scaleCss * dpr));
    if (c2d.width !== want2 || c2d.height !== wantH) { c2d.width = want2; c2d.height = wantH; dirty = true; }
    W = c2d.width / dpr; H = c2d.height / dpr;

    // focus follows the finger or pointer; idle, it drifts slowly round the middle
    const moving = !!(app.pinch || (app.drag && app.drag.moved) || app.tweening || st.live);
    const engaged = now - focus.hover < 1200 || moving;
    let fx = focus.tx, fy = focus.ty, rate = 14;
    if (!engaged) { const u = reduceMotion ? 0 : now / 1000; fx = 0.5 + 0.22 * Math.sin(u * 0.13); fy = 0.5 + 0.22 * Math.sin(u * 0.17 + 1.3); rate = 0.7; }
    const k = 1 - Math.exp(-dt * rate); focus.x += (fx - focus.x) * k; focus.y += (fy - focus.y) * k;

    const v = app.cv(), vs = v.x + "," + v.y + "," + v.z;
    const key = keyOf(st);
    if (!sameKey(key, lastKey)) { dirty = true; lastKey = key; }
    if (vs !== lastView) { lastView = vs; viewChangedAt = now; }
    const gesturing = now - viewChangedAt < 140 && !st.live;
    const viewStale = rv && (rv.x !== v.x || rv.y !== v.y || rv.z !== v.z);
    if (style > 0 && !gesturing && Math.hypot((focus.x - focus.lx) * W, (focus.y - focus.ly) * H) > 28) dirty = true;
    if (!rv || dirty || (viewStale && (!gesturing || now - lastFull > 350))) { dirty = false; render(); if (glOK) upload(); }
    else if (viewStale) {
      // slide and scale the last frame to the current view; cheap, no redraw
      const k1 = 1000 / v.z, k0 = 1000 / rv.z, sc1 = Math.min(W / k1, H / k1), s = (1000 / k1) / (1000 / k0);
      const dx = (rv.x - v.x) * sc1 / cssScale, dy = (rv.y - v.y) * sc1 / cssScale;
      const tf = "translate(" + dx.toFixed(2) + "px," + dy.toFixed(2) + "px) scale(" + s.toFixed(5) + ")";
      c2d.style.transform = tf; cgl.style.transform = tf;
    }

    const useGL = glOK && style > 0 && in2d && !(st.pull > 0);
    c2d.style.visibility = useGL ? "hidden" : "visible";
    cgl.style.visibility = useGL ? "visible" : "hidden";
    if (!useGL) return;
    const gw = Math.max(1, Math.round(W * glS)), gh = Math.max(1, Math.round(H * glS));
    if (cgl.width !== gw || cgl.height !== gh) { cgl.width = gw; cgl.height = gh; }
    const foci = new Float32Array(16);
    foci[0] = focus.x * gw; foci[1] = (1 - focus.y) * gh; foci[2] = Math.max(120, 0.36 * Math.min(W, H)) * glS; foci[3] = 1;
    gl.viewport(0, 0, gw, gh);
    gl.uniform2f(U.u_res, gw, gh);
    gl.uniform4fv(U.u_f, foci);
    gl.uniform2f(U.u_gt, 1 / Math.max(1, gSm.width), 1 / Math.max(1, gSm.height));
    gl.uniform1f(U.u_t, reduceMotion ? 0 : now / 1000);
    gl.uniform1f(U.u_style, style);
    gl.uniform1f(U.u_dpr, glS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // keep phones smooth: lower the shader's resolution if the frame rate sags
    if (now - qT > 2500) { qT = now; if (fps < 40 && glS > 1) glS = Math.max(1, glS * 0.67); }
  }
  requestAnimationFrame(frame);
})();
