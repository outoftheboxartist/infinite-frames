-- Infinite Frames shared spatial paging/LOD.
-- Additive: no changes to existing artwork or auth identities.
CREATE INDEX IF NOT EXISTS if_shared_nodes_latest
 ON public.if_shared_nodes(world_id,published_at DESC,id DESC) WHERE published=true;
CREATE OR REPLACE FUNCTION public.if_shared_viewport_page(
 p_world text,p_frames integer[],p_min_x double precision,p_min_y double precision,
 p_max_x double precision,p_max_y double precision,p_min_extent double precision DEFAULT 0,
 p_offset integer DEFAULT 0,p_limit integer DEFAULT 260
) RETURNS SETOF public.if_shared_nodes
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public
AS $$
 SELECT n.* FROM public.if_shared_nodes n
 WHERE n.world_id=p_world AND n.frame_n=ANY(p_frames) AND n.published
   AND n.bounds && box(point(p_min_x,p_min_y),point(p_max_x,p_max_y))
   AND GREATEST(n.max_x-n.min_x,n.max_y-n.min_y) >= GREATEST(p_min_extent,0)
 ORDER BY (n.max_x-n.min_x)*(n.max_y-n.min_y) DESC,n.id ASC
 LIMIT LEAST(GREATEST(p_limit,1),600)
 OFFSET LEAST(GREATEST(p_offset,0),100000);
$$;
REVOKE ALL ON FUNCTION public.if_shared_viewport_page(text,integer[],double precision,double precision,double precision,double precision,double precision,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.if_shared_viewport_page(text,integer[],double precision,double precision,double precision,double precision,double precision,integer,integer) TO anon,authenticated;
