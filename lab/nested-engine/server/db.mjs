// Postgres access for the lab server. Every write path is a batched,
// set-based statement (jsonb_to_recordset), so one flush of hundreds of
// coalesced edits is a handful of round trips, not hundreds.

import pg from "pg";
import fs from "node:fs";

export const COLS = "id, parent, depth, ord, x, y, s, r, pts, rings, smooth, rule, fill, anim, clip, tag, nchild, v, by";

export function makePool() {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/nested_lab",
    max: 8,
  });
}

export async function initSchema(pool) {
  const sql = fs.readFileSync(new URL("../sql/schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

const num = (v) => (v == null ? v : Number(v));
export function rowToNode(r) {
  return {
    id: r.id, parent: r.parent, depth: r.depth, ord: r.ord,
    x: r.x, y: r.y, s: r.s, r: r.r, pts: r.pts, rings: r.rings,
    smooth: r.smooth, rule: r.rule, fill: r.fill, anim: r.anim, clip: r.clip,
    tag: r.tag, nchild: r.nchild, v: num(r.v), by: r.by,
  };
}

export async function loadChildren(pool, ids) {
  const real = ids.filter((id) => id !== null);
  const out = [];
  if (real.length) {
    const { rows } = await pool.query(`select ${COLS} from if_lab_nodes where parent = any($1) order by parent, ord`, [real]);
    for (const r of rows) out.push(rowToNode(r));
  }
  if (ids.includes(null)) {
    const { rows } = await pool.query(`select ${COLS} from if_lab_nodes where parent is null`);
    for (const r of rows) out.push(rowToNode(r));
  }
  return out;
}

export async function loadPath(pool, id) {
  const { rows } = await pool.query(`select ${COLS} from if_lab_path($1)`, [id]);
  return rows.map(rowToNode);
}

export async function deepest(pool) {
  const { rows } = await pool.query("select id from if_lab_nodes order by depth desc, id limit 1");
  return rows[0] ? rows[0].id : null;
}

export async function maxSeq(pool) {
  const { rows } = await pool.query("select greatest((select coalesce(max(v), 0) from if_lab_nodes), (select coalesce(max(seq), 0) from if_lab_ops)) as m");
  return Number(rows[0].m);
}

// batch = { creates: [node], patches: [{id, set, v, by}], deletes: [{id}], log: [{seq, node_id, kind, body, by}] }
export async function flush(pool, batch) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (batch.creates.length) {
      // parents first; skip creates whose parent no longer exists
      const byDepth = new Map();
      for (const n of batch.creates) {
        if (!byDepth.has(n.depth)) byDepth.set(n.depth, []);
        byDepth.get(n.depth).push(n);
      }
      for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
        await client.query(
          `insert into if_lab_nodes (id, parent, depth, ord, x, y, s, r, pts, rings, smooth, rule, fill, anim, clip, tag, v, by, updated_at)
           select u.id, u.parent, u.depth, u.ord, u.x, u.y, u.s, u.r, u.pts, u.rings, u.smooth, u.rule, u.fill, u.anim, u.clip, u.tag, u.v, u.by, now()
           from jsonb_to_recordset($1::jsonb) as u(id text, parent text, depth int, ord float8, x float8, y float8, s float8, r float8,
                pts real[], rings int[], smooth bool, rule text, fill text, anim jsonb, clip bool, tag text, v bigint, by text)
           where exists (select 1 from if_lab_nodes p where p.id = u.parent)
           on conflict (id) do update set ord = excluded.ord, x = excluded.x, y = excluded.y, s = excluded.s, r = excluded.r,
             pts = excluded.pts, rings = excluded.rings, smooth = excluded.smooth, rule = excluded.rule, fill = excluded.fill,
             anim = excluded.anim, clip = excluded.clip, tag = excluded.tag, v = excluded.v, by = excluded.by, updated_at = now()`,
          [JSON.stringify(byDepth.get(d))]
        );
      }
    }
    if (batch.patches.length) {
      const rows = batch.patches.map((p) => ({
        id: p.id, v: p.v, by: p.by, ...p.set,
        anim_set: "anim" in p.set, rings_set: "rings" in p.set, tag_set: "tag" in p.set,
      }));
      await client.query(
        `update if_lab_nodes n set
           x = coalesce(u.x, n.x), y = coalesce(u.y, n.y), s = coalesce(u.s, n.s), r = coalesce(u.r, n.r),
           ord = coalesce(u.ord, n.ord), pts = coalesce(u.pts, n.pts), smooth = coalesce(u.smooth, n.smooth),
           rule = coalesce(u.rule, n.rule), fill = coalesce(u.fill, n.fill), clip = coalesce(u.clip, n.clip),
           anim = case when u.anim_set then u.anim else n.anim end,
           rings = case when u.rings_set then u.rings else n.rings end,
           tag = case when u.tag_set then u.tag else n.tag end,
           v = greatest(n.v, u.v), by = u.by, updated_at = now()
         from jsonb_to_recordset($1::jsonb) as u(id text, x float8, y float8, s float8, r float8, ord float8, pts real[], smooth bool,
              rule text, fill text, clip bool, anim jsonb, rings int[], tag text, v bigint, by text,
              anim_set bool, rings_set bool, tag_set bool)
         where n.id = u.id`,
        [JSON.stringify(rows)]
      );
    }
    if (batch.deletes.length) {
      await client.query("delete from if_lab_nodes where id = any($1)", [batch.deletes.map((d) => d.id)]);
    }
    if (batch.log.length) {
      await client.query(
        `insert into if_lab_ops (seq, node_id, kind, body, by)
         select u.seq, u.node_id, u.kind, u.body, u.by from jsonb_to_recordset($1::jsonb) as u(seq bigint, node_id text, kind text, body jsonb, by text)
         on conflict (seq) do nothing`,
        [JSON.stringify(batch.log)]
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
