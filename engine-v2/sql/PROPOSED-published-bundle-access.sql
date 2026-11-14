-- PROPOSED ONLY: do NOT run automatically.
-- Source: inspected existing Infinite Frames Supabase Storage SELECT policy on 2026-11-14.
--
-- Existing expression appears to compare published node.bundle_path with node.name:
--   n.bundle_path = n.name
-- It should compare node.bundle_path against the CURRENT storage object path.
-- This draft restricts anonymous/public reads to bundles referenced by published nodes,
-- and allows authenticated authors to download their own bundles.
-- The private originals bucket has a separate policy and is not affected.
--
-- Before applying, review Supabase Storage operation names and test with two accounts.
-- Do not use a service_role key in any browser code.
begin;
drop policy if exists "if_shared_bundles_select_own_or_published" on storage.objects;
create policy "if_shared_bundles_select_own_or_published"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'if-shared-bundles'
  and storage.allow_any_operation(
    array['object.get_authenticated', 'object.get_authenticated_info']
  )
  and (
    (select auth.uid())::text = (storage.foldername(name))[1]
    or exists (
      select 1
      from public.if_shared_nodes as n
      where n.bundle_path = storage.objects.name
        and n.published = true
    )
  )
);
commit;
-- Verification: (a) published bundle can load anonymously;
-- (b) an unpublished bundle cannot load anonymously;
-- (c) an author can still load their own bundle;
-- (d) an unrelated user's private original image cannot be fetched;
-- (e) private bucket listing remains blocked.
