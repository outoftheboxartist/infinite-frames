// Pure metadata index. The geometry never has to be in a worker or spatial index.
export function intersects(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
export function contains(outer, inner) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}
class Quad {
  constructor(bounds, depth = 0) { this.bounds = bounds; this.depth = depth; this.items = []; this.children = null; }
  subdivide() {
    const b = this.bounds, mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
    this.children = [
      new Quad({ minX: b.minX, minY: b.minY, maxX: mx, maxY: my }, this.depth + 1),
      new Quad({ minX: mx, minY: b.minY, maxX: b.maxX, maxY: my }, this.depth + 1),
      new Quad({ minX: b.minX, minY: my, maxX: mx, maxY: b.maxY }, this.depth + 1),
      new Quad({ minX: mx, minY: my, maxX: b.maxX, maxY: b.maxY }, this.depth + 1)
    ];
    const items = this.items; this.items = [];
    for (const item of items) this.insert(item);
  }
  insert(item) {
    if (this.children) {
      const child = this.children.find(c => contains(c.bounds, item.bbox));
      if (child) { child.insert(item); return; }
    }
    this.items.push(item);
    if (!this.children && this.items.length > 28 && this.depth < 11) this.subdivide();
  }
  query(rect, out) {
    if (!intersects(this.bounds, rect)) return;
    for (const item of this.items) if (intersects(item.bbox, rect)) out.push(item);
    if (this.children) for (const child of this.children) child.query(rect, out);
  }
}
export class SpatialIndex {
  constructor(metadata) {
    this.metadata = metadata;
    this.byId = new Map(metadata.map(n => [n.id, n]));
    const extent = metadata.reduce((b, n) => ({
      minX: Math.min(b.minX, n.bbox.minX), minY: Math.min(b.minY, n.bbox.minY),
      maxX: Math.max(b.maxX, n.bbox.maxX), maxY: Math.max(b.maxY, n.bbox.maxY)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    if (!metadata.length) Object.assign(extent, { minX: 0, minY: 0, maxX: 1000, maxY: 1000 });
    const span = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY, 1);
    this.root = new Quad({ minX: extent.minX, minY: extent.minY, maxX: extent.minX + span, maxY: extent.minY + span });
    for (const node of metadata) this.root.insert(node);
  }
  query(rect, worldPerPixel, minPixels = 2) {
    const hits = []; this.root.query(rect, hits);
    const visible = hits.filter(n => {
      const b = n.bbox;
      return Math.max(b.maxX - b.minX, b.maxY - b.minY) / worldPerPixel >= minPixels;
    }).sort((a, b) => a.depth - b.depth || a.order - b.order);
    return { ids: visible.map(n => n.id), candidates: hits.length, culledByLOD: hits.length - visible.length };
  }
}
export function lineage(byId, id) {
  const out = [], visited = new Set();
  let node = byId.get(id);
  while (node && !visited.has(node.id)) {
    visited.add(node.id); out.push(node.id);
    node = node.parentId ? byId.get(node.parentId) : null;
  }
  return out;
}
export function relatedTo(byId, id, selected) {
  if (!selected) return true;
  const a = lineage(byId, id), b = lineage(byId, selected);
  return a.includes(selected) || b.includes(id) || (!!byId.get(id)?.parentId && byId.get(id)?.parentId === byId.get(selected)?.parentId);
}
