# IF Main (Foveated)

Live at https://claude.ai/artifact/ArWGN4oUXmf5kNMm6WbjJm (its own database, starts empty).
The main live app (`app/index.html`, https://claude.ai/artifact/KY2rRser7qDWzVvYQjSMzT) is unchanged.

What it is: the main Infinite Frames app with the Foveated Zoom engine brought in.

- `foveated-layer.js`: readable module. Rasterises the app's 2D SVG when the view is still
  and runs it through the Foveated Zoom shader (sharp near your pointer or finger, prism
  sparkles or dithered blocks toward the edges). It shows a Depth / magnification readout and a
  Prism / Blocks / Off switch. It only reads the app (via `window.__ifApp`), never writes.
- `_fs_original.glsl`: Foveated Zoom's fragment shader, unmodified. `build.py` adds a
  view transform so the last raster follows pans and zooms.
- `build.py`: builds `index.html` from `app/index.html` with exact, counted patches:
  zoom limit 8x to 4096x, brush width and minimum loop size scaled to the zoom, path
  decimals that follow the zoom, and `window.__ifApp` exposed. Run `python3 app-foveated/build.py`.

Not ported: Foveated Zoom's procedural seed art (rosettes, spirals at every level), so deep
areas stay empty until people draw there; and its unlimited re-rooting, so depth stops at 4096x.
