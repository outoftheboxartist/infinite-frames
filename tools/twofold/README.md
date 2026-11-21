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
