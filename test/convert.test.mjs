import test from "node:test";
import assert from "node:assert/strict";
import { rectsOf, draftToFloor, rectangleFloor } from "../web/wizard/convert.js";
import { sanitizeDraft, extractJson } from "../web/profile/plan-ai.js";

test("rectsOf splits an L-shaped outline into two rectangles", () => {
  const r = rectsOf([[0, 0], [12, 0], [12, 3.5], [17, 3.5], [17, 9], [0, 9]]);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], [[0, 0], [12, 0], [12, 9], [0, 9]]);
});

test("rectsOf falls back to the bounding box for slanted outlines", () => {
  assert.equal(rectsOf([[0, 0], [10, 0], [8, 6]]).length, 1);
});

test("AI draft converts pixels to metres and keeps openings on walls", () => {
  const draft = sanitizeDraft(extractJson("```json\n" + JSON.stringify({ walls: [{ a: [0, 0], b: [500, 0], exterior: true }, { a: [500, 0], b: [500, 400], exterior: true }], rooms: [{ name: "Sala", polygon: [[0, 0], [500, 0], [500, 400], [0, 400]] }], openings: [{ type: "window", a: [100, 0], b: [200, 0] }] }) + "\n```"));
  const f = draftToFloor(draft, { m_per_px: 0.02 });
  assert.equal(f.walls.length, 2);
  assert.ok(Math.abs(f.walls[0].b[0] - 10) < 0.01);
  assert.equal(f.openings.length, 1);
  assert.ok(Math.abs(f.openings[0].width - 2) < 0.05);
});

test("rectangle starter is a closed box with one room", () => {
  const f = rectangleFloor(10, 8);
  assert.equal(f.walls.length, 4);
  assert.equal(f.rooms.length, 1);
});
