import test from "node:test";
import assert from "node:assert/strict";
import { validSpec, toHA, fromHA, describe } from "../web/profile/automation.js";

const spec = { id: "ht_porch", alias: "Porch light", trigger: { type: "sun", event: "sunset", offset_min: -15 }, actions: [{ entity_id: "light.porch", service: "turn_on" }] };

test("automation specs round-trip through Home Assistant config", () => {
  assert.deepEqual(validSpec(spec), []);
  const c = toHA(spec);
  assert.equal(c.trigger[0].offset, "-00:15:00");
  assert.equal(c.action[0].service, "light.turn_on");
  assert.deepEqual(fromHA(c), spec);
  // new HA syntax is understood too
  assert.deepEqual(fromHA({ id: "ht_porch", alias: "Porch light", triggers: [{ trigger: "sun", event: "sunset", offset: "-00:15:00" }], actions: [{ action: "light.turn_on", target: { entity_id: "light.porch" } }] }), spec);
  assert.match(describe(spec, true, { "light.porch": "Alpendre" }), /15 min antes do pôr do sol: ligar Alpendre/);
});

test("unsafe or complex automations are refused", () => {
  assert.ok(validSpec({ ...spec, actions: [{ entity_id: "lock.front", service: "unlock" }] }).length);
  assert.ok(validSpec({ ...spec, actions: [{ entity_id: "light.porch", service: "turn_off_all" }] }).length);
  assert.ok(validSpec({ ...spec, trigger: { type: "template", value: "{{ x }}" } }).length);
  assert.equal(fromHA({ id: "x1", alias: "a", trigger: [{ platform: "time", at: "07:00:00" }], condition: [{ condition: "state" }], action: [{ service: "light.turn_on", target: { entity_id: "light.a" } }] }), null);
});
