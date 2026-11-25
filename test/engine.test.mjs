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

test("detected walls are exterior when one side is outdoors", async () => {
  const { classifyWalls } = await import("../web/engine/slice.js");
  const rooms = [{ polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] }, { polygon: [[5, 0], [9, 0], [9, 4], [5, 4]] }];
  const [ext, int] = classifyWalls([{ a: [0, 0], b: [9, 0], thickness: 0.3 }, { a: [5, 0], b: [5, 4], thickness: 0.2 }], rooms);
  assert.equal(ext.exterior, true); assert.equal(int.exterior, false);
});

test("site: sloped paving follows vertex_y; cut:false keeps the lawn whole", async () => {
  const { buildSite, groundHoles } = await import("../web/engine/site.js");
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const prof = { site: { features: [{ type: "paving", polygon: sq, y: 0, vertex_y: [0, -1, -1, 0] }, { type: "sunken", polygon: sq, y: -2, cut: false, floor: false }] } };
  const { group, occluders } = buildSite(prof);
  const p = group.children[0].geometry.attributes.position; const ys = [];
  for (let i = 0; i < p.count; i++) ys.push(Math.round((p.getY(i) + group.children[0].position.y) * 100) / 100);
  assert.ok(Math.abs(Math.min(...ys) + 1) < 0.02 && Math.abs(Math.max(...ys)) < 0.02);
  assert.equal(groundHoles(prof).length, 0); assert.equal(occluders.length, 4); assert.equal(group.children.length, 5);
});

test("half-height walls: solid below the cut, glass above, and the sun still sees full walls", async () => {
  const { readFileSync } = await import("node:fs");
  const { buildHouse, wallDisplay } = await import("../web/engine/build3d.js");
  const demo = JSON.parse(readFileSync(new URL("../web/demo/profile.json", import.meta.url)));
  assert.deepEqual(wallDisplay(demo), { mode: "half", cut: 1.2 });
  assert.deepEqual(wallDisplay({}), { mode: "half", cut: 1.2 }, "half is the default");
  const half = buildHouse(demo);
  const walls = [], ghosts = [];
  half.root.traverse((o) => { if (o.isMesh && o.userData.kind === "wall") (o.userData.ghost ? ghosts : walls).push(o); });
  assert.ok(ghosts.length > 10, "upper parts become glass");
  const box = new THREE.Box3();
  half.root.updateMatrixWorld(true);
  for (const m of walls) {
    box.setFromObject(m);
    const f = demo.floors.find((x) => x.id === m.userData.floorId);
    assert.ok(box.max.y <= f.elevation + 1.2 + 1e-3, "solid parts stop at the cut");
  }
  for (const g of ghosts) assert.ok(half.occluders.includes(g), "glass tops still block the sun");
  const full = buildHouse({ ...demo, display: { walls: "full" } });
  let fullGhosts = 0;
  full.root.traverse((o) => { if (o.userData?.ghost) fullGhosts++; });
  assert.equal(fullGhosts, 0);
});
