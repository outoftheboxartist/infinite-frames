/* Infinite Frames: image to nested curves.
 *
 * The flow, using the app's own tracer and Publish:
 *  1. Select a curve (or draw a new one), then upload an image or take a photo.
 *  2. It is traced straight away into closed colour regions and placed in the curve,
 *     ready to move and scale (the app's adjust tool).
 *  3. Publish asks for the artwork's name and an optional prompt for others.
 *  4. Every traced region becomes its own curve, cropped to the edge of the curve it sits in,
 *     nested inside it (parent), named after the artwork and credited to you. The coloured
 *     artwork is published too, clipped to the same curve, so it looks the same as the preview.
 *  5. The prompt, if any, is posted as a chat pin on the artwork, so others see the invitation.
 *
 * Hooks (set by small patches in scripts/import-main-app.py):
 *   window.__ifAfterImage(app, draftId)   after an image is added to a curve
 *   window.__ifBeforePublish(app)         before Publish; resolve false to cancel
 *   window.__ifAfterPublish(app, boundaries, items, frameN)
 */
import polygonClipping from "polygon-clipping";

const MAX_REGIONS = 150;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const setStateP = (app, fn) => new Promise((r) => app.setState(fn, r));

/* ---------- 1-2: trace as soon as an image lands ---------- */
window.__ifAfterImage = async (app, id) => {
  // the image draft is active; wait for the app to settle, then trace it
  for (let i = 0; i < 40 && app.busy; i++) await wait(50);
  await wait(30);
  if (app.state.active !== id) return;
  try { await app.traceActive(); } catch (e) { return; }
  const d = app.state.drafts.find((x) => x.id === id);
  if (!d || d.type !== "vector") return; // tracing failed: the app has already said so
  app.setState({ active: id, tool: "adjust" });
  app.flashToast(d.paths.length + " colour regions traced. Drag to place it, resize with Bigger and Smaller, then Publish.");
};

// nothing was selected: the app made a new rectangle window for the image; trace the newest image there
window.__ifAfterBatch = async (app) => {
  for (let i = 0; i < 40 && app.busy; i++) await wait(50);
  const img = [...app.state.drafts].reverse().find((d) => d.type === "image" && !d.gif);
  if (!img) return;
  await setStateP(app, () => ({ active: img.id, selected: img.b, tool: "adjust" }));
  window.__ifAfterImage(app, img.id);
};

/* ---------- geometry ---------- */
// SVG path data -> list of rings [[x,y],...] (curves sampled)
function rings(d) {
  const tok = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const out = []; let cur = null, i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, last = "";
  const num = () => +tok[i++], isNum = () => i < tok.length && !/[a-zA-Z]/.test(tok[i]);
  const start = (px, py) => { if (cur && cur.length >= 3) out.push(cur); cur = [[px, py]]; sx = px; sy = py; };
  const push = (px, py) => { if (!cur) start(x, y); cur.push([px, py]); };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd !== cmd.toUpperCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "Z") { if (cur && cur.length >= 3) out.push(cur); cur = null; x = sx; y = sy; last = "Z"; continue; }
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
  if (cur && cur.length >= 3) out.push(cur);
  return out;
}
function area(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); }
function bboxOf(r) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of r) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; }

// the vector draft's placement (move, rotate, scale around its centre), as in the app's makeCurves
function placer(v) {
  const t = v.t || { x: 0, y: 0, s: 1, r: 0 }, cx = v.cx ?? 0, cy = v.cy ?? 0, R = (t.r * Math.PI) / 180, co = Math.cos(R), sn = Math.sin(R);
  return ([x, y]) => { const a = (x - cx) * t.s, b = (y - cy) * t.s; return [a * co - b * sn + cx + t.x, a * sn + b * co + cy + t.y]; };
}
const fmt = (n) => +n.toFixed(window.__ifDec || 2);
const toD = (ring) => "M" + ring.map(([x, y]) => fmt(x) + "," + fmt(y)).join("L") + "Z";

// every traced region of v, placed, cropped to the parent curve: [{d, color, area}]
function nestedRegions(v, parent) {
  const parentRings = rings(parent.d).filter((r) => r.length >= 3);
  if (!parentRings.length) return [];
  const parentPoly = parentRings.map((r) => [r]);           // multipolygon
  const parentArea = parentRings.reduce((s, r) => s + area(r), 0);
  const P = placer(v), out = [], seen = new Set();
  for (const layer of v.paths || []) {
    for (const ring of rings(layer.d)) {
      const placed = ring.map(P);
      if (area(placed) < parentArea * 0.0004) continue;      // specks
      let clipped;
      try { clipped = polygonClipping.intersection([placed], parentPoly); } catch (e) { continue; }
      for (const poly of clipped) {
        const outer = poly[0];
        if (!outer || outer.length < 4) continue;
        const a = area(outer);
        if (a < parentArea * 0.0004) continue;
        const key = bboxOf(outer).map(Math.round).join();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ d: toD(outer.slice(0, -1)), color: layer.color, area: a });
      }
    }
  }
  return out.sort((a, b) => b.area - a.area).slice(0, MAX_REGIONS);
}

window.__ifNested = nestedRegions; // also used to import video frames

/* ---------- 3D layers: inline copies of image files ----------
 * The 3D view draws each frame as one SVG picture, and an SVG picture cannot load image
 * files from elsewhere. So each image is loaded once, shrunk, and inlined as a data URL.
 * Until it is ready the original address is used (blank in 3D), then the layers redraw. */
const layerCache = new Map(); // src -> data URL | "pending" | "failed"
window.__ifLayerSrc = (src, app) => {
  if (!src || src.startsWith("data:")) return src;
  const hit = layerCache.get(src);
  if (hit && hit !== "pending" && hit !== "failed") return hit;
  if (!hit) {
    layerCache.set(src, "pending");
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const k = Math.min(1, 768 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        layerCache.set(src, c.toDataURL("image/webp", 0.85));
        app._li = new WeakMap(); // drop cached layers so they redraw with the copy
        app.forceUpdate();
      } catch (e) { layerCache.set(src, "failed"); }
    };
    im.onerror = () => layerCache.set(src, "failed");
    im.src = src;
  }
  return src;
};

/* ---------- 3: name the artwork ---------- */
function ask(regionCount) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true"); wrap.setAttribute("aria-labelledby", "ifn-title");
    wrap.style.cssText = "position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(5,5,7,.6);padding:16px";
    wrap.innerHTML = `
<form style="width:min(360px,100%);display:grid;gap:12px;padding:18px;border-radius:18px;background:#0e1014;border:1px solid rgba(255,255,255,.14);color:#e9eaee;font:500 14px Manrope,system-ui,sans-serif">
  <div id="ifn-title" style="font:800 20px Syne,Manrope,sans-serif">Name your artwork</div>
  <div style="font-size:12px;color:#a6abb4;line-height:1.45">Its ${regionCount} traced shapes become curves inside this one, credited to you. Anyone can open them and keep going.</div>
  <label for="ifn-name" style="font:600 11px 'JetBrains Mono',monospace;letter-spacing:.08em;color:#a6abb4">NAME</label>
  <input id="ifn-name" required maxlength="60" autocomplete="off" style="height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#050507;color:#e9eaee;padding:0 12px;font:inherit">
  <label for="ifn-prompt" style="font:600 11px 'JetBrains Mono',monospace;letter-spacing:.08em;color:#a6abb4">PROMPT FOR OTHERS (OPTIONAL)</label>
  <textarea id="ifn-prompt" maxlength="280" rows="3" placeholder="For example: fill the blue square with your street" style="border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#050507;color:#e9eaee;padding:10px 12px;font:inherit;resize:vertical"></textarea>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button type="button" data-cancel style="height:40px;padding:0 16px;border-radius:20px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#e9eaee;font:700 13px inherit;cursor:pointer">Keep editing</button>
    <button type="submit" style="height:40px;padding:0 18px;border-radius:20px;border:0;background:linear-gradient(90deg,#a8ecff,#f5e3b0);color:#000;font:700 13px inherit;cursor:pointer">Publish</button>
  </div>
</form>`;
    const form = wrap.querySelector("form"), name = wrap.querySelector("#ifn-name"), prompt = wrap.querySelector("#ifn-prompt");
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector("[data-cancel]").onclick = () => done(null);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") done(null); });
    form.onsubmit = (e) => { e.preventDefault(); const n = name.value.trim(); if (!n) { name.focus(); return; } done({ name: n, prompt: prompt.value.trim() }); };
    document.body.appendChild(wrap);
    setTimeout(() => name.focus(), 30);
  });
}

/* ---------- 4: publish traced art as nested curves ---------- */
let pendingPrompts = [];
window.__ifBeforePublish = async (app) => {
  const st = app.state;
  const vecs = st.drafts.filter((d) => d.type === "vector" && d.paths && d.paths.length && !d.nested);
  if (!vecs.length) return true; // nothing traced: the app's normal Publish
  const plan = [];
  for (const v of vecs) {
    const parent = app.allB().find((b) => b.id === v.b);
    if (!parent) continue;
    plan.push({ v, parent, regions: nestedRegions(v, parent) });
  }
  const total = plan.reduce((s, p) => s + p.regions.length, 0);
  const answer = await ask(total);
  if (!answer) return false;
  const T0 = Date.now();
  const add = [];
  plan.forEach((p, k) => p.regions.forEach((r, i) => add.push({
    type: "boundary", id: "d" + T0 + "n" + k + "-" + i, d: r.d, color: r.color, palette: [r.color, "#f1f1f3"],
    draft: true, name: answer.name + " · " + (i + 1), founder: st.name, parent: p.parent.id, artwork: answer.name,
  })));
  const ids = new Set(vecs.map((v) => v.id));
  // a curve drawn just for this artwork takes the artwork's name
  const newParents = new Set(plan.map((p) => p.parent.id).filter((id) => st.drafts.some((d) => d.id === id && d.type === "boundary")));
  await setStateP(app, (s) => ({
    drafts: [...s.drafts.map((d) => (ids.has(d.id) ? { ...d, nested: true, title: answer.name, invite: answer.prompt || undefined }
      : newParents.has(d.id) ? { ...d, name: answer.name } : d)), ...add],
  }));
  pendingPrompts = answer.prompt ? [{ name: answer.name, prompt: answer.prompt, items: [...ids] }] : [];
  return true;
};

/* ---------- 5: the prompt becomes a pin on the artwork ---------- */
window.__ifAfterPublish = (app, boundaries, items) => {
  const todo = pendingPrompts; pendingPrompts = [];
  for (const p of todo) {
    const art = items.find((it) => it.title === p.name);
    const where = art && app.state.B.find((b) => b.id === art.b);
    const loc = where ? { ...app.focus(where.d), label: p.name } : undefined;
    const msg = { id: app.newId("m"), who: app.state.name, whoId: app.props.uid, text: p.prompt, idea: true, loc };
    app.props.backend.sendMessage(msg).catch((e) => console.warn("prompt not posted", e));
  }
};
