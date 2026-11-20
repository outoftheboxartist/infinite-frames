import { createClient } from "@supabase/supabase-js";

// The existing Infinite Frames Supabase project. The publishable key is meant to ship in
// browser code; what it may do is limited by the project's row-level security rules.
// Override both with VITE_SUPABASE_URL / VITE_SUPABASE_KEY (for example on Vercel).
const URL = import.meta.env.VITE_SUPABASE_URL || "https://xqfevafhjbdulhcqcmao.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_olDMWJAdn9VYjJLK9E29eA_BOIANXmO";

export const supabase = createClient(URL, KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 30 } },
});

// Ask the project whether Google sign-in is switched on before redirecting, so a project
// without it shows a clear message instead of an error page.
export async function googleEnabled() {
  try {
    const r = await fetch(URL + "/auth/v1/settings", { headers: { apikey: KEY } });
    const s = await r.json();
    return !!(s && s.external && s.external.google);
  } catch (e) { return null; } // unknown: let the redirect try
}

export async function signInWithGoogle() {
  if ((await googleEnabled()) === false) throw new Error("provider is not enabled");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Who this person is on the canvas: their Google name and photo when signed in,
// otherwise a guest name kept in this browser.
export function profileFrom(session) {
  const u = session && session.user;
  if (u) {
    const md = u.user_metadata || {};
    return {
      id: u.id,
      name: (md.full_name || md.name || (u.email || "").split("@")[0] || "Someone").slice(0, 40),
      avatar: md.avatar_url || md.picture || "",
      guest: false,
    };
  }
  let g = null;
  try { g = JSON.parse(localStorage.getItem("if-guest") || "null"); } catch (e) {}
  if (!g || !g.id) {
    g = { id: "guest-" + Math.random().toString(36).slice(2, 10), name: "Guest " + Math.floor(100 + Math.random() * 900) };
    try { localStorage.setItem("if-guest", JSON.stringify(g)); } catch (e) {}
  }
  return { id: g.id, name: g.name, avatar: "", guest: true };
}
