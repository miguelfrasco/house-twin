// Plant care rules shared by the browser and the server (reminders): watering rhythm adjusted for season,
// sun and pot, and the AI prompts for identification and check-ins. No network calls here.

export const SEASON_F = { winter: 1.4, spring: 1.0, summer: 0.75, autumn: 1.1 };
const POT_L = { S: 1, M: 2.5, L: 6, XL: 12 };
const KIND_THIRST = { succulent: 0.45, palm: 1.0, tree: 1.0, leafy: 1.0, flowering: 1.15, fern: 1.15, trailing: 0.9 };

/** Meteorological season for a date (northern hemisphere unless lat < 0). */
export function season(dateStr, lat = 40) {
  const m = +dateStr.slice(5, 7);
  let s = [12, 1, 2].includes(m) ? "winter" : m <= 5 ? "spring" : m <= 8 ? "summer" : "autumn";
  if (lat < 0) s = { winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" }[s];
  return s;
}

/**
 * Days between waterings for a plant today.
 * @param p      plant item ({ water_every_days, kind?, pot? })
 * @param o      { date: "YYYY-MM-DD", lat, sunHours?: number|null, adjust?: boolean }
 */
export function wateringInterval(p, { date, lat = 40, sunHours = null, adjust = true } = {}) {
  const base = Math.max(1, +p.water_every_days || 7);
  if (!adjust || !date) return { days: base, factors: null };
  const s = season(date, lat);
  const fSeason = SEASON_F[s];
  const fSun = sunHours == null ? 1 : Math.max(0.75, 1 - sunHours * 0.04);
  const days = Math.max(1, Math.round(base * fSeason * fSun * 2) / 2);
  return { days, factors: { season: s, fSeason, fSun: +fSun.toFixed(2), sunHours } };
}

/** Millilitres per watering, from pot size and plant kind. */
export function waterAmount(p, s = "spring") {
  const L = POT_L[p.pot] || 2.5;
  const f = (KIND_THIRST[p.kind] ?? 1) * ({ winter: 0.8, autumn: 0.9, spring: 1, summer: 1.15 }[s] ?? 1);
  return Math.max(50, Math.round((250 * Math.pow(L, 0.6) * f) / 50) * 50);
}

const dayMs = 864e5;
export const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / dayMs);

/** Plants due on `date`, using live waterings ({id: "YYYY-MM-DD"}) over the profile's last_watered. */
export function duePlants(profile, waterings = {}, date, sunById = {}) {
  const items = profile?.modules?.plants?.items || [];
  const lat = profile?.location?.lat ?? 40;
  return items.map((p) => {
    const last = waterings[p.id] || (typeof p.last_watered === "string" ? p.last_watered : null);
    const { days } = wateringInterval(p, { date, lat, sunHours: sunById[p.id] ?? null, adjust: p.adjust !== false });
    const dueIn = last ? days - daysBetween(date, last) : 0;
    return { p, last, days, dueIn };
  }).filter((x) => x.dueIn <= 0);
}

const LANG_NOTE = (lang) => (lang === "pt" ? "Write every free-text field in European Portuguese (Portugal; never Brazilian Portuguese)." : "Write every free-text field in English.");

export function identifyPrompt(lang = "en") {
  return `You are a houseplant expert. Identify the plant in this photo. ${LANG_NOTE(lang)}
Return only JSON: {"common_name": string, "species": string (scientific name), "confidence": number 0-1, "water_every_days": number (typical indoor watering interval in spring at about 21 °C), "light": "low"|"medium"|"high", "kind": "fern"|"palm"|"succulent"|"trailing"|"tree"|"leafy"|"flowering", "care": string (2-3 short sentences)}`;
}

export function checkinPrompt(name, prevDate, lang = "en") {
  return `You are a houseplant expert. Image 1 is the ${name} on ${prevDate}; image 2 is the same plant today. Compare them. ${LANG_NOTE(lang)}
Return only JSON: {"health": "thriving"|"good"|"watch"|"struggling", "changes": string, "advice": string (2-3 short actionable sentences), "interval_hint_days": number|null}`;
}

/** Keep only the fields we use, with sane types. */
export function sanitizeAnalysis(a) {
  if (!a || typeof a !== "object") return null;
  const str = (v, n = 400) => (typeof v === "string" ? v.replace(/[<>]/g, "").slice(0, n) : undefined);
  const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
  const pick = (v, list) => (list.includes(v) ? v : undefined);
  const out = {
    common_name: str(a.common_name, 80), species: str(a.species, 120), confidence: num(a.confidence, 0, 1),
    water_every_days: num(a.water_every_days, 1, 90), light: pick(a.light, ["low", "medium", "high"]),
    kind: pick(a.kind, ["fern", "palm", "succulent", "trailing", "tree", "leafy", "flowering"]), care: str(a.care),
    health: pick(a.health, ["thriving", "good", "watch", "struggling"]), changes: str(a.changes), advice: str(a.advice),
    interval_hint_days: num(a.interval_hint_days, 1, 90),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}
