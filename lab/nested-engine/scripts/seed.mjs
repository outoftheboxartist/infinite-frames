// Fill if_lab_nodes with the deterministic dummy world (~100k shapes, 45 levels).
// Usage: npm run seed            (wipes existing lab nodes first)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makePool, initSchema } from "../server/db.mjs";
import { rootNode, genChildren, makeCtx } from "../public/src/seedgen.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVG = path.join(HERE, "..", "..", "..", "yin-yang-svg");
const ctx = makeCtx([1, 2, 3, 4, 5].map((i) => {
  try { return fs.readFileSync(path.join(SVG, `frame-${i}.svg`), "utf8"); } catch { return null; }
}));

const pool = makePool();
await initSchema(pool);
const t0 = performance.now();
const client = await pool.connect();
await client.query("begin");
await client.query("truncate if_lab_nodes, if_lab_ops");
// bulk load: skip the per-row nchild trigger (the generator already knows nchild)
await client.query("alter table if_lab_nodes disable trigger if_lab_nodes_nchild");

const BATCH = 2500;
let buf = [], total = 0, maxDepth = 0;
async function write() {
  if (!buf.length) return;
  await client.query(
    `insert into if_lab_nodes (id, parent, depth, ord, x, y, s, r, pts, rings, smooth, rule, fill, anim, clip, tag, nchild, v, by)
     select * from jsonb_to_recordset($1::jsonb) as u(id text, parent text, depth int, ord float8, x float8, y float8, s float8, r float8,
       pts real[], rings int[], smooth bool, rule text, fill text, anim jsonb, clip bool, tag text, nchild int, v bigint, by text)`,
    [JSON.stringify(buf)]
  );
  total += buf.length;
  buf = [];
}

// breadth-first so every parent row exists before its children
let level = [rootNode()];
while (level.length) {
  const next = [];
  for (const n of level) {
    buf.push(n);
    maxDepth = Math.max(maxDepth, n.depth);
    if (buf.length >= BATCH) await write();
    if (n.nchild) for (const c of genChildren(n, ctx)) next.push(c);
  }
  level = next;
}
await write();
await client.query("alter table if_lab_nodes enable trigger if_lab_nodes_nchild");
await client.query("commit");
await client.query("analyze if_lab_nodes");
client.release();
console.log(`seeded ${total} nodes, max depth ${maxDepth}, in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
await pool.end();
