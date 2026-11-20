# IF Main (Foveated)

Live at https://claude.ai/artifact/ArWGN4oUXmf5kNMm6WbjJm (its own database, starts empty).
The main live app (`app/index.html`, https://claude.ai/artifact/KY2rRser7qDWzVvYQjSMzT) is unchanged.

What it is: the main Infinite Frames app with the Foveated Zoom engine brought in.

- `foveated-layer.js`: readable module, the fast renderer. It draws the 2D canvas straight to a
  `<canvas>` from the app's state (regions, onion ghosts, pieces, drafts, outlines, adjust box,
  live stroke), skips what is off screen or under a pixel, and simplifies shapes more the further
  they are from your finger (cached detail levels, as in Foveated Zoom). While you pan or pinch it
  slides the last frame and redraws when the gesture settles. A WebGL pass runs the Foveated Zoom
  shader on top (Prism / Blocks / Off switch, with a Depth / magnification readout). Frame-strip
  thumbnails are small cached pictures. The app's SVG keeps only the closed curves used for tapping
  and no longer paints. If the renderer throws, it hands drawing back to the SVG. It only reads the
  app (via `window.__ifApp`), never writes.
- `_fs_original.glsl`: Foveated Zoom's fragment shader, unmodified. `build.py` adds a
  view transform so the last raster follows pans and zooms.
- `build.py`: builds `index.html` from `app/index.html` with exact, counted patches:
  zoom limit 8x to 4096x, brush width and minimum loop size scaled to the zoom, path
  decimals that follow the zoom, `window.__ifApp` exposed, the 2D SVG skipping per-piece
  elements while the fast renderer runs, and thumbnails taken from the fast renderer.

Measured (headless Chrome, phone size, demo content plus traced Yin n Yang shapes repeated):
1,500 shapes: same smoothness as the current app (about 17 ms a frame). 7,000 shapes: 22.6 ms
average vs 25.3, 95th percentile 67 ms vs 100, and 39 SVG elements in the page instead of 13,895.
The Prism shader could not be timed fairly there (software graphics); not yet measured on a phone. Run `python3 app-foveated/build.py`.

Not ported: Foveated Zoom's procedural seed art (rosettes, spirals at every level), so deep
areas stay empty until people draw there; and its unlimited re-rooting, so depth stops at 4096x.
