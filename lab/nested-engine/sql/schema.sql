-- Infinite Frames nested-engine lab schema.
-- Plain Postgres 15+; written to run unchanged on Supabase (see the RLS section
-- at the bottom). Uses its own if_lab_* tables, separate from production
-- if_shared_* artwork and the guest sandbox.
--
-- Design:
--  * One row per shape. Each row stores ONLY its transform relative to its
--    parent (x, y, s, r) plus its own shape in local units. There are no global
--    coordinates, so nesting depth is unlimited and moving a region moves its
--    entire subtree with a single-row update.
--  * Children are fetched by parent (index on parent, ord). A client loads only
--    the regions it is looking at, a page at a time.
--  * v = server sequence number of the last change, used for per-field
--    last-writer-wins and to reject stale snapshots on the client.
--  * if_lab_ops is an append-only log of every (coalesced) change: history,
--    undo, replay, and audit come from here.

create table if not exists if_lab_nodes (
  id         text primary key check (id ~ '^[a-z0-9]{4,24}$'),
  parent     text references if_lab_nodes(id) on delete cascade,
  depth      int not null check (depth >= 0 and depth <= 4096),
  ord        double precision not null default 0,
  x          double precision not null default 0,
  y          double precision not null default 0,
  s          double precision not null default 1 check (s > 0),
  r          double precision not null default 0,
  pts        real[] not null check (cardinality(pts) between 6 and 40000),
  rings      int[],
  smooth     boolean not null default false,
  rule       text not null default 'nonzero' check (rule in ('nonzero', 'evenodd')),
  fill       text not null default '#888' check (length(fill) <= 48),
  anim       jsonb,
  clip       boolean not null default true,
  tag        text check (length(tag) <= 32),
  nchild     int not null default 0,
  v          bigint not null default 0,
  by         text,
  updated_at timestamptz not null default now(),
  check ((parent is null) = (depth = 0))
);

create index if not exists if_lab_nodes_parent_ord on if_lab_nodes (parent, ord);
create index if not exists if_lab_nodes_depth on if_lab_nodes (depth desc);

create table if not exists if_lab_ops (
  seq     bigint primary key,
  node_id text not null,
  kind    text not null check (kind in ('create', 'patch', 'delete')),
  body    jsonb,
  by      text,
  at      timestamptz not null default now()
);

-- Keep parent.nchild correct so clients know which regions have children to
-- fetch without counting them.
create or replace function if_lab_nchild() returns trigger language plpgsql as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.parent is not null then
    if tg_op = 'INSERT' or new.parent is distinct from old.parent then
      update if_lab_nodes set nchild = nchild + 1 where id = new.parent;
    end if;
  end if;
  if tg_op in ('DELETE', 'UPDATE') and old.parent is not null then
    if tg_op = 'DELETE' or new.parent is distinct from old.parent then
      update if_lab_nodes set nchild = greatest(0, nchild - 1) where id = old.parent;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists if_lab_nodes_nchild on if_lab_nodes;
create trigger if_lab_nodes_nchild after insert or delete or update of parent on if_lab_nodes
  for each row execute function if_lab_nchild();

-- Ancestors of a node, root first (used for deep links / "follow user").
create or replace function if_lab_path(target text) returns setof if_lab_nodes
language sql stable as $$
  with recursive up as (
    select n.*, 0 as hop from if_lab_nodes n where n.id = target
    union all
    select p.*, up.hop + 1 from if_lab_nodes p join up on p.id = up.parent
  )
  select id, parent, depth, ord, x, y, s, r, pts, rings, smooth, rule, fill, anim, clip, tag, nchild, v, by, updated_at
  from up order by hop desc;
$$;

-- ---------------------------------------------------------------------------
-- Supabase only (skip on plain Postgres): Row Level Security.
-- Reads are public; writes require a signed-in user and go through a
-- security-definer RPC that validates and batches ops, never raw table access.
--
-- alter table if_lab_nodes enable row level security;
-- alter table if_lab_ops   enable row level security;
-- create policy if_lab_read on if_lab_nodes for select to anon, authenticated using (true);
-- revoke insert, update, delete on if_lab_nodes from anon, authenticated;
-- revoke all on if_lab_ops from anon, authenticated;
-- (then: create function if_lab_apply_ops(ops jsonb) ... security definer,
--  granted to authenticated only; mirrors server/db.mjs flush())
