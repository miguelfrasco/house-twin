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

const ctx = {
  t, esc, api, $,
  profile: null,
  viewer: null,
  draft: false,
  state: { date: null, minutes: 720, floor: null, module: "sun" },
  exposureCache: new Map(),
  toast(msg, ms = 2400) { const el = $("#toast"); el.textContent = msg; el.classList.remove("hidden"); clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.add("hidden"), ms); },
  hint(msg) { const el = $("#hint"); if (!msg) return el.classList.add("hidden"); el.textContent = msg; el.classList.remove("hidden"); },
  get tz() { return this.profile?.location?.timezone || "UTC"; },
  get hasLocation() { const l = this.profile?.location; return l && l.lat != null && l.lon != null; },
  timeMs() { return zonedMidnight(this.state.date, this.tz) + this.state.minutes * 6e4; },
  sun() { const l = this.profile.location; return this.hasLocation ? sunPosition(this.timeMs(), l.lat, l.lon) : { az: 135, el: 40 }; },
  floorById(id) { return this.profile.floors.find((f) => f.id === id); },
  /** Exposure for one floor and the current date (cached). */
  async exposure(floorId, onProgress) {
    const key = `${floorId}|${this.state.date}`;
    if (this.exposureCache.has(key)) return this.exposureCache.get(key);
    const floor = this.floorById(floorId);
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
};
window.__ht = ctx; // handy for debugging and the e2e checks

async function reload() {
  await ctx.viewer.load(ctx.profile, (a) => api.assetUrl(a));
  renderChrome();
  applySun();
  await activate(ctx.state.module, true);
}

function renderChrome() {
  const p = ctx.profile;
  $("#houseName").textContent = p.name;
  const sub = api.demo ? (ctx.draft ? (getLang() === "pt-PT" ? "Rascunho neste browser" : "Draft in this browser") : t("demo_note")) : (p.location?.timezone || "");
  $("#houseSub").textContent = sub;
  $("#langBtn").textContent = getLang() === "pt-PT" ? "EN" : "PT";
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  // module tabs
  const tabs = $("#modTabs");
  tabs.innerHTML = "";
  for (const m of MODULES) {
    if (m.id !== "sun" && !p.modules?.[m.id]?.enabled) continue;
    const b = document.createElement("button");
    b.className = `mod${ctx.state.module === m.id ? " active" : ""}`;
    b.innerHTML = `<span>${m.icon}</span><span>${esc(t(m.id))}</span>`;
    b.onclick = () => activate(m.id);
    tabs.appendChild(b);
  }
  // floors
  const fb = $("#floorBar");
  fb.innerHTML = "";
  const mk = (id, label) => { const b = document.createElement("button"); b.textContent = label; b.className = ctx.state.floor === id ? "on" : ""; b.onclick = () => setFloor(id); fb.appendChild(b); };
  if (p.roofs?.length) { const b = document.createElement("button"); b.textContent = t("roof"); b.id = "roofBtn"; b.onclick = () => { setFloor(null); ctx.viewer.roofView(); }; fb.appendChild(b); }
  mk(null, t("all_floors"));
  [...p.floors].reverse().forEach((f) => mk(f.id, f.name));
}

function setFloor(id) {
  ctx.state.floor = id;
  ctx.viewer.setFocus(id);
  renderChrome();
  current()?.onFloor?.(ctx);
  renderPanel();
}

function current() { return MODULES.find((m) => m.id === ctx.state.module); }

async function activate(id, force = false) {
  const prev = current();
  if (prev && (prev.id !== id || force)) prev.deactivate?.(ctx);
  ctx.state.module = id;
  renderChrome();
  ctx.viewer.onPick = (pick) => current()?.onPick?.(ctx, pick);
  await current().activate?.(ctx);
  ctx.viewer.applyFocus();
  renderPanel();
}

function renderPanel() {
  const el = $("#panel");
  el.innerHTML = "";
  current()?.panel?.(ctx, el);
  if (api.demo) {
    const n = document.createElement("div");
    n.className = "note";
    n.innerHTML = `<b>${esc(t("demo"))}.</b> ${esc(t("demo_note"))} ${getLang() === "pt-PT" ? "Pode experimentar o assistente e o editor: tudo o que guardar fica só neste browser." : "Try the wizard and the editor: anything you save stays in this browser only."}`;
    el.appendChild(n);
  }
}

function applySun() {
  const s = ctx.sun();
  ctx.viewer.setSun(s);
  const h = Math.floor(ctx.state.minutes / 60), m = ctx.state.minutes % 60;
  $("#timeLbl").textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  current()?.onSun?.(ctx, s);
}

function nowLocal() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(Date.now());
  const g = (k) => +parts.find((p) => p.type === k).value;
  return g("hour") * 60 + g("minute");
}

function bindChrome() {
  $("#dateIn").onchange = (e) => { ctx.state.date = e.target.value || todayIn(ctx.tz); applySun(); current()?.onDate?.(ctx); renderPanel(); };
  $("#timeIn").oninput = (e) => { ctx.state.minutes = +e.target.value; applySun(); };
  $("#nowBtn").onclick = () => { ctx.state.date = todayIn(ctx.tz); ctx.state.minutes = nowLocal(); $("#dateIn").value = ctx.state.date; $("#timeIn").value = ctx.state.minutes; applySun(); current()?.onDate?.(ctx); renderPanel(); };
  $("#langBtn").onclick = () => { setLang(getLang() === "pt-PT" ? "en" : "pt-PT"); renderChrome(); renderPanel(); };
  $("#editBtn").onclick = async () => {
    if (!api.canWrite) return ctx.toast(t("login"));
    const { openEditor } = await import("./editor/editor.js");
    openEditor(ctx);
  };
  $("#menuBtn").onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  document.addEventListener("click", (e) => { if (!$("#menu").contains(e.target)) $("#menu").classList.add("hidden"); });
}

function toggleMenu() {
  const m = $("#menu");
  if (!m.classList.contains("hidden")) return m.classList.add("hidden");
  const pt = getLang() === "pt-PT";
  const items = [];
  if (api.canWrite) items.push([`🧭 ${t("setup")}`, async () => (await import("./wizard/wizard.js")).openWizard(ctx)]);
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
  if (qs.has("module")) ctx.state.module = qs.get("module");
  $("#dateIn").value = ctx.state.date;
  $("#timeIn").value = ctx.state.minutes;
  await reload();
  if (qs.has("floor")) setFloor(qs.get("floor"));
  $("#loading").classList.add("done");
  window.__appReady = true;
  if (qs.get("wizard") === "1") (await import("./wizard/wizard.js")).openWizard(ctx);
  if (qs.get("editor") === "1") (await import("./editor/editor.js")).openEditor(ctx);
}

function renderChromeEmpty() {
  $("#houseName").textContent = t("app");
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  $("#langBtn").textContent = getLang() === "pt-PT" ? "EN" : "PT";
}

boot().catch((e) => {
  console.error(e);
  const l = $("#loading");
  l.innerHTML = `<div class="glass note warn" style="max-width:420px">${esc(e.message || e)}</div>`;
});
export { ctx };
