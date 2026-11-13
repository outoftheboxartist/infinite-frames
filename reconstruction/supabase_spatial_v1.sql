-- Infinite Frames Spatial Engine v1 (additive, isolated schema).
-- DOES NOT modify if3d_objects, if3d_messages, or existing artwork.
-- Published geometry is immutable, versioned in private Supabase Storage.
-- No anonymous insert/update/delete is enabled; publishing API is a later milestone.

create table if not exists public.if_spatial_regions (
    id text primary key,
    world_id text not null default 'root',
    frame_n integer not null check (frame_n >= 1),
    parent_id text null references public.if_spatial_regions(id) on delete restrict,
    name text not null default 'Untitled curve',
    author_id uuid null,
    author_display text null,
    color text null,
    tags text[] not null default '{}',
    xmin double precision not null,
    ymin double precision not null,
    xmax double precision not null,
    ymax double precision not null,
    bbox box generated always as (box(point(xmin,ymin),point(xmax,ymax))) stored,
    geometry_key text not null,
    geometry_version integer not null default 1 check (geometry_version >= 1),
    published boolean not null default true,
    created_at timestamptz not null default now(),
    check (xmin <= xmax and ymin <= ymax),
    check (length(id) between 1 and 160),
    check (length(world_id) between 1 and 80),
    check (length(name) <= 160),
    check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);
create index if not exists if_spatial_regions_viewport_idx
    on public.if_spatial_regions using gist (bbox);
create index if not exists if_spatial_regions_world_frame_idx
    on public.if_spatial_regions (world_id, frame_n);
create index if not exists if_spatial_regions_name_prefix_idx
    on public.if_spatial_regions (lower(name) text_pattern_ops);
create index if not exists if_spatial_regions_parent_idx
    on public.if_spatial_regions (parent_id);
create index if not exists if_spatial_regions_color_idx
    on public.if_spatial_regions (color);
create index if not exists if_spatial_regions_tags_idx
    on public.if_spatial_regions using gin (tags);

create table if not exists public.if_spatial_geometry_manifest (
    geometry_key text not null,
    version integer not null check (version >= 1),
    region_id text not null references public.if_spatial_regions(id) on delete restrict,
    storage_path text not null,
    media_type text not null default 'image/svg+xml',
    sha256_hex text null,
    byte_count bigint not null check (byte_count >= 0),
    path_count integer null check (path_count >= 0),
    created_at timestamptz not null default now(),
    primary key (geometry_key, version),
    unique (storage_path),
    check (length(geometry_key) between 1 and 240),
    check (length(storage_path) between 1 and 900),
    check (sha256_hex is null or sha256_hex ~ '^[a-fA-F0-9]{64}$')
);

alter table public.if_spatial_regions enable row level security;
alter table public.if_spatial_geometry_manifest enable row level security;

-- Browse only published metadata. Geometry files are PRIVATE until authenticated retrieval.
drop policy if exists "if_spatial_published_regions_read" on public.if_spatial_regions;
create policy "if_spatial_published_regions_read" on public.if_spatial_regions
    for select to anon, authenticated using (published = true);

drop policy if exists "if_spatial_published_manifests_read" on public.if_spatial_geometry_manifest;
create policy "if_spatial_published_manifests_read" on public.if_spatial_geometry_manifest
    for select to anon, authenticated
    using (exists (select 1 from public.if_spatial_regions r
                   where r.id = region_id and r.published = true));

-- No insert/update/delete RLS policies. A verified server-side publisher will be added later.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('if-spatial-geometry','if-spatial-geometry',false,4194304,array['image/svg+xml','application/json'])
on conflict (id) do nothing;

-- Spatial search function uses GiST bbox overlap and obeys caller RLS.
create or replace function public.if_spatial_viewport(
    p_world text, p_frame integer,
    p_xmin double precision, p_ymin double precision,
    p_xmax double precision, p_ymax double precision,
    p_limit integer default 200
) returns setof public.if_spatial_regions
language sql stable security invoker set search_path=public
as $$
  select r.* from public.if_spatial_regions r
  where r.world_id = p_world and r.frame_n = p_frame and r.published
    and r.bbox && box(point(p_xmin,p_ymin),point(p_xmax,p_ymax))
  order by (r.xmax-r.xmin)*(r.ymax-r.ymin) asc, r.id
  limit least(greatest(p_limit,1),500);
$$;

create or replace function public.if_spatial_find(
    p_world text, p_query text, p_limit integer default 30
) returns setof public.if_spatial_regions
language sql stable security invoker set search_path=public
as $$
  select r.* from public.if_spatial_regions r
  where r.world_id=p_world and r.published and
    (lower(r.name) like lower(trim(p_query)) || '%' or
     lower(coalesce(r.author_display,'')) like lower(trim(p_query)) || '%' or
     lower(coalesce(r.color,'')) like lower(trim(p_query)) || '%')
  order by r.name, r.id
  limit least(greatest(p_limit,1),80);
$$;
