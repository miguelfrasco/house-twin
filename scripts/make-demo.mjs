// Generates web/demo/profile.json: a fictional two-storey house drawn from scratch.
// Nothing here is derived from a real home. Run: node scripts/make-demo.mjs
import { writeFileSync } from "node:fs";
import { validate, SCHEMA_ID, SCHEMA_VERSION } from "../web/profile/profile.js";

const W = (id, a, b, thickness = 0.3, extra = {}) => ({ id, a, b, thickness, ...extra });
const I = (id, a, b) => W(id, a, b, 0.12);
const O = (id, wall, type, offset, width, height, sill = 0) => ({ id, wall, type, offset, width, height, sill });
const R = (id, name, type, x0, y0, x1, y1) => ({ id, name, type, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });

const f0 = {
  id: "f0", name: "Piso 0", elevation: 0, height: 2.8, slab: 0.25,
  outline: [[0, 0], [12, 0], [12, 3], [17, 3], [17, 9], [0, 9]],
  walls: [
    W("w1", [0, 0], [12, 0]), W("w2", [12, 0], [12, 3]), W("w3", [12, 3], [17, 3]), W("w4", [17, 3], [17, 9]),
    W("w5a", [17, 9], [12, 9]), W("w5b", [12, 9], [0, 9]), W("w6", [0, 9], [0, 0]),
    I("i1", [12, 3], [12, 9]), I("i2", [0, 3.5], [12, 3.5]), I("i3", [4, 0], [4, 3.5]), I("i4", [8, 0], [8, 3.5]),
    I("i5", [10, 0], [10, 3.5]), I("i6", [7, 3.5], [7, 9]),
  ],
  rooms: [
    R("office", "Escritório", "office", 0, 0, 4, 3.5), R("hall", "Entrada", "hall", 4, 0, 8, 3.5),
    R("wc", "WC", "bathroom", 8, 0, 10, 3.5), R("stairs", "Escadas", "stairs", 10, 0, 12, 3.5),
    R("living", "Sala", "living", 0, 3.5, 7, 9), R("kitchen", "Cozinha", "kitchen", 7, 3.5, 12, 9),
    R("garage", "Garagem", "garage", 12, 3, 17, 9),
  ],
  openings: [
    O("o1", "w1", "window", 1.2, 1.4, 1.2, 0.9), O("o2", "w1", "door", 5.5, 1.0, 2.2), O("o3", "w1", "window", 8.6, 0.6, 0.6, 1.5),
    O("o4", "w2", "window", 0.8, 1.2, 1.2, 1.0), O("o5", "w4", "window", 2.0, 1.2, 0.6, 1.4), O("o6", "w5a", "garage", 0.6, 3.0, 2.3),
    O("o7", "w5b", "window", 1.5, 2.0, 1.3, 0.9), O("o8", "w5b", "door", 6.0, 3.2, 2.3), O("o9", "w5b", "window", 9.5, 1.6, 1.4, 0.6),
    O("o10", "w6", "window", 1.5, 1.5, 1.3, 0.9),
    O("o11", "i2", "door", 2.5, 0.9, 2.1), O("o12", "i2", "opening", 5.0, 1.6, 2.3), O("o13", "i2", "door", 8.5, 0.8, 2.1), O("o14", "i2", "opening", 10.5, 1.0, 2.3),
    O("o15", "i6", "opening", 1.5, 2.6, 2.3), O("o16", "i1", "door", 1.0, 0.9, 2.1),
  ],
  plan: null, model: null,
};

const f1 = {
  id: "f1", name: "Piso 1", elevation: 3.05, height: 2.6, slab: 0.25,
  outline: [[0, 0], [12, 0], [12, 9], [0, 9]],
  walls: [
    W("e1", [0, 0], [12, 0]), W("e2", [12, 0], [12, 9]), W("e3", [12, 9], [0, 9]), W("e4", [0, 9], [0, 0]),
    I("j1", [0, 4.2], [12, 4.2]), I("j2", [4.5, 0], [4.5, 4.2]), I("j3", [8, 0], [8, 3]), I("j4", [4.5, 3], [8, 3]), I("j5", [6, 4.2], [6, 9]),
  ],
  rooms: [
    R("bed1", "Quarto 1", "bedroom", 0, 0, 4.5, 4.2), R("bath", "Casa de banho", "bathroom", 4.5, 0, 8, 3),
    R("hallway", "Corredor", "hall", 4.5, 3, 8, 4.2), R("landing", "Patamar", "stairs", 8, 0, 12, 4.2),
    R("master", "Suite", "bedroom", 0, 4.2, 6, 9), R("bed2", "Quarto 2", "bedroom", 6, 4.2, 12, 9),
  ],
  openings: [
    O("p1", "e1", "window", 1.5, 1.4, 1.2, 0.9), O("p2", "e1", "window", 5.6, 0.8, 0.7, 1.4), O("p3", "e1", "window", 9.5, 1.2, 1.2, 0.9),
    O("p4", "e3", "window", 2.0, 2.0, 1.6, 0.6), O("p5", "e3", "door", 7.5, 2.4, 2.2),
    O("p6", "e4", "window", 2.0, 1.2, 1.2, 0.9), O("p7", "e4", "window", 6.5, 1.0, 1.2, 0.9), O("p8", "e2", "window", 6.0, 1.2, 1.2, 0.9),
    O("p9", "j2", "door", 3.2, 0.85, 2.1), O("p10", "j4", "door", 1.2, 0.8, 2.1), O("p11", "j1", "door", 4.8, 0.9, 2.1), O("p12", "j1", "door", 6.6, 0.9, 2.1),
  ],
  plan: null, model: null,
};

const profile = {
  schema: SCHEMA_ID, version: SCHEMA_VERSION,
  name: "Casa Exemplo",
  demo: true,
  locale: "pt-PT",
  // Fictional house placed near a public park in Coimbra so the sun maths is realistic.
  location: { lat: 40.2058, lon: -8.4205, timezone: "Europe/Lisbon", bearing_deg: 100 },
  site: {
    terrain: { type: "flat", grade_pct: 0, direction_deg: 0 },
    aerial: { asset: "aerial", source: "upload", origin: [-8, -7], m_per_px: 0.05, attribution: "Illustration, not a real place" },
    garden: [[-6, -5], [23, -5], [23, 16], [-6, 16]],
    features: [
      { id: "wallW", type: "wall", a: [-6, 16], b: [12.3, 16], y: 0, height: 1.4, thickness: 0.2 },
      { id: "wallE", type: "wall", a: [16.0, 16], b: [23, 16], y: 0, height: 1.4, thickness: 0.2 },
      { id: "gate", type: "gate", label: "Portão da rua", a: [12.3, 16], b: [16.0, 16], y: 0, height: 1.5, style: "sliding", entity_id: "cover.demo_street_gate" },
    ],
  },
  floors: [f0, f1],
  roofs: [
    { id: "r1", floor: "f1", type: "gable", pitch_deg: 32, overhang: 0.45, ridge: "x", outline: [[0, 0], [12, 0], [12, 9], [0, 9]] },
    { id: "r2", floor: "f0", type: "flat", overhang: 0.2, outline: [[12, 3], [17, 3], [17, 9], [12, 9]] },
  ],
  assets: [{ id: "aerial", kind: "aerial", path: "/demo/aerial.svg", mime: "image/svg+xml" }],
  modules: {
    plants: {
      enabled: true,
      items: [
        { id: "pl1", name: "Monstera", species: "Monstera deliciosa", floor: "f0", pos: [3.2, 8.2], light: "medium", water_every_days: 7, last_watered: -3 },
        { id: "pl2", name: "Figueira-lira", species: "Ficus lyrata", floor: "f0", pos: [1.0, 8.3], light: "high", water_every_days: 7, last_watered: -8 },
        { id: "pl3", name: "Jiboia", species: "Epipremnum aureum", floor: "f0", pos: [9.3, 0.6], light: "low", water_every_days: 10, last_watered: -2 },
        { id: "pl4", name: "Manjericão", species: "Ocimum basilicum", floor: "f0", pos: [9.6, 8.6], light: "high", water_every_days: 2, last_watered: -2 },
        { id: "pl5", name: "Espada-de-são-jorge", species: "Dracaena trifasciata", floor: "f1", pos: [0.6, 1.0], light: "low", water_every_days: 21, last_watered: -5 },
        { id: "pl6", name: "Lírio-da-paz", species: "Spathiphyllum wallisii", floor: "f1", pos: [11.3, 8.4], light: "medium", water_every_days: 6, last_watered: -6 },
        { id: "pl7", name: "Oliveira", species: "Olea europaea", floor: "f0", pos: [4.5, 13.0], outdoor: true, light: "high", water_every_days: 14, last_watered: -4 },
        { id: "pl8", name: "Alfazema", species: "Lavandula angustifolia", floor: "f0", pos: [9.0, 11.2], outdoor: true, light: "high", water_every_days: 10, last_watered: -12 },
      ],
    },
    wifi: {
      enabled: true,
      ssid: "DemoNet",
      model: { pl0_db: 40, n: 2.8, wall_db: 4, ext_wall_db: 9, floor_db: 15 },
      aps: [
        { id: "ap1", label: "Router (entrada)", floor: "f0", pos: [6.0, 2.6], band: "5", tx_dbm: 20 },
        { id: "ap2", label: "Ponto de acesso (piso 1)", floor: "f1", pos: [9.5, 6.5], band: "5", tx_dbm: 17 },
      ],
      survey: [
        { floor: "f0", pos: [3.0, 6.0], rssi: -52 }, { floor: "f0", pos: [14.5, 6.0], rssi: -71 },
        { floor: "f1", pos: [2.0, 2.0], rssi: -63 }, { floor: "f1", pos: [3.0, 7.0], rssi: -58 },
      ],
    },
    homeassistant: {
      enabled: true,
      entities: [
        { id: "e1", entity_id: "sensor.demo_living_temperature", label: "Temperatura da sala", kind: "sensor", floor: "f0", pos: [5.5, 5.0] },
        { id: "e2", entity_id: "light.demo_kitchen", label: "Luz da cozinha", kind: "light", floor: "f0", pos: [9.5, 6.0] },
        { id: "e3", entity_id: "binary_sensor.demo_front_door", label: "Porta de entrada", kind: "binary_sensor", floor: "f0", pos: [6.0, 0.4] },
        { id: "e4", entity_id: "sensor.demo_bedroom_humidity", label: "Humidade da suite", kind: "sensor", floor: "f1", pos: [3.0, 6.5] },
        { id: "e5", entity_id: "switch.demo_garden_irrigation", label: "Rega do jardim", kind: "switch", floor: "f0", pos: [16.5, 9.5] },
        { id: "e6", entity_id: "cover.demo_garage_door", label: "Porta da garagem", kind: "cover", floor: "f0", pos: [14.1, 3.3] },
      ],
      mock_states: {
        "sensor.demo_living_temperature": { state: "21.4", attributes: { unit_of_measurement: "°C" } },
        "light.demo_kitchen": { state: "on", attributes: {} },
        "binary_sensor.demo_front_door": { state: "off", attributes: { device_class: "door" } },
        "sensor.demo_bedroom_humidity": { state: "54", attributes: { unit_of_measurement: "%" } },
        "switch.demo_garden_irrigation": { state: "off", attributes: {} },
        "cover.demo_garage_door": { state: "closed", attributes: { device_class: "garage" } },
        "cover.demo_street_gate": { state: "closed", attributes: { device_class: "gate" } },
      },
      mock_automations: [
        { entity_id: "automation.ht_kitchen_dusk", id: "ht_kitchen_dusk", name: "Luz da cozinha ao anoitecer", state: "on", last_triggered: null, spec: { id: "ht_kitchen_dusk", alias: "Luz da cozinha ao anoitecer", trigger: { type: "sun", event: "sunset", offset_min: -15 }, actions: [{ entity_id: "light.demo_kitchen", service: "turn_on" }] } },
        { entity_id: "automation.ht_irrigation", id: "ht_irrigation", name: "Rega às 7h", state: "off", last_triggered: null, spec: { id: "ht_irrigation", alias: "Rega às 7h", trigger: { type: "time", at: "07:00" }, actions: [{ entity_id: "switch.demo_garden_irrigation", service: "turn_on" }] } },
        { entity_id: "automation.away_mode", id: "away_mode", name: "Modo ausente (feita no Home Assistant)", state: "on", last_triggered: "2026-11-20T18:02:00Z", spec: null },
      ],
    },
    solar: {
      enabled: true,
      arrays: [{ id: "pv1", label: "Telhado sul", roof: "r1", face: "+y", kwp: 3.6, panels: 9, loss_pct: 14 }],
    },
    furniture: {
      enabled: true,
      items: [
        { id: "fu1", type: "sofa", floor: "f0", pos: [3.6, 7.9], rot_deg: 180 },
        { id: "fu2", type: "coffee", floor: "f0", pos: [3.6, 6.6], rot_deg: 0 },
        { id: "fu3", type: "tv", floor: "f0", pos: [3.6, 3.85], rot_deg: 0 },
        { id: "fu4", type: "table", floor: "f0", pos: [9.6, 7.2], rot_deg: 0 },
        { id: "fu5", type: "car", floor: "f0", pos: [14.4, 6.2], rot_deg: 0 },
        { id: "fu6", type: "desk", floor: "f0", pos: [2.0, 0.5], rot_deg: 0 },
        { id: "fu7", type: "bed_double", floor: "f1", pos: [3.0, 7.9], rot_deg: 180 },
        { id: "fu8", type: "bed_single", floor: "f1", pos: [2.2, 1.2], rot_deg: 0 },
        { id: "fu9", type: "bench", floor: "f0", pos: [6.0, 12.5], rot_deg: 0 },
      ],
      overrides: {},
    },
    cameras: {
      enabled: true,
      items: [
        { id: "cam1", label: "Entrada", floor: "f0", pos: [7.2, -0.25], height: 2.5, yaw_deg: -90, fov_deg: 100 },
        { id: "cam2", label: "Jardim", floor: "f0", pos: [16.8, 8.8], height: 2.6, yaw_deg: 160, fov_deg: 110 },
      ],
    },
  },
};

const v = validate(profile);
if (!v.ok) { console.error(v.errors.join("\n")); process.exit(1); }
writeFileSync(new URL("../web/demo/profile.json", import.meta.url), JSON.stringify(profile, null, 2) + "\n");
console.log("demo profile ok");
