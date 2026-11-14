import { SpatialIndex } from "./spatial.js";
let index = new SpatialIndex([]);
self.onmessage = event => {
  const { type, id, nodes, rect, worldPerPixel, minPixels } = event.data;
  try {
    if (type === "init") {
      index = new SpatialIndex(nodes);
      self.postMessage({ type: "ready", id, count: nodes.length });
    } else if (type === "query") {
      const t = performance.now();
      const data = index.query(rect, worldPerPixel, minPixels);
      self.postMessage({ type: "result", id, ...data, queryMs: +(performance.now() - t).toFixed(2) });
    }
  } catch (error) {
    self.postMessage({ type: "error", id, message: error.message || String(error) });
  }
};
