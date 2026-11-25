// Cameras: field-of-view cones in 3D. Live snapshots go through the Home Assistant proxy (owner only).
import * as THREE from "three";
import { getLang } from "../i18n.js";

function cone(c, elev) {
  const range = c.range_m || 9, fov = ((c.fov_deg || 90) * Math.PI) / 180, yaw = ((c.yaw_deg || 0) * Math.PI) / 180;
  const h = c.height ?? 2.5;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const steps = 18;
  for (let i = 0; i <= steps; i++) { const a = -fov / 2 + (fov * i) / steps; shape.lineTo(Math.cos(a) * range, Math.sin(a) * range); }
  shape.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2); // XY -> XZ (y -> z)
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(c.pos[0], elev + 0.07, c.pos[1]);
  m.rotation.y = -yaw;
  const grp = new THREE.Group();
  grp.add(m);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.6 }));
  edge.position.copy(m.position); edge.rotation.copy(m.rotation);
  grp.add(edge);
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.16, 0.16), new THREE.MeshStandardMaterial({ color: 0xdfe7ee, emissive: 0x5ce1ff, emissiveIntensity: 0.3 }));
  pole.position.set(c.pos[0], elev + h, c.pos[1]); pole.rotation.y = -yaw;
  grp.add(pole);
  return grp;
}

export default {
  id: "cameras",
  icon: "📷",
  activate(ctx) {
    const v = ctx.viewer;
    v.clearOverlays("cam"); v.removeLabels("cam");
    for (const c of ctx.profile.modules.cameras.items || []) {
      const f = ctx.floorById(c.floor);
      const g = cone(c, f?.elevation || 0);
      g.userData = { overlay: "cam", floorId: c.floor };
      v.overlays.add(g);
      v.addLabel(`📷 ${c.label}`, new THREE.Vector3(c.pos[0], (f?.elevation || 0) + (c.height ?? 2.5) + 0.5, c.pos[1]), c.floor, "mk cam");
    }
    v.applyFocus();
  },
  deactivate(ctx) { ctx.viewer.clearOverlays("cam"); ctx.viewer.removeLabels("cam"); },
  panel(ctx, el) {
    const { t, esc } = ctx;
    const pt = getLang() === "pt-PT";
    const items = ctx.profile.modules.cameras.items || [];
    el.innerHTML = `<div class="kicker">${esc(t("cameras_cov"))}</div>
      <div class="list">${items.map((c) => `<div class="card" data-id="${esc(c.id)}"><div class="ic">📷</div><div class="bd"><b>${esc(c.label)}</b><small>${esc(ctx.floorById(c.floor)?.name || "")} · ${c.fov_deg || 90}° · ${c.range_m || 9} m</small></div>${c.entity_id && ctx.api.owner ? `<button class="wbtn" data-snap="${esc(c.entity_id)}">👁</button>` : ""}</div>`).join("")}</div>
      <div class="note">${esc(t("cameras_note"))}</div><div id="snap"></div>`;
    el.querySelectorAll("[data-snap]").forEach((b) => (b.onclick = () => { el.querySelector("#snap").innerHTML = `<img alt="" style="width:100%;border-radius:12px;margin-top:10px;border:1px solid var(--line)" src="/api/ha/camera/${encodeURIComponent(b.dataset.snap)}?t=${Date.now()}">`; }));
    void pt;
  },
};
