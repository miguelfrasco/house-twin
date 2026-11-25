import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleApi } from "../server/core.js";
import { dailyReminder, pushAll } from "../server/care.js";
import { wateringInterval, duePlants, sanitizeAnalysis } from "../web/profile/plantcare.js";

const demo = JSON.parse(readFileSync(new URL("../web/demo/profile.json", import.meta.url)));
function mem() { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : t === "bytes" ? v : v; }, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) }; }
const deps = (storage) => ({ storage, target: "node", demoProfile: async () => demo, setupCode: async () => "open-sesame-123" });
const req = (path, init = {}) => new Request(`https://house.test${path}`, init);

async function owner() {
  const s = mem();
  const r = await handleApi(req("/api/setup/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "open-sesame-123", password: "long-enough-pw" }) }), {}, deps(s));
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const p = structuredClone(demo); delete p.demo;
  for (const it of p.modules.plants.items) it.last_watered = "2026-01-01";
  await s.put("profile", JSON.stringify(p));
  const call = (path, init = {}) => handleApi(req(path, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers || {}) } }), {}, deps(s));
  return { s, call, p };
}

test("watering interval follows season and sun", () => {
  assert.equal(wateringInterval({ water_every_days: 10 }, { date: "2026-04-10" }).days, 10);
  assert.equal(wateringInterval({ water_every_days: 10 }, { date: "2026-01-10" }).days, 14);
  assert.equal(wateringInterval({ water_every_days: 10 }, { date: "2026-07-10", sunHours: 5 }).days, 6);
  assert.equal(wateringInterval({ water_every_days: 10 }, { date: "2026-01-10", adjust: false }).days, 10);
});

test("water log, summary and due list", async () => {
  const { call, p } = await owner();
  const id = p.modules.plants.items[0].id;
  const w = await (await call("/api/plants/water", { method: "POST", body: JSON.stringify({ ids: [id] }) })).json();
  assert.ok(w.waterings[id]);
  const log = await (await call(`/api/plants/log?plant=${id}`)).json();
  assert.equal(log.length, 1);
  const sum = await (await call("/api/push/summary?lang=pt")).json();
  assert.equal(sum.count, p.modules.plants.items.length - 1);
  assert.match(sum.body, /Para regar hoje/);
  assert.equal(duePlants(p, {}, "2026-11-25").length, p.modules.plants.items.length);
});

test("push key, subscribe and a payload-less send", async () => {
  const { s, call } = await owner();
  const k = await (await call("/api/push/key")).json();
  assert.match(k.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal((await call("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: { endpoint: "http://insecure" } }) })).status, 400);
  assert.equal((await call("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: { endpoint: "https://push.example/abc" }, hour: 8 }) })).status, 200);
  const seen = [];
  const res = await pushAll(s, {}, async (url, init) => { seen.push([url, init.headers.authorization]); return new Response(null, { status: 201 }); });
  assert.deepEqual(res, [201]);
  assert.match(seen[0][1], /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  const gone = await pushAll(s, {}, async () => new Response(null, { status: 410 }));
  assert.deepEqual(gone, [410]);
  assert.equal((await s.get("push_subs", "json")).length, 0);
  assert.deepEqual(await dailyReminder(s, {}, { force: true }), { sent: [] }); // plants are due, nobody subscribed
  assert.equal((await dailyReminder(s, {})).skipped, "not now"); // already sent today
});

test("photos are stored and listed; AI output is sanitised", async () => {
  const { call } = await owner();
  const r = await call("/api/plants/pl1/photos", { method: "POST", headers: { "content-type": "image/jpeg" }, body: new Uint8Array([255, 216, 255, 0]) });
  assert.equal(r.status, 200);
  assert.equal((await (await call("/api/plants/pl1/photos")).json()).length, 1);
  assert.equal((await call("/api/plants/pl1/photos", { method: "POST", headers: { "content-type": "text/html" }, body: "<x>" })).status, 415);
  assert.deepEqual(sanitizeAnalysis({ common_name: "<b>Fern</b>", light: "blinding", water_every_days: 400 }), { common_name: "bFern/b", water_every_days: 90 });
});
