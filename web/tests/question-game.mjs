// End-to-end check of the question game against the app's demo backend (no network).
// Run: npx vite --port 5199 &  then  node tests/question-game.mjs [screenshot-dir]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
const shots = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 2 : 1 });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/src/claude-shim.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.__ifShimReady({use:async()=>null});" }));
await page.goto("http://localhost:5199/");
await page.waitForFunction(() => window.__ifApp && window.__ifApp.state.B.length > 0 && window.__ifGate);
const shot = async (n) => { if (shots) await page.screenshot({ path: `${shots}/${n}.png` }); };
const ev = (f, a) => page.evaluate(f, a);

// someone else asks a question on the first window, and two people answer it
await ev(async () => {
  const app = window.__ifApp, be = app.props.backend, b = app.state.B[0];
  await be.sendMessage({ id: "q1", who: "ana.k", whoId: "u-ana", idea: true, q: true, b: b.id, text: "What is love?" });
  await be.sendMessage({ id: "a1", who: "mjfh", whoId: "u-mj", idea: true, a: true, parent: "q1", b: b.id, text: "Paying attention." });
  await be.sendMessage({ id: "a2", who: "rio", whoId: "u-rio", idea: true, a: true, parent: "q1", b: b.id, text: "Staying." });
});
const bid = await ev(() => window.__ifApp.state.B[0].id);
await ev((id) => window.__ifApp.select(id), bid);
await page.waitForSelector("[role=dialog] textarea");
const blind = await page.textContent("[role=dialog]");
assert.match(blind, /What is love\?/); assert.match(blind, /2 answers are hidden/);
assert.doesNotMatch(blind, /Paying attention|Staying\./, "answers must be hidden before answering");
assert.equal(await ev((id) => window.__ifGate(window.__ifApp, id), bid), false, "drawing is gated");
assert.doesNotMatch(await page.textContent("body"), /Paying attention|Staying\./, "hidden in the chat wall too");
await shot("1-answer-blind");

await page.fill("#ifq-text", "Showing up when it is hard.");
await page.click("[role=dialog] button[type=submit]");
await page.waitForFunction(() => /Paying attention/.test(document.querySelector("[role=dialog]").textContent));
let reveal = await page.textContent("[role=dialog]");
assert.match(reveal, /Staying\./); assert.doesNotMatch(reveal, /MJFH · \d/, "counts hidden until you vote");
await page.click("[role=dialog] button:has-text('Agree')");
await page.waitForFunction(() => /1 AGREE/.test(document.querySelector("[role=dialog]").textContent));
await shot("2-reveal");
// a different opinion is stored as another answer to the same question
await page.click("[role=dialog] button:has-text('Different opinion')");
await page.fill("#ifq-diff", "It is also letting go.");
await page.click("[role=dialog] button:has-text('Add it')");
const mineId = await ev(() => window.__ifApp.state.chat.find((m) => m.a && m.mine && !m.alt).id);
assert.equal(await ev(() => window.__ifApp.state.chat.filter((m) => m.a && m.parent === "q1").length), 4);
// you cannot vote on your own answer
await ev((id) => { const a = window.__ifApp; a.castVote(a.state.chat.find((m) => m.id === id), "agree"); }, mineId);
assert.equal(await ev((id) => window.__ifApp.state.chat.find((m) => m.id === id).agree || 0, mineId), 0);

await page.click("[role=dialog] button:has-text('Start drawing')");
assert.equal(await ev((id) => window.__ifGate(window.__ifApp, id), bid), true, "answered: window is open");
// draw a stroke inside the window; it remembers the answer behind it
await page.waitForTimeout(900);
const box = await page.evaluate((id) => { const r = document.getElementById("ifv-p-" + id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.6 }; }, bid);
await page.mouse.move(box.x, box.y); await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + i * 5, box.y + i * 2);
await page.mouse.up();
const stroke = await ev(() => window.__ifApp.state.drafts.find((d) => d.type === "stroke"));
assert.ok(stroke, "a stroke was drawn"); assert.equal(stroke.ans, mineId);
await shot("3-drawing");

// the crowd agrees with my answer: strokes grow, then brush, then colours unlock
const agree = (n, from) => ev(async ([id, n, from]) => { for (let i = from; i < from + n; i++) await window.__ifApp.props.backend.vote({ msgId: id, voterId: "v" + i, kind: "agree" }); }, [mineId, n, from]);
assert.deepEqual(await ev(() => window.__ifBrushes(window.__ifApp)), [6, 12, 22]);
await agree(3, 0);
await page.waitForFunction(() => window.__ifBrushes(window.__ifApp).length === 4);
assert.ok(await ev((id) => window.__ifGrow(window.__ifApp, id), mineId) > 1.2);
const pal = () => ev((id) => { const a = window.__ifApp, b = a.state.B.find((x) => x.id === id); return [window.__ifPalette(a, b, ["#000001", ...b.palette]).length, b.palette.length]; }, bid);
let [p, base] = await pal(); assert.equal(p, base, "colours still inside the rule");
await agree(3, 3);
await page.waitForFunction(() => /Every colour/.test(document.body.textContent), null, { timeout: 4000 });
[p, base] = await pal(); assert.equal(p, base + 1, "colours outside the rule unlocked");
const width = await ev(() => { const s = window.__ifApp.state.drafts.find((d) => d.type === "stroke"); return [...document.querySelectorAll("svg path")].filter((n) => n.getAttribute("d") === s.d).map((n) => +n.getAttribute("stroke-width")); });
assert.ok(width.some((w) => w > stroke.w), "the stroke on the canvas grew: " + width);
await page.waitForSelector("#ifq-pill:not([hidden])");
assert.match(await page.textContent("#ifq-pill"), /Q · What is love\? · 4/);
await page.waitForFunction(() => !window.__ifApp.state.toast, null, { timeout: 8000 });
await page.waitForSelector("#ifq-pill:not([hidden])");
await shot("4-unlocked");
// windows without a question are untouched
const other = await ev(() => window.__ifApp.state.B[1].id);
assert.equal(await ev((id) => window.__ifGate(window.__ifApp, id), other), true);
assert.deepEqual(errors, []);
await browser.close();
console.log("question game: all checks passed");
