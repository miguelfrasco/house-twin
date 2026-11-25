// Furniture: a small library of simple procedural pieces (no downloads, no textures), plus overrides that
// move, turn or hide pieces of an imported model. Pieces live in profile.modules.furniture:
//   items: [{ id, type, floor, pos: [x, y], rot_deg, label?, w?, d?, h? }]
//   overrides: { "<node key>": { hidden?, pos?: [x, y], rot_deg? } }   (node key = modelNodeKey())
import * as THREE from "three";

export const FURN_LIB = {
  sofa: { pt: "Sofá", en: "Sofa", w: 2.2, d: 0.9, h: 0.8, c: 0x6f8399, icon: "🛋️" },
  armchair: { pt: "Poltrona", en: "Armchair", w: 0.9, d: 0.85, h: 0.85, c: 0x7d8fa5, icon: "💺" },
  bed_double: { pt: "Cama de casal", en: "Double bed", w: 1.6, d: 2.0, h: 0.55, c: 0xd8dde4, icon: "🛏️" },
  bed_single: { pt: "Cama individual", en: "Single bed", w: 0.9, d: 2.0, h: 0.55, c: 0xd8dde4, icon: "🛏️" },
  table: { pt: "Mesa de jantar", en: "Dining table", w: 1.8, d: 0.9, h: 0.76, c: 0x9a7a5a, icon: "🍽️" },
  coffee: { pt: "Mesa de centro", en: "Coffee table", w: 1.1, d: 0.6, h: 0.4, c: 0x9a7a5a, icon: "☕" },
  chair: { pt: "Cadeira", en: "Chair", w: 0.45, d: 0.5, h: 0.9, c: 0x9a7a5a, icon: "🪑" },
  desk: { pt: "Secretária", en: "Desk", w: 1.4, d: 0.7, h: 0.75, c: 0xb8a58a, icon: "🖥️" },
  wardrobe: { pt: "Roupeiro", en: "Wardrobe", w: 1.8, d: 0.6, h: 2.1, c: 0xcfd5dc, icon: "🚪" },
  shelf: { pt: "Estante", en: "Bookcase", w: 1.0, d: 0.35, h: 1.9, c: 0xb8a58a, icon: "📚" },
  tv: { pt: "Móvel de TV", en: "TV unit", w: 1.8, d: 0.45, h: 0.5, c: 0x3a4452, icon: "📺" },
  side: { pt: "Mesa de cabeceira", en: "Bedside table", w: 0.5, d: 0.4, h: 0.5, c: 0xb8a58a, icon: "🗄️" },
  rug: { pt: "Tapete", en: "Rug", w: 2.0, d: 1.4, h: 0.02, c: 0x5a6f86, icon: "🟫" },
  workbench: { pt: "Bancada", en: "Workbench", w: 2.0, d: 0.7, h: 0.9, c: 0x8a7a6a, icon: "🧰" },
  car: { pt: "Carro", en: "Car", w: 1.85, d: 4.5, h: 1.45, c: 0x9aa8b8, icon: "🚗" },
  bike: { pt: "Bicicleta", en: "Bicycle", w: 0.6, d: 1.75, h: 1.0, c: 0x5ce1ff, icon: "🚲" },
  bench: { pt: "Banco de jardim", en: "Garden bench", w: 1.5, d: 0.6, h: 0.8, c: 0x8a6a4a, icon: "🪵" },
  sunbed: { pt: "Espreguiçadeira", en: "Sun lounger", w: 0.7, d: 1.9, h: 0.4, c: 0xe0e4ea, icon: "⛱️" },
};

const mats = new Map();
const mat = (c, o = {}) => { const k = c + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o })); return mats.get(k); };
// Returns a group whose origin is the centre of the footprint on the floor; local +x = width, +z = depth.
export function buildFurniture(type, custom = {}) {
  const L = FURN_LIB[type] || { w: 1, d: 1, h: 0.8, c: 0x8899aa }; const { w, d, h } = furnitureSize({ type, ...custom }); const c = L.c ?? 0x8899aa; const g = new THREE.Group();
  const box = (bw, bh, bd, x, y, z, col = c, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat(col, o)); m.position.set(x, y + bh / 2, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const legs = (top, lh, inset = 0.06, r = 0.025) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(r * 2, lh, r * 2, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), 0x5a4a3a); };
  switch (type) {
    case "sofa": box(w, 0.42, d, 0, 0, 0); box(w, 0.45, 0.2, 0, 0.42, -d / 2 + 0.1); box(0.18, 0.25, d, -w / 2 + 0.09, 0.42, 0); box(0.18, 0.25, d, w / 2 - 0.09, 0.42, 0); break;
    case "armchair": box(w, 0.42, d, 0, 0, 0); box(w, 0.45, 0.18, 0, 0.42, -d / 2 + 0.09); box(0.15, 0.22, d, -w / 2 + 0.075, 0.42, 0); box(0.15, 0.22, d, w / 2 - 0.075, 0.42, 0); break;
    case "bed_double": case "bed_single": box(w, 0.45, d, 0, 0, 0, 0x8a96a6); box(w - 0.06, 0.1, d - 0.25, 0, 0.45, 0.1, 0xeef2f6); box(w, 0.9, 0.08, 0, 0, -d / 2 + 0.04, 0x6a7686); box(type === "bed_double" ? 0.55 : 0.5, 0.1, 0.32, type === "bed_double" ? -0.38 : 0, 0.55, -d / 2 + 0.3, 0xffffff); if (type === "bed_double") box(0.55, 0.1, 0.32, 0.38, 0.55, -d / 2 + 0.3, 0xffffff); break;
    case "table": case "coffee": case "desk": case "side": case "workbench": box(w, 0.05, d, 0, h - 0.05, 0); legs(h, h - 0.05); if (type === "side") box(w - 0.04, h - 0.1, d - 0.04, 0, 0.02, 0); break;
    case "chair": box(w, 0.05, d, 0, 0.45, 0); box(w, 0.45, 0.04, 0, 0.5, -d / 2 + 0.02); legs(0.45, 0.45, 0.04, 0.02); break;
    case "wardrobe": box(w, h, d, 0, 0, 0); box(0.01, h - 0.1, 0.01, 0, 0.05, d / 2 + 0.005, 0x8a96a6); break;
    case "shelf": box(w, h, 0.03, 0, 0, -d / 2 + 0.015); box(0.03, h, d, -w / 2 + 0.015, 0, 0); box(0.03, h, d, w / 2 - 0.015, 0, 0); for (let i = 0; i < 5; i++) box(w, 0.025, d, 0, (i * (h - 0.03)) / 4, 0); break;
    case "tv": box(w, h, d, 0, 0, 0); box(w * 0.8, 0.55, 0.04, 0, h + 0.05, -d / 2 + 0.1, 0x111418, { roughness: 0.2 }); break;
    case "rug": box(w, 0.015, d, 0, 0, 0, c, { roughness: 1 }); break;
    case "car": box(w, 0.75, d, 0, 0.18, 0); box(w - 0.12, 0.5, d * 0.5, 0, 0.93, -0.1, 0x2a3644, { roughness: 0.2, metalness: 0.3 }); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 16), mat(0x15191e)); wh.rotation.z = Math.PI / 2; wh.position.set(sx * (w / 2 - 0.1), 0.32, sz * (d / 2 - 0.8)); g.add(wh); } break;
    case "bike": for (const sz of [-0.55, 0.55]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 8, 24), mat(0x222831)); r.rotation.y = Math.PI / 2; r.position.set(0, 0.35, sz); g.add(r); } box(0.04, 0.04, 1.0, 0, 0.6, 0, c); box(0.04, 0.45, 0.04, 0, 0.35, -0.1, c); break;
    case "bench": box(w, 0.05, d * 0.6, 0, 0.42, 0.05); box(w, 0.35, 0.05, 0, 0.5, -d / 2 + 0.05); legs(0.42, 0.42, 0.08); break;
    case "sunbed": box(w, 0.1, d * 0.68, 0, 0.25, 0.25); const back = box(w, 0.08, d * 0.34, 0, 0.32, -d / 2 + 0.25); back.rotation.x = -0.6; legs(0.25, 0.25, 0.06, 0.02); break;
    default: box(w, h, d, 0, 0, 0);
  }
  return g;
}

/** Footprint of a piece (custom sizes win over the library). */
export function furnitureSize(p) {
  const L = FURN_LIB[p.type] || { w: 1, d: 1, h: 0.8 };
  return { w: p.w ?? L.w, d: p.d ?? L.d, h: p.h ?? L.h };
}

/** All custom pieces as one group, each child at its floor level. */
export function buildFurnitureGroup(profile) {
  const g = new THREE.Group(); g.name = "furniture";
  const fm = profile.modules?.furniture;
  if (!fm?.enabled) return g;
  for (const p of fm.items || []) {
    const f = profile.floors.find((x) => x.id === p.floor); if (!f || !p.pos) continue;
    const m = buildFurniture(p.type, p);
    m.position.set(p.pos[0], f.elevation, p.pos[1]);
    m.rotation.y = (-(p.rot_deg || 0) * Math.PI) / 180;
    m.userData = { furnitureId: p.id, floorId: f.id };
    m.traverse((o) => { if (o.isMesh) o.userData.furnitureId = p.id; });
    g.add(m);
  }
  return g;
}

/** Stable key for a node of an imported model: its name plus the child-index path from the model root. */
export function modelNodeKey(o, root) {
  const path = [];
  for (let n = o; n && n !== root && n.parent; n = n.parent) path.unshift(n.parent.children.indexOf(n));
  return `${(o.name || "").replace(/[^\w-]/g, "").slice(0, 24)}@${path.join(".")}`;
}

/**
 * The movable "piece" a ray hit belongs to: the highest ancestor below the model root that is still
 * furniture-sized (no wall or slab spans). Returns the node or null.
 */
export function pieceOf(hitObject, modelRoot, maxSpan = 4.5, maxH = 2.4) {
  let o = hitObject, best = null;
  while (o && o !== modelRoot && o.parent) {
    const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    if (Math.max(s.x, s.z) <= maxSpan && s.y <= maxH) best = o; else break;
    o = o.parent;
  }
  return best;
}

/** Apply overrides to a loaded model. Returns the number applied. */
export function applyModelOverrides(modelRoot, overrides = {}) {
  let n = 0;
  for (const [k, ov] of Object.entries(overrides || {})) {
    const path = k.split("@")[1]; if (path == null) continue;
    let o = modelRoot;
    for (const i of path ? path.split(".").map(Number) : []) { o = o?.children[i]; }
    if (!o || o === modelRoot) continue;
    setNodeTransform(o, ov); n++;
  }
  return n;
}

/** Move/turn/hide one model node relative to its original placement (world-space plan offsets). */
export function setNodeTransform(o, ov = {}) {
  o.userData.ht0 ||= { p: o.position.clone(), q: o.quaternion.clone(), v: o.visible, c: new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()) };
  const z = o.userData.ht0;
  o.position.copy(z.p); o.quaternion.copy(z.q); o.visible = z.v && !ov.hidden;
  const parent = o.parent; parent.updateMatrixWorld(true);
  const target = new THREE.Vector3(ov.pos ? ov.pos[0] : z.c.x, z.c.y, ov.pos ? ov.pos[1] : z.c.z);
  const th = (-(ov.rot_deg || 0) * Math.PI) / 180;
  if (th) { // rotate about the piece centre (world up)
    const qW = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), th);
    const pq = parent.getWorldQuaternion(new THREE.Quaternion());
    const local = pq.clone().invert().multiply(qW).multiply(pq);
    o.quaternion.premultiply(local);
  }
  o.updateMatrixWorld(true);
  const now = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  const d = target.sub(now); d.y = 0;
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const p0 = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).add(d).applyMatrix4(inv);
  o.position.copy(p0);
  o.updateMatrixWorld(true);
}
