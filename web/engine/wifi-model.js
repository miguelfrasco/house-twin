// Wi-Fi propagation model (no DOM): log-distance path loss + walls + floors, calibration from measured
// points and survey file parsing. Used by the Wi-Fi module and the tests.
export const DEF = { pl0_db: 40, n: 2.8, wall_db: 4, ext_wall_db: 9, floor_db: 15 };

export function segCross(p, q, a, b) {
  const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]);
  if (Math.abs(d) < 1e-12) return false;
  const u = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d;
  const v = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d;
  return u > 0 && u < 1 && v > 0 && v < 1;
}

/** Path terms between an AP and a point: distance, interior/exterior walls crossed, floors between. */
export function pathTerms(profile, ap, floorId, pos) {
  const fa = profile.floors.find((f) => f.id === ap.floor), fb = profile.floors.find((f) => f.id === floorId);
  const dz = (fb?.elevation ?? 0) - (fa?.elevation ?? 0) + ((ap.height ?? 1.8) - 1.0);
  const d = Math.max(0.5, Math.hypot(pos[0] - ap.pos[0], pos[1] - ap.pos[1], dz));
  let wi = 0, we = 0;
  for (const w of fb?.walls || []) if (segCross(ap.pos, pos, w.a, w.b)) { if (w.exterior ?? (w.thickness ?? 0.2) >= 0.2) we++; else wi++; }
  const lo = Math.min(fa?.elevation ?? 0, fb?.elevation ?? 0), hi = Math.max(fa?.elevation ?? 0, fb?.elevation ?? 0);
  const fl = profile.floors.filter((f) => f.elevation > lo + 0.01 && f.elevation <= hi + 0.01).length;
  return { d, wi, we, fl };
}

export function predict(profile, ap, floorId, pos, model = DEF) {
  const { d, wi, we, fl } = pathTerms(profile, ap, floorId, pos);
  const loss = model.pl0_db + 10 * model.n * Math.log10(d) + wi * model.wall_db + we * model.ext_wall_db + fl * model.floor_db;
  return (ap.tx_dbm ?? 20) - loss;
}

/** Least squares for small systems (Gaussian elimination). */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Fit the model to measured points. Always fits a constant offset; with enough points also the path-loss
 * exponent n and, when walls vary between points, the interior wall loss. A point may name its AP (s.ap);
 * otherwise the strongest predicted AP is assumed.
 */
const PRIOR = 0.7;
export function calibrate(profile, wifi) {
  let model = { ...DEF, ...(wifi.model || {}) };
  const base = model;
  const pts = (wifi.survey || []).filter((s) => Number.isFinite(s.rssi) && s.pos);
  const aps = wifi.aps || [];
  if (!pts.length || !aps.length) return { model, offset: 0, n: 0, rmse: null, fitted: [] };
  let offset = 0, fitted = ["offset"];
  for (let it = 0; it < 3; it++) {
    const rows = pts.map((s) => {
      const ap = aps.find((a) => a.id === s.ap) || aps.reduce((best, a) => (predict(profile, a, s.floor, s.pos, model) > predict(profile, best, s.floor, s.pos, model) ? a : best));
      const t = pathTerms(profile, ap, s.floor, s.pos);
      // y = offset - 10 n log10 d - wall_db * wi   (everything else is known)
      const y = s.rssi - (ap.tx_dbm ?? 20) + model.pl0_db + t.we * model.ext_wall_db + t.fl * model.floor_db;
      return { y, x: [1, -10 * Math.log10(t.d), -t.wi] };
    });
    const wallsVary = new Set(rows.map((r) => r.x[2])).size > 1;
    const k = pts.length >= 8 && wallsVary ? 3 : pts.length >= 5 ? 2 : 1;
    // weak priors (about half a point each) keep n and wall_db near the starting model when a few points
    // can't separate them from the offset; a big survey overrides them
    const prior = [];
    if (k >= 2) prior.push({ y: 10 * PRIOR * base.n, x: [0, 10 * PRIOR, 0] });
    if (k >= 3) prior.push({ y: 3 * PRIOR * base.wall_db, x: [0, 0, 3 * PRIOR] });
    const all = rows.concat(prior);
    const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => all.reduce((a, r) => a + r.x[i] * r.x[j], 0)));
    const b = Array.from({ length: k }, (_, i) => all.reduce((a, r) => a + r.x[i] * r.y, 0));
    const sol = solve(A, b);
    if (!sol) break;
    if (k >= 2) model = { ...model, n: Math.min(5, Math.max(1.6, sol[1])) };
    if (k >= 3) model = { ...model, wall_db: Math.min(15, Math.max(0, sol[2])) };
    // re-fit the offset with the clamped parameters
    offset = rows.reduce((a, r) => a + r.y - r.x[1] * model.n - r.x[2] * model.wall_db, 0) / rows.length;
    fitted = ["offset", ...(k >= 2 ? ["n"] : []), ...(k >= 3 ? ["wall_db"] : [])];
  }
  const resid = pts.map((s) => s.rssi - (Math.max(...aps.map((a) => (s.ap && a.id !== s.ap ? -Infinity : predict(profile, a, s.floor, s.pos, model)))) + offset));
  const rmse = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / resid.length);
  return { model, offset, n: pts.length, rmse, fitted };
}

/** Parse a survey file: CSV (floor,x,y,rssi[,ap][,label]) or JSON (array or {survey:[...]}). Floors by id or name. */
export function parseSurvey(text, profile) {
  const floorOf = (v) => { const s = String(v ?? "").trim(); const f = profile.floors.find((x) => x.id === s || x.name.toLowerCase() === s.toLowerCase()); return f?.id || null; };
  let rows = [];
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    const j = JSON.parse(t);
    rows = (Array.isArray(j) ? j : j.survey || j.measurements || []).map((r) => ({ floor: r.floor, x: r.x ?? r.pos?.[0], y: r.y ?? r.pos?.[1], rssi: r.rssi ?? r.dbm, ap: r.ap, label: r.label ?? r.name }));
  } else {
    const lines = t.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
    const sep = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
    let head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
    const hasHead = head.includes("rssi") || head.includes("x");
    if (!hasHead) head = ["floor", "x", "y", "rssi", "ap", "label"];
    rows = lines.slice(hasHead ? 1 : 0).map((l) => { const c = l.split(sep).map((v) => v.trim()); const o = {}; head.forEach((h, i) => (o[h] = c[i])); return { floor: o.floor ?? o.piso, x: o.x, y: o.y, rssi: o.rssi ?? o.dbm, ap: o.ap, label: o.label ?? o.name }; });
  }
  const out = [], skipped = [];
  for (const [i, r] of rows.entries()) {
    const floor = floorOf(r.floor ?? profile.floors[0].id), x = parseFloat(String(r.x).replace(",", ".")), y = parseFloat(String(r.y).replace(",", ".")), rssi = parseFloat(String(r.rssi).replace("−", "-").replace(",", "."));
    if (!floor || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(rssi) || rssi > -10 || rssi < -110) { skipped.push(i + 1); continue; }
    out.push({ floor, pos: [Math.round(x * 100) / 100, Math.round(y * 100) / 100], rssi: Math.round(rssi), ...(r.ap ? { ap: String(r.ap).slice(0, 40) } : {}), ...(r.label ? { label: String(r.label).slice(0, 60) } : {}) });
  }
  return { points: out.slice(0, 2000), skipped };
}

