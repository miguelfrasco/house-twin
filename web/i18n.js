// UI strings. English and European Portuguese (pt-PT).
const S = {
  en: {
    app: "House twin", demo: "Demo house", demo_note: "Fictional demo house. Nothing here is a real place.",
    sun: "Sun", plants: "Plants", wifi: "Wi-Fi", homeassistant: "Home", solar: "Solar", cameras: "Cameras", furniture: "Furniture",
    all_floors: "All", roof: "Roof", edit: "Edit", setup: "Set up my house", export: "Export", login: "Sign in", logout: "Sign out",
    password: "Password", loading: "Loading the house…", today: "Today", now: "Now",
    sun_hours: "h of direct sun", direct_sun_day: "Direct sun on this day", computing: "Calculating sun exposure…",
    rooms_by_sun: "Rooms by direct sun", no_location: "Set a location to calculate the sun.",
    sunrise: "Sunrise", sunset: "Sunset", day_length: "Day length", elevation: "Sun height",
    plants_due: "need water", plants_all: "plants", water: "Water", watered: "Watered", next_water: "Water in", days: "days", overdue: "overdue",
    light_low: "Low light", light_medium: "Medium light", light_high: "Bright light",
    light_ok: "Light is right", light_more: "Wants more sun", light_less: "Too much sun",
    best_spot: "Best spots for it", add_plant: "Add plant", click_to_place: "Click on the house to place it",
    wifi_signal: "Predicted signal", wifi_aps: "Access points", wifi_survey: "Measured points", wifi_weak: "Weak spots",
    ha_devices: "Devices", ha_demo: "Demo states (no Home Assistant connected)", ha_not_conn: "Home Assistant is not connected. Add HA_BASE_URL and HA_TOKEN as secrets.",
    turn_on: "Turn on", turn_off: "Turn off",
    solar_today: "Clear-sky estimate for this day", solar_year: "Estimated per year", kwp: "kWp", panels: "panels", tilt: "Tilt", facing: "Facing",
    cameras_cov: "Coverage", cameras_note: "Cones show what each camera sees. Live images need Home Assistant.",
    save: "Save", cancel: "Cancel", close: "Close", next: "Next", back: "Back", done: "Done", undo: "Undo", redo: "Redo", delete: "Delete",
    saved: "Saved", demo_saved_local: "Saved in this browser only (demo)",
    privacy: "Privacy", privacy_line: "No telemetry. Your profile stays in your own storage.",
    export_scrubbed: "Download a shareable copy (no location, names, networks or photos)",
    export_full: "Download a full private backup",
    north: "N",
    show: "Show", details: "Details", homeassistant_layer: "Devices", no_layers: "Turn on a layer under Show to see its details here.",
    walls_half: "Half-height walls", walls_full: "Full-height walls", layer_off: "Hidden", furniture_tool: "Arrange furniture",
  },
  "pt-PT": {
    app: "Gémeo da casa", demo: "Casa de demonstração", demo_note: "Casa fictícia de demonstração. Nada aqui é um sítio real.",
    sun: "Sol", plants: "Plantas", wifi: "Wi-Fi", homeassistant: "Casa", solar: "Solar", cameras: "Câmaras", furniture: "Mobília",
    all_floors: "Todos", roof: "Telhado", edit: "Editar", setup: "Configurar a minha casa", export: "Exportar", login: "Entrar", logout: "Sair",
    password: "Palavra-passe", loading: "A carregar a casa…", today: "Hoje", now: "Agora",
    sun_hours: "h de sol direto", direct_sun_day: "Sol direto neste dia", computing: "A calcular a exposição solar…",
    rooms_by_sun: "Divisões por sol direto", no_location: "Defina uma localização para calcular o sol.",
    sunrise: "Nascer do sol", sunset: "Pôr do sol", day_length: "Duração do dia", elevation: "Altura do sol",
    plants_due: "precisam de água", plants_all: "plantas", water: "Regar", watered: "Regada", next_water: "Regar daqui a", days: "dias", overdue: "em atraso",
    light_low: "Pouca luz", light_medium: "Luz média", light_high: "Muita luz",
    light_ok: "Luz adequada", light_more: "Quer mais sol", light_less: "Sol a mais",
    best_spot: "Melhores sítios para ela", add_plant: "Adicionar planta", click_to_place: "Toque na casa para a colocar",
    wifi_signal: "Sinal previsto", wifi_aps: "Pontos de acesso", wifi_survey: "Pontos medidos", wifi_weak: "Zonas fracas",
    ha_devices: "Dispositivos", ha_demo: "Estados de demonstração (sem Home Assistant ligado)", ha_not_conn: "O Home Assistant não está ligado. Adicione HA_BASE_URL e HA_TOKEN como segredos.",
    turn_on: "Ligar", turn_off: "Desligar",
    solar_today: "Estimativa com céu limpo para este dia", solar_year: "Estimativa por ano", kwp: "kWp", panels: "painéis", tilt: "Inclinação", facing: "Orientação",
    cameras_cov: "Cobertura", cameras_note: "Os cones mostram o que cada câmara vê. As imagens em direto precisam do Home Assistant.",
    save: "Guardar", cancel: "Cancelar", close: "Fechar", next: "Seguinte", back: "Anterior", done: "Concluir", undo: "Anular", redo: "Refazer", delete: "Eliminar",
    saved: "Guardado", demo_saved_local: "Guardado só neste browser (demonstração)",
    privacy: "Privacidade", privacy_line: "Sem telemetria. O seu perfil fica no seu próprio armazenamento.",
    export_scrubbed: "Transferir uma cópia partilhável (sem localização, nomes, redes ou fotografias)",
    export_full: "Transferir uma cópia de segurança privada completa",
    north: "N",
    show: "Mostrar", details: "Detalhes", homeassistant_layer: "Dispositivos", no_layers: "Ligue uma camada em Mostrar para ver aqui os detalhes.",
    walls_half: "Paredes a meia altura", walls_full: "Paredes inteiras", layer_off: "Oculta", furniture_tool: "Arrumar a mobília",
  },
};

let lang = localStorage.getItem("ht_lang") || (navigator.language?.toLowerCase().startsWith("pt") ? "pt-PT" : "en");
export const getLang = () => lang;
export function setLang(l) { lang = S[l] ? l : "en"; localStorage.setItem("ht_lang", lang); document.documentElement.lang = lang; }
export function t(key, extra) { const v = (S[lang] && S[lang][key]) ?? S.en[key] ?? key; return extra ? v.replace(/\{(\w+)\}/g, (_, k) => extra[k]) : v; }
/** Register extra strings (used by modules and the wizard). */
export function addStrings(dict) { for (const l of Object.keys(dict)) S[l] = { ...(S[l] || {}), ...dict[l] }; }
export const fmtNum = (n, d = 1) => new Intl.NumberFormat(lang === "pt-PT" ? "pt-PT" : "en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
setLang(lang);
