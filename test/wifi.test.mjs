import "./three-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";
globalThis.localStorage ??= { getItem: () => null, setItem() {} };
globalThis.navigator ??= { language: "en" };
const { predict, calibrate, parseSurvey } = await import("../web/engine/wifi-model.js");

const profile = { floors: [{ id: "f0", name: "Ground", elevation: 0, walls: [{ id: "w1", a: [5, -10], b: [5, 10], thickness: 0.1 }, { id: "w2", a: [10, -10], b: [10, 10], thickness: 0.1 }] }] };
const ap = { id: "ap1", floor: "f0", pos: [0, 0], height: 1.0, tx_dbm: 20 };

test("calibration recovers the exponent and wall loss from measurements", () => {
  const truth = { pl0_db: 40, n: 3.4, wall_db: 6, ext_wall_db: 12, floor_db: 15 };
  const survey = [];
  for (const x of [1, 2, 3, 4, 6, 7, 8, 9, 11, 13, 15]) for (const y of [-2, 2]) survey.push({ floor: "f0", pos: [x, y], rssi: predict(profile, ap, "f0", [x, y], truth) - 3 });
  const cal = calibrate(profile, { aps: [ap], survey, model: { pl0_db: 40, n: 2.8, wall_db: 4, ext_wall_db: 12, floor_db: 15 } });
  assert.deepEqual(cal.fitted, ["offset", "n", "wall_db"]);
  // a weak prior pulls slightly towards the starting model; 22 points mostly override it
  assert.ok(Math.abs(cal.model.n - 3.4) < 0.2, `n ${cal.model.n}`);
  assert.ok(Math.abs(cal.model.wall_db - 6) < 1, `wall ${cal.model.wall_db}`);
  assert.ok(Math.abs(cal.offset + 3) < 1.5 && cal.rmse < 1, `offset ${cal.offset} rmse ${cal.rmse}`);
});

test("a handful of noisy points can't push the exponent to its limits", () => {
  const survey = [[3, 1, -45], [8, 0, -60], [5, 1, -49], [12, -1, -57], [9, 2, -44], [13, 1, -43]].map(([x, y, rssi]) => ({ floor: "f0", pos: [x, y], rssi }));
  const cal = calibrate(profile, { aps: [ap], survey, model: { pl0_db: 40, n: 3, wall_db: 4, ext_wall_db: 12, floor_db: 15 } });
  assert.ok(cal.model.n > 1.7 && cal.model.n < 4.9, `n ${cal.model.n}`);
});

test("survey files: CSV with or without header, semicolons, JSON", () => {
  const p2 = { floors: [{ id: "f0", name: "Piso 0" }, { id: "f1", name: "Piso 1" }] };
  let r = parseSurvey("floor,x,y,rssi,ap\nf0,1.5,2,-55,ap1\nPiso 1,3,4,−70\nbad,1,1,-50\nf0,1,1,20", p2);
  assert.equal(r.points.length, 2); assert.deepEqual(r.skipped, [3, 4]);
  assert.deepEqual(r.points[1], { floor: "f1", pos: [3, 4], rssi: -70 });
  r = parseSurvey("f0;1,5;2;-60", p2);
  assert.deepEqual(r.points[0].pos, [1.5, 2]);
  r = parseSurvey(JSON.stringify({ survey: [{ floor: "f0", pos: [1, 2], rssi: -48, label: "Sofá" }] }), p2);
  assert.equal(r.points[0].label, "Sofá");
});
