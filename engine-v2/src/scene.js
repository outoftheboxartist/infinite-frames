import { SpatialIndex, lineage, relatedTo } from "./spatial.js";
export class Scene {
  constructor() {
    this.nodes = []; this.byId = new Map(); this.children = new Map();
    this.pathCache = new Map(); this.imageCache = new Map(); this.worker = null; this.index = null; this.onAsset = null;
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
    this.pathCache.clear();this.imageCache.clear();
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
  path(id, pathIndex=-1) {
    const key=pathIndex<0?id:id+":"+pathIndex;
    if (this.pathCache.has(key)) {
      const existing=this.pathCache.get(key);
      this.pathCache.delete(key);this.pathCache.set(key,existing);
      return existing;
    }
    const node=this.byId.get(id);
    const source=pathIndex<0?node?.path:node?.artwork?.paths?.[pathIndex]?.d;
    if(typeof source!=="string"||!source)return null;
    let path;
    try{path=new Path2D(source)}catch(error){console.warn("Invalid SVG path",id,error);return null}
    this.pathCache.set(key,path);
    while(this.pathCache.size>1600)this.pathCache.delete(this.pathCache.keys().next().value);
    return path;
  }
  image(id) {
    const node=this.byId.get(id),src=node?.artwork?.src;
    if(!src || typeof src!=="string")return null;
    const existing=this.imageCache.get(id);
    if(existing)return existing.loaded?existing.image:null;
    // Only load images supplied by the immutable published record; no synthetic fallback.
    const image=new Image();
    const record={image,loaded:false,error:false};
    this.imageCache.set(id,record);
    image.crossOrigin="anonymous";
    image.onload=()=>{record.loaded=true;this.onAsset?.()};
    image.onerror=()=>{record.error=true;this.onAsset?.()};
    image.src=src;
    return null;
  }
  imageStatus(id) {return this.imageCache.get(id)?.error?"unavailable":this.imageCache.get(id)?.loaded?"ready":"loading"}
  lineage(id) { return lineage(this.byId,id); }
  related(id, selected) { return relatedTo(this.byId,id,selected); }
  childCount(id) { return (this.children.get(id)||[]).filter(id=>this.byId.get(id)?.kind==='boundary').length; }
  destroy() { this.worker?.terminate(); this.worker=null; this.pending.clear(); }
}
