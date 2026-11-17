// Outbox between the scene and a backend. Local edits apply to the scene
// instantly; the network sees them coalesced at most every `interval` ms
// (a drag at 120 Hz becomes ~30 small patches per second). Unacknowledged ops
// are re-sent after a reconnect; every op is idempotent on the server.

export class Sync {
  constructor(scene, backend, { interval = 33 } = {}) {
    this.scene = scene;
    this.backend = backend;
    this.interval = interval;
    this.outbox = []; // ordered ops not yet sent
    this.inflight = new Map(); // cid -> {op, fields, at}
    this.cid = 0;
    this.lastFlush = 0;
    this.stats = { sent: 0, acked: 0, rttAck: 0 };
  }

  patch(id, set) {
    if (!this.scene.localPatch(id, set)) return;
    // coalesce with the newest queued op for the same node (look back a little)
    for (let i = this.outbox.length - 1; i >= 0 && i >= this.outbox.length - 32; i--) {
      const op = this.outbox[i];
      if (op.kind === "delete" && op.id === id) return;
      if (op.kind === "patch" && op.id === id) { Object.assign(op.set, set); return; }
      if (op.kind === "create" && op.node.id === id) { Object.assign(op.node, set); return; }
    }
    this.outbox.push({ kind: "patch", id, set: { ...set } });
  }

  create(node) {
    const n = this.scene.localCreate(node);
    this.outbox.push({ kind: "create", node: strip(node) });
    return n;
  }

  remove(id) {
    this.outbox = this.outbox.filter((op) => !((op.kind === "patch" && op.id === id) || (op.kind === "create" && op.node.id === id)));
    this.scene.removeSubtree(id);
    this.outbox.push({ kind: "delete", id });
  }

  flush(now, force = false) {
    if (!this.outbox.length) return;
    if (!force && now - this.lastFlush < this.interval) return;
    if (!this.backend.ready) return;
    this.lastFlush = now;
    const ops = this.outbox;
    this.outbox = [];
    for (const op of ops) {
      const cid = ++this.cid;
      let fields = [];
      if (op.kind === "patch") {
        fields = Object.keys(op.set);
        this.scene.markSent(op.id, fields, cid);
      } else if (op.kind === "create") {
        // edits made before the create left are folded into it
        const pend = this.scene.pending.get(op.node.id);
        fields = pend ? [...pend.keys()].filter((f) => pend.get(f) === "out") : [];
        this.scene.markSent(op.node.id, fields, cid);
      }
      this.inflight.set(cid, { op, fields, at: now });
      this.backend.sendOp(op, cid);
      this.stats.sent++;
    }
  }

  onAck(cid, seq) {
    const f = this.inflight.get(cid);
    if (!f) return;
    this.inflight.delete(cid);
    this.stats.acked++;
    this.stats.rttAck = performance.now() - f.at;
    const id = f.op.kind === "create" ? f.op.node.id : f.op.id;
    this.scene.ack(id, f.fields, cid, seq);
  }

  onReject(cid) {
    // Server refused (validation). Drop pending markers so remote state wins.
    const f = this.inflight.get(cid);
    if (!f) return;
    this.inflight.delete(cid);
    const id = f.op.kind === "create" ? f.op.node.id : f.op.id;
    this.scene.ack(id, f.fields, cid, Number.MAX_SAFE_INTEGER);
  }

  // After a reconnect: resend everything not yet acknowledged, in order.
  resend() {
    const list = [...this.inflight.entries()].sort((a, b) => a[0] - b[0]);
    for (const [cid, f] of list) this.backend.sendOp(f.op, cid);
  }
}

function strip(n) {
  const out = {};
  for (const k in n) if (k[0] !== "_") out[k] = n[k];
  return out;
}
