# Infinite Frames Spatial Engine v1 | Build status

Branch: `rebuild/source`. Safe reference: `inthebox`.
Preview is intentionally browser-local, not a shared Supabase editor yet.

## Implemented now

- Browser IndexedDB v1: separate `records` (lightweight metadata), `geometry` (exact SVG paths, vector colors and source payload), and `state` (frames, messages, votes, events).
- Safe one-time migration from the existing `if-local-v1` localStorage snapshot. The legacy record is preserved as a backup and not rewritten on successful migration.
- Subsequent local publications write data to IndexedDB instead of rewriting the whole large localStorage document.
- Individual SVG paths are saved unmodified; geometry can be fetched on demand with `regionById`.
- Search metadata by name prefix, creator prefix or color prefix, with IndexedDB indexes; click a result to load its exact boundary and smoothly zoom to it.
- Viewport-based *render culling* for visible 2D SVG nodes. Bounding boxes account for rotation, scale and translation. Full path data remains stored without simplification.
- `visibleRegions` API returns only metadata or selected visible full-resolution regions from IndexedDB.
- Installed isolated, additive `public.if_spatial_regions` and `public.if_spatial_geometry_manifest` tables on the existing Infinite Frames Supabase project, with GiST bbox, name/color/parent indexes, and row-level security.
- Private `if-spatial-geometry` Supabase Storage bucket, and `if_spatial_viewport` / `if_spatial_find` SQL functions.
- No changes to existing `public.if3d_objects`, `public.if3d_messages`, or the `inthebox` branch.

## Important limitations

- **Not yet truly lazy hydrated:** The Claude renderer still hydrates full geometry into React memory on initial load for compatibility. Viewport culling reduces mounted nodes, but not the initial memory footprint. Next milestone is page-by-page geometry hydration and cached frame previews.
- **Not yet shared:** The production Supabase schema is empty and security policies do not permit anonymous writes. The preview uses IndexedDB only. A verified authenticated publishing API and migration of existing shared art are separate steps.
- No automatic background sync, no 3D path-specific return targeting, and no multi-user conflict resolution yet.
- Browsers on different origins have separate IndexedDB and localStorage. New test deployment hostnames do not automatically share drafts with older hosts.
- The old localStorage backup remains **stale** after new edits are saved to IndexedDB; it is a rollback snapshot, not a second synchronized source of truth.

## Runtime and safety checks

- Local memory-IDB test: migration, exact path reconstruction, viewport filtering, metadata prefix search across name/author/color, and additive publishing.
- Local backend test: load, publish, frame append, messages, votes, and path lookup.
- All integrated inline scripts compile as JavaScript.
- Installed Supabase tables verified with RLS; both new tables and private geometry bucket exist.
- **Phone browser checks still needed** for migration timing, rendered selected paths, search latency, offline reload, storage quotas, and canvas FPS.

## How to test on Android

1. Open the isolated spatial preview; confirm the founding artwork appears.
2. Tap the menu (`...`) and choose **Find a curve…**. Search a visible boundary name or author prefix.
3. Choose a result; the boundary should highlight and smoothly zoom without opening Trace.
4. Import and publish a new traced image; reload the **same URL** and confirm both the artwork and its curves persist.
5. Search the newly published curve name, then revisit it.
6. Zoom very far into a small curve; the detailed SVG should not lose geometry.
7. Note any pause or memory/performance problem and which Android browser you are using.

## Next implementation gate

Build true viewport-paged hydration: indexed metadata-only bootstrap; independent SVG geometry fetch for the selected region, immediate parents and visible neighbor tiles; fast LRU/IndexedDB cache; frame snapshot/texture cache for 3D; search result prefetch before zoom.
