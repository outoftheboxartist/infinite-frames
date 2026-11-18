// Canvas engine transplanted into the original app (app/if-canvas-engine.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const read = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
const engineSrc = read("../if-canvas-engine.js");
const html = read("../index.html");
const sandbox = {};
vm.runInNewContext(engineSrc, { window: sandbox, globalThis: sandbox, Math, Map, WeakMap, WeakSet, String, Number, Infinity });
const IFEngine = sandbox.IFEngine;
const { parse, shape, itemMatrix, tr, clipRect, setDigits } = IFEngine._internal;
const plain = (v) => JSON.parse(JSON.stringify(v)); // arrays from the vm sandbox
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test("engine loads after the guest sandbox and before the app bundle", () => {
  const a = html.indexOf('<script src="./guest-sandbox.js"></script>');
  const b = html.indexOf('<script src="./if-canvas-engine.js"></script>');
  const c = html.indexOf("class Nc extends");
  assert.ok(a >= 0 && b > a && c > b);
});

test("app wiring: view owned by the engine, deep zoom, canvas behind the svg, SVG fallback kept", () => {
  assert.match(html, /setView\(n\)\{const Z=window\.IFEngine\?window\.IFEngine\.MAXZ:256/);
  assert.match(html, /if\(this\.ifEngine\)\{this\.state\.view=v;this\.ifEngine\.viewChanged\(v\);return\}/);
  assert.match(html, /i\("canvas",\{ref:x=>\{this\.ifAttach\(x\)\}/);
  assert.match(html, /onPointerDown:this\.onDown,onPointerMove:this\.onMove,onPointerUp:this\.onUp,onPointerCancel:this\.onUp\},\.\.\.\(window\.IFEngine\?\[\]:this\.prismWrap/);
  assert.match(html, /if\(this\.ifEngine\)hit=this\.ifEngine\.hit\(i,n\)/);
  assert.match(html, /function ls\(e\)\{const t=e\.length,n=i=>i\.toFixed\(window\.__ifDigits\|\|1\)/);
  assert.match(html, /function Di\(e\)\{const t=i=>i\.toFixed\(window\.__ifDigits\|\|1\)/);
  assert.match(html, /l\.w\*this\.state\.view\.z<40/);
  assert.match(html, /w:r\.brush\/Math\.max\(1,r\.view\.z\)/);
  assert.equal(IFEngine.MAXZ, 1e8);
});

test("SVG path parsing: absolute, relative, shorthand, arcs, close", () => {
  const subs = parse("M10,10 h10 v10 H10 Z m5,5 l1,1 C1,2 3,4 5,6 S9,10 11,12 Q20,20 30,10 T50,10 A5,5 0 0 1 60,10 z");
  assert.equal(subs.length, 2);
  assert.deepEqual(plain(subs[0].segs), [[20, 10], [20, 20], [10, 20]]);
  assert.ok(subs[0].closed && subs[1].closed);
  assert.deepEqual([subs[1].x, subs[1].y], [15, 15], "relative move after Z starts from the subpath start");
  const segs = subs[1].segs;
  assert.deepEqual(plain(segs[0]), [16, 16]);
  assert.deepEqual(plain(segs[2].slice(0, 2)), [7, 8], "S reflects the previous control point");
  const q = segs[3]; // Q20,20 30,10 from (11,12) as a cubic
  close(q[0], 11 + (2 / 3) * 9); close(q[4], 30); close(q[5], 10);
  const last = segs[segs.length - 1];
  close(last[4], 60); close(last[5], 10, 1e-9);
  assert.deepEqual(plain(parse("M1.5.5L.5-1e1").map((s) => [s.x, s.y, ...s.segs[0]])), [[1.5, 0.5, 0.5, -10]], "compact number syntax");
});

test("item transforms match the SVG transform the app used", () => {
  // translate(t.x,t.y) translate(cx,cy) rotate(r) scale(s) translate(-cx,-cy)
  const M = itemMatrix({ cx: 500, cy: 500, t: { x: 10, y: -20, r: 90, s: 2 } });
  const c = tr(M, 500, 500); close(c[0], 510); close(c[1], 480);
  const p = tr(M, 501, 500); close(p[0], 510, 1e-9); close(p[1], 482, 1e-9);
  assert.equal(itemMatrix({ type: "stroke" }), null);
});

test("shapes are stored relative to their own center, so deep shapes keep their precision", () => {
  const cx = 511.99999982450004, cy = 492.0000001295, r = 1e-7;
  const d = `M${cx + r},${cy}L${cx},${cy + r}L${cx - r},${cy}L${cx},${cy - r}Z`;
  const e = shape(d);
  close(e.cx, cx, 1e-12); close(e.cy, cy, 1e-12);
  // global coordinates near 500 carry ~1e-13 absolute precision: 100,000x finer
  // than one pixel at the deepest zoom (1e8x -> ~2.5e-8 units per pixel)
  close(e.size, 2 * r, 1e-12);
  // the local numbers handed to the GPU are ~1e-7, not ~500
  for (const g of e.subs[0].segs) assert.ok(Math.abs(g[0] - e.cx) <= r * 1.001 && Math.abs(g[1] - e.cy) <= r * 1.001);
});

test("huge shapes are clipped to the screen before drawing", () => {
  const ring = [-1e9, -1e9, 1e9, -1e9, 1e9, 1e9, -1e9, 1e9];
  const out = clipRect(ring, [0, 0, 390, 400]);
  for (let i = 0; i < out.length; i += 2) {
    assert.ok(out[i] >= 0 && out[i] <= 390 && out[i + 1] >= 0 && out[i + 1] <= 400);
  }
});

test("saved path precision follows the zoom", () => {
  setDigits(1); assert.equal(sandbox.__ifDigits, 2);
  setDigits(256); assert.equal(sandbox.__ifDigits, 5);
  setDigits(1e8); assert.equal(sandbox.__ifDigits, 10);
});

// ---- navigation + image trace (2026-11-18) ----
const { inv } = IFEngine._internal;

test("rotated view: screen <-> world round-trip is exact", () => {
  const V = IFEngine.prototype.viewMatrix.call({ view: { x: 512.25, y: 491.5, z: 3e5, r: 0.7 } }, 390, 400);
  const p = tr(V, 512.2501, 491.4999), q = tr(inv(V), p[0], p[1]);
  close(q[0], 512.2501, 1e-9); close(q[1], 491.4999, 1e-9);
  const c = tr(V, 512.25, 491.5); close(c[0], 195, 1e-6); close(c[1], 200, 1e-6);
});

function grid(rows) { // rows of characters -> labels (. = transparent)
  const H = rows.length, W = rows[0].length, L = new Int16Array(W * H);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { L[y * W + x] = ch === "." ? -1 : ch.charCodeAt(0) - 97; }));
  return { L, W, H };
}

test("trace: every connected patch of one colour is its own shape, holes stay inside it", () => {
  const { L, W, H } = grid([
    "aaaaaaaa",
    "abbbbbba",
    "ab....ba",
    "ab....ba",
    "abbbbbba",
    "aaaaaaaa",
    "cc....cc",
  ]);
  const r = IFEngine.shapeTrace(L, W, H, 1, 100);
  // shapes: outer a-ring, inner b-ring, and two separate c patches
  assert.equal(r.regions.length, 4);
  const ringA = r.regions.find((x) => x.label === 0), ringB = r.regions.find((x) => x.label === 1);
  assert.equal(ringA.area, 24); assert.equal(ringB.area, 16);
  assert.equal(r.ids[2 * W + 3], -1, "the transparent hole is not part of any shape");
  assert.equal(r.regions.filter((x) => x.label === 2).length, 2, "same colour, not touching = two shapes");
});

test("trace: detail setting is exact; smallest shapes merge into the neighbour they touch most", () => {
  const { L, W, H } = grid([
    "aaaaaaaaaa",
    "aabaaacaaa",
    "aaaaaaaaaa",
    "dddddddddd",
    "ddeedddddd",
  ]);
  const all = IFEngine.shapeTrace(L, W, H, 1, 100);
  assert.equal(all.regions.length, 5);
  const three = IFEngine.shapeTrace(L, W, H, 1, 3);
  assert.equal(three.regions.length, 3, "asked for 3 shapes, got 3");
  assert.equal(three.ids[1 * W + 2], three.ids[0], "speck b merged into a (its only neighbour)");
  const two = IFEngine.shapeTrace(L, W, H, 1, 2);
  assert.deepEqual(plain(two.regions.map((r) => r.label).sort()), [0, 3]);
  for (const v of two.ids) assert.ok(v >= 0, "merging never leaves holes in the picture");
});

test("trace: isolated specks below the speck size are dropped", () => {
  const { L, W, H } = grid(["aaaa....", "aaaa..b.", "aaaa...."]);
  const r = IFEngine.shapeTrace(L, W, H, 2, 100);
  assert.equal(r.regions.length, 1);
  assert.equal(r.ids[1 * W + 6], -1);
});

test("trace detail rules: base for everyone, earned by pieces and points, owner unlimited", () => {
  const R = IFEngine.TRACE_RULES;
  assert.equal(IFEngine.traceLimit({}).limit, R.base);
  assert.equal(IFEngine.traceLimit({ published: 2, points: 25 }).limit, R.base + 2 * R.perPiece + 2 * R.perPoints);
  assert.equal(IFEngine.traceLimit({ published: 999 }).limit, R.cap);
  assert.equal(IFEngine.traceLimit({ owner: true }).limit, R.owner);
  assert.match(IFEngine.traceLimit({ published: 1 }).text, /per published piece/);
});

test("app wiring: lab navigation and shape tracing", () => {
  assert.match(html, /if\(this\.ifEngine\)\{this\.ifEngine\.pinch\(l,o,this\.pinch\);return\}/);
  assert.match(html, /if\(r\.moved&&this\.ifEngine\)\{this\.ifEngine\.dragMove\(n,r\);return\}/);
  assert.match(html, /this\.ifEngine\.release\(this\.drag,this\)/);
  assert.match(html, /if\(this\.ifEngine&&this\.state\.mode==="2d"\)\{this\.ifEngine\.wheel\(n\);return\}/);
  assert.match(html, /world\(n\)\{if\(this\.ifEngine\)return this\.ifEngine\.toWorld/);
  assert.match(html, /if\(i\.shapes&&window\.IFEngine\)\{const sh=IFEngine\.shapeTrace/);
  assert.match(html, /const keep=v\.shapes\?out:out\.slice\(0,200\)/);
  assert.match(html, /S\("maxRegions","Shapes",4,e\.limit\?e\.limit\.limit:200/);
  // every import path is still there
  for (const k of ["onFile", "addImage", "openTrace", "traceActive", "traceTapped", "makeTraceDraft", "tsApply", "IFInPageCamera", 'accept:"image/gif"']) assert.ok(html.includes(k), k);
});

test("trace: thin anti-aliasing fringes fold into the shape they hug", () => {
  // 60x60 solid square (label 0) with a 1-px fringe (label 1) along its right edge, on transparent
  const W = 200, H = 200, L = new Int16Array(W * H).fill(-1);
  for (let y = 5; y < 65; y++) { for (let x = 5; x < 65; x++) L[y * W + x] = 0; L[y * W + 65] = 1; }
  const r = IFEngine.shapeTrace(L, W, H, 1, 100);
  assert.equal(r.regions.length, 1, "fringe merged");
  assert.equal(r.regions[0].area, 60 * 60 + 60);
});
