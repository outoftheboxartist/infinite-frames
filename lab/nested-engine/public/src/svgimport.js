// Minimal, DOM-free SVG import: turns <path d="..."> elements into node rings.
// Supports M L H V Q T C S A Z (absolute and relative). Curves are flattened
// into polygon rings; arcs every ~10 degrees.

import { normalize, round4 } from "./geom.js";

export function parsePathData(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  let i = 0, cmd = "";
  let x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lastCmd = "";
  const rings = [];
  let cur = null;
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]);
  const push = (px, py) => { cur.push(px, py); };
  const start = (px, py) => { if (cur && cur.length >= 6) rings.push(cur); cur = [px, py]; sx = px; sy = py; };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "Z") {
      if (cur && cur.length >= 6) rings.push(cur);
      cur = null; x = sx; y = sy; lastCmd = "Z";
      continue;
    }
    if (!isNum()) { i++; continue; }
    if (!cur && C !== "M") start(x, y);
    if (C === "M") {
      x = ox + num(); y = oy + num(); start(x, y);
      cmd = rel ? "l" : "L";
    } else if (C === "L") { x = ox + num(); y = oy + num(); push(x, y); }
    else if (C === "H") { x = ox + num(); push(x, y); }
    else if (C === "V") { y = oy + num(); push(x, y); }
    else if (C === "Q" || C === "T") {
      let qx, qy;
      if (C === "Q") { qx = ox + num(); qy = oy + num(); }
      else if (lastCmd === "Q" || lastCmd === "T") { qx = 2 * x - lcx; qy = 2 * y - lcy; }
      else { qx = x; qy = y; }
      const ex = ox + num(), ey = oy + num();
      for (let k = 1; k <= 6; k++) {
        const t = k / 6, u = 1 - t;
        push(u * u * x + 2 * u * t * qx + t * t * ex, u * u * y + 2 * u * t * qy + t * t * ey);
      }
      lcx = qx; lcy = qy; x = ex; y = ey;
    } else if (C === "C" || C === "S") {
      let c1x, c1y;
      if (C === "C") { c1x = ox + num(); c1y = oy + num(); }
      else if (lastCmd === "C" || lastCmd === "S") { c1x = 2 * x - lcx; c1y = 2 * y - lcy; }
      else { c1x = x; c1y = y; }
      const c2x = ox + num(), c2y = oy + num(), ex = ox + num(), ey = oy + num();
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
        push(a * x + b * c1x + c * c2x + e * ex, a * y + b * c1y + c * c2y + e * ey);
      }
      lcx = c2x; lcy = c2y; x = ex; y = ey;
    } else if (C === "A") {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
      const ex = ox + num(), ey = oy + num();
      arcPoints(x, y, rx, ry, rot, large, sweep, ex, ey, push);
      x = ex; y = ey;
    } else { i++; }
    lastCmd = C;
  }
  if (cur && cur.length >= 6) rings.push(cur);
  return rings;
}

// SVG endpoint arc -> points (spec F.6.5)
function arcPoints(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2, push) {
  if (!rx || !ry) { push(x2, y2); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(dt) / (Math.PI / 18)));
  for (let k = 1; k <= steps; k++) {
    const t = t1 + (dt * k) / steps;
    const px = rx * Math.cos(t), py = ry * Math.sin(t);
    push(cp * px - sp * py + cx, sp * px + cp * py + cy);
  }
}

const attr = (tag, name) => {
  const m = new RegExp("\\s" + name + '="([^"]*)"').exec(tag);
  return m ? m[1] : null;
};

// Parse one of the Infinite Frames yin-yang frame SVGs (1000x1000 viewBox).
export function parseSvgFrame(text) {
  const rect = /<rect\b[^>]*>/.exec(text);
  const g = /<g\b[^>]*transform="rotate\(([-\d.]+)/.exec(text);
  const paths = [];
  for (const m of text.matchAll(/<path\b[^>]*>/g)) {
    const tag = m[0];
    const d = attr(tag, "d");
    if (!d) continue;
    const rings = parsePathData(d);
    if (!rings.length) continue;
    paths.push({ rings, fill: attr(tag, "fill") || "#fff", rule: attr(tag, "fill-rule") === "evenodd" ? "evenodd" : "nonzero" });
  }
  return { bg: (rect && attr(rect[0], "fill")) || "#020204", rotate: g ? Number(g[1]) : 0, paths };
}

// Convert parsed frame paths into child-node fields inside a frame node whose
// local square spans +-0.7071 (unit radius).
export function frameChildren(frame) {
  const rot = (frame.rotate * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
  const k = 0.7071 / 500;
  return frame.paths.map((p) => {
    const flat = [], rings = [];
    for (const ring of p.rings) {
      rings.push(ring.length >> 1);
      for (let i = 0; i < ring.length; i += 2) {
        const dx = ring[i] - 500, dy = ring[i + 1] - 500;
        flat.push((c * dx - s * dy) * k, (s * dx + c * dy) * k);
      }
    }
    const n = normalize(flat);
    return { x: round4(n.x), y: round4(n.y), s: round4(n.s), r: 0, pts: n.pts, rings: rings.length > 1 ? rings : null, smooth: false, rule: p.rule, fill: p.fill, clip: false };
  });
}
