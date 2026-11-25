import "./three-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const THREE = await import("three");
const { wallsFromModel } = await import("../web/engine/slice.js");
const { buildSite, rampGeometry, groundHoles } = await import("../web/engine/site.js");

test("walls are recovered from a model by slicing it", () => {
  const root = new THREE.Group();
  const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d)); m.position.set(x, y, z); root.add(m); };
  box(8, 2.7, 0.3, 0, 1.35, 0);      // exterior wall along x, 0.3 thick
  box(0.12, 2.7, 4, 2, 1.35, 2.15);  // interior partition along z, 0.12 thick
  box(1, 0.8, 1, -2, 0.4, 2);        // a table: below the cut, ignored
  const walls = wallsFromModel(root, 0, 1.2);
  assert.equal(walls.length, 2);
  const ext = walls.find((w) => w.thickness > 0.2), int = walls.find((w) => w.thickness < 0.2);
  assert.ok(Math.abs(ext.thickness - 0.3) < 0.02 && Math.abs(Math.abs(ext.b[0] - ext.a[0]) - 8) < 0.05);
  assert.ok(Math.abs(int.thickness - 0.12) < 0.02 && Math.abs(int.a[0] - 2) < 0.02);
});

test("site: ramps interpolate height, sunken areas cut the ground and gates are found", () => {
  const { geometry, length } = rampGeometry([[0, 0], [10, 0]], 3, 0, -2);
  assert.equal(length, 10);
  const ys = Array.from({ length: geometry.attributes.position.count }, (_, i) => geometry.attributes.position.getY(i));
  assert.deepEqual([Math.max(...ys), Math.min(...ys)], [0, -2]);
  const profile = { site: { features: [
    { type: "sunken", polygon: [[0, 0], [5, 0], [5, 4], [0, 4]], y: -2.5, open_edges: [1] },
    { type: "gate", a: [6, 0], b: [9, 0], y: -2.5, entity_id: "cover.gate" },
    { type: "paving", polygon: [[0, 5], [2, 5], [2, 6]], y: 0 },
  ] } };
  assert.equal(groundHoles(profile).length, 1);
  const s = buildSite(profile);
  assert.equal(s.gates.length, 1);
  assert.equal(s.occluders.length, 3); // 4 retaining walls minus the open edge
});
