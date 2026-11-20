/* Infinite Frames: foveated layer.
 *
 * Ported from the Foveated Zoom prototype. The main app keeps drawing its 2D
 * canvas as SVG and keeps all of its own interaction (curves, drawing, drafts,
 * frames, onion skin, chat, 3D). This module sits on top of that SVG:
 *
 *  - When the view is still, it rasterises the app's SVG once and runs it through
 *    the Foveated Zoom shader: detail stays sharp around your finger or pointer
 *    and dissolves into prism sparkles (or dithered blocks) toward the edges.
 *  - While you pan or zoom, the last raster is moved and scaled with the view in
 *    the shader, so the effect follows without re-rasterising every frame. It is
 *    hidden while you draw, so live strokes are never covered.
 *  - A small readout shows depth in 8x levels and total magnification, like
 *    Foveated Zoom, with a Prism / Blocks / Off switch (remembered per browser).
 *
 * It reads the app through window.__ifApp (set in the app's constructor) and
 * never writes to the app's state or database. If WebGL or rasterising fails, it
 * switches itself off and the plain SVG view is what you see.
 */
(() => {
  "use strict";
  const LV = 8;
  const STYLES = ["Off", "Blocks", "Prism"];
  const BGHEX = "#050507";
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let style = 2;
  try { const s = localStorage.getItem("if-fov-style"); if (s != null && STYLES[+s]) style = +s; } catch (e) {}

  const FS = `__FS__`;
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

  let app = null, svg = null, host = null, cv = null, gl = null, U = {}, tex = null, gtex = null, broken = false;
  let hud = null, hudDepth = null, hudMag = null, hudBtn = null;
  const ras = document.createElement("canvas"), rctx = ras.getContext("2d");
  const gMid = document.createElement("canvas"), gSm = document.createElement("canvas");
  const gMidC = gMid.getContext("2d"), gSmC = gSm.getContext("2d");
  let rasVB = null;          // viewBox the current raster was taken at
  let rasKey = null;         // state identity the raster was taken at
  let rasBusy = false, haveRaster = false;
  let lastChange = 0, lastVBs = "", lastKey = null;
  let shown = 0;             // overlay opacity 0..1
  const focus = { x: 0, y: 0, tx: 0, ty: 0, hover: -1e9 };
  let glS = Math.min(devicePixelRatio || 1, 2), fps = 60, qT = 0, last = performance.now();

  function initGL() {
    try { gl = cv.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false }); } catch (e) { gl = null; }
    if (!gl) { broken = true; return; }
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
      tex = mk(gl.TEXTURE0, gl.LINEAR); gl.uniform1i(U.u_tex, 0);
      gtex = mk(gl.TEXTURE1, gl.LINEAR); gl.uniform1i(U.u_glow, 1);
      gl.activeTexture(gl.TEXTURE0);
    } catch (e) { console.warn("Foveated layer off:", e); gl = null; broken = true; }
  }

  function mount() {
    host = svg.parentNode;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    cv = document.createElement("canvas");
    cv.setAttribute("aria-hidden", "true");
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;z-index:1;display:block";
    svg.insertAdjacentElement("afterend", cv);
    hud = document.createElement("div");
    hud.style.cssText = "position:absolute;left:10px;top:10px;z-index:2;display:flex;align-items:center;gap:8px;pointer-events:none;font:500 10px 'JetBrains Mono',ui-monospace,monospace;color:#9aa0aa;text-shadow:0 0 4px #050507,0 0 10px #050507";
    hud.innerHTML = '<span><b style="font-weight:600;color:#e9eaee;font-size:13px">DEPTH <span data-d>0</span></b> <span data-m>×1.0</span></span>';
    hudBtn = document.createElement("button");
    hudBtn.type = "button";
    hudBtn.title = "Edge style: Prism, Blocks or Off";
    hudBtn.style.cssText = "pointer-events:auto;height:26px;padding:0 10px;border-radius:13px;border:1px solid rgba(255,255,255,.18);background:rgba(10,12,16,.7);color:#e9eaee;font:600 11px Manrope,system-ui,sans-serif;cursor:pointer";
    hudBtn.onclick = (e) => { e.stopPropagation(); setStyle((style + 2) % 3); };
    hud.appendChild(hudBtn);
    host.appendChild(hud);
    hudDepth = hud.querySelector("[data-d]"); hudMag = hud.querySelector("[data-m]");
    setStyle(style);
    initGL();
    addEventListener("pointermove", onPtr, { passive: true });
    addEventListener("pointerdown", onPtr, { passive: true });
  }

  function setStyle(v) {
    style = v; hudBtn.textContent = STYLES[v];
    hudBtn.setAttribute("aria-pressed", v > 0 ? "true" : "false");
    try { localStorage.setItem("if-fov-style", String(v)); } catch (e) {}
  }

  function onPtr(e) {
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientY < r.top || e.clientX > r.right || e.clientY > r.bottom) return;
    focus.tx = (e.clientX - r.left) / r.width; focus.ty = (e.clientY - r.top) / r.height;
    focus.hover = performance.now();
  }

  // State the raster depends on. Any change re-rasterises once things settle.
  function keyOf(s) { return [s.B, s.frames, s.drafts, s.selected, s.viewing, s.onion, s.ghosts, s.tool, s.active, s.places, s.pin]; }
  function sameKey(a, b) { if (!a || !b) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function vbOf() { const b = svg.viewBox && svg.viewBox.baseVal; return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; }

  function sizeCanvas(r) {
    const w = Math.max(1, Math.round(r.width * glS)), h = Math.max(1, Math.round(r.height * glS));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; return true; }
    return false;
  }

  function rasterize() {
    if (rasBusy || broken) return;
    const r = svg.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    rasBusy = true;
    const vb = vbOf(), key = keyOf(app.state);
    let src;
    try {
      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(cv.width)); clone.setAttribute("height", String(cv.height));
      clone.removeAttribute("style");
      src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    } catch (e) { rasBusy = false; broken = true; return; }
    const img = new Image();
    img.onload = () => {
      try {
        ras.width = cv.width; ras.height = cv.height;
        rctx.fillStyle = BGHEX; rctx.fillRect(0, 0, ras.width, ras.height);
        rctx.drawImage(img, 0, 0, ras.width, ras.height);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ras);
        const mw = Math.max(1, Math.ceil(ras.width / 3)), mh = Math.max(1, Math.ceil(ras.height / 3));
        const sw = Math.max(1, Math.ceil(ras.width / 6)), sh = Math.max(1, Math.ceil(ras.height / 6));
        gMid.width = mw; gMid.height = mh; gSm.width = sw; gSm.height = sh;
        gMidC.drawImage(ras, 0, 0, mw, mh); gSmC.drawImage(gMid, 0, 0, sw, sh);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, gtex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gSm);
        gl.activeTexture(gl.TEXTURE0);
        rasVB = vb; rasKey = key; haveRaster = true;
      } catch (e) { console.warn("Foveated layer off (raster):", e); broken = true; }
      rasBusy = false;
    };
    img.onerror = () => { rasBusy = false; broken = true; };
    img.src = src;
  }

  // Map current screen uv -> raster uv, from the raster's viewBox to the current one.
  // The SVG keeps its default preserveAspectRatio (meet), so both use the same fit.
  function xform(r, vb) {
    if (!rasVB || !vb) return [1, 1, 0, 0];
    const W = r.width, H = r.height;
    const fit0 = Math.min(W / rasVB.w, H / rasVB.h), fit1 = Math.min(W / vb.w, H / vb.h);
    const s = fit0 / fit1;                                   // raster px per current px
    const c0x = rasVB.x + rasVB.w / 2, c0y = rasVB.y + rasVB.h / 2, c1x = vb.x + vb.w / 2, c1y = vb.y + vb.h / 2;
    const ox = 0.5 - 0.5 * s + (c1x - c0x) * fit0 / W;
    const oy = 0.5 - 0.5 * s - (c1y - c0y) * fit0 / H;   // texture v runs bottom-up
    return [s, s, ox, oy];
  }

  function hudUpdate(z) {
    const d = Math.max(0, Math.floor(Math.log(z) / Math.log(LV) + 1e-9));
    hudDepth.textContent = d;
    const m = z < 1000 ? z.toFixed(z < 10 ? 1 : 0) : (z / 1000).toFixed(1) + "K";
    hudMag.textContent = "×" + m + " · " + (z / Math.pow(LV, d)).toFixed(2) + " of 8×";
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; fps = fps * 0.92 + 0.08 / Math.max(dt, 1e-3);
    const a = window.__ifApp;
    if (!a) return;
    if (a !== app || !a.svgEl || a.svgEl !== svg) {
      app = a; const s = a.svgEl; if (!s || !s.parentNode) return;
      if (cv && cv.parentNode) cv.remove(); if (hud && hud.parentNode) hud.remove();
      svg = s; rasVB = null; haveRaster = false; mount();
    }
    const st = app.state;
    const in2d = st.mode === "2d" && !(st.pull > 0.02);
    if (hud) hud.style.display = in2d ? "flex" : "none";
    const z = (app.cv ? app.cv() : st.view).z || 1;
    if (hud && in2d) hudUpdate(z);
    if (!cv || broken || !gl || !in2d || style === 0) { if (cv) { shown = 0; cv.style.opacity = "0"; } return; }

    const r = svg.getBoundingClientRect();
    const resized = sizeCanvas(r);
    const vb = vbOf(), vbs = vb ? vb.x + "," + vb.y + "," + vb.w : "";
    const key = keyOf(st);
    if (vbs !== lastVBs || !sameKey(key, lastKey) || resized) { lastChange = now; lastVBs = vbs; lastKey = key; }
    const drawing = !!st.live || !!app.adj;
    const moving = !!(app.pinch || (app.drag && app.drag.moved) || app.tweening);
    const settled = now - lastChange > 180 && !moving;
    if (settled && !drawing && (!haveRaster || !sameKey(key, rasKey) || !rasVB || vbs !== rasVB.x + "," + rasVB.y + "," + rasVB.w || resized)) rasterize();
    // a raster taken under different content is not shown, only a moved one
    const usable = haveRaster && sameKey(key, rasKey) && !drawing && !resized;
    const target = usable ? 1 : 0;
    shown += (target - shown) * Math.min(1, dt * (target ? 6 : 30));
    if (shown < 0.01 && !target) { shown = 0; cv.style.opacity = "0"; return; }
    cv.style.opacity = shown.toFixed(3);

    // focus: follow the pointer; when idle, drift slowly around the middle
    const engaged = now - focus.hover < 1200 || moving;
    let fx = focus.tx, fy = focus.ty, rate = 14;
    if (!engaged) { const u = reduceMotion ? 0 : now / 1000; fx = 0.5 + 0.22 * Math.sin(u * 0.13); fy = 0.5 + 0.22 * Math.sin(u * 0.17 + 1.3); rate = 0.7; }
    const k = 1 - Math.exp(-dt * rate); focus.x += (fx - focus.x) * k; focus.y += (fy - focus.y) * k;

    const xf = xform(r, vb);
    const fr = Math.max(120, 0.36 * Math.min(r.width, r.height)) * glS;
    const foci = new Float32Array(16);
    foci[0] = focus.x * cv.width; foci[1] = (1 - focus.y) * cv.height; foci[2] = fr; foci[3] = 1;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(U.u_res, cv.width, cv.height);
    gl.uniform4fv(U.u_f, foci);
    gl.uniform4f(U.u_xf, xf[0], xf[1], xf[2], xf[3]);
    gl.uniform2f(U.u_gt, 1 / Math.max(1, gSm.width), 1 / Math.max(1, gSm.height));
    gl.uniform1f(U.u_t, reduceMotion ? 0 : now / 1000);
    gl.uniform1f(U.u_style, style);
    gl.uniform1f(U.u_dpr, glS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // keep phones smooth: drop resolution if the frame rate sags
    if (now - qT > 2500) { qT = now; if (fps < 40 && glS > 1) { glS = Math.max(1, glS * 0.67); haveRaster = false; } }
  }
  requestAnimationFrame(frame);
})();
