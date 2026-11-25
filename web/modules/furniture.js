// Furniture: add simple pieces, and move, turn or hide pieces of an imported model. Edits happen live in 3D
// and are stored with one "Save" (the whole layout is part of the profile).
import * as THREE from "three";
import { getLang } from "../i18n.js";
import { uid } from "../profile/profile.js";
import { FURN_LIB, buildFurniture, furnitureSize, modelNodeKey, pieceOf, setNodeTransform } from "../engine/furniture.js";

const L = (pt, en) => (getLang() === "pt-PT" ? pt : en);
let draft = null, sel = null, placing = null, editModel = false, dirty = false, box = null;

const fm = (ctx) => (draft ||= structuredClone(ctx.profile.modules.furniture || { enabled: true, items: [], overrides: {} }));
const STEP = 0.1, TURN = 15;

function highlight(ctx, obj) {
  if (box) { ctx.viewer.scene.remove(box); box = null; }
  if (!obj) return;
  box = new THREE.BoxHelper(obj, 0x5ce1ff); ctx.viewer.scene.add(box);
}

function pieceObj(ctx, id) {
  for (const [, x] of ctx.viewer.house.floors) for (const c of x.group.children) if (c.userData.furnitureId === id) return c;
  return null;
}

function placePiece(ctx, p) { // (re)build one custom piece in the scene
  const old = pieceObj(ctx, p.id); old?.parent.remove(old);
  const f = ctx.floorById(p.floor); if (!f) return null;
  const m = buildFurniture(p.type, p);
  m.position.set(p.pos[0], f.elevation, p.pos[1]); m.rotation.y = (-(p.rot_deg || 0) * Math.PI) / 180;
  m.userData = { furnitureId: p.id, floorId: f.id };
  m.traverse((o) => { if (o.isMesh) o.userData.furnitureId = p.id; });
  ctx.viewer.house.floors.get(f.id).group.add(m);
  return m;
}

function modelPick(ctx, hit) {
  let o = hit.object;
  if (o.userData.furnitureId) { sel = { kind: "piece", id: o.userData.furnitureId }; highlight(ctx, pieceObj(ctx, sel.id)); ctx.refreshPanel(); return true; }
  if (!editModel) return false;
  let root = o; while (root && !root.userData.modelRoot) root = root.parent;
  if (!root) return false;
  const piece = pieceOf(o, root);
  if (!piece) { ctx.toast(L("Isso faz parte da estrutura (parede ou laje).", "That is part of the structure (a wall or slab).")); return true; }
  const key = modelNodeKey(piece, root);
  sel = { kind: "node", key, obj: piece, name: piece.name || L("Peça do modelo", "Model piece") };
  highlight(ctx, piece); ctx.refreshPanel();
  return true;
}

function nudge(ctx, dx, dy, dr) {
  const d = fm(ctx);
  if (sel?.kind === "piece") {
    const p = d.items.find((x) => x.id === sel.id); if (!p) return;
    p.pos = [Math.round((p.pos[0] + dx) * 100) / 100, Math.round((p.pos[1] + dy) * 100) / 100];
    p.rot_deg = (((p.rot_deg || 0) + dr) % 360 + 360) % 360;
    highlight(ctx, placePiece(ctx, p));
  } else if (sel?.kind === "node") {
    const ov = (d.overrides[sel.key] ||= {});
    const c = sel.obj.userData.ht0?.c || new THREE.Box3().setFromObject(sel.obj).getCenter(new THREE.Vector3());
    const cur = ov.pos || [c.x, c.z];
    ov.pos = [Math.round((cur[0] + dx) * 100) / 100, Math.round((cur[1] + dy) * 100) / 100];
    ov.rot_deg = (((ov.rot_deg || 0) + dr) % 360 + 360) % 360;
    setNodeTransform(sel.obj, ov); highlight(ctx, sel.obj);
  }
  dirty = true; ctx.refreshPanel();
}

function catalogue(ctx) {
  const sh = document.querySelector("#sheet");
  sh.innerHTML = `<button class="close">✕</button><h2>${L("Adicionar peça", "Add a piece")}</h2><div class="grid3">${Object.entries(FURN_LIB).map(([k, v]) => `<button class="chip" data-ft="${k}">${v.icon} ${ctx.esc(getLang() === "pt-PT" ? v.pt : v.en)}</button>`).join("")}</div>`;
  sh.classList.remove("hidden");
  sh.querySelector(".close").onclick = () => sh.classList.add("hidden");
  sh.querySelectorAll("[data-ft]").forEach((b) => (b.onclick = () => { placing = b.dataset.ft; sh.classList.add("hidden"); ctx.hint(L("Clique na casa para pousar a peça", "Click in the house to drop the piece")); }));
}

export default {
  id: "furniture",
  icon: "🛋",
  tool: true, // edits the scene; not a layer you show or hide
  isPlacing: () => !!placing,
  activate(ctx) { draft = null; sel = null; dirty = false; editModel = false; ctx.viewer.pickModel = (hit) => modelPick(ctx, hit); },
  deactivate(ctx) {
    ctx.viewer.pickModel = null; highlight(ctx, null); placing = null; ctx.hint(null);
    if (dirty) { dirty = false; draft = null; ctx.viewer.load(ctx.profile, (a) => ctx.api.assetUrl(a)); } // drop unsaved changes
  },
  onPick(ctx, pick) {
    if (placing && pick.pos) {
      const d = fm(ctx);
      const p = { id: uid("fu"), type: placing, floor: pick.floorId, pos: pick.pos.map((v) => Math.round(v * 100) / 100), rot_deg: 0 };
      d.items.push(p); placing = null; ctx.hint(null);
      sel = { kind: "piece", id: p.id }; highlight(ctx, placePiece(ctx, p)); dirty = true; ctx.refreshPanel();
      return;
    }
    if (!pick.marker) { sel = null; highlight(ctx, null); ctx.refreshPanel(); }
  },
  panel(ctx, el) {
    const { esc } = ctx, d = fm(ctx), canEdit = ctx.api.canWrite;
    const name = (p) => { const l = FURN_LIB[p.type]; return p.label || (l ? (getLang() === "pt-PT" ? l.pt : l.en) : p.type); };
    const hasModel = ctx.profile.floors.some((f) => f.model);
    const ovs = Object.values(d.overrides || {});
    let selHtml = "";
    if (sel?.kind === "piece") {
      const p = d.items.find((x) => x.id === sel.id);
      if (p) { const s = furnitureSize(p); selHtml = `<div class="card sel" style="display:block"><b>${FURN_LIB[p.type]?.icon || "▫"} ${esc(name(p))}</b><small> · ${s.w}×${s.d} m · ${p.rot_deg || 0}°</small>`; }
    } else if (sel?.kind === "node") {
      const ov = d.overrides[sel.key] || {};
      selHtml = `<div class="card sel" style="display:block"><b>📦 ${esc(sel.name)}</b><small> · ${ov.hidden ? L("escondida", "hidden") : L("visível", "visible")}${ov.rot_deg ? ` · ${ov.rot_deg}°` : ""}</small>`;
    }
    if (selHtml && canEdit) selHtml += `<div class="pad">
      <button class="wbtn" data-n="0,-1,0">↑</button><button class="wbtn" data-n="-1,0,0">←</button><button class="wbtn" data-n="1,0,0">→</button><button class="wbtn" data-n="0,1,0">↓</button>
      <button class="wbtn" data-n="0,0,-1">⟲</button><button class="wbtn" data-n="0,0,1">⟳</button></div>
      <div class="row">${sel.kind === "piece" ? `<button class="btn small" id="fuDel">${L("Apagar", "Delete")}</button>` : `<button class="btn small" id="fuHide">${(d.overrides[sel.key] || {}).hidden ? L("Mostrar", "Show") : L("Esconder", "Hide")}</button><button class="btn small" id="fuReset">${L("Repor", "Reset")}</button>`}</div></div>`;
    else if (selHtml) selHtml += "</div>";
    el.innerHTML = `<div class="kicker">${L("Mobília", "Furniture")}</div>
      <div class="ring-row"><div class="mini"><b>${d.items.length}</b><span>${L("peças novas", "new pieces")}</span></div>${hasModel ? `<div class="mini"><b>${ovs.filter((o) => o.hidden).length}</b><span>${L("escondidas", "hidden")}</span></div><div class="mini"><b>${ovs.filter((o) => !o.hidden).length}</b><span>${L("mudadas", "moved")}</span></div>` : ""}</div>
      ${selHtml}
      <div class="list" style="margin-top:10px">${d.items.map((p) => `<div class="card${sel?.id === p.id ? " on" : ""}" data-id="${esc(p.id)}"><div class="ic">${FURN_LIB[p.type]?.icon || "▫"}</div><div class="bd"><b>${esc(name(p))}</b><small>${esc(ctx.floorById(p.floor)?.name || "")}</small></div></div>`).join("")}</div>
      ${canEdit ? `<button class="btn block" id="fuAdd">＋ ${L("Adicionar peça", "Add a piece")}</button>
      ${hasModel ? `<label class="toggle"><input type="checkbox" id="fuModel" ${editModel ? "checked" : ""}> ${L("Editar peças do modelo 3D (clique numa peça)", "Edit pieces of the 3D model (click a piece)")}</label>` : ""}
      <button class="btn block primary" id="fuSave" ${dirty ? "" : "disabled"}>${L("Guardar mobília", "Save furniture")}</button>` : `<div class="note">${L("Entre para editar a mobília.", "Sign in to edit the furniture.")}</div>`}
      <div class="note">${L("Setas: 10 cm no desenho; ⟲ ⟳: 15°.", "Arrows: 10 cm on the plan; ⟲ ⟳: 15°.")}</div>`;
    el.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => { const [x, y, r] = b.dataset.n.split(",").map(Number); nudge(ctx, x * STEP, y * STEP, r * TURN); }));
    el.querySelectorAll(".card[data-id]").forEach((c) => (c.onclick = () => { sel = { kind: "piece", id: c.dataset.id }; highlight(ctx, pieceObj(ctx, sel.id)); ctx.refreshPanel(); }));
    el.querySelector("#fuAdd")?.addEventListener("click", () => catalogue(ctx));
    el.querySelector("#fuModel")?.addEventListener("change", (e) => { editModel = e.target.checked; ctx.hint(editModel ? L("Clique numa peça do modelo", "Click a piece of the model") : null); });
    el.querySelector("#fuDel")?.addEventListener("click", () => { d.items = d.items.filter((x) => x.id !== sel.id); pieceObj(ctx, sel.id)?.removeFromParent(); sel = null; highlight(ctx, null); dirty = true; ctx.refreshPanel(); });
    el.querySelector("#fuHide")?.addEventListener("click", () => { const ov = (d.overrides[sel.key] ||= {}); ov.hidden = !ov.hidden; setNodeTransform(sel.obj, ov); dirty = true; ctx.refreshPanel(); });
    el.querySelector("#fuReset")?.addEventListener("click", () => { delete d.overrides[sel.key]; setNodeTransform(sel.obj, {}); highlight(ctx, sel.obj); dirty = true; ctx.refreshPanel(); });
    el.querySelector("#fuSave")?.addEventListener("click", async () => {
      const prof = structuredClone(ctx.profile);
      prof.modules.furniture = { ...d, enabled: true };
      dirty = false; draft = null; sel = null; highlight(ctx, null);
      await ctx.saveProfile(prof, L("Mobília guardada", "Furniture saved"));
    });
  },
};
