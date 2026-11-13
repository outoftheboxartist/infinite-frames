# Infinite Frames | 3D Navigation + Spatial Loading

Status: specification and incremental prototype, not a completed spatial engine.
Branch: `rebuild/source`. Preserve original `inthebox`.

## Design principle

Infinite Frames is a *world of linked regions*, not a permanently mounted giant SVG.
Preserve each published SVG path at its original fidelity and color. Load/render geometry appropriate to the current location and zoom. Details must not degrade or be discarded when navigating between 2D and 3D.

## 3D box interaction (first increment implemented)

- 3D uses lightweight cached per-frame images as textures; do not mount all SVG paths just to orbit.
- Orbit by one-finger drag and mouse drag.
- Scale farther out (minimum 0.12, versus the earlier 0.4 clamp); pinch with two fingers, use a scroll wheel, or press +/-.
- At a close zoom crossover (~1.75 of the current box scale), transition to the full-detail 2D canvas. Preserve the existing INSIDE button.
- Outer reveal: display **OUT THE BOX** at the distant zoom threshold. Replace placeholder with a user-selected quote later. Text is externally customizable via `window.__IF_OUTER_MESSAGE`; do not invent a quote.
- Keep rotate/flip/reset/explode controls.
- In 3D playback: F1 = layer 1; F2 = layers 1+2; F3 = layers 1+2+3; through the current frame. Stopping restores full stack.

## Precise 3D-to-2D targeting (next phase, NOT implemented)

When a user taps or zooms toward a specific region *on a 3D layer*, compute the target coordinate by inverse-projecting the 3D face-plane click, accounting for perspective, rotation, scale, and layer transform. Use the exact frame and region identifiers, not an approximate center of the viewport. Prefetch its local vector geometry and color palette. Crossfade from the cached 3D snapshot into the exact live 2D paths just before the snapshot visibly loses resolution. Smooth camera zoom should maintain the chosen anchor point through the handoff. Include a failed-prefetch fallback without showing missing geometry or teleporting.

Don't pretend 3D image-texture hit-testing is exact; the spatial index and coordinate mapping must be built and tested first.

## Spatial Engine v1 (planned, not implemented)

1. **Persist geometry separately from metadata**: immutable versioned SVG path blob, exact color fills, path IDs, frame IDs, parent/child region IDs; store bounding boxes, centroid, ancestry, contributor attribution, name and tags in an indexed database.
2. **Spatiotemporal query**: viewport rectangle + level-of-detail + frame range + root/parent region. Use database spatial indices and bounded pages of results; load only relevant geometry.
3. **Hierarchical coordinate system**: child curve has a local coordinate transform into its parent. Enables deeply nested exploration without losing numeric precision from tiny global coordinates.
4. **Render strategy**: coarse vector/texture previews at wide views, exact SVG geometry in selected areas, incremental tiles/chunks as user zooms. Never derive authoritative geometry from lossy previews.
5. **Caching and prefetching**: IndexedDB + memory LRU, texture atlas for box views, prefetch around camera motion and current selection. Cap memory, node count, decoding work and active HTTP requests for mobile.
6. **Search**: index curve name, artist, tags, frame and palette metadata without loading path blobs. After a search result, fetch exact geometry and fly to the curve.
7. **Revision and publication**: permanent versioned contributions with attribution; user preferences/local rules are metadata evaluated against a proposed new contribution, not destructive edits to previous vector geometry.

## Acceptance tests

- At three zoom depths, a path has identical path data, color and shape. No depth-dependent simplification in the authoritative 2D canvas.
- In 3D, wheel, pinch and +/- can zoom both closer and farther out. The box remains orbitable throughout.
- After distant zoom, the hidden OUT THE BOX text appears; normal views are uncluttered.
- Play from Frame 1 with N frames and verify visible layer counts equal 1,2,...,N in 3D.
- Select a path via search: only relevant geometry loads, selection and smooth navigation work even from a very small child region.
- 3D region selection lands on the same region in 2D, without teleport or change of color/shape after the cache-to-vector crossover.
- Verify on Android (touch capture, event handling, graphics memory, offline cache); synthetic tests alone do not establish mobile performance.

## Open design choices

- User-supplied outer quote, exact typography and timing.
- Camera zoom-to-selection behavior from arbitrary 3D faces (2D viewport anchor and speed).
- Spatial chunk/LOD budget after measuring actual artwork on phone.
