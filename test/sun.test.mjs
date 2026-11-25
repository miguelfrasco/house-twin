import { test } from "node:test";
import assert from "node:assert/strict";
import { sunPosition, sunTimes, zonedMidnight, dailyPV } from "../web/engine/sun.js";

test("zoned midnight handles offsets both ways", () => {
  assert.equal(new Date(zonedMidnight("2026-06-21", "Europe/Lisbon")).toISOString(), "2026-06-20T23:00:00.000Z");
  assert.equal(new Date(zonedMidnight("2026-06-21", "America/New_York")).toISOString(), "2026-06-21T04:00:00.000Z");
  assert.equal(new Date(zonedMidnight("2026-01-15", "Asia/Tokyo")).toISOString(), "2026-01-14T15:00:00.000Z");
});
test("solar noon sun is due south in the northern hemisphere", () => {
  const { rise, set } = sunTimes("2026-03-20", 40.2, -8.42, "Europe/Lisbon");
  const s = sunPosition((rise + set) / 2, 40.2, -8.42);
  assert.ok(Math.abs(s.az - 180) < 3, `az ${s.az}`);
  assert.ok(Math.abs(s.el - 49.8) < 1.5, `el ${s.el}`);
});
test("summer day longer than winter day", () => {
  const len = (d) => { const t = sunTimes(d, 40.2, -8.42, "Europe/Lisbon"); return t.set - t.rise; };
  assert.ok(len("2026-06-21") > len("2026-12-21") + 5 * 36e5);
});
test("PV estimate is plausible", () => {
  const jun = dailyPV({ kwp: 1, tilt: 30, azimuth: 180 }, "2026-06-21", 40.2, -8.42, "Europe/Lisbon").kwh;
  assert.ok(jun > 5 && jun < 9, String(jun));
});
