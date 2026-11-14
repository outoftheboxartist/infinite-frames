# Infinite Frames V2 | Spatial-first renderer

A **new, independent, modular application**. This does not run the compiled V1 HTML and does not write to production Supabase.

## How to run

Serve \`engine-v2/\` over HTTP, e.g. \`python3 -m http.server 8000\` from this directory. Open \`http://localhost:8000\`. Native JavaScript modules and module workers require HTTP(S).

## Architecture

- \`src/model.js\` generates reproducible *synthetic* closed SVG paths and their immutable parent/frame metadata. No demo artwork is sent to Supabase.
- \`src/spatial.js\` builds an indexed quadtree from light bounding-box metadata. Culling happens before geometry drawing; level of detail skips only *rendering*, not storage.
- \`src/index-worker.js\` keeps expensive spatial queries away from the UI thread; fallback is available.
- \`src/scene.js\` holds original geometry, parent-child adjacency and path cache, plus visible-ID queries.
- \`src/renderer.js\` renders only intersecting, large-enough curves with parent clipping; selection resolves ancestors and children.
- \`src/main.js\` handles camera, touch/pinch, wheel, curve selection and an on-screen performance counter.

## Principles

1. **Unchanged source geometry.** LOD never alters the saved paths.
2. **Spatial first.** Camera drives candidates, then geometry, not vice versa.
3. **Relationships.** The selected curve's ancestors, children and siblings remain identifiable while unrelated art is subdued.
4. **Published geometry is immutable.** This phase is read-only; editing and cloud publication are deliberately not implemented.
5. **Future adapters.** A separate, permission-checked Supabase reader can exchange viewport metadata and source bundles without changing the renderer.

This is the V2 renderer foundation, not the completed collaborative app, the 3D box, or a verified million-curve benchmark. The stress presets create many synthetic curves to inspect culling and frame time on mobile.

## Tests

Run \`npm test\` from \`engine-v2\` to execute pure spatial/relationship correctness checks. Browser-based touch and visual testing are still needed before approval.
