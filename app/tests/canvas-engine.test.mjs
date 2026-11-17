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
