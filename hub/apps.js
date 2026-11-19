// Seed data for the Infinite Frames whiteboard hub.
// Edit here (or on the page, then "Export JSON" and paste back in) to change the board.
// status keys follow the whiteboard grid: if, test, ui, perfect, users, frames
//   values: 0 = not yet, 1 = in progress / partly, 2 = works ✓
// links: ids of apps this one stitches into (draws a line in Web view).

window.HUB_PLATFORMS = [
  { id: "vercel", label: "Vercel", note: "Main · production home", main: true },
  { id: "claude", label: "Claude artifacts", note: "claude.ai pages" },
  { id: "github", label: "GitHub folders", note: "outoftheboxartist/infinite-frames" },
  { id: "chatgpt", label: "ChatGPT sites", note: "Paste links with + Add app" },
  { id: "aistudio", label: "Google AI Studio", note: "Paste links with + Add app" }
];

window.HUB_COLUMNS = [
  { id: "if", label: "If" },
  { id: "test", label: "Test" },
  { id: "ui", label: "UI" },
  { id: "perfect", label: "Perfect" },
  { id: "users", label: "Users" },
  { id: "frames", label: "Frames" }
];

const REPO = "https://github.com/outoftheboxartist/infinite-frames";
const VC = "https://vercel.com/outoftheboxartists-projects/";

window.HUB_APPS = [
  // ---------- Vercel ----------
  {
    id: "if-engine", platform: "vercel", name: "Infinite Frames · Engine",
    url: "https://infinite-frames-engine.vercel.app",
    code: REPO + "/tree/feature/canvas-engine-transplant-20261117",
    dash: VC + "infinite-frames-engine", shot: "shots/infinite-frames-engine.jpg",
    date: "2026-11-17",
    features: "Original app with the nested canvas engine: map-style tile cache, lab-style navigation, shared guest test world, 3D box.",
    status: { if: 2, test: 1, ui: 2, perfect: 1, users: 1, frames: 2 },
    links: ["if-artifact", "if-rebuild", "if-nested-lab"]
  },
  {
    id: "if-rebuild", platform: "vercel", name: "Rebuild Preview",
    url: "https://infinite-frames-rebuild-preview.vercel.app",
    code: REPO + "/tree/feature/guest-test-profiles-supabase-20261114",
    dash: VC + "infinite-frames-rebuild-preview", shot: "shots/infinite-frames-rebuild-preview.jpg",
    date: "2026-11-14",
    features: "Guest test profiles on Supabase, cloud save, offline reset, single-SVG publish.",
    status: { if: 2, test: 2, ui: 1, perfect: 0, users: 2, frames: 1 },
    links: ["if-engine"]
  },
  {
    id: "if-v2-integration", platform: "vercel", name: "Spatial Engine V2 · Integration",
    url: "https://infinite-frames-v2-integration.vercel.app",
    code: REPO + "/tree/feature/v2-real-world-renderer",
    dash: VC + "infinite-frames-v2-integration", shot: "shots/infinite-frames-v2-integration.jpg",
    date: "2026-11-14",
    features: "V2 renderer reading the real world read-only; published geometry storage.",
    status: { if: 2, test: 1, ui: 1, perfect: 0, users: 0, frames: 1 },
    links: ["if-engine-v2"]
  },
  {
    id: "if-engine-v2", platform: "vercel", name: "Spatial Engine V2",
    url: "https://infinite-frames-engine-v2.vercel.app",
    code: REPO + "/tree/engine/v2-spatial-foundation",
    dash: VC + "infinite-frames-engine-v2", shot: "shots/infinite-frames-engine-v2.jpg",
    date: "2026-11-14",
    features: "Spatial foundation: relationship-based opacity, one world infinite detail, speed/stats HUD.",
    status: { if: 2, test: 1, ui: 1, perfect: 0, users: 0, frames: 0 },
    links: ["if-spatial"]
  },
  {
    id: "if-spatial", platform: "vercel", name: "Inside the Box (Spatial)",
    url: "https://infinite-frames-spatial.vercel.app",
    code: "", dash: VC + "infinite-frames-spatial", shot: "shots/infinite-frames-spatial.jpg",
    date: "2026-11-11",
    features: "Unfolded-box navigation: the canvas as the floor of the IF box with PROFILE / EXPLORE walls.",
    status: { if: 2, test: 0, ui: 2, perfect: 0, users: 0, frames: 0 },
    links: ["if-box"]
  },
  {
    id: "if-ui-shape", platform: "vercel", name: "UI Shape Test",
    url: "https://if-floating-profile-ux-test.vercel.app",
    code: "", dash: VC + "if-floating-profile-ux-test", shot: "shots/if-floating-profile-ux-test.jpg",
    date: "2026-11-10",
    features: "Floating profile UX test: rotated frame window with an orb at the centre.",
    status: { if: 2, test: 1, ui: 2, perfect: 0, users: 0, frames: 0 },
    links: ["if-engine"]
  },
  {
    id: "v0-drawing-project", platform: "vercel", name: "v0 Collaborative Drawing (project)",
    url: "https://v0-collaborative-drawing-project.vercel.app",
    code: "", dash: VC + "v0-collaborative-drawing-project", shot: "shots/v0-collaborative-drawing-project.jpg",
    date: "2025-12-14",
    features: "Early v0 build: draw mode, brush/eraser size, name + submit drawing.",
    status: { if: 2, test: 0, ui: 1, perfect: 0, users: 0, frames: 0 },
    links: ["if-playground"]
  },
  {
    id: "v0-drawing-app", platform: "vercel", name: "v0 Collaborative Drawing (app)",
    url: "https://v0-collaborative-drawing-app.vercel.app",
    code: "", dash: VC + "v0-collaborative-drawing-app", shot: "shots/v0-collaborative-drawing-app.jpg",
    date: "2025-12-14",
    features: "Sibling v0 build: brush size, colour, canvas, your name.",
    status: { if: 2, test: 0, ui: 1, perfect: 0, users: 0, frames: 0 },
    links: ["v0-drawing-project"]
  },
  {
    id: "magic-portfolio", platform: "vercel", name: "Magic Portfolio (template)",
    url: "https://magic-portfolio-for-next-js-iota-rust.vercel.app",
    code: "https://github.com/outoftheboxartist/magic-portfolio-for-next-js",
    dash: VC + "magic-portfolio-for-next-js", shot: "shots/magic-portfolio-for-next-js.jpg",
    date: "2025-04-18",
    features: "Next.js portfolio template, still showing the template's sample content. Latest build failed.",
    status: { if: 1, test: 0, ui: 1, perfect: 0, users: 0, frames: 0 },
    links: []
  },
  {
    id: "v0-in-the-box", platform: "vercel", name: "v0 In The Box MVP",
    url: "", code: "", dash: VC + "v0-in-the-box-mvp-app", shot: "",
    date: "2025-12-30", features: "Project exists but has no deployment yet.",
    status: { if: 0, test: 0, ui: 0, perfect: 0, users: 0, frames: 0 }, links: ["if-box"]
  },
  {
    id: "v0-collab-art", platform: "vercel", name: "v0 Collaborative Art",
    url: "", code: "", dash: VC + "v0-collaborative-art-project", shot: "",
    date: "2025-04-14", features: "Project exists but has no deployment yet.",
    status: { if: 0, test: 0, ui: 0, perfect: 0, users: 0, frames: 0 }, links: []
  },
  {
    id: "v0-test", platform: "vercel", name: "v0 Test",
    url: "", code: "", dash: VC + "v0-test", shot: "",
    date: "2025-04-14", features: "Project exists but has no deployment yet.",
    status: { if: 0, test: 0, ui: 0, perfect: 0, users: 0, frames: 0 }, links: []
  },

  // ---------- Claude artifacts ----------
  {
    id: "if-artifact", platform: "claude", name: "Infinite Frames (live)",
    url: "https://claude.ai/artifact/KY2rRser7qDWzVvYQjSMzT",
    code: REPO + "/blob/main/app/index.html", shot: "shots/repo-app-local-preview.jpg",
    date: "2026-11-17",
    features: "The shared living canvas: frames, boundaries, Publish & Lock, chat, 3D box with exploded layers.",
    status: { if: 2, test: 2, ui: 2, perfect: 1, users: 2, frames: 2 },
    links: ["if-repo-app"]
  },
  {
    id: "if-nested-lab", platform: "claude", name: "Nested Lab",
    url: "https://claude.ai/artifact/XE2WrAHu9xCPdTdWaKmuYZ", code: "", shot: "",
    date: "2026-11-17", features: "Experiments with nested zoom; its engine was moved into the Engine build.",
    status: { if: 2, test: 1, ui: 1, perfect: 0, users: 0, frames: 1 }, links: ["foveated-zoom"]
  },
  {
    id: "scanimation-box", platform: "claude", name: "Scanimation Box",
    url: "https://claude.ai/artifact/APLYtBk5adQ7EFvo5gH3k1",
    code: REPO + "/blob/main/scanimation/index.html", shot: "shots/repo-scanimation.jpg",
    date: "2026-11-19",
    features: "Print layers for a physical shadow box: any slit angle, multi-directional zones, two-axis tilt preview.",
    status: { if: 2, test: 1, ui: 2, perfect: 1, users: 0, frames: 2 }, links: ["scanimation-repo"]
  },
  {
    id: "foveated-zoom", platform: "claude", name: "Foveated Zoom",
    url: "https://claude.ai/artifact/PfnF7xLT52Wcu6hzNNLWDj", code: "", shot: "",
    date: "2026-11-15", features: "Zoom detail test.",
    status: { if: 1, test: 0, ui: 0, perfect: 0, users: 0, frames: 0 }, links: ["if-engine-v2"]
  },
  {
    id: "if-playground", platform: "claude", name: "Infinite Frames Playground",
    url: "https://claude.ai/artifact/EeDpyzAcbKfyCkKKbbF5Mi",
    code: REPO + "/blob/main/index.html", shot: "shots/repo-playground.jpg",
    date: "2026-11-12", features: "Older separate version with the 3D logo box model.",
    status: { if: 2, test: 0, ui: 1, perfect: 0, users: 0, frames: 1 }, links: ["if-artifact"]
  },
  {
    id: "if-box", platform: "claude", name: "IF Box",
    url: "https://claude.ai/artifact/ULYqYECVT3rRqwWe3cJu9m", code: "", shot: "",
    date: "2026-11-11", features: "Box concept.",
    status: { if: 1, test: 0, ui: 0, perfect: 0, users: 0, frames: 0 }, links: ["if-artifact"]
  },
  {
    id: "ui-artifact", platform: "claude", name: "ui",
    url: "https://claude.ai/artifact/UiECL3gJGS54bh7r1TgLYF", code: "", shot: "",
    date: "2026-11-12", features: "UI sketch.",
    status: { if: 1, test: 0, ui: 1, perfect: 0, users: 0, frames: 0 }, links: ["if-ui-shape"]
  },
  {
    id: "if-artifact-old", platform: "claude", name: "Infinite Frames (earlier copy)",
    url: "https://claude.ai/artifact/CTUvRkJnkrGG5evxL2TEbg", code: "", shot: "",
    date: "2026-11-12", features: "Earlier copy of the main artifact.",
    status: { if: 1, test: 0, ui: 0, perfect: 0, users: 0, frames: 0 }, links: ["if-artifact"]
  },

  // ---------- GitHub folders ----------
  {
    id: "if-repo-app", platform: "github", name: "app/ (main app source)",
    url: REPO + "/blob/main/app/local-preview.html", code: REPO + "/tree/main/app",
    shot: "shots/repo-app-local-preview.jpg", date: "2026-11-17",
    features: "Compiled bundle of the live artifact, offline preview, DB backup.",
    status: { if: 2, test: 1, ui: 2, perfect: 0, users: 0, frames: 2 }, links: []
  },
  {
    id: "scanimation-repo", platform: "github", name: "scanimation/",
    url: REPO + "/blob/main/scanimation/index.html", code: REPO + "/tree/main/scanimation",
    shot: "shots/repo-scanimation.jpg", date: "2026-11-19",
    features: "Scanimation Box source.",
    status: { if: 2, test: 1, ui: 2, perfect: 0, users: 0, frames: 2 }, links: []
  },
  {
    id: "yin-yang", platform: "github", name: "yin-yang-svg/",
    url: REPO + "/tree/main/yin-yang-svg", code: REPO + "/tree/main/yin-yang-svg",
    shot: "", date: "2026-11-12",
    features: "The five founding fish frames as standalone SVGs.",
    status: { if: 2, test: 0, ui: 0, perfect: 2, users: 0, frames: 2 }, links: ["if-artifact"]
  }
];
