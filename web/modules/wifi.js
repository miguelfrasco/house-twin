// Wi-Fi: predicted signal from access-point positions with a log-distance + wall-loss model,
// optionally calibrated with measured points (survey). No router scraping: positions and
// measurements are entered or imported by the owner.
import * as THREE from "three";
import { cellMesh } from "../engine/exposure.js";
import { pointInPolygon, bbox } from "../engine/build3d.js";
import { getLang, fmtNum } from "../i18n.js";

import { DEF, predict, calibrate, parseSurvey } from "../engine/wifi-model.js";
export { predict, calibrate, parseSurvey };

export function rssiColor(r) {
  const stops = [[-85, [1, 0.36, 0.42]], [-75, [1, 0.71, 0.28]], [-65, [0.27, 0.95, 0.63]], [-50, [0.36, 0.88, 1]]];
  if (r <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (r <= b) { const f = (r - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * f); }
  }
  return stops.at(-1)[1];
}

let grid = new Map(), cal = null;

function computeFloor(ctx, floor) {
  const w = ctx.profile.modules.wifi;
  const polys = floor.rooms.map((r) => r.polygon);
  if (!polys.length || !w.aps?.length) return [];
  const b = bbox(polys.flat());
  const cells = [], cell = 0.5;
  for (let x = b.x0 + cell / 2; x < b.x1; x += cell) for (let y = b.y0 + cell / 2; y < b.y1; y += cell) {
    const room = floor.rooms.find((r) => pointInPolygon([x, y], r.polygon));
    if (!room) continue;
    const r = Math.max(...w.aps.map((a) => predict(ctx.profile, a, floor.id, [x, y], cal.model))) + cal.offset;
    cells.push({ x, y, rssi: r, room: room.id });
  }
  return cells;
}

function draw(ctx) {
  const v = ctx.viewer, w = ctx.profile.modules.wifi;
  v.clearOverlays("wifi"); v.clearMarkers("ap"); v.clearMarkers("survey"); v.removeLabels("ap");
  cal = calibrate(ctx.profile, w);
  grid = new Map();
  for (const f of ctx.profile.floors) {
    const cells = computeFloor(ctx, f);
    grid.set(f.id, cells);
    if (ctx.surface !== "wifi") continue; // the sun map has the floors; markers still show
    const m = cellMesh(cells, 0.5, f.elevation + 0.05, (c) => rssiColor(c.rssi), 0.72);
    m.userData.overlay = "wifi"; m.userData.floorId = f.id;
    v.overlays.add(m);
  }
  for (const a of w.aps || []) {
    v.marker({ id: a.id, floorId: a.floor, pos: a.pos, y: 1.6, color: 0x5ce1ff, kind: "ap", size: 0.2 });
    const f = ctx.floorById(a.floor);
    v.addLabel(`📶 ${a.label}`, new THREE.Vector3(a.pos[0], (f?.elevation || 0) + 2.0, a.pos[1]), a.floor, "mk ap");
  }
  for (const [i, s] of (w.survey || []).entries()) v.marker({ id: `s${i}`, floorId: s.floor, pos: s.pos, y: 1.0, color: new THREE.Color(...rssiColor(s.rssi)).getHex(), kind: "survey", size: 0.12 });
  v.applyFocus();
}

let placing = null;

export default {
  id: "wifi",
  icon: "📶",
  activate(ctx) { draw(ctx); },
  onLayers(ctx) { draw(ctx); },
  isPlacing: () => !!placing,
  deactivate(ctx) { const v = ctx.viewer; v.clearOverlays("wifi"); v.clearMarkers("ap"); v.clearMarkers("survey"); v.removeLabels("ap"); placing = null; ctx.hint(null); },
  async onPick(ctx, pick) {
    if (!placing || !pick.pos) return;
    const prof = structuredClone(ctx.profile);
    const w = prof.modules.wifi;
    if (placing.type === "ap") w.aps.push({ id: `ap${Date.now().toString(36)}`, label: placing.label, floor: pick.floorId, pos: pick.pos.map((v) => Math.round(v * 100) / 100), band: "5", tx_dbm: 20 });
    else { w.survey ||= []; w.survey.push({ floor: pick.floorId, pos: pick.pos.map((v) => Math.round(v * 100) / 100), rssi: placing.rssi }); }
    placing = null; ctx.hint(null);
    await ctx.saveProfile(prof);
  },
  panel(ctx, el) {
    const { t, esc } = ctx;
    const pt = getLang() === "pt-PT";
    const w = ctx.profile.modules.wifi;
    const all = [...grid.values()].flat();
    const good = all.filter((c) => c.rssi >= -67).length;
    const byRoom = [];
    for (const f of ctx.profile.floors) for (const r of f.rooms) {
      const cs = (grid.get(f.id) || []).filter((c) => c.room === r.id);
      if (cs.length) byRoom.push({ name: r.name, floor: f.name, min: Math.min(...cs.map((c) => c.rssi)), avg: cs.reduce((a, c) => a + c.rssi, 0) / cs.length });
    }
    byRoom.sort((a, b) => a.avg - b.avg);
    el.innerHTML = `<div class="kicker">${esc(t("wifi_signal"))}</div>
      <div class="stat big"><span>${all.length ? Math.round((good / all.length) * 100) : 0}%</span><label>${pt ? "da casa com sinal bom (≥ −67 dBm)" : "of the house with good signal (≥ −67 dBm)"}</label></div>
      <div class="legend wifi"><span>−85</span><i></i><span>−50 dBm</span></div>
      <div class="kicker">${esc(t("wifi_aps"))}</div>
      <div class="list">${(w.aps || []).map((a) => `<div class="card"><div class="ic">📶</div><div class="bd"><b>${esc(a.label)}</b><small>${esc(ctx.floorById(a.floor)?.name || "")} · ${a.band || "5"} GHz · ${a.tx_dbm ?? 20} dBm</small></div></div>`).join("")}</div>
      <div class="kicker">${esc(t("wifi_weak"))}</div>
      <div class="list">${byRoom.slice(0, 5).map((r) => `<div class="card"><div class="bd"><b>${esc(r.name)}</b><small>${esc(r.floor)} · ${pt ? "pior" : "worst"} ${fmtNum(r.min, 0)} dBm</small></div><span class="val" style="color:rgb(${rssiColor(r.avg).map((v) => Math.round(v * 255)).join(",")})">${fmtNum(r.avg, 0)}</span></div>`).join("")}</div>
      <div class="note">${cal?.n ? (pt ? `Modelo calibrado com ${cal.n} medições (erro médio ±${fmtNum(cal.rmse, 1)} dB; ajustado: ${cal.fitted.map((f) => ({ offset: "nível", n: `expoente ${fmtNum(cal.model.n, 2)}`, wall_db: `paredes ${fmtNum(cal.model.wall_db, 1)} dB` })[f]).join(", ")}).` : `Model calibrated with ${cal.n} measurements (±${fmtNum(cal.rmse, 1)} dB; fitted: ${cal.fitted.map((f) => ({ offset: "level", n: `exponent ${fmtNum(cal.model.n, 2)}`, wall_db: `walls ${fmtNum(cal.model.wall_db, 1)} dB` })[f]).join(", ")}).`) : (pt ? "Sem medições: é só uma estimativa. Adicione ou importe pontos medidos para calibrar." : "No measurements: this is only an estimate. Add or import measured points to calibrate.")}</div>
      ${ctx.api.canWrite ? `<div class="row"><button class="btn small" id="addAp">＋ ${pt ? "Ponto de acesso" : "Access point"}</button><button class="btn small" id="addSv">＋ ${pt ? "Medição" : "Measurement"}</button><button class="btn small" id="impSv">⇪ ${pt ? "Importar medições" : "Import survey"}</button>${(w.survey || []).length ? `<button class="btn small" id="clrSv">${pt ? "Apagar medições" : "Clear survey"}</button>` : ""}</div>
      <input type="file" id="svFile" accept=".csv,.tsv,.txt,.json,text/csv,application/json" hidden>
      <div class="note">${pt ? "Importar: CSV com colunas <code>floor,x,y,rssi</code> (e opcionalmente <code>ap,label</code>), em metros no referencial da planta da casa, ou JSON com os mesmos campos." : "Import: CSV with <code>floor,x,y,rssi</code> columns (optional <code>ap,label</code>), in floor-plan metres, or JSON with the same fields."}</div>` : ""}`;
    el.querySelector("#addAp")?.addEventListener("click", () => { const label = prompt(pt ? "Nome do ponto de acesso" : "Access point name", "AP"); if (!label) return; placing = { type: "ap", label: label.slice(0, 40) }; ctx.hint(t("click_to_place")); });
    el.querySelector("#impSv")?.addEventListener("click", () => el.querySelector("#svFile").click());
    el.querySelector("#svFile")?.addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      let res; try { res = parseSurvey(await file.text(), ctx.profile); } catch (err) { return ctx.toast((pt ? "Ficheiro inválido: " : "Invalid file: ") + err.message); }
      if (!res.points.length) return ctx.toast(pt ? "Nenhuma medição válida no ficheiro" : "No valid measurements in the file");
      const replace = (w.survey || []).length ? confirm(pt ? `Substituir as ${w.survey.length} medições atuais? (Cancelar = juntar)` : `Replace the ${w.survey.length} current measurements? (Cancel = add)`) : true;
      const prof = structuredClone(ctx.profile);
      prof.modules.wifi.survey = replace ? res.points : [...(prof.modules.wifi.survey || []), ...res.points];
      await ctx.saveProfile(prof, pt ? `${res.points.length} medições importadas${res.skipped.length ? ` (${res.skipped.length} linhas ignoradas)` : ""}` : `${res.points.length} measurements imported${res.skipped.length ? ` (${res.skipped.length} rows skipped)` : ""}`);
    });
    el.querySelector("#clrSv")?.addEventListener("click", async () => { if (!confirm(pt ? "Apagar todas as medições?" : "Delete all measurements?")) return; const prof = structuredClone(ctx.profile); prof.modules.wifi.survey = []; await ctx.saveProfile(prof); });
    el.querySelector("#addSv")?.addEventListener("click", () => { const v = prompt(pt ? "Sinal medido (dBm, p. ex. −60)" : "Measured signal (dBm, e.g. -60)", "-60"); const r = parseFloat(String(v).replace("−", "-")); if (!Number.isFinite(r)) return; placing = { type: "survey", rssi: Math.max(-100, Math.min(-20, r)) }; ctx.hint(t("click_to_place")); });
  },
};
