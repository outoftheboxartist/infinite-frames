# Infinite Frames: Shared AI Development Handoff

**Canonical repository:** https://github.com/outoftheboxartist/infinite-frames  
**Current development branch:** `feature/guest-test-profiles-supabase-20261114`  
**Current PR:** https://github.com/outoftheboxartist/infinite-frames/pull/6 (draft, not merged)  
**Original-app preview with test profiles:** https://infinite-frames-rebuild-preview-8ngli7mnw.vercel.app

## Read first

This repository is public. **The default branch `inthebox` is NOT the latest working development app.** Before changing anything, fetch the current head of `feature/guest-test-profiles-supabase-20261114`. Do not infer current app behavior from this document alone: code may change after the handoff was written.

The original application is **`app/index.html`**, a bundled HTML/React app with the established Infinite Frames design, canvas, creation tools, curve selection, profile controller, frame workflow, comments, 2D/3D scene, Supabase code, and Publish & Lock.

The separate `engine-v2/` app is a **performance experiment only**, NOT a UI replacement. Its curve-aware viewport/quadtree techniques have been incorporated into the original app. User explicitly wants the original interface and capabilities preserved, not a completely different app.

## Current working branch

- `app/index.html` — original UI, improved mobile SVG hit testing and overlapping-curve choice, region navigation, cached viewport quadtree, Publish & Lock fixes, and test-mode bootstrap.
- `app/guest-sandbox.js` — passwordless test profiles with names/colors; local-first test canvas, Supabase sandbox backup, reset.
- `app/sql/guest-test-worlds.sql` — versioned schema and RLS for **public.if_guest_test_worlds**, separate from production artwork tables. This migration was already applied to project `xqfevafhjbdulhcqcmao`.
- `app/tests/` — spatial/navigation and guest-sandbox regression tests.

## Canvas engine in the original app (`app/if-canvas-engine.js`, added 2026-11-17)

The original app keeps its UI and every feature; only the 2D canvas drawing and camera were swapped for the lab engine's approach.

- `app/if-canvas-engine.js` (readable source) draws the 2D view into a `<canvas>` behind the original `<svg>`, which is now empty and only takes pointer events. It draws windows with clipping, frame items, onion ghosts, drafts, selection and the live stroke. It also draws the F1..Fn strip thumbnails, which used to be five full SVG copies of the world, re-reconciled on every render.
- The view is owned by the engine: pan/zoom redraw on the next animation frame, and React hears about it about 160 ms after it settles. This cut a React render from ~57 ms to ~5 ms.
- Zoom cap raised from 256x to 1e8x. New path text keeps decimals matched to the zoom (`window.__ifDigits` in `ls`/`Di`). Brush width and the minimum loop size are now screen-relative. Tap hit-testing uses center-relative paths.
- Exactly 14 edits in `app/index.html`, each one a single exact string replacement. Every one keeps the old behavior when `window.IFEngine` is missing. Search for `ifEngine` / `IFEngine` / `__ifDigits`.
- Measured (headless Chromium, phone viewport, 1,814 windows + yin-yang frames): zoom 45 -> 58.6 fps, pan 55 -> 60 fps, zoom-out stalls 24 -> 0, fly-to-deepest 28 fps capped at 256x -> 54 fps reaching 1e8x. Not yet measured on a real phone.
- Known limits: global 0..1000 coordinates hold ~1e-13 precision, enough to ~1e11x. Traced image contours still write 3 decimals. Live multi-user cursors from the lab are not wired in yet.
- Tests: `app/tests/canvas-engine.test.mjs`.
- **2026-11-18 update:**
  - **Navigation** matches the lab: drag at any zoom, glide after release, pinch/scroll zoom toward the fingers/cursor, two-finger rotate (eases upright at whole canvas). Zooming out past the whole canvas still opens 3D. The view gains an optional `r` (rotation).
  - **Image trace is now "geometry from the image"** (`IFEngine.shapeTrace`): every connected patch of one colour is a shape, holes stay holes. Anti-aliasing fringes fold into the shape they hug, and the smallest shapes merge into their neighbours until the Shapes setting is met. The traced artwork and the selectable curves are the same list (N shapes = N curves). All import options (upload, photo, GIF, trace dialog, colours, detail, smoothing, clean-up, black & white, remove background) are unchanged.
  - **Detail limits** (`IFEngine.TRACE_RULES` in `app/if-canvas-engine.js`): 40 shapes for everyone, +20 per published piece, +10 per 10 points, capped at 600; the owner gets 2000.
- **Live test build:** https://infinite-frames-engine.vercel.app (separate Vercel project `infinite-frames-engine`, deployed from this branch with root directory `app`).

## Nested engine lab (`lab/nested-engine/`, added 2026-11-17)

A standalone, readable-source prototype of the architecture for an infinitely nested, real-time collaborative SVG world. It does **not** modify `app/index.html`, production `if_shared_*` tables, or the guest sandbox; it uses its own `if_lab_*` tables. Start with `lab/nested-engine/ARCHITECTURE.md`.

- Anchor-relative camera (no global coordinates): tested pixel-exact 80 levels deep (10^-42 scale).
- Renderer: viewport culling, adaptive level of detail, per-region spatial grid, map-style tile pyramid for dense regions, float64 clipping for shapes far bigger than the screen.
- Collaboration: optimistic local edits, ~30 Hz coalesced ops, relay with server sequence numbers, per-field last-writer-wins, live cursors/selections/follow, batched Postgres writes (never on the hot path).
- Dummy world: 100,704 shapes, 45 levels, a 20,000-star region, and the `yin-yang-svg/` frames imported as real paths.
- `npm test` (14 tests, DB test auto-skips without Postgres) and `npm run bench` (real Chromium; numbers in ARCHITECTURE.md).
- Demo mode (no server; same world generated in the browser; tabs sync) runs as a static page.
- Next step for the main app: port `camera.js`, `scene.js`/`sync.js` and `renderer.js` in place of the original viewport/quadtree code, keeping the original UI.

## Database and tests

Supabase project: `xqfevafhjbdulhcqcmao`.

The active guest preview uses `if_guest_test_worlds`. Production artwork tables (`if_shared_nodes`, etc.) are NOT modified by guest operations. Guest-world links act as bearer capabilities, not secure personal accounts; anyone with the test-world URL can view/change that disposable test world. Do not store private data in it.

Guest profiles are browser-local nicknames, colors, and IDs, not permanent Supabase Auth users. Published test pieces save locally, then attempt a Supabase backup. Reset clears the **test canvas**; never reset production by default. An offline reset must not resurrect old remote data.

Vercel deployment protection was disabled only for the **original-app preview project** `infinite-frames-rebuild-preview`. Preview may be open to anyone with its link.

Open `https://infinite-frames-rebuild-preview-8ngli7mnw.vercel.app?live=1` **only if intentionally testing the original authenticated Supabase backend**. Default preview is the passwordless sandbox.

## Important product requirements

- Infinite SVG zoom and navigation within user-created closed curves.
- One shared, evolving world with parent-child geometry, contributor attribution, frame continuity, and locked published art.
- Imported artwork can exceed the size of its clip curve while being visually clipped by that selected region.
- The canvas stays visible on mobile; controls should be minimal and contextual.
- Profile-driven edge gestures: left Explore/Consume, right Create, up Profile, down Chat/Community.
- Preserve original visual identity, camera behavior, prism/rainbow artwork, and working tools.
- Fast spatial queries should render only visible, relevant geometry without reducing original SVG source detail.

## Collaboration rules for Claude, ChatGPT, or other coding agents

1. **Fetch the branch head before every work session.** GitHub is the shared source of truth, not either model's memory.
2. Work in branches/PRs. Never overwrite or merge `inthebox` without user's approval.
3. Keep the original application as the target, not `engine-v2`.
4. Preserve all user artwork and existing application functionality.
5. Run regression tests and check syntax; publish a preview before claiming fixes are working.
6. Distinguish tested source behavior from actual phone/browser/Supabase end-to-end verification.
7. Do not weaken production authentication, RLS, or storage permissions to enable testing.
8. Commit a concise update to this handoff when architecture or test flows change.
9. Coordinate by reading latest commits and PRs. **There is no automatic live synchronization between assistants** unless each one refreshes from GitHub.

## Current open verification

- Verify the public guest preview opens without a Vercel login and guest creation works on phone.
- Publish from two dummy profiles and confirm attribution, frame navigation, and Supabase sandbox persistence.
- Reset a test world, refresh the browser, and confirm data does not return.
- Confirm curve hit selection picks the actual nested curve, not the generic 'Window 1'.
- Verify full browser interaction and network save/error handling before merging this PR.
