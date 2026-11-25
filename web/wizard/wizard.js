// First-run setup wizard: hosting, owner and keys, location, floor plans (AI draft or manual),
// orientation, aerial image, roof and terrain, modules, review.
import { emptyProfile, migrate, validate, uid, bearingFromNorthArrow, northArrowFromBearing } from "../profile/profile.js";
import { getLang } from "../i18n.js";
import { cleanImage } from "../api.js";
import { createMap, geocode, metresPerPixel } from "./map.js";
import { draftToFloor, rectangleFloor, rectsOf } from "./convert.js";
import { computeOutline } from "../editor/editor.js";
import { PLAN_PROMPT, extractJsonClient, sanitizeDraft } from "./prompt.js";

const L = (pt, en) => (getLang() === "pt-PT" ? pt : en);
const r2 = (v) => Math.round(v * 100) / 100;

export function openWizard(ctx, opts = {}) {
  const { esc, api } = ctx;
  const cfg = api.config || {};
  let w = migrate(ctx.profile && !opts.fresh ? structuredClone(ctx.profile) : emptyProfile(L("A minha casa", "My house")));
  if (cfg.mode === "demo" && !ctx.draft && !opts.keep) { w = emptyProfile(L("A minha casa", "My house")); }
  if (!w.floors[0].walls.length && w.floors[0].name === "Ground floor") w.floors[0].name = L("Rés do chão", "Ground floor");
  w.locale = getLang();
  if (!w.location.timezone || w.location.timezone === "UTC") w.location.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  delete w.demo;
  const temp = { planUrls: {}, target: cfg.target === "node" ? "docker" : "cloudflare", claimed: cfg.mode !== "setup", aerialUrl: null };
  for (const f of w.floors) if (f.plan) { const a = w.assets.find((x) => x.id === f.plan.asset); if (a) temp.planUrls[f.id] = api.assetUrl(a); }

  const STEPS = [
    { id: "host", title: L("Alojamento", "Hosting"), render: stepHost, ok: () => temp.claimed || L("Primeiro confirme o código de configuração e crie a palavra-passe.", "First confirm the setup code and create a password.") },
    { id: "keys", title: L("Chaves", "Keys"), render: stepKeys },
    { id: "where", title: L("Localização", "Location"), render: stepWhere, ok: () => (w.location.lat != null ? true : L("Marque a casa no mapa.", "Drop a pin on the map.")) },
    { id: "plans", title: L("Plantas", "Floor plans"), render: stepPlans, ok: () => (w.floors.some((f) => f.walls.length) ? true : L("Desenhe pelo menos um piso (com IA, à mão ou com o modelo retangular).", "Draw at least one floor (AI, by hand or the rectangle starter).")) },
    { id: "north", title: L("Norte", "North"), render: stepNorth },
    { id: "aerial", title: L("Vista aérea", "Aerial"), render: stepAerial },
    { id: "roof", title: L("Telhado e terreno", "Roof and terrain"), render: stepRoof },
    { id: "mods", title: L("Módulos", "Modules"), render: stepModules },
    { id: "review", title: L("Rever", "Review"), render: stepReview },
  ];
  let i = 0;
  const root = document.createElement("div");
  root.className = "overlay";
  root.innerHTML = `<div class="glass wiz"><div class="wiz-head"><span class="logo">⌂</span><h1>${L("Configurar a casa", "Set up your house")}</h1><div class="steps"></div><button class="chip small" id="wzClose">✕</button></div>
    <div class="wiz-body"></div><div class="wiz-foot"><span class="note" id="wzMsg" style="margin:0;flex:1;display:none"></span><button class="btn" id="wzBack">${L("Anterior", "Back")}</button><button class="btn primary" id="wzNext">${L("Seguinte", "Next")}</button></div></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const body = $(".wiz-body");
  $("#wzClose").onclick = () => { if (opts.firstRun && !ctx.profile) return ctx.toast(L("Termine a configuração para usar a app.", "Finish setup to use the app.")); root.remove(); };
  $("#wzBack").onclick = () => go(i - 1);
  $("#wzNext").onclick = () => {
    const ok = STEPS[i].ok ? STEPS[i].ok() : true;
    if (ok !== true) return msg(ok);
    if (i === STEPS.length - 1) return save();
    go(i + 1);
  };
  const msg = (m) => { const e = $("#wzMsg"); e.textContent = m || ""; e.style.display = m ? "" : "none"; };

  function go(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    msg("");
    $(".steps").innerHTML = STEPS.map((s, k) => `<span class="${k === i ? "on" : k < i ? "ok" : ""}">${k + 1}. ${esc(s.title)}</span>`).join("");
    $("#wzBack").disabled = i === 0;
    $("#wzNext").textContent = i === STEPS.length - 1 ? L("Guardar a casa", "Save house") : L("Seguinte", "Next");
    body.className = "wiz-body";
    body.innerHTML = "";
    STEPS[i].render();
    root.dataset.step = STEPS[i].id;
  }

  // ---------------------------------------------------------------- 1. hosting + owner
  function stepHost() {
    const demo = cfg.mode === "demo";
    body.classList.add("one");
    body.innerHTML = `<div><h2>${L("Onde vai correr a sua casa?", "Where will your house run?")}</h2>
      <p>${L("A app é sua: o perfil da casa, as imagens e as chaves ficam no seu armazenamento. Não há servidor central nem telemetria.", "The app is yours: the house profile, images and keys stay in your own storage. There is no central server and no telemetry.")}</p>
      ${demo ? `<div class="note warn">${L("Está na demonstração pública. Pode fazer o assistente todo: o resultado fica só neste browser. Para a sua casa a sério, faça fork do repositório e publique-o num dos destinos abaixo.", "You're on the public demo. You can go through the whole wizard: the result stays in this browser only. For your real house, fork the repo and deploy it to one of the targets below.")}</div>` : ""}
      <div class="choice">
        <button class="opt ${temp.target === "cloudflare" ? "on" : ""}" data-t="cloudflare"><b>☁ Cloudflare Workers</b><small>${L("Grátis no plano gratuito (Workers + KV). Endereço https próprio, sem servidor em casa.", "Free on the free plan (Workers + KV). Your own https address, no server at home.")}</small></button>
        <button class="opt ${temp.target === "docker" ? "on" : ""}" data-t="docker"><b>🐳 Docker ${L("num Raspberry Pi", "on a Raspberry Pi")}</b><small>${L("Corre na sua rede, ao lado do Home Assistant. Os dados ficam num volume local.", "Runs on your network next to Home Assistant. Data lives in a local volume.")}</small></button>
      </div>
      <div id="hostCmds"></div>
      ${cfg.mode === "setup" ? `<h2 style="margin-top:22px">${L("Dono da casa", "House owner")}</h2>
        <p>${L("Introduza o código de configuração (o segredo SETUP_CODE, ou o código mostrado nos registos do contentor) e escolha uma palavra-passe.", "Enter the setup code (the SETUP_CODE secret, or the code printed in the container logs) and choose a password.")}</p>
        <label class="f">${L("Código de configuração", "Setup code")}</label><input id="claimCode" autocomplete="one-time-code">
        <label class="f">${L("Palavra-passe (mín. 10 caracteres)", "Password (min. 10 characters)")}</label><input id="claimPw" type="password" autocomplete="new-password">
        <label class="f">${L("Repetir palavra-passe", "Repeat password")}</label><input id="claimPw2" type="password" autocomplete="new-password">
        <div class="row"><button class="btn primary" id="claimGo" style="flex:0">${L("Confirmar", "Confirm")}</button><span id="claimMsg" class="note" style="display:none;margin:0"></span></div>` : ""}
    </div>`;
    const cmds = () => {
      body.querySelector("#hostCmds").innerHTML = temp.target === "cloudflare"
        ? `<pre class="cmd">git clone &lt;your fork&gt; house-twin && cd house-twin
npx wrangler@4 login
npx wrangler@4 kv namespace create TWIN      # ${L("cole o id em wrangler.jsonc", "paste the id into wrangler.jsonc")}
npx wrangler@4 secret put SETUP_CODE         # ${L("um texto longo e aleatório", "a long random string")}
npm run cf:deploy</pre>`
        : `<pre class="cmd">git clone &lt;your fork&gt; house-twin && cd house-twin
docker compose up -d --build
docker compose logs house-twin | grep "setup code"   # ${L("código de primeira utilização", "one-time setup code")}</pre>`;
    };
    cmds();
    body.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { temp.target = b.dataset.t; body.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b)); cmds(); }));
    body.querySelector("#claimGo")?.addEventListener("click", async () => {
      const m = body.querySelector("#claimMsg"); m.style.display = "";
      const pw = body.querySelector("#claimPw").value;
      if (pw !== body.querySelector("#claimPw2").value) { m.textContent = L("As palavras-passe não coincidem.", "Passwords don't match."); return; }
      try { await api.post("/api/setup/claim", { code: body.querySelector("#claimCode").value, password: pw }); temp.claimed = true; Object.assign(cfg, await api.init()); cfg.authed = true; api.config = cfg; m.textContent = "✓ " + L("Pronto. É o dono desta casa.", "Done. You own this house."); }
      catch (e) { m.textContent = e.status === 403 ? L("Código errado.", "Wrong code.") : e.status === 400 ? L("A palavra-passe precisa de pelo menos 10 caracteres.", "Password needs at least 10 characters.") : e.message; }
    });
  }

  // ---------------------------------------------------------------- 2. keys
  function stepKeys() {
    body.classList.add("one");
    const demo = cfg.mode === "demo";
    const rows = [
      ["OPENROUTER_API_KEY", L("OpenRouter: rascunho das plantas com IA (opcional)", "OpenRouter: AI floor-plan draft (optional)")],
      ["HA_BASE_URL", L("Endereço do Home Assistant (opcional)", "Home Assistant URL (optional)")],
      ["HA_TOKEN", L("Token de longa duração do Home Assistant (opcional)", "Home Assistant long-lived token (optional)")],
    ];
    const set = cfg.secrets || {};
    body.innerHTML = `<div><h2>${L("As suas chaves", "Your keys")}</h2>
      <p>${L("Todas são opcionais. Ficam como segredos da plataforma (segredos do Worker ou o ficheiro secrets.env no volume de dados), nunca no repositório nem no perfil.", "All optional. They live as platform secrets (Worker secrets, or secrets.env on the data volume), never in the repo or the profile.")}</p>
      ${demo ? "" : rows.map(([n, d]) => `<div class="secret-row"><span><b>${n}</b><br><small style="color:var(--muted)">${esc(d)}</small></span><span class="tag ${set[n] ? "ok" : ""}">${set[n] ? L("definida", "set") : L("em falta", "missing")}</span></div>`).join("")}
      ${!demo && cfg.can_write_secrets ? `<p>${L("Neste servidor pode guardá-las aqui (escritas em /data/secrets.env, só legível pelo dono):", "On this server you can save them here (written to /data/secrets.env, owner-readable only):")}</p>
        ${rows.map(([n]) => `<label class="f">${n}</label><div class="row" style="margin:0"><input type="password" data-sec="${n}" autocomplete="off"><button class="btn small" style="flex:0" data-save="${n}">${L("Guardar", "Save")}</button></div>`).join("")}` : ""}
      ${!demo && !cfg.can_write_secrets ? `<pre class="cmd">npx wrangler@4 secret put OPENROUTER_API_KEY
npx wrangler@4 secret put HA_BASE_URL
npx wrangler@4 secret put HA_TOKEN</pre><p>${L("Depois de as definir, recarregue esta página.", "Reload this page after setting them.")}</p>` : ""}
      ${demo ? `<div class="note">${L("Na demonstração, pode usar a sua própria chave OpenRouter só neste separador: é enviada diretamente do seu browser para a OpenRouter e esquecida quando fechar o separador.", "On the demo you can use your own OpenRouter key in this tab only: it goes straight from your browser to OpenRouter and is forgotten when you close the tab.")}</div>
        <label class="f">OpenRouter API key</label><input type="password" id="demoKey" autocomplete="off" value="${sessionStorage.getItem("ht_or_key") ? "••••••••" : ""}">` : ""}
      <p style="margin-top:14px">${L("Modelo de visão:", "Vision model:")} <b>${esc(cfg.ai_model || "google/gemini-2.5-flash")}</b></p></div>`;
    body.querySelectorAll("[data-save]").forEach((b) => (b.onclick = async () => {
      const n = b.dataset.save, v = body.querySelector(`[data-sec="${n}"]`).value;
      try { await api.post("/api/secrets", { name: n, value: v }); cfg.secrets[n] = !!v; ctx.toast(`${n} ✓`); stepKeysRefresh(); } catch (e) { ctx.toast(e.message); }
    }));
    const dk = body.querySelector("#demoKey");
    if (dk) dk.onchange = () => { if (dk.value && !dk.value.startsWith("••")) sessionStorage.setItem("ht_or_key", dk.value.trim()); if (!dk.value) sessionStorage.removeItem("ht_or_key"); };
  }
  function stepKeysRefresh() { body.innerHTML = ""; stepKeys(); }

  // ---------------------------------------------------------------- 3. location
  function stepWhere() {
    body.innerHTML = `<div class="mapwrap" id="map"></div><div>
      <h2>${L("Onde fica a casa?", "Where is the house?")}</h2>
      <label class="f">${L("Nome da casa", "House name")}</label><input id="hName" maxlength="80" value="${esc(w.name)}">
      <label class="f">${L("Procurar morada ou localidade", "Search address or town")}</label><div class="row" style="margin:0"><input id="q"><button class="btn small" style="flex:0" id="qGo">🔎</button></div>
      <div class="list" id="qRes" style="margin-top:8px"></div>
      <p>${L("Toque no mapa, em cima da casa.", "Tap the map, on top of the house.")}</p>
      <div class="note" id="pinInfo">${w.location.lat != null ? `📍 ${w.location.lat.toFixed(5)}, ${w.location.lon.toFixed(5)}` : L("Sem marcador ainda.", "No pin yet.")}</div>
      <label class="f">${L("Fuso horário", "Time zone")}</label><input id="tz" value="${esc(w.location.timezone)}">
      <div class="note">🔒 ${L("A localização exata fica no seu perfil. O mapa é carregado da OpenStreetMap enquanto escolhe; a meteorologia, se ligada, recebe só coordenadas arredondadas (~1 km).", "The exact location stays in your profile. Map tiles load from OpenStreetMap while you choose; weather, if enabled, only gets rounded coordinates (~1 km).")}</div></div>`;
    const m = createMap(body.querySelector("#map"), { lat: w.location.lat ?? 39.6, lon: w.location.lon ?? -8.0, zoom: w.location.lat != null ? 18 : 6, pin: w.location.lat != null ? { lat: w.location.lat, lon: w.location.lon } : null,
      onPin: (p) => { w.location.lat = p.lat; w.location.lon = p.lon; body.querySelector("#pinInfo").textContent = `📍 ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`; } });
    body.querySelector("#hName").onchange = (e) => (w.name = e.target.value.trim() || w.name);
    body.querySelector("#tz").onchange = (e) => { try { new Intl.DateTimeFormat("en", { timeZone: e.target.value }); w.location.timezone = e.target.value; } catch { ctx.toast(L("Fuso horário inválido", "Invalid time zone")); } };
    const search = async () => {
      const q = body.querySelector("#q").value.trim(); if (!q) return;
      try {
        const res = await geocode(q);
        body.querySelector("#qRes").innerHTML = res.map((r, k) => `<div class="card" data-k="${k}"><div class="bd"><small>${esc(r.name)}</small></div></div>`).join("") || `<div class="note">${L("Sem resultados", "No results")}</div>`;
        body.querySelectorAll("#qRes .card").forEach((c) => (c.onclick = () => { const r = res[+c.dataset.k]; m.setView(r.lat, r.lon, 18); }));
      } catch (e) { ctx.toast(e.message); }
    };
    body.querySelector("#qGo").onclick = search;
    body.querySelector("#q").onkeydown = (e) => e.key === "Enter" && search();
  }

  // ---------------------------------------------------------------- 4. floor plans
  function stepPlans() {
    body.classList.add("one");
    const hasKey = cfg.mode === "demo" ? !!sessionStorage.getItem("ht_or_key") : !!cfg.secrets?.OPENROUTER_API_KEY;
    body.innerHTML = `<div><h2>${L("Plantas dos pisos", "Floor plans")}</h2>
      <p>${L("Carregue uma imagem por piso (PNG ou JPG; exporte as páginas do PDF como imagem). Marque a escala com uma medida conhecida. Depois, a IA faz um rascunho ou desenha à mão no editor.", "Upload one image per floor (PNG or JPG; export PDF pages as images). Mark the scale with a known distance. Then let AI draft it, or draw it by hand in the editor.")}</p>
      ${hasKey ? "" : `<div class="note">${L("Sem chave OpenRouter: o rascunho com IA fica desligado. O desenho à mão funciona sempre.", "No OpenRouter key: AI draft is off. Drawing by hand always works.")}</div>`}
      <div id="floors" class="list" style="margin-top:12px"></div>
      <div class="row"><button class="btn small" style="flex:0" id="addF">＋ ${L("Piso", "Floor")}</button><button class="btn small" style="flex:0" id="rect">▭ ${L("Começar com uma casa retangular", "Start from a rectangle")}</button></div>
      <div id="calib"></div></div>`;
    const list = body.querySelector("#floors");
    const render = () => {
      list.innerHTML = w.floors.map((f) => `<div class="card" style="cursor:default;align-items:flex-start;flex-wrap:wrap">
        <div class="ic">${f.plan ? `<img src="${esc(temp.planUrls[f.id] || "")}" style="width:34px;height:34px;object-fit:cover;border-radius:9px">` : "▦"}</div>
        <div class="bd" style="min-width:220px"><input value="${esc(f.name)}" data-name="${esc(f.id)}" style="max-width:260px">
          <small style="margin-top:6px">${L("Pé-direito", "Height")} <input type="number" step="0.05" min="2" max="6" value="${f.height}" data-h="${esc(f.id)}" style="width:80px;display:inline-block;padding:4px 6px"> m · ${f.walls.length} ${L("paredes", "walls")} · ${f.rooms.length} ${L("divisões", "rooms")}${f.plan ? ` · ${L("escala", "scale")} ${(f.plan.m_per_px * 100).toFixed(2)} cm/px` : ""}</small></div>
        <div class="row" style="margin:6px 0 0;flex:1 1 100%">
          <label class="btn small" style="flex:0;cursor:pointer">⬆ ${L("Planta", "Plan")}<input type="file" accept="image/png,image/jpeg,image/webp" data-up="${esc(f.id)}" hidden></label>
          ${f.plan ? `<button class="btn small" style="flex:0" data-cal="${esc(f.id)}">📏 ${L("Escala", "Scale")}</button>` : ""}
          ${f.plan ? `<button class="btn small primary" style="flex:0" data-ai="${esc(f.id)}" ${hasKey ? "" : "disabled"}>✨ ${L("Rascunho com IA", "AI draft")}</button>` : ""}
          <button class="btn small" style="flex:0" data-ed="${esc(f.id)}">✎ ${L("Desenhar à mão", "Draw by hand")}</button>
          ${w.floors.length > 1 ? `<button class="btn small" style="flex:0" data-del="${esc(f.id)}">🗑</button>` : ""}
        </div></div>`).join("");
      list.querySelectorAll("[data-name]").forEach((x) => (x.onchange = () => { w.floors.find((f) => f.id === x.dataset.name).name = x.value.trim() || "Floor"; }));
      list.querySelectorAll("[data-h]").forEach((x) => (x.onchange = () => { w.floors.find((f) => f.id === x.dataset.h).height = Math.max(2, +x.value || 2.7); restack(); render(); }));
      list.querySelectorAll("[data-up]").forEach((x) => (x.onchange = async () => {
        const file = x.files[0]; if (!file) return;
        const f = w.floors.find((q) => q.id === x.dataset.up);
        const img = await cleanImage(file, cfg.mode === "demo" ? 1600 : 3000, "image/jpeg");
        const id = `plan-${f.id}`;
        const stored = await api.putAsset(id, img.dataUrl, img.mime);
        w.assets = w.assets.filter((a) => a.id !== id);
        w.assets.push({ id, kind: "plan", mime: img.mime, ...(stored.path ? { path: stored.path } : {}) });
        f.plan = { asset: id, origin: [0, 0], m_per_px: f.plan?.m_per_px || 0.02, opacity: 0.6, width_px: img.width, height_px: img.height };
        temp.planUrls[f.id] = img.dataUrl;
        render(); calibrate(f);
      }));
      list.querySelectorAll("[data-cal]").forEach((b) => (b.onclick = () => calibrate(w.floors.find((f) => f.id === b.dataset.cal))));
      list.querySelectorAll("[data-ai]").forEach((b) => (b.onclick = () => aiDraft(w.floors.find((f) => f.id === b.dataset.ai), b)));
      list.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => handEdit(b.dataset.ed)));
      list.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { w.floors = w.floors.filter((f) => f.id !== b.dataset.del); w.roofs = w.roofs.filter((r) => r.floor !== b.dataset.del); restack(); render(); }));
    };
    const restack = () => { let e = w.floors[0].elevation; for (const f of w.floors) { f.elevation = r2(e); e += f.height + (f.slab ?? 0.2); } };
    body.querySelector("#addF").onclick = () => { const top = w.floors.at(-1); w.floors.push({ id: uid("f"), name: L(`Piso ${w.floors.length}`, `Floor ${w.floors.length}`), elevation: r2(top.elevation + top.height + (top.slab ?? 0.2)), height: 2.6, slab: 0.2, outline: [], walls: [], rooms: [], openings: [], plan: null, model: null }); render(); };
    body.querySelector("#rect").onclick = () => {
      const W = parseFloat(String(prompt(L("Largura (m)", "Width (m)"), "10")).replace(",", ".")), D = parseFloat(String(prompt(L("Profundidade (m)", "Depth (m)"), "8")).replace(",", "."));
      if (!(W > 2 && D > 2)) return;
      const f = w.floors[0];
      Object.assign(f, rectangleFloor(W, D));
      f.rooms[0].name = L("Sala", "Living room");
      render();
    };
    const calibrate = (f) => {
      const box = body.querySelector("#calib");
      box.innerHTML = `<h2 style="margin-top:18px">📏 ${L("Escala", "Scale")}: ${esc(f.name)}</h2><p>${L("Clique em dois pontos com distância conhecida (por exemplo, uma cota da planta) e escreva a distância real.", "Click two points with a known distance (for example, a dimension line) and type the real distance.")}</p>
        <div class="stage" style="height:420px"><img id="cImg" src="${esc(temp.planUrls[f.id])}"><svg id="cSvg"></svg></div>
        <div class="row"><input id="cDist" type="number" step="0.01" placeholder="${L("metros", "metres")}" style="max-width:160px"><button class="btn small primary" style="flex:0" id="cOk">${L("Aplicar escala", "Apply scale")}</button><span class="note" id="cInfo" style="margin:0"></span></div>`;
      const img = box.querySelector("#cImg"), svgEl = box.querySelector("#cSvg"), stage = box.querySelector(".stage");
      let k = 1, pts = [];
      img.onload = () => { k = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight); img.style.width = `${img.naturalWidth * k}px`; };
      if (img.complete) img.onload();
      stage.onclick = (e) => {
        const r = stage.getBoundingClientRect();
        pts.push([(e.clientX - r.left) / k, (e.clientY - r.top) / k]);
        if (pts.length > 2) pts = pts.slice(-1);
        svgEl.innerHTML = pts.map((p) => `<circle cx="${p[0] * k}" cy="${p[1] * k}" r="5" fill="#ffd36b"/>`).join("") + (pts.length === 2 ? `<line x1="${pts[0][0] * k}" y1="${pts[0][1] * k}" x2="${pts[1][0] * k}" y2="${pts[1][1] * k}" stroke="#ffd36b" stroke-width="2"/>` : "");
        box.querySelector("#cInfo").textContent = pts.length === 2 ? `${Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]).toFixed(0)} px` : "";
      };
      box.querySelector("#cOk").onclick = () => {
        const d = parseFloat(String(box.querySelector("#cDist").value).replace(",", "."));
        if (pts.length !== 2 || !(d > 0)) return ctx.toast(L("Marque dois pontos e a distância", "Mark two points and the distance"));
        f.plan.m_per_px = d / Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
        box.innerHTML = ""; render();
        ctx.toast(L("Escala aplicada", "Scale applied"));
      };
      box.scrollIntoView({ behavior: "smooth" });
    };
    const aiDraft = async (f, btn) => {
      btn.disabled = true; btn.textContent = L("A desenhar…", "Drafting…");
      try {
        const image = await toDataUrl(temp.planUrls[f.id]);
        let draft;
        if (cfg.mode === "demo") draft = await clientDraft(image);
        else draft = await api.post("/api/ai/plan", { image });
        if (draft.scale_hint && (!f.plan.m_per_px || f.plan.m_per_px === 0.02)) f.plan.m_per_px = draft.scale_hint.metres / draft.scale_hint.pixels;
        const g = draftToFloor(draft, f.plan);
        f.walls = g.walls; f.rooms = g.rooms; f.openings = g.openings; f.outline = [];
        ctx.toast(L(`Rascunho: ${g.walls.length} paredes, ${g.rooms.length} divisões. Reveja no editor.`, `Draft: ${g.walls.length} walls, ${g.rooms.length} rooms. Review it in the editor.`), 4000);
        render();
        handEdit(f.id);
      } catch (e) { ctx.toast(`IA: ${e.message}`, 5000); render(); }
    };
    render();
  }

  async function clientDraft(image) {
    const key = sessionStorage.getItem("ht_or_key");
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", referrerPolicy: "origin", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "X-Title": "House twin demo" },
      body: JSON.stringify({ model: cfg.ai_model || "google/gemini-2.5-flash", temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text: PLAN_PROMPT }, { type: "image_url", image_url: { url: image } }] }] }) });
    if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
    return sanitizeDraft(extractJsonClient((await r.json()).choices?.[0]?.message?.content));
  }

  async function toDataUrl(url) { if (url.startsWith("data:")) return url; const b = await (await fetch(url, { credentials: "same-origin" })).blob(); return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }

  async function handEdit(floorId) {
    const { openEditor } = await import("../editor/editor.js");
    for (const f of w.floors) if (f.plan && temp.planUrls[f.id]) f.plan._url = temp.planUrls[f.id];
    root.style.display = "none";
    const ed = openEditor(ctx, { profile: w, floorId, onSave: (out) => { w = out; for (const f of w.floors) if (f.plan) delete f.plan._url; }, onClose: () => { root.style.display = ""; go(i); } });
    document.querySelector(".ed").style.zIndex = 25;
    return ed;
  }

  // ---------------------------------------------------------------- 5. north
  function stepNorth() {
    const arrow = northArrowFromBearing(w.location.bearing_deg);
    body.innerHTML = `<div class="stage" id="nStage"></div><div><h2>${L("Onde é o norte?", "Where is north?")}</h2>
      <p>${L("Rode a seta para apontar para o norte na planta. Se a planta tiver uma seta do norte, alinhe-a com ela. A posição do sol depende disto.", "Turn the arrow to point north on the plan. If the plan has a north arrow, match it. The sun position depends on this.")}</p>
      <label class="f">${L("Ângulo da seta", "Arrow angle")}</label><input type="range" min="0" max="359" value="${Math.round(arrow)}" id="nAng">
      <div class="note" id="nInfo"></div></div>`;
    const stage = body.querySelector("#nStage");
    const f = w.floors[0];
    stage.innerHTML = planSvg(f, temp.planUrls[f.id]) + `<svg class="compass" viewBox="-50 -50 100 100" id="nComp"><circle r="46" fill="none" stroke="rgba(92,225,255,.3)"/><g id="nArr"><path d="M0,-40 L9,6 L0,0 L-9,6 Z" fill="#5ce1ff"/><text y="-28" text-anchor="middle" fill="#05080c" font-size="11" font-weight="700">N</text></g></svg>`;
    const set = (a) => {
      w.location.bearing_deg = Math.round(bearingFromNorthArrow(a) * 10) / 10 % 360;
      stage.querySelector("#nArr").setAttribute("transform", `rotate(${a})`);
      const cards = L(["N", "NE", "E", "SE", "S", "SO", "O", "NO"], ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
      const downAz = (w.location.bearing_deg + 90) % 360;
      body.querySelector("#nInfo").textContent = L(`O fundo da planta está virado a ${cards[Math.round(downAz / 45) % 8]} (${Math.round(downAz)}°).`, `The bottom of the plan faces ${cards[Math.round(downAz / 45) % 8]} (${Math.round(downAz)}°).`);
    };
    body.querySelector("#nAng").oninput = (e) => set(+e.target.value);
    const comp = stage.querySelector("#nComp");
    let dragging = false;
    comp.onpointerdown = (e) => { dragging = true; comp.setPointerCapture(e.pointerId); };
    comp.onpointermove = (e) => { if (!dragging) return; const r = comp.getBoundingClientRect(); const a = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI; const v = Math.round((a + 360) % 360); body.querySelector("#nAng").value = v; set(v); };
    comp.onpointerup = () => (dragging = false);
    set(arrow);
  }

  function planSvg(f, url) {
    const pts = f.walls.flatMap((x) => [x.a, x.b]);
    if (f.plan && url) { const pw = f.plan.width_px * f.plan.m_per_px, ph = f.plan.height_px * f.plan.m_per_px; pts.push(f.plan.origin, [f.plan.origin[0] + pw, f.plan.origin[1] + ph]); }
    if (!pts.length) pts.push([0, 0], [10, 8]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs) - 1, y0 = Math.min(...ys) - 1, ww = Math.max(...xs) - x0 + 1, hh = Math.max(...ys) - y0 + 1;
    const img = f.plan && url ? `<image href="${esc(url)}" x="${f.plan.origin[0]}" y="${f.plan.origin[1]}" width="${f.plan.width_px * f.plan.m_per_px}" height="${f.plan.height_px * f.plan.m_per_px}" opacity=".5" preserveAspectRatio="none"/>` : "";
    return `<svg viewBox="${x0} ${y0} ${ww} ${hh}" preserveAspectRatio="xMidYMid meet">${img}${f.rooms.map((r) => `<polygon points="${r.polygon.map((p) => p.join(",")).join(" ")}" fill="rgba(201,180,143,.15)" stroke="rgba(201,180,143,.4)" stroke-width=".04"/>`).join("")}${f.walls.map((x) => `<line x1="${x.a[0]}" y1="${x.a[1]}" x2="${x.b[0]}" y2="${x.b[1]}" stroke="#e9e6df" stroke-width="${x.thickness ?? 0.2}"/>`).join("")}</svg>`;
  }

  // ---------------------------------------------------------------- 6. aerial
  function stepAerial() {
    const a = w.site.aerial;
    body.innerHTML = `<div class="stage" id="aStage"></div><div><h2>${L("Vista aérea", "Aerial view")}</h2>
      <p>${L("Opcional. Dá contexto ao jardim e aos vizinhos no 3D.", "Optional. Gives the 3D view context: garden, street, neighbours.")}</p>
      <div class="choice" style="grid-template-columns:1fr">
        <label class="opt ${a?.source === "upload" ? "on" : ""}" style="cursor:pointer"><b>⬆ ${L("Carregar a minha imagem", "Upload my own image")}</b><small>${L("Uma captura de ecrã de vista de satélite tirada por si (para uso pessoal). Norte para cima.", "A satellite screenshot you took yourself (personal use). North up.")}</small><input type="file" id="aFile" accept="image/png,image/jpeg,image/webp" hidden></label>
        <button class="opt ${a?.source === "esri" ? "on" : ""}" id="aEsri"><b>🛰 Esri World Imagery</b><small>${L("Mostrada em direto com atribuição; nunca é guardada.", "Shown live with attribution; never stored.")}</small></button>
        <button class="opt ${!a ? "on" : ""}" id="aNone"><b>∅ ${L("Sem imagem", "No image")}</b><small>${L("Relva simples à volta da casa.", "Plain lawn around the house.")}</small></button>
      </div>
      <div class="note">${L("O Google Maps não é usado: os termos não permitem guardar as imagens de satélite.", "Google Maps is not used: its terms don't allow storing satellite imagery.")}</div>
      <div id="aCtl"></div></div>`;
    const stage = body.querySelector("#aStage");
    const draw = () => {
      const cur = w.site.aerial;
      const ctl = body.querySelector("#aCtl");
      body.querySelector("#aFile").parentElement.classList.toggle("on", cur?.source === "upload");
      body.querySelector("#aEsri").classList.toggle("on", cur?.source === "esri");
      body.querySelector("#aNone").classList.toggle("on", !cur);
      if (!cur) { stage.innerHTML = `<div class="note" style="margin:16px">${L("Sem vista aérea.", "No aerial view.")}</div>`; ctl.innerHTML = ""; return; }
      if (cur.source === "esri") {
        stage.innerHTML = ""; const mp = document.createElement("div"); mp.style.height = "100%"; stage.appendChild(mp);
        createMap(mp, { lat: w.location.lat, lon: w.location.lon, zoom: 19, layer: "esri", pin: { lat: w.location.lat, lon: w.location.lon } });
        ctl.innerHTML = `<p>${L("O marcador deve estar no centro da casa.", "The pin should be at the centre of the house.")}</p>`;
        return;
      }
      const url = temp.aerialUrl || (w.assets.find((x) => x.id === cur.asset) ? api.assetUrl(w.assets.find((x) => x.id === cur.asset)) : "");
      const f = w.floors[0];
      const out = f.outline?.length ? f.outline : f.walls.flatMap((x) => [x.a]);
      const xs = out.map((p) => p[0]), ys = out.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2 || 0, cy = (Math.min(...ys) + Math.max(...ys)) / 2 || 0;
      const W = (cur.width_px || 800) * cur.m_per_px, H = (cur.height_px || 600) * cur.m_per_px;
      const c = cur.center || [cx, cy];
      stage.innerHTML = `<svg viewBox="${c[0] - W / 2} ${c[1] - H / 2} ${W} ${H}" preserveAspectRatio="xMidYMid meet"><g transform="rotate(${cur.rotation_deg || 0} ${c[0]} ${c[1]})"><image href="${esc(url)}" x="${c[0] - W / 2}" y="${c[1] - H / 2}" width="${W}" height="${H}" preserveAspectRatio="none"/></g>
        ${f.walls.map((x) => `<line x1="${x.a[0]}" y1="${x.a[1]}" x2="${x.b[0]}" y2="${x.b[1]}" stroke="#5ce1ff" stroke-width="${Math.max(0.15, (x.thickness ?? 0.2))}"/>`).join("")}</svg>`;
      ctl.innerHTML = `<label class="f">${L("Escala (cm por píxel)", "Scale (cm per pixel)")}</label><input type="range" min="2" max="60" step="0.5" value="${cur.m_per_px * 100}" id="aS">
        <label class="f">${L("Deslocar ←→ (m)", "Shift ←→ (m)")}</label><input type="range" min="-30" max="30" step="0.1" value="${r2(c[0] - cx)}" id="aX">
        <label class="f">${L("Deslocar ↑↓ (m)", "Shift ↑↓ (m)")}</label><input type="range" min="-30" max="30" step="0.1" value="${r2(c[1] - cy)}" id="aY">
        <p>${L("Ajuste até o contorno azul coincidir com o telhado. A rotação vem do passo Norte.", "Adjust until the blue outline matches the roof. Rotation comes from the North step.")}</p>`;
      const upd = () => { cur.m_per_px = +ctl.querySelector("#aS").value / 100; cur.center = [r2(cx + +ctl.querySelector("#aX").value), r2(cy + +ctl.querySelector("#aY").value)]; draw(); };
      ctl.querySelectorAll("input").forEach((x) => (x.onchange = upd));
    };
    body.querySelector("#aFile").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const img = await cleanImage(file, cfg.mode === "demo" ? 1400 : 2400, "image/jpeg");
      const stored = await api.putAsset("aerial", img.dataUrl, img.mime);
      w.assets = w.assets.filter((x) => x.id !== "aerial");
      w.assets.push({ id: "aerial", kind: "aerial", mime: img.mime, ...(stored.path ? { path: stored.path } : {}) });
      temp.aerialUrl = img.dataUrl;
      w.site.aerial = { asset: "aerial", source: "upload", m_per_px: w.location.lat != null ? metresPerPixel(w.location.lat, 19) : 0.25, width_px: img.width, height_px: img.height, rotation_deg: northArrowFromBearing(w.location.bearing_deg), origin: [0, 0] };
      draw();
    };
    body.querySelector("#aEsri").onclick = () => { w.site.aerial = { source: "esri", rotation_deg: northArrowFromBearing(w.location.bearing_deg), attribution: "Esri World Imagery" }; draw(); };
    body.querySelector("#aNone").onclick = () => { w.site.aerial = null; draw(); };
    draw();
  }

  // ---------------------------------------------------------------- 7. roof + terrain
  function stepRoof() {
    body.classList.add("one");
    const top = [...w.floors].sort((a, b) => b.elevation - a.elevation)[0];
    // one roof per rectangle of the top floor's outline (an L-shaped house gets two)
    const topRoofs = () => w.roofs.filter((r) => r.floor === top.id);
    if (!topRoofs().length && top.walls.length) {
      if (!top.outline?.length) top.outline = outlineOf(top);
      for (const o of rectsOf(top.outline)) {
        const long = o[1][0] - o[0][0] >= o[2][1] - o[1][1];
        w.roofs.push({ id: uid("roof"), floor: top.id, type: "gable", pitch_deg: 30, overhang: 0.4, ridge: long ? "x" : "y", outline: o });
      }
    }
    let roof = topRoofs()[0];
    const types = [["gable", L("Duas águas", "Gable")], ["hip", L("Quatro águas", "Hip")], ["shed", L("Uma água", "Shed")], ["flat", L("Plano / terraço", "Flat")]];
    body.innerHTML = `<div><h2>${L("Telhado", "Roof")}</h2>
      <div class="choice" style="grid-template-columns:repeat(4,1fr)">${types.map(([t, n]) => `<button class="opt ${roof?.type === t ? "on" : ""}" data-rt="${t}"><b>${n}</b></button>`).join("")}</div>
      <div class="row"><label style="flex:1">${L("Inclinação (°)", "Pitch (°)")}<input type="number" id="rP" min="5" max="60" value="${roof?.pitch_deg || 30}"></label>
        <label style="flex:1">${L("Beiral (m)", "Overhang (m)")}<input type="number" id="rO" step="0.05" min="0" max="1.5" value="${roof?.overhang ?? 0.4}"></label>
        <label style="flex:1">${L("Cumeeira", "Ridge")}<select id="rR"><option value="x">↔ ${L("ao longo", "along")}</option><option value="y" ${roof?.ridge === "y" ? "selected" : ""}>↕ ${L("de través", "across")}</option></select></label></div>
      <p>${L("Telhados mais complexos (vários volumes, mansardas) acertam-se depois no editor, por piso.", "More complex roofs (several volumes, dormers) can be refined later in the editor, per floor.")}</p>
      <h2 style="margin-top:18px">${L("Terreno", "Terrain")}</h2>
      <div class="row"><label style="flex:1">${L("Tipo", "Type")}<select id="tT"><option value="flat">${L("Plano", "Flat")}</option><option value="slope" ${w.site.terrain.type === "slope" ? "selected" : ""}>${L("Inclinado", "Sloped")}</option></select></label>
        <label style="flex:1">${L("Declive (%)", "Grade (%)")}<input type="number" id="tG" min="0" max="60" value="${w.site.terrain.grade_pct || 0}"></label>
        <label style="flex:1">${L("Desce para (°)", "Falls toward (°)")}<input type="number" id="tD" min="0" max="359" value="${w.site.terrain.direction_deg || 180}"></label></div></div>`;
    const ensure = () => {
      if (!top.outline?.length) top.outline = outlineOf(top);
      if (!roof) { roof = { id: uid("roof"), floor: top.id, type: "gable", pitch_deg: 30, overhang: 0.4, ridge: "x", outline: bbox4(top.outline) }; w.roofs.push(roof); }
    };
    const all = (k, v) => { ensure(); for (const r of topRoofs()) r[k] = v; };
    body.querySelectorAll("[data-rt]").forEach((b) => (b.onclick = () => { all("type", b.dataset.rt); body.querySelectorAll("[data-rt]").forEach((x) => x.classList.toggle("on", x === b)); }));
    body.querySelector("#rP").onchange = (e) => all("pitch_deg", Math.max(5, Math.min(60, +e.target.value)));
    body.querySelector("#rO").onchange = (e) => all("overhang", Math.max(0, +e.target.value));
    body.querySelector("#rR").onchange = (e) => { ensure(); roof.ridge = e.target.value; };
    if (topRoofs().length > 1) body.querySelector("#rR").closest("label").title = L("Aplica-se ao primeiro volume; os outros seguem o lado mais comprido.", "Applies to the first volume; the others follow their longer side.");
    body.querySelector("#tT").onchange = (e) => (w.site.terrain.type = e.target.value);
    body.querySelector("#tG").onchange = (e) => (w.site.terrain.grade_pct = Math.max(0, Math.min(60, +e.target.value)));
    body.querySelector("#tD").onchange = (e) => (w.site.terrain.direction_deg = ((+e.target.value % 360) + 360) % 360);
  }
  const bbox4 = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; };
  const outlineOf = (f) => { try { const o = computeOutline(f); if (o?.length >= 3) return o; } catch {} return bbox4(f.walls.flatMap((x) => [x.a, x.b]).concat(f.rooms.flatMap((r) => r.polygon))); };

  // ---------------------------------------------------------------- 8. modules
  function stepModules() {
    body.classList.add("one");
    const mods = [
      ["plants", "🪴", L("Plantas", "Plants"), L("Onde vive cada planta, quando regar e se tem a luz certa.", "Where each plant lives, when to water and whether it gets the right light.")],
      ["wifi", "📶", "Wi-Fi", L("Pontos de acesso e mapa de sinal previsto; calibra com medições.", "Access points and a predicted signal map; calibrate with measurements.")],
      ["homeassistant", "🏠", "Home Assistant", L("Sensores e luzes no sítio certo, com estado em direto.", "Sensors and lights in the right place with live state.")],
      ["solar", "🔆", L("Solar", "Solar"), L("Painéis no telhado e produção estimada com céu limpo.", "Panels on the roof and a clear-sky production estimate.")],
      ["cameras", "📷", L("Câmaras", "Cameras"), L("Cones de visão; imagem em direto via Home Assistant.", "View cones; live image through Home Assistant.")],
    ];
    body.innerHTML = `<div><h2>${L("Módulos", "Modules")}</h2><p>${L("O sol está sempre ligado. Ligue o resto conforme quiser; pode mudar depois.", "Sun is always on. Turn the rest on as you like; you can change it later.")}</p>
      <div class="choice">${mods.map(([id, ic, n, d]) => `<button class="opt ${w.modules[id]?.enabled ? "on" : ""}" data-m="${id}"><b>${ic} ${n}</b><small>${d}</small></button>`).join("")}</div>
      <div id="solarCfg"></div></div>`;
    const solarCfg = () => {
      const el = body.querySelector("#solarCfg");
      if (!w.modules.solar?.enabled) return (el.innerHTML = "");
      if (!w.modules.solar.arrays?.length) w.modules.solar.arrays = [{ id: "pv1", label: L("Painéis", "Panels"), roof: w.roofs[0]?.id, face: "+y", kwp: 3, panels: 8, loss_pct: 14 }];
      const arr = w.modules.solar.arrays[0];
      if (!arr.roof) arr.roof = w.roofs[0]?.id;
      el.innerHTML = `<h2 style="margin-top:18px">🔆 ${L("Painéis", "Panels")}</h2><div class="row">
        <label style="flex:1">kWp<input type="number" step="0.1" min="0.2" max="50" id="sK" value="${arr.kwp}"></label>
        <label style="flex:1">${L("Painéis", "Panels")}<input type="number" min="1" max="80" id="sN" value="${arr.panels}"></label>
        <label style="flex:1">${L("Água do telhado", "Roof face")}<select id="sF">${["+y", "-y", "+x", "-x"].map((f) => `<option ${arr.face === f ? "selected" : ""}>${f}</option>`).join("")}</select></label></div>
        <p>${L("+y é a água virada para o fundo da planta.", "+y is the roof face toward the bottom of the plan.")}</p>`;
      el.querySelector("#sK").onchange = (e) => (arr.kwp = +e.target.value);
      el.querySelector("#sN").onchange = (e) => (arr.panels = +e.target.value);
      el.querySelector("#sF").onchange = (e) => (arr.face = e.target.value);
    };
    body.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => {
      const id = b.dataset.m;
      const defaults = { plants: { items: [] }, wifi: { aps: [], survey: [] }, homeassistant: { entities: [] }, solar: { arrays: [] }, cameras: { items: [] } };
      w.modules[id] = { ...(defaults[id]), ...(w.modules[id] || {}), enabled: !w.modules[id]?.enabled };
      b.classList.toggle("on", w.modules[id].enabled);
      if (id === "solar") solarCfg();
    }));
    solarCfg();
  }

  // ---------------------------------------------------------------- 9. review
  function stepReview() {
    body.classList.add("one");
    for (const f of w.floors) if (f.walls.length && (!f.outline || f.outline.length < 3)) f.outline = outlineOf(f);
    const v = validate(w);
    body.innerHTML = `<div><h2>${L("Rever e guardar", "Review and save")}</h2>
      <div class="ring-row"><div class="mini"><b>${w.floors.length}</b><span>${L("pisos", "floors")}</span></div><div class="mini"><b>${w.floors.reduce((a, f) => a + f.rooms.length, 0)}</b><span>${L("divisões", "rooms")}</span></div><div class="mini"><b>${Object.values(w.modules).filter((m) => m.enabled).length}</b><span>${L("módulos", "modules")}</span></div></div>
      <div class="note">${esc(w.name)} · ${w.location.lat != null ? `${w.location.lat.toFixed(4)}, ${w.location.lon.toFixed(4)}` : "—"} · ${L("norte", "north")} ${Math.round(northArrowFromBearing(w.location.bearing_deg))}° · ${esc(w.location.timezone)}</div>
      ${v.ok ? `<div class="note">✓ ${L("Perfil válido.", "Profile is valid.")} ${cfg.mode === "demo" ? L("Na demonstração fica guardado só neste browser.", "On the demo it is saved in this browser only.") : L("Fica guardado no armazenamento desta instalação.", "It is saved in this installation's storage.")}</div>` : `<div class="note warn">${v.errors.slice(0, 8).map(esc).join("<br>")}</div>`}</div>`;
  }

  async function save() {
    for (const f of w.floors) if (f.walls.length && (!f.outline || f.outline.length < 3)) f.outline = outlineOf(f);
    const v = validate(w);
    if (!v.ok) return msg(v.errors[0]);
    try {
      ctx.state.floor = null;
      if (!ctx.state.date) {
        const { todayIn } = await import("../engine/sun.js");
        ctx.state.date = todayIn(w.location.timezone); ctx.state.minutes = 720;
        document.querySelector("#dateIn").value = ctx.state.date; document.querySelector("#timeIn").value = 720;
      }
      ctx.state.module = "sun";
      await ctx.saveProfile(structuredClone(w));
      root.remove();
      window.__appReady = true;
    } catch (e) { msg(e.message); }
  }

  go(opts.step || 0);
  return { root };
}
