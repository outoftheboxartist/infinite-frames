# Infinite Frames source reconstruction

This branch was created from `inthebox` to reconstruct the Claude artifact into maintainable source code. The original branch and live application remain unchanged.

## Source of truth
- `app/index.html`: compiled Claude artifact; preserve as reference, do not edit in place.
- `app/local-preview.html` and `app/local-state.js`: offline reference scene.
- `HANDOFF.md`: documented behaviors, known bugs, data model.
- `yin-yang-svg/frame-1.svg` through `frame-5.svg`: reference frame artwork.

## Reconstruction order
1. Establish a read-only 2D canvas rendering the five supplied fish frames.
2. Match zoom/pan behavior and transition from canvas to 3D box.
3. Restore closed boundaries, selections, clipping, and image-to-curve conversion.
4. Restore creation/publishing, replay, profiles, chat, and votes.
5. Add isolated backend integration and mobile performance tests.

## Safety rules
- No changes to the `inthebox` branch until an explicitly reviewed pull request.
- Do not connect development publishing to the production database.
- Do not copy live user identifiers into demo data.
- Maintain original artwork, SVG geometry and 2D-to-3D behavior as reference.
- Confirm touch and mobile behavior before any merge.

## First acceptance milestone
An independently runnable read-only application with the five reference SVGs, pan/zoom, and a clearly labeled offline mode. No live writes.
