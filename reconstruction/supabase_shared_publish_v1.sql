-- Infinite Frames: additive shared publishing schema v1.
-- Preserve all existing if3d_* and if_spatial_* objects and local-only artwork.
CREATE TABLE IF NOT EXISTS public.if_shared_nodes (
  world_id text NOT NULL DEFAULT 'root' CHECK (world_id ~ '^[a-z0-9_-]{1,40}$'),
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('boundary','item')),
  frame_n integer NOT NULL CHECK (frame_n BETWEEN 1 AND 1000000),
  parent_id text NULL CHECK (parent_id IS NULL OR length(parent_id) <= 160),
  name text NOT NULL DEFAULT 'Untitled curve' CHECK (length(name) <= 160),
  color text NULL CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  author_id uuid NOT NULL DEFAULT auth.uid(),
  author_display text NOT NULL DEFAULT 'Contributor' CHECK (length(author_display) <= 64),
  min_x double precision NOT NULL CHECK (min_x BETWEEN -1e12 AND 1e12),
  min_y double precision NOT NULL CHECK (min_y BETWEEN -1e12 AND 1e12),
  max_x double precision NOT NULL CHECK (max_x BETWEEN -1e12 AND 1e12),
  max_y double precision NOT NULL CHECK (max_y BETWEEN -1e12 AND 1e12),
  bounds box GENERATED ALWAYS AS (box(point(min_x,min_y),point(max_x,max_y))) STORED,
  bundle_path text NOT NULL CHECK (length(bundle_path) <= 300),
  bundle_index integer NOT NULL CHECK (bundle_index BETWEEN 0 AND 2000),
  published boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(world_id,id),
  CHECK(min_x <= max_x AND min_y <= max_y)
);
CREATE INDEX IF NOT EXISTS if_shared_nodes_spatial_gist ON public.if_shared_nodes USING gist (bounds);
CREATE INDEX IF NOT EXISTS if_shared_nodes_world_frame ON public.if_shared_nodes (world_id,frame_n,published);
CREATE INDEX IF NOT EXISTS if_shared_nodes_name_search ON public.if_shared_nodes (world_id,lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS if_shared_nodes_author_search ON public.if_shared_nodes (world_id,lower(author_display) text_pattern_ops);
CREATE INDEX IF NOT EXISTS if_shared_nodes_color_search ON public.if_shared_nodes (world_id,lower(color));
CREATE INDEX IF NOT EXISTS if_shared_nodes_parent ON public.if_shared_nodes (world_id,parent_id);
CREATE INDEX IF NOT EXISTS if_shared_nodes_bundle_path ON public.if_shared_nodes(bundle_path);
ALTER TABLE public.if_shared_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS if_shared_nodes_public_read ON public.if_shared_nodes;
CREATE POLICY if_shared_nodes_public_read ON public.if_shared_nodes
  FOR SELECT TO anon,authenticated USING (published);
DROP POLICY IF EXISTS if_shared_nodes_author_insert ON public.if_shared_nodes;
CREATE POLICY if_shared_nodes_author_insert ON public.if_shared_nodes
  FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL AND author_id=(SELECT auth.uid())
    AND published
    AND bundle_path LIKE (SELECT auth.uid())::text || '/%'
    AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='if-shared-bundles' AND o.name=bundle_path)
  );
REVOKE ALL ON public.if_shared_nodes FROM anon,authenticated;
GRANT SELECT ON public.if_shared_nodes TO anon,authenticated;
GRANT INSERT ON public.if_shared_nodes TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('if-shared-bundles','if-shared-bundles',false,52428800,ARRAY['application/json'])
ON CONFLICT(id) DO NOTHING;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('if-shared-originals','if-shared-originals',false,52428800,ARRAY['image/png','image/jpeg','image/webp','image/gif','application/octet-stream'])
ON CONFLICT(id) DO NOTHING;
-- Browser uploads restricted to authenticated user's own prefix, never overwrite.
DROP POLICY IF EXISTS if_shared_bundles_insert_own ON storage.objects;
CREATE POLICY if_shared_bundles_insert_own ON storage.objects
 FOR INSERT TO authenticated WITH CHECK (
 bucket_id='if-shared-bundles' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
 AND lower(storage.extension(name))='json');
DROP POLICY IF EXISTS if_shared_bundles_select_own_or_published ON storage.objects;
CREATE POLICY if_shared_bundles_select_own_or_published ON storage.objects
 FOR SELECT TO anon,authenticated USING (
 bucket_id='if-shared-bundles'
 AND (
   (SELECT auth.uid())::text=(storage.foldername(name))[1]
   OR EXISTS (SELECT 1 FROM public.if_shared_nodes n WHERE n.bundle_path=name AND n.published)
 ));
DROP POLICY IF EXISTS if_shared_originals_insert_own ON storage.objects;
CREATE POLICY if_shared_originals_insert_own ON storage.objects
 FOR INSERT TO authenticated WITH CHECK (
 bucket_id='if-shared-originals' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
DROP POLICY IF EXISTS if_shared_originals_select_own ON storage.objects;
CREATE POLICY if_shared_originals_select_own ON storage.objects
 FOR SELECT TO authenticated USING (
 bucket_id='if-shared-originals' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);

-- Minimal shared frame state: old frame history and local drafts remain intact.
CREATE TABLE IF NOT EXISTS public.if_shared_frames(
 world_id text NOT NULL DEFAULT 'root' CHECK(world_id ~ '^[a-z0-9_-]{1,40}$'),
 frame_n integer NOT NULL CHECK(frame_n BETWEEN 1 AND 1000000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','published')),
 created_by uuid NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,frame_n)
);
ALTER TABLE public.if_shared_frames ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS if_shared_frames_read ON public.if_shared_frames;
CREATE POLICY if_shared_frames_read ON public.if_shared_frames FOR SELECT TO anon,authenticated USING(true);
DROP POLICY IF EXISTS if_shared_frames_create ON public.if_shared_frames;
CREATE POLICY if_shared_frames_create ON public.if_shared_frames FOR INSERT TO authenticated
 WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND created_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS if_shared_frames_advance ON public.if_shared_frames;
CREATE POLICY if_shared_frames_advance ON public.if_shared_frames FOR UPDATE TO authenticated
 USING ((SELECT auth.uid()) IS NOT NULL) WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
REVOKE ALL ON public.if_shared_frames FROM anon,authenticated;
GRANT SELECT ON public.if_shared_frames TO anon,authenticated;
GRANT INSERT,UPDATE(status) ON public.if_shared_frames TO authenticated;

CREATE TABLE IF NOT EXISTS public.if_shared_messages(
 world_id text NOT NULL DEFAULT 'root' CHECK(world_id ~ '^[a-z0-9_-]{1,40}$'),
 id text NOT NULL CHECK(length(id) BETWEEN 1 AND 160),
 author_id uuid NOT NULL DEFAULT auth.uid(),
 author_display text NOT NULL CHECK(length(author_display) BETWEEN 1 AND 64),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
 frame_n integer NOT NULL DEFAULT 1 CHECK(frame_n BETWEEN 1 AND 1000000),
 location jsonb NULL CHECK(location IS NULL OR octet_length(location::text) <= 1024),
 idea boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,id)
);
CREATE INDEX IF NOT EXISTS if_shared_messages_recent ON public.if_shared_messages(world_id,created_at DESC);
ALTER TABLE public.if_shared_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS if_shared_messages_public_read ON public.if_shared_messages;
CREATE POLICY if_shared_messages_public_read ON public.if_shared_messages FOR SELECT TO anon,authenticated USING(true);
DROP POLICY IF EXISTS if_shared_messages_author_insert ON public.if_shared_messages;
CREATE POLICY if_shared_messages_author_insert ON public.if_shared_messages FOR INSERT TO authenticated
 WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND author_id=(SELECT auth.uid()));
REVOKE ALL ON public.if_shared_messages FROM anon,authenticated;
GRANT SELECT ON public.if_shared_messages TO anon,authenticated;
GRANT INSERT ON public.if_shared_messages TO authenticated;

CREATE TABLE IF NOT EXISTS public.if_shared_votes(
 world_id text NOT NULL DEFAULT 'root' CHECK(world_id ~ '^[a-z0-9_-]{1,40}$'),
 message_id text NOT NULL,
 voter_id uuid NOT NULL DEFAULT auth.uid(),
 kind text NOT NULL CHECK(kind IN('agree','disagree')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,message_id,voter_id),
 FOREIGN KEY (world_id,message_id) REFERENCES public.if_shared_messages(world_id,id)
);
ALTER TABLE public.if_shared_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS if_shared_votes_public_read ON public.if_shared_votes;
CREATE POLICY if_shared_votes_public_read ON public.if_shared_votes FOR SELECT TO anon,authenticated USING(true);
DROP POLICY IF EXISTS if_shared_votes_author_insert ON public.if_shared_votes;
CREATE POLICY if_shared_votes_author_insert ON public.if_shared_votes FOR INSERT TO authenticated
 WITH CHECK((SELECT auth.uid()) IS NOT NULL AND voter_id=(SELECT auth.uid()));
REVOKE ALL ON public.if_shared_votes FROM anon,authenticated;
GRANT SELECT ON public.if_shared_votes TO anon,authenticated;
GRANT INSERT ON public.if_shared_votes TO authenticated;

-- Indexed viewport RPC, security invoker obeys read RLS.
CREATE OR REPLACE FUNCTION public.if_shared_viewport(
 p_world text,p_frames integer[],p_min_x double precision,p_min_y double precision,
 p_max_x double precision,p_max_y double precision,p_limit integer DEFAULT 300
) RETURNS SETOF public.if_shared_nodes LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public
AS $$
 SELECT n.* FROM public.if_shared_nodes n
 WHERE n.world_id=p_world AND n.frame_n=ANY(p_frames) AND n.published
 AND n.bounds && box(point(p_min_x,p_min_y),point(p_max_x,p_max_y))
 ORDER BY (n.max_x-n.min_x)*(n.max_y-n.min_y) DESC,n.id
 LIMIT least(greatest(p_limit,1),600);
$$;
CREATE OR REPLACE FUNCTION public.if_shared_search(
 p_world text,p_query text,p_limit integer DEFAULT 40
) RETURNS SETOF public.if_shared_nodes LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public
AS $$
 SELECT n.* FROM public.if_shared_nodes n
 WHERE n.world_id=p_world AND n.published AND
 (lower(n.name) LIKE lower(trim(p_query))||'%' OR
  lower(n.author_display) LIKE lower(trim(p_query))||'%' OR
  lower(coalesce(n.color,'')) LIKE lower(trim(p_query))||'%')
 ORDER BY n.name,n.id LIMIT least(greatest(p_limit,1),100);
$$;
REVOKE ALL ON FUNCTION public.if_shared_viewport(text,integer[],double precision,double precision,double precision,double precision,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.if_shared_viewport(text,integer[],double precision,double precision,double precision,double precision,integer) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.if_shared_search(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.if_shared_search(text,text,integer) TO anon,authenticated;
-- Only actual published art metadata is available anonymously; no writes without a Supabase user.
