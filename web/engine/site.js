// Site features around the house: sunken areas (a forecourt below the lawn), paving, ramps, boundary walls
// and gates. All in the plan frame (x right, y down -> scene x, z); heights are scene y in metres.
//
// profile.site.features = [
//   { type: "sunken", polygon: [[x,y]...], y: -2.9 }          cut in the ground with retaining walls, paved floor at y
//       optional: vertex_y [per-vertex floor height], open_edges [edge indexes without a wall],
//       floor: false (cut + walls only, floors drawn by other features), cut: false (walls only)
//   { type: "paving", polygon: [[x,y]...], y: 0, color?, vertex_y? }   paved (or green) area, sloped with vertex_y
//   { type: "ramp", path: [[x,y]...], width: 3.4, y0, y1 }    driveway strip, height interpolated along the path
//   { type: "wall", a: [x,y], b: [x,y], y: 0, height: 1.8, thickness: 0.2 }
//   { type: "gate", a, b, y, height: 1.8, style: "sliding" | "swing" | "up", entity_id?: "cover.x" }
// ]
import * as THREE from "three";

const MAT = {
  paving: () => new THREE.MeshStandardMaterial({ color: 0xa9adb1, roughness: 0.95 }),
  ramp: () => new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.9, side: THREE.DoubleSide }),
  retaining: () => new THREE.MeshStandardMaterial({ color: 0xcfc8bb, roughness: 0.95, side: THREE.DoubleSide }),
  wall: () => new THREE.MeshStandardMaterial({ color: 0xe4dfd5, roughness: 0.95 }),
  gate: () => new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.5, metalness: 0.5 }),
};

/** Polygons that cut the lawn (sunken features). */
export function groundHoles(profile) {
  return (profile.site?.features || []).filter((f) => f.type === "sunken" && f.cut !== false && f.polygon?.length >= 3 && (f.y ?? 0) < -0.05).map((f) => f.polygon);
}

function shapeMesh(poly, y, mat, vy) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  if (vy) { // per-vertex heights: ShapeGeometry keeps the outline points (maybe reversed), match each to the nearest
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let best = 0, bd = Infinity;
      poly.forEach(([x, z], k) => { const d = (p.getX(i) - x) ** 2 + (p.getZ(i) - z) ** 2; if (d < bd) { bd = d; best = k; } });
      p.setY(i, (vy[best] ?? 0) - y);
    }
    g.computeVertexNormals();
  }
  const m = new THREE.Mesh(g, mat);
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

/** Vertical quad between two plan points from y0 to y1. */
function vquad(a, b, y0, y1, mat, y0b = y0) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([a[0], y0, a[1], b[0], y0b, b[1], b[0], y1, b[1], a[0], y1, a[1]], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true; m.castShadow = true;
  return m;
}

function boxBetween(a, b, y0, h, t, mat) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, t), mat);
  m.position.set((a[0] + b[0]) / 2, y0 + h / 2, (a[1] + b[1]) / 2);
  m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Ribbon along a polyline; height goes linearly from y0 to y1 with the distance travelled. */
export function rampGeometry(path, width, y0, y1) {
  const n = path.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const L = cum[n - 1] || 1;
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const p = path[i], q = path[Math.min(n - 1, i + 1)], o = path[Math.max(0, i - 1)];
    let dx = q[0] - o[0], dy = q[1] - o[1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const nx = -dy * (width / 2), ny = dx * (width / 2), y = y0 + ((y1 - y0) * cum[i]) / L;
    pos.push(p[0] + nx, y, p[1] + ny, p[0] - nx, y, p[1] - ny);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, length: L };
}

/** Build the site group. Returns { group, gates: [{feature, mesh, closedPos, openPos}], occluders }. */
export function buildSite(profile) {
  const group = new THREE.Group(); group.name = "site";
  const gates = [], occluders = [];
  for (const f of profile.site?.features || []) {
    if ((f.type === "sunken" || f.type === "paving") && f.polygon?.length >= 3) {
      const y = f.y ?? 0, vy = Array.isArray(f.vertex_y) && f.vertex_y.length === f.polygon.length ? f.vertex_y : null;
      const mat = MAT.paving(); if (f.color) mat.color.set(f.color);
      if (f.floor !== false) group.add(shapeMesh(f.polygon, y + 0.005, mat, vy && vy.map((v) => v + 0.005)));
      if (f.type === "sunken" && y < -0.05) {
        const rm = MAT.retaining();
        for (let i = 0; i < f.polygon.length; i++) {
          const j = (i + 1) % f.polygon.length, a = f.polygon[i], b = f.polygon[j];
          if (f.open_edges?.includes(i)) continue; // edges that continue into a ramp or a building
          const w = vquad(a, b, vy ? vy[i] : y, 0, rm, vy ? vy[j] : y); group.add(w); occluders.push(w);
        }
      }
    } else if (f.type === "ramp" && f.path?.length >= 2) {
      const { geometry } = rampGeometry(f.path, f.width || 3, f.y0 ?? 0, f.y1 ?? 0);
      const m = new THREE.Mesh(geometry, MAT.ramp()); m.receiveShadow = true; group.add(m);
    } else if (f.type === "wall" && f.a && f.b) {
      const m = boxBetween(f.a, f.b, f.y ?? 0, f.height ?? 1.8, f.thickness ?? 0.2, MAT.wall());
      group.add(m); occluders.push(m);
    } else if (f.type === "gate" && f.a && f.b) {
      const h = f.height ?? 1.8;
      const m = boxBetween(f.a, f.b, f.y ?? 0, h, 0.08, MAT.gate());
      m.userData = { kind: "gate", featureId: f.id || null, entity_id: f.entity_id || null };
      const L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
      const ux = (f.b[0] - f.a[0]) / L, uy = (f.b[1] - f.a[1]) / L;
      const closed = m.position.clone();
      gates.push({ feature: f, mesh: m, closed, slide: new THREE.Vector3(ux * L * 0.92, 0, uy * L * 0.92), h, open: false, k: 0 });
      group.add(m);
    }
  }
  return { group, gates, occluders };
}

/** Ease gates toward their state (call each frame). Returns true while anything moves. */
let lastT = 0;
export function animateGates(gates, now = performance.now()) {
  const dt = Math.min(0.5, lastT ? (now - lastT) / 1000 : 1 / 60); lastT = now;
  let moving = false;
  for (const g of gates) {
    const target = g.open ? 1 : 0;
    if (Math.abs(g.k - target) < 1e-3) continue;
    g.k += Math.sign(target - g.k) * Math.min(Math.abs(target - g.k), dt / 2.5);
    moving = true;
    const st = g.feature.style || "sliding", m = g.mesh;
    m.position.copy(g.closed); m.scale.set(1, 1, 1);
    if (st === "sliding") m.position.addScaledVector(g.slide, g.k);
    else if (st === "up") { m.scale.y = Math.max(0.05, 1 - g.k); m.position.y = g.closed.y + (g.h * (1 - m.scale.y)) / 2; }
    else m.scale.x = Math.max(0.05, 1 - g.k);
    m.material.color.setHex(g.k > 0.5 ? 0x2f9e6b : 0x4b5563);
  }
  return moving;
}

/** Ground plane (or aerial image) as a mesh with holes for sunken features. Local frame as PlaneGeometry. */
export function planeWithHoles(w, h, center, rotDeg, holes) {
  const r = ((rotDeg || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const toLocal = ([x, z]) => { const dx = x - center[0], dz = z - center[1]; return new THREE.Vector2(dx * c + dz * s, dx * s - dz * c); };
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2), new THREE.Vector2(w / 2, h / 2), new THREE.Vector2(-w / 2, h / 2)]);
  for (const poly of holes) shape.holes.push(new THREE.Path(poly.map(toLocal)));
  const g = new THREE.ShapeGeometry(shape);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return g;
}
