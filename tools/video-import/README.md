# Video to traced frames

How the IF logo video became frames 1-10 on the live canvas (2026-11-20).

1. Pick frames spread across the clip (one every 12 video frames at 24 fps):
   `ffmpeg -i video.mp4 -vf "select='not(mod(n\,12))'" -vsync vfr -frames:v 10 spread/s%02d.png`
2. `node trace-frames.js` (needs `web/dist` built): traces each frame with the app's own tracer, using
   one 12-colour palette taken from the logo's bright pixels (plus black, which is dropped), then crops
   the traced regions into nested curves with the same code as uploads (`window.__ifNested`).
   Writes `traced.json`.
3. `python3 build_docs.py`: simplifies outlines (tolerance 0.15 canvas units, under one source pixel)
   and writes SQL batches for `public.ifm_docs`: one shared parent curve ("IF logo"), per frame the
   coloured artwork plus its own curves (`frameOnly: true`, shown only in that frame), frame records
   (1-9 published, 10 open), activity lines and one saved place. Credit and owner are set at the top.
4. Run each batch through the Supabase SQL editor or management API.
