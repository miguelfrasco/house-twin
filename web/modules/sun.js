// Sun: day arc, live shadows and direct-sun hours per room (heat map on the focused floor).
import * as THREE from "three";
import { sunPosition, sunTimes, sunVector, zonedMidnight } from "../engine/sun.js";
import { cellMesh, sunColor } from "../engine/exposure.js";
import { fmtNum, getLang } from "../i18n.js";

let orb = null, arc = null, token = 0, results = new Map(), progress = 0;

function drawArc(ctx) {
  ctx.viewer.clearOverlays("sunpath");
  const L = ctx.profile.location;
  if (!ctx.hasLocation) return;
  const b = ctx.viewer.house.bounds;
  const R = Math.max(b.w, b.h) * 0.9 + 6;
  const { rise, set } = sunTimes(ctx.state.date, L.lat, L.lon, ctx.tz);
  const pts = [];
  const t0 = rise ?? zonedMidnight(ctx.state.date, ctx.tz), t1 = set ?? t0 + 864e5;
  for (let t = t0; t <= t1; t += 10 * 6e4) {
    const v = sunVector(sunPosition(t, L.lat, L.lon), L.bearing_deg);
    pts.push(new THREE.Vector3(b.cx + v[0] * R, Math.max(0, v[1] * R), b.cy + v[2] * R));
  }
  arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xffd36b, dashSize: 0.6, gapSize: 0.35, transparent: true, opacity: 0.75 }));
  arc.computeLineDistances();
  arc.userData.overlay = "sunpath";
  ctx.viewer.overlays.add(arc);
  orb = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0.25, depthWrite: false }));
  orb.add(glow);
  orb.userData.overlay = "sunpath";
  orb.userData.R = R;
  ctx.viewer.overlays.add(orb);
  // north marker
  const north = new THREE.Group();
  const nv = sunVector({ az: 0, el: 0 }, L.bearing_deg);
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"); g.fillStyle = "rgba(92,225,255,.95)"; g.font = "bold 84px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("N", 64, 68);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sp.scale.setScalar(2); sp.position.set(b.cx + nv[0] * (R + 1.5), 0.4, b.cy + nv[2] * (R + 1.5));
  north.add(sp); north.userData.overlay = "sunpath";
  ctx.viewer.overlays.add(north);
  placeOrb(ctx, ctx.sun());
}

function placeOrb(ctx, s) {
  if (!orb) return;
  const b = ctx.viewer.house.bounds, R = orb.userData.R;
  const v = sunVector(s, ctx.profile.location.bearing_deg);
  orb.position.set(b.cx + v[0] * R, Math.max(0.2, v[1] * R), b.cy + v[2] * R);
  orb.visible = s.el > -1;
}

async function computeAll(ctx) {
  const my = ++token;
  results = new Map();
  if (!ctx.hasLocation) return;
  const floors = ctx.profile.floors;
  for (let i = 0; i < floors.length; i++) {
    const f = floors[i];
    const r = await ctx.exposure(f.id, (p) => { progress = (i + p) / floors.length; const bar = document.querySelector("#sunProg i"); if (bar) bar.style.width = `${progress * 100}%`; });
    if (my !== token) return;
    results.set(f.id, r);
  }
  progress = 1;
  drawHeat(ctx);
  if (ctx.state.module === "sun") ctx.refreshPanel();
}

function drawHeat(ctx) {
  ctx.viewer.clearOverlays("sunheat");
  const show = ctx.state.floor ? [ctx.state.floor] : [];
  for (const fid of show) {
    const r = results.get(fid);
    if (!r) continue;
    const f = ctx.floorById(fid);
    const m = cellMesh(r.cells, r.cell, f.elevation + 0.04, (c) => sunColor(c.hours, r.dayLength || 12));
    m.userData.overlay = "sunheat";
    m.userData.floorId = fid;
    ctx.viewer.overlays.add(m);
  }
}

export default {
  id: "sun",
  icon: "☀",
  async activate(ctx) { drawArc(ctx); computeAll(ctx); },
  deactivate(ctx) { token++; ctx.viewer.clearOverlays("sunpath"); ctx.viewer.clearOverlays("sunheat"); orb = null; },
  onSun(ctx, s) { placeOrb(ctx, s); const el = document.querySelector("#sunNow"); if (el) el.textContent = s.el > 0 ? `${fmtNum(s.el, 0)}°` : "—"; },
  onDate(ctx) { drawArc(ctx); computeAll(ctx); },
  onFloor(ctx) { drawHeat(ctx); },
  results: () => results,
  panel(ctx, el) {
    const { t, esc } = ctx;
    const pt = getLang() === "pt-PT";
    if (!ctx.hasLocation) { el.innerHTML = `<div class="note warn">${esc(t("no_location"))}</div>`; return; }
    const L = ctx.profile.location;
    const { rise, set } = sunTimes(ctx.state.date, L.lat, L.lon, ctx.tz);
    const fmt = (ms) => (ms ? new Date(ms).toLocaleTimeString(pt ? "pt-PT" : "en-GB", { timeZone: ctx.tz, hour: "2-digit", minute: "2-digit" }) : "—");
    const s = ctx.sun();
    const roomRows = [];
    for (const f of ctx.profile.floors) {
      const r = results.get(f.id);
      if (!r) continue;
      for (const room of f.rooms) {
        const x = r.byRoom.get(room.id);
        if (x) roomRows.push({ name: room.name, floor: f.name, avg: x.avg, max: x.max, id: room.id, fid: f.id });
      }
    }
    roomRows.sort((a, b) => b.avg - a.avg);
    const dl = rise && set ? (set - rise) / 36e5 : 0;
    el.innerHTML = `
      <div class="kicker">${esc(t("direct_sun_day"))}</div>
      <div class="stat big sun"><span id="sunNow">${s.el > 0 ? fmtNum(s.el, 0) + "°" : "—"}</span><label>${esc(t("elevation"))}</label></div>
      <div class="ring-row">
        <div class="mini"><b>${fmt(rise)}</b><span>${esc(t("sunrise"))}</span></div>
        <div class="mini"><b>${fmt(set)}</b><span>${esc(t("sunset"))}</span></div>
        <div class="mini"><b>${fmtNum(dl, 1)} h</b><span>${esc(t("day_length"))}</span></div>
      </div>
      <div class="row">
        ${[["03-20", pt ? "Equinócio" : "Equinox"], ["06-21", pt ? "Verão" : "Summer"], ["12-21", pt ? "Inverno" : "Winter"]].map(([d, l]) => `<button class="chip small" data-d="${d}">${l}</button>`).join("")}
      </div>
      <div class="kicker">${esc(t("rooms_by_sun"))}</div>
      ${progress < 1 ? `<div class="note">${esc(t("computing"))}<div class="progress" id="sunProg"><i style="width:${progress * 100}%"></i></div></div>` : ""}
      <div class="list">${roomRows.map((r) => `<div class="card" data-f="${esc(r.fid)}"><div class="bd"><b>${esc(r.name)}</b><small>${esc(r.floor)} · ${pt ? "máx." : "max"} ${fmtNum(r.max, 1)} h</small><div class="bar"><i style="width:${Math.min(100, (r.avg / Math.max(1, dl)) * 100)}%"></i></div></div><span class="val">${fmtNum(r.avg, 1)} h</span></div>`).join("")}</div>
      <div class="legend"><span>0 h</span><i></i><span>${fmtNum(dl, 0)} h</span></div>
      <div class="note">${pt ? "Escolha um piso à direita para ver o mapa de calor do sol direto. As horas contam só o sol que entra pelas janelas ou chega ao jardim, com as paredes e o telhado a fazer sombra." : "Pick a floor on the right to see the direct-sun heat map. Hours only count sun that comes through windows or reaches the garden, with walls and roof casting shade."}</div>`;
    el.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => {
      ctx.state.date = `${ctx.state.date.slice(0, 4)}-${b.dataset.d}`;
      document.querySelector("#dateIn").value = ctx.state.date;
      document.querySelector("#dateIn").dispatchEvent(new Event("change"));
    }));
    el.querySelectorAll(".card[data-f]").forEach((c) => (c.onclick = () => document.querySelectorAll("#floorBar button").forEach((b) => b.textContent === ctx.floorById(c.dataset.f).name && b.click())));
  },
};
