/* Runs the Infinite Frames main app (the claude.ai artifact, unchanged) on Supabase.
 *
 * The main app asks window.claude.use(name) for "db", "room", "user" and "assets" as it
 * starts. An inline script in index.html creates window.claude with promises; this module
 * answers them from Supabase:
 *   db      documents in collections  -> table public.ifm_docs (+ Realtime for live updates)
 *   room    who is here               -> Realtime presence
 *   user    who you are               -> Supabase Auth (Google, or a guest session)
 *   assets  image uploads             -> Storage bucket ifm-assets
 * It also adds one small control: a sign-in button in the top-right corner.
 */
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL || "https://xqfevafhjbdulhcqcmao.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_olDMWJAdn9VYjJLK9E29eA_BOIANXmO";
const T = "ifm_docs";
const sb = createClient(URL, KEY, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const fail = (e) => {
  const m = (e && (e.message || e.details)) || "The shared canvas did not answer.";
  const err = new Error(/row-level security|permission denied|JWT/i.test(m) ? "Sign in to add to the shared canvas." : m);
  if (/too large|exceed/i.test(m)) err.code = "quota_exceeded";
  return err;
};
const split = (path) => { const i = path.indexOf("/"); return [path.slice(0, i), path.slice(i + 1)]; };
const snapDoc = (id, data) => ({ id, exists: data != null, data: () => data });
const atOf = (o) => (o && typeof o.at === "number" && isFinite(o.at) ? Math.round(o.at) : null);

/* ---------- db ---------- */
async function fetchAll(coll) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(T).select("id,data").eq("coll", coll).order("at", { ascending: true, nullsFirst: true }).range(from, from + 999);
    if (error) throw fail(error);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
async function fetchOne(coll, id) {
  const { data, error } = await sb.from(T).select("data").eq("coll", coll).eq("id", id).maybeSingle();
  if (error) throw fail(error);
  return data ? data.data : null;
}

function collection(coll) {
  const api = {
    orderBy() { return api; },
    async get() { return { docs: (await fetchAll(coll)).map((r) => snapDoc(r.id, r.data)) }; },
    onSnapshot(cb, onErr) {
      const map = new Map();
      let ready = false, alive = true;
      const queue = [];
      const emit = (changes) => {
        const docs = [...map.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0)).map(([id, d]) => snapDoc(id, d));
        cb({ docs, docChanges: () => changes });
      };
      const apply = async (p) => {
        const row = p.new && p.new.id ? p.new : p.old;
        if (!row || !row.id) return;
        if (p.eventType === "DELETE") {
          const old = map.get(row.id); map.delete(row.id);
          emit([{ type: "removed", doc: snapDoc(row.id, old || null) }]);
          return;
        }
        let data = p.new.data;
        if (!data || typeof data !== "object") data = await fetchOne(coll, row.id); // large rows arrive without their body
        if (!data) return;
        const had = map.has(row.id); map.set(row.id, data);
        emit([{ type: had ? "modified" : "added", doc: snapDoc(row.id, data) }]);
      };
      const ch = sb.channel("ifm-" + coll + "-" + Math.random().toString(36).slice(2, 8))
        .on("postgres_changes", { event: "*", schema: "public", table: T, filter: "coll=eq." + coll }, (p) => { if (!alive) return; ready ? apply(p) : queue.push(p); })
        .subscribe();
      fetchAll(coll).then(async (rows) => {
        if (!alive) return;
        for (const r of rows) map.set(r.id, r.data);
        ready = true;
        emit(rows.map((r) => ({ type: "added", doc: snapDoc(r.id, r.data) })));
        for (const p of queue.splice(0)) await apply(p);
      }, (e) => onErr && onErr(e));
      return () => { alive = false; sb.removeChannel(ch); };
    },
  };
  return api;
}

const db = {
  collection,
  doc(path) {
    const [coll, id] = split(path);
    return {
      async get() { return snapDoc(id, await fetchOne(coll, id)); },
      async set(obj) {
        const { error } = await sb.from(T).upsert({ coll, id, data: obj, at: atOf(obj), updated_at: new Date().toISOString() }, { onConflict: "coll,id" });
        if (error) throw fail(error);
      },
      async update(patch) {
        const { error } = await sb.rpc("ifm_merge", { p_coll: coll, p_id: id, p_patch: patch });
        if (error) throw fail(error);
      },
      async delete() {
        const { error } = await sb.from(T).delete().eq("coll", coll).eq("id", id);
        if (error) throw fail(error);
      },
    };
  },
};

/* ---------- user ---------- */
let session = null, isAdmin = false;
const user = {
  async id() { return session ? session.user.id : null; },
  async isOwner() { return isAdmin; },
  async canEdit() { return isAdmin; },
};

/* ---------- room (who is here) ---------- */
function makeRoom(key) {
  const ch = sb.channel("ifm-room", { config: { presence: { key } } });
  let joined = false, mine = null;
  const listeners = new Set();
  ch.on("presence", { event: "sync" }, () => {
    const peers = Object.values(ch.presenceState()).map((a) => ({ ...a[a.length - 1], kind: "viewer" }));
    listeners.forEach((f) => f({ peers }));
  });
  ch.subscribe((s) => { if (s === "SUBSCRIBED") { joined = true; if (mine) ch.track(mine); } });
  return {
    async presence(obj) { mine = obj || {}; if (joined) await ch.track(mine); },
    onPeers(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}

/* ---------- assets ---------- */
const assets = {
  async upload(file) {
    if (!session) throw new Error("Sign in to upload images.");
    const ext = ((file.name || "").split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
    const path = session.user.id + "/" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + "." + ext;
    const { error } = await sb.storage.from("ifm-assets").upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw error;
    return { id: path, url: sb.storage.from("ifm-assets").getPublicUrl(path).data.publicUrl };
  },
};

/* ---------- sign-in control ---------- */
const G = '<svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function toast(text) {
  let t = document.getElementById("ifm-toast");
  if (!t) {
    t = document.createElement("div"); t.id = "ifm-toast"; t.setAttribute("role", "status");
    t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 18px);z-index:9999;max-width:min(380px,calc(100vw - 32px));padding:9px 14px;border-radius:14px;background:rgba(236,238,242,.96);color:#000;font:600 12px Manrope,system-ui,sans-serif;text-align:center";
    document.body.appendChild(t);
  }
  t.textContent = text; t.hidden = false; clearTimeout(toast.k); toast.k = setTimeout(() => { t.hidden = true; }, 5000);
}
async function googleOn() {
  try { const r = await fetch(URL + "/auth/v1/settings", { headers: { apikey: KEY } }); const s = await r.json(); return !!(s.external && s.external.google); } catch (e) { return null; }
}
function control() {
  const b = document.createElement("button");
  b.type = "button";
  const signedIn = session && !session.user.is_anonymous;
  const md = signedIn ? session.user.user_metadata || {} : {};
  b.title = signedIn ? "Signed in as " + (md.full_name || md.name || "you") + ". Tap to sign out." : "Sign in with Google";
  b.setAttribute("aria-label", b.title);
  // phones: the canvas's top-right corner, clear of the app's top bar; wider screens: the window corner
  const top = innerWidth < 640 ? "calc(env(safe-area-inset-top,0px) + 134px)" : "calc(env(safe-area-inset-top,0px) + 8px)";
  b.style.cssText = "position:fixed;z-index:9998;top:" + top + ";right:max(8px,env(safe-area-inset-right,0px));height:32px;min-width:32px;padding:0 10px;border-radius:16px;border:1px solid rgba(255,255,255,.18);background:rgba(10,12,16,.82);color:#e9eaee;display:inline-flex;align-items:center;gap:6px;font:600 11px Manrope,system-ui,sans-serif;cursor:pointer";
  if (signedIn && (md.avatar_url || md.picture)) {
    const img = document.createElement("img"); img.src = md.avatar_url || md.picture; img.alt = ""; img.referrerPolicy = "no-referrer";
    img.style.cssText = "width:22px;height:22px;border-radius:50%;margin-left:-6px"; b.appendChild(img);
    b.style.padding = "0 10px 0 4px"; b.append("Sign out");
  } else if (signedIn) { b.textContent = "Sign out"; }
  else { b.innerHTML = G + "<span>Sign in</span>"; }
  b.onclick = async () => {
    if (signedIn) { await sb.auth.signOut(); location.reload(); return; }
    if ((await googleOn()) === false) { toast("Google sign-in isn't switched on yet."); return; }
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) toast("Couldn't start Google sign-in: " + error.message);
  };
  document.body.appendChild(b);
}

/* ---------- start ---------- */
(async () => {
  try { session = (await sb.auth.getSession()).data.session; } catch (e) { session = null; }
  if (!session) {
    // a guest session lets people save before Google is set up (if the project allows guests)
    try { const r = await sb.auth.signInAnonymously(); session = r.data && r.data.session || null; } catch (e) {}
  }
  if (session && !session.user.is_anonymous) {
    // show the Google name in the app's profile, unless the person already chose one
    const md = session.user.user_metadata || {};
    const name = (md.full_name || md.name || "").slice(0, 40);
    try {
      const cur = JSON.parse(localStorage.getItem("if-name") || "null");
      if (name && (!cur || /^artist-/.test(cur))) localStorage.setItem("if-name", JSON.stringify(name));
    } catch (e) {}
  }
  if (session) { try { isAdmin = !!(await sb.rpc("ifm_is_admin")).data; } catch (e) {} }
  const room = makeRoom(session ? session.user.id : "viewer-" + Math.random().toString(36).slice(2, 10));
  const api = { use: async (name) => ({ db, room, user, assets: session ? assets : null }[name] || null) };
  window.__ifShimReady(api);
  if (document.body) control(); else addEventListener("DOMContentLoaded", control);
  const q = new URLSearchParams(location.search + "&" + location.hash.slice(1));
  if (q.get("error_description")) toast("Sign-in didn't finish: " + q.get("error_description"));
})();
