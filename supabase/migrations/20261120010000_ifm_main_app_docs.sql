-- Infinite Frames main app on Supabase: the document store it used on claude.ai.
--
-- The main app (app/index.html, the claude.ai artifact) keeps its data as documents in
-- collections: frames, boundaries, items, messages, votes, events, places, pcomments and
-- meta. web/src/claude-shim.js gives it the same calls on top of this one table, so the app
-- runs unchanged on Vercel. New objects only, all prefixed `ifm_`; existing tables are untouched.

create table if not exists public.ifm_docs (
  coll        text not null check (coll in ('frames','boundaries','items','messages','votes','events','places','pcomments','meta')),
  id          text not null check (char_length(id) between 1 and 200),
  data        jsonb not null check (octet_length(data::text) <= 300000),
  at          bigint,                                    -- copy of data.at, for ordering
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (coll, id)
);
create index if not exists ifm_docs_coll_at on public.ifm_docs (coll, at);
alter table public.ifm_docs replica identity full;

-- people who may run admin actions (reset, edit anything); add the founder's user id here
create table if not exists public.ifm_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.ifm_admins enable row level security;
drop policy if exists ifm_admins_self on public.ifm_admins;
create policy ifm_admins_self on public.ifm_admins for select using (user_id = auth.uid());

create or replace function public.ifm_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ifm_admins where user_id = auth.uid());
$$;

alter table public.ifm_docs enable row level security;

-- everyone can look at the artwork
drop policy if exists ifm_docs_read on public.ifm_docs;
create policy ifm_docs_read on public.ifm_docs for select using (true);

-- signed-in people (Google, or a guest session) add documents as themselves.
-- The reset marker (meta) is admin-only.
drop policy if exists ifm_docs_insert on public.ifm_docs;
create policy ifm_docs_insert on public.ifm_docs for insert to authenticated
  with check (owner = auth.uid() and (coll <> 'meta' or public.ifm_is_admin()));

-- people change their own documents; anyone signed in can open or close a frame
-- (as in the claude.ai app; who may do this is still an open decision); admins can change anything
drop policy if exists ifm_docs_update on public.ifm_docs;
create policy ifm_docs_update on public.ifm_docs for update to authenticated
  using ((owner = auth.uid() and coll <> 'meta') or coll = 'frames' or public.ifm_is_admin())
  with check ((coll <> 'meta' or public.ifm_is_admin()));

-- deleting frames or the reset marker is admin-only; people may delete their own other documents
drop policy if exists ifm_docs_delete on public.ifm_docs;
create policy ifm_docs_delete on public.ifm_docs for delete to authenticated
  using (public.ifm_is_admin() or (owner = auth.uid() and coll not in ('frames','meta')));

-- merge fields into a document (the app's update()), under the same rules
create or replace function public.ifm_merge(p_coll text, p_id text, p_patch jsonb) returns void
language sql security invoker set search_path = public as $$
  update public.ifm_docs
     set data = data || p_patch,
         at = coalesce((data || p_patch)->>'at', null)::bigint,
         updated_at = now()
   where coll = p_coll and id = p_id;
$$;
grant execute on function public.ifm_merge(text, text, jsonb) to authenticated;

grant select on public.ifm_docs to anon, authenticated;
grant insert, update, delete on public.ifm_docs to authenticated;

-- live updates
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ifm_docs') then
    alter publication supabase_realtime add table public.ifm_docs;
  end if;
end $$;

-- uploaded images: public to read, each person uploads into their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ifm-assets', 'ifm-assets', true, 15728640, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;
drop policy if exists "ifm assets read" on storage.objects;
create policy "ifm assets read" on storage.objects for select using (bucket_id = 'ifm-assets');
drop policy if exists "ifm assets upload" on storage.objects;
create policy "ifm assets upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ifm-assets' and (storage.foldername(name))[1] = auth.uid()::text);
