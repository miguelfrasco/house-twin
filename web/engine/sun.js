// Solar position and clear-sky helpers. Pure functions, no dependencies.
const rad = Math.PI / 180;

/** Sun azimuth (deg clockwise from true north) and elevation (deg) at time ms for lat/lon. */
export function sunPosition(ms, lat, lon) {
  const d = ms / 864e5 - 10957.5; // days since J2000
  const M = (357.5291 + 0.98560028 * d) * rad;
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * rad;
  const L = M + C + 102.9372 * rad + Math.PI;
  const e = 23.4397 * rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const th = (280.16 + 360.9856235 * d) * rad + lon * rad;
  const H = th - ra;
  const phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { az: (((az / rad + 180) % 360) + 360) % 360, el: el / rad };
}

/** UTC ms of local midnight for dateStr (YYYY-MM-DD) in an IANA time zone (DST-aware). */
export function zonedMidnight(dateStr, timeZone = "UTC") {
  const guess = Date.parse(dateStr + "T00:00:00Z");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "2-digit" }).formatToParts(guess);
  const get = (t) => +parts.find((p) => p.type === t).value;
  let offMin = get("hour") * 60 + get("minute");
  if (get("day") !== +dateStr.slice(8, 10)) offMin -= 1440; // zone is behind UTC
  return guess - offMin * 6e4;
}

export function todayIn(timeZone = "UTC", now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

/** Sunrise and sunset (ms) for a local date. Null when the sun never crosses the horizon. */
export function sunTimes(dateStr, lat, lon, timeZone) {
  const t0 = zonedMidnight(dateStr, timeZone);
  let rise = null, set = null, prev = sunPosition(t0, lat, lon).el;
  for (let m = 2; m <= 1440; m += 2) {
    const t = t0 + m * 6e4, el = sunPosition(t, lat, lon).el;
    if (prev < -0.833 && el >= -0.833) rise = t;
    if (prev >= -0.833 && el < -0.833) set = t;
    prev = el;
  }
  return { t0, rise, set };
}

/**
 * Unit vector toward the sun in the scene frame (x = plan +x, y = up, z = plan +y)
 * given the compass bearing of plan +x.
 */
export function sunVector({ az, el }, bearingDeg) {
  const a = (az - bearingDeg) * rad, ce = Math.cos(el * rad);
  return [Math.cos(a) * ce, Math.sin(el * rad), Math.sin(a) * ce];
}

/** Plan direction (unit [x, y]) for a compass bearing. */
export function compassToPlan(az, bearingDeg) { const a = (az - bearingDeg) * rad; return [Math.cos(a), Math.sin(a)]; }

/**
 * Clear-sky irradiance on a tilted plane (W/m²), Haurwitz GHI + simple Erbs split + isotropic sky.
 * tilt and azimuth in degrees (panel azimuth = compass direction it faces).
 */
export function poaIrradiance(sun, tiltDeg, panelAzDeg) {
  if (sun.el <= 0) return 0;
  const zen = (90 - sun.el) * rad;
  const ghi = 1098 * Math.cos(zen) * Math.exp(-0.057 / Math.cos(zen));
  const kt = Math.min(0.8, ghi / (1361 * Math.cos(zen)));
  const dhiFrac = kt <= 0.22 ? 1 - 0.09 * kt : kt <= 0.8 ? 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4 : 0.165;
  const dhi = ghi * dhiFrac, dni = (ghi - dhi) / Math.cos(zen);
  const t = tiltDeg * rad;
  const cosInc = Math.cos(zen) * Math.cos(t) + Math.sin(zen) * Math.sin(t) * Math.cos((sun.az - panelAzDeg) * rad);
  const beam = Math.max(0, cosInc) * dni;
  const diffuse = dhi * (1 + Math.cos(t)) / 2;
  const ground = ghi * 0.2 * (1 - Math.cos(t)) / 2;
  return Math.max(0, beam + diffuse + ground);
}

/** Estimated clear-sky energy (kWh) for one local day. */
export function dailyPV({ kwp, tilt, azimuth, loss_pct = 14 }, dateStr, lat, lon, timeZone, stepMin = 10) {
  const t0 = zonedMidnight(dateStr, timeZone);
  let wh = 0;
  const hourly = new Array(24).fill(0);
  for (let m = 0; m < 1440; m += stepMin) {
    const sun = sunPosition(t0 + m * 6e4, lat, lon);
    const w = (poaIrradiance(sun, tilt, azimuth) / 1000) * kwp * 1000 * (1 - loss_pct / 100);
    const e = (w * stepMin) / 60;
    wh += e; hourly[Math.floor(m / 60)] += e / 1000;
  }
  return { kwh: wh / 1000, hourly };
}
