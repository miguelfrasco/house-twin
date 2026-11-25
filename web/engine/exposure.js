// Direct-sun exposure: hours of direct sun per grid cell for one day, by ray casting
// against the house occluders (walls, slabs, roofs; glass lets light through).
import * as THREE from "three";
import { sunPosition, sunTimes, sunVector } from "./sun.js";
import { pointInPolygon, bbox } from "./build3d.js";

/**
 * @param {object} p   { profile, floor, occluders, date, cell=0.5, stepMin=30, sampleHeight=0.8, outdoor=false }
 * @returns {Promise<{cells: {x,y,hours}[], cell, max, byRoom: Map}>}
 */
export async function computeExposure({ profile, floor, occluders, date, cell = 0.5, stepMin = 30, sampleHeight = 0.8, extraPolys = [], onProgress, signal }) {
  const { lat, lon, timezone, bearing_deg } = profile.location;
  if (lat == null || lon == null) return { cells: [], cell, max: 0, byRoom: new Map(), noLocation: true };
  const { rise, set } = sunTimes(date, lat, lon, timezone || "UTC");
  const polys = floor.rooms.map((r) => ({ id: r.id, poly: r.polygon }));
  for (const p of extraPolys) polys.push(p);
  const pts = polys.flatMap((p) => p.poly);
  if (!pts.length || !rise || !set) return { cells: [], cell, max: 0, byRoom: new Map() };
  const b = bbox(pts);
  const dirs = [];
  for (let t = rise + (stepMin / 2) * 6e4; t < set; t += stepMin * 6e4) {
    const s = sunPosition(t, lat, lon);
    if (s.el < 1.5) continue;
    const v = sunVector(s, bearing_deg);
    dirs.push(new THREE.Vector3(v[0], v[1], v[2]));
  }
  const ray = new THREE.Raycaster();
  ray.far = 80;
  const cells = [];
  const y = floor.elevation + sampleHeight;
  let n = 0;
  const total = Math.ceil(b.w / cell) * Math.ceil(b.h / cell);
  for (let gx = b.x0 + cell / 2; gx < b.x1; gx += cell) {
    for (let gy = b.y0 + cell / 2; gy < b.y1; gy += cell) {
      n++;
      const owner = polys.find((p) => pointInPolygon([gx, gy], p.poly));
      if (!owner) continue;
      let lit = 0;
      const o = new THREE.Vector3(gx, y, gy);
      for (const d of dirs) {
        ray.set(o, d);
        if (ray.intersectObjects(occluders, false).length === 0) lit++;
      }
      cells.push({ x: gx, y: gy, hours: (lit * stepMin) / 60, room: owner.id });
    }
    if (onProgress) onProgress(n / total);
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    await new Promise((r) => setTimeout(r, 0));
  }
  const byRoom = new Map();
  for (const c of cells) {
    const r = byRoom.get(c.room) || { sum: 0, n: 0, max: 0 };
    r.sum += c.hours; r.n++; r.max = Math.max(r.max, c.hours);
    byRoom.set(c.room, r);
  }
  for (const [, r] of byRoom) r.avg = r.sum / r.n;
  const max = cells.reduce((m, c) => Math.max(m, c.hours), 0);
  return { cells, cell, max, byRoom, dayLength: (set - rise) / 36e5 };
}

/** Sun hours at one point (used for plants). */
export function exposureAt(result, [x, y]) {
  if (!result?.cells?.length) return null;
  let best = null, bd = Infinity;
  for (const c of result.cells) {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return bd <= (result.cell * 1.5) ** 2 ? best.hours : null;
}

/** Colour ramp: dark blue (shade) → amber → bright yellow (full sun). */
export function sunColor(h, max = 10) {
  const t = Math.max(0, Math.min(1, h / Math.max(4, max)));
  const stops = [[0.13, 0.2, 0.42], [0.36, 0.55, 0.9], [1.0, 0.71, 0.28], [1.0, 0.93, 0.45]];
  const s = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), f = s - i;
  return stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f);
}

/** Instanced tile mesh for a cell result. colorFn(cell) -> [r,g,b]. */
export function cellMesh(cells, cellSize, y, colorFn, opacity = 0.78) {
  const geo = new THREE.PlaneGeometry(cellSize * 0.94, cellSize * 0.94);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
  const m = new THREE.Matrix4(), col = new THREE.Color();
  cells.forEach((c, i) => {
    m.makeTranslation(c.x, y, c.y);
    mesh.setMatrixAt(i, m);
    const [r, g, b] = colorFn(c);
    mesh.setColorAt(i, col.setRGB(r, g, b));
  });
  mesh.count = cells.length;
  mesh.renderOrder = 5;
  mesh.userData.kind = "overlay";
  return mesh;
}
