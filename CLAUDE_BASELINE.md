# Infinite Frames | Canonical Claude Baseline Policy

**Status: NOT YET VERIFIED.** The owner has explicitly directed all future development to use the **newest cloud-connected Claude artifact** as the core application. Do not treat the ChatGPT preview, V2 speed-test UI, or any current GitHub branch as a proven replacement for that Claude source until the latest actual Claude artifact has been inspected.

## Evidence on record (2026-11-20)

- Canonical GitHub repository: https://github.com/outoftheboxartist/infinite-frames
- The repo's default branch is `inthebox`; its `app/index.html` is an older compiled artifact (verified by source inspection).
- The repo's `README.md` on `inthebox` links to this **older Claude artifact candidate**: https://claude.ai/artifact/KY2rRser7qDWzVvYQjSMzT
- `HANDOFF.md` on `inthebox` says that artifact's shared database works **when running on claude.ai**, while its outside-Claude preview falls back to browser-local storage.
- A branch named `claude/fast-curve-rendering-ml-k7b1qo` exists; its `app/index.html` has the same blob SHA as `inthebox` and has no observed direct Supabase client configuration. It is **not confirmed to be the user's current, newest cloud-connected Claude artifact**.
- ChatGPT's active guest-test implementation is on `feature/guest-test-profiles-supabase-20261114`, tracked in PR #6. It uses a **separate Supabase sandbox table**. This does not establish it is newer or better than the live Claude app.
- The assistant was unable to inspect the Claude live artifact because direct page retrieval failed and the connected browser wasn't available in this chat context.
- The newest Claude link/version/export must be verified by the owner or via accessible source before consolidation. Do not assume the archived Nov 13 link is current.

## Mandatory source-of-truth protocol for all agents (Claude, ChatGPT, Gemini, etc.)

1. **Before any future feature implementation**, identify the latest **working cloud-connected Claude version**, inspect its actual source, and verify the cloud persistence and collaboration flow.
2. Preserve that verified app's original visual design, interaction rules, artwork data, profile controls, frame workflows, clipping behavior, cloud connections and publishing. Do not replace the app with the V2 benchmark UI.
3. Commit the verified Claude artifact source into a clearly named, separate GitHub baseline branch (with the owner's approval). Add source artifact URL, SHA, capture date, the cloud backend and what was actually tested.
4. Diff optional ChatGPT improvements (spatial index, hit testing, guest testing, mobile share-target, metadata/provenance) against that baseline and port **only compatible, validated improvements** through PRs. Never blindly overwrite.
5. Use GitHub branch heads and pull requests as the shared synchronization channel. Claude and ChatGPT **do not** automatically read each other's private work or notice commits. Each assistant must fetch GitHub fresh before a work session and push work explicitly.
6. No force-push to the verified baseline, merges to production, changes to production permissions, or irreversible data migrations without the owner's explicit approval.
7. Current metadata extraction and phone share-target discussion is **planning only** until the Claude baseline is verified. An empty experimental branch is not the authoritative app.

## How to complete verification

The owner can supply the URL of the **most recently edited Claude Artifact**, or export that current artifact's full source. The previously archived URL alone is **not sufficient** to certify it is the latest app. Record that reference here and only then promote a verified baseline.

## Why this matters

The source of truth is the **verified running artwork**, not whichever assistant made the most recent commit. Preserve existing working functionality, protect shared art and cloud state, and consolidate deliberately.
