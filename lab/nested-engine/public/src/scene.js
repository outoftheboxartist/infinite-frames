// Client-side scene store: the subset of the world that's loaded, plus the
// bookkeeping that keeps real-time collaboration glitch-free.
//
// Consistency model (per-field last-writer-wins, ordered by the server):
//  - Every change gets a monotonically increasing sequence number (seq) from
//    the server. Node snapshots carry `v` = seq of their last change.
//  - Your own edits apply instantly (optimistic). While a field has an
//    unacknowledged local edit, remote values for that field are parked in a
//    "shadow" instead of applied, so what you're dragging never jitters.
//  - When the server acks your edit with its seq, any parked remote value with
//    a higher seq wins and is applied. Everyone converges to the same state.

import { invalidateShape } from "./geom.js";

export const PATCH_FIELDS = ["x", "y", "s", "r", "pts", "rings", "smooth", "rule", "fill", "anim", "clip", "ord", "tag"];
const SHAPE_FIELDS = new Set(["pts", "rings", "smooth"]);

export class Scene {
  constructor() {
    this.nodes = new Map();
    this.kids = new Map(); // parentId -> node[] sorted by ord
    this.loadedKids = new Set(); // parents whose full child list is loaded
    this.kidsVersion = new Map(); // parentId -> int, bumps on child add/move/remove
    this.pending = new Map(); // id -> Map(field -> cid | "out")
    this.shadow = new Map(); // id -> Map(field -> {value, seq})
    this.lastSeen = new Map(); // id -> ms (for eviction)
  }

  get(id) { return this.nodes.get(id); }
  get size() { return this.nodes.size; }

  childrenOf(id) { return this.kids.get(id) || EMPTY; }

  bump(parentId) {
    if (parentId == null) return;
    this.kidsVersion.set(parentId, (this.kidsVersion.get(parentId) || 0) + 1);
  }

  _link(n) {
    if (n.parent == null) return;
    let arr = this.kids.get(n.parent);
    if (!arr) this.kids.set(n.parent, (arr = []));
    // insert keeping ord order (ties: id)
    let i = arr.length;
    while (i > 0 && cmp(arr[i - 1], n) > 0) i--;
    arr.splice(i, 0, n);
    this.bump(n.parent);
  }

  _unlink(n) {
    const arr = n.parent != null && this.kids.get(n.parent);
    if (!arr) return;
    const i = arr.indexOf(n);
    if (i >= 0) arr.splice(i, 1);
    this.bump(n.parent);
  }

  _resort(n) {
    const arr = this.kids.get(n.parent);
    if (arr) arr.sort(cmp);
  }

  // Snapshot from a load. Older snapshots never overwrite newer state.
  addNodes(list, loadedParents = []) {
    for (const raw of list) {
      const cur = this.nodes.get(raw.id);
      if (!cur) {
        const n = { ...raw };
        this.nodes.set(n.id, n);
        this._link(n);
        continue;
      }
      if ((cur.v || 0) > (raw.v || 0)) continue;
      const pend = this.pending.get(raw.id);
      const set = {};
      for (const f of PATCH_FIELDS) if (!(pend && pend.has(f)) && f in raw) set[f] = raw[f];
      this._assign(cur, set);
      cur.v = raw.v;
      cur.nchild = raw.nchild;
    }
    for (const p of loadedParents) {
      this.loadedKids.add(p);
      const n = this.nodes.get(p);
      if (n) n.nchild = Math.max(n.nchild || 0, this.childrenOf(p).length);
    }
  }

  _assign(n, set) {
    let shape = false;
    for (const k in set) {
      if (SHAPE_FIELDS.has(k)) shape = true;
      n[k] = set[k];
    }
    if (shape) invalidateShape(n);
    if ("fill" in set || "anim" in set) { n._hsl = undefined; n._dot = undefined; }
    this.bump(n.parent); // cached grids/region images of the parent are now stale
    if ("ord" in set) this._resort(n);
  }

  // ---- remote ops ------------------------------------------------------------
  applyRemote(op, seq) {
    if (op.kind === "create") {
      const cur = this.nodes.get(op.node.id);
      if (cur && (cur.v || 0) >= seq) return;
      if (cur) { this._assign(cur, op.node); cur.v = seq; return; }
      const n = { ...op.node, v: seq };
      const parent = this.nodes.get(n.parent);
      if (!parent) return; // not loaded here; it'll arrive with a later load
      this.nodes.set(n.id, n);
      this._link(n);
      parent.nchild = (parent.nchild || 0) + 1;
    } else if (op.kind === "patch") {
      const n = this.nodes.get(op.id);
      if (!n) return;
      const pend = this.pending.get(op.id);
      const set = {};
      for (const f of PATCH_FIELDS) {
        if (!(f in op.set)) continue;
        if (pend && pend.has(f)) {
          let sh = this.shadow.get(op.id);
          if (!sh) this.shadow.set(op.id, (sh = new Map()));
          sh.set(f, { value: op.set[f], seq });
        } else set[f] = op.set[f];
      }
      this._assign(n, set);
      n.v = Math.max(n.v || 0, seq);
    } else if (op.kind === "delete") {
      this.removeSubtree(op.id);
    }
  }

  // ---- local ops ---------------------------------------------------------------
  localPatch(id, set) {
    const n = this.nodes.get(id);
    if (!n) return false;
    let pend = this.pending.get(id);
    if (!pend) this.pending.set(id, (pend = new Map()));
    for (const f in set) pend.set(f, "out");
    this._assign(n, set);
    return true;
  }

  localCreate(node) {
    const parent = this.nodes.get(node.parent);
    const n = { ...node };
    this.nodes.set(n.id, n);
    this._link(n);
    if (parent) parent.nchild = (parent.nchild || 0) + 1;
    return n;
  }

  // Called by sync when a batch of fields leaves for the server under `cid`.
  markSent(id, fields, cid) {
    const pend = this.pending.get(id);
    if (!pend) return;
    for (const f of fields) if (pend.has(f)) pend.set(f, cid);
  }

  ack(id, fields, cid, seq) {
    const n = this.nodes.get(id);
    if (n) n.v = Math.max(n.v || 0, seq);
    const pend = this.pending.get(id);
    if (!pend) return;
    const sh = this.shadow.get(id);
    const apply = {};
    for (const f of fields) {
      if (pend.get(f) !== cid) continue; // a newer local edit is still in flight
      pend.delete(f);
      const parked = sh && sh.get(f);
      if (parked) {
        if (parked.seq > seq) apply[f] = parked.value;
        sh.delete(f);
      }
    }
    if (!pend.size) this.pending.delete(id);
    if (sh && !sh.size) this.shadow.delete(id);
    if (n && Object.keys(apply).length) this._assign(n, apply);
  }

  removeSubtree(id) {
    const root = this.nodes.get(id);
    if (!root) return 0;
    const parent = this.nodes.get(root.parent);
    this._unlink(root);
    if (parent) parent.nchild = Math.max(0, (parent.nchild || 1) - 1);
    let count = 0;
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      for (const c of this.childrenOf(n.id)) stack.push(c);
      this.kids.delete(n.id);
      this.loadedKids.delete(n.id);
      this.nodes.delete(n.id);
      this.pending.delete(n.id);
      this.shadow.delete(n.id);
      count++;
    }
    return count;
  }

  // Drop the children of parents not seen recently, to cap memory. Never drops
  // anything on `keep` (ancestor chain), selected, or with pending edits.
  evict(maxNodes, keep, now, idleMs = 20000) {
    if (this.nodes.size <= maxNodes) return 0;
    const victims = [];
    for (const p of this.loadedKids) {
      if (keep.has(p)) continue;
      const seen = this.lastSeen.get(p) || 0;
      if (now - seen > idleMs) victims.push([seen, p]);
    }
    victims.sort((a, b) => a[0] - b[0]);
    let dropped = 0;
    for (const [, p] of victims) {
      if (this.nodes.size <= maxNodes * 0.8) break;
      const kids = this.childrenOf(p).slice();
      if (kids.some((k) => keep.has(k.id) || this.pending.has(k.id))) continue;
      for (const k of kids) dropped += this.removeSubtree(k.id);
      this.loadedKids.delete(p);
      const n = this.nodes.get(p);
      if (n) n.nchild = Math.max(n.nchild || 0, kids.length);
    }
    return dropped;
  }
}

const EMPTY = Object.freeze([]);

function cmp(a, b) {
  return a.ord - b.ord || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
