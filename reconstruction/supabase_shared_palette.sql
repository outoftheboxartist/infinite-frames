-- Search only selectable boundaries, not underlying artwork items.
CREATE OR REPLACE FUNCTION public.if_shared_search(
 p_world text,p_query text,p_limit integer DEFAULT 40
) RETURNS SETOF public.if_shared_nodes LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public
AS $$
 SELECT n.* FROM public.if_shared_nodes n
 WHERE n.world_id=p_world AND n.kind='boundary' AND n.published AND
 (lower(n.name) LIKE lower(trim(p_query))||'%' OR
  lower(n.author_display) LIKE lower(trim(p_query))||'%' OR
  lower(coalesce(n.color,'')) LIKE lower(trim(p_query))||'%')
 ORDER BY n.name,n.id LIMIT least(greatest(p_limit,1),100);
$$;
REVOKE ALL ON FUNCTION public.if_shared_search(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.if_shared_search(text,text,integer) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.if_shared_palette(
 p_world text,p_limit integer DEFAULT 80
) RETURNS TABLE(color text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public
AS $$
 SELECT DISTINCT lower(n.color) AS color
 FROM public.if_shared_nodes n
 WHERE n.world_id=p_world AND n.kind='boundary' AND n.published AND n.color IS NOT NULL
 ORDER BY color
 LIMIT least(greatest(p_limit,1),100);
$$;
REVOKE ALL ON FUNCTION public.if_shared_palette(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.if_shared_palette(text,integer) TO anon,authenticated;
