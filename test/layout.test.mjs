import "./three-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { layoutTargets } = await import("../web/engine/viewer.js");
const order = [{ id: "g", elevation: -2.9 }, { id: "f0", elevation: 0 }, { id: "f1", elevation: 3 }];
const zeros = () => new Map(order.map((f) => [f.id, 0]));
const all = () => new Set(order.map((f) => f.id));
const base = { order, gap: 4, view: "house" };

test("stacked: every floor at its real height, roof on", () => {
  const p = layoutTargets({ ...base, layout: "stacked", focus: null, current: zeros(), visible: all() });
  assert.deepEqual([...p.to.values()], [0, 0, 0]);
  assert.equal(p.roof, 0);
  assert.deepEqual(p.leaving, []);
});

test("exploded: the lowest floor stays on the ground, the others rise one gap each, the roof lifts off", () => {
  const p = layoutTargets({ ...base, layout: "exploded", focus: null, current: zeros(), visible: all() });
  assert.deepEqual(Object.fromEntries(p.to), { g: 0, f0: 4, f1: 8 });
  assert.ok(p.roof > 0);
  assert.ok([...p.to.values()].every((y) => y >= 0), "nothing sinks under the lawn");
});

test("focus from exploded: the floor settles at its real height, the others drift away from it and leave", () => {
  const cur = new Map([["g", 0], ["f0", 4], ["f1", 8]]);
  const p = layoutTargets({ ...base, layout: "exploded", focus: "f0", current: cur, visible: all() });
  assert.equal(p.to.get("f0"), 0);
  assert.deepEqual(p.leaving.sort(), ["f1", "g"]);
  assert.ok(p.to.get("f1") > cur.get("f1"), "the floor above drifts up");
  assert.ok(p.to.get("g") < cur.get("g"), "the floor below drifts down");
  assert.equal(p.roof, 0);
});

test("switching focus: the new floor comes in from its own side, hidden floors stay put", () => {
  const vis = new Set(["f0"]);
  const p = layoutTargets({ ...base, layout: "stacked", focus: "f1", prevFocus: "f0", current: zeros(), visible: vis });
  assert.ok(p.from.get("f1") > 0, "f1 is above f0, so it comes down from above");
  assert.equal(p.to.get("f1"), 0);
  assert.deepEqual(p.leaving, ["f0"]);
  assert.equal(p.from.get("g"), p.to.get("g"));
});

test("back to all floors after a focus: the others come back from their side", () => {
  const vis = new Set(["f0"]);
  const p = layoutTargets({ ...base, layout: "exploded", focus: null, prevFocus: "f0", current: zeros(), visible: vis });
  assert.ok(p.from.get("f1") > p.to.get("f1"));
  assert.ok(p.from.get("g") < p.to.get("g"));
  assert.deepEqual(Object.fromEntries(p.to), { g: 0, f0: 4, f1: 8 });
});

test("the roof view brings the floors together, whatever the layout", () => {
  const p = layoutTargets({ ...base, view: "roof", layout: "exploded", focus: null, current: new Map([["g", 0], ["f0", 4], ["f1", 8]]), visible: all() });
  assert.deepEqual([...p.to.values()], [0, 0, 0]);
  assert.equal(p.roof, 0);
});
