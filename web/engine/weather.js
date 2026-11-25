// Optional weather forecast from Open-Meteo (free, no key). Off by default; the owner turns it on.
// Only rounded coordinates (2 decimals, ~1 km) ever leave the browser.
import { roundedLocation } from "../profile/profile.js";

const KEY = "ht_weather";
export const weatherEnabled = () => localStorage.getItem(KEY) === "1";
export const setWeather = (on) => (on ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY));

/** Hourly cloud cover (0..1) for one local date, or null if unavailable / outside the forecast window. */
export async function cloudCover(location, date, tz) {
  const { lat, lon } = roundedLocation(location);
  const ck = `ht_wx:${lat},${lon}:${date}`;
  const cached = sessionStorage.getItem(ck);
  if (cached) return JSON.parse(cached);
  const today = new Date().toISOString().slice(0, 10);
  const diff = (Date.parse(date) - Date.parse(today)) / 864e5;
  if (diff < -60 || diff > 15) return null;
  const q = new URLSearchParams({ latitude: lat, longitude: lon, hourly: "cloud_cover", daily: "temperature_2m_max,temperature_2m_min,precipitation_sum", timezone: tz, start_date: date, end_date: date });
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { referrerPolicy: "no-referrer", credentials: "omit" });
    if (!r.ok) return null;
    const j = await r.json();
    const out = { cloud: (j.hourly?.cloud_cover || []).map((v) => (v ?? 0) / 100), tmax: j.daily?.temperature_2m_max?.[0], tmin: j.daily?.temperature_2m_min?.[0], rain: j.daily?.precipitation_sum?.[0] };
    sessionStorage.setItem(ck, JSON.stringify(out));
    return out;
  } catch { return null; }
}

/** Kasten–Czeplak: global irradiance under cloud cover c (0..1) relative to clear sky. */
export const cloudFactor = (c) => 1 - 0.75 * Math.pow(Math.max(0, Math.min(1, c)), 3.4);
