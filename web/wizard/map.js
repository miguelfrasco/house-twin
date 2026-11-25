// Minimal slippy map (OpenStreetMap tiles, optional Esri World Imagery) with a pin. No dependencies.
// Tiles are displayed live and never stored. Attribution is always shown.
const TILE = 256;
export const LAYERS = {
  osm: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, attr: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>', max: 19 },
  esri: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, attr: "Imagery © Esri, Maxar, Earthstar Geographics", max: 19 },
};
const lon2x = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const lat2y = (lat, z) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; };
const x2lon = (x, z) => (x / (TILE * 2 ** z)) * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z); return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
export const metresPerPixel = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

export function createMap(el, { lat = 39.5, lon = -8, zoom = 6, pin = null, layer = "osm", onPin } = {}) {
  el.classList.add("mapbox");
  el.innerHTML = `<div class="tiles"></div><svg class="pin hidden" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#5ce1ff" stroke="#05080c" stroke-width="1.5"/><circle cx="12" cy="9" r="2.6" fill="#05080c"/></svg>
    <div class="zoom"><button aria-label="Zoom in">＋</button><button aria-label="Zoom out">－</button></div><div class="attr"></div>`;
  const tiles = el.querySelector(".tiles"), pinEl = el.querySelector(".pin");
  const st = { lat, lon, zoom, pin, layer };
  const cache = new Map();
  function render() {
    const L = LAYERS[st.layer];
    el.querySelector(".attr").innerHTML = L.attr;
    const w = el.clientWidth, h = el.clientHeight, z = st.zoom;
    const cx = lon2x(st.lon, z), cy = lat2y(st.lat, z);
    const x0 = cx - w / 2, y0 = cy - h / 2, n = 2 ** z;
    const want = new Set();
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + w) / TILE); tx++) for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + h) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n, key = `${st.layer}/${z}/${wx}/${ty}`;
      want.add(key);
      let img = cache.get(key);
      if (!img) { img = new Image(); img.className = "tile"; img.referrerPolicy = "origin"; img.alt = ""; img.src = L.url(z, wx, ty); cache.set(key, img); }
      img.style.left = `${tx * TILE - x0}px`; img.style.top = `${ty * TILE - y0}px`;
      if (!img.parentNode) tiles.appendChild(img);
    }
    for (const [k, img] of cache) if (!want.has(k)) { img.remove(); if (cache.size > 300) cache.delete(k); }
    if (st.pin) { pinEl.classList.remove("hidden"); pinEl.style.left = `${lon2x(st.pin.lon, z) - x0}px`; pinEl.style.top = `${lat2y(st.pin.lat, z) - y0}px`; } else pinEl.classList.add("hidden");
  }
  let drag = null;
  el.addEventListener("pointerdown", (e) => { if (e.target.closest(".zoom,.attr")) return; el.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, cx: lon2x(st.lon, st.zoom), cy: lat2y(st.lat, st.zoom), moved: false }; });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    st.lon = x2lon(drag.cx - dx, st.zoom); st.lat = y2lat(drag.cy - dy, st.zoom); render();
  });
  el.addEventListener("pointerup", (e) => {
    if (drag && !drag.moved) {
      const r = el.getBoundingClientRect();
      const x = lon2x(st.lon, st.zoom) - r.width / 2 + (e.clientX - r.left), y = lat2y(st.lat, st.zoom) - r.height / 2 + (e.clientY - r.top);
      st.pin = { lat: +y2lat(y, st.zoom).toFixed(6), lon: +x2lon(x, st.zoom).toFixed(6) };
      render(); onPin?.(st.pin);
    }
    drag = null;
  });
  el.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(st.zoom + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  const [zi, zo] = el.querySelectorAll(".zoom button");
  zi.onclick = () => setZoom(st.zoom + 1); zo.onclick = () => setZoom(st.zoom - 1);
  function setZoom(z) { st.zoom = Math.max(2, Math.min(LAYERS[st.layer].max, z)); render(); }
  new ResizeObserver(render).observe(el);
  render();
  return {
    state: st,
    setView(lat2, lon2, z) { st.lat = lat2; st.lon = lon2; if (z) st.zoom = z; render(); },
    setPin(p) { st.pin = p; render(); },
    setLayer(l) { st.layer = l; render(); },
    render,
  };
}

/** Geocode with Nominatim (OpenStreetMap). Light use only; called when the user presses Search. */
export async function geocode(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { referrerPolicy: "origin", headers: { "accept-language": navigator.language || "en" } });
  if (!r.ok) throw new Error(`search failed (${r.status})`);
  return (await r.json()).map((x) => ({ name: x.display_name, lat: +x.lat, lon: +x.lon }));
}
