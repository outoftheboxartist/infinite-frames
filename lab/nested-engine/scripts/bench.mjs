// Benchmark in a real browser (Playwright Chromium) against the running lab
// server. Usage: npm start (in another shell), then: npm run bench
//
// Scenarios:
//  1. overview  - whole world on screen for 3 s
//  2. dive      - camera flight from the world down 44 levels (~10^30x)
//  3. galaxy    - fly into the 20,000-star region and sweep across it
//  4. crowd     - N simulated collaborators each dragging a shape at 30 Hz
//                 plus presence at 20 Hz, while two browser viewers watch.
//                 Measures edit-to-screen latency on the viewer and its fps.

import { createRequire } from "node:module";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const URL_ = process.env.LAB_URL || "http://localhost:8787/";
const BOTS = Number(process.env.BOTS || 15);
const W = 1280, H = 800;

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const summary = (frames) => {
  const dt = frames.map((f) => f.dt).slice(2), cpu = frames.map((f) => f.cpu);
  return {
    frames: frames.length,
    fps_avg: +(1000 / (dt.reduce((a, b) => a + b, 0) / Math.max(1, dt.length))).toFixed(1),
    frame_ms_p50: +pct(dt, 50).toFixed(1), frame_ms_p95: +pct(dt, 95).toFixed(1), frame_ms_p99: +pct(dt, 99).toFixed(1), frame_ms_max: +Math.max(...dt).toFixed(1),
    over_33ms: dt.filter((d) => d > 33.4).length,
    render_cpu_ms_p50: +pct(cpu, 50).toFixed(2), render_cpu_ms_p95: +pct(cpu, 95).toFixed(2),
    drawn_max: Math.max(...frames.map((f) => f.drawn)), max_depth: Math.max(...frames.map((f) => f.depth)),
  };
};

const browser = await chromium.launch({ args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"] });
const results = {};

async function openViewer() {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__lab && window.__lab.backend.ready && window.__lab.scene.size > 1000, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  return { page, errors };
}

const v = await openViewer();
const page = v.page;

// 1. overview
await page.evaluate(() => __lab.record());
await page.waitForTimeout(3000);
results.overview = summary(await page.evaluate(() => __lab.stopRecording()));

// 2. dive
await page.evaluate(() => __lab.record());
const t0 = Date.now();
await page.evaluate(() => __lab.dive());
await page.waitForFunction(() => !__lab.S.seek && __lab.depth() >= 40, null, { timeout: 60000, polling: 200 });
results.dive = { seconds: +((Date.now() - t0) / 1000).toFixed(1), zoom_log10: +(await page.evaluate(() => __lab.zoomExponent())).toFixed(1), ...summary(await page.evaluate(() => __lab.stopRecording())) };

// 3. galaxy: fly there, then sweep in and out across the dense star field
await page.evaluate(() => __lab.home());
await page.waitForFunction(() => !__lab.S.seek, null, { timeout: 30000, polling: 200 });
const galaxyId = await page.evaluate(() => __lab.scene.childrenOf("root").find((n) => n.tag === "galaxy").id);
await page.evaluate((id) => __lab.seekTo(id, { fit: 0.95 }), galaxyId);
await page.waitForFunction(() => !__lab.S.seek, null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(1500); // let 20k stars stream in
await page.evaluate(() => __lab.record());
await page.evaluate(async (id) => {
  const g = __lab.scene.get(id);
  const kids = __lab.scene.childrenOf(id);
  const pick = [kids[100], kids[5000], kids[12000], kids[19999]];
  for (const k of pick) {
    __lab.seekTo(k.id, { fit: 0.05 });
    await new Promise((r) => setTimeout(r, 1500));
  }
  __lab.seekTo(g.id, { fit: 0.95 });
  await new Promise((r) => setTimeout(r, 1500));
}, galaxyId);
results.galaxy = { stars_loaded: await page.evaluate((id) => __lab.scene.childrenOf(id).length, galaxyId), ...summary(await page.evaluate(() => __lab.stopRecording())) };

// 4. crowd: bots + a second viewer; measure edit -> other screen latency
await page.evaluate(() => __lab.home());
await page.waitForFunction(() => !__lab.S.seek, null, { timeout: 30000, polling: 200 });
const v2 = await openViewer();

// targets: one shape per bot inside the 8 regular regions, visible at overview
const targets = await page.evaluate(() => {
  const out = [];
  for (const r of __lab.scene.childrenOf("root").filter((n) => n.tag === "reg")) for (const k of __lab.scene.childrenOf(r.id)) out.push({ id: k.id, x: k.x, y: k.y });
  return out;
});
const bots = [];
for (let i = 0; i < BOTS; i++) {
  const ws = new WebSocket(URL_.replace(/^http/, "ws") + "ws");
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", user: { name: "Bot " + (i + 1), color: "#ff9147" } }));
  bots.push({ ws, target: targets[i % targets.length], cid: 0 });
}
// the measured edit: viewer 2 moves a shape; viewer 1 timestamps when it sees it
const probe = targets[targets.length - 1];
await page.evaluate((id) => {
  window.__probe = { id, seen: [] };
  const tick = () => {
    const n = __lab.scene.get(id);
    if (n && n.x !== window.__probe.lastX) { window.__probe.lastX = n.x; window.__probe.seen.push({ x: n.x, at: Date.now() }); }
    requestAnimationFrame(tick);
  };
  tick();
}, probe.id);
await page.evaluate(() => __lab.record());
const crowdStart = Date.now();
const timers = bots.map((b, i) => setInterval(() => {
  const t = (Date.now() - crowdStart) / 1000;
  b.ws.send(JSON.stringify({ t: "op", cid: ++b.cid, op: { kind: "patch", id: b.target.id, set: { x: b.target.x + 0.03 * Math.sin(t * 3 + i), y: b.target.y + 0.03 * Math.cos(t * 2 + i) } } }));
  if (b.cid % 2 === 0) b.ws.send(JSON.stringify({ t: "presence", p: { cur: [["root", Math.sin(t + i) * 0.5, Math.cos(t + i) * 0.5]], view: { anchor: "root", cx: 0, cy: 0, z: 300, cr: 0 }, depth: 0 } }));
}, 33));
const sent = [];
for (let i = 0; i < 90; i++) {
  const x = +(probe.x + 0.0001 * (i + 1)).toFixed(6);
  sent.push({ x, at: Date.now() });
  await v2.page.evaluate(([id, x]) => { __lab.patch(id, { x }); }, [probe.id, x]);
  await new Promise((r) => setTimeout(r, 33));
}
await new Promise((r) => setTimeout(r, 500));
timers.forEach(clearInterval);
const seen = await page.evaluate(() => window.__probe.seen);
const lat = [];
for (const s of sent) { const hit = seen.find((e) => Math.abs(e.x - s.x) < 1e-9); if (hit) lat.push(hit.at - s.at); }
results.crowd = {
  simulated_editors: BOTS, browser_viewers: 2, edits_per_second_total: Math.round((BOTS + 1) * 30),
  probe_edits_sent: sent.length, probe_edits_seen: lat.length,
  edit_to_screen_ms_p50: pct(lat, 50), edit_to_screen_ms_p95: pct(lat, 95), edit_to_screen_ms_max: Math.max(...lat),
  viewer: summary(await page.evaluate(() => __lab.stopRecording())),
};
for (const b of bots) b.ws.close();
const stats = await (await fetch(URL_ + "api/stats")).json();
results.server = { ops_total: stats.ops, flushes: stats.flushes, last_flush_ms: +stats.flushMs.toFixed(1), largest_flush_ops: stats.maxBatch, errors: stats.errors };
results.page_errors = [...v.errors, ...v2.errors];

console.log(JSON.stringify(results, null, 2));
await browser.close();
