// Synthetic test data only. Every source path remains unmodified regardless of LOD.
export function createDemoWorld(target = 14000) {
  target = Math.max(1, Math.min(50000, Math.floor(target)));
  const nodes = [];
  let rng = 0x1f22026;
  const random = () => ((rng = (Math.imul(1664525, rng) + 1013904223) >>> 0) / 4294967296);
  const pathFor = (x, y, radius, seed) => {
    const pieces = [];
    const sides = 20;
    const phase = seed * 1.61803398875;
    for (let j = 0; j < sides; j++) {
      const a = j * Math.PI * 2 / sides;
      const k = 0.94 + 0.045 * Math.cos(5 * a + phase) + 0.015 * Math.sin(3 * a - phase);
      const xx = (x + Math.cos(a) * radius * k).toFixed(4);
      const yy = (y + Math.sin(a) * radius * k).toFixed(4);
      pieces.push((j ? "L" : "M") + xx + " " + yy);
    }
    return pieces.join("") + "Z";
  };
  const add = (x, y, r, parentId, depth, index) => {
    const id = "sample-" + nodes.length;
    const hue = (190 + depth * 42 + index * 19 + random() * 17) % 360;
    const color = depth === 0 ? "#131823" : "hsl(" + hue.toFixed(0) + " " + (depth < 3 ? 66 : 70) + "% " + Math.min(69, 29 + depth * 7) + "%)";
    const extent = r * 1.03;
    nodes.push({
      id, parentId, kind: "boundary", name: depth === 0 ? "The shared world" : "Framelet " + String(nodes.length).padStart(5, "0"),
      author: depth === 0 ? "Infinite Frames demo" : "Synthetic contributor",
      frame: 1, order: nodes.length, depth, color, x, y, r,
      bbox: { minX: x - extent, minY: y - extent, maxX: x + extent, maxY: y + extent },
      path: pathFor(x, y, r, index + depth * 3)
    });
    return id;
  };
  add(500, 500, 470, null, 0, 0);
  // Breadth-first subdivision. Geometric descendants stay inside their parents.
  for (let i = 0; i < nodes.length && nodes.length < target; i++) {
    const parent = nodes[i];
    if (parent.depth >= 8) continue;
    const count = parent.depth === 0 ? 6 : 5;
    const phase = parent.depth === 0 ? -Math.PI / 6 : random() * Math.PI * 2;
    for (let j = 0; j < count && nodes.length < target; j++) {
      const a = phase + j * 2 * Math.PI / count;
      const childR = parent.r * (0.207 + random() * 0.016);
      const orbit = parent.r * (parent.depth === 0 ? 0.575 : 0.57);
      add(parent.x + Math.cos(a) * orbit, parent.y + Math.sin(a) * orbit, childR, parent.id, parent.depth + 1, j + i);
    }
  }
  return nodes;
}
