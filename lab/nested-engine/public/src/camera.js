// Anchor-relative camera.
//
// The world is a tree. Every node stores only its transform relative to its
// parent (x, y, s, r). There is no global coordinate system at all: at depth 44
// the global scale would be ~1e-27, far past float64 precision.
//
// Instead the camera lives in the local frame of an "anchor" node, the node
// that currently fills your view. (cx, cy) is the view center in anchor-local
// units, z is screen pixels per anchor unit, cr is screen rotation. When you zoom
// far enough into a child we re-express the camera in that child's frame
// ("rebase down"); zoom out far enough and we rebase up. z therefore always
// stays in a small range and every matrix we build has well-conditioned numbers.
//
// Frames, per node n:
//   G_n: n's frame before its own animation   (parentF = T_n * g)
//   F_n: n's frame after its animation        (g = A_n(t) * f)
// The camera is expressed in G_anchor, so an anchor's own animation (spin,
// pulse...) is visible on screen instead of dragging the camera along.

import { mul, inv, apply, applyVec, trs, scaleOf, angleOf } from "./mat.js";
import { localBounds, containsLocal } from "./geom.js";
import { cyrb53 } from "./seedgen.js";

export function createCamera(anchor = "root") {
  return { anchor, cx: 0, cy: 0, z: 300, cr: 0, lock: null };
}

export function staticMatrix(n) {
  return trs(n.x, n.y, n.s, n.r);
}

function phaseOf(n) {
  if (n._phase === undefined) n._phase = ((cyrb53(n.id) % 10000) / 10000) * Math.PI * 2;
  return n._phase;
}

export function animMatrix(n, t) {
  const a = n.anim;
  if (!a) return null;
  const ph = phaseOf(n);
  switch (a.kind) {
    case "spin": return trs(0, 0, 1, a.speed * t + ph);
    case "pulse": return trs(0, 0, 1 + (a.amp || 0.05) * Math.sin(a.speed * t * 2 + ph), 0);
    case "orbit": {
      const amp = a.amp || 0.06;
      return trs(amp * Math.cos(a.speed * t + ph), amp * Math.sin(a.speed * t + ph), 1, 0);
    }
    default: return null;
  }
}

// parentF <- childF
export function localMatrix(n, t) {
  const S = staticMatrix(n);
  const A = animMatrix(n, t);
  return A ? mul(S, A) : S;
}

export function viewMatrix(cam, W, H) {
  // screen = C + z * R(cr) * (g - cam)
  const c = Math.cos(cam.cr) * cam.z, s = Math.sin(cam.cr) * cam.z;
  return [c, s, -s, c, W / 2 - (c * cam.cx - s * cam.cy), H / 2 - (s * cam.cx + c * cam.cy)];
}

// Screen matrices (F-frame -> screen) for the anchor and every loaded
// ancestor. Computed upward from the anchor, so they're exact where it matters.
export function chainMatrices(scene, cam, W, H, t) {
  const mf = new Map();
  const chain = [];
  let n = scene.get(cam.anchor);
  if (!n) return { mf, chain, top: null };
  let MG = viewMatrix(cam, W, H);
  for (;;) {
    const A = animMatrix(n, t);
    const MF = A ? mul(MG, A) : MG;
    mf.set(n.id, MF);
    chain.push(n);
    const p = n.parent && scene.get(n.parent);
    if (!p) break;
    const MFp = mul(MG, inv(staticMatrix(n)));
    const Ap = animMatrix(p, t);
    MG = Ap ? mul(MFp, inv(Ap)) : MFp;
    n = p;
  }
  return { mf, chain, top: chain[chain.length - 1] };
}

// Re-express the camera through similarity M (maps the new frame into the old
// one): V' = V * M.
function through(cam, M) {
  const s = scaleOf(M), th = angleOf(M);
  const im = inv(M);
  const p = apply(im, cam.cx, cam.cy);
  cam.cx = p[0]; cam.cy = p[1];
  cam.z *= s; cam.cr += th;
}

function throughInverse(cam, M) {
  const s = scaleOf(M), th = angleOf(M);
  const p = apply(M, cam.cx, cam.cy);
  cam.cx = p[0]; cam.cy = p[1];
  cam.z /= s; cam.cr -= th;
}

const DOWN = 1.25, UP = 0.6;

// Keep the anchor the deepest node that fills the screen around the center.
// Returns the number of rebase steps taken.
export function rebase(scene, cam, W, H, t) {
  const maxDim = Math.max(W, H);
  let steps = 0;
  for (let guard = 0; guard < 64; guard++) {
    const a = scene.get(cam.anchor);
    if (!a) return steps;
    localBounds(a);
    // --- up: anchor no longer fills the view
    // (or the view center has wandered far outside it, e.g. a long pan)
    const far = Math.hypot(cam.cx - a._cx, cam.cy - a._cy) > 3 * a._hr;
    if (a.parent && (far || 2 * a._hr * cam.z < UP * maxDim)) {
      const p = scene.get(a.parent);
      if (!p) return steps;
      const Ap = animMatrix(p, t);
      const M = Ap ? mul(Ap, staticMatrix(a)) : staticMatrix(a); // G_a -> G_p
      throughInverse(cam, M);
      cam.anchor = p.id;
      steps++;
      continue;
    }
    // --- down: a child contains the view center and is bigger than the screen
    const kids = scene.childrenOf(a.id);
    if (!kids.length) return steps;
    const Aa = animMatrix(a, t);
    const pf = Aa ? apply(inv(Aa), cam.cx, cam.cy) : [cam.cx, cam.cy];
    let next = null, nextM = null;
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i];
      if (cam.lock && cam.lock.has(c.id)) continue;
      localBounds(c);
      const diam = 2 * c._hr * c.s * cam.z;
      if (diam < DOWN * maxDim) continue;
      const Tc = staticMatrix(c);
      const g = apply(inv(Tc), pf[0], pf[1]);
      const Ac = animMatrix(c, t);
      const f = Ac ? apply(inv(Ac), g[0], g[1]) : g;
      if (!containsLocal(c, f[0], f[1])) continue;
      next = c; nextM = Aa ? mul(Aa, Tc) : Tc; // G_c -> G_a
      break;
    }
    if (!next) return steps;
    through(cam, nextM);
    cam.anchor = next.id;
    steps++;
  }
  return steps;
}

// When the anchor itself animates (a spinning galaxy, a pulsing cell), its
// motion is magnified by however deep you are inside it: a slow spin becomes
// thousands of pixels per second. So the camera gradually rides the anchor's
// animation as you go deeper: at ~2 screens wide you watch it spin, from ~16
// screens wide it holds still under you. Applied as a fraction of the frame's
// animation step, so there's never a jump.
export function rideAnchorAnim(scene, cam, W, H, t, tPrev) {
  const a = scene.get(cam.anchor);
  if (!a || !a.anim || a.anim.kind === "hue" || !(t > tPrev)) return;
  localBounds(a);
  const screens = (2 * a._hr * cam.z) / Math.max(W, H);
  const w = Math.max(0, Math.min(1, (Math.log2(Math.max(screens, 1e-9)) - 1) / 3));
  if (!w) return;
  const A0 = animMatrix(a, tPrev), A1 = animMatrix(a, t);
  if (!A0 || !A1) return;
  // D maps the camera's frame now to where it was: V' = V * D^w
  const D = mul(A0, inv(A1));
  const s = Math.pow(scaleOf(D), w), th = angleOf(D) * w;
  through(cam, trs(D[4] * w, D[5] * w, s, th));
}

// ---- camera input --------------------------------------------------------------

export function panBy(cam, dx, dy) {
  const v = applyVec(inv([Math.cos(cam.cr) * cam.z, Math.sin(cam.cr) * cam.z, -Math.sin(cam.cr) * cam.z, Math.cos(cam.cr) * cam.z, 0, 0]), dx, dy);
  cam.cx -= v[0]; cam.cy -= v[1];
}

// Zoom by f and rotate by dr around screen point (px, py), keeping the world
// point under it fixed.
export function zoomAt(cam, f, px, py, W, H, dr = 0) {
  const V = viewMatrix(cam, W, H);
  const q = apply(inv(V), px, py);
  cam.z *= f;
  cam.cr += dr;
  const c = Math.cos(cam.cr) * cam.z, s = Math.sin(cam.cr) * cam.z;
  // choose cam so V(q) = P:  P = C + R*z*(q - cam)  =>  cam = q - (R z)^-1 (P - C)
  const v = applyVec(inv([c, s, -s, c, 0, 0]), px - W / 2, py - H / 2);
  cam.cx = q[0] - v[0];
  cam.cy = q[1] - v[1];
}

export function clampZoom(scene, cam, W, H) {
  const a = scene.get(cam.anchor);
  if (!a) return;
  localBounds(a);
  const maxDim = Math.max(W, H);
  if (!a.parent) cam.z = Math.max(cam.z, (0.05 * maxDim) / (2 * a._hr));
  cam.z = Math.min(cam.z, 1e9);
}
