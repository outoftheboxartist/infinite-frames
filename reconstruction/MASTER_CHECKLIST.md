# Infinite Frames — Master Build Checklist

**Branch:** `rebuild/source` | **Reference:** Claude artifact on `inthebox`

Status: `[x]` verified completed action; `[ ]` not yet completed or not verified. A feature mentioned in the existing app's handoff is **not** checked until we test it in the reconstructed build.

## 0. Project safety and tracking
- [x] Preserve original Claude version on `inthebox`
- [x] Create isolated `rebuild/source` branch
- [x] Commit reconstruction plan (`reconstruction/README.md`)
- [x] Create this master checklist
- [ ] Establish repeatable local build with editable source files
- [ ] Configure separate development database/room and read-only default
- [ ] Add test and rollback procedure

## 1. Rebuild the foundation — P0
- [ ] Reconstruct readable React source from behavior of compiled artifact
- [ ] Load five supplied fish SVG frames in an offline 2D canvas
- [ ] Match mobile pinch zoom, pan and viewport constraints
- [ ] Implement smooth 2D-to-3D box transition on continued zoom-out
- [ ] Render stacked frame layers efficiently, orbit and explode controls
- [ ] Verify touch rotation doesn't overwrite path simplification function
- [ ] Mobile performance smoke test, including heavy SVGs

## 2. Artwork creation and geometry — P0
- [ ] Draw and edit closed SVG boundaries
- [ ] Split self-intersecting drawn curves into valid regions
- [ ] Select region with visible outline and update floating profile shape
- [ ] Add shapes, images, vectors, strokes and text
- [ ] Move/rotate/scale while drafting; lock geometry after Publish
- [ ] Clip imported artwork to its selected boundary
- [ ] Convert imported images to simplified closed curves, without repeated trace prompt
- [ ] Provide threshold, palette and trace simplification controls
- [ ] Undo/cancel before Publish; preserve published attribution

## 3. Frames, animation and history — P0/P1
- [ ] Implement open vs published frame states
- [ ] Publish new frames without altering earlier published frames
- [ ] Onion-skin neighboring frames
- [ ] Replay and timeline of contributions
- [ ] Support frame-to-frame continuity and contributor attribution
- [ ] Evaluate scanimation/parallax experiments as a separate module, not a blocker

## 4. Mobile navigation and visual language — P1
- [ ] Floating profile controller with current selected closed-curve outline
- [ ] Drag near LEFT edge: Consume panel
- [ ] Drag near RIGHT edge: Create panel
- [ ] Drag near TOP edge: Profile panel
- [ ] Drag near BOTTOM edge: Chat/Ideas/Voting panel
- [ ] Panels fade in near edge; profile hides inside open panel; small glowing return handle
- [ ] Keep controls compact and canvas visible
- [ ] Use minimal glass/refraction UI where appropriate without slowing rendering
- [ ] Restore intentional zoom-out reveal of 3D box

## 5. Collaboration and collective intelligence — P1
- [ ] Profile and identity settings; color selection
- [ ] Shared live canvas synchronization and conflict handling
- [ ] Anchored comments, replies and likes
- [ ] Agree/disagree/propose alternative voting
- [ ] Rank ideas using broad cross-preference agreement, with transparent criteria
- [ ] 'Advise me' and 'Take me somewhere' navigation
- [ ] Saved locations with viewport, name and comments
- [ ] Versioned Living Blueprint: proposed vs accepted rules and attribution
- [ ] Prism intake for new ideas and categorization

## 6. Release and operations — P1
- [ ] Reconcile authentication strategy (Google sign-in / existing Clerk)
- [ ] Decide production backend and migrate safely from Claude storage
- [ ] Export/import and backup shared artwork
- [ ] Add accessible error reporting and diagnostics
- [ ] Test on Android and iOS mobile viewports
- [ ] Prepare preview deployment on separate URL
- [ ] Review pull request before merging to `inthebox`

## Current known issues from HANDOFF.md
- [ ] Imported images remain images after trace acceptance instead of becoming curves
- [ ] Need batch image import, spreading images apart
- [ ] Need clear/reset frames with confirmation and backup
- [ ] Heavy curve sets can make panning slow

## Definition of done
Only mark a feature `[x]` after implementation **and** an observable test in the development build. Add test evidence or commit link in the PR. Keep live data untouched unless explicitly approved.

## Suggested next task
**P0-1:** Create an editable, offline read-only React/Vite preview that renders the five existing fish SVGs. Test its mobile zoom and pan. This is the first actual code milestone.
