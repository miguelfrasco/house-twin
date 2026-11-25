// Setup guide: a step-by-step walk from nothing to a living 3D house.
// Chapters: connect (hosting, keys), the house (location, plans, rooms, north, aerial, walls, roof and terrain),
// layers (plants, Wi-Fi, devices, solar, cameras) and review. The house assembles live behind the guide;
// progress is kept in this browser so you can stop and come back.
import { emptyProfile, migrate, validate, uid, bearingFromNorthArrow, northArrowFromBearing } from "../profile/profile.js";
import { getLang } from "../i18n.js";
import { cleanImage } from "../api.js";
import { createMap, geocode, metresPerPixel } from "./map.js";
import { draftToFloor, rectangleFloor, rectsOf } from "./convert.js";
import { computeOutline, pdfScale } from "../editor/editor.js";
import { PLAN_PROMPT, extractJsonClient, sanitizeDraft } from "./prompt.js";
import { createPreview } from "./preview.js";

const L = (pt, en) => (getLang() === "pt-PT" ? pt : en);
const r2 = (v) => Math.round(v * 100) / 100;
const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
const KEY = "ht_setup_v2";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function openWizard(ctx, opts = {}) {
  const { esc, api } = ctx;
  const cfg = api.config || {};
  document.querySelector(".guide")?.remove();
  let w = migrate(ctx.profile && !opts.fresh ? structuredClone(ctx.profile) : emptyProfile(L("A minha casa", "My house")));
  if (cfg.mode === "demo" && !ctx.draft && !opts.keep) w = emptyProfile(L("A minha casa", "My house"));
  let status = {}, i = 0, resumed = false;
  // resume an unfinished setup (same browser, same kind of installation)
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && !opts.fresh && opts.step == null && s.mode === cfg.mode && s.w) { w = migrate(s.w); status = s.status || {}; i = s.i || 0; resumed = i > 0; }
  } catch {}
  if (!w.floors[0].walls.length && w.floors[0].name === "Ground floor") w.floors[0].name = L("Rés-do-chão", "Ground floor");
  w.locale = getLang();
  w.display ||= { walls: "half", wall_cut: 1.2 };
  if (!w.location.timezone || w.location.timezone === "UTC") w.location.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  delete w.demo;
  const temp = { planUrls: {}, target: cfg.target === "node" ? "docker" : "cloudflare", claimed: cfg.mode !== "setup", aerialUrl: null };
  const assetUrlOf = (a) => (a.id === "aerial" && temp.aerialUrl ? temp.aerialUrl : api.assetUrl(a));
  for (const f of w.floors) if (f.plan) { const a = w.assets.find((x) => x.id === f.plan.asset); if (a) temp.planUrls[f.id] = api.assetUrl(a); }

  const CH = { connect: L("Ligar", "Connect"), house: L("A casa", "The house"), layers: L("Camadas", "Layers"), done: L("Terminar", "Finish") };
  const STEPS = [
    { id: "host", ch: "connect", title: L("Alojamento", "Hosting"), render: stepHost, ok: () => temp.claimed || L("Primeiro confirme o código de configuração e crie a palavra-passe.", "First confirm the setup code and create a password.") },
    { id: "keys", ch: "connect", title: L("Chaves", "Keys"), optional: true, render: stepKeys },
    { id: "where", ch: "house", title: L("Localização", "Location"), render: stepWhere, tool: true, ok: () => (w.location.lat != null ? true : L("Toque no mapa, em cima da casa.", "Tap the map, on top of the house.")) },
    { id: "plans", ch: "house", title: L("Plantas dos pisos", "Floor plans"), render: stepPlans, ok: () => (w.floors.some((f) => f.walls.length) ? true : L("Desenhe pelo menos um piso: com IA, à mão ou com a casa retangular.", "Draw at least one floor: with AI, by hand or the rectangle starter.")) },
    { id: "rooms", ch: "house", title: L("Pisos e divisões", "Floors and rooms"), render: stepRooms },
    { id: "north", ch: "house", title: L("Norte", "North"), render: stepNorth, tool: true },
    { id: "aerial", ch: "house", title: L("Vista aérea", "Aerial view"), optional: true, render: stepAerial, tool: true },
    { id: "walls", ch: "house", title: L("Paredes", "Walls"), render: stepWalls },
    { id: "roof", ch: "house", title: L("Telhado e terreno", "Roof and terrain"), render: stepRoof },
    { id: "plants", ch: "layers", title: L("Plantas", "Plants"), optional: true, module: true, render: () => stepLayer("plants") },
    { id: "wifi", ch: "layers", title: "Wi-Fi", optional: true, module: true, render: () => stepLayer("wifi") },
    { id: "homeassistant", ch: "layers", title: L("Dispositivos", "Devices"), optional: true, module: true, render: () => stepLayer("homeassistant") },
    { id: "solar", ch: "layers", title: L("Painéis solares", "Solar panels"), optional: true, module: true, render: () => stepLayer("solar") },
    { id: "cameras", ch: "layers", title: L("Câmaras", "Cameras"), optional: true, module: true, render: () => stepLayer("cameras") },
    { id: "review", ch: "done", title: L("Rever e guardar", "Review and save"), render: stepReview },
  ];
  if (opts.step != null) i = typeof opts.step === "number" ? opts.step : Math.max(0, STEPS.findIndex((s) => s.id === opts.step));

  const root = document.createElement("div");
  root.className = "overlay guide";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", L("Guia de configuração", "Setup guide"));
  root.innerHTML = `<aside class="g-rail glass">
      <div class="g-brand"><span class="logo">⌂</span><div><b>${L("Configurar a casa", "Set up your house")}</b><small>${L("O progresso fica guardado neste browser.", "Progress is kept in this browser.")}</small></div></div>
      <div class="g-progress" aria-hidden="true"><i></i></div>
      <nav class="g-steps" aria-label="${L("Passos", "Steps")}"></nav>
      <div class="g-rail-foot"><button class="chip small" id="gRestart">${L("Recomeçar", "Start over")}</button><button class="chip small" id="wzClose">${L("Fechar", "Close")}</button></div>
    </aside>
    <section class="g-stage">
      <div class="g-preview"><canvas class="g-canvas"></canvas><div class="g-labels"></div><div class="g-layers" aria-hidden="true"></div></div>
      <div class="g-tool"></div>
      <article class="g-card glass wiz">
        <header class="g-head"><span class="g-count"></span><h1 class="g-title" tabindex="-1"></h1></header>
        <div class="g-body wiz-body"></div>
        <footer class="g-foot"><span class="note" id="wzMsg" role="status"></span>
          <button class="btn" id="wzBack">${L("Anterior", "Back")}</button>
          <button class="btn ghost" id="wzSkip">${L("Fazer mais tarde", "Do this later")}</button>
          <button class="btn primary" id="wzNext">${L("Seguinte", "Next")}</button></footer>
      </article>
    </section>`;
  document.body.appendChild(root);
  document.body.classList.add("guide-open");
  const $ = (s) => root.querySelector(s);
  const body = $(".g-body"), tool = $(".g-tool"), card = $(".g-card");
  const preview = createPreview(root.querySelector(".g-canvas"), root.querySelector(".g-labels"), {
    assetUrl: assetUrlOf,
    shiftX: () => (matchMedia("(max-width: 760px)").matches ? 0 : card.offsetLeft + card.offsetWidth), // centre the house beside the card
  });

  const close = () => { preview.dispose(); root.remove(); document.body.classList.remove("guide-open"); };
  $("#wzClose").onclick = () => {
    if (opts.firstRun && !ctx.profile) return ctx.toast(L("Termine a configuração para usar a app. O progresso fica guardado.", "Finish setup to use the app. Your progress is kept."));
    persist(); close();
  };
  $("#gRestart").onclick = () => {
    if (!confirm(L("Recomeçar do início? O que fez neste guia será apagado (a casa já guardada não muda).", "Start over? What you did in this guide is cleared (a house you already saved is not changed)."))) return;
    localStorage.removeItem(KEY); close(); openWizard(ctx, { ...opts, fresh: true, step: 0 });
  };
  $("#wzBack").onclick = () => go(i - 1);
  $("#wzSkip").onclick = () => { status[STEPS[i].id] = "later"; if (STEPS[i].module) setModule(STEPS[i].id, false); go(i + 1); };
  $("#wzNext").onclick = () => {
    const ok = STEPS[i].ok ? STEPS[i].ok() : true;
    if (ok !== true) return msg(ok);
    status[STEPS[i].id] = STEPS[i].module && !w.modules[STEPS[i].id]?.enabled ? "off" : "done";
    if (i === STEPS.length - 1) return save();
    go(i + 1);
  };
  const msg = (m) => { const e = $("#wzMsg"); e.textContent = m || ""; e.classList.toggle("on", !!m); };

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ mode: cfg.mode, w, status, i, at: Date.now() })); } catch { /* too big (huge plan image): progress just isn't kept */ }
  }

  function rail() {
    const chapters = [...new Set(STEPS.map((s) => s.ch))];
    $(".g-steps").innerHTML = chapters.map((c) => `<div class="g-ch"><span class="g-ch-t">${esc(CH[c])}</span>${STEPS.map((s, k) => s.ch !== c ? "" : `
      <button class="g-step ${k === i ? "cur" : ""} ${status[s.id] || ""}" data-go="${k}" ${k === i ? 'aria-current="step"' : ""}>
        <span class="g-dot" aria-hidden="true">${status[s.id] === "done" ? "✓" : ""}</span><span class="g-st">${esc(s.title)}</span>
        ${status[s.id] === "later" ? `<span class="g-tag">${L("mais tarde", "later")}</span>` : status[s.id] === "off" ? `<span class="g-tag">${L("desligada", "off")}</span>` : s.optional && k !== i && !status[s.id] ? `<span class="g-tag">${L("opcional", "optional")}</span>` : ""}
      </button>`).join("")}</div>`).join("");
    $(".g-steps").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(+b.dataset.go)));
    const done = STEPS.filter((s) => status[s.id]).length;
    $(".g-progress i").style.transform = `scaleX(${Math.max(0.02, done / STEPS.length)})`;
    root.style.setProperty("--g-step", `"${i + 1}/${STEPS.length}"`);
  }

  let swapT = 0;
  function go(n) {
    const first = !root.dataset.step;
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    const s = STEPS[i];
    msg("");
    persist();
    rail();
    root.dataset.step = s.id;
    $("#wzBack").disabled = i === 0;
    $("#wzSkip").classList.toggle("hidden", !s.optional);
    $("#wzNext").textContent = i === STEPS.length - 1 ? L("Guardar a casa", "Save the house") : L("Seguinte", "Next");
    // content swaps: a short fade out, then the new step settles in (a quick click just restarts it)
    clearTimeout(swapT);
    const render = () => {
      body.className = "g-body wiz-body";
      body.innerHTML = ""; tool.innerHTML = "";
      root.classList.toggle("has-tool", !!s.tool);
      $(".g-count").textContent = L(`Passo ${i + 1} de ${STEPS.length}`, `Step ${i + 1} of ${STEPS.length}`);
      $(".g-title").textContent = s.title;
      s.render();
      card.dataset.phase = "enter";
      requestAnimationFrame(() => requestAnimationFrame(() => (card.dataset.phase = "")));
      body.scrollTop = 0;
      if (!first) $(".g-title").focus({ preventScroll: true });
      refresh();
    };
    if (first || reduced()) render();
    else { card.dataset.phase = "exit"; swapT = setTimeout(render, 140); }
  }

  // ---------------------------------------------------------------- live preview
  function refresh(kind) {
    const s = STEPS[i];
    preview.show(w, { step: s.id, view: s.id === "roof" || s.id === "solar" ? "roof" : "house", pin: w.location.lat != null, kind });
    const mods = ["plants", "wifi", "homeassistant", "solar", "cameras"];
    const names = { plants: L("Plantas", "Plants"), wifi: "Wi-Fi", homeassistant: L("Dispositivos", "Devices"), solar: "Solar", cameras: L("Câmaras", "Cameras") };
    const icons = { plants: "🪴", wifi: "📶", homeassistant: "🏠", solar: "🔆", cameras: "📷" };
    const lay = $(".g-layers");
    const showBar = s.ch === "layers" || s.ch === "done";
    lay.classList.toggle("on", showBar);
    if (showBar) lay.innerHTML = `<span class="fl-lbl">${L("Mostrar", "Show")}</span><span class="fl on"><span>☀</span><span>${L("Sol", "Sun")}</span></span>` + mods.map((m) => `<span class="fl ${w.modules[m]?.enabled ? "on" : ""} ${s.id === m ? "here" : ""}"><span>${icons[m]}</span><span>${names[m]}</span></span>`).join("");
  }

  // ---------------------------------------------------------------- 1. hosting + owner
  function stepHost() {
    const demo = cfg.mode === "demo";
    body.innerHTML = `<p class="lead">${L("A app é sua. Escolha onde a publica: o perfil da casa, as imagens e as chaves ficam sempre no seu armazenamento, sem servidor central nem telemetria.", "The app is yours. Choose where to run it: the house profile, images and keys always stay in your own storage, with no central server and no telemetry.")}</p>
      ${demo ? `<div class="note">${L("Está na demonstração pública. Pode fazer o guia todo: o resultado fica só neste browser. Para a sua casa, publique a sua própria cópia num dos destinos abaixo.", "You're on the public demo. You can go through the whole guide: the result stays in this browser only. For your own house, deploy your own copy to one of the targets below.")}</div>` : ""}
      <div class="choice">
        <button class="opt ${temp.target === "cloudflare" ? "on" : ""}" data-t="cloudflare" aria-pressed="${temp.target === "cloudflare"}"><b>Cloudflare Workers</b><small>${L("Funciona no plano gratuito. Endereço https próprio, sem nada ligado em casa.", "Works on the free plan. Your own https address, nothing running at home.")}</small></button>
        <button class="opt ${temp.target === "docker" ? "on" : ""}" data-t="docker" aria-pressed="${temp.target === "docker"}"><b>Docker ${L("num Raspberry Pi ou NAS", "on a Raspberry Pi or NAS")}</b><small>${L("Corre na sua rede, ao lado do Home Assistant. Os dados ficam num volume local.", "Runs on your network next to Home Assistant. Data lives in a local volume.")}</small></button>
      </div>
      <ol class="g-howto" id="hostCmds"></ol>
      ${cfg.mode === "setup" ? `<h2>${L("Torne-se o dono da casa", "Become the house owner")}</h2>
        <p>${L("Escreva o código de configuração (o segredo SETUP_CODE, ou o código que aparece nos registos do contentor) e escolha uma palavra-passe.", "Enter the setup code (the SETUP_CODE secret, or the code printed in the container logs) and choose a password.")}</p>
        <label class="f">${L("Código de configuração", "Setup code")}</label><input id="claimCode" autocomplete="one-time-code">
        <label class="f">${L("Palavra-passe (pelo menos 10 caracteres)", "Password (at least 10 characters)")}</label><input id="claimPw" type="password" autocomplete="new-password">
        <label class="f">${L("Repita a palavra-passe", "Repeat the password")}</label><input id="claimPw2" type="password" autocomplete="new-password">
        <div class="row"><button class="btn primary" id="claimGo" style="flex:0">${L("Confirmar", "Confirm")}</button><span id="claimMsg" class="note" style="display:none;margin:0"></span></div>` : ""}`;
    const cmds = () => {
      body.querySelector("#hostCmds").innerHTML = temp.target === "cloudflare"
        ? `<li>${L("Faça fork do repositório no GitHub e clone-o.", "Fork the repository on GitHub and clone it.")}<pre class="cmd">git clone &lt;${L("o-seu-fork", "your-fork")}&gt; house-twin && cd house-twin</pre></li>
           <li>${L("Crie o armazenamento e cole o id em wrangler.jsonc.", "Create the storage and paste its id into wrangler.jsonc.")}<pre class="cmd">npx wrangler@4 login
npx wrangler@4 kv namespace create TWIN</pre></li>
           <li>${L("Defina um código de configuração longo e aleatório.", "Set a long, random setup code.")}<pre class="cmd">npx wrangler@4 secret put SETUP_CODE</pre></li>
           <li>${L("Publique e abra o endereço que aparece no fim.", "Deploy, then open the address it prints.")}<pre class="cmd">npm run cf:deploy</pre></li>`
        : `<li>${L("Faça fork do repositório e clone-o no Pi ou no NAS.", "Fork the repository and clone it on the Pi or NAS.")}<pre class="cmd">git clone &lt;${L("o-seu-fork", "your-fork")}&gt; house-twin && cd house-twin</pre></li>
           <li>${L("Arranque o contentor.", "Start the container.")}<pre class="cmd">docker compose up -d --build</pre></li>
           <li>${L("Copie o código de primeira utilização dos registos.", "Copy the one-time setup code from the logs.")}<pre class="cmd">docker compose logs house-twin | grep "setup code"</pre></li>
           <li>${L("Abra http://&lt;endereço-do-pi&gt;:8787 no browser.", "Open http://&lt;pi-address&gt;:8787 in your browser.")}</li>`;
    };
    cmds();
    body.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { temp.target = b.dataset.t; body.querySelectorAll("[data-t]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); }); cmds(); }));
    body.querySelector("#claimGo")?.addEventListener("click", async () => {
      const m = body.querySelector("#claimMsg"); m.style.display = "";
      const pw = body.querySelector("#claimPw").value;
      if (pw !== body.querySelector("#claimPw2").value) { m.textContent = L("As palavras-passe não coincidem.", "Passwords don't match."); return; }
      try { await api.post("/api/setup/claim", { code: body.querySelector("#claimCode").value, password: pw }); temp.claimed = true; Object.assign(cfg, await api.init()); cfg.authed = true; api.config = cfg; m.textContent = "✓ " + L("Pronto. A casa é sua.", "Done. The house is yours."); }
      catch (e) { m.textContent = e.status === 403 ? L("Código errado.", "Wrong code.") : e.status === 400 ? L("A palavra-passe precisa de pelo menos 10 caracteres.", "The password needs at least 10 characters.") : e.message; }
    });
  }

  // ---------------------------------------------------------------- 2. keys
  function stepKeys() {
    const demo = cfg.mode === "demo";
    const rows = [
      ["OPENROUTER_API_KEY", L("Desenha as paredes a partir da planta da casa e identifica plantas por fotografia.", "Drafts walls from your plan and identifies plants from photos."), L("Em openrouter.ai: crie uma conta e depois Keys, Create key.", "At openrouter.ai: create an account, then Keys, Create key.")],
      ["HA_BASE_URL", L("O endereço do seu Home Assistant.", "Your Home Assistant address."), L("Por exemplo http://homeassistant.local:8123 ou o endereço remoto.", "For example http://homeassistant.local:8123 or your remote address.")],
      ["HA_TOKEN", L("Deixa a app ler o estado dos dispositivos.", "Lets the app read your devices' state."), L("No Home Assistant: o seu perfil, separador Segurança, Tokens de acesso de longa duração, Criar token.", "In Home Assistant: your profile, Security tab, Long-lived access tokens, Create token.")],
    ];
    const set = cfg.secrets || {};
    body.innerHTML = `<p class="lead">${L("São todas opcionais. Ficam como segredos do servidor (segredos do Worker, ou o ficheiro secrets.env no volume de dados): nunca no perfil nem no repositório.", "All optional. They stay as server secrets (Worker secrets, or secrets.env on the data volume): never in the profile or the repo.")}</p>
      <div class="list">${rows.map(([n, what, how]) => `<div class="g-key"><div><b>${n}</b><small>${esc(what)}</small><small class="how">${esc(how)}</small></div>${demo ? "" : `<span class="tag ${set[n] ? "ok" : ""}">${set[n] ? L("definida", "set") : L("em falta", "missing")}</span>`}</div>`).join("")}</div>
      ${!demo && cfg.can_write_secrets ? `<p>${L("Neste servidor pode guardá-las aqui (ficam em /data/secrets.env, só o dono as lê):", "On this server you can save them here (stored in /data/secrets.env, readable by the owner only):")}</p>
        ${rows.map(([n]) => `<label class="f">${n}</label><div class="row" style="margin:0"><input type="password" data-sec="${n}" autocomplete="off"><button class="btn small" style="flex:0" data-save="${n}">${L("Guardar", "Save")}</button></div>`).join("")}` : ""}
      ${!demo && !cfg.can_write_secrets ? `<pre class="cmd">npx wrangler@4 secret put OPENROUTER_API_KEY
npx wrangler@4 secret put HA_BASE_URL
npx wrangler@4 secret put HA_TOKEN</pre><p>${L("Depois de as definir, recarregue esta página: o guia continua onde estava.", "After setting them, reload this page: the guide picks up where you were.")}</p>` : ""}
      ${demo ? `<div class="note">${L("Na demonstração pode usar a sua chave OpenRouter só neste separador: vai diretamente do seu browser para a OpenRouter e é esquecida quando fechar o separador.", "On the demo you can use your own OpenRouter key in this tab only: it goes straight from your browser to OpenRouter and is forgotten when you close the tab.")}</div>
        <label class="f">${L("Chave OpenRouter", "OpenRouter key")}</label><input type="password" id="demoKey" autocomplete="off" value="${sessionStorage.getItem("ht_or_key") ? "••••••••" : ""}">` : ""}
      <p class="meta">${L("Modelo de visão:", "Vision model:")} ${esc(cfg.ai_model || "google/gemini-2.5-flash")}</p>`;
    body.querySelectorAll("[data-save]").forEach((b) => (b.onclick = async () => {
      const n = b.dataset.save, v = body.querySelector(`[data-sec="${n}"]`).value;
      try { await api.post("/api/secrets", { name: n, value: v }); cfg.secrets[n] = !!v; ctx.toast(`${n} ✓`); body.innerHTML = ""; stepKeys(); } catch (e) { ctx.toast(e.message); }
    }));
    const dk = body.querySelector("#demoKey");
    if (dk) dk.onchange = () => { if (dk.value && !dk.value.startsWith("••")) sessionStorage.setItem("ht_or_key", dk.value.trim()); if (!dk.value) sessionStorage.removeItem("ht_or_key"); };
  }

  // ---------------------------------------------------------------- 3. location
  function stepWhere() {
    tool.innerHTML = `<div class="mapwrap" id="map"></div>`;
    body.innerHTML = `<p class="lead">${L("Procure a morada e toque no mapa em cima do telhado. Serve para pôr o sol no sítio certo.", "Search for the address and tap the map on top of the roof. It puts the sun in the right place.")}</p>
      <label class="f">${L("Nome da casa", "House name")}</label><input id="hName" maxlength="80" value="${esc(w.name)}">
      <label class="f">${L("Morada ou localidade", "Address or town")}</label><div class="row" style="margin:0"><input id="q" placeholder="${L("Rua, localidade", "Street, town")}"><button class="btn small" style="flex:0" id="qGo">${L("Procurar", "Search")}</button></div>
      <div class="list" id="qRes" style="margin-top:8px"></div>
      <div class="note" id="pinInfo">${w.location.lat != null ? `📍 ${w.location.lat.toFixed(5)}, ${w.location.lon.toFixed(5)}` : L("Ainda sem marcador.", "No pin yet.")}</div>
      <details class="g-more"><summary>${L("Fuso horário e privacidade", "Time zone and privacy")}</summary>
        <label class="f">${L("Fuso horário", "Time zone")}</label><input id="tz" value="${esc(w.location.timezone)}">
        <p>${L("A localização exata fica só no seu perfil. O mapa vem da OpenStreetMap enquanto escolhe; a meteorologia, se a ligar, recebe só coordenadas arredondadas (cerca de 1 km).", "The exact location stays in your profile only. Map tiles come from OpenStreetMap while you choose; weather, if you turn it on, only gets rounded coordinates (about 1 km).")}</p></details>`;
    const m = createMap(tool.querySelector("#map"), { lat: w.location.lat ?? 39.6, lon: w.location.lon ?? -8.0, zoom: w.location.lat != null ? 18 : 6, pin: w.location.lat != null ? { lat: w.location.lat, lon: w.location.lon } : null,
      onPin: (p) => { w.location.lat = p.lat; w.location.lon = p.lon; body.querySelector("#pinInfo").textContent = `📍 ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`; persist(); } });
    body.querySelector("#hName").onchange = (e) => (w.name = e.target.value.trim() || w.name);
    body.querySelector("#tz").onchange = (e) => { try { new Intl.DateTimeFormat("en", { timeZone: e.target.value }); w.location.timezone = e.target.value; } catch { ctx.toast(L("Fuso horário inválido", "Invalid time zone")); } };
    const search = async () => {
      const q = body.querySelector("#q").value.trim(); if (!q) return;
      try {
        const res = await geocode(q);
        body.querySelector("#qRes").innerHTML = res.map((r, k) => `<button class="card" data-k="${k}"><div class="bd"><small>${esc(r.name)}</small></div></button>`).join("") || `<div class="note">${L("Sem resultados", "No results")}</div>`;
        body.querySelectorAll("#qRes .card").forEach((c) => (c.onclick = () => { const r = res[+c.dataset.k]; m.setView(r.lat, r.lon, 18); }));
      } catch (e) { ctx.toast(e.message); }
    };
    body.querySelector("#qGo").onclick = search;
    body.querySelector("#q").onkeydown = (e) => e.key === "Enter" && search();
  }

  // ---------------------------------------------------------------- 4. floor plans
  function stepPlans() {
    const hasKey = cfg.mode === "demo" ? !!sessionStorage.getItem("ht_or_key") : !!cfg.secrets?.OPENROUTER_API_KEY;
    body.innerHTML = `<p class="lead">${L("Carregue a planta de cada piso, em imagem ou PDF. Acerte a escala com uma medida conhecida; depois a IA desenha as paredes e as divisões, e o editor deixa-o corrigir o que falhar.", "Upload each floor's plan, as an image or PDF. Set the scale with a known distance; then AI draws the walls and rooms, and the editor lets you fix anything it misses.")}</p>
      ${hasKey ? "" : `<div class="note">${L("Sem chave OpenRouter, o rascunho com IA fica desligado. Desenhar à mão funciona sempre, e a casa retangular é um bom ponto de partida.", "Without an OpenRouter key the AI draft is off. Drawing by hand always works, and the rectangle is a good starting point.")}</div>`}
      <div id="floors" class="list" style="margin-top:12px"></div>
      <div class="row"><button class="btn small" style="flex:0" id="addF">＋ ${L("Piso", "Floor")}</button><button class="btn small" style="flex:0" id="rect">${L("Começar com uma casa retangular", "Start from a rectangle")}</button></div>
      <div id="calib"></div>`;
    const list = body.querySelector("#floors");
    const render = () => {
      list.innerHTML = w.floors.map((f) => `<div class="card g-floor">
        <div class="ic">${f.plan && temp.planUrls[f.id] ? `<img src="${esc(temp.planUrls[f.id])}" alt="">` : "▦"}</div>
        <div class="bd"><b>${esc(f.name)}</b><small>${f.walls.length ? `${n(f.walls.length, L("parede", "wall"), L("paredes", "walls"))}, ${n(f.rooms.length, L("divisão", "room"), L("divisões", "rooms"))}` : L("Ainda sem paredes", "No walls yet")}${f.plan ? `, ${L("escala", "scale")} ${(f.plan.m_per_px * 100).toFixed(2)} cm/px` : ""}</small>
        <div class="row">
          <label class="btn small" style="flex:0;cursor:pointer">${f.plan ? L("Trocar planta do piso", "Replace floor plan") : L("Carregar planta do piso", "Upload floor plan")}<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" data-up="${esc(f.id)}" hidden></label>
          ${f.plan ? `<button class="btn small" style="flex:0" data-cal="${esc(f.id)}">${L("Escala", "Scale")}</button>` : ""}
          ${f.plan ? `<button class="btn small primary" style="flex:0" data-ai="${esc(f.id)}" ${hasKey ? "" : "disabled"}>${L("Rascunho com IA", "AI draft")}</button>` : ""}
          <button class="btn small" style="flex:0" data-ed="${esc(f.id)}">${L("Desenhar à mão", "Draw by hand")}</button>
          ${w.floors.length > 1 ? `<button class="btn small" style="flex:0" data-del="${esc(f.id)}" aria-label="${L("Apagar piso", "Delete floor")}">✕</button>` : ""}
        </div></div></div>`).join("");
      list.querySelectorAll("[data-up]").forEach((x) => (x.onchange = async () => {
        const file = x.files[0]; if (!file) return;
        const f = w.floors.find((q) => q.id === x.dataset.up);
        let img;
        try { img = await cleanImage(file, cfg.mode === "demo" ? 1600 : 3000, "image/jpeg", { pickPage: (n) => +prompt(L(`O PDF tem ${n} páginas. Em qual está a planta do piso?`, `The PDF has ${n} pages. Which one has the floor plan?`), "1") }); } catch (err) { return ctx.toast(L("Não foi possível ler o ficheiro: ", "Could not read the file: ") + err.message); }
        const id = `plan-${f.id}`;
        const stored = await api.putAsset(id, img.dataUrl, img.mime);
        w.assets = w.assets.filter((a) => a.id !== id);
        w.assets.push({ id, kind: "plan", mime: img.mime, ...(stored.path ? { path: stored.path } : {}) });
        const sc = img.pdf ? pdfScale(img) : null;
        f.plan = { asset: id, origin: [0, 0], m_per_px: sc || f.plan?.m_per_px || 0.02, opacity: 0.6, width_px: img.width, height_px: img.height };
        temp.planUrls[f.id] = img.dataUrl;
        render(); if (!sc) calibrate(f);
      }));
      list.querySelectorAll("[data-cal]").forEach((b) => (b.onclick = () => calibrate(w.floors.find((f) => f.id === b.dataset.cal))));
      list.querySelectorAll("[data-ai]").forEach((b) => (b.onclick = () => aiDraft(w.floors.find((f) => f.id === b.dataset.ai), b)));
      list.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => handEdit(b.dataset.ed)));
      list.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { w.floors = w.floors.filter((f) => f.id !== b.dataset.del); w.roofs = w.roofs.filter((r) => r.floor !== b.dataset.del); restack(); render(); refresh("walls"); }));
    };
    body.querySelector("#addF").onclick = () => { const top = w.floors.at(-1); w.floors.push({ id: uid("f"), name: L(`Piso ${w.floors.length}`, `Floor ${w.floors.length}`), elevation: r2(top.elevation + top.height + (top.slab ?? 0.2)), height: 2.6, slab: 0.2, outline: [], walls: [], rooms: [], openings: [], plan: null, model: null }); render(); };
    body.querySelector("#rect").onclick = () => {
      const W = parseFloat(String(prompt(L("Largura (m)", "Width (m)"), "10")).replace(",", ".")), D = parseFloat(String(prompt(L("Profundidade (m)", "Depth (m)"), "8")).replace(",", "."));
      if (!(W > 2 && D > 2)) return;
      const f = w.floors[0];
      Object.assign(f, rectangleFloor(W, D));
      f.rooms[0].name = L("Sala", "Living room");
      render(); refresh("walls");
    };
    const calibrate = (f) => {
      const box = body.querySelector("#calib");
      root.classList.add("has-tool");
      tool.innerHTML = `<div class="stage"><img id="cImg" src="${esc(temp.planUrls[f.id])}" alt=""><svg id="cSvg"></svg></div>`;
      box.innerHTML = `<h2>${L("Escala", "Scale")}: ${esc(f.name)}</h2><p>${L("Toque em dois pontos com uma distância conhecida (uma cota da planta do piso, por exemplo) e escreva a distância real.", "Tap two points with a known distance (a dimension line, for example) and type the real distance.")}</p>
        <div class="row"><input id="cDist" type="number" step="0.01" placeholder="${L("metros", "metres")}" style="max-width:140px"><button class="btn small primary" style="flex:0" id="cOk">${L("Aplicar escala", "Apply scale")}</button><span class="meta" id="cInfo"></span></div>`;
      const img = tool.querySelector("#cImg"), svgEl = tool.querySelector("#cSvg"), stage = tool.querySelector(".stage");
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
        if (pts.length !== 2 || !(d > 0)) return ctx.toast(L("Marque dois pontos e escreva a distância", "Mark two points and type the distance"));
        f.plan.m_per_px = d / Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
        box.innerHTML = ""; tool.innerHTML = ""; root.classList.remove("has-tool"); render();
        ctx.toast(L("Escala aplicada", "Scale applied"));
      };
      box.scrollIntoView({ block: "nearest" });
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
        ctx.toast(L(`Rascunho: ${g.walls.length} paredes e ${g.rooms.length} divisões. Reveja-o no editor.`, `Draft: ${g.walls.length} walls and ${g.rooms.length} rooms. Review it in the editor.`), 4000);
        render(); refresh("walls");
        handEdit(f.id);
      } catch (e) { ctx.toast(`IA: ${e.message}`, 5000); render(); }
    };
    render();
  }
  const restack = () => { let e = w.floors[0].elevation; for (const f of w.floors) { f.elevation = r2(e); e += f.height + (f.slab ?? 0.2); } };

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
    persist();
    root.style.display = "none";
    const ed = openEditor(ctx, { profile: w, floorId, onSave: (out) => { w = out; for (const f of w.floors) if (f.plan) delete f.plan._url; persist(); }, onClose: () => { root.style.display = ""; go(i); refresh("walls"); } });
    document.querySelector(".ed").style.zIndex = 25;
    return ed;
  }

  // ---------------------------------------------------------------- 5. floors and rooms
  function stepRooms() {
    const TYPES = [["living", L("Sala", "Living")], ["kitchen", L("Cozinha", "Kitchen")], ["bedroom", L("Quarto", "Bedroom")], ["bathroom", L("Casa de banho", "Bathroom")], ["office", L("Escritório", "Office")], ["hall", L("Entrada ou corredor", "Hall")], ["stairs", L("Escadas", "Stairs")], ["garage", L("Garagem", "Garage")], ["outdoor", L("Exterior", "Outdoor")], ["other", L("Outra", "Other")]];
    body.innerHTML = `<p class="lead">${L("Dê nome às divisões e confirme o pé-direito de cada piso. Os nomes aparecem no 3D e nos detalhes (por exemplo, nas horas de sol por divisão).", "Name the rooms and check each floor's ceiling height. The names show in 3D and in the details (sun hours per room, for example).")}</p>
      ${w.floors.map((f) => `<section class="g-sect">
        <div class="row" style="margin:0"><input value="${esc(f.name)}" data-name="${esc(f.id)}" aria-label="${L("Nome do piso", "Floor name")}" style="flex:1;font-weight:600">
          <label class="g-inline">${L("Pé-direito", "Height")} <input type="number" step="0.05" min="2" max="6" value="${f.height}" data-h="${esc(f.id)}"> m</label></div>
        ${f.rooms.length ? `<div class="list g-rooms">${f.rooms.map((r) => `<div class="g-room"><input value="${esc(r.name)}" data-room="${esc(f.id)}|${esc(r.id)}" aria-label="${L("Nome da divisão", "Room name")}"><select data-type="${esc(f.id)}|${esc(r.id)}" aria-label="${L("Tipo", "Type")}">${TYPES.map(([t, n]) => `<option value="${t}" ${r.type === t ? "selected" : ""}>${n}</option>`).join("")}</select></div>`).join("")}</div>`
          : `<p class="meta">${L("Este piso ainda não tem divisões. Desenhe-as no editor.", "This floor has no rooms yet. Draw them in the editor.")}</p>`}
        <button class="btn small" data-ed="${esc(f.id)}">${L("Abrir no editor", "Open in the editor")}</button></section>`).join("")}`;
    const find = (key) => { const [fid, rid] = key.split("|"); const f = w.floors.find((x) => x.id === fid); return { f, r: f?.rooms.find((x) => x.id === rid) }; };
    body.querySelectorAll("[data-name]").forEach((x) => (x.onchange = () => { w.floors.find((f) => f.id === x.dataset.name).name = x.value.trim() || L("Piso", "Floor"); }));
    body.querySelectorAll("[data-h]").forEach((x) => (x.onchange = () => { w.floors.find((f) => f.id === x.dataset.h).height = Math.max(2, Math.min(6, +x.value || 2.7)); restack(); refresh(); }));
    body.querySelectorAll("[data-room]").forEach((x) => (x.onchange = () => { const { r } = find(x.dataset.room); if (r) { r.name = x.value.trim() || r.name; refresh(); } }));
    body.querySelectorAll("[data-type]").forEach((x) => (x.onchange = () => { const { r } = find(x.dataset.type); if (r) { r.type = x.value; if (x.value === "outdoor") r.outdoor = true; else delete r.outdoor; refresh(); } }));
    body.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => handEdit(b.dataset.ed)));
  }

  // ---------------------------------------------------------------- 6. north
  function stepNorth() {
    const arrow = northArrowFromBearing(w.location.bearing_deg);
    body.innerHTML = `<p class="lead">${L("Rode a seta até apontar para o norte na planta da casa. Se a planta da casa tiver uma seta de norte, alinhe-a com ela. É isto que põe o sol e as sombras no sítio certo.", "Turn the arrow until it points north on the floor plan. If the floor plan has a north arrow, match it. This puts the sun and shadows in the right place.")}</p>
      <label class="f" for="nAng">${L("Ângulo da seta", "Arrow angle")}</label><input type="range" min="0" max="359" value="${Math.round(arrow)}" id="nAng">
      <div class="note" id="nInfo"></div>`;
    const f = w.floors[0];
    tool.innerHTML = `<div class="stage" id="nStage">${planSvg(f, temp.planUrls[f.id])}<svg class="compass" viewBox="-50 -50 100 100" id="nComp" role="img" aria-label="${L("Bússola: arraste para rodar", "Compass: drag to turn")}"><circle r="46" fill="none" stroke="rgba(92,225,255,.3)"/><g id="nArr"><path d="M0,-40 L9,6 L0,0 L-9,6 Z" fill="#5ce1ff"/><text y="-28" text-anchor="middle" fill="#05080c" font-size="11" font-weight="700">N</text></g></svg></div>`;
    const stage = tool.querySelector("#nStage");
    const set = (a) => {
      w.location.bearing_deg = Math.round(bearingFromNorthArrow(a) * 10) / 10 % 360;
      stage.querySelector("#nArr").setAttribute("transform", `rotate(${a})`);
      const cards = L(["N", "NE", "E", "SE", "S", "SO", "O", "NO"], ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
      const downAz = (w.location.bearing_deg + 90) % 360;
      body.querySelector("#nInfo").textContent = L(`A parte de baixo da planta da casa está virada a ${cards[Math.round(downAz / 45) % 8]} (${Math.round(downAz)}°).`, `The bottom of the floor plan faces ${cards[Math.round(downAz / 45) % 8]} (${Math.round(downAz)}°).`);
      preview.setBearing(w.location.bearing_deg);
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

  // ---------------------------------------------------------------- 7. aerial
  function stepAerial() {
    const a = w.site.aerial;
    tool.innerHTML = `<div class="stage" id="aStage"></div>`;
    body.innerHTML = `<p class="lead">${L("Opcional. Põe o jardim, a rua e os vizinhos à volta da casa no 3D.", "Optional. Puts the garden, street and neighbours around the house in 3D.")}</p>
      <div class="choice one">
        <label class="opt ${a?.source === "upload" ? "on" : ""}" style="cursor:pointer"><b>${L("Carregar a minha imagem", "Upload my own image")}</b><small>${L("Uma captura de satélite tirada por si, para uso pessoal, com o norte para cima.", "A satellite screenshot you took yourself, for personal use, north up.")}</small><input type="file" id="aFile" accept="image/png,image/jpeg,image/webp" hidden></label>
        <button class="opt ${a?.source === "esri" ? "on" : ""}" id="aEsri"><b>Esri World Imagery</b><small>${L("Mostrada em direto, com atribuição; nunca é guardada.", "Shown live with attribution; never stored.")}</small></button>
        <button class="opt ${!a ? "on" : ""}" id="aNone"><b>${L("Sem imagem", "No image")}</b><small>${L("Relva simples à volta da casa.", "Plain lawn around the house.")}</small></button>
      </div>
      <p class="meta">${L("O Google Maps não é usado: os termos não permitem guardar as imagens de satélite.", "Google Maps is not used: its terms don't allow storing satellite imagery.")}</p>
      <div id="aCtl"></div>`;
    const stage = tool.querySelector("#aStage");
    const draw = () => {
      const cur = w.site.aerial;
      const ctl = body.querySelector("#aCtl");
      body.querySelector("#aFile").parentElement.classList.toggle("on", cur?.source === "upload");
      body.querySelector("#aEsri").classList.toggle("on", cur?.source === "esri");
      body.querySelector("#aNone").classList.toggle("on", !cur);
      refresh();
      if (!cur) { root.classList.remove("has-tool"); stage.innerHTML = ""; ctl.innerHTML = ""; return; }
      root.classList.add("has-tool");
      if (cur.source === "esri") {
        stage.innerHTML = ""; const mp = document.createElement("div"); mp.style.height = "100%"; stage.appendChild(mp);
        createMap(mp, { lat: w.location.lat, lon: w.location.lon, zoom: 19, layer: "esri", pin: { lat: w.location.lat, lon: w.location.lon } });
        ctl.innerHTML = `<p>${L("O marcador deve ficar no centro da casa.", "The pin should be at the centre of the house.")}</p>`;
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
        <label class="f">${L("Deslocar na horizontal (m)", "Shift sideways (m)")}</label><input type="range" min="-30" max="30" step="0.1" value="${r2(c[0] - cx)}" id="aX">
        <label class="f">${L("Deslocar na vertical (m)", "Shift up or down (m)")}</label><input type="range" min="-30" max="30" step="0.1" value="${r2(c[1] - cy)}" id="aY">
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

  // ---------------------------------------------------------------- 8. walls
  function stepWalls() {
    const d = w.display;
    const fmt = (v) => `${(+v).toFixed(2).replace(".", L(",", "."))} m`;
    body.innerHTML = `<p class="lead">${L("Como quer ver as paredes? A meia altura vê para dentro das divisões; por cima fica um vidro leve que mantém a forma da casa. O sol é sempre calculado com as paredes inteiras.", "How should walls look? At half height you see into the rooms; a light glass above keeps the shape of the house. The sun is always worked out with full walls.")}</p>
      <div class="choice">
        <button class="opt ${d.walls !== "full" ? "on" : ""}" data-wm="half" aria-pressed="${d.walls !== "full"}"><b>${L("A meia altura", "Half height")}</b><small>${L("Recomendado. Vê as divisões, as plantas e os dispositivos lá dentro.", "Recommended. You see the rooms, plants and devices inside.")}</small></button>
        <button class="opt ${d.walls === "full" ? "on" : ""}" data-wm="full" aria-pressed="${d.walls === "full"}"><b>${L("Inteiras", "Full height")}</b><small>${L("A casa como é por fora; para ver dentro, escolha um piso.", "The house as it looks outside; pick a floor to look inside.")}</small></button>
      </div>
      <div id="cutRow" class="${d.walls === "full" ? "hidden" : ""}"><label class="f" for="wCut">${L("Altura do corte", "Cut height")}: <b id="wCutV">${fmt(d.wall_cut ?? 1.2)}</b></label><input type="range" id="wCut" min="0.8" max="2" step="0.05" value="${d.wall_cut ?? 1.2}"></div>
      <p class="meta">${L("As paredes com 20 cm de espessura ou mais contam como exteriores. Acerte espessuras, portas e janelas no editor.", "Walls 20 cm or thicker count as exterior. Adjust thickness, doors and windows in the editor.")}</p>
      <button class="btn small" id="wEd">${L("Abrir no editor", "Open in the editor")}</button>`;
    body.querySelectorAll("[data-wm]").forEach((b) => (b.onclick = () => {
      d.walls = b.dataset.wm;
      body.querySelectorAll("[data-wm]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
      body.querySelector("#cutRow").classList.toggle("hidden", d.walls === "full");
      refresh();
    }));
    const cut = body.querySelector("#wCut");
    cut.oninput = () => { d.wall_cut = +cut.value; body.querySelector("#wCutV").textContent = fmt(cut.value); };
    cut.onchange = () => refresh();
    body.querySelector("#wEd").onclick = () => handEdit(w.floors[0].id);
  }

  // ---------------------------------------------------------------- 9. roof + terrain
  function stepRoof() {
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
    const types = [["gable", L("Duas águas", "Gable")], ["hip", L("Quatro águas", "Hip")], ["shed", L("Uma água", "Shed")], ["flat", L("Plano ou terraço", "Flat")]];
    body.innerHTML = `<p class="lead">${L("Escolha a forma do telhado. Conta para as sombras e, se tiver painéis, para a produção solar.", "Pick the roof shape. It matters for shadows and, if you have panels, for solar production.")}</p>
      <div class="choice four">${types.map(([t, n]) => `<button class="opt ${roof?.type === t ? "on" : ""}" data-rt="${t}"><b>${n}</b></button>`).join("")}</div>
      <div class="row"><label style="flex:1">${L("Inclinação (°)", "Pitch (°)")}<input type="number" id="rP" min="5" max="60" value="${roof?.pitch_deg || 30}"></label>
        <label style="flex:1">${L("Beiral (m)", "Overhang (m)")}<input type="number" id="rO" step="0.05" min="0" max="1.5" value="${roof?.overhang ?? 0.4}"></label>
        <label style="flex:1">${L("Cumeeira", "Ridge")}<select id="rR"><option value="x">${L("Ao comprido", "Lengthwise")}</option><option value="y" ${roof?.ridge === "y" ? "selected" : ""}>${L("Na transversal", "Crosswise")}</option></select></label></div>
      <p class="meta">${L("Telhados mais complexos (vários volumes, mansardas) acertam-se depois no editor, piso a piso.", "More complex roofs (several volumes, dormers) can be refined later in the editor, floor by floor.")}</p>
      <h2>${L("Terreno", "Terrain")}</h2>
      <div class="row"><label style="flex:1">${L("Tipo", "Type")}<select id="tT"><option value="flat">${L("Plano", "Flat")}</option><option value="slope" ${w.site.terrain.type === "slope" ? "selected" : ""}>${L("Inclinado", "Sloped")}</option></select></label>
        <label style="flex:1">${L("Declive (%)", "Grade (%)")}<input type="number" id="tG" min="0" max="60" value="${w.site.terrain.grade_pct || 0}"></label>
        <label style="flex:1">${L("Desce para (°)", "Falls toward (°)")}<input type="number" id="tD" min="0" max="359" value="${w.site.terrain.direction_deg || 180}"></label></div>`;
    const ensure = () => {
      if (!top.outline?.length) top.outline = outlineOf(top);
      if (!roof) { roof = { id: uid("roof"), floor: top.id, type: "gable", pitch_deg: 30, overhang: 0.4, ridge: "x", outline: bbox4(top.outline) }; w.roofs.push(roof); }
    };
    const all = (k, v) => { ensure(); for (const r of topRoofs()) r[k] = v; refresh("roof"); };
    body.querySelectorAll("[data-rt]").forEach((b) => (b.onclick = () => { all("type", b.dataset.rt); body.querySelectorAll("[data-rt]").forEach((x) => x.classList.toggle("on", x === b)); }));
    body.querySelector("#rP").onchange = (e) => all("pitch_deg", Math.max(5, Math.min(60, +e.target.value)));
    body.querySelector("#rO").onchange = (e) => all("overhang", Math.max(0, +e.target.value));
    body.querySelector("#rR").onchange = (e) => { ensure(); roof.ridge = e.target.value; refresh("roof"); };
    body.querySelector("#tT").onchange = (e) => { w.site.terrain.type = e.target.value; refresh(); };
    body.querySelector("#tG").onchange = (e) => { w.site.terrain.grade_pct = Math.max(0, Math.min(60, +e.target.value)); refresh(); };
    body.querySelector("#tD").onchange = (e) => { w.site.terrain.direction_deg = ((+e.target.value % 360) + 360) % 360; refresh(); };
  }
  const bbox4 = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; };
  const outlineOf = (f) => { try { const o = computeOutline(f); if (o?.length >= 3) return o; } catch {} return bbox4(f.walls.flatMap((x) => [x.a, x.b]).concat(f.rooms.flatMap((r) => r.polygon))); };

  // ---------------------------------------------------------------- 10-14. layers, one per step
  const DEFAULTS = { plants: { items: [] }, wifi: { aps: [], survey: [] }, homeassistant: { entities: [] }, solar: { arrays: [] }, cameras: { items: [] } };
  function setModule(id, on) { w.modules[id] = { ...DEFAULTS[id], ...(w.modules[id] || {}), enabled: on }; }

  function stepLayer(id) {
    const haReady = cfg.mode !== "demo" && !!(cfg.secrets?.HA_BASE_URL && cfg.secrets?.HA_TOKEN);
    const orReady = cfg.mode === "demo" ? !!sessionStorage.getItem("ht_or_key") : !!cfg.secrets?.OPENROUTER_API_KEY;
    const C = {
      plants: {
        lead: L("Marque onde vive cada planta. A app diz quando regar e se a planta tem a luz certa, a partir das horas de sol de cada sítio.", "Mark where each plant lives. The app tells you when to water and whether it gets the right light, from the sun hours at each spot."),
        needs: orReady ? L("Nada. Com a chave OpenRouter também identifica plantas por fotografia.", "Nothing. With your OpenRouter key it also identifies plants from photos.") : L("Nada. Com uma chave OpenRouter (passo Chaves) também identifica plantas por fotografia.", "Nothing. With an OpenRouter key (Keys step) it also identifies plants from photos."),
        after: L("Depois de guardar: Detalhes, Plantas, Adicionar, e toque no sítio da planta.", "After saving: Details, Plants, Add, then tap where the plant is."),
      },
      wifi: {
        lead: L("Veja onde o sinal é fraco. Coloque os pontos de acesso e a app prevê o sinal em cada divisão; com algumas medições, a previsão fica calibrada.", "See where the signal is weak. Place your access points and the app predicts the signal in each room; a few measurements calibrate it."),
        needs: L("Saber onde estão o router e os repetidores. As medições são opcionais (chega uma app de Wi-Fi no telemóvel).", "Knowing where the router and extenders are. Measurements are optional (any Wi-Fi app on your phone will do)."),
        after: L("Depois de guardar: ligue Wi-Fi em Mostrar, abra Detalhes e adicione os pontos de acesso.", "After saving: turn on Wi-Fi under Show, open Details and add your access points."),
      },
      homeassistant: {
        lead: L("Luzes, sensores, portões e automações no sítio certo da casa, com o estado em direto.", "Lights, sensors, gates and automations in the right place in the house, with live state."),
        needs: haReady ? L("Já está: o endereço e o token do Home Assistant estão definidos.", "All set: the Home Assistant address and token are in place.") : L("O endereço e um token do Home Assistant (passo Chaves). Pode ligar a camada já e tratar das chaves depois.", "The Home Assistant address and a token (Keys step). You can turn the layer on now and add the keys later."),
        after: L("Depois de guardar: Detalhes, Dispositivos, escolha um dispositivo e toque onde ele está.", "After saving: Details, Devices, pick a device and tap where it is."),
      },
      solar: {
        lead: L("Mostra os painéis no telhado e estima quanto produzem em cada dia, com céu limpo.", "Shows the panels on the roof and estimates what they make each day, under clear skies."),
        needs: L("A potência de pico (kWp, vem na fatura ou no inversor) e quantos painéis tem.", "The peak power (kWp, on your bill or inverter) and how many panels you have."),
        after: L("Pode mudar os painéis para outra água do telhado no editor.", "You can move the panels to another roof face in the editor."),
      },
      cameras: {
        lead: L("Cones que mostram o que cada câmara vê, para encontrar ângulos mortos.", "Cones that show what each camera sees, to find blind spots."),
        needs: L("Nada para os cones. A imagem em direto vem do Home Assistant.", "Nothing for the cones. The live image comes from Home Assistant."),
        after: L("Depois de guardar: no editor, ferramenta Câmara, toque onde ela está e rode o cone.", "After saving: in the editor, Camera tool, tap where it is and turn the cone."),
      },
    }[id];
    const on = !!w.modules[id]?.enabled;
    body.innerHTML = `<p class="lead">${C.lead}</p>
      <div class="choice">
        <button class="opt ${on ? "on" : ""}" data-m="${id}" data-v="1" aria-pressed="${on}"><b>${L("Ligar esta camada", "Turn this layer on")}</b><small>${L("Aparece em Mostrar e nos Detalhes.", "It shows under Show and in Details.")}</small></button>
        <button class="opt ${!on ? "on" : ""}" data-m="${id}" data-v="0" aria-pressed="${!on}"><b>${L("Agora não", "Not now")}</b><small>${L("Pode ligá-la mais tarde, neste guia.", "You can turn it on later, in this guide.")}</small></button>
      </div>
      <dl class="g-facts"><dt>${L("Precisa de", "What it needs")}</dt><dd>${C.needs}</dd><dt>${L("A seguir", "Next")}</dt><dd>${C.after}</dd></dl>
      <div id="solarCfg"></div>`;
    const solarCfg = () => {
      const el = body.querySelector("#solarCfg");
      if (id !== "solar" || !w.modules.solar?.enabled) return (el.innerHTML = "");
      if (!w.modules.solar.arrays?.length) w.modules.solar.arrays = [{ id: "pv1", label: L("Painéis", "Panels"), roof: w.roofs[0]?.id, face: "+y", kwp: 3, panels: 8, loss_pct: 14 }];
      const arr = w.modules.solar.arrays[0];
      if (!arr.roof) arr.roof = w.roofs[0]?.id;
      el.innerHTML = `<div class="row">
        <label style="flex:1">kWp<input type="number" step="0.1" min="0.2" max="50" id="sK" value="${arr.kwp}"></label>
        <label style="flex:1">${L("Painéis", "Panels")}<input type="number" min="1" max="80" id="sN" value="${arr.panels}"></label>
        <label style="flex:1">${L("Água virada para", "Roof face toward")}<select id="sF" title="${L("Em relação à planta da casa", "Relative to the floor plan")}">${[["+y", L("Baixo", "Bottom")], ["-y", L("Cima", "Top")], ["+x", L("Direita", "Right")], ["-x", L("Esquerda", "Left")]].map(([f, n]) => `<option value="${f}" ${arr.face === f ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>`;
      el.querySelector("#sK").onchange = (e) => (arr.kwp = +e.target.value);
      el.querySelector("#sN").onchange = (e) => { arr.panels = +e.target.value; refresh(); };
      el.querySelector("#sF").onchange = (e) => { arr.face = e.target.value; refresh(); };
    };
    body.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => {
      setModule(id, b.dataset.v === "1");
      body.querySelectorAll("[data-m]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
      solarCfg(); refresh("layer");
    }));
    solarCfg();
  }

  // ---------------------------------------------------------------- 15. review
  function stepReview() {
    for (const f of w.floors) if (f.walls.length && (!f.outline || f.outline.length < 3)) f.outline = outlineOf(f);
    const v = validate(w);
    const label = (s) => ({ done: L("feito", "done"), later: L("mais tarde", "later"), off: L("desligada", "off") })[status[s.id]] || L("por fazer", "to do");
    body.innerHTML = `<p class="lead">${L("Está quase. Confirme o resumo e guarde. Pode voltar a qualquer passo no menu ⋯, em Configurar a minha casa.", "Almost there. Check the summary and save. You can return to any step from the ⋯ menu, under Set up my house.")}</p>
      <div class="ring-row"><div class="mini"><b>${w.floors.length}</b><span>${L("pisos", "floors")}</span></div><div class="mini"><b>${w.floors.reduce((a, f) => a + f.rooms.length, 0)}</b><span>${L("divisões", "rooms")}</span></div><div class="mini"><b>${1 + Object.values(w.modules).filter((m) => m.enabled).length}</b><span>${L("camadas", "layers")}</span></div></div>
      <div class="list g-sum">${STEPS.slice(0, -1).map((s, k) => `<button class="g-sumrow ${status[s.id] || ""}" data-go="${k}"><span>${esc(s.title)}</span><span class="g-tag">${label(s)}</span></button>`).join("")}</div>
      ${v.ok ? `<div class="note">✓ ${cfg.mode === "demo" ? L("Na demonstração fica guardado só neste browser.", "On the demo it is saved in this browser only.") : L("Fica guardado no armazenamento desta instalação.", "It is saved in this installation's storage.")}</div>` : `<div class="note warn">${v.errors.slice(0, 8).map(esc).join("<br>")}</div>`}`;
    body.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(+b.dataset.go)));
  }

  async function save() {
    for (const f of w.floors) if (f.walls.length && (!f.outline || f.outline.length < 3)) f.outline = outlineOf(f);
    const v = validate(w);
    if (!v.ok) return msg(v.errors[0]);
    $("#wzNext").disabled = true;
    try {
      ctx.state.floor = null;
      if (!ctx.state.date) {
        const { todayIn } = await import("../engine/sun.js");
        ctx.state.date = todayIn(w.location.timezone); ctx.state.minutes = 720;
        document.querySelector("#dateIn").value = ctx.state.date; document.querySelector("#timeIn").value = 720;
      }
      ctx.state.module = "sun";
      const later = STEPS.filter((s) => status[s.id] === "later").map((s) => s.title);
      await ctx.saveProfile(structuredClone(w));
      localStorage.removeItem(KEY);
      close();
      window.__appReady = true;
      finale(ctx, { later });
    } catch (e) { msg(e.message); $("#wzNext").disabled = false; }
  }

  go(i);
  if (resumed) ctx.toast(L(`Retomou onde tinha ficado: ${STEPS[i].title}.`, `Picked up where you left off: ${STEPS[i].title}.`), 3200);
  return { root };
}

/** "Your house is ready": the camera settles on the house and the layers light up one after another. */
export async function finale(ctx, { later = [] } = {}) {
  const v = ctx.viewer, still = reduced();
  const want = [...ctx.state.layers];
  const el = document.createElement("div");
  el.className = "g-ready glass";
  el.setAttribute("role", "status");
  el.innerHTML = `<h2>${L("A sua casa está pronta", "Your house is ready")}</h2>
    <p>${L("As camadas ligadas estão em Mostrar. Abra Detalhes para ver, por exemplo, as horas de sol de cada divisão.", "Your layers are under Show. Open Details to see, for example, the sun hours in each room.")}</p>
    ${later.length ? `<p class="meta">${L("Ficou para mais tarde:", "Left for later:")} ${later.map((x) => ctx.esc(x)).join(", ")}. ${L("Encontra tudo no menu ⋯, em Configurar a minha casa.", "Find it all in the ⋯ menu, under Set up my house.")}</p>` : ""}
    <div class="row"><button class="btn primary" id="rdGo">${L("Explorar a casa", "Explore the house")}</button><button class="btn" id="rdDet">${L("Abrir detalhes", "Open details")}</button></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => (el.dataset.phase = "in")));
  const dismiss = () => { el.dataset.phase = "exit"; setTimeout(() => el.remove(), still ? 0 : 180); };
  el.querySelector("#rdGo").onclick = dismiss;
  el.querySelector("#rdDet").onclick = () => { dismiss(); ctx.openPanel(true); };
  el.querySelector("#rdGo").focus({ preventScroll: true });
  if (still) { el.dataset.ready = "1"; return; }
  // layers light up one after another while the camera settles from a wider, higher view
  for (const id of want) await ctx.setLayer(id, false);
  if (v?.house) {
    const b = v.house.bounds, span = Math.max(b.w, b.h, 8);
    const end = v.camera.position.clone(), from = end.clone().add({ x: span * 0.6, y: span * 0.7, z: span * 0.2 });
    v.animate(1800, (k) => v.camera.position.lerpVectors(from, end, k), (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2));
  }
  for (const id of want) { await new Promise((r) => setTimeout(r, 220)); await ctx.setLayer(id, true); }
  el.dataset.ready = "1";
}
