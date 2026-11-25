// Talks to the server. In demo mode every write stays in this browser (localStorage).
const LS_PROFILE = "ht_draft_profile";
const json = async (r) => { if (!r.ok) { const e = new Error((await r.text().catch(() => "")) || r.statusText); e.status = r.status; throw e; } return r.json(); };

export const api = {
  config: null,
  async init() {
    try { this.config = await json(await fetch("/api/config", { credentials: "same-origin" })); }
    catch { this.config = { mode: "demo", target: "static", secrets: {}, authed: false }; }
    return this.config;
  },
  get demo() { return this.config?.mode === "demo"; },
  get owner() { return !!this.config?.authed; },
  get canWrite() { return this.demo || this.owner; },
  hasDraft() { return !!localStorage.getItem(LS_PROFILE); },
  dropDraft() { localStorage.removeItem(LS_PROFILE); },
  async loadProfile({ preferDraft = true } = {}) {
    if (this.demo && preferDraft && this.hasDraft()) {
      try { return { profile: JSON.parse(localStorage.getItem(LS_PROFILE)), draft: true }; } catch { /* fallthrough */ }
    }
    const r = await fetch("/api/profile", { credentials: "same-origin" });
    if (r.status === 404 && !this.demo) return { profile: null, needsSetup: true };
    if (r.status === 401) return { profile: null, needsLogin: true };
    if (this.demo && !r.ok) return { profile: await json(await fetch("/demo/profile.json")), draft: false };
    return { profile: await json(r), draft: false };
  },
  async saveProfile(p) {
    if (this.demo) { localStorage.setItem(LS_PROFILE, JSON.stringify(p)); return { ok: true, local: true }; }
    return json(await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p), credentials: "same-origin" }));
  },
  assetUrl(a) { return a.path && (a.path.startsWith("/") || a.path.startsWith("data:") || a.path.startsWith("blob:")) ? a.path : `/api/assets/${encodeURIComponent(a.id)}`; },
  /** Store an image. Demo: returns a data URL path. Owner: uploads to the server. */
  async putAsset(id, dataUrl, mime) {
    if (this.demo) return { id, path: dataUrl, mime };
    const blob = await (await fetch(dataUrl)).blob();
    await json(await fetch(`/api/assets/${encodeURIComponent(id)}`, { method: "PUT", body: blob, headers: { "content-type": mime || blob.type }, credentials: "same-origin" }));
    return { id, mime: mime || blob.type };
  },
  async getState(mod) {
    if (this.demo) { try { return JSON.parse(localStorage.getItem(`ht_state_${mod}`) || "{}"); } catch { return {}; } }
    const r = await fetch(`/api/state/${mod}`, { credentials: "same-origin" });
    return r.ok ? r.json() : {};
  },
  async setState(mod, v) {
    if (this.demo) { localStorage.setItem(`ht_state_${mod}`, JSON.stringify(v)); return; }
    await json(await fetch(`/api/state/${mod}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v), credentials: "same-origin" }));
  },
  async post(path, body) {
    return json(await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), credentials: "same-origin" }));
  },
  async put(path, body) {
    return json(await fetch(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), credentials: "same-origin" }));
  },
  async del(path) { return json(await fetch(path, { method: "DELETE", credentials: "same-origin" })); },
  async get(path) { return json(await fetch(path, { credentials: "same-origin" })); },
};

/** Re-encode an image file through a canvas: strips EXIF (incl. GPS) and caps the size. */
export async function cleanImage(file, maxSide = 2400, type = "image/jpeg", opts = {}) {
  const { isPdf, renderPdf } = await import("./engine/pdf.js");
  if (isPdf(file)) { // PDF plan: render the page in the browser (pdf.js), then treat it as an image
    const r = await renderPdf(file, { maxSide, pickPage: opts.pickPage });
    return { dataUrl: r.canvas.toDataURL(type, 0.86), width: r.canvas.width, height: r.canvas.height, mime: type, pdf: { page: r.page, pages: r.pages, m_per_px_1to1: r.m_per_px_1to1 } };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL(type, 0.86), width: c.width, height: c.height, mime: type };
  } finally { URL.revokeObjectURL(url); }
}
