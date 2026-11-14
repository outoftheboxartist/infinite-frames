# Infinite Frames: Shared Supabase Spatial Engine v1
Status: **Deployed test build, authenticated browser end-to-end acceptance pending.**
Canonical test URL: https://infinite-frames-rebuild-preview-outoftheboxartists-projects.vercel.app
Development branch: `rebuild/source`. Original branch `inthebox` preserved.

## What is built and deployed

- Cloud Sync sign-in form in Profile and the overflow menu.
- Email/password sign-in and sign-up; emailed sign-in/verification code support (requires Supabase Auth provider and redirect configuration).
- No service-role key in browser. Only a publishable project key is embedded. RLS restricts writes to authenticated contributors.
- New isolated `if_shared_nodes`, `if_shared_frames`, `if_shared_messages` and `if_shared_votes` database tables, all with RLS. Original `if3d_*` and `if_spatial_*` tables remain unchanged.
- Private `if-shared-bundles` immutable full SVG data uploads. Public **published** metadata and published geometry can be read through RLS. Separate private `if-shared-originals` image uploads restricted to the uploader.
- Each publication splits its complete SVGs into bounded immutable JSON bundles (target ~1.5 MB; individual large shape up to ~45 MB, without compression or simplification). Metadata rows point to exact bundle offsets. Database rows publish with one bulk POST.
- Public search by curve name prefix, contributor name prefix and color prefix; indexed distinct color palette. No full SVG fetch required to search.
- Viewport query is indexed by GiST bounding boxes, filtered by frame and zoom-dependent visible size. Results are paged rather than assuming the first few hundred are the whole scene.
- Exact geometry bundles are fetched for relevant metadata only; three concurrent fetches and bounded memory cache.
- Browser IndexedDB caches recent immutable bundles (max 48) and recent viewport metadata (max 50). Cloud outage falls back to previously cached local artwork and exact cached bundles where usable.
- Local-first response (short cloud wait) lets the canvas draw without blocking on network. Shared geometry arrives asynchronously and updates the viewport.
- 3D can generate a coarse frame texture from visible shared SVGs on demand. Original vectors remain unchanged; server-rendered hierarchical tile snapshots remain future work.
- New shared contributions are mirrored into the existing local IndexedDB when possible. A failed local mirror no longer causes the app to misreport a successful cloud upload.

## Important limitations

1. Live end-to-end Supabase authentication, Storage upload, cross-device rendering, and Auth redirect behavior require a real user's device test. Mock network and RLS permission checks do not validate the entire deployed authentication provider configuration.
2. Shared cloud tables were empty when initialized; **older artwork saved in a phone or computer's local browser is NOT automatically uploaded to Supabase**. This avoids publishing demo content or misattributing historical contributions. Only new authenticated publications will be shared. An explicit, reviewed migration workflow is a separate feature.
3. The browser cache is not a complete offline replica. A region can be loaded offline if both its metadata and full geometry were previously cached; unrelated places need network access.
4. The current 3D overview is a derived limited-resolution preview; it is NOT the full vector scene. Selecting or zooming into a region returns to exact 2D SVG data.
5. Dense wide views intentionally omit subpixel details until zoomed. Remote viewport loads have a memory/record cap (up to 2,600 in normal deep views; request can be raised). Guaranteeing unbounded simultaneous interactive visible paths will require WebGL/WebGPU tile batching, not a single huge SVG DOM.
6. The client currently checks for new cloud publications on a foreground 14-second poll. Full websocket Realtime awareness, live presence and instantaneous remote voting/chat updates are not yet finished.
7. Google login and account-synced profile pictures are not configured. Email/password or email code sign-in comes first.
8. Very large individual geometry records near the Supabase file limit are rejected without modification, not silently downsampled. Multipart file support is a later feature.

## Acceptance test

1. On the phone, open the stable address. Confirm the canvas loads and the Prism triangle can be selected.
2. Open **Profile → Connect Shared Canvas**. Create/sign into an email account. If email confirmation arrives, verify it then return to the same URL and sign in.
3. Select a curve, import/trace a small test image, move/scale the SVG, publish and name the creation. Confirm no publish error.
4. On a computer, open the **same stable address** in a separate browser and use Cloud Sync (sign-in optional for read). The new published piece should appear at the relevant location and in Find Curve, with the same SVG colors, name and exact paths.
5. Reload the computer, search by name/color/contributor and visit that region. Repeat on phone. Check responsiveness in low-memory Android.
6. Test failed network publication: disconnect network before final Publish and verify drafts remain editable; only successful cloud publication should clear drafts.
7. Compare broad and deep zoom. Existing original images and SVG paths should not be replaced by newly compressed versions or gray overlays.

## Architecture follow-up

- Verify Auth site URL / redirect allowlist in Supabase Auth and enable Google provider when ready.
- Add multi-device profile identity and avatar sync.
- Add authenticated, attribution-preserving transfer of selected older local contributions.
- Move 3D thumbnail generation to versioned server tile snapshots for unlimited world growth.
- Add Realtime change subscriptions / shared presence and better recovery for offline authored changes.
- Measure device memory, viewport latency and network bytes under 10k/100k+ nested regions.
