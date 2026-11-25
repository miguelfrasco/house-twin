// Plants: where each plant lives, its watering rhythm and whether it gets the light it wants.
import * as THREE from "three";
import { exposureAt, cellMesh } from "../engine/exposure.js";
import { getLang, fmtNum } from "../i18n.js";
import { uid } from "../profile/profile.js";
import { todayIn } from "../engine/sun.js";

const NEED = { low: [0, 2.5], medium: [1, 5], high: [4, 24] };
let waterings = {}, exp = new Map(), placing = null, selected = null;

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
function lastWatered(ctx, p) {
  if (waterings[p.id]) return waterings[p.id];
  if (typeof p.last_watered === "number") { const d = new Date(Date.parse(todayIn(ctx.tz)) + p.last_watered * 864e5); return d.toISOString().slice(0, 10); }
  return p.last_watered || null;
}
function dueIn(ctx, p) { const lw = lastWatered(ctx, p); if (!lw) return 0; return p.water_every_days - dayDiff(todayIn(ctx.tz), lw); }
function lightStatus(p, hours) {
  if (hours == null) return null;
  const [lo, hi] = NEED[p.light] || NEED.medium;
  return hours < lo ? "more" : hours > hi ? "less" : "ok";
}

async function loadExposure(ctx) {
  const items = ctx.profile.modules.plants.items || [];
  for (const fid of new Set(items.map((p) => p.floor))) exp.set(fid, await ctx.exposure(fid));
}

function drawMarkers(ctx) {
  const v = ctx.viewer;
  v.clearMarkers("plant");
  v.removeLabels("plant");
  for (const p of ctx.profile.modules.plants.items || []) {
    const due = dueIn(ctx, p) <= 0;
    v.marker({ id: p.id, floorId: p.floor, pos: p.pos, y: 0.9, color: due ? 0xffb547 : 0x46f2a0, kind: "plant" });
    const f = ctx.floorById(p.floor);
    const l = v.addLabel(`${p.outdoor ? "🌳" : "🪴"} ${p.name}`, new THREE.Vector3(p.pos[0], (f?.elevation || 0) + 1.25, p.pos[1]), p.floor, `mk plant${due ? " due" : ""}`);
    l.el.style.pointerEvents = "auto"; l.el.style.cursor = "pointer";
    l.el.onclick = () => openPlant(ctx, p.id);
  }
  v.applyFocus();
}

function bestSpots(ctx, p) {
  const [lo, hi] = NEED[p.light] || NEED.medium;
  const target = (lo + Math.min(hi, 10)) / 2;
  const out = [];
  for (const [fid, r] of exp) {
    if (!r?.cells) continue;
    for (const c of r.cells) if (c.room !== "_garden" || p.outdoor) out.push({ ...c, fid, score: -Math.abs(c.hours - target) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 40);
}

function openPlant(ctx, id) {
  const { t, esc } = ctx;
  const pt = getLang() === "pt-PT";
  const p = (ctx.profile.modules.plants.items || []).find((x) => x.id === id);
  if (!p) return;
  selected = id;
  const hours = exposureAt(exp.get(p.floor), p.pos);
  const ls = lightStatus(p, hours);
  const d = dueIn(ctx, p);
  const sh = document.querySelector("#sheet");
  const room = ctx.floorById(p.floor)?.rooms.find((r) => r.polygon && pointIn(p.pos, r.polygon));
  sh.innerHTML = `<button class="close">✕</button><h2>${esc(p.name)}</h2><div class="sub"><i>${esc(p.species || "")}</i> · ${esc(room?.name || (p.outdoor ? (pt ? "Jardim" : "Garden") : ""))} · ${esc(ctx.floorById(p.floor)?.name || "")}</div>
    <div class="ring-row">
      <div class="mini"><b>${hours == null ? "—" : fmtNum(hours, 1) + " h"}</b><span>${esc(t("sun_hours"))}</span></div>
      <div class="mini"><b>${esc(t("light_" + (p.light || "medium")))}</b><span>${pt ? "Precisa de" : "Needs"}</span></div>
      <div class="mini"><b>${d <= 0 ? (pt ? "Hoje" : "Today") : d + " " + t("days")}</b><span>${esc(t("next_water"))}</span></div>
    </div>
    ${ls ? `<div class="note ${ls === "ok" ? "" : "warn"}">${esc(t(ls === "ok" ? "light_ok" : ls === "more" ? "light_more" : "light_less"))} ${pt ? `(em ${esc(ctx.state.date)})` : `(on ${esc(ctx.state.date)})`}.</div>` : ""}
    <div class="row">
      <button class="btn primary" id="pw">💧 ${esc(t("water"))}</button>
      <button class="btn" id="pb">✨ ${esc(t("best_spot"))}</button>
      <button class="btn" id="pm">⤧ ${pt ? "Mudar de sítio" : "Move"}</button>
    </div>
    ${ctx.api.canWrite ? `<div class="row"><button class="btn small" id="pd">${esc(t("delete"))}</button></div>` : ""}`;
  sh.classList.remove("hidden");
  sh.querySelector(".close").onclick = () => { sh.classList.add("hidden"); ctx.viewer.clearOverlays("best"); selected = null; };
  sh.querySelector("#pw").onclick = async () => { waterings[p.id] = todayIn(ctx.tz); await ctx.api.setState("plants", { waterings }); ctx.toast(`💧 ${p.name}`); drawMarkers(ctx); ctx.refreshPanel(); openPlant(ctx, id); };
  sh.querySelector("#pb").onclick = () => {
    ctx.viewer.clearOverlays("best");
    const spots = bestSpots(ctx, p);
    const byFloor = new Map();
    for (const s of spots) { if (!byFloor.has(s.fid)) byFloor.set(s.fid, []); byFloor.get(s.fid).push(s); }
    for (const [fid, cells] of byFloor) {
      const m = cellMesh(cells, 0.5, ctx.floorById(fid).elevation + 0.06, () => [0.27, 0.95, 0.63], 0.85);
      m.userData.overlay = "best"; m.userData.floorId = fid;
      ctx.viewer.overlays.add(m);
    }
    ctx.viewer.applyFocus();
    const top = spots[0];
    if (top && ctx.state.floor && top.fid !== ctx.state.floor) ctx.toast(pt ? `O melhor sítio é no ${ctx.floorById(top.fid).name}` : `Best spot is on ${ctx.floorById(top.fid).name}`);
  };
  sh.querySelector("#pm").onclick = () => { if (!ctx.api.canWrite) return; placing = { id: p.id }; ctx.hint(t("click_to_place")); };
  sh.querySelector("#pd")?.addEventListener("click", async () => {
    const prof = structuredClone(ctx.profile);
    prof.modules.plants.items = prof.modules.plants.items.filter((x) => x.id !== p.id);
    sh.classList.add("hidden");
    await ctx.saveProfile(prof);
  });
}

function pointIn([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function addPlantSheet(ctx) {
  const { t, esc } = ctx;
  const pt = getLang() === "pt-PT";
  const sh = document.querySelector("#sheet");
  sh.innerHTML = `<button class="close">✕</button><h2>${esc(t("add_plant"))}</h2>
    <label class="f">${pt ? "Nome" : "Name"}</label><input id="an" maxlength="60">
    <label class="f">${pt ? "Espécie" : "Species"}</label><input id="as" maxlength="80">
    <label class="f">${pt ? "Luz" : "Light"}</label><select id="al"><option value="low">${esc(t("light_low"))}</option><option value="medium" selected>${esc(t("light_medium"))}</option><option value="high">${esc(t("light_high"))}</option></select>
    <label class="f">${pt ? "Regar a cada (dias)" : "Water every (days)"}</label><input id="aw" type="number" min="1" max="60" value="7">
    <div class="row"><button class="btn primary" id="ago">${esc(t("next"))}</button></div>`;
  sh.classList.remove("hidden");
  sh.querySelector(".close").onclick = () => sh.classList.add("hidden");
  sh.querySelector("#ago").onclick = () => {
    const name = sh.querySelector("#an").value.trim();
    if (!name) return sh.querySelector("#an").focus();
    placing = { item: { id: uid("pl"), name, species: sh.querySelector("#as").value.trim(), light: sh.querySelector("#al").value, water_every_days: Math.max(1, +sh.querySelector("#aw").value || 7), last_watered: todayIn(ctx.tz) } };
    sh.classList.add("hidden");
    ctx.hint(t("click_to_place"));
  };
}

export default {
  id: "plants",
  icon: "🪴",
  async activate(ctx) {
    const st = await ctx.api.getState("plants");
    waterings = st.waterings || {};
    drawMarkers(ctx);
    loadExposure(ctx).then(() => ctx.state.module === "plants" && ctx.refreshPanel());
  },
  deactivate(ctx) { ctx.viewer.clearMarkers("plant"); ctx.viewer.removeLabels("plant"); ctx.viewer.clearOverlays("best"); placing = null; ctx.hint(null); document.querySelector("#sheet").classList.add("hidden"); },
  onDate(ctx) { exp.clear(); loadExposure(ctx).then(() => ctx.refreshPanel()); },
  async onPick(ctx, pick) {
    if (placing && pick.pos) {
      const prof = structuredClone(ctx.profile);
      const items = prof.modules.plants.items;
      if (placing.item) items.push({ ...placing.item, floor: pick.floorId, pos: pick.pos.map((v) => Math.round(v * 100) / 100), outdoor: !!pick.ground || undefined });
      else { const it = items.find((x) => x.id === placing.id); it.floor = pick.floorId; it.pos = pick.pos.map((v) => Math.round(v * 100) / 100); it.outdoor = !!pick.ground || undefined; }
      placing = null; ctx.hint(null);
      await ctx.saveProfile(prof);
      return;
    }
    if (pick.marker?.kind === "plant") openPlant(ctx, pick.marker.markerId);
  },
  panel(ctx, el) {
    const { t, esc } = ctx;
    const items = ctx.profile.modules.plants.items || [];
    const rows = items.map((p) => ({ p, d: dueIn(ctx, p), h: exposureAt(exp.get(p.floor), p.pos) })).sort((a, b) => a.d - b.d);
    const due = rows.filter((r) => r.d <= 0).length;
    el.innerHTML = `<div class="kicker">${esc(t("plants"))}</div>
      <div class="stat big"><span>${due}</span><label>${esc(t("plants_due"))}</label></div>
      <div class="ring-row"><div class="mini"><b>${items.length}</b><span>${esc(t("plants_all"))}</span></div>
      <div class="mini"><b>${rows.filter((r) => lightStatus(r.p, r.h) === "ok").length}</b><span>${esc(t("light_ok"))}</span></div>
      <div class="mini"><b>${rows.filter((r) => r.h != null && lightStatus(r.p, r.h) !== "ok").length}</b><span>${getLang() === "pt-PT" ? "a rever" : "to review"}</span></div></div>
      <div class="kicker">${getLang() === "pt-PT" ? "Rega" : "Watering"}</div>
      <div class="list">${rows.map(({ p, d, h }) => {
        const ls = lightStatus(p, h);
        return `<div class="card${d <= 0 ? " due" : ""}" data-id="${esc(p.id)}"><div class="ic">${p.outdoor ? "🌳" : "🪴"}</div><div class="bd"><b>${esc(p.name)}</b><small>${d <= 0 ? `<span class="tag warn">${esc(d < 0 ? t("overdue") : t("today"))}</span>` : `${esc(t("next_water"))} ${d} ${esc(t("days"))}`} ${ls ? `<span class="tag ${ls === "ok" ? "ok" : "warn"}">${h == null ? "" : fmtNum(h, 1) + " h"}</span>` : ""}</small></div><button class="wbtn" data-w="${esc(p.id)}" title="${esc(t("water"))}">💧</button></div>`;
      }).join("")}</div>
      ${ctx.api.canWrite ? `<button class="btn block" id="addPl">＋ ${esc(t("add_plant"))}</button>` : ""}`;
    el.querySelectorAll(".card").forEach((c) => (c.onclick = (e) => { if (e.target.closest("[data-w]")) return; openPlant(ctx, c.dataset.id); }));
    el.querySelectorAll("[data-w]").forEach((b) => (b.onclick = async () => { waterings[b.dataset.w] = todayIn(ctx.tz); await ctx.api.setState("plants", { waterings }); drawMarkers(ctx); ctx.refreshPanel(); }));
    el.querySelector("#addPl")?.addEventListener("click", () => addPlantSheet(ctx));
  },
};
