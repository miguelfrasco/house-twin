// App shell: loads config + profile, hosts the viewer, the time bar, floors and modules.
import { Viewer } from "./engine/viewer.js";
import { sunPosition, sunTimes, todayIn, zonedMidnight } from "./engine/sun.js";
import { computeExposure } from "./engine/exposure.js";
import { migrate, validate } from "./profile/profile.js";
import { t, setLang, getLang } from "./i18n.js";
import { api } from "./api.js";
import { MODULES } from "./modules/index.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Layers stack in one 3D scene (like the house app): any mix can be on. Furniture is a tool, not a layer.
const LAYERS = ["sun", "plants", "wifi", "homeassistant", "solar", "cameras"];
const DEFAULT_OFF = new Set(["wifi"]); // two heat maps on one floor are unreadable; Wi-Fi joins when asked
// marker kind -> module that owns it (a click on a marker opens that module's details)
const OWNER = { plant: "plants", ap: "wifi", survey: "wifi", ha: "homeassistant" };

const ctx = {
  t, esc, api, $,
  profile: null,
  viewer: null,
  draft: false,
  // module = the layer whose details the panel shows ("focus"); layers = what is drawn
  state: { date: null, minutes: 720, floor: null, module: "sun", layers: new Set(), panel: false },
  surface: "sun", // which heat map owns the floors: "sun" or "wifi"
  exposureCache: new Map(),
  toast(msg, ms = 2400) { const el = $("#toast"); el.textContent = msg; el.classList.remove("hidden"); clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.add("hidden"), ms); },
  hint(msg) { const el = $("#hint"); if (!msg) return el.classList.add("hidden"); el.textContent = msg; el.classList.remove("hidden"); },
  get tz() { return this.profile?.location?.timezone || "UTC"; },
  get hasLocation() { const l = this.profile?.location; return l && l.lat != null && l.lon != null; },
  timeMs() { return zonedMidnight(this.state.date, this.tz) + this.state.minutes * 6e4; },
  sun() { const l = this.profile.location; return this.hasLocation ? sunPosition(this.timeMs(), l.lat, l.lon) : { az: 135, el: 40 }; },
  floorById(id) { return this.profile.floors.find((f) => f.id === id); },
  isOn(id) { return this.state.layers.has(id); },
  /** Exposure for one floor and the current date (cached). */
  async exposure(floorId, onProgress) {
    const key = `${floorId}|${this.state.date}`;
    if (this.exposureCache.has(key)) return this.exposureCache.get(key);
    const floor = this.floorById(floorId);
    if (!floor) return null; // the profile changed while a module was still loading
    const extra = [];
    if (floor === this.profile.floors[0] && this.profile.site?.garden) extra.push({ id: "_garden", poly: this.profile.site.garden });
    const p = computeExposure({ profile: this.profile, floor, occluders: this.viewer.house.occluders, date: this.state.date, extraPolys: extra, cell: 0.5, onProgress });
    this.exposureCache.set(key, p);
    return p;
  },
  async saveProfile(p, msg) {
    const v = validate(p);
    if (!v.ok) { this.toast(v.errors[0]); throw new Error(v.errors.join("; ")); }
    const r = await api.saveProfile(p);
    this.profile = p;
    this.exposureCache.clear();
    if (api.demo) this.draft = true;
    this.toast(msg || (r.local ? t("demo_saved_local") : t("saved")));
    await reload();
  },
  refreshPanel() { renderPanel(); },
  setFloor(id) { setFloor(id); },
  setLayer(id, on) { return setLayer(id, on); },
  focus(id, open) { focus(id, open); },
  openPanel(open = true) { openPanel(open); },
};
window.__ht = ctx; // handy for debugging and the e2e checks

const mod = (id) => MODULES.find((m) => m.id === id);
const available = () => LAYERS.filter((id) => id === "sun" || ctx.profile?.modules?.[id]?.enabled);
const activeMods = () => MODULES.filter((m) => ctx.state.layers.has(m.id) || (m.id === ctx.state.module && m.tool));
const each = (fn, ...a) => { for (const m of activeMods()) { try { m[fn]?.(ctx, ...a); } catch (e) { console.error(m.id, fn, e); } } };

function loadLayers(qs) {
  const avail = available();
  let want;
  if (qs?.has("layers")) want = qs.get("layers").split(",").filter(Boolean);
  else { try { want = JSON.parse(localStorage.getItem("ht_layers") || "null"); } catch { want = null; } }
  if (!Array.isArray(want)) want = avail.filter((id) => !DEFAULT_OFF.has(id));
  ctx.state.layers = new Set(want.filter((id) => avail.includes(id)));
  ctx._layersLoaded = true;
  if (qs?.has("module") && avail.includes(qs.get("module"))) ctx.state.layers.add(qs.get("module"));
  pickSurface();
}
const saveLayers = () => localStorage.setItem("ht_layers", JSON.stringify([...ctx.state.layers]));

/** The sun heat map and the Wi-Fi heat map share the floors: the last one asked for wins. */
function pickSurface(prefer) {
  const on = (id) => ctx.state.layers.has(id);
  if (prefer && on(prefer)) ctx.surface = prefer;
  else if (!on(ctx.surface)) ctx.surface = on("wifi") && !on("sun") ? "wifi" : on("sun") ? "sun" : on("wifi") ? "wifi" : null;
}

async function reload() {
  if (!ctx._layersLoaded) loadLayers(null); // first save after setup
  each("deactivate");
  await ctx.viewer.load(ctx.profile, (a) => api.assetUrl(a));
  for (const id of [...ctx.state.layers]) if (!available().includes(id)) ctx.state.layers.delete(id);
  pickSurface();
  ctx.viewer.pvVisible = ctx.state.layers.has("solar");
  renderChrome();
  applySun();
  await Promise.all(activeMods().map((m) => Promise.resolve(m.activate?.(ctx)).catch((e) => console.error(m.id, e))));
  ctx.viewer.onPick = routePick;
  ctx.viewer.applyFocus();
  renderPanel();
}

function renderChrome() {
  const p = ctx.profile;
  const pt = getLang() === "pt-PT";
  $("#houseName").textContent = p.name;
  const sub = api.demo ? (ctx.draft ? (pt ? "Rascunho neste browser" : "Draft in this browser") : t("demo_note")) : (p.location?.timezone || "");
  $("#houseSub").textContent = sub;
  $("#langBtn").textContent = pt ? "EN" : "PT";
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  // layer filters (multi-select)
  const bar = $("#layerBar");
  bar.classList.remove("hidden"); $("#detailsBtn").classList.remove("hidden");
  bar.innerHTML = `<span class="fl-lbl">${esc(t("show"))}</span>`;
  for (const id of available()) {
    const m = mod(id), on = ctx.state.layers.has(id);
    const b = document.createElement("button");
    b.className = `fl${on ? " on" : ""}`;
    b.dataset.layer = id;
    b.setAttribute("aria-pressed", on);
    b.innerHTML = `<span aria-hidden="true">${m.icon}</span><span>${esc(t(id === "homeassistant" ? "homeassistant_layer" : id))}</span>`;
    b.onclick = () => setLayer(id, !ctx.state.layers.has(id));
    bar.appendChild(b);
  }
  // floors
  const fb = $("#floorBar");
  fb.innerHTML = "";
  const roofOn = ctx.viewer.view === "roof";
  const mk = (id, label) => { const b = document.createElement("button"); b.textContent = label; b.className = !roofOn && ctx.state.floor === id ? "on" : ""; b.onclick = () => setFloor(id); fb.appendChild(b); };
  if (p.roofs?.length) { const b = document.createElement("button"); b.textContent = t("roof"); b.id = "roofBtn"; b.className = roofOn ? "on" : ""; b.onclick = () => { setFloor(null); ctx.viewer.roofView(); renderChrome(); }; fb.appendChild(b); }
  mk(null, t("all_floors"));
  [...p.floors].reverse().forEach((f) => mk(f.id, f.name));
  $("#detailsBtn").querySelector("span:last-child").textContent = t("details");
}

function setFloor(id) {
  ctx.state.floor = id;
  ctx.viewer.setFocus(id);
  renderChrome();
  each("onFloor");
  renderPanel();
}

async function setLayer(id, on) {
  const m = mod(id);
  if (!m || on === ctx.state.layers.has(id)) return;
  if (on) {
    ctx.state.layers.add(id);
    if (id === "sun" || id === "wifi") pickSurface(id); else pickSurface();
    ctx.state.module = id; // what you just turned on is what the details show
  } else {
    ctx.state.layers.delete(id);
    try { m.deactivate?.(ctx); } catch (e) { console.error(e); }
    pickSurface();
    if (ctx.state.module === id) ctx.state.module = ctx.state.layers.has("sun") ? "sun" : [...ctx.state.layers][0] || "sun";
  }
  saveLayers();
  ctx.viewer.pvVisible = ctx.state.layers.has("solar");
  renderChrome();
  if (on) { await m.activate?.(ctx); m.onSun?.(ctx, ctx.sun()); }
  each("onLayers"); // e.g. the sun and Wi-Fi heat maps hand the floors to each other
  ctx.viewer.applyFocus();
  renderPanel();
}

/** Show one layer's (or tool's) details in the panel. */
async function focus(id, open = true) {
  const prev = mod(ctx.state.module);
  if (prev?.tool && prev.id !== id) prev.deactivate?.(ctx);
  ctx.state.module = id;
  const m = mod(id);
  if (m?.tool && prev?.id !== id) await m.activate?.(ctx);
  if ((id === "sun" || id === "wifi") && ctx.state.layers.has(id) && ctx.surface !== id) { pickSurface(id); each("onLayers"); }
  if (open) openPanel(true); else renderPanel();
}

function openPanel(open) {
  ctx.state.panel = open;
  localStorage.setItem("ht_panel", open ? "1" : "0");
  document.body.classList.toggle("panel-open", open);
  $("#panel").inert = !open;
  $("#detailsBtn").inert = open;
  $("#detailsBtn").setAttribute("aria-expanded", open);
  if (!open && mod(ctx.state.module)?.tool) { mod(ctx.state.module).deactivate?.(ctx); ctx.state.module = [...ctx.state.layers][0] || "sun"; }
  renderPanel();
}

/** A click in the scene: a module that is placing something gets it first, then the owner of a marker, then the focus. */
function routePick(pick) {
  const placing = MODULES.find((m) => m.isPlacing?.() && (ctx.state.layers.has(m.id) || m.id === ctx.state.module));
  if (placing) return placing.onPick?.(ctx, pick);
  if (pick.marker) {
    const owner = OWNER[pick.marker.kind];
    if (owner && ctx.state.module !== owner) focus(owner, ctx.state.panel);
    return mod(owner || ctx.state.module)?.onPick?.(ctx, pick);
  }
  if (pick.gate && ctx.state.layers.has("homeassistant")) return mod("homeassistant").onPick?.(ctx, pick);
  return mod(ctx.state.module)?.onPick?.(ctx, pick);
}

function renderPanel() {
  const el = $("#panel");
  if (!ctx.state.panel) { el.innerHTML = ""; return; }
  const pt = getLang() === "pt-PT";
  const tabs = [...available().filter((id) => ctx.state.layers.has(id))];
  if (ctx.profile.modules?.furniture?.enabled && api.canWrite) tabs.push("furniture");
  if (!tabs.includes(ctx.state.module) && !mod(ctx.state.module)?.tool) ctx.state.module = tabs[0] || "sun";
  el.innerHTML = `<div class="pn-head"><div class="seg pn-tabs" role="tablist">${tabs.map((id) => `<button role="tab" data-focus="${id}" aria-selected="${id === ctx.state.module}" class="${id === ctx.state.module ? "on" : ""}" title="${esc(t(id === "homeassistant" ? "homeassistant_layer" : id))}"><span aria-hidden="true">${mod(id).icon}</span><span class="pn-tl">${esc(t(id === "homeassistant" ? "homeassistant_layer" : id))}</span></button>`).join("")}</div>
    <button class="pn-close" id="panelClose" aria-label="${esc(t("close"))}">✕</button></div><div class="pn-body"></div>`;
  el.querySelectorAll("[data-focus]").forEach((b) => (b.onclick = () => focus(b.dataset.focus, true)));
  el.querySelector("#panelClose").onclick = () => openPanel(false);
  const body = el.querySelector(".pn-body");
  const m = mod(ctx.state.module);
  if (!tabs.length) body.innerHTML = `<div class="note">${esc(t("no_layers"))}</div>`;
  else if (m && (ctx.state.layers.has(m.id) || m.tool)) m.panel?.(ctx, body);
  if (api.demo) {
    const n = document.createElement("div");
    n.className = "note";
    n.innerHTML = `<b>${esc(t("demo"))}.</b> ${esc(t("demo_note"))} ${pt ? "Pode experimentar o guia de configuração e o editor: tudo o que guardar fica só neste browser." : "Try the setup guide and the editor: anything you save stays in this browser only."}`;
    body.appendChild(n);
  }
}

function applySun() {
  const s = ctx.sun();
  ctx.viewer.setSun(s);
  const h = Math.floor(ctx.state.minutes / 60), m = ctx.state.minutes % 60;
  $("#timeLbl").textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  each("onSun", s);
}

function nowLocal() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(Date.now());
  const g = (k) => +parts.find((p) => p.type === k).value;
  return g("hour") * 60 + g("minute");
}

function bindChrome() {
  $("#dateIn").onchange = (e) => { ctx.state.date = e.target.value || todayIn(ctx.tz); applySun(); each("onDate"); renderPanel(); };
  $("#timeIn").oninput = (e) => { ctx.state.minutes = +e.target.value; applySun(); };
  $("#nowBtn").onclick = () => { ctx.state.date = todayIn(ctx.tz); ctx.state.minutes = nowLocal(); $("#dateIn").value = ctx.state.date; $("#timeIn").value = ctx.state.minutes; applySun(); each("onDate"); renderPanel(); };
  $("#langBtn").onclick = () => { setLang(getLang() === "pt-PT" ? "en" : "pt-PT"); renderChrome(); renderPanel(); };
  $("#editBtn").onclick = async () => {
    if (!api.canWrite) return ctx.toast(t("login"));
    const { openEditor } = await import("./editor/editor.js");
    openEditor(ctx);
  };
  $("#detailsBtn").onclick = () => openPanel(true);
  $("#menuBtn").onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  document.addEventListener("click", (e) => { if (!$("#menu").contains(e.target)) $("#menu").classList.add("hidden"); });
}

function toggleMenu() {
  const m = $("#menu");
  if (!m.classList.contains("hidden")) return m.classList.add("hidden");
  const pt = getLang() === "pt-PT";
  const items = [];
  if (api.canWrite) items.push([`🧭 ${t("setup")}`, async () => (await import("./wizard/wizard.js")).openWizard(ctx)]);
  if (ctx.profile && api.canWrite && ctx.profile.modules?.furniture?.enabled) items.push([`🛋 ${t("furniture_tool")}`, () => focus("furniture", true)]);
  if (ctx.profile) {
    const half = (ctx.profile.display?.walls ?? "half") === "half";
    items.push([half ? `▮ ${t("walls_full")}` : `▯ ${t("walls_half")}`, () => setWalls(half ? "full" : "half")]);
  }
  items.push([`⬇ ${t("export_scrubbed")}`, () => exportProfile(true)]);
  if (api.owner || api.demo) items.push([`🔒 ${t("export_full")}`, () => exportProfile(false)]);
  if (api.demo && ctx.draft) items.push([pt ? "↺ Voltar à casa de demonstração" : "↺ Back to the demo house", async () => { api.dropDraft(); ctx.draft = false; const r = await api.loadProfile({ preferDraft: false }); ctx.profile = migrate(r.profile); ctx.exposureCache.clear(); await reload(); }]);
  if (!api.demo && api.owner) items.push([`⎋ ${t("logout")}`, async () => { await api.post("/api/logout"); location.reload(); }]);
  if (!api.demo && !api.owner) items.push([`🔑 ${t("login")}`, () => showLogin()]);
  m.innerHTML = "";
  for (const [label, fn] of items) { const b = document.createElement("button"); b.textContent = label; b.onclick = () => { m.classList.add("hidden"); fn(); }; m.appendChild(b); }
  const s = document.createElement("div"); s.className = "sep"; m.appendChild(s);
  const sm = document.createElement("small"); sm.textContent = `${t("privacy")}: ${t("privacy_line")}`; m.appendChild(sm);
  m.classList.remove("hidden");
}

/** Try the other wall style on this device; owners can keep it (saved in the profile). */
async function setWalls(mode) {
  const p = structuredClone(ctx.profile);
  p.display = { ...(p.display || {}), walls: mode };
  if (api.canWrite && !api.demo) return ctx.saveProfile(p);
  ctx.profile = p; ctx.exposureCache.clear(); await reload();
}

async function exportProfile(scrubbed) {
  const { scrub } = await import("./profile/profile.js");
  const data = scrubbed ? scrub(ctx.profile) : ctx.profile;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = scrubbed ? "house.shared.profile.json" : "house.profile.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function showLogin() {
  const sh = $("#sheet");
  sh.innerHTML = `<button class="close" aria-label="${esc(t("close"))}">✕</button><h2>${esc(t("login"))}</h2>
    <label class="f">${esc(t("password"))}</label><input type="password" id="pw" autocomplete="current-password">
    <div class="row"><button class="btn primary" id="go">${esc(t("login"))}</button></div><div class="note hidden" id="err"></div>`;
  sh.classList.remove("hidden");
  sh.querySelector(".close").onclick = () => sh.classList.add("hidden");
  const go = async () => {
    try { await api.post("/api/login", { password: sh.querySelector("#pw").value }); location.reload(); }
    catch (e) { const er = sh.querySelector("#err"); const pt = getLang() === "pt-PT"; er.textContent = e.status === 429 ? (pt ? "Demasiadas tentativas. Aguarde um minuto." : "Too many attempts. Wait a minute.") : (pt ? "Palavra-passe errada." : "Wrong password."); er.classList.remove("hidden"); }
  };
  sh.querySelector("#go").onclick = go;
  sh.querySelector("#pw").onkeydown = (e) => e.key === "Enter" && go();
  sh.querySelector("#pw").focus();
}

async function boot() {
  const qs = new URLSearchParams(location.search);
  if (qs.get("lang")) setLang(qs.get("lang") === "pt" ? "pt-PT" : qs.get("lang"));
  await api.init();
  ctx.viewer = new Viewer($("#scene"), $("#labels"));
  bindChrome();
  const r = await api.loadProfile();
  if (r.needsLogin) { $("#loading").classList.add("done"); renderChromeEmpty(); showLogin(); return; }
  if (r.needsSetup) {
    $("#loading").classList.add("done");
    renderChromeEmpty();
    const { openWizard } = await import("./wizard/wizard.js");
    return openWizard(ctx, { firstRun: true });
  }
  ctx.profile = migrate(r.profile);
  ctx.draft = r.draft;
  if (ctx.profile.locale && !localStorage.getItem("ht_lang") && !qs.get("lang")) setLang(ctx.profile.locale);
  ctx.state.date = qs.get("date") || todayIn(ctx.tz);
  ctx.state.minutes = qs.has("time") ? +qs.get("time") : nowLocal();
  loadLayers(qs);
  if (qs.has("module")) ctx.state.module = qs.get("module");
  ctx.state.panel = qs.has("panel") ? qs.get("panel") === "1" : qs.has("module") || localStorage.getItem("ht_panel") === "1";
  $("#dateIn").value = ctx.state.date;
  $("#timeIn").value = ctx.state.minutes;
  await reload();
  openPanel(ctx.state.panel);
  if (ctx.state.module === "furniture") await focus("furniture", true);
  if (qs.has("floor")) setFloor(qs.get("floor"));
  if (qs.get("view") === "roof") { ctx.viewer.roofView(); renderChrome(); }
  $("#loading").classList.add("done");
  window.__appReady = true;
  if (qs.get("wizard") === "1") (await import("./wizard/wizard.js")).openWizard(ctx);
  if (qs.get("editor") === "1") (await import("./editor/editor.js")).openEditor(ctx);
}

function renderChromeEmpty() {
  $("#detailsBtn").classList.add("hidden"); $("#layerBar").classList.add("hidden");
  $("#houseName").textContent = t("app");
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  $("#langBtn").textContent = getLang() === "pt-PT" ? "EN" : "PT";
}

boot().catch((e) => {
  console.error(e);
  const l = $("#loading");
  l.innerHTML = `<div class="glass note warn" style="max-width:420px">${esc(e.message || e)}</div>`;
});
export { ctx, reload };
