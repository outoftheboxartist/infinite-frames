# Infinite Frames: decisions

A dated record of what is decided, what is still open, and why. Newest first. Change a
decision by adding a new entry, not by editing an old one.

## 2026-11-20: the stack, and where the app lives

**Decided by the founder**

- **Hosting: Vercel.** The app must be shareable as a normal web link, outside claude.ai.
- **Sign-in: Google**, through Supabase Auth.
- **Database, files and live drawing: Supabase**, reusing the existing project
  `xqfevafhjbdulhcqcmao` (set up during the ChatGPT work), not a new one.
- **Live drawing:** everyone sees each stroke as it is drawn, with the drawer's name and photo.
- **GitHub is the single source of truth.** claude.ai artifacts, ChatGPT builds and other
  experiments are reference copies; nothing is canonical until it is in this repo.

**How it is built (`web/`)**

- A small readable app (Vite, plain JavaScript, `@supabase/supabase-js`) in `web/`.
- The canvas is the Foveated Zoom engine, ported nearly unchanged from the prototype:
  nested 1000x1000 canvases every 8x zoom (so depth never runs out of precision), detail
  that thins out away from your finger, and the prism edge shader. It was the fastest of the
  engines tested. Nested Lab's anchor camera is the next candidate if shapes inside shapes
  need it.
- Live strokes and pointers travel over Supabase Realtime **broadcast** (about 20 batches a
  second, nothing written to the database). **Presence** carries who is here. Finished strokes
  will be saved to the database once the tables in `supabase/migrations/` are reviewed and
  applied.

**Why**

- The claude.ai app cannot leave claude.ai: its database, identity and hosting are claude.ai's.
  Its source exists only as a minified file, so it can't be moved onto Supabase safely.
- Reusing the existing Supabase project keeps the earlier work and its data in one place.
  New tables are separate from the existing `if_shared_*` and `if_guest_test_worlds` tables;
  nothing existing is changed.

**Kept as reference, not deleted**

- `app/index.html`: the claude.ai main app, synced byte for byte with the live artifact
  (claude.ai/artifact/KY2rRser7qDWzVvYQjSMzT) on 2026-11-20. This is the "verified Claude
  baseline" that `CLAUDE_BASELINE.md` (on the guest-test branch) asked for.
- `app-foveated/`: IF Main (Foveated), the claude.ai app with the Foveated engine bolted on.
- Other branches: `rebuild/source`, `feature/guest-test-profiles-supabase-20261114` (PR #6),
  `engine/v2-spatial-foundation`, `feature/canvas-engine-transplant-20261117`, the hub.
  Features worth keeping get ported into `web/` one at a time from a checklist.

**Still open (founder decides)**

1. The root artwork: prism and rainbow, the 17-region glitch root, or Yin n Yang.
2. Who can close a frame and open the next, and when.
3. Whether frames are global, per scene, or per region.
4. What a screenshot with unknown rights looks like inside the artwork.
5. Whether existing claude.ai canvas data is copied into Supabase (recommended: yes, with credits).

## Order of work

1. Decisions file (this). **Done.**
2. `web/` app on Vercel with Google sign-in and live strokes. **Built; Google needs switching on.**
3. Database design in `supabase/migrations/`. **Written, not applied.**
4. Turn on Google sign-in (founder: Google Cloud client, then Supabase settings).
5. Save finished strokes and curves; prove it on two phones after refresh.
6. Port features from the checklist: closed curves and Publish, frames and onion skin,
   tracing, places, chat and votes, replay, the 3D box.
7. Move the claude.ai canvas (Yin n Yang frames, curves, credits) into Supabase.
8. Screenshot contributions with separate submitter and creator credit.
9. Five-person test on real phones.
