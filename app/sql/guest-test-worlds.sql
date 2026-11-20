-- Applied to Supabase project xqfevafhjbdulhcqcmao on 2026-11-14.
-- Passwordless test data ONLY. Production if_shared_* tables and policies unchanged.
-- World id must be a random 128-bit hexadecimal capability: if-test-<32 chars>.
-- Anyone possessing a world id/link can collaborate on and reset that TEST world.
-- Each row is max 3 MB. Data contains test artwork, not private credentials.
create table if not exists public.if_guest_test_worlds (
  id text primary key check (id ~ '^if-test-[0-9a-f]{32}$'),
  doc jsonb not null default '{"frames":[{"n":1,"status":"open"}],"boundaries":[],"items":[],"messages":[],"votes":[],"events":[]}'::jsonb,
  revision bigint not null default 1 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint if_guest_doc_object check (jsonb_typeof(doc)='object'),
  constraint if_guest_doc_size check (octet_length(doc::text) <= 3000000),
  constraint if_guest_doc_has_frames check (jsonb_typeof(doc->'frames')='array'),
  constraint if_guest_doc_has_art check (jsonb_typeof(doc->'boundaries')='array' and jsonb_typeof(doc->'items')='array')
);
alter table public.if_guest_test_worlds enable row level security;
revoke all on public.if_guest_test_worlds from public, anon, authenticated;
grant select,insert,update on public.if_guest_test_worlds to anon,authenticated;
create policy "if_guest_test_read_world" on public.if_guest_test_worlds
  for select to anon,authenticated
  using (id=(nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-if-guest-world'));
create policy "if_guest_test_insert_world" on public.if_guest_test_worlds
  for insert to anon,authenticated
  with check (id=(nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-if-guest-world'));
create policy "if_guest_test_update_world" on public.if_guest_test_worlds
  for update to anon,authenticated
  using (id=(nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-if-guest-world'))
  with check (id=(nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-if-guest-world'));
-- No DELETE permission/policy is granted. Reset overwrites the specified test row
-- with an empty document, preserving the production tables untouched.
-- Eventual cleanup of abandoned test world rows should be performed by the owner
-- through a separately reviewed maintenance command.
