import { supabase } from "./supabase.js";

// Live drawing over Supabase Realtime:
//  - Broadcast carries strokes as they are drawn: a start message, then batches of points
//    about 20 times a second, then an end. Nothing here is written to the database.
//  - Presence carries who is here (name, photo, ink colour) and where their pointer is.
// Saving finished strokes comes with the database tables (see supabase/migrations).

const CHANNEL = "if-world-root";
const FLUSH_MS = 50;

export function startLive(engine, getProfile, getInk, onPeople) {
  const me = () => getProfile();
  const channel = supabase.channel(CHANNEL, {
    config: { broadcast: { self: false, ack: false }, presence: { key: me().id } },
  });

  // ---- outgoing strokes, batched
  const pending = new Map(); // sid -> [x,y,...]
  let flushTimer = 0;
  function flush() {
    flushTimer = 0;
    for (const [sid, pts] of pending) {
      if (pts.length) channel.send({ type: "broadcast", event: "pts", payload: { sid, p: pts.splice(0) } });
    }
  }
  const hooks = {
    start(s) {
      pending.set(s.sid, []);
      channel.send({ type: "broadcast", event: "start", payload: { ...s, by: me().name } });
    },
    point(sid, x, y) {
      const q = pending.get(sid); if (!q) return;
      q.push(+x.toFixed(3), +y.toFixed(3));
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
    },
    end(sid) {
      flush(); pending.delete(sid);
      channel.send({ type: "broadcast", event: "end", payload: { sid } });
    },
    cursor(node, x, y) {
      const now = performance.now();
      if (now - curSentAt < 90) return;
      curSentAt = now;
      channel.send({ type: "broadcast", event: "cur", payload: { id: me().id, node, x: +x.toFixed(2), y: +y.toFixed(2) } });
    },
  };
  let curSentAt = 0;
  // other people's pointers: id -> {node, x, y, t}
  const cursors = new Map();
  channel.on("broadcast", { event: "cur" }, ({ payload: c }) => {
    if (c && typeof c.id === "string" && typeof c.node === "string") cursors.set(c.id, { node: c.node, x: c.x, y: c.y, t: performance.now() });
  });

  // ---- incoming strokes
  channel.on("broadcast", { event: "start" }, ({ payload }) => engine().remoteStart(payload));
  channel.on("broadcast", { event: "pts" }, ({ payload }) => payload && engine().remotePoints(payload.sid, payload.p));
  channel.on("broadcast", { event: "end" }, ({ payload }) => payload && engine().remoteEnd(payload.sid));

  // ---- presence: who is here (identity only; pointers travel as broadcast above)
  let lastSent = "";
  let people = [];
  channel.on("presence", { event: "sync" }, () => {
    const st = channel.presenceState();
    people = Object.values(st).map((arr) => arr[arr.length - 1]).filter(Boolean);
    onPeople(people);
  });
  let joined = false;
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") { joined = true; await track(true); }
  });
  async function track(force) {
    if (!joined) return;
    const p = me();
    const body = { id: p.id, name: p.name, avatar: p.avatar, ink: getInk() };
    const s = JSON.stringify(body);
    if (!force && s === lastSent) return;
    lastSent = s;
    try { await channel.track(body); } catch (e) {}
  }
  return { hooks, retrack: () => track(true), peopleNow: () => people, cursors };
}
