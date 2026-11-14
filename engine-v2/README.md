# Infinite Frames V2 | Curve-aware spatial renderer

A **new modular application** replacing the need to edit the compiled V1 bundle for rendering improvements. V1 creation/editing remains available separately. V2 is currently a **read-only renderer**: it never posts artwork or mutates production data.

## Choose a world source

- **Speed demo** (default): reproducible sample data at 4K, 14K or 40K curves, with no network requirement.
- **Shared art**: read the existing Supabase world via public frame metadata, the read-only spatial RPC 'if_shared_viewport_page', and immutable geometry bundles in 'if-shared-bundles'. Camera movement queries nearby metadata only; referenced bundles are fetched lazily and cached. No private admin key, no insert/update/delete.
- **Saved V1 art**: explicitly load the archived five-frame artwork from the existing public GitHub file 'rebuild/source/app/local-state.js'. Extract the JSON without executing JavaScript. Display real SVG vector fish and imported image content in **read-only** mode. Nothing from this archive uploads into Supabase.

Frame picker switches which archived or published frame is shown. The window contains a region inspector and fast mobile pan/pinch gestures.

## Source architecture

- src/model.js: reproducible synthetic scene generation.
- src/spatial.js: worker-compatible quadtree, viewport intersection, LOD threshold and ancestry.
- src/index-worker.js: background spatial queries.
- src/scene.js: node and parent-child relationships, exact SVG Path2D cache, lazy image cache and selected-region relationship cache.
- src/renderer.js: Canvas2D viewport-only rendering. Supports source boundaries, vector, stroke, image and ancestor clipping.
- src/live.js: live Supabase **read-only** adapter for the existing published metadata/bundle format.
- src/legacy.js: read-only archived-V1 input adapter that never executes downloaded code.
- src/main.js: mobile camera controls, source switch, read status and frame selection.

## Important production facts (2026-11-14)

The connected Infinite Frames Supabase project currently has **0 rows** in public.if_shared_nodes and public.if_shared_frames. Shared art mode correctly displays "no published curves" until artwork is published. The separate legacy archive is never automatically inserted into that database.

An existing storage.objects SELECT policy for if-shared-bundles appears to compare n.bundle_path = n.name, instead of comparing the published bundle path to the **storage object's** name. That may prevent public readers from downloading geometry once it is published. This integration does not weaken production bucket policies or bypass private data access. Inspect and correct that policy separately before publishing and cross-user testing.

## Performance and limitations

Spatial culling and LOD **only skip rendering**. They never delete, flatten, or simplify source paths. Original geometry remains in immutable bundles or the archive; parent and item relationships are preserved. Indexed, visible and drawn counters show the current rendering workload.

This is still Canvas2D, not the final GPU/tiled compositor. Animated GIFs display through standard browser images; authoring, collaboration, immutable publication and the 3D box still need to migrate from V1. Production read permissions need separate verification.

## Development and tests

Serve the engine-v2 directory over HTTP. Example: from that folder run 'python3 -m http.server 8000', then open http://localhost:8000.

Run 'node --test engine-v2/tests/*.test.mjs' from the repository root. Coverage includes indexed visibility, LOD preservation, ancestry, Supabase adapter success/error/empty states, and safe archive parsing.

This feature branch has not been merged into existing production apps or databases.
