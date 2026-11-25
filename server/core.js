// One request handler for every hosting target. Targets pass a storage adapter and env.
import { migrate, validate } from "../web/profile/profile.js";
import { hashPassword, verifyPassword, makeSession, checkSession, cookie, readCookie, randomToken, timingSafeEqual } from "./auth.js";
import { draftPlan } from "./ai.js";

export const SECRET_NAMES = ["OPENROUTER_API_KEY", "HA_BASE_URL", "HA_TOKEN"];
const MAX_PROFILE = 2_000_000, MAX_ASSET = 8_000_000, MAX_STATE = 200_000;
const SESSION = "ht_session";
const attempts = new Map(); // best-effort login rate limit per instance

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (status, error) => json({ error }, status);

async function sessionKey(storage) {
  let k = await storage.get("session_key", "text");
  if (!k) { k = randomToken(32); await storage.put("session_key", k); }
  return k;
}

function sameOrigin(req) {
  const o = req.headers.get("origin");
  if (!o) return true; // non-browser clients
  return new URL(o).host === new URL(req.url).host;
}

/**
 * @param {Request} req
 * @param {object} env   platform env (vars + secrets)
 * @param {object} deps  { storage, target: "cloudflare"|"node", demoProfile: () => Promise<object>, setupCode: () => Promise<string|null>, writeSecret?: (name, value) => Promise<void> }
 */
export async function handleApi(req, env, deps) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const { storage } = deps;
  const demo = env.DEMO === "1" || env.DEMO === "true";
  if (!["GET", "HEAD"].includes(method) && !sameOrigin(req)) return fail(403, "cross-origin request refused");

  const secure = url.protocol === "https:";
  const owner = demo ? false : await checkSession(await sessionKey(storage), readCookie(req, SESSION));
  const hasOwner = demo ? true : !!(await storage.get("owner", "text"));

  if (path === "/api/config" && method === "GET") {
    return json({
      mode: demo ? "demo" : hasOwner ? "owner" : "setup",
      target: deps.target,
      authed: owner,
      ai_model: env.AI_MODEL || "google/gemini-2.5-flash",
      public_view: env.PUBLIC_VIEW === "1",
      secrets: demo ? {} : Object.fromEntries(SECRET_NAMES.map((n) => [n, !!env[n]])),
      can_write_secrets: !!deps.writeSecret && owner,
      version: "0.1.0",
    });
  }

  if (path === "/api/profile" && method === "GET") {
    if (demo) return json(await deps.demoProfile());
    if (!owner && env.PUBLIC_VIEW !== "1") return fail(hasOwner ? 401 : 404, hasOwner ? "sign in" : "no profile yet");
    const p = await storage.get("profile", "json");
    return p ? json(p) : fail(404, "no profile yet");
  }

  // ---- first-run claim -------------------------------------------------------------------
  if (path === "/api/setup/claim" && method === "POST") {
    if (demo) return fail(403, "demo is read-only");
    if (hasOwner) return fail(409, "already set up");
    const body = await req.json().catch(() => ({}));
    const expected = await deps.setupCode();
    if (!expected) return fail(503, "SETUP_CODE is not configured on the server");
    if (!timingSafeEqual(String(body.code || "").trim(), expected)) return fail(403, "wrong setup code");
    if (typeof body.password !== "string" || body.password.length < 10) return fail(400, "password must have at least 10 characters");
    await storage.put("owner", await hashPassword(body.password));
    const s = await makeSession(await sessionKey(storage));
    return json({ ok: true }, 200, { "set-cookie": cookie(SESSION, s, { maxAge: 30 * 86400, secure }) });
  }

  if (path === "/api/login" && method === "POST") {
    if (demo) return fail(403, "demo has no login");
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "local";
    const a = attempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 60_000) { a.n = 0; a.t = Date.now(); }
    if (a.n >= 8) return fail(429, "too many attempts");
    const body = await req.json().catch(() => ({}));
    const ok = await verifyPassword(String(body.password || ""), await storage.get("owner", "text"));
    if (!ok) { a.n++; attempts.set(ip, a); return fail(401, "wrong password"); }
    attempts.delete(ip);
    const s = await makeSession(await sessionKey(storage));
    return json({ ok: true }, 200, { "set-cookie": cookie(SESSION, s, { maxAge: 30 * 86400, secure }) });
  }

  if (path === "/api/logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": cookie(SESSION, "", { maxAge: 0, secure }) });

  // ---- everything below needs the owner ---------------------------------------------------
  const assetMatch = path.match(/^\/api\/assets\/([\w.-]{1,80})$/);
  if (assetMatch && method === "GET") {
    if (!owner && env.PUBLIC_VIEW !== "1") return fail(401, "sign in");
    const meta = await storage.get(`assetmeta:${assetMatch[1]}`, "json");
    const bytes = await storage.get(`asset:${assetMatch[1]}`, "bytes");
    if (!bytes) return fail(404, "not found");
    return new Response(bytes, { headers: { "content-type": meta?.mime || "application/octet-stream", "cache-control": "private, max-age=300" } });
  }

  if (demo) return fail(403, "demo is read-only: changes stay in your browser");
  if (!owner) return fail(401, "sign in");

  if (path === "/api/profile" && method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_PROFILE) return fail(413, "profile too large");
    let p;
    try { p = migrate(JSON.parse(text)); } catch { return fail(400, "invalid JSON"); }
    const v = validate(p);
    if (!v.ok) return json({ error: "invalid profile", details: v.errors.slice(0, 20) }, 400);
    const prev = await storage.get("profile", "text");
    if (prev) await storage.put(`profile_prev`, prev); // one-step undo
    await storage.put("profile", JSON.stringify(p));
    return json({ ok: true });
  }

  if (assetMatch && method === "PUT") {
    const mime = (req.headers.get("content-type") || "").split(";")[0];
    if (!/^(image\/(png|jpeg|webp|svg\+xml)|model\/gltf-binary|application\/octet-stream)$/.test(mime)) return fail(415, "unsupported type");
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > MAX_ASSET) return fail(413, "asset too large (8 MB max)");
    await storage.put(`asset:${assetMatch[1]}`, buf);
    await storage.put(`assetmeta:${assetMatch[1]}`, JSON.stringify({ mime, size: buf.byteLength, at: new Date().toISOString() }));
    return json({ ok: true, id: assetMatch[1] });
  }
  if (assetMatch && method === "DELETE") { await storage.delete(`asset:${assetMatch[1]}`); await storage.delete(`assetmeta:${assetMatch[1]}`); return json({ ok: true }); }

  const stateMatch = path.match(/^\/api\/state\/(plants|wifi|homeassistant|solar|cameras)$/);
  if (stateMatch && method === "GET") return json((await storage.get(`state:${stateMatch[1]}`, "json")) || {});
  if (stateMatch && method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_STATE) return fail(413, "too large");
    try { JSON.parse(text); } catch { return fail(400, "invalid JSON"); }
    await storage.put(`state:${stateMatch[1]}`, text);
    return json({ ok: true });
  }

  if (path === "/api/ai/plan" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    try {
      const draft = await draftPlan({ apiKey: env.OPENROUTER_API_KEY, model: env.AI_MODEL, imageDataUrl: body.image, baseUrl: env.OPENROUTER_BASE_URL || undefined, referer: url.origin });
      return json(draft);
    } catch (e) { return fail(e.status || 500, e.message); }
  }

  if (path === "/api/secrets" && method === "POST") {
    if (!deps.writeSecret) return fail(501, "on this host, set secrets with the platform (see README)");
    const body = await req.json().catch(() => ({}));
    if (!SECRET_NAMES.includes(body.name)) return fail(400, "unknown secret");
    await deps.writeSecret(body.name, String(body.value || "").trim());
    return json({ ok: true });
  }

  if (path.startsWith("/api/ha/")) return haProxy(req, env, path, url);

  return fail(404, "not found");
}

async function haProxy(req, env, path, url) {
  if (!env.HA_BASE_URL || !env.HA_TOKEN) return fail(503, "Home Assistant is not connected");
  const base = env.HA_BASE_URL.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${env.HA_TOKEN}`, "content-type": "application/json" };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) { headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID; headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET; }
  const ha = (p, init = {}) => fetch(`${base}${p}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (path === "/api/ha/states" && req.method === "GET") {
    const ids = (url.searchParams.get("ids") || "").split(",").filter((x) => /^[a-z_]+\.[\w-]+$/.test(x)).slice(0, 200);
    const r = await ha("/api/states");
    if (!r.ok) return fail(502, `Home Assistant ${r.status}`);
    const all = await r.json();
    const want = new Set(ids);
    return json(Object.fromEntries(all.filter((s) => want.has(s.entity_id)).map((s) => [s.entity_id, { state: s.state, attributes: { unit_of_measurement: s.attributes?.unit_of_measurement, device_class: s.attributes?.device_class, friendly_name: s.attributes?.friendly_name } }])));
  }
  if (path === "/api/ha/entities" && req.method === "GET") {
    const r = await ha("/api/states");
    if (!r.ok) return fail(502, `Home Assistant ${r.status}`);
    return json((await r.json()).map((s) => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name || "" })));
  }
  if (path === "/api/ha/service" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!["light", "switch", "fan"].includes(b.domain) || !["turn_on", "turn_off", "toggle"].includes(b.service) || !/^[a-z_]+\.[\w-]+$/.test(b.entity_id || "") || !b.entity_id.startsWith(b.domain + ".")) return fail(400, "service not allowed");
    const r = await ha(`/api/services/${b.domain}/${b.service}`, { method: "POST", body: JSON.stringify({ entity_id: b.entity_id }) });
    return r.ok ? json({ ok: true }) : fail(502, `Home Assistant ${r.status}`);
  }
  const cam = path.match(/^\/api\/ha\/camera\/(camera\.[\w-]+)$/);
  if (cam && req.method === "GET") {
    const r = await ha(`/api/camera_proxy/${cam[1]}`);
    if (!r.ok) return fail(502, `Home Assistant ${r.status}`);
    return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": "no-store" } });
  }
  return fail(404, "not found");
}

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "geolocation=(), camera=(), microphone=()",
};
