// Browser side of plant care: watering log, photos (+ AI identify / check-in) and push reminders.
// Owner: everything goes through the server. Demo: kept in this browser; AI uses the tab's own OpenRouter key.
import { cleanImage } from "../api.js";
import { identifyPrompt, checkinPrompt, sanitizeAnalysis } from "../profile/plantcare.js";
import { extractJson } from "../profile/plan-ai.js";

const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };

export async function water(ctx, ids, day) {
  if (ctx.api.demo) {
    const st = await ctx.api.getState("plants");
    st.waterings = { ...(st.waterings || {}) };
    for (const id of ids) st.waterings[id] = day;
    await ctx.api.setState("plants", st);
    const log = ls.get("ht_plant_log", []);
    for (const id of ids) log.unshift({ id, at: new Date().toISOString(), day });
    ls.set("ht_plant_log", log.slice(0, 300));
    return st.waterings;
  }
  return (await ctx.api.post("/api/plants/water", { ids, date: day })).waterings;
}

export async function waterLog(ctx, plantId) {
  if (ctx.api.demo) return ls.get("ht_plant_log", []).filter((e) => !plantId || e.id === plantId).slice(0, 60);
  return ctx.api.get(`/api/plants/log${plantId ? `?plant=${encodeURIComponent(plantId)}` : ""}`);
}

export async function photos(ctx, plantId) {
  if (ctx.api.demo) return ls.get(`ht_photos_${plantId}`, []);
  return ctx.api.get(`/api/plants/${encodeURIComponent(plantId)}/photos`);
}

export const photoUrl = (e) => e.dataUrl || `/api/assets/${encodeURIComponent(e.asset)}`;

async function browserVision(prompt, images) {
  const key = sessionStorage.getItem("ht_or_key");
  if (!key) throw new Error("no_key");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images.map((u) => ({ type: "image_url", image_url: { url: u } }))] }] }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
  return extractJson((await r.json()).choices?.[0]?.message?.content);
}

/** mode: "photo" | "identify" | "checkin". Returns the stored entry (with .analysis for AI modes). */
export async function addPhoto(ctx, plant, file, mode, lang) {
  const img = await cleanImage(file, ctx.api.demo ? 720 : 1600, "image/jpeg");
  if (ctx.api.demo) {
    const list = ls.get(`ht_photos_${plant.id}`, []);
    let analysis;
    if (mode === "identify" || (mode === "checkin" && list.length)) {
      try {
        const prompt = mode === "identify" ? identifyPrompt(lang) : checkinPrompt(plant.name, list[0].at.slice(0, 10), lang);
        analysis = sanitizeAnalysis(await browserVision(prompt, mode === "identify" ? [img.dataUrl] : [list[0].dataUrl, img.dataUrl]));
      } catch (e) { analysis = { error: e.message }; }
    }
    const entry = { dataUrl: img.dataUrl, at: new Date().toISOString(), mode, ...(analysis ? { analysis } : {}) };
    list.unshift(entry);
    try { ls.set(`ht_photos_${plant.id}`, list.slice(0, 6)); } catch { ls.set(`ht_photos_${plant.id}`, list.slice(0, 2)); }
    return entry;
  }
  const blob = await (await fetch(img.dataUrl)).blob();
  const q = new URLSearchParams({ mode, lang, name: plant.species || plant.name });
  const r = await fetch(`/api/plants/${encodeURIComponent(plant.id)}/photos?${q}`, { method: "POST", body: blob, headers: { "content-type": "image/jpeg" }, credentials: "same-origin" });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
}

// ---- push reminders -----------------------------------------------------------------------
const b64uToBytes = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : Notification.permission === "denied" ? "denied" : "off";
}

export async function enablePush(ctx, hour = 9, lang = "en") {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("permission");
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  reg.active?.postMessage({ lang });
  const { publicKey } = await ctx.api.get("/api/push/key");
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) }));
  await ctx.api.post("/api/push/subscribe", { subscription: sub.toJSON(), hour });
  return true;
}

export async function disablePush(ctx) {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await ctx.api.post("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
}
