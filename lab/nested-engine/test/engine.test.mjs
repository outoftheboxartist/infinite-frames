import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mul, inv, apply, trs, scaleOf } from "../public/src/mat.js";
import { containsLocal, clipToRect, screenRings, simplify, normalize, localBounds } from "../public/src/geom.js";
import { parseSvgFrame } from "../public/src/svgimport.js";
import { rootNode, genChildren, childCount, makeCtx } from "../public/src/seedgen.js";
import { createCamera, rebase, zoomAt, chainMatrices, panBy } from "../public/src/camera.js";
import { Scene } from "../public/src/scene.js";
import { validateOp } from "../server/validate.mjs";

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} vs ${b} (eps ${eps})`);

test("matrix inverse and composition round-trip", () => {
  const a = trs(3, -2, 0.25, 1.1), b = trs(-0.4, 0.9, 7, -0.3);
  const m = mul(a, b);
  const p = apply(mul(inv(m), m), 0.37, -1.9);
  close(p[0], 0.37, 1e-12); close(p[1], -1.9, 1e-12);
  close(scaleOf(m), 1.75, 1e-12);
});

test("point-in-shape: nonzero square, even-odd ring with hole", () => {
  const sq = { pts: [-1, -1, 1, -1, 1, 1, -1, 1], smooth: false };
  assert.ok(containsLocal(sq, 0, 0));
  assert.ok(!containsLocal(sq, 1.5, 0));
  const ring = { pts: [-1, -1, 1, -1, 1, 1, -1, 1, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], rings: [4, 4], rule: "evenodd", smooth: false };
  assert.ok(!containsLocal(ring, 0, 0), "hole is empty");
  assert.ok(containsLocal(ring, 0.75, 0), "band is filled");
});

test("huge shapes are clipped to the viewport in float64", () => {
  const circle = { pts: [], smooth: true };
  for (let i = 0; i < 24; i++) circle.pts.push(Math.cos((i / 24) * Math.PI * 2), Math.sin((i / 24) * Math.PI * 2));
  // circle of radius 1e9 px centered on screen: must come back as the view rect
  const M = trs(640, 400, 1e9, 0);
  const rings = screenRings(circle, M, [0, 0, 1280, 800]);
  assert.equal(rings.length, 1);
  for (let i = 0; i < rings[0].length; i += 2) {
    assert.ok(rings[0][i] >= -1e-6 && rings[0][i] <= 1280 + 1e-6);
    assert.ok(rings[0][i + 1] >= -1e-6 && rings[0][i + 1] <= 800 + 1e-6);
  }
  // fully off-screen: nothing
  assert.equal(screenRings(circle, trs(1e12, 0, 10, 0), [0, 0, 1280, 800]).length, 0);
  assert.deepEqual(clipToRect([0, 0, 10, 0, 10, 10], [20, 20, 30, 30]), []);
});

test("simplify + normalize produce a unit shape that maps back", () => {
  const pts = [];
  for (let i = 0; i < 200; i++) pts.push(50 + 20 * Math.cos(i / 31.8), 80 + 20 * Math.sin(i / 31.8));
  const s = simplify(pts, 0.05);
  assert.ok(s.length < pts.length);
  const n = normalize(s);
  close(n.x, 50, 0.5); close(n.y, 80, 0.5); close(n.s, 20, 0.5);
});

test("yin-yang SVG frames import as real multi-ring paths", () => {
  const counts = [3, 6, 8, 12, 17];
  for (let i = 1; i <= 5; i++) {
    const f = parseSvgFrame(fs.readFileSync(new URL(`../../../yin-yang-svg/frame-${i}.svg`, import.meta.url), "utf8"));
    assert.equal(f.paths.length, counts[i - 1]);
    assert.equal(f.rotate, (i - 1) * 45);
    for (const p of f.paths) for (const r of p.rings) assert.ok(r.length >= 6 && r.every(Number.isFinite));
  }
});

test("world generator is deterministic and nchild matches", () => {
  const ctx = makeCtx([]);
  const root = rootNode();
  const a = genChildren(root, ctx), b = genChildren(root, ctx);
  assert.deepEqual(a, b);
  assert.equal(a.length, childCount(root, ctx));
  const reg = a[4];
  const kids = genChildren(reg, ctx);
  assert.equal(kids.length, reg.nchild);
  assert.equal(new Set(kids.map((k) => k.id)).size, kids.length);
});

// A synthetic tower 80 levels deep: each child is 0.3x its parent, offset and
// rotated. Global scale at the bottom is 0.3^80 ~ 1e-42, impossible in plain
// float64 world coordinates.
function tower(depth = 80) {
  const scene = new Scene();
  const nodes = [];
  const shape = []; for (let i = 0; i < 16; i++) shape.push(Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2));
  let parent = null;
  for (let d = 0; d <= depth; d++) {
    const n = { id: d === 0 ? "root" : "n" + d, parent: parent && parent.id, depth: d, ord: 0, x: d ? 0.31 : 0, y: d ? -0.17 : 0, s: d ? 0.3 : 1, r: d ? 0.4 : 0, pts: shape, smooth: false, rule: "nonzero", fill: "#fff", anim: null, clip: true, nchild: d < depth ? 1 : 0, v: 0 };
    nodes.push(n);
    parent = n;
  }
  scene.addNodes(nodes, nodes.map((n) => n.id));
  return scene;
}

test("camera dives 80 levels (1e-42 scale) and stays pixel-exact", () => {
  const scene = tower(80);
  const W = 1200, H = 800;
  const cam = createCamera("root");
  cam.z = 300;
  for (let step = 0; step < 4000; step++) {
    const { mf } = chainMatrices(scene, cam, W, H, 0);
    // where is the deepest loaded node we know a matrix for? zoom toward the
    // center of the current anchor's child
    const a = scene.get(cam.anchor);
    const child = scene.childrenOf(a.id)[0];
    if (!child) break;
    const M = mul(mf.get(a.id), trs(child.x, child.y, child.s, child.r));
    const c = apply(M, 0, 0);
    panBy(cam, (W / 2 - c[0]) * 0.5, (H / 2 - c[1]) * 0.5);
    zoomAt(cam, 1.15, W / 2, H / 2, W, H);
    rebase(scene, cam, W, H, 0);
  }
  assert.equal(cam.anchor, "n80", "reached the bottom");
  assert.ok(cam.z > 10 && cam.z < 1e10, "anchor-relative zoom stays in range: " + cam.z);
  const { mf } = chainMatrices(scene, cam, W, H, 0);
  // bottom node is centered and its matrix is well-conditioned
  const c = apply(mf.get("n80"), 0, 0);
  close(c[0], W / 2, 2); close(c[1], H / 2, 2);
  for (const v of mf.get("n80")) assert.ok(Number.isFinite(v));
});

test("rebasing is invisible: screen positions don't move across a rebase", () => {
  const scene = tower(10);
  const W = 1000, H = 700;
  const cam = createCamera("root");
  cam.z = 300;
  // zoom in steadily; at each step record the screen position of a fixed point
  // in node n3, before and after rebase
  for (let i = 0; i < 400; i++) {
    zoomAt(cam, 1.05, W / 2 + 13, H / 2 - 7, W, H);
    const before = chainMatrices(scene, cam, W, H, 0).mf;
    const pick = ["n3", "n2", "n1", "root"].find((id) => before.has(id));
    const p0 = apply(before.get(pick), 0.2, 0.1);
    const anchorBefore = cam.anchor;
    rebase(scene, cam, W, H, 0);
    const after = chainMatrices(scene, cam, W, H, 0).mf;
    if (cam.anchor !== anchorBefore && after.has(pick)) {
      const p1 = apply(after.get(pick), 0.2, 0.1);
      close(p1[0], p0[0], 1e-6, "x"); close(p1[1], p0[1], 1e-6, "y");
    }
  }
});

test("rebase up and down with animated (spinning) ancestors", () => {
  const scene = tower(6);
  scene.get("n2").anim = { kind: "spin", speed: 0.7 };
  scene.get("n4").anim = { kind: "pulse", speed: 1.3, amp: 0.05 };
  const W = 900, H = 900;
  const cam = createCamera("root");
  cam.z = 300;
  const t = 12.34;
  let rebases = 0;
  for (let i = 0; i < 300; i++) {
    const mf0 = chainMatrices(scene, cam, W, H, t).mf;
    const a = scene.get(cam.anchor);
    const child = scene.childrenOf(a.id)[0];
    if (child) {
      const c = apply(mul(mf0.get(a.id), trs(child.x, child.y, child.s, child.r)), 0, 0);
      panBy(cam, (W / 2 - c[0]) * 0.5, (H / 2 - c[1]) * 0.5);
    }
    zoomAt(cam, 1.06, W / 2, H / 2, W, H);
    const mf1 = chainMatrices(scene, cam, W, H, t).mf;
    const z0 = mf1.get("root");
    rebases += rebase(scene, cam, W, H, t);
    const mf2 = chainMatrices(scene, cam, W, H, t).mf;
    const z1 = mf2.get("root");
    for (let k = 0; k < 6; k++) close(z1[k], z0[k], Math.abs(z0[k]) * 1e-9 + 1e-6, "root matrix stable across rebase");
  }
  assert.equal(scene.get(cam.anchor).id, "n6", "dove through spinning n2 and pulsing n4");
  assert.ok(rebases >= 6);
});

test("scene: concurrent edits converge (per-field last-writer-wins by server seq)", () => {
  const mk = () => { const s = new Scene(); s.addNodes([{ id: "root", parent: null, depth: 0, ord: 0, x: 0, y: 0, s: 1, r: 0, pts: [0, 0, 1, 0, 0, 1], v: 1 }], []); return s; };
  // Case 1: my edit (seq 10) then theirs (seq 11) -> theirs wins after my ack
  let a = mk();
  a.localPatch("root", { x: 5 }); a.markSent("root", ["x"], 1);
  a.applyRemote({ kind: "patch", id: "root", set: { x: 9 } }, 11); // parked, I'm mid-edit
  assert.equal(a.get("root").x, 5, "no jitter while my edit is in flight");
  a.ack("root", ["x"], 1, 10);
  assert.equal(a.get("root").x, 9, "later remote edit wins");
  // Case 2: theirs (seq 10) then mine (seq 11) -> mine wins
  a = mk();
  a.localPatch("root", { x: 5 }); a.markSent("root", ["x"], 1);
  a.applyRemote({ kind: "patch", id: "root", set: { x: 9 } }, 10);
  a.ack("root", ["x"], 1, 11);
  assert.equal(a.get("root").x, 5);
  // Case 3: unrelated fields from others apply immediately
  a = mk();
  a.localPatch("root", { x: 5 }); a.markSent("root", ["x"], 1);
  a.applyRemote({ kind: "patch", id: "root", set: { y: 3 } }, 12);
  assert.equal(a.get("root").y, 3);
  // Case 4: a stale snapshot never overwrites newer state
  a = mk();
  a.applyRemote({ kind: "patch", id: "root", set: { x: 7 } }, 20);
  a.addNodes([{ id: "root", parent: null, depth: 0, ord: 0, x: 1, y: 0, s: 1, r: 0, pts: [0, 0, 1, 0, 0, 1], v: 15 }], []);
  assert.equal(a.get("root").x, 7);
});

test("scene: subtree delete removes descendants and fixes counts", () => {
  const s = tower(5);
  assert.equal(s.removeSubtree("n2"), 4);
  assert.equal(s.get("n3"), undefined);
  assert.equal(s.get("n1").nchild, 0);
  assert.equal(s.childrenOf("n1").length, 0);
});

test("server validation rejects malformed or hostile ops", () => {
  const good = { kind: "create", node: { id: "abcd1234", parent: "root", depth: 1, pts: [0, 0, 1, 0, 0, 1], fill: "hsl(10 50% 50%)" } };
  assert.ok(validateOp(good).ok);
  assert.ok(!validateOp({ ...good, node: { ...good.node, fill: "url(javascript:alert(1))" } }).ok);
  assert.ok(!validateOp({ ...good, node: { ...good.node, pts: [0, 0, NaN, 0, 0, 1] } }).ok);
  assert.ok(!validateOp({ ...good, node: { ...good.node, rings: [5] } }).ok, "rings must match pts");
  assert.ok(!validateOp({ kind: "patch", id: "abcd1234", set: { evil: 1 } }).ok);
  assert.ok(!validateOp({ kind: "patch", id: "abcd1234", set: { s: -1 } }).ok);
  assert.ok(!validateOp({ kind: "delete", id: "root" }).ok, "the world root can't be deleted");
  assert.ok(validateOp({ kind: "patch", id: "root", set: { fill: "#123456" } }).ok);
  assert.deepEqual(validateOp({ kind: "patch", id: "abcd1234", set: { anim: { kind: "spin", speed: 1, extra: "x" } } }).op.set.anim, { kind: "spin", speed: 1 });
});

test("simplify keeps the shape of a perfectly closed loop", () => {
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push(Math.cos((i / 40) * Math.PI * 2) * 45, Math.sin((i / 40) * Math.PI * 2) * 45);
  const s = simplify(pts, 1.5);
  assert.ok(s.length / 2 >= 8, "kept " + s.length / 2 + " points");
});
