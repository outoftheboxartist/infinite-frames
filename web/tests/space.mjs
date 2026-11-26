// Universes keep their documents apart. Run: node tests/space.mjs
import assert from "node:assert/strict";
import { spaceFrom, toDb, fromDb, inSpace, scope, ARCHIVE } from "../src/space.js";

assert.equal(spaceFrom(""), "game");
assert.equal(spaceFrom("?space=archive"), ARCHIVE);
assert.equal(spaceFrom("?space=What Is%20Love~~x!"), "whatislovex", "names are letters, digits and dashes only");

// a tiny stand-in for the table, answering the two filters the app uses
const rows = ["1", "b1", "m5__u9", "game~~1", "game~~b1", "love~~b1", "gamer~~b1"];
const like = (pat) => new RegExp("^" + pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$");
const q = (list) => ({ list, like: (c, p) => q(list.filter((r) => like(p).test(r))), not: (c, op, p) => q(list.filter((r) => !like(p).test(r))) });

for (const space of ["game", "love", ARCHIVE, "new"]) {
  const got = scope(space, q(rows)).list;
  assert.deepEqual(got, rows.filter((r) => inSpace(space, r)), "query and live filter agree for " + space);
  got.forEach((r) => assert.equal(toDb(space, fromDb(space, r)), r));
}
assert.deepEqual(scope("game", q(rows)).list, ["game~~1", "game~~b1"], "game sees only its own");
assert.deepEqual(scope(ARCHIVE, q(rows)).list, ["1", "b1", "m5__u9"], "archive is exactly the original canvas");
assert.deepEqual(scope("new", q(rows)).list, [], "a new universe starts empty");
assert.equal(fromDb("game", "game~~b1"), "b1");
console.log("universes: all checks passed");
