// Deterministic generator for the dummy nested world (~100k shapes, 44 levels
// deep at its deepest). The Node seed script writes it all to Postgres; the
// in-browser demo backend generates the same nodes lazily, on request.
//
// Structure under `root`:
//   galaxy  - one region holding 20,000 small stars (stress-tests dense regions)
//   fish    - the five Infinite Frames yin-yang SVG frames, imported as real paths
//   8 x reg - recursive nested regions, 7 levels deep, ~85k shapes
//   spines  - ~11 chains that keep nesting down to depth 44 (zoom ~10^27)

import { round4 } from "./geom.js";
import { parseSvgFrame, frameChildren } from "./svgimport.js";

export const MAX_DEPTH = 44;
const REG_COUNTS = [0, 7, 6, 5, 5, 4]; // children per regular node at depth 1..5
const GALAXY_STARS = 20000;

export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function rng(seedStr) {
  let a = cyrb53(seedStr) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const childId = (parentId, i) => cyrb53(parentId + ":" + i).toString(36).padStart(11, "0").slice(-11);

// --- shapes (unit radius) ----------------------------------------------------

function radial(n, radiusAt, phase = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const r = radiusAt(i);
    pts.push(round4(Math.cos(a) * r), round4(Math.sin(a) * r));
  }
  return pts;
}

function shapeFor(r, bias) {
  const pick = bias ?? r();
  if (pick < 0.42) {
    const n = 10 + Math.floor(r() * 8);
    const amp = 0.08 + r() * 0.14;
    const w = Array.from({ length: n }, () => 1 - amp * r());
    const max = Math.max(...w);
    return { pts: radial(n, (i) => w[i] / max), smooth: true };
  }
  if (pick < 0.62) {
    const petals = 5 + Math.floor(r() * 4);
    const inner = 0.72 + r() * 0.12;
    return { pts: radial(petals * 2, (i) => (i % 2 ? inner : 1)), smooth: true };
  }
  if (pick < 0.8) {
    const tips = 5 + Math.floor(r() * 5);
    const inner = 0.74 + r() * 0.1;
    return { pts: radial(tips * 2, (i) => (i % 2 ? inner : 1), r() * 6), smooth: false };
  }
  if (pick < 0.94) {
    const n = 5 + Math.floor(r() * 4);
    return { pts: radial(n, () => 1, r() * 6), smooth: false };
  }
  // ring with a hole (even-odd), children sit in the band and the hole
  const outer = radial(16, () => 1), inner = radial(12, () => 0.38);
  return { pts: outer.concat(inner), rings: [16, 12], smooth: true, rule: "evenodd" };
}

function hslOf(fill) {
  const m = /hsl\(([-\d.]+)/.exec(fill || "");
  return m ? Number(m[1]) : 200;
}

function maybeAnim(r) {
  const k = r();
  if (k > 0.05) return null;
  const which = r();
  if (which < 0.3) return { kind: "hue", speed: round4(20 + r() * 50) };
  if (which < 0.55) return { kind: "pulse", speed: round4(0.8 + r() * 1.5), amp: 0.05 };
  if (which < 0.8) return { kind: "spin", speed: round4((r() < 0.5 ? -1 : 1) * (0.05 + r() * 0.2)) };
  return { kind: "orbit", speed: round4(0.3 + r() * 0.6), amp: 0.06 };
}

// --- tree rules ----------------------------------------------------------------

export function childCount(node, ctx = {}) {
  const t = node.tag || "reg";
  if (node.id === "root") return 10;
  if (t === "galaxy") return GALAXY_STARS;
  if (t === "fish") return 5;
  if (t.startsWith("frame:")) {
    const f = ctx.frames && ctx.frames[Number(t.slice(6))];
    return f ? f.paths.length : 0;
  }
  if (t === "spine") return node.depth < MAX_DEPTH ? 5 : 0;
  if (t === "deco") return 3;
  if (t === "star" || t === "leaf" || t === "path") return 0;
  const d = node.depth;
  if (d >= 1 && d <= 5) return REG_COUNTS[d];
  if (d === 6) return rng(node.id + ":n")() < 0.3 ? 3 : 0;
  return 0;
}

function base(parent, i, extra) {
  return {
    id: childId(parent.id, i),
    parent: parent.id,
    depth: parent.depth + 1,
    ord: i,
    x: 0, y: 0, s: 1, r: 0,
    rings: null, smooth: false, rule: "nonzero",
    fill: "#888", anim: null, clip: true, tag: null, nchild: 0, v: 0, by: "seed",
    ...extra,
  };
}

export function rootNode() {
  const n = 72;
  const pts = radial(n, (i) => {
    const a = (i / n) * Math.PI * 2;
    const c = Math.abs(Math.cos(a)) ** 5, s = Math.abs(Math.sin(a)) ** 5;
    return 1 / Math.pow(c + s, 1 / 5) / Math.SQRT2 * 1.0;
  });
  // normalize so max radius = 1
  let m = 0; for (let i = 0; i < pts.length; i += 2) m = Math.max(m, Math.hypot(pts[i], pts[i + 1]));
  for (let i = 0; i < pts.length; i++) pts[i] = round4(pts[i] / m);
  return {
    id: "root", parent: null, depth: 0, ord: 0, x: 0, y: 0, s: 1, r: 0,
    pts, rings: null, smooth: false, rule: "nonzero", fill: "#0a0c14", anim: null,
    clip: true, tag: "root", nchild: 10, v: 0, by: "seed",
  };
}

// Generate all direct children of `parent`. Pure function of parent + ctx.
export function genChildren(parent, ctx = {}) {
  const t = parent.tag || "reg";
  const out = [];
  if (parent.id === "root") {
    const slots = layoutSpiral(10, 0.6, rng("root:layout"));
    for (let i = 0; i < 10; i++) {
      const r = rng("root:" + i);
      const [x, y, s] = slots[i];
      if (i === 0) {
        out.push(base(parent, i, { x, y, s: s * 1.15, r: 0, ...circle(28), smooth: true, fill: "hsl(250 45% 9%)", tag: "galaxy", anim: { kind: "spin", speed: 0.015 } }));
      } else if (i === 1) {
        out.push(base(parent, i, { x, y, s: s * 1.05, r: 0, pts: [-1, -1, 1, -1, 1, 1, -1, 1].map((v) => round4(v * 0.7071)), fill: "#05060a", tag: "fish" }));
      } else {
        const h = Math.floor(r() * 360);
        out.push(base(parent, i, { x, y, s, r: r() * Math.PI * 2, ...shapeFor(r, r() * 0.62), fill: `hsl(${h} 70% 26%)`, tag: "reg", anim: null }));
      }
    }
  } else if (t === "galaxy") {
    const r = rng(parent.id + ":stars");
    for (let i = 0; i < GALAXY_STARS; i++) {
      const arm = i % 4;
      const d = 0.04 + 0.88 * Math.sqrt(r());
      const a = (arm * Math.PI) / 2 + d * 5.2 + (r() - 0.5) * 0.5 * (1.1 - d);
      const hue = Math.round((200 + arm * 40 + d * 90 + r() * 30) % 360);
      const star = r() < 0.5;
      out.push(base(parent, i, {
        x: round4(Math.cos(a) * d), y: round4(Math.sin(a) * d),
        s: round4(0.002 + r() * r() * 0.012), r: round4(r() * 6.28),
        pts: star ? radial(10, (k) => (k % 2 ? 0.5 : 1)) : radial(6, () => 1),
        smooth: !star, fill: `hsl(${hue} 90% ${55 + Math.round(r() * 30)}%)`, tag: "star",
        anim: r() < 0.04 ? { kind: "hue", speed: round4(30 + r() * 60) } : null,
      }));
    }
  } else if (t === "fish") {
    for (let i = 0; i < 5; i++) {
      out.push(base(parent, i, {
        x: round4(-0.56 + i * 0.28), y: 0, s: 0.125, r: 0,
        pts: [-1, -1, 1, -1, 1, 1, -1, 1].map((v) => round4(v * 0.7071)),
        fill: (ctx.frames && ctx.frames[i] && ctx.frames[i].bg) || "#020204", tag: "frame:" + i,
      }));
    }
  } else if (t.startsWith("frame:")) {
    const f = ctx.frames && ctx.frames[Number(t.slice(6))];
    if (f) frameChildren(f).forEach((p, i) => out.push(base(parent, i, { ...p, tag: "path" })));
  } else {
    const k = childCount(parent, ctx);
    if (!k) return out;
    const r = rng(parent.id + ":kids");
    const slots = layoutSpiral(k, 0.58, r);
    const ph = hslOf(parent.fill);
    const startsSpine = t === "reg" && parent.depth === 2 && rng(parent.id + ":spine")() < 0.2;
    for (let i = 0; i < k; i++) {
      const cr = rng(parent.id + ":" + i);
      const [x, y, s] = slots[i];
      let tag = t === "deco" ? "leaf" : "reg";
      if (t === "spine") tag = i === 0 ? "spine" : "deco";
      else if (startsSpine && i === 0) tag = "spine";
      const hue = Math.round((ph + 35 + cr() * 110) % 360);
      const light = parent.depth % 2 ? 26 : 52;
      out.push(base(parent, i, {
        x, y, s, r: round4(cr() * Math.PI * 2),
        ...shapeFor(cr, tag === "spine" ? cr() * 0.62 : undefined),
        fill: `hsl(${hue} ${tag === "spine" ? 85 : 70}% ${light}%)`,
        tag, anim: tag === "spine" ? null : maybeAnim(cr),
      }));
    }
  }
  for (const c of out) c.nchild = childCount(c, ctx);
  return out;
}

function circle(n) {
  return { pts: radial(n, () => 1) };
}

// Golden-angle spiral packing inside radius R; returns [x, y, scale] per slot.
function layoutSpiral(k, R, r) {
  const out = [];
  const phase = r() * Math.PI * 2;
  const s = Math.min(0.42, (0.86 * R) / Math.sqrt(k));
  for (let i = 0; i < k; i++) {
    const d = k === 1 ? 0 : R * Math.sqrt((i + 0.5) / k);
    const a = phase + i * 2.39996323;
    out.push([round4(Math.cos(a) * d), round4(Math.sin(a) * d), round4(s * (0.88 + r() * 0.2))]);
  }
  return out;
}

export function makeCtx(svgTexts) {
  return { frames: (svgTexts || []).map((t) => (t ? parseSvgFrame(t) : null)) };
}
