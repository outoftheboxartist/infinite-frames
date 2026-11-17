# Nested engine lab

A standalone, readable-source prototype of the Infinite Frames world as an
infinitely nested set of SVG shapes with real-time collaboration. Read
[ARCHITECTURE.md](ARCHITECTURE.md) for how it works and what was measured.

It does **not** touch `app/index.html`, the production `if_shared_*` tables or
the guest sandbox. It uses its own `if_lab_*` tables.

## Run it

Needs Node 20+ and Postgres 15+ (local, Docker or a Supabase project).

```bash
cd lab/nested-engine
npm install
```

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/nested_lab
```

```bash
npm run seed
```

`npm run seed` creates the tables and fills them with the dummy world: 100,704
shapes, 45 levels deep, including a 20,000-star galaxy and the five yin-yang
frames from `yin-yang-svg/` imported as real paths. It takes about 4 seconds
and wipes previous `if_lab_*` data.

```bash
npm start
```

Open http://localhost:8787 in two windows to see live collaboration.

Without a server, open `public/index.html` from any static host (or add
`?mode=demo`): the same world is generated in the browser, and edits sync
between tabs of that browser.

## Test and benchmark

```bash
npm test
```

14 tests: math, deep-zoom precision, conflict resolution, SVG import,
validation, and a two-client end-to-end run through the server and Postgres
(skipped automatically when no seeded database is reachable).

```bash
npm run bench
```

Runs with the server already started. Drives a real Chromium through the
overview, the 44-level dive, the galaxy and a crowd of 15 simulated editors,
and prints frame-time and latency numbers.

## Controls

| Action | Mouse / keyboard | Touch |
|---|---|---|
| Pan | drag, arrow keys | one-finger drag |
| Zoom | scroll, `+` / `-`, double-click | pinch (two fingers also rotate) |
| Modes | `1` Explore, `2` Edit, `3` Draw | bottom dock |
| Select / cycle overlapping shapes | Edit mode, click (again) | tap (again) |
| Move / scale-rotate / reshape | drag shape / round handle / points | same |
| Fly to selection, whole world | `F`, `H` | dock, top buttons |
| Follow someone | click their avatar | tap their avatar |

## Files

| Path | What it is |
|---|---|
| `public/src/camera.js` | Anchor-relative camera, rebasing, riding animated regions |
| `public/src/renderer.js` | Culling, adaptive detail, spatial grid, region tiles, deep-zoom path clipping |
| `public/src/scene.js`, `sync.js` | Client store, optimistic edits, per-field conflict resolution, outbox |
| `public/src/net-ws.js`, `net-local.js` | Live server backend, in-browser demo backend (same interface) |
| `public/src/seedgen.js`, `svgimport.js` | Deterministic dummy world, SVG path import |
| `public/src/app.js` | Input, editing tools, presence, camera flights, HUD |
| `server/` | Realtime relay + batched Postgres writes + validation |
| `sql/schema.sql` | Tables, trigger, ancestor RPC, Supabase RLS notes |
