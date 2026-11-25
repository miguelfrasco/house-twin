import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleApi } from "../server/core.js";
import { sanitizeDraft, extractJson, draftPlan } from "../server/ai.js";

const demo = JSON.parse(readFileSync(new URL("../web/demo/profile.json", import.meta.url)));
function mem() { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) }; }
const deps = (storage, code = "open-sesame-123") => ({ storage, target: "node", demoProfile: async () => demo, setupCode: async () => code });
const req = (path, init = {}) => new Request(`https://house.test${path}`, init);
const post = (path, body, headers = {}) => req(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("demo mode serves the demo profile and refuses writes", async () => {
  const s = mem(), env = { DEMO: "1" };
  const c = await (await handleApi(req("/api/config"), env, deps(s))).json();
  assert.equal(c.mode, "demo");
  assert.deepEqual(c.secrets, {});
  assert.equal((await (await handleApi(req("/api/profile"), env, deps(s))).json()).name, "Casa Exemplo");
  assert.equal((await handleApi(req("/api/profile", { method: "PUT", body: "{}" }), env, deps(s))).status, 403);
  assert.equal((await handleApi(post("/api/setup/claim", { code: "x", password: "y" }), env, deps(s))).status, 403);
});

test("setup claim, login, save profile, state", async () => {
  const s = mem(), env = {};
  assert.equal((await (await handleApi(req("/api/config"), env, deps(s))).json()).mode, "setup");
  assert.equal((await handleApi(req("/api/profile"), env, deps(s))).status, 404);
  assert.equal((await handleApi(post("/api/setup/claim", { code: "wrong", password: "long-enough-pw" }), env, deps(s))).status, 403);
  assert.equal((await handleApi(post("/api/setup/claim", { code: "open-sesame-123", password: "short" }), env, deps(s))).status, 400);
  const r = await handleApi(post("/api/setup/claim", { code: "open-sesame-123", password: "long-enough-pw" }), env, deps(s));
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict; Secure/);
  assert.equal((await handleApi(post("/api/setup/claim", { code: "open-sesame-123", password: "long-enough-pw" }), env, deps(s))).status, 409);
  assert.ok(!String(s.m.get("owner")).includes("long-enough-pw"));
  // unauthenticated
  assert.equal((await handleApi(req("/api/profile"), env, deps(s))).status, 401);
  const p = structuredClone(demo); delete p.demo;
  const put = (body, c = cookie) => handleApi(req("/api/profile", { method: "PUT", headers: { cookie: c, "content-type": "application/json" }, body }), env, deps(s));
  assert.equal((await put(JSON.stringify(p), "ht_session=1.forged")).status, 401);
  assert.equal((await put("{not json")).status, 400);
  const bad = structuredClone(p); bad.floors = [];
  assert.equal((await put(JSON.stringify(bad))).status, 400);
  assert.equal((await put(JSON.stringify(p))).status, 200);
  assert.equal((await (await handleApi(req("/api/profile", { headers: { cookie } }), env, deps(s))).json()).name, "Casa Exemplo");
  // state
  const st = await handleApi(req("/api/state/plants", { method: "PUT", headers: { cookie }, body: JSON.stringify({ waterings: { a: "2026-01-01" } }) }), env, deps(s));
  assert.equal(st.status, 200);
  assert.equal((await (await handleApi(req("/api/state/plants", { headers: { cookie } }), env, deps(s))).json()).waterings.a, "2026-01-01");
  // login
  assert.equal((await handleApi(post("/api/login", { password: "nope-nope-nope" }), env, deps(s))).status, 401);
  assert.equal((await handleApi(post("/api/login", { password: "long-enough-pw" }), env, deps(s))).status, 200);
  // cross-origin writes refused
  assert.equal((await handleApi(post("/api/login", { password: "x" }, { origin: "https://evil.example" }), env, deps(s))).status, 403);
  // secrets are reported as booleans only
  const c = await (await handleApi(req("/api/config", { headers: { cookie } }), { OPENROUTER_API_KEY: "sk-test-value" }, deps(s))).json();
  assert.equal(c.secrets.OPENROUTER_API_KEY, true);
  assert.ok(!JSON.stringify(c).includes("sk-test-value"));
});

test("AI draft: missing key, sanitizer, mocked OpenRouter", async () => {
  await assert.rejects(draftPlan({ apiKey: "", imageDataUrl: "data:image/png;base64,AA" }), /OPENROUTER_API_KEY/);
  await assert.rejects(draftPlan({ apiKey: "k", imageDataUrl: "https://example.com/x.png" }), /data URL/);
  assert.deepEqual(extractJson("```json\n{\"a\":1}\n```"), { a: 1 });
  const d = sanitizeDraft({ walls: [{ a: [0, 0], b: [10, "5"] }, { a: [1], b: [2, 2] }], rooms: [{ name: "x".repeat(200), polygon: [[0, 0], [1, 0], [1, 1]] }], openings: [{ type: "evil", a: [0, 0], b: [1, 0] }] });
  assert.equal(d.walls.length, 1); assert.equal(d.walls[0].b[1], 5); assert.equal(d.rooms[0].name.length, 60); assert.equal(d.openings[0].type, "door");
  let sent;
  const fake = async (url, init) => { sent = { url, body: JSON.parse(init.body), auth: init.headers.authorization }; return new Response(JSON.stringify({ choices: [{ message: { content: '{"walls":[{"a":[0,0],"b":[100,0],"exterior":true}],"rooms":[],"openings":[]}' } }] })); };
  const out = await draftPlan({ apiKey: "k-123", imageDataUrl: "data:image/png;base64,AAAA", fetchImpl: fake });
  assert.equal(out.walls.length, 1);
  assert.equal(sent.auth, "Bearer k-123");
  assert.match(sent.url, /openrouter\.ai\/api\/v1\/chat\/completions$/);
  assert.equal(sent.body.messages[0].content[1].image_url.url, "data:image/png;base64,AAAA");
});

test("Home Assistant proxy: doors need confirmation, automations stay in the safe subset", async () => {
  const s = mem(), env = { HA_BASE_URL: "http://ha.test", HA_TOKEN: "t" };
  const r = await handleApi(post("/api/setup/claim", { code: "open-sesame-123", password: "long-enough-pw" }), env, deps(s));
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const calls = [], configs = { ht_a: { id: "ht_a", alias: "x", trigger: [{ platform: "time", at: "07:00:00" }], action: [{ service: "light.turn_on", target: { entity_id: "light.a" } }] }, manual: { id: "manual", alias: "y", trigger: [{ platform: "time", at: "07:00:00" }], condition: [{ condition: "x" }], action: [] } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || "GET", String(url).replace("http://ha.test", "")]);
    const m = String(url).match(/automation\/config\/(\w+)$/);
    if (m && (init.method || "GET") === "GET") return configs[m[1]] ? new Response(JSON.stringify(configs[m[1]])) : new Response("{}", { status: 404 });
    return new Response("[]");
  };
  try {
    const h = { cookie, origin: "https://house.test" };
    assert.equal((await handleApi(post("/api/ha/service", { domain: "cover", service: "open_cover", entity_id: "cover.gate" }, h), env, deps(s))).status, 400);
    assert.equal((await handleApi(post("/api/ha/service", { domain: "cover", service: "open_cover", entity_id: "cover.gate", confirm: true }, h), env, deps(s))).status, 200);
    assert.equal((await handleApi(post("/api/ha/service", { domain: "lock", service: "unlock", entity_id: "lock.front" }, h), env, deps(s))).status, 400);
    const put = (id, body) => handleApi(req(`/api/ha/automations/${id}`, { method: "PUT", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(body) }), env, deps(s));
    const spec = { alias: "Morning", trigger: { type: "time", at: "07:30" }, actions: [{ entity_id: "light.a", service: "turn_on" }] };
    assert.equal((await put("ht_a", spec)).status, 200);
    assert.equal((await put("manual", spec)).status, 409); // made in HA: not overwritten
    assert.equal((await put("ht_b", { ...spec, actions: [{ entity_id: "lock.x", service: "unlock" }] })).status, 400);
    assert.ok(calls.some(([m, u]) => m === "POST" && u === "/api/config/automation/config/ht_a"));
    assert.ok(!calls.some(([m, u]) => m === "POST" && u.endsWith("/manual")));
  } finally { globalThis.fetch = realFetch; }
});
