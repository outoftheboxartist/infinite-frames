import { SpatialIndex, lineage, relatedTo } from "./spatial.js";
export class Scene {
  constructor() {
    this.nodes = []; this.byId = new Map(); this.children = new Map();
    this.pathCache = new Map(); this.worker = null; this.index = null;
    this.pending = new Map(); this.nextRequest = 0; this.version = 0;
    this.workerMode = false; this.ready = false;
  }
  async setWorld(nodes) {
    this.version++;
    const current = this.version;
    this.worker?.terminate();
    for (const [,resolve] of this.pending) resolve({ids:[],candidates:0,culledByLOD:0,stale:true});
    this.pending.clear(); this.worker = null; this.index = null; this.ready = false;
    this.nodes = nodes;
    this.byId = new Map(nodes.map(n => [n.id, n]));
    this.children = new Map();
    for (const node of nodes) {
      if (!node.parentId) continue;
      const siblings = this.children.get(node.parentId) || [];
      siblings.push(node.id); this.children.set(node.parentId, siblings);
    }
    this.pathCache.clear();
    const metadata = nodes.map(n => ({ id: n.id, parentId: n.parentId, depth: n.depth, order: n.order, bbox: n.bbox }));
    try {
      if (typeof Worker === "undefined") throw Error("Worker unavailable");
      const worker = new Worker(new URL("./index-worker.js", import.meta.url), { type: "module" });
      this.worker = worker;
      await new Promise((resolve, reject) => {
        let finished = false;
        const fallback = message => {
          if (finished) return; finished = true; reject(Error(message));
        };
        worker.onmessage = event => {
          const d = event.data;
          if (d.type === "ready" && d.id === current) {
            if (finished) return; finished = true; resolve();
          } else if (d.type === "result" || d.type === "error") {
            const callback = this.pending.get(d.id);
            if (callback) { this.pending.delete(d.id); callback(d.type === "error" ? {ids:[],candidates:0,culledByLOD:0,error:d.message} : d); }
          }
        };
        worker.onerror = event => fallback(event.message || "Worker failed");
        worker.postMessage({ type: "init", id: current, nodes: metadata });
      });
      this.workerMode = true;
    } catch (error) {
      this.worker?.terminate(); this.worker = null;
      console.warn("Spatial worker unavailable; using main-thread index", error);
      this.index = new SpatialIndex(metadata);
      this.workerMode = false;
    }
    this.ready = true;
  }
  async query(rect, worldPerPixel) {
    if (!this.ready) return {ids:[],candidates:0,culledByLOD:0};
    if (!this.worker) {
      const t = performance.now(), result = this.index.query(rect, worldPerPixel, 1.8);
      return {...result, queryMs: +(performance.now()-t).toFixed(2)};
    }
    const id = ++this.nextRequest;
    return new Promise(resolve => {
      this.pending.set(id,resolve);
      this.worker.postMessage({ type: "query", id, rect, worldPerPixel, minPixels: 1.8 });
    });
  }
  path(id) {
    if (this.pathCache.has(id)) return this.pathCache.get(id);
    const node = this.byId.get(id);
    if (!node) return null;
    const path = new Path2D(node.path);
    this.pathCache.set(id, path);
    if (this.pathCache.size > 1800) this.pathCache.delete(this.pathCache.keys().next().value);
    return path;
  }
  lineage(id) { return lineage(this.byId,id); }
  related(id, selected) { return relatedTo(this.byId,id,selected); }
  childCount(id) { return (this.children.get(id)||[]).length; }
  destroy() { this.worker?.terminate(); this.worker=null; this.pending.clear(); }
}
