// 2D affine matrices in canvas order [a, b, c, d, e, f]:
//   x' = a*x + c*y + e
//   y' = b*x + d*y + f
// All math is done in float64 (JS numbers). Precision is protected by the
// camera, which is always expressed relative to a nearby "anchor" node, so the
// numbers handled here stay in a sane range no matter how deep you zoom.

export const I = Object.freeze([1, 0, 0, 1, 0, 0]);

export function mul(m, n) {
  // m ∘ n  (apply n first, then m)
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function inv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const id = 1 / det;
  const a = m[3] * id, b = -m[1] * id, c = -m[2] * id, d = m[0] * id;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function applyVec(m, x, y) {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}

// Translate-rotate-scale: p' = R(r) * s * p + (x, y)
export function trs(x, y, s, r) {
  const c = Math.cos(r) * s, n = Math.sin(r) * s;
  return [c, n, -n, c, x, y];
}

export function scaleOf(m) {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export function angleOf(m) {
  return Math.atan2(m[1], m[0]);
}

export function isFiniteMat(m) {
  for (let i = 0; i < 6; i++) if (!Number.isFinite(m[i])) return false;
  return true;
}
