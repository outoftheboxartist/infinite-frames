// Lab server: static files + one WebSocket per client.
//
// Stand-in for Supabase (Realtime broadcast/presence + PostgREST + RPC), built
// around the rule that makes collaboration feel instant: NEVER put the
// database on the hot path.
//
//   edit arrives -> validate -> assign seq -> broadcast to everyone (~1 ms)
//                                          -> queue for Postgres
//   every 100 ms -> one batched transaction writes all queued edits
//
// Loads merge the not-yet-written queue into query results, so a client
// joining mid-drag sees the latest state, not the last flushed one.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { makePool, loadChildren, loadPath, deepest, maxSeq, flush } from "./db.mjs";
import { validateOp } from "./validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const SVG_DIR = path.join(HERE, "..", "..", "..", "yin-yang-svg");
const PORT = Number(process.env.PORT || 8787);
const FLUSH_MS = 100;
const PAGE = 1500;

const pool = makePool();
let seq = await maxSeq(pool);
const clients = new Map(); // ws -> {id, user, presence, budget}
let pending = newBatch();
let flushing = null;
const stats = { ops: 0, flushes: 0, flushMs: 0, loads: 0, loadMs: 0, maxBatch: 0, errors: 0 };

function newBatch() {
  return { creates: new Map(), patches: new Map(), deletes: new Map(), log: [] };
}

// ---- http ---------------------------------------------------------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/stats") {
    const { rows } = await pool.query("select count(*)::int as nodes, max(depth) as depth from if_lab_nodes");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...rows[0], seq, clients: clients.size, ...stats }));
    return;
  }
  let file;
  if (url.pathname.startsWith("/svg/")) file = path.join(SVG_DIR, path.basename(url.pathname));
  else file = path.join(PUBLIC, path.normalize(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(PUBLIC) && !file.startsWith(SVG_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    if (file === path.join(PUBLIC, "index.html")) {
      // The page is written as an artifact body; give it a document shell and
      // tell it a live server is present.
      data = Buffer.concat([
        Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><script>window.IF_LAB_SERVER = true;</script></head><body>'),
        data,
        Buffer.from("</body></html>"),
      ]);
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  });
});

// ---- realtime ----------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 2 * 1024 * 1024, perMessageDeflate: { threshold: 2048 } });

wss.on("connection", (ws) => {
  const c = { id: "c" + Math.random().toString(36).slice(2, 10), user: null, presence: null, budget: 60 };
  clients.set(ws, c);
  ws.on("message", (buf) => {
    let m;
    try { m = JSON.parse(buf); } catch { return; }
    handle(ws, c, m).catch((e) => { stats.errors++; console.error("handler error", e.message); });
  });
  ws.on("close", () => {
    clients.delete(ws);
    broadcast({ t: "leave", id: c.id }, ws);
  });
});

// refill presence budgets (max ~40 presence msgs/s per client)
setInterval(() => { for (const c of clients.values()) c.budget = Math.min(60, c.budget + 4); }, 100);

const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
function broadcast(m, except) {
  const s = JSON.stringify(m);
  for (const ws of clients.keys()) if (ws !== except && ws.readyState === 1) ws.send(s);
}

async function handle(ws, c, m) {
  switch (m.t) {
    case "hello": {
      const u = m.user || {};
      c.user = { id: c.id, name: String(u.name || "guest").slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(u.color) ? u.color : "#3fd8ff" };
      const users = [...clients.values()].filter((o) => o !== c && o.presence).map((o) => o.presence);
      send(ws, { t: "welcome", clientId: c.id, now: Date.now(), seq, users });
      break;
    }
    case "ping": send(ws, { t: "pong", ct: m.ct, st: Date.now() }); break;
    case "load": {
      const ids = (Array.isArray(m.ids) ? m.ids : []).slice(0, 256).filter((x) => x === null || typeof x === "string");
      const t0 = performance.now();
      const overlaysBefore = [flushing, pending].filter(Boolean);
      const rows = await loadChildren(pool, ids);
      const nodes = overlay(rows, ids, [...overlaysBefore, flushing, pending].filter(Boolean));
      stats.loads++; stats.loadMs = performance.now() - t0;
      for (let i = 0; i < nodes.length || i === 0; i += PAGE) {
        const last = i + PAGE >= nodes.length;
        send(ws, { t: "nodes", parents: ids, nodes: nodes.slice(i, i + PAGE), done: last });
      }
      break;
    }
    case "path": {
      if (typeof m.id !== "string") return;
      const rows = await loadPath(pool, m.id);
      send(ws, { t: "nodes", parents: [], nodes: overlay(rows, [], [flushing, pending].filter(Boolean)), done: true });
      break;
    }
    case "deepest": send(ws, { t: "deepest", id: await deepest(pool) }); break;
    case "op": {
      const v = validateOp(m.op);
      if (!v.ok) { send(ws, { t: "reject", cid: m.cid, reason: v.reason }); return; }
      const op = v.op;
      const s = ++seq;
      const by = c.id;
      queue(op, s, by);
      broadcast({ t: "op", op, seq: s, by }, ws);
      send(ws, { t: "ack", cid: m.cid, seq: s });
      stats.ops++;
      break;
    }
    case "presence": {
      if (c.budget <= 0 || !c.user) return;
      c.budget--;
      const p = m.p || {};
      c.presence = {
        id: c.id, name: c.user.name, color: c.user.color,
        cur: Array.isArray(p.cur) ? p.cur.slice(0, 10).filter((e) => Array.isArray(e) && typeof e[0] === "string" && Number.isFinite(e[1]) && Number.isFinite(e[2])) : null,
        view: p.view && typeof p.view.anchor === "string" ? { anchor: p.view.anchor, cx: +p.view.cx || 0, cy: +p.view.cy || 0, z: +p.view.z || 1, cr: +p.view.cr || 0 } : null,
        sel: typeof p.sel === "string" ? p.sel : null,
        depth: Number.isFinite(p.depth) ? p.depth : 0,
      };
      broadcast({ t: "presence", p: c.presence }, ws);
      break;
    }
  }
}

function queue(op, s, by) {
  const b = pending;
  if (op.kind === "create") {
    b.deletes.delete(op.node.id);
    b.creates.set(op.node.id, { ...op.node, v: s, by });
  } else if (op.kind === "patch") {
    const cr = b.creates.get(op.id);
    if (cr) Object.assign(cr, op.set, { v: s, by });
    else {
      const p = b.patches.get(op.id);
      if (p) { Object.assign(p.set, op.set); p.v = s; p.by = by; }
      else b.patches.set(op.id, { id: op.id, set: { ...op.set }, v: s, by });
    }
  } else if (op.kind === "delete") {
    b.creates.delete(op.id);
    b.patches.delete(op.id);
    b.deletes.set(op.id, { id: op.id });
  }
  b.log.push({ seq: s, node_id: op.kind === "create" ? op.node.id : op.id, kind: op.kind, body: op, by });
}

function overlay(rows, parentIds, batches) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parents = new Set(parentIds);
  for (const b of batches) {
    for (const [id, n] of b.creates) if (parents.has(n.parent) || byId.has(id)) byId.set(id, { ...(byId.get(id) || { nchild: 0 }), ...n });
    for (const [id, p] of b.patches) {
      const r = byId.get(id);
      if (r && (r.v || 0) <= p.v) { Object.assign(r, p.set); r.v = p.v; }
    }
    for (const id of b.deletes.keys()) byId.delete(id);
  }
  return [...byId.values()];
}

async function flushLoop() {
  if (flushing) return;
  const b = pending;
  if (!b.creates.size && !b.patches.size && !b.deletes.size && !b.log.length) return;
  pending = newBatch();
  flushing = b;
  const t0 = performance.now();
  try {
    await flush(pool, { creates: [...b.creates.values()], patches: [...b.patches.values()], deletes: [...b.deletes.values()], log: b.log });
    stats.flushes++;
    stats.flushMs = performance.now() - t0;
    stats.maxBatch = Math.max(stats.maxBatch, b.log.length);
  } catch (e) {
    stats.errors++;
    console.error("flush failed:", e.message);
  } finally {
    flushing = null;
  }
}
setInterval(flushLoop, FLUSH_MS);

server.listen(PORT, () => console.log(`nested-engine lab on http://localhost:${PORT}  (seq ${seq})`));

async function shutdown() {
  await flushLoop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
