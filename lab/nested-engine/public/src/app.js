// App controller: input, editing, presence, camera flights, HUD.

import { Scene } from "./scene.js";
import { Sync } from "./sync.js";
import { Renderer } from "./renderer.js";
import { createCamera, rebase, panBy, zoomAt, clampZoom, localMatrix, animMatrix, rideAnchorAnim } from "./camera.js";
import { mul, inv, apply, scaleOf } from "./mat.js";
import { localBounds, containsLocal, simplify, normalize, round4, ringSpans } from "./geom.js";
import { WsBackend } from "./net-ws.js";
import { LocalBackend } from "./net-local.js";

const EPOCH = Date.UTC(2026, 0, 1);
const PALETTE = ["hsl(190 95% 55%)", "hsl(320 90% 62%)", "hsl(268 85% 66%)", "hsl(24 95% 58%)", "hsl(48 100% 66%)", "hsl(156 70% 52%)", "hsl(220 35% 92%)", "hsl(232 40% 16%)"];
const USER_COLORS = ["#3fd8ff", "#ff52b9", "#a866ff", "#ff9147", "#ffe07a", "#66e3b2"];
const $ = (id) => document.getElementById(id);

// ---- identity -------------------------------------------------------------------
function loadUser() {
  try {
    const u = JSON.parse(localStorage.getItem("if-lab-user") || "null");
    if (u && u.id && u.name) return u;
  } catch {}
  const id = newId();
  const u = { id, name: "Guest " + id.slice(0, 3).toUpperCase(), color: USER_COLORS[parseInt(id.slice(-2), 36) % USER_COLORS.length] };
  try { localStorage.setItem("if-lab-user", JSON.stringify(u)); } catch {}
  return u;
}

function newId() {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += (x % 36).toString(36);
  return s + Date.now().toString(36).slice(-3);
}

const user = loadUser();
const params = new URLSearchParams(location.search);
const live = params.get("mode") !== "demo" && (window.IF_LAB_SERVER === true || params.get("mode") === "live");
const backend = live
  ? new WsBackend((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws", user)
  : new LocalBackend(user, { svgBase: "svg/" });

const hud = {
  status: $("status"), statusText: $("status-text"), depth: $("depth"), zoom: $("zoom"),
  ladder: $("ladder"), people: $("people"), stats: $("stats"), dock: $("dock"), toast: $("toast"),
};

const scene = new Scene();
const sync = new Sync(scene, backend);
const canvas = $("stage");
const renderer = new Renderer(canvas);
const cam = createCamera("root");

const S = {
  mode: "explore", sel: null, reshape: false, color: PALETTE[0],
  seek: null, follow: null, users: new Map(), pointer: null,
  confirmDelete: false, recording: null, lastTap: null, t: 0,
};
let W = 1, H = 1;
let fitted = false;
const incoming = [];

function drainIncoming(budgetMs) {
  const t0 = performance.now();
  while (incoming.length) {
    const m = incoming[0];
    const end = Math.min(m.nodes.length, m.i + 500);
    const last = end >= m.nodes.length;
    scene.addNodes(m.i === end ? [] : m.nodes.slice(m.i, end), last ? m.parents : []);
    m.i = end;
    if (last) incoming.shift();
    if (!fitted && scene.get("root")) { fitted = true; fitRoot(); }
    if (performance.now() - t0 > budgetMs) break;
  }
}

// ---- backend wiring ------------------------------------------------------------------
backend.connect({
  onStatus(s) { setStatus(s); },
  onWelcome(m) {
    for (const p of m.users || []) S.users.set(p.id, { ...p, at: performance.now() });
    backend.load([null]);
    sync.resend();
  },
  onNodes(nodes, parents) {
    // Applied a slice per frame (see drainIncoming) so a big region arriving
    // never stalls a frame.
    incoming.push({ nodes, parents, i: 0 });
  },
  onOp(op, seq) { scene.applyRemote(op, seq); if (S.sel && !scene.get(S.sel)) S.sel = null; },
  onAck(cid, seq) { sync.onAck(cid, seq); },
  onReject(cid, reason) { sync.onReject(cid); toast("Change refused by server: " + reason); },
  onPresence(p) { if (p.id !== user.id) S.users.set(p.id, { ...p, at: performance.now() }); renderPeople(); },
  onLeave(id) { S.users.delete(id); if (S.follow === id) S.follow = null; renderPeople(); },
});

function fitRoot() {
  const r = scene.get("root");
  localBounds(r);
  cam.anchor = "root"; cam.cx = 0; cam.cy = 0; cam.cr = 0;
  cam.z = (0.46 * Math.min(W, H)) / r._hr;
}

// ---- sizing ----------------------------------------------------------------------------
function resize() {
  const rect = canvas.getBoundingClientRect();
  W = Math.max(1, rect.width); H = Math.max(1, rect.height);
  renderer.resize(W, H, Math.min(2, window.devicePixelRatio || 1));
}
new ResizeObserver(resize).observe(canvas);
resize();

// ---- matrices for any loaded node ------------------------------------------------------
function matOf(id) {
  return renderer.mats.get(id) || (renderer.chain && renderer.chain.mf.get(id)) || null;
}

function screenMatrixOf(id) {
  const direct = matOf(id);
  if (direct) return direct;
  const path = [];
  let n = scene.get(id);
  while (n && !matOf(n.id)) { path.push(n); n = n.parent ? scene.get(n.parent) : null; }
  if (!n) return null;
  let M = matOf(n.id);
  for (let i = path.length - 1; i >= 0; i--) M = mul(M, localMatrix(path[i], S.t));
  return M;
}

const sizeOf = (n, M) => { localBounds(n); return 2 * n._hr * scaleOf(M); };

// ---- picking ----------------------------------------------------------------------------
function pickAll(x, y, { minPx = 10, maxPx = Infinity } = {}) {
  const out = [];
  const d = renderer.drawn;
  for (let i = d.length - 1; i >= 0; i--) {
    const n = d[i];
    const M = renderer.mats.get(n.id);
    const size = sizeOf(n, M);
    if (size < minPx || size > maxPx) continue;
    const p = apply(inv(M), x, y);
    if (!containsLocal(n, p[0], p[1])) continue;
    if (!visibleThroughClips(n, x, y)) continue;
    out.push(n);
  }
  return out;
}

function visibleThroughClips(n, x, y) {
  let p = n.parent && scene.get(n.parent);
  for (let k = 0; p && k < 4; k++) {
    const M = matOf(p.id);
    if (!M) break;
    if (p.clip) {
      const l = apply(inv(M), x, y);
      if (!containsLocal(p, l[0], l[1])) return false;
    }
    p = p.parent && scene.get(p.parent);
  }
  return true;
}

// ---- camera flights ------------------------------------------------------------------------
// Seek a node-local point to the screen center at a node-local scale. Works
// across any number of levels: each frame re-reads where the target is now and
// moves a fraction of the way (log-space for zoom, so 10^27 takes seconds).
function seekTo(id, opts = {}) {
  S.seek = { id, lx: 0, ly: 0, scale: null, fit: 0.78, ...opts, pathAsked: false };
}

function seekStep(dt) {
  const tg = S.seek;
  const n = scene.get(tg.id);
  if (!n) {
    if (!tg.pathAsked) { backend.loadPath(tg.id); tg.pathAsked = true; }
    return;
  }
  const M = screenMatrixOf(tg.id);
  if (!M) { if (!tg.pathAsked) { backend.loadPath(tg.id); tg.pathAsked = true; } return; }
  localBounds(n);
  if (tg.fit) { tg.lx = n._cx; tg.ly = n._cy; tg.scale = (tg.fit * Math.min(W, H)) / (2 * n._hr); }
  const P = apply(M, tg.lx, tg.ly);
  const sc = scaleOf(M);
  const maxDim = Math.max(W, H);
  const dx = W / 2 - P[0], dy = H / 2 - P[1];
  const D = Math.hypot(dx, dy) / maxDim;
  const logZ = Math.log(tg.scale / sc);
  const kp = 1 - Math.exp(-dt * 4.5);
  let zstep;
  if (D > 0.3) zstep = Math.min(0, logZ) * kp - (D > 1.5 ? Math.min(Math.log(D), 3) * kp : 0);
  else zstep = logZ * (1 - Math.exp(-dt * 2.6));
  const cap = dt * 4.2;
  zstep = Math.max(-cap, Math.min(cap, zstep));
  const panK = kp * Math.min(1, 1.5 / Math.max(D, 1e-9));
  panBy(cam, dx * panK, dy * panK);
  zoomAt(cam, Math.exp(zstep), W / 2, H / 2, W, H);
  tg.age = (tg.age || 0) + dt;
  const arrived = D < 0.003 && Math.abs(logZ) < 0.015;
  const closeEnough = D < 0.03 && Math.abs(logZ) < 0.05 && tg.age > 2; // target is itself moving
  if ((arrived || closeEnough || tg.age > 40) && !tg.keep) S.seek = null;
}

async function dive() {
  S.follow = null;
  toast("Diving to the deepest shape…");
  const id = await backend.deepest();
  if (id) seekTo(id, { fit: 0.6 });
}

function home() { S.follow = null; seekTo("root", { fit: 0.92 }); }

function followStep() {
  const p = S.users.get(S.follow);
  if (!p || !p.view) return;
  const v = p.view;
  if (!S.seek || S.seek.id !== v.anchor || !S.seek.keep) S.seek = { id: v.anchor, lx: v.cx, ly: v.cy, scale: v.z, fit: 0, keep: true, pathAsked: false };
  else { S.seek.lx = v.cx; S.seek.ly = v.cy; S.seek.scale = v.z; }
}

function stopFlights() { S.seek = null; if (S.follow) { S.follow = null; renderPeople(); } }

// ---- frame loop ------------------------------------------------------------------------------
const vel = { x: 0, y: 0 };
let zoomQ = 0, zoomFx = 0, zoomFy = 0;
let last = performance.now();
let lastHud = 0, lastPresence = 0, lastEvict = 0, presenceKey = "";
const fpsWin = [];

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  const interval = now - last;
  last = now;
  const tPrev = S.t;
  S.t = (backend.now() - EPOCH) / 1000;
  if (tPrev) rideAnchorAnim(scene, cam, W, H, S.t, tPrev);

  if (!pointers.size && (vel.x || vel.y)) {
    panBy(cam, vel.x * dt, vel.y * dt);
    const k = Math.exp(-dt * 5);
    vel.x *= k; vel.y *= k;
    if (Math.hypot(vel.x, vel.y) < 8) vel.x = vel.y = 0;
  }
  if (Math.abs(zoomQ) > 1e-4) {
    const step = zoomQ * (1 - Math.exp(-dt * 16));
    zoomAt(cam, Math.exp(step), zoomFx, zoomFy, W, H);
    zoomQ -= step;
  }
  drainIncoming(4);
  if (S.follow) followStep();
  if (S.seek) seekStep(dt);
  clampZoom(scene, cam, W, H);
  rebase(scene, cam, W, H, S.t);

  renderer.render(scene, cam, S.t, now);
  drawOverlay();

  // network: loads, edits, presence
  if (renderer.wants.size && backend.ready && backend.inflightLoads() < 48) {
    const ids = [...renderer.wants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32).map((e) => e[0]);
    backend.load(ids);
  }
  sync.flush(now);
  if (now - lastPresence > 50) { lastPresence = now; sendPresence(); }
  if (now - lastEvict > 2000) {
    lastEvict = now;
    const keep = new Set(renderer.chain ? renderer.chain.chain.map((n) => n.id) : []);
    for (let id = S.sel; id; id = scene.get(id) && scene.get(id).parent) keep.add(id);
    scene.evict(250000, keep, now);
  }

  fpsWin.push(interval);
  if (fpsWin.length > 60) fpsWin.shift();
  if (S.recording) S.recording.push({ dt: interval, cpu: renderer.stats.cpu, drawn: renderer.stats.drawn, imp: renderer.stats.impostors, building: renderer.building.size, inq: incoming.length, scene: scene.size, depth: anchorDepth(), loading: backend.inflightLoads(), minPx: renderer.minPx });
  if (now - lastHud > 250) { lastHud = now; updateHud(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function anchorDepth() { const a = scene.get(cam.anchor); return a ? a.depth : 0; }

// log10 of magnification relative to the whole world fitting the screen
function zoomExponent() {
  if (!renderer.chain || !renderer.chain.top) return 0;
  const top = renderer.chain.top;
  const M = renderer.chain.mf.get(top.id);
  localBounds(top);
  return Math.log10(sizeOf(top, M) / Math.min(W, H));
}

// ---- overlay: selection, handles, cursors, stroke ---------------------------------------------
const ctx = canvas.getContext("2d");

function drawOverlay() {
  const dpr = renderer.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // other people's selections and cursors
  for (const p of S.users.values()) {
    if (p.sel) {
      const M = matOf(p.sel);
      if (M) outline(scene.get(p.sel), M, p.color, [3, 4]);
    }
    if (p.cur) {
      for (const [id, lx, ly] of p.cur) {
        const M = matOf(id);
        if (!M) continue;
        const q = apply(M, lx, ly);
        cursor(q[0], q[1], p.color, p.name);
        break;
      }
    }
  }
  // my selection
  if (S.sel) {
    const n = scene.get(S.sel);
    const M = n && screenMatrixOf(S.sel);
    if (M) {
      outline(n, M, user.color, null);
      const size = sizeOf(n, M);
      if (S.mode === "edit" && size > 24 && size < 8 * Math.max(W, H)) {
        const h = handlePos(n, M);
        ctx.beginPath(); ctx.arc(h[0], h[1], 9, 0, Math.PI * 2);
        ctx.fillStyle = "#0b0e18"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = user.color; ctx.stroke();
        ctx.beginPath(); ctx.arc(h[0], h[1], 3, 0, Math.PI * 2); ctx.fillStyle = user.color; ctx.fill();
        if (S.reshape && size > 60 && n.pts.length <= 800) {
          for (let i = 0; i < n.pts.length; i += 2) {
            const q = apply(M, n.pts[i], n.pts[i + 1]);
            ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2);
            ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = user.color; ctx.stroke();
          }
        }
      }
    }
  }
  // stroke being drawn
  if (drag && drag.kind === "draw" && drag.pts.length > 2) {
    ctx.beginPath();
    ctx.moveTo(drag.pts[0], drag.pts[1]);
    for (let i = 2; i < drag.pts.length; i += 2) ctx.lineTo(drag.pts[i], drag.pts[i + 1]);
    ctx.lineWidth = 2; ctx.strokeStyle = S.color; ctx.lineJoin = "round"; ctx.stroke();
  }
}

function outline(n, M, color, dash) {
  if (!n) return;
  const bb = localBounds(n);
  const pts = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map((p) => apply(M, p[0], p[1]));
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.setLineDash(dash || []);
  ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
  ctx.setLineDash([]);
}

function handlePos(n, M) {
  const bb = localBounds(n);
  const off = 16 / scaleOf(M);
  return apply(M, bb[2] + off, (bb[1] + bb[3]) / 2);
}

function cursor(x, y, color, name) {
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + 3, y + 15); ctx.lineTo(x + 7, y + 10); ctx.lineTo(x + 14, y + 10); ctx.closePath();
  ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#04050a"; ctx.stroke();
  ctx.font = "600 11px 'Space Grotesk', system-ui, sans-serif";
  const w = ctx.measureText(name).width + 10;
  ctx.fillStyle = color;
  roundRect(x + 12, y + 14, w, 18, 5); ctx.fill();
  ctx.fillStyle = "#04050a"; ctx.fillText(name, x + 17, y + 27);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- presence -----------------------------------------------------------------------------------
function sendPresence() {
  if (!backend.ready) return;
  let cur = null;
  if (S.pointer) {
    const hits = pickAll(S.pointer.x, S.pointer.y, { minPx: 4 });
    const base = hits[0] || (renderer.chain && renderer.chain.chain[0]);
    if (base) {
      cur = [];
      for (let n = base, k = 0; n && k < 8; n = n.parent && scene.get(n.parent), k++) {
        const M = matOf(n.id);
        if (!M) continue;
        const l = apply(inv(M), S.pointer.x, S.pointer.y);
        cur.push([n.id, round6(l[0]), round6(l[1])]);
      }
    }
  }
  const view = { anchor: cam.anchor, cx: cam.cx, cy: cam.cy, z: cam.z, cr: cam.cr };
  const p = { id: user.id, name: user.name, color: user.color, cur, view, sel: S.sel, depth: anchorDepth() };
  const key = JSON.stringify([cur, S.sel, Math.round(cam.cx * 1e4), Math.round(cam.cy * 1e4), Math.round(Math.log(cam.z) * 100), cam.anchor]);
  if (key === presenceKey) return;
  presenceKey = key;
  backend.sendPresence(p);
}
const round6 = (v) => Math.round(v * 1e6) / 1e6;

// ---- input -------------------------------------------------------------------------------------
const pointers = new Map();
let drag = null;
let pinch = null;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  S.pointer = { x: e.offsetX, y: e.offsetY };
  vel.x = vel.y = 0;
  if (pointers.size === 2) {
    if (drag && drag.kind === "draw") drag = null;
    endDrag();
    const [a, b] = [...pointers.values()];
    pinch = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
    stopFlights();
    return;
  }
  if (pointers.size > 2) return;
  const x = e.offsetX, y = e.offsetY;
  drag = { kind: "pan", x0: x, y0: y, x, y, t0: performance.now(), moved: 0, lastT: performance.now() };
  if (S.mode === "draw") { drag.kind = "draw"; drag.pts = [x, y]; return; }
  if (S.mode === "edit" && S.sel) {
    const n = scene.get(S.sel);
    const M = n && screenMatrixOf(S.sel);
    if (M) {
      const size = sizeOf(n, M);
      if (size > 24 && size < 8 * Math.max(W, H)) {
        const h = handlePos(n, M);
        if (Math.hypot(x - h[0], y - h[1]) < 18) { startNodeDrag("handle", n, x, y); return; }
        if (S.reshape && size > 60) {
          for (let i = 0; i < n.pts.length; i += 2) {
            const q = apply(M, n.pts[i], n.pts[i + 1]);
            if (Math.hypot(x - q[0], y - q[1]) < 12) { startNodeDrag("point", n, x, y, i); return; }
          }
        }
        const p = apply(inv(M), x, y);
        if (containsLocal(n, p[0], p[1])) { drag.pending = "move"; }
      }
    }
  }
});

function startNodeDrag(kind, n, x, y, index) {
  stopFlights();
  // Never edit a node from inside its own frame: re-anchor the camera on its
  // parent and keep it there for the duration of the drag.
  const lock = new Set([n.id]);
  climbAbove(n.id);
  cam.lock = lock;
  const parent = scene.get(n.parent);
  const PM = parent && screenMatrixOf(parent.id);
  if (!PM) { drag = null; return; }
  const q = apply(inv(PM), x, y);
  drag = { kind, id: n.id, x0: x, y0: y, x, y, moved: 0, t0: performance.now(), q0: q, start: { x: n.x, y: n.y, s: n.s, r: n.r }, index };
  if (kind === "handle") {
    drag.d0 = Math.hypot(q[0] - n.x, q[1] - n.y) || 1e-9;
    drag.a0 = Math.atan2(q[1] - n.y, q[0] - n.x);
  }
}

function climbAbove(id) {
  // If the anchor is `id` or inside it, rebase the camera up to id's parent.
  const inside = () => { for (let a = scene.get(cam.anchor); a; a = a.parent && scene.get(a.parent)) if (a.id === id) return true; return false; };
  let guard = 0;
  while (inside() && guard++ < 64) {
    const a = scene.get(cam.anchor);
    const p = a && scene.get(a.parent);
    if (!p) break;
    const Ap = animMatrix(p, S.t);
    const T = [Math.cos(a.r) * a.s, Math.sin(a.r) * a.s, -Math.sin(a.r) * a.s, Math.cos(a.r) * a.s, a.x, a.y];
    const M = Ap ? mul(Ap, T) : T;
    const q = apply(M, cam.cx, cam.cy);
    const s = scaleOf(M), th = Math.atan2(M[1], M[0]);
    cam.cx = q[0]; cam.cy = q[1]; cam.z /= s; cam.cr -= th; cam.anchor = p.id;
  }
}

canvas.addEventListener("pointermove", (e) => {
  const x = e.offsetX, y = e.offsetY;
  S.pointer = { x, y };
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x, y });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    panBy(cam, mx - pinch.x, my - pinch.y);
    let da = ang - pinch.a;
    if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    zoomAt(cam, d / (pinch.d || d), mx, my, W, H, da);
    pinch = { x: mx, y: my, d, a: ang };
    return;
  }
  if (!drag) return;
  const dx = x - drag.x, dy = y - drag.y;
  drag.moved = Math.max(drag.moved, Math.hypot(x - drag.x0, y - drag.y0));
  if (drag.kind === "pan" && drag.pending === "move" && drag.moved > 5) {
    const n = scene.get(S.sel);
    if (n) { startNodeDrag("move", n, drag.x0, drag.y0); }
  }
  if (drag.kind === "pan") {
    if (drag.moved > 3) stopFlights();
    panBy(cam, dx, dy);
    const nowT = performance.now(), ddt = Math.max(1, nowT - drag.lastT) / 1000;
    vel.x = vel.x * 0.6 + (dx / ddt) * 0.4; vel.y = vel.y * 0.6 + (dy / ddt) * 0.4;
    drag.lastT = nowT;
  } else if (drag.kind === "draw") {
    const lx = drag.pts[drag.pts.length - 2], ly = drag.pts[drag.pts.length - 1];
    if (Math.hypot(x - lx, y - ly) > 2.5) drag.pts.push(x, y);
  } else {
    const n = scene.get(drag.id);
    const parent = n && scene.get(n.parent);
    const PM = parent && screenMatrixOf(parent.id);
    if (PM) {
      const q = apply(inv(PM), x, y);
      if (drag.kind === "move") {
        sync.patch(n.id, { x: drag.start.x + q[0] - drag.q0[0], y: drag.start.y + q[1] - drag.q0[1] });
      } else if (drag.kind === "handle") {
        const d = Math.hypot(q[0] - drag.start.x, q[1] - drag.start.y);
        const a = Math.atan2(q[1] - drag.start.y, q[0] - drag.start.x);
        sync.patch(n.id, { s: Math.max(1e-9, drag.start.s * (d / drag.d0)), r: drag.start.r + (a - drag.a0) });
      } else if (drag.kind === "point") {
        const M = screenMatrixOf(n.id);
        const l = apply(inv(M), x, y);
        const pts = n.pts.slice();
        pts[drag.index] = round4(l[0]); pts[drag.index + 1] = round4(l[1]);
        sync.patch(n.id, { pts });
      }
    }
  }
  drag.x = x; drag.y = y;
});

function endDrag() {
  cam.lock = null;
}

canvas.addEventListener("pointerup", onUp);
canvas.addEventListener("pointercancel", onUp);
canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !pointers.size) S.pointer = null; });

function onUp(e) {
  const had = pointers.has(e.pointerId);
  pointers.delete(e.pointerId);
  if (!had) return;
  if (pinch) {
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      drag = { kind: "pan", x0: p.x, y0: p.y, x: p.x, y: p.y, moved: 99, t0: 0, lastT: performance.now() };
    } else drag = null;
    vel.x = vel.y = 0;
    return;
  }
  if (!drag) return;
  const d = drag;
  drag = null;
  endDrag();
  if (d.kind === "draw") { finishStroke(d.pts); return; }
  const isTap = d.moved < 6 && performance.now() - d.t0 < 400;
  if (d.kind === "pan" && isTap) onTap(d.x0, d.y0);
  if (d.kind !== "pan") vel.x = vel.y = 0;
}

function onTap(x, y) {
  const now = performance.now();
  if (S.mode === "explore") {
    if (S.lastTap && now - S.lastTap.t < 320 && Math.hypot(x - S.lastTap.x, y - S.lastTap.y) < 24) {
      stopFlights(); zoomQ += Math.log(3); zoomFx = x; zoomFy = y; S.lastTap = null; return;
    }
    S.lastTap = { x, y, t: now };
    return;
  }
  if (S.mode === "edit") {
    const hits = pickAll(x, y, { minPx: 10, maxPx: 6 * Math.max(W, H) });
    if (!hits.length) { select(null); return; }
    const near = S.lastTap && Math.hypot(x - S.lastTap.x, y - S.lastTap.y) < 10;
    let pick = hits[0];
    if (near && S.sel) {
      const i = hits.findIndex((h) => h.id === S.sel);
      if (i >= 0) pick = hits[(i + 1) % hits.length];
    }
    S.lastTap = { x, y, t: now };
    select(pick.id);
    if (hits.length > 1) toast(`${hits.length} shapes overlap here. Tap again to pick the one underneath.`, 1600);
  }
}

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  stopFlights();
  const k = e.ctrlKey ? 0.012 : 0.0018;
  const unit = e.deltaMode === 1 ? 16 : 1;
  zoomQ += -e.deltaY * unit * k;
  zoomFx = e.offsetX; zoomFy = e.offsetY;
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  const step = 80;
  if (e.key === "ArrowLeft") panBy(cam, step, 0);
  else if (e.key === "ArrowRight") panBy(cam, -step, 0);
  else if (e.key === "ArrowUp") panBy(cam, 0, step);
  else if (e.key === "ArrowDown") panBy(cam, 0, -step);
  else if (e.key === "+" || e.key === "=") { zoomQ += Math.log(2); zoomFx = W / 2; zoomFy = H / 2; }
  else if (e.key === "-" || e.key === "_") { zoomQ -= Math.log(2); zoomFx = W / 2; zoomFy = H / 2; }
  else if (e.key === "1") setMode("explore");
  else if (e.key === "2") setMode("edit");
  else if (e.key === "3") setMode("draw");
  else if (e.key === "Escape") select(null);
  else if ((e.key === "Delete" || e.key === "Backspace") && S.sel) askDelete();
  else if (e.key === "f" && S.sel) seekTo(S.sel);
  else if (e.key === "h") home();
  else return;
  e.preventDefault();
});

// ---- authoring ------------------------------------------------------------------------------------
function finishStroke(pts) {
  if (pts.length < 16) { toast("Draw a closed loop to make a new shape."); return; }
  let cx = 0, cy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    cx += pts[i]; cy += pts[i + 1];
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  cx /= pts.length / 2; cy /= pts.length / 2;
  const strokeSize = Math.max(x1 - x0, y1 - y0);
  if (strokeSize < 12) return;
  // container = deepest visible shape that holds the stroke's center and is bigger than it
  let container = null;
  for (let i = renderer.drawn.length - 1; i >= 0; i--) {
    const n = renderer.drawn[i];
    const M = renderer.mats.get(n.id);
    if (sizeOf(n, M) < strokeSize * 1.15) continue;
    const l = apply(inv(M), cx, cy);
    if (containsLocal(n, l[0], l[1]) && visibleThroughClips(n, cx, cy)) { container = n; break; }
  }
  if (!container) { toast("Start your loop inside a shape. Everything here lives inside something."); return; }
  const IM = inv(screenMatrixOf(container.id));
  const local = [];
  for (let i = 0; i < pts.length; i += 2) { const l = apply(IM, pts[i], pts[i + 1]); local.push(l[0], l[1]); }
  const unit = 1 / scaleOf(screenMatrixOf(container.id));
  let tol = 1.5 * unit, simp = simplify(local, tol);
  while (simp.length > 240) { tol *= 1.5; simp = simplify(local, tol); }
  if (Math.hypot(simp[0] - simp[simp.length - 2], simp[1] - simp[simp.length - 1]) < 4 * unit) simp.length -= 2;
  if (simp.length < 6) return;
  const nrm = normalize(simp);
  const siblings = scene.childrenOf(container.id);
  const node = {
    id: newId(), parent: container.id, depth: container.depth + 1,
    ord: (siblings.length ? siblings[siblings.length - 1].ord : 0) + 1,
    x: nrm.x, y: nrm.y, s: nrm.s, r: 0, pts: nrm.pts, rings: null, smooth: true, rule: "nonzero",
    fill: S.color, anim: null, clip: true, tag: "drawn", nchild: 0, v: 0, by: user.id,
  };
  sync.create(node);
  select(node.id);
  toast("Shape added at depth " + node.depth + ".");
}

function addInside() {
  const p = scene.get(S.sel);
  if (!p) return;
  localBounds(p);
  const n = 9 + Math.floor(Math.random() * 6);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = 0.8 + Math.random() * 0.2;
    pts.push(round4(Math.cos(a) * r), round4(Math.sin(a) * r));
  }
  const siblings = scene.childrenOf(p.id);
  const node = {
    id: newId(), parent: p.id, depth: p.depth + 1, ord: (siblings.length ? siblings[siblings.length - 1].ord : 0) + 1,
    x: round4(p._cx + (Math.random() - 0.5) * p._hr * 0.5), y: round4(p._cy + (Math.random() - 0.5) * p._hr * 0.5),
    s: round4(p._hr * 0.28), r: 0, pts, rings: null, smooth: true, rule: "nonzero",
    fill: S.color, anim: null, clip: true, tag: "drawn", nchild: 0, v: 0, by: user.id,
  };
  sync.create(node);
  select(node.id);
}

const ANIM_CYCLE = [null, { kind: "hue", speed: 45 }, { kind: "pulse", speed: 1.6, amp: 0.06 }, { kind: "spin", speed: 0.35 }, { kind: "orbit", speed: 0.6, amp: 0.08 }];
function cycleAnim() {
  const n = scene.get(S.sel);
  if (!n) return;
  const i = ANIM_CYCLE.findIndex((a) => (a ? a.kind : null) === (n.anim ? n.anim.kind : null));
  const next = ANIM_CYCLE[(i + 1) % ANIM_CYCLE.length];
  const set = { anim: next };
  if (next && next.kind === "hue" && !/^hsl/.test(n.fill)) set.fill = hexToHsl(n.fill);
  sync.patch(n.id, set);
  renderDock();
}

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "hsl(200 70% 50%)";
  const v = parseInt(m[1], 16), r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

function askDelete() {
  const n = scene.get(S.sel);
  if (!n) return;
  if (n.id === "root") { toast("The world itself can't be deleted."); return; }
  S.confirmDelete = true;
  renderDock();
}

function doDelete() {
  const n = scene.get(S.sel);
  S.confirmDelete = false;
  if (!n) return;
  // Move the camera out first if we're inside what's being deleted.
  climbAbove(n.id);
  sync.remove(n.id);
  select(null);
  toast("Deleted.");
}

function select(id) {
  S.sel = id;
  S.confirmDelete = false;
  if (!id) S.reshape = false;
  renderDock();
}

function setMode(m) {
  S.mode = m;
  if (m !== "edit") S.reshape = false;
  canvas.dataset.mode = m;
  renderDock();
}

// ---- HUD ----------------------------------------------------------------------------------------

function setStatus(s) {
  hud.status.dataset.state = s;
  hud.statusText.textContent = s === "live" ? "Live" : s === "demo" ? "Demo" : s === "offline" ? "Reconnecting" : "Connecting";
}

let ladderKey = "";
function updateHud() {
  const d = anchorDepth();
  hud.depth.textContent = String(d);
  const ze = zoomExponent();
  hud.zoom.innerHTML = ze < 3 ? `${Math.max(1, 10 ** ze).toFixed(ze < 1 ? 1 : 0)}×` : `10<sup>${ze.toFixed(1)}</sup>×`;
  if (S.status !== backend.kind) setStatus(backend.ready ? (backend.kind === "demo" ? "demo" : "live") : hud.status.dataset.state);
  if (backend.kind === "live" && backend.ready) hud.statusText.textContent = `Live · ${Math.round(backend.rtt)} ms`;
  // ancestor ladder
  const chain = renderer.chain ? renderer.chain.chain.slice().reverse() : [];
  const key = chain.map((n) => n.id).join(",");
  if (key !== ladderKey) {
    ladderKey = key;
    const show = chain.length > 14 ? [chain[0], null, ...chain.slice(-12)] : chain;
    hud.ladder.replaceChildren(...show.map((n) => {
      if (!n) { const s = document.createElement("span"); s.className = "gap"; s.textContent = "⋮"; return s; }
      const b = document.createElement("button");
      b.className = "rung";
      b.style.setProperty("--c", n.fill);
      b.title = `Depth ${n.depth}${n.tag ? " · " + n.tag : ""}. Fly here.`;
      b.setAttribute("aria-label", `Fly to depth ${n.depth}`);
      b.onclick = () => { S.follow = null; seekTo(n.id, { fit: 0.85 }); };
      return b;
    }));
  }
  // stats
  if (!hud.stats.hidden) {
    const avg = fpsWin.reduce((a, b) => a + b, 0) / Math.max(1, fpsWin.length);
    const worst = Math.max(...fpsWin);
    const st = renderer.stats;
    hud.stats.querySelector("dl").innerHTML = [
      ["Frame rate", `${(1000 / avg).toFixed(0)} fps`],
      ["Slowest frame (1 s)", `${worst.toFixed(1)} ms`],
      ["Render CPU", `${st.cpu.toFixed(2)} ms`],
      ["Shapes drawn", st.drawn.toLocaleString()],
      ["Shapes in memory", scene.size.toLocaleString()],
      ["Detail cutoff", `${renderer.minPx.toFixed(2)} px`],
      ["Regions loading", String(backend.inflightLoads())],
      ["Edits sent / confirmed", `${sync.stats.sent} / ${sync.stats.acked}`],
      ["Edit confirm time", `${sync.stats.rttAck.toFixed(1)} ms`],
      ["Anchor", cam.anchor],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }
  // drop stale presence
  const now = performance.now();
  let changed = false;
  for (const [id, p] of S.users) if (now - p.at > 30000) { S.users.delete(id); changed = true; }
  if (changed) renderPeople();
}

function renderPeople() {
  const me = document.createElement("button");
  me.className = "person me";
  me.style.setProperty("--c", user.color);
  me.textContent = initials(user.name);
  me.title = `${user.name} (you). Rename.`;
  me.setAttribute("aria-label", `You are ${user.name}. Rename`);
  me.onclick = renameSelf;
  const others = [...S.users.values()].map((p) => {
    const b = document.createElement("button");
    b.className = "person" + (S.follow === p.id ? " following" : "");
    b.style.setProperty("--c", p.color);
    b.textContent = initials(p.name);
    b.title = S.follow === p.id ? `Stop following ${p.name}` : `Follow ${p.name} (depth ${p.depth ?? "?"})`;
    b.setAttribute("aria-label", b.title);
    b.onclick = () => {
      if (S.follow === p.id) stopFlights();
      else { S.follow = p.id; toast(`Following ${p.name}. Touch the canvas to stop.`); }
      renderPeople();
    };
    return b;
  });
  hud.people.replaceChildren(...others, me);
}

const initials = (name) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function renameSelf() {
  const box = $("rename");
  box.hidden = !box.hidden;
  if (!box.hidden) { const i = $("rename-input"); i.value = user.name; i.focus(); i.select(); }
}
$("rename").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("rename-input").value.trim().slice(0, 24);
  if (v) { user.name = v; try { localStorage.setItem("if-lab-user", JSON.stringify(user)); } catch {} }
  $("rename").hidden = true;
  presenceKey = "";
  renderPeople();
});

function renderDock() {
  const modes = [["explore", "Explore", "Pan, pinch and zoom (1)"], ["edit", "Edit", "Select, move, scale and reshape (2)"], ["draw", "Draw", "Draw a closed loop to add a shape (3)"]];
  const seg = document.createElement("div");
  seg.className = "seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Mode");
  for (const [m, label, tip] of modes) {
    const b = button(label, () => setMode(m), tip);
    b.setAttribute("aria-pressed", String(S.mode === m));
    seg.append(b);
  }
  const parts = [seg];
  if (S.mode === "draw" || (S.mode === "edit" && S.sel)) {
    const sw = document.createElement("div");
    sw.className = "swatches";
    for (const c of PALETTE) {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.setProperty("--c", c);
      b.setAttribute("aria-label", "Color " + c);
      b.setAttribute("aria-pressed", String(S.color === c));
      b.onclick = () => {
        S.color = c;
        if (S.mode === "edit" && S.sel) sync.patch(S.sel, { fill: c });
        renderDock();
      };
      sw.append(b);
    }
    parts.push(sw);
  }
  if (S.mode === "edit" && S.sel) {
    const n = scene.get(S.sel);
    if (S.confirmDelete && n) {
      const box = document.createElement("div");
      box.className = "confirm";
      const count = n.nchild ? ` and the ${n.nchild.toLocaleString()} shape${n.nchild === 1 ? "" : "s"} directly inside it` : "";
      box.append(Object.assign(document.createElement("span"), { textContent: `Delete this shape${count}? Everything nested inside goes too.` }));
      const del = button("Delete shape", doDelete, "Delete permanently for everyone");
      del.className = "danger";
      box.append(del, button("Keep it", () => { S.confirmDelete = false; renderDock(); }));
      parts.push(box);
    } else {
      const acts = document.createElement("div");
      acts.className = "acts";
      const animLabel = n && n.anim ? `Animate: ${n.anim.kind}` : "Animate";
      const re = button("Reshape", () => { S.reshape = !S.reshape; renderDock(); }, "Drag the points of this shape");
      re.setAttribute("aria-pressed", String(S.reshape));
      acts.append(
        button("Fly in", () => seekTo(S.sel), "Zoom to fit this shape (F)"),
        button("Add inside", addInside, "Nest a new shape inside this one"),
        re,
        button(animLabel, cycleAnim, "Cycle animation: color, pulse, spin, orbit, none"),
        Object.assign(button("Delete", askDelete, "Delete this shape and everything inside it"), { className: "danger-quiet" }),
      );
      parts.push(acts);
    }
  } else if (S.mode === "edit") {
    parts.push(Object.assign(document.createElement("span"), { className: "hint", textContent: "Tap a shape to select it." }));
  } else if (S.mode === "draw") {
    parts.push(Object.assign(document.createElement("span"), { className: "hint", textContent: "Draw a loop inside any shape." }));
  }
  hud.dock.replaceChildren(...parts);
}

function button(label, fn, title) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (title) b.title = title;
  b.onclick = fn;
  return b;
}

let toastTimer = 0;
function toast(msg, ms = 2400) {
  hud.toast.textContent = msg;
  hud.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { hud.toast.hidden = true; }, ms);
}

$("btn-dive").onclick = dive;
$("btn-home").onclick = home;
$("btn-stats").onclick = () => {
  hud.stats.hidden = !hud.stats.hidden;
  $("btn-stats").setAttribute("aria-pressed", String(!hud.stats.hidden));
};
if (backend.kind === "demo") {
  $("btn-reset").hidden = false;
  $("btn-reset").onclick = () => { backend.reset(); location.reload(); };
}

setMode("explore");
renderPeople();

// ---- hooks for the benchmark and debugging --------------------------------------------------------
window.__lab = {
  scene, cam, renderer, sync, backend, S, user,
  seekTo, dive, home, select, setMode, screenMatrixOf,
  record() { S.recording = []; },
  stopRecording() { const r = S.recording; S.recording = null; return r; },
  depth: anchorDepth,
  zoomExponent,
  patch: (id, set) => sync.patch(id, set),
  create: (node) => sync.create(node),
  view: () => ({ W, H }),
};
