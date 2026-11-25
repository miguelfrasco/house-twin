// Home Assistant: place entities in the house and see their live state.
// The HA URL and token are platform secrets; the browser only talks to this app's /api/ha proxy.
import * as THREE from "three";
import { getLang } from "../i18n.js";
import { ACTIONS, describe, validSpec } from "../profile/automation.js";
import { polygonCentroid } from "../engine/build3d.js";

let states = {}, live = false, placing = null, err = null, autos = null, autoErr = null;
const L = (pt, en) => (getLang() === "pt-PT" ? pt : en);
const gateIds = (ctx) => (ctx.profile.site?.features || []).filter((f) => f.type === "gate" && f.entity_id).map((f) => f.entity_id);
const norm = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const ICON = { light: "💡", switch: "⏻", sensor: "🌡", binary_sensor: "🚪", climate: "♨", camera: "📷", cover: "🪟", lock: "🔒", fan: "🌀", media_player: "🔊" };
const domain = (id) => id.split(".")[0];

function fmtState(s) {
  if (!s) return "—";
  const u = s.attributes?.unit_of_measurement;
  const pt = getLang() === "pt-PT";
  if (s.state === "on") return pt ? "ligado" : "on";
  if (s.state === "off") return pt ? "desligado" : "off";
  const COVER = { open: ["aberto", "open"], closed: ["fechado", "closed"], opening: ["a abrir", "opening"], closing: ["a fechar", "closing"], unavailable: ["indisponível", "unavailable"] };
  if (COVER[s.state]) return COVER[s.state][pt ? 0 : 1];
  const n = Number(s.state);
  if (Number.isFinite(n)) return `${new Intl.NumberFormat(pt ? "pt-PT" : "en-GB", { maximumFractionDigits: 1 }).format(n)}${u ? " " + u : ""}`;
  return s.state;
}

async function fetchStates(ctx) {
  const ha = ctx.profile.modules.homeassistant;
  err = null;
  if (ctx.api.demo || ctx.profile.demo) { states = structuredClone(ha.mock_states || {}); const saved = await ctx.api.getState("homeassistant"); Object.assign(states, saved.mock || {}); live = false; ctx.viewer.setGates(states); return; }
  try {
    const ids = [...(ha.entities || []).map((e) => e.entity_id), ...gateIds(ctx)].join(",");
    states = await ctx.api.get(`/api/ha/states?ids=${encodeURIComponent(ids)}`);
    live = true;
  } catch (e) { err = e.status === 503 ? "not_connected" : e.message; states = {}; live = false; }
  ctx.viewer.setGates(states);
}

async function setMock(ctx, entity_id, state) {
  states[entity_id] = { ...(states[entity_id] || { attributes: {} }), state };
  const saved = await ctx.api.getState("homeassistant");
  await ctx.api.setState("homeassistant", { ...saved, mock: { ...(saved.mock || {}), [entity_id]: states[entity_id] } });
}

/** Doors and gates: always ask first. */
async function moveCover(ctx, entity_id, label) {
  const open = ["open", "opening"].includes(states[entity_id]?.state);
  if (!confirm(open ? L(`Fechar ${label}?`, `Close ${label}?`) : L(`Abrir ${label}?`, `Open ${label}?`))) return;
  if (!live) await setMock(ctx, entity_id, open ? "closed" : "open");
  else {
    if (!ctx.api.owner) return;
    try { await ctx.api.post("/api/ha/service", { domain: "cover", service: open ? "close_cover" : "open_cover", entity_id, confirm: true }); } catch (e) { return ctx.toast(e.message); }
    setTimeout(async () => { await fetchStates(ctx); draw(ctx); ctx.refreshPanel(); }, 1500);
  }
  ctx.viewer.setGates(states); draw(ctx); ctx.refreshPanel();
}

// ---------- automations ----------
async function loadAutos(ctx) {
  autoErr = null;
  if (!live) { const saved = await ctx.api.getState("homeassistant"); autos = saved.autos || structuredClone(ctx.profile.modules.homeassistant.mock_automations || []); return; }
  try { autos = await ctx.api.get("/api/ha/automations"); } catch (e) { autos = []; autoErr = e.message; }
}
async function saveMockAutos(ctx) { const saved = await ctx.api.getState("homeassistant"); await ctx.api.setState("homeassistant", { ...saved, autos }); }

async function autoAction(ctx, a, what) {
  if (!live) {
    if (what === "toggle") a.state = a.state === "on" ? "off" : "on";
    if (what === "run") { a.last_triggered = new Date().toISOString(); for (const x of a.spec?.actions || []) { const d = x.entity_id.split(".")[0]; if (["light", "switch", "fan"].includes(d)) await setMock(ctx, x.entity_id, x.service === "turn_on" ? "on" : x.service === "turn_off" ? "off" : states[x.entity_id]?.state === "on" ? "off" : "on"); } draw(ctx); }
    if (what === "delete") autos = autos.filter((x) => x !== a);
    await saveMockAutos(ctx); return ctx.refreshPanel();
  }
  try {
    if (what === "toggle") await ctx.api.post("/api/ha/service", { domain: "automation", service: a.state === "on" ? "turn_off" : "turn_on", entity_id: a.entity_id });
    if (what === "run") await ctx.api.post("/api/ha/service", { domain: "automation", service: "trigger", entity_id: a.entity_id });
    if (what === "delete") await ctx.api.del(`/api/ha/automations/${encodeURIComponent(a.id)}`);
    ctx.toast(L("Feito", "Done"));
  } catch (e) { ctx.toast(e.message); }
  await loadAutos(ctx); ctx.refreshPanel();
}

function autoSheet(ctx, a) {
  const { esc } = ctx, pt = getLang() === "pt-PT";
  const ents = ctx.profile.modules.homeassistant.entities || [];
  const known = [...ents.map((e) => ({ id: e.entity_id, name: e.label })), ...gateIds(ctx).map((id) => ({ id, name: id }))];
  const targets = known.filter((e) => ACTIONS[e.id.split(".")[0]]);
  const spec = a?.spec ? structuredClone(a.spec) : { id: `ht_${Date.now().toString(36)}`, alias: "", trigger: { type: "sun", event: "sunset", offset_min: 0 }, actions: [{ entity_id: targets[0]?.id || "", service: "turn_on" }] };
  const V = { turn_on: L("Ligar", "Turn on"), turn_off: L("Desligar", "Turn off"), toggle: L("Alternar", "Toggle"), open_cover: L("Abrir", "Open"), close_cover: L("Fechar", "Close"), media_pause: L("Pausar", "Pause") };
  const sh = document.querySelector("#sheet");
  let named = !!a; // keep a typed name; otherwise the name follows the description
  const render = () => {
    const t = spec.trigger, act = spec.actions[0];
    sh.innerHTML = `<button class="close">✕</button><h2>${a ? L("Editar automação", "Edit automation") : L("Nova automação", "New automation")}</h2>
      <label class="f">${L("Nome", "Name")}</label><input id="aN" maxlength="80" value="${esc(spec.alias)}" placeholder="${L("p. ex. Luz da entrada ao anoitecer", "e.g. Porch light at dusk")}">
      <label class="f">${L("Quando", "When")}</label><select id="aT">
        <option value="sunset" ${t.type === "sun" && t.event === "sunset" ? "selected" : ""}>${L("Ao pôr do sol", "At sunset")}</option>
        <option value="sunrise" ${t.type === "sun" && t.event === "sunrise" ? "selected" : ""}>${L("Ao nascer do sol", "At sunrise")}</option>
        <option value="time" ${t.type === "time" ? "selected" : ""}>${L("A uma hora", "At a time")}</option>
        <option value="state" ${t.type === "state" ? "selected" : ""}>${L("Quando um dispositivo muda", "When a device changes")}</option></select>
      ${t.type === "sun" ? `<label class="f">${L("Desvio (min; negativo = antes)", "Offset (min; negative = before)")}</label><input id="aO" type="number" min="-180" max="180" step="5" value="${t.offset_min || 0}">` : ""}
      ${t.type === "time" ? `<label class="f">${L("Hora", "Time")}</label><input id="aH" type="time" value="${esc(t.at || "07:30")}">` : ""}
      ${t.type === "state" ? `<label class="f">${L("Dispositivo", "Device")}</label><select id="aE">${known.map((e) => `<option value="${esc(e.id)}" ${e.id === t.entity_id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select><label class="f">${L("Passa a", "Becomes")}</label><select id="aS">${["on", "off", "open", "closed", "home", "not_home"].map((v) => `<option ${v === t.to ? "selected" : ""}>${v}</option>`).join("")}</select>` : ""}
      <label class="f">${L("Fazer", "Do")}</label><div class="row"><select id="aV">${(ACTIONS[(act.entity_id || "").split(".")[0]] || ["turn_on"]).map((v) => `<option value="${v}" ${v === act.service ? "selected" : ""}>${esc(V[v] || v)}</option>`).join("")}</select>
      <select id="aX">${targets.map((e) => `<option value="${esc(e.id)}" ${e.id === act.entity_id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></div>
      ${targets.length ? "" : `<div class="note warn">${L("Coloque primeiro luzes ou interruptores na casa.", "Place some lights or switches in the house first.")}</div>`}
      <div class="note" id="aD"></div>
      <div class="row"><button class="btn primary" id="aSave">${L("Guardar no Home Assistant", "Save to Home Assistant")}</button></div>
      <div class="note">${live ? L("Fica guardada no Home Assistant e corre lá, mesmo com esta app fechada.", "It is stored in Home Assistant and runs there, even with this app closed.") : L("Demonstração: fica só neste browser.", "Demo: stays in this browser only.")}</div>`;
    sh.querySelector(".close").onclick = () => sh.classList.add("hidden");
    const v = (id) => sh.querySelector(id)?.value;
    const sync = () => {
      if (named) spec.alias = v("#aN") ?? spec.alias;
      const tt = v("#aT");
      spec.trigger = tt === "time" ? { type: "time", at: v("#aH") || "07:30" } : tt === "state" ? { type: "state", entity_id: v("#aE") || known[0]?.id || "", to: v("#aS") || "on" } : { type: "sun", event: tt, offset_min: Math.round(+(v("#aO") || 0)) };
      const ex = v("#aX") || "", svcs = ACTIONS[ex.split(".")[0]] || [];
      spec.actions = [{ entity_id: ex, service: svcs.includes(v("#aV")) ? v("#aV") : svcs[0] }];
      if (!named || !spec.alias.trim()) { spec.alias = describe(spec, pt, Object.fromEntries(known.map((e) => [e.id, e.name]))).slice(0, 80); const n = sh.querySelector("#aN"); if (n) n.value = spec.alias; }
      sh.querySelector("#aD").textContent = describe(spec, pt, Object.fromEntries(known.map((e) => [e.id, e.name])));
    };
    sh.querySelector("#aN").oninput = () => { named = !!sh.querySelector("#aN").value.trim(); };
    sh.querySelectorAll("input,select").forEach((x) => (x.onchange = () => { const re = ["aT", "aX"].includes(x.id); sync(); if (re) render(); }));
    sync();
    sh.querySelector("#aSave").onclick = async () => {
      sync();
      const bad = validSpec(spec);
      if (bad.length) return ctx.toast(L("Falta preencher: ", "Missing: ") + bad.join(", "));
      if (!live) {
        const i = autos.findIndex((x) => x.id === spec.id), row = { entity_id: `automation.${spec.id}`, id: spec.id, name: spec.alias, state: "on", last_triggered: null, spec };
        if (i >= 0) autos[i] = { ...autos[i], name: spec.alias, spec }; else autos.push(row);
        await saveMockAutos(ctx);
      } else {
        try { await ctx.api.put(`/api/ha/automations/${encodeURIComponent(spec.id)}`, spec); } catch (e) { return ctx.toast(e.message); }
        await new Promise((r) => setTimeout(r, 800)); await loadAutos(ctx);
      }
      sh.classList.add("hidden"); ctx.toast(L("Automação guardada", "Automation saved")); ctx.refreshPanel();
    };
  };
  render(); sh.classList.remove("hidden");
}

// ---------- areas: place devices by Home Assistant area ----------
async function placeByAreas(ctx) {
  let areas;
  try { areas = await ctx.api.get("/api/ha/areas"); } catch (e) { return ctx.toast(e.message); }
  const prof = structuredClone(ctx.profile);
  const ha = prof.modules.homeassistant; ha.entities ||= [];
  const have = new Set(ha.entities.map((e) => e.entity_id));
  const useful = /^(light|switch|fan|cover|climate|lock|media_player|sensor|binary_sensor|camera)\./;
  let n = 0, matched = 0;
  for (const a of areas) {
    let room = null, fl = null;
    for (const f of prof.floors) for (const r of f.rooms) if (norm(r.name) === norm(a.name) || (r.ha_area && r.ha_area === a.id)) { room = r; fl = f; }
    if (!room) continue;
    matched++;
    const [cx, cy] = polygonCentroid(room.polygon);
    const list = (a.entities || []).filter((e) => useful.test(e) && !have.has(e) && !/(_battery|_signal|_rssi|_linkquality|_update|_firmware)/.test(e)).slice(0, 8);
    list.forEach((e, i) => {
      const ang = (i / Math.max(1, list.length)) * Math.PI * 2, r = list.length > 1 ? 0.6 : 0;
      ha.entities.push({ id: `e${Date.now().toString(36)}${i}`, entity_id: e, label: e.split(".")[1].replace(/_/g, " ").slice(0, 60), kind: e.split(".")[0], floor: fl.id, pos: [Math.round((cx + Math.cos(ang) * r) * 100) / 100, Math.round((cy + Math.sin(ang) * r) * 100) / 100], area: a.name });
      have.add(e); n++;
    });
  }
  if (!n) return ctx.toast(L(`${matched} áreas correspondem a divisões; nada de novo para colocar.`, `${matched} areas match rooms; nothing new to place.`));
  await ctx.saveProfile(prof, L(`${n} dispositivos colocados pelas áreas do Home Assistant`, `${n} devices placed from Home Assistant areas`));
}

function draw(ctx) {
  const v = ctx.viewer;
  v.clearMarkers("ha"); v.removeLabels("ha");
  for (const e of ctx.profile.modules.homeassistant.entities || []) {
    const s = states[e.entity_id];
    const on = s?.state === "on";
    v.marker({ id: e.id, floorId: e.floor, pos: e.pos, y: 1.3, color: on ? 0xffd36b : 0x5ce1ff, kind: "ha", size: 0.16 });
    const f = ctx.floorById(e.floor);
    const l = v.addLabel(`${ICON[domain(e.entity_id)] || "•"} ${e.label}: ${fmtState(s)}`, new THREE.Vector3(e.pos[0], (f?.elevation || 0) + 1.65, e.pos[1]), e.floor, `mk ha${on ? " on" : ""}`);
    l.el.style.pointerEvents = "auto"; l.el.style.cursor = "pointer";
    l.el.onclick = () => toggle(ctx, e);
  }
  v.applyFocus();
}

async function toggle(ctx, e) {
  const d = domain(e.entity_id);
  if (d === "cover") return moveCover(ctx, e.entity_id, e.label);
  if (!["light", "switch", "fan"].includes(d)) return;
  const s = states[e.entity_id];
  const next = s?.state === "on" ? "off" : "on";
  if (!live) {
    states[e.entity_id] = { ...(s || { attributes: {} }), state: next };
    const saved = await ctx.api.getState("homeassistant");
    await ctx.api.setState("homeassistant", { ...saved, mock: { ...(saved.mock || {}), [e.entity_id]: states[e.entity_id] } });
  } else {
    if (!ctx.api.owner) return;
    await ctx.api.post("/api/ha/service", { domain: d, service: next === "on" ? "turn_on" : "turn_off", entity_id: e.entity_id });
    await fetchStates(ctx);
  }
  draw(ctx); ctx.refreshPanel();
}

async function pickEntity(ctx) {
  const pt = getLang() === "pt-PT";
  const sh = document.querySelector("#sheet");
  let list = [];
  try { list = await ctx.api.get("/api/ha/entities"); } catch { ctx.toast(ctx.t("ha_not_conn")); return; }
  sh.innerHTML = `<button class="close">✕</button><h2>${pt ? "Escolher entidade" : "Pick an entity"}</h2><input id="q" placeholder="${pt ? "Procurar…" : "Search…"}"><div class="list" id="ents" style="margin-top:10px"></div>`;
  sh.classList.remove("hidden");
  sh.querySelector(".close").onclick = () => sh.classList.add("hidden");
  const render = () => {
    const q = sh.querySelector("#q").value.toLowerCase();
    sh.querySelector("#ents").innerHTML = list.filter((x) => !q || x.entity_id.includes(q) || (x.name || "").toLowerCase().includes(q)).slice(0, 60)
      .map((x) => `<div class="card" data-id="${ctx.esc(x.entity_id)}" data-n="${ctx.esc(x.name || x.entity_id)}"><div class="ic">${ICON[domain(x.entity_id)] || "•"}</div><div class="bd"><b>${ctx.esc(x.name || x.entity_id)}</b><small>${ctx.esc(x.entity_id)}</small></div></div>`).join("");
    sh.querySelectorAll(".card").forEach((c) => (c.onclick = () => { placing = { entity_id: c.dataset.id, label: c.dataset.n.slice(0, 60) }; sh.classList.add("hidden"); ctx.hint(ctx.t("click_to_place")); }));
  };
  sh.querySelector("#q").oninput = render;
  render();
}

export default {
  id: "homeassistant",
  icon: "🏠",
  isPlacing: () => !!placing,
  async activate(ctx) { autos = null; await fetchStates(ctx); draw(ctx); loadAutos(ctx).then(() => ctx.state.module === "homeassistant" && ctx.refreshPanel()); },
  deactivate(ctx) { ctx.viewer.clearMarkers("ha"); ctx.viewer.removeLabels("ha"); placing = null; ctx.hint(null); },
  async onPick(ctx, pick) {
    if (placing && pick.pos) {
      const prof = structuredClone(ctx.profile);
      prof.modules.homeassistant.entities ||= [];
      prof.modules.homeassistant.entities.push({ id: `e${Date.now().toString(36)}`, entity_id: placing.entity_id, label: placing.label, kind: domain(placing.entity_id), floor: pick.floorId, pos: pick.pos.map((v) => Math.round(v * 100) / 100) });
      placing = null; ctx.hint(null);
      return ctx.saveProfile(prof);
    }
    if (pick.gate?.entity_id) { const f = (ctx.profile.site.features || []).find((x) => x.entity_id === pick.gate.entity_id); return moveCover(ctx, pick.gate.entity_id, f?.label || L("o portão", "the gate")); }
    if (pick.marker?.kind === "ha") { const e = ctx.profile.modules.homeassistant.entities.find((x) => x.id === pick.marker.markerId); if (e) toggle(ctx, e); }
  },
  panel(ctx, el) {
    const { t, esc } = ctx;
    const pt = getLang() === "pt-PT";
    const ents = ctx.profile.modules.homeassistant.entities || [];
    el.innerHTML = `<div class="kicker">${esc(t("ha_devices"))}</div>
      ${!live ? `<div class="note ${err ? "warn" : ""}">${esc(err === "not_connected" ? t("ha_not_conn") : err ? err : t("ha_demo"))}</div>` : ""}
      <div class="list" style="margin-top:10px">${ents.map((e) => { const s = states[e.entity_id]; const tg = ["light", "switch", "fan", "cover"].includes(domain(e.entity_id));
        return `<div class="card" data-id="${esc(e.id)}"><div class="ic">${ICON[domain(e.entity_id)] || "•"}</div><div class="bd"><b>${esc(e.label)}</b><small>${esc(ctx.floorById(e.floor)?.name || "")}</small></div><span class="val">${esc(fmtState(s))}</span>${tg ? `<button class="wbtn" data-tg="${esc(e.id)}">⏻</button>` : ""}</div>`; }).join("")}</div>
      ${ctx.api.owner && !ctx.api.demo ? `<div class="row"><button class="btn small" id="addEnt">＋ ${pt ? "Adicionar dispositivo" : "Add device"}</button><button class="btn small" id="byArea">${L("Colocar pelas áreas do HA", "Place by HA areas")}</button></div>` : ""}
      ${gateIds(ctx).length ? `<div class="kicker">${L("Portões e portas", "Gates and doors")}</div><div class="list">${(ctx.profile.site.features || []).filter((f) => f.type === "gate" && f.entity_id).map((f) => { const st = states[f.entity_id]?.state; return `<div class="card"><div class="ic">🚧</div><div class="bd"><b>${esc(f.label || f.entity_id)}</b><small>${esc(fmtState(states[f.entity_id]))}</small></div><button class="wbtn" data-gate="${esc(f.entity_id)}">${st === "open" ? "⬇" : "⬆"}</button></div>`; }).join("")}</div>` : ""}
      <div class="kicker">${L("Automações", "Automations")}</div>
      ${autos == null ? `<div class="note">${L("A carregar…", "Loading…")}</div>` : autoErr ? `<div class="note warn">${esc(autoErr)}</div>` : `<div class="list">${autos.map((a, i) => `<div class="card" style="display:block"><div style="display:flex;gap:10px;align-items:center"><div class="ic">⚙️</div><div class="bd"><b>${esc(a.name)}</b><small>${esc(a.spec ? describe(a.spec, pt, Object.fromEntries(ents.map((e) => [e.entity_id, e.label]))) : L("Feita no Home Assistant", "Made in Home Assistant"))}${a.last_triggered ? ` · ${L("última vez", "last run")} ${esc(new Date(a.last_triggered).toLocaleString(pt ? "pt-PT" : "en-GB", { dateStyle: "short", timeStyle: "short" }))}` : ""}</small></div>
        <label class="sw"><input type="checkbox" data-at="${i}" ${a.state === "on" ? "checked" : ""}><span></span></label></div>
        <div class="row"><button class="btn small" data-ar="${i}">▶ ${L("Correr agora", "Run now")}</button>${a.spec ? `<button class="btn small" data-ae="${i}">✎ ${L("Editar", "Edit")}</button><button class="btn small" data-ad="${i}">${L("Apagar", "Delete")}</button>` : ""}</div></div>`).join("") || `<div class="note">${L("Ainda sem automações.", "No automations yet.")}</div>`}</div>
      ${ctx.api.canWrite || !live ? `<button class="btn block" id="addAuto">＋ ${L("Nova automação", "New automation")}</button>` : ""}`}`;
    el.querySelectorAll("[data-gate]").forEach((b) => (b.onclick = () => moveCover(ctx, b.dataset.gate, (ctx.profile.site.features || []).find((f) => f.entity_id === b.dataset.gate)?.label || b.dataset.gate)));
    el.querySelectorAll("[data-at]").forEach((b) => (b.onchange = () => autoAction(ctx, autos[+b.dataset.at], "toggle")));
    el.querySelectorAll("[data-ar]").forEach((b) => (b.onclick = () => autoAction(ctx, autos[+b.dataset.ar], "run")));
    el.querySelectorAll("[data-ae]").forEach((b) => (b.onclick = () => autoSheet(ctx, autos[+b.dataset.ae])));
    el.querySelectorAll("[data-ad]").forEach((b) => (b.onclick = () => { if (confirm(L("Apagar esta automação?", "Delete this automation?"))) autoAction(ctx, autos[+b.dataset.ad], "delete"); }));
    el.querySelector("#addAuto")?.addEventListener("click", () => autoSheet(ctx, null));
    el.querySelector("#byArea")?.addEventListener("click", () => placeByAreas(ctx));
    el.querySelectorAll("[data-tg]").forEach((b) => (b.onclick = () => toggle(ctx, ents.find((x) => x.id === b.dataset.tg))));
    el.querySelector("#addEnt")?.addEventListener("click", () => pickEntity(ctx));
  },
};
