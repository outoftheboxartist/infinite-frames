import "./engine.css";
import "./app.css";
import { createEngine } from "./engine.js";
import { supabase, signInWithGoogle, signOut, profileFrom } from "./supabase.js";
import { startLive } from "./live.js";

const $ = (id) => document.getElementById(id);
let session = null;
let profile = profileFrom(null);
let ink = "#f2efe6";

// the engine needs its hooks at creation; live.js needs the engine, so pass a getter
let engine = null;
const live = startLive(() => engine, () => profile, () => ink, renderPeople);
engine = createEngine(live.hooks);

// keep our own copy of the chosen ink for presence
for (const b of document.querySelectorAll("#sw button")) b.addEventListener("click", () => { ink = b.dataset.c; live.retrack(); });

/* ---------- account: Google sign-in ---------- */
const GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

function note(text, ms = 6000) {
  const n = $("note"); n.textContent = text; n.hidden = false;
  clearTimeout(note.t); note.t = setTimeout(() => { n.hidden = true; }, ms);
}

function renderAccount() {
  const el = $("account");
  el.textContent = "";
  if (profile.guest) {
    const b = document.createElement("button");
    b.className = "signin"; b.type = "button";
    b.innerHTML = GOOGLE + "<span>Sign in with Google</span>";
    b.addEventListener("click", async () => {
      try { await signInWithGoogle(); }
      catch (e) {
        const msg = String(e && e.message || e);
        note(/provider is not enabled|Unsupported provider/i.test(msg)
          ? "Google sign-in isn't switched on for this project yet. You can still draw as " + profile.name + "."
          : "Couldn't start Google sign-in: " + msg);
      }
    });
    el.appendChild(b);
  } else {
    const wrap = document.createElement("div"); wrap.className = "me";
    wrap.appendChild(avatar(profile, 28));
    const name = document.createElement("span"); name.textContent = profile.name; wrap.appendChild(name);
    const out = document.createElement("button"); out.type = "button"; out.textContent = "Sign out";
    out.addEventListener("click", () => signOut());
    wrap.appendChild(out);
    el.appendChild(wrap);
  }
}

function avatar(p, size) {
  if (p.avatar) {
    const img = document.createElement("img"); img.src = p.avatar; img.alt = p.name || ""; img.referrerPolicy = "no-referrer";
    img.width = size; img.height = size; img.className = "av"; img.style.setProperty("--c", p.ink || "#f2efe6");
    return img;
  }
  const d = document.createElement("div"); d.className = "av"; d.style.setProperty("--c", p.ink || "#f2efe6");
  d.style.background = p.ink || "#f2efe6"; d.textContent = (p.name || "?").trim().charAt(0).toUpperCase();
  d.title = p.name || ""; return d;
}

/* ---------- who is here, and their pointers ---------- */
let people = [];
function renderPeople(list) {
  people = list;
  const el = $("here"); el.textContent = "";
  const others = list.filter((p) => p.id !== profile.id);
  for (const p of others.slice(0, 6)) el.appendChild(avatar(p, 24));
  const count = document.createElement("span");
  count.textContent = list.length <= 1 ? "just you" : list.length + " here";
  el.appendChild(count);
}
const peerEls = new Map();
function tickPeers() {
  requestAnimationFrame(tickPeers);
  const seen = new Set();
  for (const p of people) {
    const c = live.cursors.get(p.id);
    if (p.id === profile.id || !c || !engine || performance.now() - c.t > 6000) continue;
    const s = engine.toScreen(c.node, c.x, c.y);
    let el = peerEls.get(p.id);
    if (!el) {
      el = document.createElement("div"); el.className = "peer";
      el.innerHTML = "<i></i><span></span>"; $("peers").appendChild(el); peerEls.set(p.id, el);
    }
    el.querySelector("i").style.background = p.ink || "#f2efe6";
    el.querySelector("span").textContent = p.name || "Someone";
    const vis = s && s.x > -20 && s.y > -20 && s.x < innerWidth + 20 && s.y < innerHeight + 20 && s.size > 32;
    el.style.display = vis ? "flex" : "none";
    if (vis) el.style.transform = `translate(${s.x - 4}px,${s.y - 4}px)`;
    seen.add(p.id);
  }
  for (const [id, el] of peerEls) if (!seen.has(id)) { el.remove(); peerEls.delete(id); }
}
requestAnimationFrame(tickPeers);

/* ---------- session ---------- */
function setSession(s) {
  session = s;
  profile = profileFrom(s);
  renderAccount();
  live.retrack();
}
supabase.auth.getSession().then(({ data }) => setSession(data.session));
supabase.auth.onAuthStateChange((_evt, s) => setSession(s));

// errors from a returning Google redirect show up in the address
const q = new URLSearchParams(location.search + "&" + location.hash.slice(1));
if (q.get("error_description")) note("Sign-in didn't finish: " + q.get("error_description"));
