# Infinite Frames — handoff guide

Read this first if you're picking this project up (person or AI).

## What it is

**Infinite Frames** is one shared, living artwork. Everyone draws on the same 1000×1000 canvas, and the artwork moves forward in **frames**, like an animation. Closed curves ("boundaries") are regions that people fill and build on. Zoom out past the edge of the canvas and you leave the 2D view: the canvas becomes the floor of a 3D box, and every frame is a stacked layer you can orbit and pull apart ("explode").

It runs as a claude.ai **Artifact**: a single HTML page with a small shared database behind it.

## What's in this folder

| Path | What it is |
|---|---|
| `app/index.html` | **The main app, newest version.** This is what's live. |
| `app/local-preview.html` | Same app, but it loads a snapshot of the live canvas from `local-state.js`. Open it in a browser to see the real content without claude.ai. |
| `app/local-state.js` | Snapshot of the live canvas: frames 1–5, the fish items, the remaining shapes, the 2 photos. |
| `app/db-backup/` | Backup of 457 old traced shapes (`boundaries/`) and 7 fills (`items/`) deleted from the live canvas on 2026-11-12, one JSON file per database document. |
| `yin-yang-svg/frame-1.svg` … `frame-5.svg` | The five fish frames as standalone SVGs (1000×1000, black background, each already turned to its angle). |
| `index.html`, `logobox.b64.txt` | An **older, separate** version ("Infinite Frames Playground") and its 3D box model (a base64 glTF). Not the main app. |

## Important: `app/index.html` is a compiled bundle

The app is React compiled by Vite and minified. **There is no original source code**, so all edits are made directly in the minified JavaScript.
- Almost all the app code sits on **line 55** of `app/index.html` (a ~190 KB line).
- Line 15 holds embedded assets (`window.__IF_ASSETS`), and lines 16–54 are React itself.
- Edit by search-and-replace on exact unique strings. Check each string appears exactly once before replacing it.

The main class is a React component (minified name `Nc`). Methods worth knowing, searchable by name on line 55:

| Method | What it does |
|---|---|
| `hydrate(n)` | Turns loaded data into state (`frames` with their `items`, boundaries `B`, chat). |
| `art(n, r, i)` | Builds the SVG for frame `n`. Prefix `r` is `"ifv-"` for the 2D view and `"L"+f+"-"` for 3D layers. |
| `sd(d, T0)` | Simplifies a path's points (Ramer–Douglas–Peucker, cached). `T0 = 2.2` is the coarse setting for 3D. **Never use `this.sd` as a variable**: that crashed the app (see below). |
| `zoomBy(n)` / `addPull(n)` | Zoom. Once you're fully zoomed out, further zoom-out fills a 0–1 "pull" meter; at 1 it calls `enter3D()`. |
| `enter3D()` / `exit2D()` | Switch into and out of the 3D box view (tweened `cam` state). |
| `scene()` | Renders the 3D box: 4 walls (PROFILE, CHAT, EXPLORE, CREATE) plus one layer per frame. |
| `layerImg(f)` | Draws frame `f` once as a flat SVG image for its 3D layer (cached), so 3D never redraws live curves. |
| `prismWrap(...)` | Optional color-fringe filter on the 2D view. **Currently forced off** (`if(true||...)`). |

## Data model (shared database)

Collections:
- **`frames`**: `{n, status}` where status is `"published"` or `"open"`. Document id = the frame number as a string. Frames 1–4 are published and 5 is open.
- **`boundaries`**: closed curves shared by all frames. `{id, type:"boundary", d, name, color, palette, founder, founderId, frameN, at}`.
- **`items`**: content inside one frame. Every item has `frameN` and optionally `b` (a boundary id to clip to). Types:
  - `stroke`: `{d, color, w}`
  - `vector`: `{paths:[{d, color}], cx, cy, t:{x, y, r, s}}`. `t` is a transform around `(cx, cy)`: move, rotate in degrees, scale.
  - `image`: `{src, x, y, w, h}`
- Also `messages`, `votes`, `events`, plus `places` (saved views).

Coordinates are canvas units from 0 to 1000.

## The Yin n Yang founding scene (frames 1–5)

Items `yy-f1` … `yy-f5` are `vector` items made by tracing the user's yin-yang fish image (a black fish and a white-to-rainbow fish circling each other).
- Detail grows each frame: Frame 1 has about 3 closed curves, Frame 5 about 113.
- `t.r` = 0, 45, 90, 135, 180, so the fish turn half a circle over 5 frames. `cx = cy = 500`.
- The same shapes are in `yin-yang-svg/`.

## Fixes made on 2026-11-12/13 (newest last)

1. **Zoom into 3D took about 8 scroll notches.** Pull gain raised from `1.6` to `4.5`, and the zoom-out button from `.34` to `.55`. Now it takes 2–3 notches.
2. **Huge traced shapes:** 450 boundaries traced at pixel steps (about 2.6 MB of path data) were deleted (backed up in `app/db-backup/`), and 3D draws coarser simplified paths.
3. **Every visual filter removed** at the user's request (the 3D view should be black and white, no colored effects): the colored blurred glow behind the canvas, the prism filter, the wall noise, tint and blend modes, the frosted-glass panel blurs, and the selected-curve glow.
4. **Each 3D layer is a flat cached image** (`layerImg`) instead of live SVG.
5. **The real crash:** rotating the 3D view by touch saved the drag start in `this.sd`, overwriting the `sd()` method. The next render threw `this.sd is not a function` and the whole app unmounted. The variable is now `this.orb`. Confirmed: crashed before, fine after.
6. **On-screen error report:** any uncaught error shows a red box at the bottom of the page. Ask the user for a screenshot of it.

## Open requests from the user (not done yet)

- **After an image is placed and the tracer is accepted, the canvas still shows the image** instead of the traced curves, and still treats it as needing a trace. The user wants imported images converted to curves (fewest curves possible) with no separate "image trace" step.
- Older notes: batch import that spreads images out, a "clear all frames / start over" button, faster panning with heavy curves, and saved places (viewport, name, comments) you can jump to.
- The user tests on a phone, probably an iPhone in Safari. Test touch, and test performance.

## How to test

- Open `app/local-preview.html` through a local web server (for example `python3 -m http.server`, then visit `/app/local-preview.html`). It uses the snapshot instead of the live database.
- To reach 3D, zoom all the way out with the scroll wheel or pinch, or tap the zoom-out button.
- Use a phone-sized viewport (390×844) with touch.
- Saving and the live shared canvas only work when the page is published on claude.ai. Off claude.ai, changes stay in your browser's localStorage.

## Note on personal data

`app/db-backup/` and `app/local-state.js` contain the owner's internal user id (`founderId` / `authorId`) and default artist name. They identify the owner's own work and contain no email or real name.
