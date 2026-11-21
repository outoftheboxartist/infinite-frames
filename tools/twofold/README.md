# TWOFOLD

A 20-frame film for Infinite Frames (2026-11-21). Two small lights orbit, become the Yin n Yang fish,
then a current, a threshold, two rings with flow between them, a galaxy, a tangle that resolves into a
ring-shaped double helix, a bloom, the IF name made of orbiting pairs, a fractal of yin-yangs, and
finally two lights again, each holding the whole story. Frame titles and lines are in `frames.json`.

- `twofold.js`: the renderer (Canvas 2D in a browser). 2048x2048 per frame, transparent background
  so frames stack cleanly in the 3D view, additive light, prism-split edges, a dithered spectral fringe
  (the Foveated Zoom look), and tiny galaxies and orbiting pairs hidden throughout for zooming in.
- `render.js`: renders `out/f01.webp` ... `out/f20.webp` (needs `src/fish.png` and `src/iflogo.png`:
  the founder's fish image and an IF logo video frame, with black keyed out to transparency).
- `upload.mjs`: uploads frames to the `ifm-assets` storage bucket as a guest session.
- `build_rows.py`: writes the canvas rows: a circular "TWOFOLD" window, one image per frame,
  frames 1-19 published and 20 open, activity lines, a saved place and a pinned introduction.

Inspired by, not copied from, reference images the founder shared (threshold portal, field of light,
discipline / surrender / flow, chaos as unrecognised pattern). Only the founder's own works appear.
The canvas before TWOFOLD is backed up in `archive/canvas-before-twofold-2026-11-21.json`.

## Vector version (current)

The frames on the canvas are now native vector art, not images.

- `trace_sources.js` traces the fish and IF logo once into `sources.json` (run against `web/dist`).
- `vector.py` builds all 20 frames as smooth closed cubic curves into `vector.json`. Frame 1 is two spheres; every frame adds more detail. Selectable curves per frame are capped at 2 + 8·(n−1), largest first.
- `preview.js` renders a contact sheet.
- `build_vec_rows.py` turns it into `ifm_docs` rows: vector items in ≤180KB chunks (`i-twofold-NN-vMM`, the painted frame kept as `orig` on part 1 so it can be traced later) and `frameOnly` curves (`b-twofold-fNN-MMM`).
- `apply.py` swaps them in through the Supabase Management API.

## TWOFOLD II: the helix (current)

24 frames, turning 15 degrees each. Two grey dots become two yin-yang fish, gain colour and
detail, are joined by a bridge, and open into a galaxy. Stacked in 3D the dots trace a double
helix and the bridges are its rungs. Every dot holds a galaxy, four levels deep, with a tiny
yin-yang at the bottom. Three hidden paths are saved as places that "Take me somewhere" follows.

    python3 helix.py              # helix.json (about 3.8 MB of smooth vector paths)
    node helix_preview.js <dir>   # contact sheet + deep-zoom crops of each hidden path
    python3 build_helix_rows.py   # hbatch*.sql
    python3 apply_helix.py        # replace the film on the live canvas (Supabase management API)
