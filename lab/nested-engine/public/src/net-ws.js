// WebSocket backend: talks to the lab server (server/server.mjs), which plays
// the roles Supabase Realtime (broadcast + presence) and PostgREST (queries)
// would play. One socket carries loads, ops, acks, presence and clock sync.
//
// Interface shared with LocalBackend:
//   connect(handlers) / load(parentIds) / loadPath(id) / sendOp(op, cid)
//   sendPresence(p) / now() / ready / kind
// handlers: onWelcome, onNodes(nodes, parents), onOp(op, seq, by), onAck(cid, seq),
//           onReject(cid, reason), onPresence(p), onLeave(id), onStatus(text)

export class WsBackend {
  constructor(url, user) {
    this.url = url;
    this.user = user;
    this.kind = "live";
    this.ready = false;
    this.offset = 0; // serverTime - localTime (ms)
    this.rtt = 0;
    this.retry = 0;
    this.requested = new Map(); // parentId -> ms
  }

  connect(h) {
    this.h = h;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    h.onStatus && h.onStatus("connecting");
    ws.onopen = () => {
      this.retry = 0;
      this.send({ t: "hello", user: this.user });
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 2000);
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      const wasReady = this.ready;
      this.ready = false;
      clearInterval(this.pingTimer);
      h.onStatus && h.onStatus("offline");
      this.requested.clear();
      const delay = Math.min(8000, 300 * 2 ** this.retry++);
      setTimeout(() => this.connect(h), delay);
      if (wasReady && h.onDisconnect) h.onDisconnect();
    };
    ws.onerror = () => {};
  }

  onMessage(m) {
    const h = this.h;
    switch (m.t) {
      case "welcome":
        this.ready = true;
        this.clientId = m.clientId;
        this.offset = m.now - Date.now();
        h.onStatus && h.onStatus("live");
        h.onWelcome && h.onWelcome(m);
        break;
      case "nodes":
        for (const p of m.parents || []) if (m.done !== false) this.requested.delete(p);
        h.onNodes(m.nodes, m.done === false ? [] : m.parents || []);
        break;
      case "op": h.onOp(m.op, m.seq, m.by); break;
      case "ack": h.onAck(m.cid, m.seq); break;
      case "reject": h.onReject && h.onReject(m.cid, m.reason); break;
      case "presence": h.onPresence && h.onPresence(m.p); break;
      case "leave": h.onLeave && h.onLeave(m.id); break;
      case "deepest": if (this._deep) { this._deep(m.id); this._deep = null; } break;
      case "pong": {
        const now = Date.now();
        const rtt = now - m.ct;
        this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
        const off = m.st - (m.ct + rtt / 2);
        this.offset = this.offset * 0.8 + off * 0.2;
        break;
      }
    }
  }

  send(m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  ping() { this.send({ t: "ping", ct: Date.now() }); }

  load(ids) {
    const now = Date.now();
    const fresh = ids.filter((id) => !(now - (this.requested.get(id) || 0) < 8000));
    if (!fresh.length) return 0;
    for (const id of fresh) this.requested.set(id, now);
    this.send({ t: "load", ids: fresh });
    return fresh.length;
  }

  inflightLoads() { return this.requested.size; }

  loadPath(id) { this.send({ t: "path", id }); }

  deepest() {
    return new Promise((resolve) => { this._deep = resolve; this.send({ t: "deepest" }); });
  }

  sendOp(op, cid) { this.send({ t: "op", op, cid }); }

  sendPresence(p) { this.send({ t: "presence", p }); }

  now() { return Date.now() + this.offset; }
}
