// Simple Home Assistant automations: a small, safe subset that the app can create and edit.
// spec = { id, alias, trigger, actions: [{ entity_id, service }] }
//   trigger: { type: "time", at: "07:30" } | { type: "sun", event: "sunset" | "sunrise", offset_min: -15 }
//          | { type: "state", entity_id: "binary_sensor.door", to: "on" }
// Anything else made in Home Assistant itself is listed (and can be switched on/off or run) but not edited here.

export const ACTIONS = {
  light: ["turn_on", "turn_off", "toggle"],
  switch: ["turn_on", "turn_off", "toggle"],
  fan: ["turn_on", "turn_off", "toggle"],
  cover: ["open_cover", "close_cover"],
  scene: ["turn_on"],
  script: ["turn_on"],
  media_player: ["turn_on", "turn_off", "media_pause"],
  climate: ["turn_on", "turn_off"],
};
const ENT = /^[a-z_]+\.[\w-]{1,80}$/;
const dom = (e) => e.split(".")[0];

export function validSpec(s) {
  const e = [];
  if (!s || typeof s !== "object") return ["not an object"];
  if (typeof s.id !== "string" || !/^[\w-]{3,64}$/.test(s.id)) e.push("id");
  if (typeof s.alias !== "string" || !s.alias.trim() || s.alias.length > 80) e.push("alias");
  const t = s.trigger || {};
  if (t.type === "time") { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.at || "")) e.push("trigger.at"); }
  else if (t.type === "sun") { if (!["sunset", "sunrise"].includes(t.event) || !(Number.isInteger(t.offset_min ?? 0) && Math.abs(t.offset_min ?? 0) <= 180)) e.push("trigger.sun"); }
  else if (t.type === "state") { if (!ENT.test(t.entity_id || "") || typeof t.to !== "string" || t.to.length > 40) e.push("trigger.state"); }
  else e.push("trigger.type");
  if (!Array.isArray(s.actions) || !s.actions.length || s.actions.length > 10) e.push("actions");
  else s.actions.forEach((a, i) => { if (!ENT.test(a?.entity_id || "") || !(ACTIONS[dom(a.entity_id)] || []).includes(a.service)) e.push(`actions[${i}]`); });
  return e;
}

const pad = (n) => String(n).padStart(2, "0");
function offset(min) { const s = min < 0 ? "-" : ""; const m = Math.abs(min); return `${s}${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`; }

/** Spec -> Home Assistant automation config (classic syntax, accepted by old and new HA versions). */
export function toHA(s) {
  const t = s.trigger;
  const trigger = t.type === "time" ? { platform: "time", at: `${t.at}:00` }
    : t.type === "sun" ? { platform: "sun", event: t.event, ...(t.offset_min ? { offset: offset(t.offset_min) } : {}) }
    : { platform: "state", entity_id: t.entity_id, to: t.to };
  return {
    id: s.id, alias: s.alias.trim(), description: "Made with house-twin", mode: "single",
    trigger: [trigger], condition: [],
    action: s.actions.map((a) => ({ service: `${dom(a.entity_id)}.${a.service}`, target: { entity_id: a.entity_id } })),
  };
}

/** Home Assistant config -> spec, or null when it uses anything beyond the simple subset. */
export function fromHA(c) {
  if (!c || typeof c !== "object") return null;
  const trig = [].concat(c.triggers || c.trigger || []), acts = [].concat(c.actions || c.action || []);
  if (trig.length !== 1 || !acts.length || [].concat(c.conditions || c.condition || []).length) return null;
  const t = trig[0], kind = t.platform || t.trigger;
  let trigger;
  if (kind === "time" && typeof t.at === "string") trigger = { type: "time", at: t.at.slice(0, 5) };
  else if (kind === "sun") {
    let off = 0;
    if (typeof t.offset === "string") { const m = t.offset.match(/^(-)?(\d{1,2}):(\d{2})(?::\d{2})?$/); if (!m) return null; off = (m[1] ? -1 : 1) * (+m[2] * 60 + +m[3]); }
    trigger = { type: "sun", event: t.event, offset_min: off };
  } else if (kind === "state" && typeof t.entity_id === "string" && typeof t.to === "string") trigger = { type: "state", entity_id: t.entity_id, to: t.to };
  else return null;
  const actions = [];
  for (const a of acts) {
    const svc = a.service || a.action, ent = a.target?.entity_id ?? a.entity_id;
    if (typeof svc !== "string" || typeof ent !== "string") return null;
    const [d, s] = svc.split(".");
    if (dom(ent) !== d) return null;
    actions.push({ entity_id: ent, service: s });
  }
  const spec = { id: String(c.id || ""), alias: String(c.alias || ""), trigger, actions };
  return validSpec(spec).length ? null : spec;
}

/** One-line description for lists. */
export function describe(s, pt = true, names = {}) {
  const n = (e) => names[e] || e;
  const t = s.trigger;
  const when = t.type === "time" ? (pt ? `Às ${t.at}` : `At ${t.at}`)
    : t.type === "sun" ? `${t.offset_min ? `${Math.abs(t.offset_min)} min ${t.offset_min < 0 ? (pt ? "antes do" : "before") : (pt ? "depois do" : "after")} ` : (pt ? "Ao " : "At ")}${t.event === "sunset" ? (pt ? "pôr do sol" : "sunset") : (pt ? "nascer do sol" : "sunrise")}`
    : (pt ? `Quando ${n(t.entity_id)} fica "${t.to}"` : `When ${n(t.entity_id)} becomes "${t.to}"`);
  const V = pt ? { turn_on: "ligar", turn_off: "desligar", toggle: "alternar", open_cover: "abrir", close_cover: "fechar", media_pause: "pausar" } : { turn_on: "turn on", turn_off: "turn off", toggle: "toggle", open_cover: "open", close_cover: "close", media_pause: "pause" };
  return `${when}: ${s.actions.map((a) => `${V[a.service] || a.service} ${n(a.entity_id)}`).join(", ")}`;
}
