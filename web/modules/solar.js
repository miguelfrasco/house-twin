// Solar: panels drawn on the roof and a clear-sky production estimate; optional Open-Meteo cloud forecast.
import { dailyPV, sunPosition, poaIrradiance } from "../engine/sun.js";
import { getLang, fmtNum } from "../i18n.js";
import { weatherEnabled, setWeather, cloudCover, cloudFactor } from "../engine/weather.js";

function yearly(arr, L, tz, year) {
  let kwh = 0;
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const d = `${year}-${String(m).padStart(2, "0")}-15`;
    const e = dailyPV(arr, d, L.lat, L.lon, tz, 20).kwh * days;
    months.push(e); kwh += e;
  }
  return { kwh, months };
}

export default {
  id: "solar",
  icon: "🔆",
  activate(ctx) { ctx.viewer.pvVisible = true; ctx.viewer.applyFocus(); },
  deactivate() {},
  onSun(ctx) { const el = document.querySelector("#pvNow"); if (el) el.textContent = this.nowKw(ctx); },
  nowKw(ctx) {
    const L = ctx.profile.location;
    let kw = 0;
    for (const a of ctx.viewer.house.arrays) { const s = sunPosition(ctx.timeMs(), L.lat, L.lon); kw += (poaIrradiance(s, a.tilt, a.azimuth) / 1000) * (a.array.kwp || 0) * (1 - (a.array.loss_pct ?? 14) / 100); }
    return `${fmtNum(kw, 2)} kW`;
  },
  panel(ctx, el) {
    const { t, esc } = ctx;
    const pt = getLang() === "pt-PT";
    if (!ctx.hasLocation) { el.innerHTML = `<div class="note warn">${esc(t("no_location"))}</div>`; return; }
    const L = ctx.profile.location;
    const arrays = ctx.viewer.house.arrays;
    let day = 0; const hourly = new Array(24).fill(0); let year = 0; const months = new Array(12).fill(0);
    for (const a of arrays) {
      const p = { kwp: a.array.kwp, tilt: a.tilt, azimuth: a.azimuth, loss_pct: a.array.loss_pct };
      const d = dailyPV(p, ctx.state.date, L.lat, L.lon, ctx.tz);
      day += d.kwh; d.hourly.forEach((v, i) => (hourly[i] += v));
      const y = yearly(p, L, ctx.tz, +ctx.state.date.slice(0, 4));
      year += y.kwh; y.months.forEach((v, i) => (months[i] += v));
    }
    const mx = Math.max(...hourly, 0.001), mm = Math.max(...months, 0.001);
    const dirName = (az) => { const n = pt ? ["N", "NE", "E", "SE", "S", "SO", "O", "NO"] : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]; return n[Math.round(az / 45) % 8]; };
    el.innerHTML = `<div class="kicker">${esc(t("solar_today"))}</div>
      <div class="stat big sun"><span>${fmtNum(day, 1)}</span><label>kWh · ${pt ? "agora" : "now"} <b id="pvNow">${this.nowKw(ctx)}</b></label></div>
      <div class="chart">${hourly.map((v) => `<i style="height:${(v / mx) * 100}%"></i>`).join("")}</div><div class="chart-x"><span>0 h</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      <div class="kicker">${esc(t("solar_year"))}</div>
      <div class="stat big"><span>${fmtNum(year / 1000, 1)}</span><label>MWh</label></div>
      <div class="chart">${months.map((v) => `<i style="height:${(v / mm) * 100}%"></i>`).join("")}</div><div class="chart-x"><span>${pt ? "jan" : "Jan"}</span><span>${pt ? "jul" : "Jul"}</span><span>${pt ? "dez" : "Dec"}</span></div>
      <div class="list" style="margin-top:12px">${arrays.map((a) => `<div class="card"><div class="ic">🔆</div><div class="bd"><b>${esc(a.array.label || a.array.id)}</b><small>${fmtNum(a.array.kwp, 1)} ${esc(t("kwp"))} · ${a.placed} ${esc(t("panels"))} · ${esc(t("tilt"))} ${fmtNum(a.tilt, 0)}° · ${esc(t("facing"))} ${dirName(a.azimuth)} (${fmtNum(a.azimuth, 0)}°)</small></div></div>`).join("")}</div>
      <div id="pvWx"></div>`;
    this.weather(ctx, el.querySelector("#pvWx"), hourly, day, pt);
  },
  async weather(ctx, box, hourly, day, pt) {
    const on = weatherEnabled();
    const toggle = `<button class="chip small" id="wxT">${on ? (pt ? "Desligar previsão" : "Turn forecast off") : (pt ? "Usar previsão do tempo" : "Use weather forecast")}</button>`;
    const base = pt ? "Estimativa com céu limpo e perdas fixas." : "Clear-sky estimate with fixed losses.";
    const priv = pt ? "A previsão vem da Open-Meteo e só recebe coordenadas arredondadas (~1 km)." : "The forecast comes from Open-Meteo and only gets rounded coordinates (~1 km).";
    const bind = () => (box.querySelector("#wxT").onclick = () => { setWeather(!on); ctx.refreshPanel(); });
    if (!on) { box.innerHTML = `<div class="note">${base} ${priv}</div><div class="row">${toggle}</div>`; return bind(); }
    box.innerHTML = `<div class="note">${pt ? "A carregar a previsão…" : "Loading the forecast…"}</div>`;
    const wx = await cloudCover(ctx.profile.location, ctx.state.date, ctx.tz);
    if (!box.isConnected) return;
    if (!wx || !wx.cloud.length) { box.innerHTML = `<div class="note">${base} ${pt ? "Sem previsão para este dia." : "No forecast for this day."}</div><div class="row">${toggle}</div>`; return bind(); }
    const adj = hourly.reduce((s, v, i) => s + v * cloudFactor(wx.cloud[i] ?? 0), 0);
    const avg = wx.cloud.reduce((a, b) => a + b, 0) / wx.cloud.length;
    box.innerHTML = `<div class="card" style="margin-top:12px"><div class="ic">${avg > 0.7 ? "☁" : avg > 0.3 ? "⛅" : "☀"}</div><div class="bd"><b>${fmtNum(adj, 1)} kWh ${pt ? "com a previsão" : "with the forecast"}</b><small>${pt ? "Nebulosidade média" : "Average cloud cover"} ${fmtNum(avg * 100, 0)}% · ${fmtNum(wx.tmin, 0)}–${fmtNum(wx.tmax, 0)} °C${wx.rain ? ` · ${fmtNum(wx.rain, 1)} mm` : ""} · ${fmtNum(day ? (adj / day) * 100 : 0, 0)}% ${pt ? "do céu limpo" : "of clear sky"}</small></div></div>
      <div class="note">${priv}</div><div class="row">${toggle}</div>`;
    bind();
  },
};
