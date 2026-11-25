// Turns an AI (or any pixel-space) floor-plan draft into profile geometry in metres.
import { uid } from "../profile/profile.js";

const TYPES = ["living", "kitchen", "bedroom", "bathroom", "hall", "office", "garage", "stairs", "outdoor", "other"];

export function draftToFloor(draft, { origin = [0, 0], m_per_px }) {
  const toM = ([x, y]) => [Math.round((origin[0] + x * m_per_px) * 100) / 100, Math.round((origin[1] + y * m_per_px) * 100) / 100];
  // merge nearby endpoints so walls connect
  const nodes = [];
  const node = (p) => { for (const n of nodes) if (Math.hypot(n[0] - p[0], n[1] - p[1]) < 0.15) return n; nodes.push(p); return p; };
  const walls = [];
  for (const w of draft.walls || []) {
    const a = node(toM(w.a)), b = node(toM(w.b));
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.2) continue;
    walls.push({ id: uid("w"), a: [...a], b: [...b], thickness: w.exterior ? 0.3 : 0.12 });
  }
  const rooms = (draft.rooms || []).map((r) => ({ id: uid("r"), name: r.name || "Room", type: TYPES.includes(r.type) ? r.type : "other", polygon: r.polygon.map(toM) }));
  const openings = [];
  for (const o of draft.openings || []) {
    const a = toM(o.a), b = toM(o.b), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let best = null;
    for (const w of walls) {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      const proj = (p) => (p[0] - w.a[0]) * ux + (p[1] - w.a[1]) * uy;
      const t = proj(mid), d = Math.abs((mid[0] - w.a[0]) * uy - (mid[1] - w.a[1]) * ux);
      if (t < 0 || t > L || d > 0.5) continue;
      if (!best || d < best.d) best = { w, d, s0: Math.min(proj(a), proj(b)), s1: Math.max(proj(a), proj(b)), L };
    }
    if (!best) continue;
    const width = Math.max(0.5, Math.min(best.s1 - best.s0, best.L - 0.05));
    const offset = Math.max(0, Math.min(best.L - width, best.s0));
    const type = o.type === "window" ? "window" : o.type === "garage" ? "garage" : "door";
    openings.push({ id: uid("o"), wall: best.w.id, type, offset: Math.round(offset * 100) / 100, width: Math.round(width * 100) / 100, height: type === "window" ? 1.2 : type === "garage" ? 2.3 : 2.1, sill: type === "window" ? 0.9 : 0 });
  }
  return { walls, rooms, openings };
}

/** A simple rectangular starter house (manual fallback without any plan). */
export function rectangleFloor(width = 10, depth = 8) {
  const c = [[0, 0], [width, 0], [width, depth], [0, depth]];
  const walls = c.map((p, i) => ({ id: uid("w"), a: [...p], b: [...c[(i + 1) % 4]], thickness: 0.3 }));
  return {
    outline: c.map((p) => [...p]),
    walls,
    rooms: [{ id: uid("r"), name: "Room", type: "living", polygon: c.map((p) => [...p]) }],
    openings: [
      { id: uid("o"), wall: walls[2].id, type: "door", offset: width / 2 - 0.45, width: 0.9, height: 2.1, sill: 0 },
      { id: uid("o"), wall: walls[0].id, type: "window", offset: 1, width: 1.4, height: 1.2, sill: 0.9 },
      { id: uid("o"), wall: walls[2].id, type: "window", offset: 1, width: 1.4, height: 1.2, sill: 0.9 },
    ],
  };
}

/**
 * Split a right-angled outline (e.g. an L-shaped house) into a few rectangles, one roof each.
 * Non-orthogonal outlines fall back to their bounding box.
 */
export function rectsOf(outline, minArea = 4) {
  if (!outline || outline.length < 3) return [];
  const bb = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const ortho = outline.every((p, i) => { const q = outline[(i + 1) % outline.length]; return Math.abs(p[0] - q[0]) < 0.05 || Math.abs(p[1] - q[1]) < 0.05; });
  if (!ortho) { const [x0, y0, x1, y1] = bb(outline); return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]; }
  const uniq = (a) => [...new Set(a.map((v) => Math.round(v * 100) / 100))].sort((m, n) => m - n);
  const xs = uniq(outline.map((p) => p[0])), ys = uniq(outline.map((p) => p[1]));
  const inside = (x, y) => { let c = false; for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const [xi, yi] = outline[i], [xj, yj] = outline[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const nx = xs.length - 1, ny = ys.length - 1;
  const cell = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => inside((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)));
  const used = cell.map((r) => r.map(() => false));
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!cell[j][i] || used[j][i]) continue;
    let i2 = i; while (i2 + 1 < nx && cell[j][i2 + 1] && !used[j][i2 + 1]) i2++;
    let j2 = j; const rowOk = (jj) => { for (let k = i; k <= i2; k++) if (!cell[jj][k] || used[jj][k]) return false; return true; };
    while (j2 + 1 < ny && rowOk(j2 + 1)) j2++;
    for (let jj = j; jj <= j2; jj++) for (let k = i; k <= i2; k++) used[jj][k] = true;
    const r = [[xs[i], ys[j]], [xs[i2 + 1], ys[j]], [xs[i2 + 1], ys[j2 + 1]], [xs[i], ys[j2 + 1]]];
    if ((r[1][0] - r[0][0]) * (r[2][1] - r[1][1]) >= minArea) out.push(r);
  }
  return out;
}
