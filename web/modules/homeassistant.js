// Home Assistant: place entities in the house and see their live state.
// The HA URL and token are platform secrets; the browser only talks to this app's /api/ha proxy.
import * as THREE from "three";
import { getLang } from "../i18n.js";

let states = {}, live = false, placing = null, err = null;
const ICON = { light: "💡", switch: "⏻", sensor: "🌡", binary_sensor: "🚪", climate: "♨", camera: "📷", cover: "🪟", lock: "🔒", fan: "🌀", media_player: "🔊" };
const domain = (id) => id.split(".")[0];

function fmtState(s) {
  if (!s) return "—";
  const u = s.attributes?.unit_of_measurement;
  const pt = getLang() === "pt-PT";
  if (s.state === "on") return pt ? "ligado" : "on";
  if (s.state === "off") return pt ? "desligado" : "off";
  const n = Number(s.state);
  if (Number.isFinite(n)) return `${new Intl.NumberFormat(pt ? "pt-PT" : "en-GB", { maximumFractionDigits: 1 }).format(n)}${u ? " " + u : ""}`;
  return s.state;
}

async function fetchStates(ctx) {
  const ha = ctx.profile.modules.homeassistant;
  err = null;
  if (ctx.api.demo || ctx.profile.demo) { states = structuredClone(ha.mock_states || {}); const saved = await ctx.api.getState("homeassistant"); Object.assign(states, saved.mock || {}); live = false; return; }
  try {
    const ids = (ha.entities || []).map((e) => e.entity_id).join(",");
    states = await ctx.api.get(`/api/ha/states?ids=${encodeURIComponent(ids)}`);
    live = true;
  } catch (e) { err = e.status === 503 ? "not_connected" : e.message; states = {}; live = false; }
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
  async activate(ctx) { await fetchStates(ctx); draw(ctx); },
  deactivate(ctx) { ctx.viewer.clearMarkers("ha"); ctx.viewer.removeLabels("ha"); placing = null; ctx.hint(null); },
  async onPick(ctx, pick) {
    if (placing && pick.pos) {
      const prof = structuredClone(ctx.profile);
      prof.modules.homeassistant.entities ||= [];
      prof.modules.homeassistant.entities.push({ id: `e${Date.now().toString(36)}`, entity_id: placing.entity_id, label: placing.label, kind: domain(placing.entity_id), floor: pick.floorId, pos: pick.pos.map((v) => Math.round(v * 100) / 100) });
      placing = null; ctx.hint(null);
      return ctx.saveProfile(prof);
    }
    if (pick.marker?.kind === "ha") { const e = ctx.profile.modules.homeassistant.entities.find((x) => x.id === pick.marker.markerId); if (e) toggle(ctx, e); }
  },
  panel(ctx, el) {
    const { t, esc } = ctx;
    const pt = getLang() === "pt-PT";
    const ents = ctx.profile.modules.homeassistant.entities || [];
    el.innerHTML = `<div class="kicker">${esc(t("ha_devices"))}</div>
      ${!live ? `<div class="note ${err ? "warn" : ""}">${esc(err === "not_connected" ? t("ha_not_conn") : err ? err : t("ha_demo"))}</div>` : ""}
      <div class="list" style="margin-top:10px">${ents.map((e) => { const s = states[e.entity_id]; const tg = ["light", "switch", "fan"].includes(domain(e.entity_id));
        return `<div class="card" data-id="${esc(e.id)}"><div class="ic">${ICON[domain(e.entity_id)] || "•"}</div><div class="bd"><b>${esc(e.label)}</b><small>${esc(ctx.floorById(e.floor)?.name || "")}</small></div><span class="val">${esc(fmtState(s))}</span>${tg ? `<button class="wbtn" data-tg="${esc(e.id)}">⏻</button>` : ""}</div>`; }).join("")}</div>
      ${ctx.api.owner && !ctx.api.demo ? `<button class="btn block" id="addEnt">＋ ${pt ? "Adicionar dispositivo" : "Add device"}</button>` : ""}`;
    el.querySelectorAll("[data-tg]").forEach((b) => (b.onclick = () => toggle(ctx, ents.find((x) => x.id === b.dataset.tg))));
    el.querySelector("#addEnt")?.addEventListener("click", () => pickEntity(ctx));
  },
};
