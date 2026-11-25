// House profile: versioned schema, validation, migrations and privacy scrub.
// Isomorphic: imported by the browser and by both server targets. No dependencies.
//
// Coordinates: metres, 2D plan frame. x grows to the right, y grows down the plan.
// In 3D, plan (x, y) maps to (x, z) and height is y.
// location.bearing_deg is the compass bearing (clockwise from true north) of the plan +x axis.

export const SCHEMA_ID = "house-twin/profile";
export const SCHEMA_VERSION = 1;

export const OPENING_TYPES = ["door", "window", "garage", "opening"];
export const ROOF_TYPES = ["gable", "hip", "shed", "flat"];
export const MODULE_IDS = ["plants", "wifi", "homeassistant", "solar", "cameras", "furniture"];
export const SITE_FEATURES = ["sunken", "paving", "ramp", "wall", "gate"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPt = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
const isStr = (v) => typeof v === "string";

export function emptyProfile(name = "My house") {
  return {
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    name,
    locale: "en",
    location: { lat: null, lon: null, timezone: "UTC", bearing_deg: 90 },
    site: { terrain: { type: "flat", grade_pct: 0, direction_deg: 0 }, aerial: null },
    floors: [
      { id: "f0", name: "Ground floor", elevation: 0, height: 2.7, slab: 0.2, outline: [], walls: [], rooms: [], openings: [], plan: null, model: null },
    ],
    roofs: [],
    assets: [],
    modules: {},
    display: { walls: "half", wall_cut: 1.2 },
  };
}

/** Bring any older profile up to SCHEMA_VERSION. Pure: returns a new object. */
export function migrate(input) {
  const p = structuredClone(input || {});
  if (!p.schema) p.schema = SCHEMA_ID;
  if (!p.version) p.version = 1;
  // future: if (p.version === 1) { ...; p.version = 2; }
  p.floors ||= [];
  p.roofs ||= [];
  p.assets ||= [];
  p.modules ||= {};
  p.site ||= { terrain: { type: "flat" }, aerial: null };
  p.site.terrain ||= { type: "flat" };
  for (const f of p.floors) {
    f.walls ||= []; f.rooms ||= []; f.openings ||= []; f.outline ||= [];
    if (!isNum(f.slab)) f.slab = 0.2;
  }
  return p;
}

/** Validate a profile. Returns { ok, errors: [ "path: message" ] }. */
export function validate(profile) {
  const e = [];
  const err = (path, msg) => e.push(`${path}: ${msg}`);
  const p = profile;
  if (!p || typeof p !== "object") return { ok: false, errors: ["profile: not an object"] };
  if (p.schema !== SCHEMA_ID) err("schema", `must be "${SCHEMA_ID}"`);
  if (p.version !== SCHEMA_VERSION) err("version", `must be ${SCHEMA_VERSION} (run migrate first)`);
  if (!isStr(p.name) || !p.name.trim() || p.name.length > 120) err("name", "1–120 characters");
  const L = p.location || {};
  if (L.lat !== null && L.lat !== undefined && !(isNum(L.lat) && L.lat >= -90 && L.lat <= 90)) err("location.lat", "−90..90 or null");
  if (L.lon !== null && L.lon !== undefined && !(isNum(L.lon) && L.lon >= -180 && L.lon <= 180)) err("location.lon", "−180..180 or null");
  if (!isNum(L.bearing_deg) || L.bearing_deg < 0 || L.bearing_deg >= 360) err("location.bearing_deg", "0 ≤ bearing < 360");
  if (L.timezone !== undefined && !isStr(L.timezone)) err("location.timezone", "IANA zone string");
  const t = p.site?.terrain;
  if (t && !["flat", "slope"].includes(t.type)) err("site.terrain.type", "flat | slope");
  if (t?.type === "slope" && !(isNum(t.grade_pct) && t.grade_pct >= 0 && t.grade_pct <= 60)) err("site.terrain.grade_pct", "0..60");
  (p.site?.features || []).forEach((f, i) => {
    const sp = `site.features[${i}]`;
    if (!SITE_FEATURES.includes(f.type)) return err(`${sp}.type`, SITE_FEATURES.join(" | "));
    if (["sunken", "paving"].includes(f.type) && !(Array.isArray(f.polygon) && f.polygon.length >= 3 && f.polygon.every(isPt))) err(`${sp}.polygon`, "≥ 3 points [x,y]");
    if (f.vertex_y !== undefined && !(Array.isArray(f.vertex_y) && f.vertex_y.length === f.polygon?.length && f.vertex_y.every((v) => isNum(v) && v > -50 && v < 50))) err(`${sp}.vertex_y`, "one height per polygon point");
    for (const k of ["cut", "floor"]) if (f[k] !== undefined && typeof f[k] !== "boolean") err(`${sp}.${k}`, "true | false");
    if (f.type === "ramp" && !(Array.isArray(f.path) && f.path.length >= 2 && f.path.every(isPt))) err(`${sp}.path`, "≥ 2 points [x,y]");
    if (["wall", "gate"].includes(f.type) && !(isPt(f.a) && isPt(f.b))) err(sp, "a and b must be [x,y]");
    if (f.entity_id !== undefined && !/^cover\.[\w-]+$/.test(f.entity_id)) err(`${sp}.entity_id`, "a cover.* entity");
  });
  if (!Array.isArray(p.floors) || !p.floors.length) err("floors", "at least one floor");
  const floorIds = new Set();
  (p.floors || []).forEach((f, i) => {
    const fp = `floors[${i}]`;
    if (!isStr(f.id) || !f.id) err(`${fp}.id`, "required");
    if (floorIds.has(f.id)) err(`${fp}.id`, "duplicate");
    floorIds.add(f.id);
    if (!isStr(f.name)) err(`${fp}.name`, "required");
    if (!isNum(f.elevation)) err(`${fp}.elevation`, "number (m)");
    if (!(isNum(f.height) && f.height > 1.5 && f.height < 10)) err(`${fp}.height`, "1.5..10 m");
    if (f.outline && !(Array.isArray(f.outline) && f.outline.every(isPt))) err(`${fp}.outline`, "array of [x,y]");
    const wallIds = new Set();
    (f.walls || []).forEach((w, j) => {
      const wp = `${fp}.walls[${j}]`;
      if (!isStr(w.id)) err(`${wp}.id`, "required");
      if (wallIds.has(w.id)) err(`${wp}.id`, "duplicate");
      wallIds.add(w.id);
      if (!isPt(w.a) || !isPt(w.b)) err(wp, "a and b must be [x,y]");
      else if (Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < 0.05) err(wp, "too short");
      if (w.thickness !== undefined && !(isNum(w.thickness) && w.thickness > 0.02 && w.thickness < 1.5)) err(`${wp}.thickness`, "0.02..1.5 m");
      if (w.height !== undefined && !(isNum(w.height) && w.height > 0.2 && w.height <= 10)) err(`${wp}.height`, "0.2..10 m");
      if (w.exterior !== undefined && typeof w.exterior !== "boolean") err(`${wp}.exterior`, "true | false");
    });
    (f.rooms || []).forEach((r, j) => {
      const rp = `${fp}.rooms[${j}]`;
      if (!isStr(r.id)) err(`${rp}.id`, "required");
      if (!isStr(r.name)) err(`${rp}.name`, "required");
      if (!Array.isArray(r.polygon) || r.polygon.length < 3 || !r.polygon.every(isPt)) err(`${rp}.polygon`, "≥ 3 points [x,y]");
    });
    (f.openings || []).forEach((o, j) => {
      const op = `${fp}.openings[${j}]`;
      if (!OPENING_TYPES.includes(o.type)) err(`${op}.type`, OPENING_TYPES.join(" | "));
      if (!wallIds.has(o.wall)) err(`${op}.wall`, "must reference a wall on this floor");
      if (!(isNum(o.offset) && o.offset >= 0)) err(`${op}.offset`, "≥ 0 m from wall start");
      if (!(isNum(o.width) && o.width > 0.2 && o.width < 12)) err(`${op}.width`, "0.2..12 m");
      if (!(isNum(o.height) && o.height > 0.2 && o.height < 8)) err(`${op}.height`, "0.2..8 m");
      if (o.sill !== undefined && !(isNum(o.sill) && o.sill >= 0)) err(`${op}.sill`, "≥ 0");
      const w = (f.walls || []).find((x) => x.id === o.wall);
      if (w && isPt(w.a) && isPt(w.b) && isNum(o.offset) && isNum(o.width)) {
        const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        if (o.offset + o.width > len + 0.01) err(op, `does not fit on wall ${w.id} (${len.toFixed(2)} m)`);
      }
    });
    if (f.model && !isStr(f.model.asset)) err(`${fp}.model.asset`, "asset id");
    const c = f.model?.crop;
    if (c && !(["x0", "y0", "x1", "y1"].every((k) => isNum(c[k])) && c.x1 > c.x0 && c.y1 > c.y0 && (c.min_h === undefined || isNum(c.min_h)))) err(`${fp}.model.crop`, "{x0, y0, x1, y1, min_h?} in metres");
  });
  (p.roofs || []).forEach((r, i) => {
    const rp = `roofs[${i}]`;
    if (!ROOF_TYPES.includes(r.type)) err(`${rp}.type`, ROOF_TYPES.join(" | "));
    if (!floorIds.has(r.floor)) err(`${rp}.floor`, "must reference a floor");
    if (!Array.isArray(r.outline) || r.outline.length < 3 || !r.outline.every(isPt)) err(`${rp}.outline`, "≥ 3 points");
    if (r.type !== "flat" && !(isNum(r.pitch_deg) && r.pitch_deg > 0 && r.pitch_deg < 70)) err(`${rp}.pitch_deg`, "0..70");
  });
  const assetIds = new Set();
  (p.assets || []).forEach((a, i) => {
    if (!isStr(a.id)) err(`assets[${i}].id`, "required");
    if (assetIds.has(a.id)) err(`assets[${i}].id`, "duplicate");
    assetIds.add(a.id);
    if (!["plan", "aerial", "photo", "model"].includes(a.kind)) err(`assets[${i}].kind`, "plan | aerial | photo | model");
  });
  if (p.display != null) {
    if (typeof p.display !== "object") err("display", "object");
    else {
      if (p.display.walls != null && !["half", "full"].includes(p.display.walls)) err("display.walls", "half | full");
      if (p.display.wall_cut != null && !(typeof p.display.wall_cut === "number" && p.display.wall_cut >= 0.6 && p.display.wall_cut <= 2.4)) err("display.wall_cut", "metres between 0.6 and 2.4");
    }
  }
  if (p.site?.aerial?.source === "google") err("site.aerial.source", "Google imagery cannot be stored; upload your own image or use esri");
  for (const k of Object.keys(p.modules || {})) if (!MODULE_IDS.includes(k)) err(`modules.${k}`, "unknown module");
  (p.modules?.furniture?.items || []).forEach((it, i) => {
    if (!isStr(it.id) || !isStr(it.type)) err(`modules.furniture.items[${i}]`, "id and type required");
    if (!floorIds.has(it.floor)) err(`modules.furniture.items[${i}].floor`, "must reference a floor");
    if (!isPt(it.pos)) err(`modules.furniture.items[${i}].pos`, "[x,y]");
  });
  return { ok: e.length === 0, errors: e };
}

/** Round coordinates before sending them to third parties (weather, etc). 2 decimals ≈ 1 km. */
export function roundedLocation(loc, decimals = 2) {
  if (!loc || !isNum(loc.lat) || !isNum(loc.lon)) return null;
  const f = 10 ** decimals;
  return { lat: Math.round(loc.lat * f) / f, lon: Math.round(loc.lon * f) / f };
}

/**
 * Public, shareable snapshot. By default it removes: exact location, aerial and plan images,
 * photos, SSIDs, MAC addresses, device and client names, Home Assistant entity ids and URLs,
 * camera entities, and any free-text notes. Geometry (walls, rooms) stays unless opts.geometry === false.
 */
export function scrub(profile, opts = {}) {
  const o = { location: "remove", geometry: true, ...opts };
  const p = migrate(profile);
  if (o.location === "remove") p.location = { lat: null, lon: null, timezone: "UTC", bearing_deg: p.location?.bearing_deg ?? 90 };
  else if (o.location === "fuzz") p.location = { ...p.location, ...roundedLocation(p.location, 1) };
  p.site = { terrain: p.site?.terrain || { type: "flat" }, aerial: null };
  p.assets = [];
  delete p.owner; delete p.notes;
  for (const f of p.floors) {
    f.plan = null; f.model = null;
    if (!o.geometry) { f.walls = []; f.rooms = []; f.openings = []; f.outline = []; }
  }
  const m = p.modules || {};
  if (m.plants) m.plants = { ...m.plants, items: (m.plants.items || []).map((x, i) => ({ id: `plant${i + 1}`, species: x.species || "", floor: x.floor, pos: x.pos, light: x.light, water_every_days: x.water_every_days })) };
  if (m.wifi) m.wifi = { enabled: m.wifi.enabled, model: m.wifi.model, aps: (m.wifi.aps || []).map((a, i) => ({ id: `ap${i + 1}`, label: `AP ${i + 1}`, floor: a.floor, pos: a.pos, band: a.band, tx_dbm: a.tx_dbm })), survey: [] };
  if (m.homeassistant) m.homeassistant = { enabled: m.homeassistant.enabled, entities: (m.homeassistant.entities || []).map((x, i) => ({ id: `e${i + 1}`, kind: x.kind, floor: x.floor, pos: x.pos, label: x.kind || "device" })) };
  if (m.cameras) m.cameras = { enabled: m.cameras.enabled, items: (m.cameras.items || []).map((c, i) => ({ id: `cam${i + 1}`, label: `Camera ${i + 1}`, floor: c.floor, pos: c.pos, yaw_deg: c.yaw_deg, fov_deg: c.fov_deg })) };
  if (m.solar) m.solar = { enabled: m.solar.enabled, arrays: m.solar.arrays || [] };
  p.name = opts.name || "Shared house";
  return p;
}

/** Simple id helper. */
export const uid = (prefix = "id") => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

export function wallLength(w) { return Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); }

/** Compass bearing of plan +x from the angle of a north arrow drawn on the plan (deg, clockwise from plan-up). */
export function bearingFromNorthArrow(arrowDeg) { return (((90 - arrowDeg) % 360) + 360) % 360; }
export function northArrowFromBearing(bearing) { return (((90 - bearing) % 360) + 360) % 360; }
