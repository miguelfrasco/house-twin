import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, migrate, scrub, emptyProfile, roundedLocation, bearingFromNorthArrow, northArrowFromBearing } from "../web/profile/profile.js";

const demo = JSON.parse(readFileSync(new URL("../web/demo/profile.json", import.meta.url)));

test("demo profile is valid", () => assert.deepEqual(validate(demo).errors, []));
test("empty profile is valid", () => assert.ok(validate(emptyProfile()).ok));
test("opening must fit its wall", () => {
  const p = structuredClone(demo);
  p.floors[0].openings[0].offset = 50;
  assert.match(validate(p).errors.join(), /does not fit/);
});
test("Google imagery is refused", () => {
  const p = structuredClone(demo);
  p.site.aerial.source = "google";
  assert.match(validate(p).errors.join(), /Google/);
});
test("unknown module is refused", () => {
  const p = structuredClone(demo); p.modules.telemetry = {};
  assert.ok(!validate(p).ok);
});
test("migrate fills defaults", () => {
  const p = migrate({ name: "x", floors: [{ id: "a", name: "A", elevation: 0, height: 2.5 }], location: { bearing_deg: 0 } });
  assert.deepEqual(p.floors[0].walls, []);
  assert.equal(p.version, 1);
});
test("scrub removes location, networks, names and images", () => {
  const s = scrub(demo);
  assert.equal(s.location.lat, null);
  assert.equal(s.site.aerial, null);
  assert.deepEqual(s.assets, []);
  assert.equal(s.modules.wifi.ssid, undefined);
  assert.equal(s.modules.wifi.survey.length, 0);
  assert.ok(!JSON.stringify(s).includes("demo_living_temperature"));
  assert.ok(!JSON.stringify(s.modules.plants).includes("Monstera\""));
  assert.ok(validate(s).ok, validate(s).errors.join());
});
test("rounded location for third parties is ~1 km", () => assert.deepEqual(roundedLocation({ lat: 40.20581, lon: -8.42049 }), { lat: 40.21, lon: -8.42 }));
test("north arrow and bearing round-trip", () => {
  for (const b of [0, 45, 100, 270, 359]) assert.equal(bearingFromNorthArrow(northArrowFromBearing(b)), b);
  assert.equal(bearingFromNorthArrow(0), 90); // north is plan-up -> +x points east
});
