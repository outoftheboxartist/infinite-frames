// In-browser demo backend: no server needed. Generates the same deterministic
// world as the database seed, lazily, as you zoom. Edits are shared live between
// tabs of the same browser via BroadcastChannel and kept in localStorage.
// Used for the hosted preview, and as an offline fallback.

import { rootNode, genChildren, makeCtx, childCount, MAX_DEPTH } from "./seedgen.js";

const STORE_KEY = "if-nested-lab-edits-v1";

export class LocalBackend {
  constructor(user, { svgBase = "svg/" } = {}) {
    this.user = user;
    this.kind = "demo";
    this.ready = false;
    this.rtt = 0;
    this.svgBase = svgBase;
    this.known = new Map(); // base (generated) nodes by id
    this.edits = { patch: {}, created: {}, deleted: {} };
    this.seq = 0;
    this.requested = new Set();
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) this.edits = JSON.parse(raw); } catch {}
  }

  async connect(h) {
    this.h = h;
    h.onStatus && h.onStatus("connecting");
    const texts = await Promise.all([1, 2, 3, 4, 5].map((i) => fetch(this.svgBase + "frame-" + i + ".svg").then((r) => (r.ok ? r.text() : null)).catch(() => null)));
    this.ctx = makeCtx(texts);
    const root = rootNode();
    this.known.set(root.id, root);
    try {
      this.bc = new BroadcastChannel("if-nested-lab");
      this.bc.onmessage = (ev) => this.onPeer(ev.data);
      this.bc.postMessage({ t: "hello", user: this.user });
    } catch {}
    this.ready = true;
    h.onStatus && h.onStatus("demo");
    h.onWelcome && h.onWelcome({ clientId: this.user.id, now: Date.now(), users: [] });
  }

  onPeer(m) {
    const h = this.h;
    if (m.t === "op") { this.record(m.op, m.seq); h.onOp(m.op, m.seq, m.by); }
    else if (m.t === "presence") h.onPresence && h.onPresence(m.p);
    else if (m.t === "leave") h.onLeave && h.onLeave(m.id);
    else if (m.t === "hello") this.bc.postMessage({ t: "presence", p: this.lastPresence || { id: this.user.id, name: this.user.name, color: this.user.color } });
  }

  nextSeq() {
    // Lamport-ish: wall clock in microseconds, strictly increasing per tab
    this.seq = Math.max(this.seq + 1, Date.now() * 1000);
    return this.seq;
  }

  materialize(base) {
    const p = this.edits.patch[base.id];
    return p ? { ...base, ...p.set, v: p.seq } : { ...base };
  }

  childrenFor(parentId) {
    if (parentId === null) return [this.materialize(this.known.get("root"))];
    const parent =this.known.get(parentId) || this.createdNode(parentId);
    if (!parent) return [];
    const gen = parent.by === "seed" ? genChildren(parent, this.ctx) : [];
    for (const c of gen) this.known.set(c.id, c);
    const createdList = Object.values(this.edits.created);
    const extra = new Map();
    for (const c of createdList) extra.set(c.node.parent, (extra.get(c.node.parent) || 0) + 1);
    const created = createdList.filter((c) => c.node.parent === parentId).map((c) => ({ ...c.node, v: c.seq }));
    const all = gen.concat(created).filter((n) => !this.edits.deleted[n.id]);
    return all.map((n) => {
      const out = this.materialize(n);
      out.nchild = (n.by === "seed" ? childCount(n, this.ctx) : 0) + (extra.get(n.id) || 0);
      return out;
    });
  }

  createdNode(id) {
    const c = this.edits.created[id];
    return c ? c.node : null;
  }

  load(ids) {
    const fresh = ids.filter((id) => !this.requested.has(id));
    if (!fresh.length) return 0;
    for (const id of fresh) this.requested.add(id);
    setTimeout(() => {
      for (const id of fresh) {
        const nodes = this.childrenFor(id);
        // stream big regions in pages, like the server does
        for (let i = 0; i < nodes.length; i += 1500) {
          const last = i + 1500 >= nodes.length;
          this.h.onNodes(nodes.slice(i, i + 1500), last ? [id] : []);
        }
        if (!nodes.length) this.h.onNodes([], [id]);
        this.requested.delete(id);
      }
    }, 0);
    return fresh.length;
  }

  inflightLoads() { return this.requested.size; }

  loadPath(id) {
    const chain = [];
    let n = this.known.get(id) || this.createdNode(id);
    while (n) { chain.push(this.materialize(n)); n = n.parent ? this.known.get(n.parent) || this.createdNode(n.parent) : null; }
    if (chain.length) this.h.onNodes(chain, []);
  }

  // Deepest node: follow a spine all the way down (generates the chain).
  async deepest() {
    const root = this.known.get("root");
    const queue = [root];
    while (queue.length) {
      const n = queue.shift();
      if (n.depth > 3) break;
      for (const c of genChildren(n, this.ctx)) { this.known.set(c.id, c); if (c.tag === "spine") return this.followSpine(c); if (c.tag === "reg" && c.depth <= 2) queue.push(c); }
    }
    return null;
  }

  followSpine(n) {
    while (n.depth < MAX_DEPTH + 1) {
      const kids = genChildren(n, this.ctx);
      for (const c of kids) this.known.set(c.id, c);
      const next = kids.find((c) => c.tag === "spine") || kids[0];
      if (!next) break;
      n = next;
    }
    return n.id;
  }

  record(op, seq) {
    const e = this.edits;
    if (op.kind === "create") e.created[op.node.id] = { node: op.node, seq };
    else if (op.kind === "patch") {
      if (e.created[op.id]) Object.assign(e.created[op.id].node, op.set), (e.created[op.id].seq = seq);
      else e.patch[op.id] = { set: { ...(e.patch[op.id] ? e.patch[op.id].set : {}), ...op.set }, seq };
    } else if (op.kind === "delete") {
      e.deleted[op.id] = 1;
      delete e.created[op.id];
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.edits)); } catch {} }, 400);
  }

  sendOp(op, cid) {
    const seq = this.nextSeq();
    this.record(op, seq);
    try { this.bc && this.bc.postMessage({ t: "op", op, seq, by: this.user.id }); } catch {}
    queueMicrotask(() => this.h.onAck(cid, seq));
  }

  sendPresence(p) {
    this.lastPresence = p;
    try { this.bc && this.bc.postMessage({ t: "presence", p }); } catch {}
  }

  reset() {
    try { localStorage.removeItem(STORE_KEY); } catch {}
  }

  now() { return Date.now(); }
}
