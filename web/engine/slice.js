// Walls from an imported 3D model: cut every mesh with a horizontal plane, keep the vertical faces it
// crosses, merge the cut lines and pair parallel faces into walls with a thickness. The result feeds the
// Wi-Fi prediction (walls on model floors are not drawn in 3D; the model already shows them).
import * as THREE from "three";

/** Plane cut of a set of meshes at height y -> segments [[x0,z0,x1,z1]...] (vertical faces only). */
export function sliceAt(root, y) {
  const segs = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry, pos = g.attributes.position; if (!pos) return;
    const idx = g.index, cnt = idx ? idx.count : pos.count;
    const bb = (g.boundingBox || (g.computeBoundingBox(), g.boundingBox)).clone().applyMatrix4(o.matrixWorld);
    if (bb.min.y > y || bb.max.y < y) return;
    for (let i = 0; i < cnt; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      const lo = Math.min(a.y, b.y, c.y), hi = Math.max(a.y, b.y, c.y);
      if (lo > y || hi < y || hi - lo < 0.3) continue;
      n.subVectors(b, a).cross(c.clone().sub(a));
      if (n.lengthSq() < 1e-10 || Math.abs(n.normalize().y) > 0.2) continue; // vertical faces only
      const pts = [];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        if ((p.y - y) * (q.y - y) < 0) { const t = (y - p.y) / (q.y - p.y); pts.push([p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t]); }
      }
      if (pts.length === 2 && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) > 0.02) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
    }
  });
  return segs;
}

/** Merge collinear segments into lines: [{ang, off, s0, s1}] (direction angle in [0, pi), offset along the normal). */
export function mergeLines(segs, { angTol = 2, offTol = 0.03, gap = 0.08 } = {}) {
  const groups = new Map();
  for (const [x0, z0, x1, z1] of segs) {
    let ang = Math.atan2(z1 - z0, x1 - x0); if (ang < 0) ang += Math.PI; if (ang >= Math.PI - 1e-9) ang = 0;
    const ak = Math.round((ang * 180) / Math.PI / angTol) % Math.round(180 / angTol);
    const A = (ak * angTol * Math.PI) / 180, ux = Math.cos(A), uz = Math.sin(A);
    const off = -uz * x0 + ux * z0;
    const s0 = ux * x0 + uz * z0, s1 = ux * x1 + uz * z1;
    if (!groups.has(ak)) groups.set(ak, []);
    groups.get(ak).push({ off, s0: Math.min(s0, s1), s1: Math.max(s0, s1) });
  }
  const lines = [];
  for (const [ak, list] of groups) {
    const A = (ak * angTol * Math.PI) / 180;
    list.sort((p, q) => p.off - q.off);
    const bands = [];
    for (const s of list) { const last = bands.at(-1); if (last && s.off - last.offEnd <= offTol) { last.items.push(s); last.offEnd = s.off; } else bands.push({ items: [s], offEnd: s.off }); }
    for (const band of bands) {
      const off = band.items.reduce((t, s) => t + s.off, 0) / band.items.length;
      const iv = band.items.map((s) => [s.s0, s.s1]).sort((p, q) => p[0] - q[0]);
      let cur = null;
      for (const [p, q] of iv) { if (cur && p <= cur[1] + gap) cur[1] = Math.max(cur[1], q); else { if (cur) lines.push({ ang: A, off, s0: cur[0], s1: cur[1] }); cur = [p, q]; } }
      if (cur) lines.push({ ang: A, off, s0: cur[0], s1: cur[1] });
    }
  }
  return lines;
}

/** Pair parallel faces (wall skins) into walls {a, b, thickness} in plan coords. */
export function wallsFromLines(lines, { minT = 0.05, maxT = 0.5, minLen = 0.5 } = {}) {
  const walls = [], used = new Set();
  const byAng = new Map();
  lines.forEach((l, i) => { if (l.s1 - l.s0 >= 0.25) { if (!byAng.has(l.ang)) byAng.set(l.ang, []); byAng.get(l.ang).push(i); } });
  const cand = [];
  for (const [, ids] of byAng) for (const i of ids) for (const j of ids) {
    if (j <= i) continue;
    const p = lines[i], q = lines[j], t = Math.abs(q.off - p.off);
    if (t < minT || t > maxT) continue;
    const s0 = Math.max(p.s0, q.s0), s1 = Math.min(p.s1, q.s1);
    if (s1 - s0 < minLen) continue;
    cand.push({ i, j, t, s0, s1, score: (s1 - s0) / t });
  }
  cand.sort((p, q) => q.score - p.score);
  const taken = new Map(); // line index -> intervals already used
  const free = (k, s0, s1) => !(taken.get(k) || []).some(([p, q]) => Math.min(q, s1) - Math.max(p, s0) > 0.1);
  for (const c of cand) {
    if (!free(c.i, c.s0, c.s1) || !free(c.j, c.s0, c.s1)) continue;
    for (const k of [c.i, c.j]) { if (!taken.has(k)) taken.set(k, []); taken.get(k).push([c.s0, c.s1]); used.add(k); }
    const p = lines[c.i], q = lines[c.j], off = (p.off + q.off) / 2, ux = Math.cos(p.ang), uz = Math.sin(p.ang);
    const P = (s) => [Math.round((ux * s - uz * off) * 100) / 100, Math.round((uz * s + ux * off) * 100) / 100];
    walls.push({ a: P(c.s0), b: P(c.s1), thickness: Math.round(c.t * 100) / 100 });
  }
  return walls;
}

/** Everything in one go for a model object: walls cut at `height` metres above the floor level. */
export function wallsFromModel(root, floorElevation, height = 1.2) {
  return wallsFromLines(mergeLines(sliceAt(root, floorElevation + height)));
}

const inPoly = ([x, y], poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c;
};

/** Mark walls as exterior when one side is outside every indoor room (probes 0.35 m either side of the middle). */
export function classifyWalls(walls, rooms) {
  const indoor = rooms.filter((r) => !r.outdoor && r.type !== "outdoor").map((r) => r.polygon);
  const inside = (p) => indoor.some((poly) => inPoly(p, poly));
  return walls.map((w) => {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1, nx = -(w.b[1] - w.a[1]) / L, ny = (w.b[0] - w.a[0]) / L;
    let outside = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const mx = w.a[0] + (w.b[0] - w.a[0]) * t, my = w.a[1] + (w.b[1] - w.a[1]) * t, d = (w.thickness ?? 0.2) / 2 + 0.35;
      if (!inside([mx + nx * d, my + ny * d]) || !inside([mx - nx * d, my - ny * d])) outside++;
    }
    return { ...w, exterior: outside >= 2 };
  });
}
