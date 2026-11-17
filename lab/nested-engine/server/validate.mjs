// Strict op validation. Everything a client sends is untrusted; only known
// fields with sane values reach other clients or the database.

const ID = /^[a-z0-9]{4,24}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|hsla?\(\s*-?[\d.]+(deg)?[\s,]+[\d.]+%[\s,]+[\d.]+%(\s*[/,]\s*[\d.]+%?)?\s*\))$/;
const ANIMS = new Set(["hue", "pulse", "spin", "orbit"]);
const fin = (v, lo = -1e9, hi = 1e9) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function field(k, v) {
  switch (k) {
    case "x": case "y": return fin(v, -1e6, 1e6);
    case "s": return fin(v, 1e-9, 1e6);
    case "r": return fin(v, -1e4, 1e4);
    case "ord": return fin(v, -1e12, 1e12);
    case "pts": return Array.isArray(v) && v.length >= 6 && v.length <= 40000 && v.length % 2 === 0 && v.every((p) => fin(p, -1e4, 1e4));
    case "rings": return v === null || (Array.isArray(v) && v.length <= 2000 && v.every((n) => Number.isInteger(n) && n >= 3));
    case "smooth": case "clip": return typeof v === "boolean";
    case "rule": return v === "nonzero" || v === "evenodd";
    case "fill": return typeof v === "string" && v.length <= 48 && COLOR.test(v);
    case "tag": return v === null || (typeof v === "string" && v.length <= 32);
    case "anim": return v === null || (v && typeof v === "object" && ANIMS.has(v.kind) && fin(v.speed, -1000, 1000) && (v.amp === undefined || fin(v.amp, 0, 0.5)));
    default: return false;
  }
}

const NODE_FIELDS = ["x", "y", "s", "r", "ord", "pts", "rings", "smooth", "clip", "rule", "fill", "tag", "anim"];
const DEFAULTS = { x: 0, y: 0, s: 1, r: 0, ord: 0, rings: null, smooth: false, clip: true, rule: "nonzero", fill: "#888888", tag: null, anim: null };

function cleanAnim(a) {
  return a === null ? null : { kind: a.kind, speed: a.speed, ...(a.amp !== undefined ? { amp: a.amp } : {}) };
}

function ringsMatch(rings, pts) {
  if (!rings) return true;
  return rings.reduce((a, b) => a + b, 0) === pts.length / 2;
}

export function validateOp(op) {
  if (!op || typeof op !== "object") return { ok: false, reason: "bad op" };
  if (op.kind === "create") {
    const n = op.node || {};
    if (!ID.test(n.id || "") || !ID.test(n.parent || "")) return { ok: false, reason: "bad id" };
    if (!Number.isInteger(n.depth) || n.depth < 1 || n.depth > 4096) return { ok: false, reason: "bad depth" };
    const out = { id: n.id, parent: n.parent, depth: n.depth };
    for (const k of NODE_FIELDS) {
      const v = k in n ? n[k] : DEFAULTS[k];
      if (k === "pts" && !(k in n)) return { ok: false, reason: "missing pts" };
      if (!field(k, v)) return { ok: false, reason: "bad " + k };
      out[k] = k === "anim" ? cleanAnim(v) : v;
    }
    if (!ringsMatch(out.rings, out.pts)) return { ok: false, reason: "rings mismatch" };
    out.nchild = 0;
    return { ok: true, op: { kind: "create", node: out } };
  }
  if (op.kind === "patch") {
    if (!ID.test(op.id || "")) return { ok: false, reason: "bad id" };
    const set = {};
    let count = 0;
    for (const k in op.set || {}) {
      if (!NODE_FIELDS.includes(k)) return { ok: false, reason: "unknown field " + k };
      if (!field(k, op.set[k])) return { ok: false, reason: "bad " + k };
      set[k] = k === "anim" ? cleanAnim(op.set[k]) : op.set[k];
      count++;
    }
    if (!count) return { ok: false, reason: "empty patch" };
    if ("rings" in set && "pts" in set && !ringsMatch(set.rings, set.pts)) return { ok: false, reason: "rings mismatch" };
    return { ok: true, op: { kind: "patch", id: op.id, set } };
  }
  if (op.kind === "delete") {
    if (!ID.test(op.id || "") || op.id === "root") return { ok: false, reason: "bad id" };
    return { ok: true, op: { kind: "delete", id: op.id } };
  }
  return { ok: false, reason: "unknown kind" };
}
