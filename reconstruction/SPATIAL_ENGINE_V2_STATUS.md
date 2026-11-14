# Infinite Frames · Spatial Engine v2 (November 2026)

Development branch: `rebuild/source`. Preserved Claude artifact: `inthebox`.
Standalone preview: a distinct Vercel origin and browser-local IndexedDB. **Not a multi-user Supabase deployment.**

## Implemented

- **Metadata-only bootstrap:** `backend.load()` now returns frames, chat, votes, activity, and empty artwork arrays. It does not load all saved SVG paths into React at startup.
- **Separated data:** IndexedDB `records` contains indexed metadata; `geometry` contains exact SVG path data and per-path fill colors; `sources` contains the original uploaded image data URI unchanged; `tiles` is an index only; `previews` contains derived compact frame thumbnails.
- **Indexed nearby lookups:** A hierarchical 2D grid maps artwork bounding boxes into tiles at appropriate levels, plus ancestor tiles. Queries retrieve candidate record keys through the IndexedDB `by_tile` index, check exact bounding-box intersection and fetch only the selected geometry records.
- **Viewport streaming:** When 2D camera position, zoom or active frame changes, nearby geometry is requested in a debounced batch. React state replaces offscreen published geometry while retaining unpublished drafts and current selection. At most 260 geometry objects are requested in one batch; caches retain a bounded 96 recently read geometry objects. Coarse frame previews cover wide views, and full-resolution vectors render on close zoom.
- **Offline caching:** IndexedDB is persistent within this browser origin. Recently visited geometry is available without remote fetch; an in-memory LRU accelerates repeated paths. Previews are generated sequentially, derived from originals, stored locally and invalidated after publication.
- **No forced photo downscale:** Import no longer silently reduces an input photo to 1600px. In-app camera tries a full-resolution still via ImageCapture, falling back to a PNG at native video-stream resolution. Vector tracing still samples the input according to the *separate* tracing-resolution control; an SVG trace cannot invent lost details. Existing published artwork remains unchanged.
- **Search and navigation:** Indexed name/color/author search returns metadata before path blobs, with exact geometry fetched for selection. 3D view now has a magnifying-glass search button. The camera prefetches the selected destination region, transitions to 2D, and smoothly zooms to it (without requiring 3D path hit-testing).
- **3D texture previews:** A 640px WebP overview is intentionally compressed as a *view cache*. It is not the authoritative SVG or original source image. Preview rendering reads individual path geometry incrementally rather than keeping every SVG in React.
- **Preserved UI:** existing Claude controls, collaboration mock, publication title/prompts, profile photo, 3D frame stack, zoom and Explore panels.

## Not yet implemented

- Supabase-authenticated multi-user publishing, server-side storage uploads/sync, or conflict-safe cross-device storage. The pre-existing Supabase spatial tables/bucket are installed but not connected as live writer/readers here.
- True infinite nested local coordinate-system transforms; current app still uses 1000×1000 scene space and a zoom limit.
- Unlimited simultaneous rendered SVG nodes. The viewport budget limits how many individual paths are mounted at once. Future optimization: progressive pagination of dense visible regions, tiled raster overlays, and WebGL/Canvas fallback after mobile profiling.
- Complete shared artwork restoration across different Vercel subdomains. Browsers isolate each origin's IndexedDB.
- Actual Android stability/FPS/memory benchmark; synthetic tests do not substitute for mobile testing.
- For already-published legacy vectors, the original uploaded source file may have been discarded by old code, and cannot be reconstructed. The new source-preservation rule applies to future imports.

## Tests run

- In-memory IndexedDB simulation: 292 metadata records, 120 nearby boundaries, 170 distant boundaries; verifies metadata-only startup, 121 local boundary results including the root, no faraway boundaries fetched, exact SVG and original image preservation, independent source lookup, and a 96-entry geometry cache.
- Search-driven navigation: an indexed 3D selection preloads destination geometry, switches to 2D, then flies to the precise bound.
- All inline scripts parse; deployed Vercel HTML responds with HTTP 200 and expected modules are present.

## Suggested mobile acceptance sequence

1. Open the **same preview URL** and draw/publish a named shape.
2. Reload this URL and confirm the shape appears via overview/viewport loading.
3. Select a tiny shape and zoom in/out repeatedly; its SVG geometry must remain unchanged.
4. Explore, search by name/color/artist, and select a matching curve.
5. Enter 3D, tap Search in the upper-right, find a region, and verify you land in its 2D location.
6. Repeat while offline to test IndexedDB cache.
7. Upload a large image, publish traced artwork and verify that the 2D image does not pixelate from app-side 1600px reduction. The *traced vector* has its own resolution limit.
