import test from "node:test";
import assert from "node:assert/strict";
import { SpatialIndex, intersects, lineage, relatedTo } from "../src/spatial.js";
import { createDemoWorld } from "../src/model.js";
test("index returns exactly intersecting bounding boxes (before LOD)", () => {
  const nodes = createDemoWorld(4000), index = new SpatialIndex(nodes);
  const rect = { minX: 200, minY: 300, maxX: 460, maxY: 690 };
  const actual = index.query(rect, 0.00001).ids;
  const expected = nodes.filter(n => intersects(n.bbox, rect)).sort((a,b)=>a.depth-b.depth||a.order-b.order).map(n=>n.id);
  assert.deepEqual(actual, expected);
});
test("LOD only reduces rendering, not stored original curves", () => {
  const nodes = createDemoWorld(14000), index = new SpatialIndex(nodes);
  const all = index.query({minX:0,minY:0,maxX:1000,maxY:1000},0.01);
  const distant = index.query({minX:0,minY:0,maxX:1000,maxY:1000},4);
  assert.ok(distant.ids.length < all.ids.length);
  assert.equal(nodes.length, 14000);
  assert.equal(nodes.filter(n=>n.path.endsWith("Z")).length, 14000);
});
test("parent ancestry and selected-curve relations work", () => {
  const nodes = createDemoWorld(500), byId = new Map(nodes.map(n=>[n.id,n]));
  const leaf = nodes[75], parent = byId.get(leaf.parentId);
  assert.deepEqual(lineage(byId,leaf.id).slice(0,2),[leaf.id,parent.id]);
  assert.ok(relatedTo(byId, parent.id, leaf.id));
  assert.ok(relatedTo(byId, leaf.id, parent.id));
  assert.ok(!relatedTo(byId, nodes[2].id, nodes[1].id) || nodes[2].parentId===nodes[1].parentId);
});
test("empty worlds are safe", () => {
  const idx = new SpatialIndex([]);
  assert.deepEqual(idx.query({minX:0,minY:0,maxX:100,maxY:100},1).ids, []);
});
test("edge touching counts as intersection", () => {
  assert.equal(intersects({minX:0,minY:0,maxX:10,maxY:10},{minX:10,minY:5,maxX:20,maxY:15}),true);
});
