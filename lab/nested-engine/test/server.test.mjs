// End-to-end: a real server process, real Postgres, two WebSocket clients.
// Skips itself when no database is reachable (e.g. in CI without Postgres).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import pg from "pg";

const PORT = 8799;
const DB = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/nested_lab";
let server, dbOk = false, pool;

before(async () => {
  pool = new pg.Pool({ connectionString: DB, max: 2 });
  try {
    const { rows } = await pool.query("select count(*)::int as n from if_lab_nodes where id = 'root'");
    dbOk = rows[0].n === 1;
  } catch { dbOk = false; }
  if (!dbOk) return;
  server = spawn(process.execPath, [new URL("../server/server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes("nested-engine lab") && resolve()));
});

after(async () => {
  if (server) server.kill("SIGTERM");
  await pool.end();
});

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    inbox.push(m);
    for (const w of waiters.slice()) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const next = (pred, ms = 3000) => {
    const found = inbox.find(pred);
    if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: (m) => { inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
      waiters.push(w);
      setTimeout(() => reject(new Error(name + " timed out")), ms);
    });
  };
  const send = (m) => ws.send(JSON.stringify(m));
  const open = new Promise((r) => ws.on("open", r)).then(() => { send({ t: "hello", user: { name, color: "#3fd8ff" } }); return next((m) => m.t === "welcome"); });
  return { ws, send, next, open };
}

test("two clients: edits relay instantly, persist in batches, survive reload", async (t) => {
  if (!dbOk) { t.skip("no seeded database"); return; }
  const a = client("A"), b = client("B");
  await Promise.all([a.open, b.open]);

  // lazy load: root's children arrive paged with done=true at the end
  a.send({ t: "load", ids: ["root"] });
  const page = await a.next((m) => m.t === "nodes" && m.done);
  assert.equal(page.nodes.filter((n) => n.by === "seed").length, 10, "the 10 seeded regions (people may have drawn more)");

  // create + move: B sees both immediately, A gets acks
  const id = "test" + Date.now().toString(36);
  const t0 = performance.now();
  a.send({ t: "op", cid: 1, op: { kind: "create", node: { id, parent: "root", depth: 1, ord: 99, x: 0.1, y: 0.1, s: 0.05, r: 0, pts: [0, 0, 1, 0, 0, 1], fill: "#ff52b9" } } });
  const seen = await b.next((m) => m.t === "op" && m.op.kind === "create" && m.op.node.id === id);
  const relayMs = performance.now() - t0;
  const ack = await a.next((m) => m.t === "ack" && m.cid === 1);
  assert.equal(seen.seq, ack.seq);
  assert.ok(relayMs < 100, "relay took " + relayMs.toFixed(1) + " ms");

  // a burst of 60 drag patches coalesces into one row update
  for (let i = 0; i < 60; i++) a.send({ t: "op", cid: 2 + i, op: { kind: "patch", id, set: { x: 0.1 + i * 0.001 } } });
  await a.next((m) => m.t === "ack" && m.cid === 61);

  // a load *before* the flush already reflects the newest value (overlay)
  b.send({ t: "load", ids: ["root"] });
  const fresh = await b.next((m) => m.t === "nodes" && m.done);
  const mine = fresh.nodes.find((n) => n.id === id);
  assert.ok(mine, "new node visible to late loaders");
  assert.ok(Math.abs(mine.x - 0.159) < 1e-9);

  // after the flush interval it's in Postgres, including nchild via trigger
  await new Promise((r) => setTimeout(r, 400));
  const { rows } = await pool.query("select x, v from if_lab_nodes where id = $1", [id]);
  assert.ok(Math.abs(rows[0].x - 0.159) < 1e-9);
  const ops = await pool.query("select count(*)::int as n from if_lab_ops where node_id = $1", [id]);
  assert.equal(ops.rows[0].n, 61, "every op is in the history log");

  // bad op is refused, not relayed
  a.send({ t: "op", cid: 999, op: { kind: "patch", id, set: { fill: "javascript:1" } } });
  const rej = await a.next((m) => m.t === "reject" && m.cid === 999);
  assert.match(rej.reason, /fill/);

  // presence relays with name/color stamped by the server
  a.send({ t: "presence", p: { cur: [[id, 0.1, 0.2]], view: { anchor: "root", cx: 0, cy: 0, z: 300, cr: 0 }, depth: 0 } });
  const pres = await b.next((m) => m.t === "presence");
  assert.equal(pres.p.name, "A");

  // clean up
  a.send({ t: "op", cid: 1000, op: { kind: "delete", id } });
  await b.next((m) => m.t === "op" && m.op.kind === "delete");
  await new Promise((r) => setTimeout(r, 400));
  const gone = await pool.query("select count(*)::int as n from if_lab_nodes where id = $1", [id]);
  assert.equal(gone.rows[0].n, 0);
  a.ws.close(); b.ws.close();
});
