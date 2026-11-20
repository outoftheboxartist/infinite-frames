-- Infinite Frames web app: core tables.
-- STATUS: written for review, NOT applied. Apply only with the founder's approval.
-- Target: Supabase project xqfevafhjbdulhcqcmao. All tables are new and prefixed `ifw_`;
-- existing tables (if_shared_*, if_guest_test_worlds) are not touched.
--
-- Model, in plain words:
--   profiles       one per signed-in person (from Google: name and photo), plus chosen colour
--   frames         the authored animation: frame 1, 2, 3... (open or published)
--   regions        closed curves: where things live. Nested by parent_id. Shared by all frames.
--   contributions  everything people add: strokes, traced art, text, screenshots, comments
--   credits        who did what on a contribution: creator, submitter, rights holder...
--                  (a screenshot can credit the person who found it AND the original artist)
--   events         append-only history: published, corrected, credit changed, frame opened...
-- Published things are never edited in place: corrections are new rows and events.

create extension if not exists pgcrypto;

-- ---------- people ----------
create table if not exists public.ifw_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default 'Someone' check (char_length(name) between 1 and 60),
  avatar_url  text,
  color       text not null default '#f2efe6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  links       jsonb not null default '[]'::jsonb,       -- optional social links
  created_at  timestamptz not null default now()
);

-- make a profile from the Google account the first time someone signs in
create or replace function public.ifw_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ifw_profiles (id, name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Someone'), 60),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ifw_on_auth_user_created on auth.users;
create trigger ifw_on_auth_user_created after insert on auth.users
  for each row execute function public.ifw_handle_new_user();

-- ---------- time ----------
create table if not exists public.ifw_frames (
  n           integer primary key check (n >= 1),
  status      text not null default 'open' check (status in ('open', 'published')),
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   uuid references public.ifw_profiles (id)
);
insert into public.ifw_frames (n, status) values (1, 'open') on conflict do nothing;

-- ---------- space ----------
-- node: where in the nested canvas tree this lives ('root', 'root/3,4', ...), matching the engine
create table if not exists public.ifw_regions (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.ifw_regions (id),
  node        text not null default 'root' check (node ~ '^root(/[0-7],[0-7])*$'),
  path_d      text not null check (char_length(path_d) <= 200000),   -- closed SVG path, node coordinates
  name        text not null default 'Window',
  color       text not null default '#f2efe6',
  founder_id  uuid not null references public.ifw_profiles (id),
  frame_n     integer not null references public.ifw_frames (n),
  created_at  timestamptz not null default now()
);
create index if not exists ifw_regions_node on public.ifw_regions (node);

-- ---------- what people add ----------
create table if not exists public.ifw_contributions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('stroke', 'shape', 'traced', 'image', 'text', 'screenshot', 'comment', 'idea', 'connection')),
  node        text not null default 'root' check (node ~ '^root(/[0-7],[0-7])*$'),
  region_id   uuid references public.ifw_regions (id),
  frame_n     integer not null references public.ifw_frames (n),
  author_id   uuid not null references public.ifw_profiles (id),  -- who added it to IF
  data        jsonb not null,           -- geometry or content, e.g. {"p":[x,y,...],"w":4,"c":"#e3262d"}
  asset_path  text,                     -- Supabase Storage path for images and screenshots
  rights      text not null default 'own' check (rights in ('own', 'permitted', 'unknown')),
  status      text not null default 'published' check (status in ('published', 'hidden', 'superseded')),
  supersedes  uuid references public.ifw_contributions (id),
  created_at  timestamptz not null default now(),
  check (octet_length(data::text) <= 500000)
);
create index if not exists ifw_contrib_node on public.ifw_contributions (node, frame_n);

-- credits are separate from the author: a screenshot has a submitter and an original artist
create table if not exists public.ifw_credits (
  id               uuid primary key default gen_random_uuid(),
  contribution_id  uuid not null references public.ifw_contributions (id) on delete cascade,
  role             text not null check (role in ('creator', 'submitter', 'source_identifier', 'rights_holder', 'collaborator')),
  profile_id       uuid references public.ifw_profiles (id),   -- when the person is on IF
  display_name     text,                                       -- when they are not (e.g. the original artist)
  link             text,                                       -- their post or social link, optional
  verified         boolean not null default false,             -- an AI suggestion is never verified
  added_by         uuid not null references public.ifw_profiles (id),
  created_at       timestamptz not null default now(),
  check (profile_id is not null or display_name is not null)
);

-- ---------- history (append-only) ----------
create table if not exists public.ifw_events (
  id          bigint generated always as identity primary key,
  type        text not null,   -- 'published', 'credit_added', 'frame_opened', 'hidden', ...
  actor_id    uuid references public.ifw_profiles (id),
  subject_id  uuid,
  frame_n     integer,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- access rules ----------
alter table public.ifw_profiles      enable row level security;
alter table public.ifw_frames        enable row level security;
alter table public.ifw_regions       enable row level security;
alter table public.ifw_contributions enable row level security;
alter table public.ifw_credits       enable row level security;
alter table public.ifw_events        enable row level security;

-- everyone (signed in or not) can look at the artwork and who made it
create policy ifw_read_profiles on public.ifw_profiles for select using (true);
create policy ifw_read_frames   on public.ifw_frames   for select using (true);
create policy ifw_read_regions  on public.ifw_regions  for select using (true);
create policy ifw_read_contrib  on public.ifw_contributions for select using (status <> 'hidden');
create policy ifw_read_credits  on public.ifw_credits  for select using (true);
create policy ifw_read_events   on public.ifw_events   for select using (true);

-- people edit only their own profile
create policy ifw_update_own_profile on public.ifw_profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- signed-in people add things as themselves, only into an open frame
create policy ifw_insert_region on public.ifw_regions for insert to authenticated
  with check (founder_id = auth.uid() and exists (select 1 from public.ifw_frames f where f.n = frame_n and f.status = 'open'));
create policy ifw_insert_contrib on public.ifw_contributions for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.ifw_frames f where f.n = frame_n and f.status = 'open'));
create policy ifw_insert_credit on public.ifw_credits for insert to authenticated
  with check (added_by = auth.uid());
create policy ifw_insert_event on public.ifw_events for insert to authenticated
  with check (actor_id = auth.uid());

-- no update or delete policies on regions, contributions, credits or events:
-- published work is locked. Corrections are new rows (supersedes) plus an event.
-- Opening and closing frames is left to an admin-only function, to be decided (DECISIONS.md, open 2).

-- live updates for finished work
alter publication supabase_realtime add table public.ifw_contributions, public.ifw_regions;
