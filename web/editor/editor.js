// 2D plan editor: walls, rooms, doors and windows, floors, roof, plan underlay, item placement.
// Works on a copy of the profile; nothing is stored until "Save".
import { validate, uid, wallLength, OPENING_TYPES, ROOF_TYPES } from "../profile/profile.js";
import { getLang } from "../i18n.js";
import { cleanImage } from "../api.js";

const NS = "http://www.w3.org/2000/svg";
const ROOM_TYPES = ["living", "kitchen", "bedroom", "bathroom", "hall", "office", "garage", "stairs", "outdoor", "other"];
const L = (pt, en) => (getLang() === "pt-PT" ? pt : en);
const round = (v, s = 0.05) => Math.round(v / s) * s;
const r2 = (v) => Math.round(v * 100) / 100;

export function openEditor(ctx, opts = {}) {
  const { esc } = ctx;
  const draft = structuredClone(opts.profile || ctx.profile);
  const hist = [JSON.stringify(draft)];
  let hpos = 0;
  let floorId = opts.floorId || ctx.state.floor || draft.floors[0].id;
  let tool = "select", sel = null, chain = null, roomPts = null, calib = null, drag = null, hover = null;
  let view = null; // {x, y, w, h} in metres
  const root = document.createElement("div");
  root.className = "ed";
  root.innerHTML = `
    <div class="glass ed-top">
      <b>✎ ${L("Editar casa", "Edit house")}</b>
      <div class="seg" id="edFloors"></div>
      <button class="chip small" id="edAddFloor">＋ ${L("Piso", "Floor")}</button>
      <span style="flex:1"></span>
      <button class="chip small" id="edUndo" title="${L("Anular", "Undo")}">↶</button>
      <button class="chip small" id="edRedo" title="${L("Refazer", "Redo")}">↷</button>
      <button class="chip small" id="edFit">⤢ ${L("Ajustar", "Fit")}</button>
      <button class="chip" id="edCancel">${L("Fechar", "Close")}</button>
      <button class="btn primary small" id="edSave">${L("Guardar", "Save")}</button>
    </div>
    <div class="ed-main">
      <div class="glass ed-tools" id="edTools"></div>
      <div class="ed-canvas" id="edCanvas"><svg id="edSvg"></svg></div>
      <div class="glass ed-props" id="edProps"></div>
    </div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const svg = $("#edSvg");
  const floor = () => draft.floors.find((f) => f.id === floorId);

  const TOOLS = [
    ["select", "↖", L("Selecionar e mover", "Select and move")],
    ["wall", "▭", L("Parede", "Wall")],
    ["room", "⬠", L("Divisão", "Room")],
    ["door", "🚪", L("Porta", "Door")],
    ["window", "🪟", L("Janela", "Window")],
    ["garage", "⛩", L("Portão", "Garage door")],
    ["delete", "🗑", L("Apagar", "Delete")],
    ["calibrate", "📏", L("Escala da planta", "Plan scale")],
  ];
  function renderTools() {
    const el = $("#edTools");
    el.innerHTML = `<div class="kicker">${L("Ferramentas", "Tools")}</div>` + TOOLS.map(([id, ic, label]) => `<button class="chip tool${tool === id ? " on" : ""}" data-tool="${id}">${ic} ${esc(label)}</button>`).join("") +
      `<div class="kicker">${L("Planta", "Plan image")}</div>
       <label class="chip" style="text-align:center;cursor:pointer">⬆ ${L("Carregar imagem", "Upload image")}<input type="file" accept="image/png,image/jpeg,image/webp" id="edPlanFile" hidden></label>
       ${floor().plan ? `<label class="f">${L("Opacidade", "Opacity")}</label><input type="range" min="0" max="1" step="0.05" value="${floor().plan.opacity ?? 0.6}" id="edPlanOp">` : ""}
       <div class="note">${hintFor(tool)}</div>`;
    el.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => { tool = b.dataset.tool; chain = null; roomPts = null; calib = null; renderTools(); draw(); }));
    el.querySelector("#edPlanFile").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const img = await cleanImage(f, 3000, "image/jpeg");
      const id = `plan-${floorId}`;
      const stored = await ctx.api.putAsset(id, img.dataUrl, img.mime);
      draft.assets = (draft.assets || []).filter((a) => a.id !== id);
      draft.assets.push({ id, kind: "plan", mime: img.mime, ...(stored.path ? { path: stored.path } : {}) });
      floor().plan = { asset: id, origin: [0, 0], m_per_px: 0.02, opacity: 0.6, width_px: img.width, height_px: img.height, _url: img.dataUrl };
      commit(); tool = "calibrate"; renderTools(); fit(); draw();
      ctx.toast(L("Agora marque dois pontos com uma medida conhecida.", "Now mark two points with a known distance."));
    };
    el.querySelector("#edPlanOp")?.addEventListener("input", (e) => { floor().plan.opacity = +e.target.value; draw(); });
  }
  function hintFor(t) {
    return {
      select: L("Arraste extremos de paredes, cantos de divisões e objetos. Arraste o fundo para deslocar; roda do rato para ampliar.", "Drag wall ends, room corners and items. Drag the background to pan; scroll to zoom."),
      wall: L("Clique para começar, clique para cada canto. Esc ou duplo clique termina. Encaixa na grelha e noutras paredes.", "Click to start, click at each corner. Esc or double-click to finish. Snaps to the grid and other walls."),
      room: L("Clique nos cantos da divisão. Clique no primeiro ponto ou Enter para fechar.", "Click the room corners. Click the first point or press Enter to close."),
      door: L("Clique numa parede para pôr uma porta.", "Click a wall to add a door."),
      window: L("Clique numa parede para pôr uma janela.", "Click a wall to add a window."),
      garage: L("Clique numa parede para pôr um portão.", "Click a wall to add a garage door."),
      delete: L("Clique num elemento para o apagar.", "Click an element to delete it."),
      calibrate: L("Clique em dois pontos da planta e indique a distância real entre eles.", "Click two points on the plan and enter the real distance between them."),
    }[t];
  }

  function renderFloors() {
    $("#edFloors").innerHTML = draft.floors.map((f) => `<button class="${f.id === floorId ? "on" : ""}" data-f="${esc(f.id)}">${esc(f.name)}</button>`).join("");
    $("#edFloors").querySelectorAll("button").forEach((b) => (b.onclick = () => { floorId = b.dataset.f; sel = null; chain = null; roomPts = null; renderAll(); fit(); }));
  }

  function commit() {
    hist.splice(hpos + 1);
    hist.push(JSON.stringify(stripTmp(draft)));
    hpos = hist.length - 1;
    if (hist.length > 200) { hist.shift(); hpos--; }
  }
  function stripTmp(p) { const c = structuredClone(p); for (const f of c.floors) if (f.plan) delete f.plan._url; return c; }
  function restore(i) {
    const urls = Object.fromEntries(draft.floors.map((f) => [f.id, f.plan?._url]));
    const p = JSON.parse(hist[i]);
    Object.keys(draft).forEach((k) => delete draft[k]);
    Object.assign(draft, p);
    for (const f of draft.floors) if (f.plan && urls[f.id]) f.plan._url = urls[f.id];
    if (!floor()) floorId = draft.floors[0].id;
    sel = null; renderAll();
  }

  // ---------- geometry helpers ----------
  function allPoints() {
    const f = floor(), pts = [];
    for (const w of f.walls) pts.push(w.a, w.b);
    for (const r of f.rooms) pts.push(...r.polygon);
    return pts;
  }
  function snap(p, exclude) {
    let best = null, bd = 0.25 ** 2 * (view.w / 20);
    for (const q of allPoints()) {
      if (q === exclude) continue;
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (d < bd) { bd = d; best = q; }
    }
    return best ? [best[0], best[1]] : [r2(round(p[0])), r2(round(p[1]))];
  }
  function ortho(from, p) {
    const dx = p[0] - from[0], dy = p[1] - from[1];
    const a = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 90;
    if (a < 7) return [p[0], from[1]];
    if (a > 83) return [from[0], p[1]];
    return p;
  }
  function nearestWall(p, maxD = 0.4) {
    let best = null;
    for (const w of floor().walls) {
      const L2 = wallLength(w) ** 2;
      let t = ((p[0] - w.a[0]) * (w.b[0] - w.a[0]) + (p[1] - w.a[1]) * (w.b[1] - w.a[1])) / L2;
      t = Math.max(0, Math.min(1, t));
      const q = [w.a[0] + t * (w.b[0] - w.a[0]), w.a[1] + t * (w.b[1] - w.a[1])];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < maxD * (view.w / 20) && (!best || d < best.d)) best = { w, t, d, s: t * Math.sqrt(L2) };
    }
    return best;
  }
  function toWorld(e) {
    const r = svg.getBoundingClientRect();
    return [view.x + ((e.clientX - r.left) / r.width) * view.w, view.y + ((e.clientY - r.top) / r.height) * view.h];
  }

  function fit() {
    const pts = allPoints();
    const f = floor();
    if (f.plan) { const w = (f.plan.width_px || 1000) * f.plan.m_per_px, h = (f.plan.height_px || 800) * f.plan.m_per_px; pts.push(f.plan.origin, [f.plan.origin[0] + w, f.plan.origin[1] + h]); }
    if (!pts.length) pts.push([-2, -2], [14, 10]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const r = svg.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
    let w = x1 - x0 + 4, h = y1 - y0 + 4;
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    view = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
    draw();
  }

  // ---------- drawing ----------
  function el(name, attrs, parent) { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.appendChild(e); return e; }
  function draw() {
    if (!view) return;
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
    svg.innerHTML = "";
    const px = view.w / Math.max(1, svg.getBoundingClientRect().width); // metres per screen pixel
    const f = floor();
    // plan underlay
    if (f.plan) {
      const a = (draft.assets || []).find((x) => x.id === f.plan.asset);
      const href = f.plan._url || (a ? ctx.api.assetUrl(a) : null);
      if (href) el("image", { href, x: f.plan.origin[0], y: f.plan.origin[1], width: (f.plan.width_px || 1000) * f.plan.m_per_px, height: (f.plan.height_px || 800) * f.plan.m_per_px, opacity: f.plan.opacity ?? 0.6, preserveAspectRatio: "none" }, svg);
    }
    // grid
    const g = el("g", { stroke: "rgba(160,220,255,.07)", "stroke-width": px }, svg);
    for (let x = Math.floor(view.x); x < view.x + view.w; x++) el("line", { x1: x, y1: view.y, x2: x, y2: view.y + view.h }, g);
    for (let y = Math.floor(view.y); y < view.y + view.h; y++) el("line", { x1: view.x, y1: y, x2: view.x + view.w, y2: y }, g);
    // lower floor ghost
    const below = draft.floors.filter((x) => x.elevation < f.elevation).sort((a, b) => b.elevation - a.elevation)[0];
    if (below) for (const w of below.walls) el("line", { x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1], stroke: "rgba(255,255,255,.12)", "stroke-width": w.thickness ?? 0.2, "stroke-dasharray": `${px * 6} ${px * 4}` }, svg);
    // rooms
    for (const r of f.rooms) {
      const on = sel?.type === "room" && sel.id === r.id;
      el("polygon", { points: r.polygon.map((p) => p.join(",")).join(" "), fill: on ? "rgba(92,225,255,.18)" : "rgba(201,180,143,.13)", stroke: on ? "#5ce1ff" : "rgba(201,180,143,.4)", "stroke-width": px * 1.5, "data-room": r.id }, svg);
      const c = centroid(r.polygon);
      const t = el("text", { x: c[0], y: c[1], "font-size": px * 12, fill: "#cfe3f1", "text-anchor": "middle", "pointer-events": "none" }, svg);
      t.textContent = r.name;
      const a = el("text", { x: c[0], y: c[1] + px * 15, "font-size": px * 10, fill: "#8a9aab", "text-anchor": "middle", "pointer-events": "none" }, svg);
      a.textContent = `${area(r.polygon).toLocaleString(getLang(), { maximumFractionDigits: 1 })} m²`;
    }
    // walls
    for (const w of f.walls) {
      const on = sel?.type === "wall" && sel.id === w.id;
      el("line", { x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1], stroke: on ? "#5ce1ff" : (w.thickness ?? 0.2) >= 0.2 ? "#e9e6df" : "#bdb8ae", "stroke-width": Math.max(w.thickness ?? 0.2, px * 3), "stroke-linecap": "square", "data-wall": w.id }, svg);
    }
    // openings
    for (const o of f.openings) {
      const w = f.walls.find((x) => x.id === o.wall); if (!w) continue;
      const Lw = wallLength(w), ux = (w.b[0] - w.a[0]) / Lw, uy = (w.b[1] - w.a[1]) / Lw;
      const p0 = [w.a[0] + ux * o.offset, w.a[1] + uy * o.offset], p1 = [w.a[0] + ux * (o.offset + o.width), w.a[1] + uy * (o.offset + o.width)];
      const on = sel?.type === "opening" && sel.id === o.id;
      const col = on ? "#ffffff" : o.type === "window" ? "#5ce1ff" : o.type === "garage" ? "#ffb547" : o.type === "door" ? "#c48a5c" : "#7a8796";
      el("line", { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], stroke: col, "stroke-width": (w.thickness ?? 0.2) + px * 2, "data-opening": o.id }, svg);
      if (o.type === "door") { // swing arc
        const nx = -uy, ny = ux, r = o.width;
        el("path", { d: `M ${p0[0] + nx * r} ${p0[1] + ny * r} A ${r} ${r} 0 0 1 ${p1[0]} ${p1[1]}`, fill: "none", stroke: "rgba(196,138,92,.6)", "stroke-width": px * 1.2, "pointer-events": "none" }, svg);
        el("line", { x1: p0[0], y1: p0[1], x2: p0[0] + nx * r, y2: p0[1] + ny * r, stroke: "rgba(196,138,92,.8)", "stroke-width": px * 1.5, "pointer-events": "none" }, svg);
      }
    }
    // items from modules
    for (const it of items()) {
      if (it.floor !== floorId) continue;
      const on = sel?.type === "item" && sel.id === it.id;
      el("circle", { cx: it.pos[0], cy: it.pos[1], r: px * 9, fill: on ? "#ffffff" : it.color, stroke: "rgba(0,0,0,.5)", "stroke-width": px, "data-item": it.id }, svg);
      const t = el("text", { x: it.pos[0], y: it.pos[1] + px * 4, "font-size": px * 10, "text-anchor": "middle", "pointer-events": "none" }, svg);
      t.textContent = it.icon;
    }
    // handles for selection
    if (sel?.type === "wall") { const w = f.walls.find((x) => x.id === sel.id); if (w) for (const [k, p] of [["a", w.a], ["b", w.b]]) el("circle", { cx: p[0], cy: p[1], r: px * 7, fill: "#05080c", stroke: "#5ce1ff", "stroke-width": px * 2, "data-handle": `wall:${w.id}:${k}` }, svg); }
    if (sel?.type === "room") { const r = f.rooms.find((x) => x.id === sel.id); if (r) r.polygon.forEach((p, i) => el("circle", { cx: p[0], cy: p[1], r: px * 6, fill: "#05080c", stroke: "#5ce1ff", "stroke-width": px * 2, "data-handle": `room:${r.id}:${i}` }, svg)); }
    // in-progress chains
    const live = (pts, close) => { if (pts.length) el(close ? "polygon" : "polyline", { points: pts.map((p) => p.join(",")).join(" "), fill: close ? "rgba(92,225,255,.1)" : "none", stroke: "#5ce1ff", "stroke-width": px * 2, "stroke-dasharray": `${px * 5} ${px * 3}`, "pointer-events": "none" }, svg); };
    if (chain && hover) { live([...chain, hover]); const Ld = Math.hypot(hover[0] - chain.at(-1)[0], hover[1] - chain.at(-1)[1]); const t = el("text", { x: hover[0] + px * 10, y: hover[1] - px * 10, "font-size": px * 12, fill: "#5ce1ff" }, svg); t.textContent = `${Ld.toFixed(2)} m`; }
    if (roomPts) live(hover ? [...roomPts, hover] : roomPts, true);
    if (calib?.length) { calib.forEach((p) => el("circle", { cx: p[0], cy: p[1], r: px * 5, fill: "#ffd36b" }, svg)); if (hover && calib.length === 1) el("line", { x1: calib[0][0], y1: calib[0][1], x2: hover[0], y2: hover[1], stroke: "#ffd36b", "stroke-width": px * 2 }, svg); }
    if (hover && (tool === "wall" || tool === "room")) el("circle", { cx: hover[0], cy: hover[1], r: px * 4, fill: "#5ce1ff", "pointer-events": "none" }, svg);
    // scale bar
    const sb = el("g", {}, svg);
    el("line", { x1: view.x + px * 20, y1: view.y + view.h - px * 20, x2: view.x + px * 20 + 1, y2: view.y + view.h - px * 20, stroke: "#eaf2f8", "stroke-width": px * 2 }, sb);
    const st = el("text", { x: view.x + px * 20, y: view.y + view.h - px * 28, "font-size": px * 10, fill: "#8a9aab" }, sb); st.textContent = "1 m";
  }
  const centroid = (poly) => { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; };
  const area = (poly) => { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]); return Math.abs(a / 2); };

  function items() {
    const m = draft.modules || {}, out = [];
    for (const p of m.plants?.items || []) out.push({ id: p.id, mod: "plants", ref: p, floor: p.floor, pos: p.pos, icon: "🪴", color: "#46f2a0", label: p.name });
    for (const a of m.wifi?.aps || []) out.push({ id: a.id, mod: "wifi", ref: a, floor: a.floor, pos: a.pos, icon: "📶", color: "#5ce1ff", label: a.label });
    for (const e of m.homeassistant?.entities || []) out.push({ id: e.id, mod: "homeassistant", ref: e, floor: e.floor, pos: e.pos, icon: "💡", color: "#ffd36b", label: e.label });
    for (const c of m.cameras?.items || []) out.push({ id: c.id, mod: "cameras", ref: c, floor: c.floor, pos: c.pos, icon: "📷", color: "#c9a7ff", label: c.label });
    return out;
  }

  // ---------- props panel ----------
  function renderProps() {
    const el2 = $("#edProps"), f = floor();
    const num = (id, label, v, step = 0.05, min = 0, max = 20) => `<label class="f">${label}</label><input type="number" id="${id}" value="${r2(v)}" step="${step}" min="${min}" max="${max}">`;
    let h = "";
    if (sel?.type === "wall") {
      const w = f.walls.find((x) => x.id === sel.id);
      h = `<div class="kicker">${L("Parede", "Wall")}</div><div class="note">${L("Comprimento", "Length")}: ${wallLength(w).toFixed(2)} m</div>
        ${num("pT", L("Espessura (m)", "Thickness (m)"), w.thickness ?? 0.2, 0.01, 0.03, 1)}
        ${num("pH", L("Altura (m, vazio = altura do piso)", "Height (m, empty = floor height)"), w.height ?? f.height, 0.05, 0.3, 10)}
        <div class="row"><button class="btn small" id="pDel">${L("Apagar", "Delete")}</button></div>`;
    } else if (sel?.type === "room") {
      const r = f.rooms.find((x) => x.id === sel.id);
      h = `<div class="kicker">${L("Divisão", "Room")}</div><label class="f">${L("Nome", "Name")}</label><input id="pN" value="${esc(r.name)}" maxlength="40">
        <label class="f">${L("Tipo", "Type")}</label><select id="pY">${ROOM_TYPES.map((t) => `<option ${t === r.type ? "selected" : ""} value="${t}">${t}</option>`).join("")}</select>
        <div class="note">${area(r.polygon).toFixed(1)} m²</div><div class="row"><button class="btn small" id="pDel">${L("Apagar", "Delete")}</button></div>`;
    } else if (sel?.type === "opening") {
      const o = f.openings.find((x) => x.id === sel.id);
      h = `<div class="kicker">${L("Abertura", "Opening")}</div><label class="f">${L("Tipo", "Type")}</label><select id="pY">${OPENING_TYPES.map((t) => `<option ${t === o.type ? "selected" : ""}>${t}</option>`).join("")}</select>
        ${num("pW", L("Largura (m)", "Width (m)"), o.width)}${num("pH", L("Altura (m)", "Height (m)"), o.height)}${num("pS", L("Peitoril (m)", "Sill (m)"), o.sill || 0)}${num("pO", L("Distância ao início da parede (m)", "Offset from wall start (m)"), o.offset)}
        <div class="row"><button class="btn small" id="pDel">${L("Apagar", "Delete")}</button></div>`;
    } else if (sel?.type === "item") {
      const it = items().find((x) => x.id === sel.id);
      h = `<div class="kicker">${it.icon} ${esc(it.label || "")}</div><div class="note">${L("Arraste para mudar de sítio.", "Drag to move it.")} (${r2(it.pos[0])}, ${r2(it.pos[1])})</div>
        <label class="f">${L("Piso", "Floor")}</label><select id="pF">${draft.floors.map((x) => `<option value="${esc(x.id)}" ${x.id === it.floor ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`;
    } else {
      const roofs = (draft.roofs || []).filter((r) => r.floor === floorId);
      h = `<div class="kicker">${L("Piso", "Floor")}</div><label class="f">${L("Nome", "Name")}</label><input id="fN" value="${esc(f.name)}" maxlength="40">
        ${num("fE", L("Cota do pavimento (m)", "Floor level (m)"), f.elevation, 0.05, -10, 60)}${num("fH", L("Pé-direito (m)", "Ceiling height (m)"), f.height, 0.05, 1.8, 8)}
        <div class="row"><button class="btn small" id="fOut">${L("Calcular contorno", "Compute outline")}</button>${draft.floors.length > 1 ? `<button class="btn small" id="fDel">${L("Apagar piso", "Delete floor")}</button>` : ""}</div>
        <div class="kicker">${L("Telhado sobre este piso", "Roof over this floor")}</div>
        ${roofs.map((r) => `<div class="card" style="display:block"><label class="f">${L("Tipo", "Type")}</label><select data-rt="${esc(r.id)}">${ROOF_TYPES.map((t) => `<option ${t === r.type ? "selected" : ""}>${t}</option>`).join("")}</select>
          ${r.type !== "flat" ? `<label class="f">${L("Inclinação (°)", "Pitch (°)")}</label><input type="number" data-rp="${esc(r.id)}" value="${r.pitch_deg || 30}" min="5" max="60"><label class="f">${L("Cumeeira", "Ridge")}</label><select data-rr="${esc(r.id)}"><option value="x" ${r.ridge !== "y" ? "selected" : ""}>↔</option><option value="y" ${r.ridge === "y" ? "selected" : ""}>↕</option></select>` : ""}
          <div class="row"><button class="btn small" data-rd="${esc(r.id)}">${L("Remover telhado", "Remove roof")}</button></div></div>`).join("")}
        <div class="row"><button class="btn small" id="fRoof">＋ ${L("Telhado do contorno", "Roof from outline")}</button></div>
        <div class="note">${f.walls.length} ${L("paredes", "walls")} · ${f.rooms.length} ${L("divisões", "rooms")} · ${f.openings.length} ${L("aberturas", "openings")}</div>`;
    }
    el2.innerHTML = h;
    const on = (id, ev, fn) => el2.querySelector(id)?.addEventListener(ev, fn);
    const numv = (id) => parseFloat(el2.querySelector(id).value);
    if (sel?.type === "wall") {
      const w = f.walls.find((x) => x.id === sel.id);
      on("#pT", "change", () => { w.thickness = Math.max(0.03, numv("#pT")); commit(); draw(); });
      on("#pH", "change", () => { const v = numv("#pH"); if (Math.abs(v - f.height) < 1e-6) delete w.height; else w.height = v; commit(); });
    }
    if (sel?.type === "room") {
      const r = f.rooms.find((x) => x.id === sel.id);
      on("#pN", "change", () => { r.name = el2.querySelector("#pN").value.trim() || r.name; commit(); draw(); });
      on("#pY", "change", () => { r.type = el2.querySelector("#pY").value; commit(); });
    }
    if (sel?.type === "opening") {
      const o = f.openings.find((x) => x.id === sel.id), w = f.walls.find((x) => x.id === o.wall);
      on("#pY", "change", () => { o.type = el2.querySelector("#pY").value; commit(); draw(); });
      for (const [id, k] of [["#pW", "width"], ["#pH", "height"], ["#pS", "sill"], ["#pO", "offset"]]) on(id, "change", () => { o[k] = Math.max(0, numv(id)); o.offset = Math.min(o.offset, Math.max(0, wallLength(w) - o.width)); commit(); draw(); renderProps(); });
    }
    if (sel?.type === "item") on("#pF", "change", () => { items().find((x) => x.id === sel.id).ref.floor = el2.querySelector("#pF").value; commit(); draw(); });
    if (!sel) {
      on("#fN", "change", () => { f.name = el2.querySelector("#fN").value.trim() || f.name; commit(); renderFloors(); });
      on("#fE", "change", () => { f.elevation = numv("#fE"); commit(); });
      on("#fH", "change", () => { f.height = Math.max(1.8, numv("#fH")); commit(); });
      on("#fOut", "click", () => { f.outline = computeOutline(f); commit(); ctx.toast(L("Contorno atualizado", "Outline updated")); });
      on("#fDel", "click", () => { if (!confirm(L("Apagar este piso?", "Delete this floor?"))) return; draft.floors = draft.floors.filter((x) => x.id !== f.id); draft.roofs = (draft.roofs || []).filter((r) => r.floor !== f.id); floorId = draft.floors[0].id; commit(); renderAll(); });
      on("#fRoof", "click", () => { if (!f.outline?.length) f.outline = computeOutline(f); if (f.outline.length < 3) return ctx.toast(L("Desenhe paredes primeiro", "Draw walls first")); draft.roofs ||= []; draft.roofs.push({ id: uid("roof"), floor: f.id, type: "gable", pitch_deg: 30, overhang: 0.4, ridge: "x", outline: bboxPoly(f.outline) }); commit(); renderProps(); });
      el2.querySelectorAll("[data-rt]").forEach((s) => (s.onchange = () => { const r = draft.roofs.find((x) => x.id === s.dataset.rt); r.type = s.value; if (r.type !== "flat" && !r.pitch_deg) r.pitch_deg = 30; commit(); renderProps(); }));
      el2.querySelectorAll("[data-rp]").forEach((s) => (s.onchange = () => { draft.roofs.find((x) => x.id === s.dataset.rp).pitch_deg = Math.max(5, Math.min(60, +s.value)); commit(); }));
      el2.querySelectorAll("[data-rr]").forEach((s) => (s.onchange = () => { draft.roofs.find((x) => x.id === s.dataset.rr).ridge = s.value; commit(); }));
      el2.querySelectorAll("[data-rd]").forEach((b) => (b.onclick = () => { draft.roofs = draft.roofs.filter((x) => x.id !== b.dataset.rd); commit(); renderProps(); }));
    }
    on("#pDel", "click", () => { removeSel(); });
  }

  function removeSel() {
    const f = floor();
    if (!sel) return;
    if (sel.type === "wall") { f.walls = f.walls.filter((w) => w.id !== sel.id); f.openings = f.openings.filter((o) => o.wall !== sel.id); }
    if (sel.type === "room") f.rooms = f.rooms.filter((r) => r.id !== sel.id);
    if (sel.type === "opening") f.openings = f.openings.filter((o) => o.id !== sel.id);
    if (sel.type === "item") { const it = items().find((x) => x.id === sel.id); const m = draft.modules[it.mod]; for (const k of ["items", "aps", "entities"]) if (m[k]) m[k] = m[k].filter((x) => x.id !== sel.id); }
    sel = null; commit(); draw(); renderProps();
  }

  function renderAll() { renderFloors(); renderTools(); renderProps(); draw(); }

  // ---------- input ----------
  function hitTarget(e) {
    const t = e.target;
    if (t.dataset?.handle) return { type: "handle", ref: t.dataset.handle };
    if (t.dataset?.item) return { type: "item", id: t.dataset.item };
    if (t.dataset?.opening) return { type: "opening", id: t.dataset.opening };
    if (t.dataset?.wall) return { type: "wall", id: t.dataset.wall };
    if (t.dataset?.room) return { type: "room", id: t.dataset.room };
    return null;
  }

  svg.addEventListener("pointerdown", (e) => {
    svg.setPointerCapture(e.pointerId);
    const p = toWorld(e), hit = hitTarget(e), f = floor();
    if (e.button === 1 || (tool === "select" && !hit)) { drag = { pan: true, start: [e.clientX, e.clientY], view: { ...view } }; if (tool === "select") { sel = null; renderProps(); draw(); } return; }
    if (tool === "select") {
      if (hit.type === "handle") {
        const [kind, id, k] = hit.ref.split(":");
        if (kind === "wall") { const w = f.walls.find((x) => x.id === id); const pt = w[k]; const shared = []; for (const o of f.walls) for (const kk of ["a", "b"]) if (o[kk][0] === pt[0] && o[kk][1] === pt[1]) shared.push(o[kk]); drag = { pts: shared }; }
        else { const r = f.rooms.find((x) => x.id === id); drag = { pts: [r.polygon[+k]] }; }
        return;
      }
      sel = hit;
      if (hit.type === "item") drag = { item: items().find((x) => x.id === hit.id).ref };
      renderProps(); draw();
      return;
    }
    if (tool === "delete" && hit && hit.type !== "handle") { sel = hit; removeSel(); return; }
    if (tool === "wall") {
      const q = chain ? snap(ortho(chain.at(-1), p)) : snap(p);
      if (chain && Math.hypot(q[0] - chain.at(-1)[0], q[1] - chain.at(-1)[1]) > 0.05) {
        f.walls.push({ id: uid("w"), a: [...chain.at(-1)], b: q, thickness: f.walls.length === 0 || e.shiftKey ? 0.3 : (f.walls.at(-1)?.thickness ?? 0.3) });
        commit();
        if (q[0] === chain[0][0] && q[1] === chain[0][1]) { chain = null; draw(); return; }
      }
      chain = chain ? [...chain, q] : [q];
      draw(); return;
    }
    if (tool === "room") {
      const q = snap(p);
      if (roomPts && roomPts.length >= 3 && Math.hypot(q[0] - roomPts[0][0], q[1] - roomPts[0][1]) < 0.3) return closeRoom();
      roomPts = roomPts ? [...roomPts, q] : [q]; draw(); return;
    }
    if (["door", "window", "garage"].includes(tool)) {
      const nw = nearestWall(p);
      if (!nw) return ctx.toast(L("Clique em cima de uma parede", "Click on a wall"));
      const width = tool === "door" ? 0.9 : tool === "garage" ? 2.6 : 1.2;
      const Lw = wallLength(nw.w);
      if (Lw < width + 0.1) return ctx.toast(L("Parede demasiado curta", "Wall too short"));
      const o = { id: uid("o"), wall: nw.w.id, type: tool, width, height: tool === "window" ? 1.2 : tool === "garage" ? 2.3 : 2.1, sill: tool === "window" ? 0.9 : 0, offset: r2(Math.max(0, Math.min(Lw - width, nw.s - width / 2))) };
      f.openings.push(o); sel = { type: "opening", id: o.id }; commit(); draw(); renderProps(); return;
    }
    if (tool === "calibrate") {
      if (!f.plan) return ctx.toast(L("Carregue primeiro a imagem da planta", "Upload the plan image first"));
      calib = calib ? [...calib, p] : [p];
      if (calib.length === 2) {
        const d = Math.hypot(calib[1][0] - calib[0][0], calib[1][1] - calib[0][1]);
        const real = parseFloat(String(prompt(L("Distância real entre os dois pontos (m)", "Real distance between the two points (m)"), "5") || "").replace(",", "."));
        if (real > 0 && d > 0) {
          const k = real / d;
          const o = f.plan.origin;
          f.plan.origin = [r2(calib[0][0] - (calib[0][0] - o[0]) * k), r2(calib[0][1] - (calib[0][1] - o[1]) * k)];
          f.plan.m_per_px *= k;
          commit(); ctx.toast(L("Escala da planta atualizada", "Plan scale updated"));
          tool = "wall"; renderTools(); fit();
        }
        calib = null;
      }
      draw();
    }
  });
  svg.addEventListener("pointermove", (e) => {
    const p = toWorld(e);
    if (drag?.pan) { const r = svg.getBoundingClientRect(); view.x = drag.view.x - ((e.clientX - drag.start[0]) / r.width) * view.w; view.y = drag.view.y - ((e.clientY - drag.start[1]) / r.height) * view.h; draw(); return; }
    if (drag?.pts) { const q = snap(p, drag.pts[0]); for (const pt of drag.pts) { pt[0] = q[0]; pt[1] = q[1]; } drag.moved = true; draw(); return; }
    if (drag?.item) { drag.item.pos = [r2(p[0]), r2(p[1])]; drag.moved = true; draw(); return; }
    if (tool === "wall") hover = chain ? snap(ortho(chain.at(-1), p)) : snap(p);
    else if (tool === "room") hover = snap(p);
    else if (tool === "calibrate") hover = p;
    else hover = null;
    if (hover || chain || roomPts) draw();
  });
  svg.addEventListener("pointerup", () => { if (drag?.moved) { commit(); renderProps(); } drag = null; });
  svg.addEventListener("dblclick", () => { if (tool === "wall") { chain = null; draw(); } if (tool === "room" && roomPts?.length >= 3) closeRoom(); });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = toWorld(e), k = Math.exp(e.deltaY * 0.0012);
    view = { x: p[0] - (p[0] - view.x) * k, y: p[1] - (p[1] - view.y) * k, w: view.w * k, h: view.h * k };
    draw();
  }, { passive: false });
  function closeRoom() {
    const name = prompt(L("Nome da divisão", "Room name"), L("Divisão", "Room")) || L("Divisão", "Room");
    const r = { id: uid("r"), name: name.slice(0, 40), type: "other", polygon: roomPts };
    floor().rooms.push(r); roomPts = null; sel = { type: "room", id: r.id }; commit(); draw(); renderProps();
  }
  const onKey = (e) => {
    if (e.target.matches("input,select,textarea")) return;
    if (e.key === "Escape") { chain = null; roomPts = null; calib = null; draw(); }
    if (e.key === "Enter" && roomPts?.length >= 3) closeRoom();
    if ((e.key === "Delete" || e.key === "Backspace") && sel) removeSel();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  };
  document.addEventListener("keydown", onKey);
  const undo = () => { if (hpos > 0) restore(--hpos); };
  const redo = () => { if (hpos < hist.length - 1) restore(++hpos); };
  $("#edUndo").onclick = undo; $("#edRedo").onclick = redo; $("#edFit").onclick = fit;
  $("#edAddFloor").onclick = () => {
    const top = [...draft.floors].sort((a, b) => b.elevation - a.elevation)[0];
    const f = { id: uid("f"), name: L(`Piso ${draft.floors.length}`, `Floor ${draft.floors.length}`), elevation: r2(top.elevation + top.height + (top.slab ?? 0.2)), height: 2.6, slab: 0.2, outline: structuredClone(top.outline || []), walls: [], rooms: [], openings: [], plan: null, model: null };
    // start with the exterior walls of the floor below
    f.walls = top.walls.filter((w) => (w.thickness ?? 0.2) >= 0.2).map((w) => ({ ...structuredClone(w), id: uid("w") }));
    draft.floors.push(f); floorId = f.id; commit(); renderAll();
  };
  const close = () => { document.removeEventListener("keydown", onKey); root.remove(); opts.onClose?.(); };
  $("#edCancel").onclick = () => { if (hpos > 0 && !confirm(L("Sair sem guardar?", "Leave without saving?"))) return; close(); };
  $("#edSave").onclick = async () => {
    const out = stripTmp(draft);
    for (const f of out.floors) if (f.walls.length && (!f.outline || f.outline.length < 3)) f.outline = computeOutline(f);
    const v = validate(out);
    if (!v.ok) { ctx.toast(v.errors[0], 5000); return; }
    if (opts.onSave) { opts.onSave(out); close(); return; }
    try { await ctx.saveProfile(out); close(); } catch (e) { ctx.toast(e.message, 5000); }
  };
  renderAll();
  requestAnimationFrame(fit);
  return { close };
}

/** Outline from exterior (thick) walls: chain them into a loop; fall back to the bounding box. */
export function computeOutline(f) {
  const ext = f.walls.filter((w) => (w.thickness ?? 0.2) >= 0.2);
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  if (ext.length >= 3) {
    const left = [...ext];
    const poly = [left[0].a, left[0].b];
    left.splice(0, 1);
    while (left.length) {
      const end = key(poly.at(-1));
      const i = left.findIndex((w) => key(w.a) === end || key(w.b) === end);
      if (i < 0) break;
      const w = left.splice(i, 1)[0];
      poly.push(key(w.a) === end ? w.b : w.a);
    }
    if (poly.length >= 4 && key(poly[0]) === key(poly.at(-1))) return poly.slice(0, -1).map((p) => [p[0], p[1]]);
  }
  const pts = f.walls.flatMap((w) => [w.a, w.b]).concat(f.rooms.flatMap((r) => r.polygon));
  if (!pts.length) return [];
  return bboxPoly(pts);
}
function bboxPoly(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
