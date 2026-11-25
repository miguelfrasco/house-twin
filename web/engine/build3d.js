// Procedural 3D from the 2D profile. Plan (x, y) -> scene (x, z); height is scene y.
import * as THREE from "three";
import { groundHoles, planeWithHoles } from "./site.js";
import { compassToPlan } from "./sun.js";

export const COLORS = {
  wall: 0xe9e6df, wallExt: 0xd9d3c7, slab: 0xb8b2a6, glass: 0x9fe6ff, door: 0x6b4b36, garage: 0x8c939b,
  roof: 0x9b5f4b, roofFlat: 0x8a8f96, frame: 0x30363d, panel: 0x1b2a44,
  room: { living: 0xc9b48f, kitchen: 0xd8cfc0, bedroom: 0xb9a58a, bathroom: 0xbfd4da, hall: 0xcfc6b6, office: 0xbcae95, garage: 0x9aa0a6, stairs: 0xc2b8a6, outdoor: 0x8fae6d, other: 0xcabfae },
};

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function bbox(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

export function polygonCentroid(poly) {
  let x = 0, y = 0, a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    x += (poly[j][0] + poly[i][0]) * f; y += (poly[j][1] + poly[i][1]) * f; a += f;
  }
  if (Math.abs(a) < 1e-9) { const b = bbox(poly); return [b.cx, b.cy]; }
  return [x / (3 * a), y / (3 * a)];
}

/** Flat horizontal shape at height y from a plan polygon. */
function flatShape(poly, y, material) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2); // shape (x, -z) in XY -> XZ plane
  const m = new THREE.Mesh(g, material);
  m.position.y = y;
  return m;
}

function slab(poly, top, thickness, material) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, material);
  m.position.y = top - thickness;
  return m;
}

/** Split a wall into solid pieces around its openings. Returns [{s0, s1, y0, y1}] in wall-local metres. */
export function wallPieces(wall, openings, height) {
  const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const ops = openings.filter((o) => o.wall === wall.id).sort((p, q) => p.offset - q.offset);
  const pieces = [];
  let s = 0;
  for (const o of ops) {
    const o0 = Math.max(s, o.offset), o1 = Math.min(L, o.offset + o.width);
    if (o0 > s + 0.005) pieces.push({ s0: s, s1: o0, y0: 0, y1: height });
    const sill = o.sill || 0, head = Math.min(height, sill + o.height);
    if (sill > 0.005) pieces.push({ s0: o0, s1: o1, y0: 0, y1: sill, kind: "sill" });
    if (head < height - 0.005) pieces.push({ s0: o0, s1: o1, y0: head, y1: height, kind: "head" });
    s = Math.max(s, o1);
  }
  if (s < L - 0.005) pieces.push({ s0: s, s1: L, y0: 0, y1: height });
  return { L, pieces, ops };
}

function wallFrame(w) {
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy);
  return { ux: dx / L, uy: dy / L, L, angle: Math.atan2(dy, dx) };
}

function boxAlong(w, s0, s1, y0, y1, thickness, extend0, extend1, material) {
  const f = wallFrame(w);
  const a = s0 - extend0, b = s1 + extend1, len = b - a;
  const g = new THREE.BoxGeometry(len, y1 - y0, thickness);
  const m = new THREE.Mesh(g, material);
  const mid = (a + b) / 2;
  m.position.set(w.a[0] + f.ux * mid, (y0 + y1) / 2, w.a[1] + f.uy * mid);
  m.rotation.y = -f.angle;
  return m;
}

function materials() {
  return {
    wall: new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.92 }),
    wallExt: new THREE.MeshStandardMaterial({ color: COLORS.wallExt, roughness: 0.95 }),
    slab: new THREE.MeshStandardMaterial({ color: COLORS.slab, roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: COLORS.glass, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false }),
    door: new THREE.MeshStandardMaterial({ color: COLORS.door, roughness: 0.7 }),
    garage: new THREE.MeshStandardMaterial({ color: COLORS.garage, roughness: 0.6, metalness: 0.3 }),
    roof: new THREE.MeshStandardMaterial({ color: COLORS.roof, roughness: 0.85, side: THREE.DoubleSide }),
    roofFlat: new THREE.MeshStandardMaterial({ color: COLORS.roofFlat, roughness: 0.9 }),
    frame: new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.5 }),
    panel: new THREE.MeshStandardMaterial({ color: COLORS.panel, roughness: 0.25, metalness: 0.5 }),
    ghost: ghostMaterial(),
    edge: new THREE.LineBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.26, depthWrite: false }),
    rooms: Object.fromEntries(Object.entries(COLORS.room).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })])),
  };
}

/** Upper part of a cut-away wall: faint glass, so rooms read from above while the wall keeps its shape. */
export function ghostMaterial() {
  return new THREE.MeshStandardMaterial({ color: COLORS.glass, transparent: true, opacity: 0.09, roughness: 0.1, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
}

/** Wall display settings from the profile: { mode: "half" | "full", cut: metres above the floor }. */
export function wallDisplay(profile) {
  const d = profile?.display || {};
  return { mode: d.walls === "full" ? "full" : "half", cut: Math.min(2.4, Math.max(0.6, +d.wall_cut || 1.2)) };
}

/** Roof faces as quads/triangles in scene coords. */
export function roofFaces(roof, floor) {
  const H = floor.elevation + floor.height;
  const b = bbox(roof.outline);
  const ov = roof.overhang ?? 0.4;
  const t = Math.tan(((roof.pitch_deg || 0) * Math.PI) / 180);
  const x0 = b.x0 - ov, x1 = b.x1 + ov, y0 = b.y0 - ov, y1 = b.y1 + ov;
  const faces = [], gables = [];
  const P = (x, y, h) => v3(x, h, y);
  if (roof.type === "gable" || roof.type === "hip") {
    const alongX = (roof.ridge || (b.w >= b.h ? "x" : "y")) === "x";
    const half = alongX ? b.h / 2 : b.w / 2;
    const top = H + half * t, eave = H - ov * t;
    if (alongX) {
      const ym = b.cy, inset = roof.type === "hip" ? half + ov : 0;
      const rx0 = x0 + inset, rx1 = x1 - inset;
      faces.push({ dir: "-y", pts: [P(x0, y0, eave), P(x1, y0, eave), P(rx1, ym, top), P(rx0, ym, top)] });
      faces.push({ dir: "+y", pts: [P(x1, y1, eave), P(x0, y1, eave), P(rx0, ym, top), P(rx1, ym, top)] });
      if (roof.type === "hip") {
        faces.push({ dir: "-x", pts: [P(x0, y1, eave), P(x0, y0, eave), P(rx0, ym, top)] });
        faces.push({ dir: "+x", pts: [P(x1, y0, eave), P(x1, y1, eave), P(rx1, ym, top)] });
      } else {
        gables.push([P(b.x0, b.y0, H), P(b.x0, b.y1, H), P(b.x0, ym, H + half * t)]);
        gables.push([P(b.x1, b.y1, H), P(b.x1, b.y0, H), P(b.x1, ym, H + half * t)]);
      }
    } else {
      const xm = b.cx, inset = roof.type === "hip" ? half + ov : 0;
      const ry0 = y0 + inset, ry1 = y1 - inset;
      faces.push({ dir: "-x", pts: [P(x0, y1, eave), P(x0, y0, eave), P(xm, ry0, top), P(xm, ry1, top)] });
      faces.push({ dir: "+x", pts: [P(x1, y0, eave), P(x1, y1, eave), P(xm, ry1, top), P(xm, ry0, top)] });
      if (roof.type === "hip") {
        faces.push({ dir: "-y", pts: [P(x0, y0, eave), P(x1, y0, eave), P(xm, ry0, top)] });
        faces.push({ dir: "+y", pts: [P(x1, y1, eave), P(x0, y1, eave), P(xm, ry1, top)] });
      } else {
        gables.push([P(b.x1, b.y0, H), P(b.x0, b.y0, H), P(xm, b.y0, H + half * t)]);
        gables.push([P(b.x0, b.y1, H), P(b.x1, b.y1, H), P(xm, b.y1, H + half * t)]);
      }
    }
  } else if (roof.type === "shed") {
    // rises toward +y unless roof.rise === "-y"/"+x"/"-x"
    const r = roof.rise || "+y";
    const lo = H - ov * t;
    const z = (x, y) => {
      const s = r === "+y" ? y - y0 : r === "-y" ? y1 - y : r === "+x" ? x - x0 : x1 - x;
      return lo + s * t;
    };
    faces.push({ dir: r.startsWith("+") ? "-" + r[1] : "+" + r[1], pts: [P(x0, y0, z(x0, y0)), P(x1, y0, z(x1, y0)), P(x1, y1, z(x1, y1)), P(x0, y1, z(x0, y1))] });
  }
  return { faces, gables, H };
}

function polyMesh(pts, material) {
  const g = new THREE.BufferGeometry();
  const idx = pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

/** Compass direction a roof face looks toward and its tilt. */
export function faceOrientation(face, bearingDeg) {
  const [a, b, c] = face.pts;
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
  if (n.y < 0) n.negate();
  const tilt = (Math.acos(Math.min(1, n.y)) * 180) / Math.PI;
  const planAngle = (Math.atan2(n.z, n.x) * 180) / Math.PI; // from +x toward +y (clockwise on plan)
  const az = (((bearingDeg + planAngle) % 360) + 360) % 360;
  return { normal: n, tilt, az };
}

/** Lay out PV panels on a quad face. Returns meshes and the number placed. */
function panelsOnFace(face, count, mat) {
  const group = new THREE.Group();
  const [p0, p1, p2, p3] = face.pts; // eave edge p0->p1, ridge p3..p2 (gable quads are ordered so)
  if (!p3) return { group, placed: 0 };
  const eaveMid = p0.clone().add(p1).multiplyScalar(0.5);
  const ridgeMid = p2.clone().add(p3).multiplyScalar(0.5);
  const along = new THREE.Vector3().subVectors(p1, p0);
  const up = new THREE.Vector3().subVectors(ridgeMid, eaveMid);
  const W = along.length(), Hs = up.length();
  along.normalize(); up.normalize();
  const n = new THREE.Vector3().crossVectors(along, up).normalize();
  if (n.y < 0) n.negate();
  const pw = 1.0, ph = 1.7, gap = 0.04;
  const cols = Math.max(1, Math.floor((W * 0.8) / (pw + gap)));
  const rows = Math.max(1, Math.floor((Hs * 0.75) / (ph + gap)));
  let placed = 0;
  const totalCols = Math.min(cols, Math.ceil(count / rows));
  for (let r = 0; r < rows && placed < count; r++) {
    for (let c = 0; c < totalCols && placed < count; c++) {
      const u = (c - (totalCols - 1) / 2) * (pw + gap);
      const v = Hs * 0.18 + r * (ph + gap) + ph / 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.04, ph), mat);
      const pos = eaveMid.clone().addScaledVector(along, u).addScaledVector(up, v).addScaledVector(n, 0.06);
      m.position.copy(pos);
      const basis = new THREE.Matrix4().makeBasis(along, n, up);
      m.quaternion.setFromRotationMatrix(basis);
      m.userData.pv = true;
      group.add(m);
      placed++;
    }
  }
  return { group, placed };
}

/** Rows of tilted panels on a flat roof, facing a.azimuth (compass, default south). */
function panelsFlat(rf, a, count, bearing, mat) {
  const group = new THREE.Group();
  const az = a.azimuth ?? 180, tilt = ((a.tilt ?? 15) * Math.PI) / 180;
  const [dx, dz] = compassToPlan(az, bearing);
  const yaw = Math.atan2(dx, dz); // local +z -> facing direction
  const pw = a.panel_w ?? 1.13, pd = a.panel_d ?? 1.72, gap = 0.03;
  const perRow = a.per_row || Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / perRow);
  const step = a.row_step ?? Math.max(pd * 1.6, 2.2);
  const [cx, cz] = a.center || polygonCentroid(rf.roof.outline);
  const rowLen = perRow * pw + (perRow - 1) * gap;
  let placed = 0;
  for (let r = 0; r < rows; r++) {
    const row = new THREE.Group();
    const off = (r - (rows - 1) / 2) * step; // rows stacked along the facing direction
    row.position.set(cx + dx * off, rf.face.top, cz + dz * off);
    row.rotation.y = yaw;
    for (let c = 0; c < perRow && placed < count; c++, placed++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.04, pd), mat);
      p.position.set(-rowLen / 2 + pw / 2 + c * (pw + gap), 0.12 + (Math.sin(tilt) * pd) / 2, 0);
      p.rotation.x = tilt; p.castShadow = true; p.userData.pv = true;
      row.add(p);
    }
    group.add(row);
  }
  return { group, placed };
}

/**
 * Build the house. Returns { root, floors: Map(id -> {group, roomMeshes, labels}), roofs, occluders, bounds }.
 * occluders: meshes that block direct sun (no glass).
 */
export function buildHouse(profile, opts = {}) {
  const M = materials();
  const disp = wallDisplay(profile);
  const half = disp.mode === "half";
  const root = new THREE.Group();
  root.name = "house";
  // a solid lower part and, above the cut, a glass "ghost" with faint edges; both still cast shadows and block the sun
  const addWallBox = (structure, w, p, e, t, ext0, ext1, mat, data, occluders) => {
    const cutY = e + disp.cut;
    const y0 = e + p.y0, y1 = e + p.y1;
    if (!half || y1 <= cutY + 0.01) {
      const m = boxAlong(w, p.s0, p.s1, y0, y1, t, ext0, ext1, mat);
      m.castShadow = true; m.receiveShadow = true; m.userData = { ...data };
      structure.add(m); occluders.push(m);
      return;
    }
    if (y0 < cutY - 0.01) {
      const m = boxAlong(w, p.s0, p.s1, y0, cutY, t, ext0, ext1, mat);
      m.castShadow = true; m.receiveShadow = true; m.userData = { ...data };
      structure.add(m); occluders.push(m);
    }
    const g = boxAlong(w, p.s0, p.s1, Math.max(y0, cutY), y1, t, ext0, ext1, M.ghost);
    g.castShadow = true; g.userData = { ...data, ghost: true };
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(g.geometry), M.edge));
    structure.add(g); occluders.push(g);
  };
  const occluders = [];
  const floors = new Map();
  const allPts = [];
  for (const f of profile.floors) {
    const g = new THREE.Group();
    g.name = `floor:${f.id}`;
    g.userData.floorId = f.id;
    const structure = new THREE.Group();
    structure.name = "structure";
    g.add(structure);
    const roomMeshes = [];
    const e = f.elevation;
    const outline = f.outline?.length >= 3 ? f.outline : null;
    if (outline) {
      const s = slab(outline, e, f.slab ?? 0.2, M.slab);
      s.receiveShadow = true; s.castShadow = true; s.userData.kind = "slab";
      structure.add(s); occluders.push(s);
      allPts.push(...outline);
    }
    for (const r of f.rooms) {
      const mat = (M.rooms[r.type] || M.rooms.other).clone();
      const m = flatShape(r.polygon, e + 0.012, mat);
      m.receiveShadow = true;
      m.userData = { kind: "room", roomId: r.id, floorId: f.id };
      g.add(m); roomMeshes.push(m);
      if (!r.outdoor && r.type !== "outdoor") allPts.push(...r.polygon);
    }
    if (!f.model) {
      const extIds = new Set(f.walls.filter((w) => (w.thickness ?? 0.2) >= 0.2).map((w) => w.id));
      for (const w of f.walls) {
        const t = w.thickness ?? 0.2, h = w.height ?? f.height;
        const { pieces, ops } = wallPieces(w, f.openings, h);
        const mat = extIds.has(w.id) ? M.wallExt : M.wall;
        pieces.forEach((p, i) => {
          const ext0 = p.s0 === 0 ? t / 2 : 0, ext1 = i === pieces.length - 1 && p.kind === undefined && Math.abs(p.s1 - Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])) < 0.01 ? t / 2 : 0;
          addWallBox(structure, w, p, e, t, ext0, ext1, mat, { kind: "wall", wallId: w.id, floorId: f.id }, occluders);
        });
        for (const o of ops) {
          const sill = o.sill || 0;
          if (o.type === "window" || (o.type === "door" && o.width >= 1.6)) {
            const pane = boxAlong(w, o.offset + 0.03, o.offset + o.width - 0.03, e + sill + 0.03, e + sill + o.height - 0.03, 0.03, 0, 0, M.glass);
            pane.userData = { kind: "glass", openingId: o.id };
            structure.add(pane);
            const fr = (s0, s1, y0, y1) => { const m = boxAlong(w, s0, s1, e + y0, e + y1, t * 0.6, 0, 0, M.frame); m.userData = { kind: "frame" }; structure.add(m); };
            fr(o.offset, o.offset + o.width, sill, sill + 0.04);
            fr(o.offset, o.offset + o.width, sill + o.height - 0.04, sill + o.height);
            fr(o.offset, o.offset + 0.04, sill, sill + o.height);
            fr(o.offset + o.width - 0.04, o.offset + o.width, sill, sill + o.height);
          } else if (o.type === "door") {
            structure.add(leafAjar(w, o, e, M.door, half ? Math.min(o.height, disp.cut) : o.height));
          } else if (o.type === "garage") {
            addWallBox(structure, w, { s0: o.offset + 0.02, s1: o.offset + o.width - 0.02, y0: 0, y1: o.height }, e, 0.06, 0, 0, M.garage, { kind: "garage", openingId: o.id }, occluders);
          }
        }
      }
    }
    g.userData.elevation = e;
    floors.set(f.id, { group: g, structure, roomMeshes, floor: f });
    root.add(g);
  }
  // roofs
  const roofs = new THREE.Group();
  roofs.name = "roofs";
  const roofFaceList = [];
  for (const r of profile.roofs || []) {
    const f = profile.floors.find((x) => x.id === r.floor);
    if (!f) continue;
    const grp = new THREE.Group();
    grp.userData = { roofId: r.id, floorId: f.id };
    if (r.type === "flat") {
      const H = f.elevation + f.height;
      const m = slab(r.outline, H + 0.25, 0.25, M.roofFlat);
      if (r.color) { m.material = M.roofFlat.clone(); m.material.color.set(r.color); }
      m.castShadow = true; m.receiveShadow = true; m.userData = { kind: "roof", roofId: r.id };
      grp.add(m); occluders.push(m);
      roofFaceList.push({ roof: r, floor: f, face: { dir: "flat", top: H + 0.25 }, mesh: m });
      if (r.parapet > 0) {
        const T = 0.16, inside = (x, y) => pointInPolygon([x, y], r.outline);
        for (let i = 0; i < r.outline.length; i++) {
          const a = r.outline[i], bb = r.outline[(i + 1) % r.outline.length];
          const L = Math.hypot(bb[0] - a[0], bb[1] - a[1]); if (L < 0.05) continue;
          let nx = -(bb[1] - a[1]) / L, ny = (bb[0] - a[0]) / L;
          const mx = (a[0] + bb[0]) / 2, my = (a[1] + bb[1]) / 2;
          if (!inside(mx + nx * 0.3, my + ny * 0.3)) { nx = -nx; ny = -ny; }
          const w = { a: [a[0] + (nx * T) / 2, a[1] + (ny * T) / 2], b: [bb[0] + (nx * T) / 2, bb[1] + (ny * T) / 2] };
          const pm = boxAlong(w, 0, L, H + 0.25, H + 0.25 + r.parapet, T, 0, 0, m.material);
          pm.castShadow = true; pm.userData = { kind: "roof", roofId: r.id };
          grp.add(pm); occluders.push(pm);
        }
      }
    } else {
      const { faces, gables } = roofFaces(r, f);
      faces.forEach((fc) => {
        const m = polyMesh(fc.pts, M.roof);
        m.castShadow = true; m.receiveShadow = true; m.userData = { kind: "roof", roofId: r.id, face: fc.dir };
        grp.add(m); occluders.push(m);
        roofFaceList.push({ roof: r, floor: f, face: fc, mesh: m });
        // thickness illusion: a second, slightly lower face
        const under = polyMesh(fc.pts.map((p) => p.clone().add(new THREE.Vector3(0, -0.12, 0))), M.roof);
        grp.add(under);
      });
      gables.forEach((tri) => {
        const m = polyMesh(tri, new THREE.MeshStandardMaterial({ color: COLORS.wallExt, roughness: 0.95, side: THREE.DoubleSide }));
        m.castShadow = true; m.userData = { kind: "gable", roofId: r.id };
        grp.add(m); occluders.push(m);
      });
    }
    roofs.add(grp);
  }
  root.add(roofs);
  // PV arrays
  const pv = new THREE.Group(); pv.name = "pv";
  const solar = profile.modules?.solar;
  const arrays = [];
  if (solar?.arrays) {
    for (const a of solar.arrays) {
      const rf = roofFaceList.find((x) => x.roof.id === a.roof && x.face.dir === a.face) || roofFaceList.find((x) => x.roof.id === a.roof);
      if (!rf) { arrays.push({ array: a, placed: 0 }); continue; }
      const count = a.panels || Math.round((a.kwp || 1) / 0.4);
      if (rf.face.dir === "flat") {
        const { group, placed } = panelsFlat(rf, a, count, profile.location?.bearing_deg ?? 90, M.panel);
        pv.add(group); occluders.push(...group.children.filter((c) => c.isMesh));
        arrays.push({ array: a, placed, tilt: a.tilt ?? 15, azimuth: a.azimuth ?? 180, group });
        continue;
      }
      const { group, placed } = panelsOnFace(rf.face, count, M.panel);
      pv.add(group);
      const ori = faceOrientation(rf.face, profile.location?.bearing_deg ?? 90);
      arrays.push({ array: a, placed, tilt: a.tilt ?? ori.tilt, azimuth: a.azimuth ?? ori.az, group });
    }
  }
  root.add(pv);
  const b = allPts.length ? bbox(allPts) : { x0: -5, y0: -5, x1: 5, y1: 5, w: 10, h: 10, cx: 0, cy: 0 };
  const top = Math.max(...profile.floors.map((f) => f.elevation + f.height)) + 3;
  return { root, floors, roofs, pv, arrays, occluders, roofFaces: roofFaceList, bounds: { ...b, top }, display: disp };
}

function leafAjar(w, o, e, mat, height = o.height) {
  const f = wallFrame(w);
  const hingeX = w.a[0] + f.ux * o.offset, hingeZ = w.a[1] + f.uy * o.offset;
  const g = new THREE.Group();
  g.position.set(hingeX, e, hingeZ);
  g.rotation.y = -f.angle - 0.9; // 0.9 rad ajar
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(o.width - 0.04, height - 0.02, 0.045), mat);
  leaf.position.set((o.width - 0.04) / 2 + 0.02, (height - 0.02) / 2, 0);
  leaf.castShadow = true;
  leaf.userData = { kind: "door", openingId: o.id };
  g.add(leaf);
  return g;
}

/** Ground: aerial texture if present, else a soft grass plane. */
export function buildGround(profile, bounds, textureUrl) {
  const g = new THREE.Group();
  const size = Math.max(bounds.w, bounds.h) + 60;
  const mat = new THREE.MeshStandardMaterial({ color: 0x3d5233, roughness: 1 });
  const holes = groundHoles(profile);
  const plane = new THREE.Mesh(holes.length ? planeWithHoles(size, size, [bounds.cx, bounds.cy], 0, holes) : new THREE.PlaneGeometry(size, size), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(bounds.cx, -0.02, bounds.cy);
  plane.receiveShadow = true;
  plane.userData.kind = "ground";
  g.add(plane);
  const a = profile.site?.aerial;
  if (a?.source === "esri" && profile.location?.lat != null) {
    esriTexture(profile.location.lat, profile.location.lon).then(({ canvas, mpp }) => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const w = canvas.width * mpp, h = canvas.height * mpp;
      const c = a.center || [bounds.cx, bounds.cy];
      const m = new THREE.Mesh(holes.length ? planeWithHoles(w, h, c, a.rotation_deg, holes) : new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -((a.rotation_deg || 0) * Math.PI) / 180;
      m.position.set(c[0], -0.01, c[1]);
      m.receiveShadow = true; m.userData.kind = "ground";
      g.add(m);
    }).catch(() => {});
  } else if (a && textureUrl) {
    const loader = new THREE.TextureLoader();
    loader.load(textureUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const w = tex.image.width * a.m_per_px, h = tex.image.height * a.m_per_px;
      const c = a.center || [a.origin[0] + w / 2, a.origin[1] + h / 2];
      const m = new THREE.Mesh(holes.length ? planeWithHoles(w, h, c, a.rotation_deg, holes) : new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -((a.rotation_deg || 0) * Math.PI) / 180;
      m.position.set(c[0], -0.01, c[1]);
      m.receiveShadow = true;
      m.userData.kind = "ground";
      g.add(m);
    });
  }
  const t = profile.site?.terrain;
  if (t?.type === "slope" && t.grade_pct) {
    const ang = Math.atan(t.grade_pct / 100);
    const dir = ((t.direction_deg - (profile.location?.bearing_deg ?? 90)) * Math.PI) / 180;
    g.rotation.set(0, 0, 0);
    const axis = new THREE.Vector3(-Math.sin(dir), 0, Math.cos(dir));
    g.position.set(bounds.cx, 0, bounds.cy);
    g.children.forEach((c) => c.position.sub(new THREE.Vector3(bounds.cx, 0, bounds.cy)));
    g.setRotationFromAxisAngle(axis, -ang);
  }
  return g;
}

/** Esri World Imagery around a point, composed in memory (displayed only, never stored). */
export async function esriTexture(lat, lon, z = 19, span = 3) {
  const n = 2 ** z, T = 256;
  const fx = ((lon + 180) / 360) * n;
  const sl = Math.sin((lat * Math.PI) / 180);
  const fy = (0.5 - Math.log((1 + sl) / (1 - sl)) / (4 * Math.PI)) * n;
  const cx = Math.floor(fx), cy = Math.floor(fy), half = Math.floor(span / 2);
  const big = document.createElement("canvas");
  big.width = big.height = span * T;
  const g = big.getContext("2d");
  await Promise.all(Array.from({ length: span * span }, (_, i) => new Promise((res) => {
    const dx = (i % span) - half, dy = Math.floor(i / span) - half;
    const img = new Image();
    img.crossOrigin = "anonymous"; img.referrerPolicy = "origin";
    img.onload = () => { g.drawImage(img, (dx + half) * T, (dy + half) * T); res(); };
    img.onerror = res;
    img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${cy + dy}/${cx + dx}`;
  })));
  // crop so the point sits exactly in the centre
  const px = (fx - cx + half) * T, py = (fy - cy + half) * T, r = Math.min(px, py, big.width - px, big.height - py);
  const out = document.createElement("canvas");
  out.width = out.height = Math.floor(r * 2);
  out.getContext("2d").drawImage(big, px - r, py - r, r * 2, r * 2, 0, 0, r * 2, r * 2);
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / n;
  return { canvas: out, mpp };
}
