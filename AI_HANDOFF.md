> **IMPORTANT SOURCE-OF-TRUTH UPDATE (2026-11-20):** The owner has designated the **newest, verified cloud-connected Claude artifact** as the intended Infinite Frames foundation. We have **not yet verified its latest source or deployment**. Read [CLAUDE_BASELINE.md](CLAUDE_BASELINE.md) before making code changes. The GitHub guest-test branch is a **development reference, not an approved replacement or verified Claude baseline**. Do not begin a new app or port features until the latest Claude version is obtained, compared, and confirmed.

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
