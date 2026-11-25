// Plant care on the server: watering log, photos with AI identification and check-ins, and daily
// Web Push reminders (VAPID, payload-less: the service worker fetches the summary itself).
import { visionJson } from "./ai.js";
import { identifyPrompt, checkinPrompt, sanitizeAnalysis, duePlants } from "../web/profile/plantcare.js";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (s, error) => json({ error }, s);
const MAX_PHOTO = 6_000_000, MAX_LOG = 1000, MAX_PHOTOS = 40;

const b64u = (buf) => { let s = ""; new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const toDataUrl = (bytes, type) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return `data:${type};base64,${btoa(s)}`; };

export function todayIn(tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
const hourIn = (tz) => { try { return +new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", hour: "2-digit", hour12: false }).format(new Date()); } catch { return new Date().getUTCHours(); } };

async function vapidKeys(storage) {
  let k = await storage.get("vapid", "json");
  if (!k) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
    k = { jwk, publicKey: b64u(raw) };
    await storage.put("vapid", JSON.stringify(k));
  }
  return k;
}

async function vapidHeader(storage, endpoint, subject) {
  const { jwk, publicKey } = await vapidKeys(storage);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${h}.${p}`));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${publicKey}`;
}

/** Send a payload-less push to every subscription; drops expired ones. */
export async function pushAll(storage, env, fetchImpl = fetch) {
  const subs = (await storage.get("push_subs", "json")) || [];
  const keep = [], res = [];
  for (const s of subs) {
    try {
      const r = await fetchImpl(s.endpoint, { method: "POST", headers: { authorization: await vapidHeader(storage, s.endpoint, env.PUSH_SUBJECT || "mailto:owner@example.invalid"), ttl: "43200", urgency: "normal", "content-length": "0" } });
      if (r.status !== 404 && r.status !== 410) keep.push(s);
      res.push(r.status);
    } catch { keep.push(s); res.push("error"); }
  }
  if (keep.length !== subs.length) await storage.put("push_subs", JSON.stringify(keep));
  return res;
}

export async function summary(storage, lang = "en") {
  const profile = await storage.get("profile", "json");
  const st = (await storage.get("state:plants", "json")) || {};
  const tz = profile?.location?.timezone;
  const due = duePlants(profile, st.waterings || {}, todayIn(tz), st.sun || {});
  const pt = lang === "pt";
  const names = due.map((d) => d.p.name);
  return {
    count: due.length,
    title: pt ? "🪴 Plantas" : "🪴 Plants",
    body: due.length ? (pt ? `Para regar hoje: ${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""}` : `To water today: ${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""}`) : pt ? "Nenhuma planta precisa de água hoje." : "No plant needs water today.",
  };
}

/** Called by the platform scheduler (Worker cron / Node timer). Sends at most one reminder a day, at the owner's hour. */
export async function dailyReminder(storage, env, { force = false } = {}) {
  const profile = await storage.get("profile", "json");
  if (!profile) return { skipped: "no profile" };
  const tz = profile.location?.timezone;
  const cfg = (await storage.get("push_cfg", "json")) || { hour: 9 };
  const today = todayIn(tz);
  if (!force && (hourIn(tz) !== cfg.hour || cfg.last === today)) return { skipped: "not now" };
  const s = await summary(storage);
  await storage.put("push_cfg", JSON.stringify({ ...cfg, last: today }));
  if (!s.count) return { skipped: "nothing due" };
  return { sent: await pushAll(storage, env) };
}

export async function handleCare(req, env, path, url, storage) {
  const m = req.method;
  if (path === "/api/push/key" && m === "GET") return json({ publicKey: (await vapidKeys(storage)).publicKey, hour: ((await storage.get("push_cfg", "json")) || { hour: 9 }).hour });
  if (path === "/api/push/subscribe" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const sub = b.subscription;
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) return fail(400, "bad subscription");
    const subs = ((await storage.get("push_subs", "json")) || []).filter((s) => s.endpoint !== sub.endpoint);
    subs.push({ endpoint: sub.endpoint, at: new Date().toISOString() });
    await storage.put("push_subs", JSON.stringify(subs.slice(-10)));
    if (Number.isInteger(b.hour) && b.hour >= 0 && b.hour <= 23) await storage.put("push_cfg", JSON.stringify({ ...((await storage.get("push_cfg", "json")) || {}), hour: b.hour }));
    return json({ ok: true, count: subs.length });
  }
  if (path === "/api/push/unsubscribe" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const subs = ((await storage.get("push_subs", "json")) || []).filter((s) => s.endpoint !== b.endpoint);
    await storage.put("push_subs", JSON.stringify(subs));
    return json({ ok: true });
  }
  if (path === "/api/push/test" && m === "POST") return json({ sent: await pushAll(storage, env) });
  if (path === "/api/push/summary" && m === "GET") return json(await summary(storage, url.searchParams.get("lang") === "pt" ? "pt" : "en"));

  if (path === "/api/plants/water" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x) => typeof x === "string" && x.length < 80).slice(0, 100);
    const profile = await storage.get("profile", "json");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : todayIn(profile?.location?.timezone);
    const st = (await storage.get("state:plants", "json")) || {};
    st.waterings = { ...(st.waterings || {}) };
    for (const id of ids) st.waterings[id] = day;
    await storage.put("state:plants", JSON.stringify(st));
    const log = (await storage.get("plant_log", "json")) || [];
    const at = new Date().toISOString();
    for (const id of ids) log.unshift({ id, at, day });
    await storage.put("plant_log", JSON.stringify(log.slice(0, MAX_LOG)));
    return json({ ok: true, waterings: st.waterings });
  }
  if (path === "/api/plants/log" && m === "GET") {
    const id = url.searchParams.get("plant");
    const log = (await storage.get("plant_log", "json")) || [];
    return json(id ? log.filter((e) => e.id === id).slice(0, 60) : log.slice(0, 200));
  }
  const ph = path.match(/^\/api\/plants\/([\w-]{1,80})\/photos$/);
  if (ph && m === "GET") return json((await storage.get(`photos:${ph[1]}`, "json")) || []);
  if (ph && m === "POST") {
    const mime = (req.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return fail(415, "photo must be JPEG, PNG or WebP");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > MAX_PHOTO) return fail(413, "photo too large");
    const list = (await storage.get(`photos:${ph[1]}`, "json")) || [];
    const asset = `ph-${ph[1]}-${Date.now().toString(36)}`.slice(0, 80);
    const mode = url.searchParams.get("mode");
    const lang = url.searchParams.get("lang") === "pt" ? "pt" : "en";
    let analysis = null;
    if (mode === "identify" || (mode === "checkin" && list.length)) {
      const images = [];
      let prompt;
      if (mode === "checkin") {
        const prev = list[0];
        const pb = await storage.get(`asset:${prev.asset}`, "bytes");
        const pm = (await storage.get(`assetmeta:${prev.asset}`, "json"))?.mime || "image/jpeg";
        if (pb) images.push(toDataUrl(new Uint8Array(pb), pm));
        prompt = checkinPrompt(String(url.searchParams.get("name") || "plant").slice(0, 60), prev.at.slice(0, 10), lang);
      } else prompt = identifyPrompt(lang);
      images.push(toDataUrl(bytes, mime));
      try { analysis = sanitizeAnalysis(await visionJson({ apiKey: env.OPENROUTER_API_KEY, model: env.AI_MODEL, prompt, images, baseUrl: env.OPENROUTER_BASE_URL || undefined, referer: url.origin })); }
      catch (e) { analysis = { error: e.message }; }
    }
    await storage.put(`asset:${asset}`, bytes);
    await storage.put(`assetmeta:${asset}`, JSON.stringify({ mime, size: bytes.byteLength, at: new Date().toISOString() }));
    const entry = { asset, at: new Date().toISOString(), mode: mode || "photo", ...(analysis ? { analysis } : {}) };
    list.unshift(entry);
    for (const old of list.splice(MAX_PHOTOS)) { await storage.delete(`asset:${old.asset}`); await storage.delete(`assetmeta:${old.asset}`); }
    await storage.put(`photos:${ph[1]}`, JSON.stringify(list));
    return json(entry);
  }
  return null;
}
