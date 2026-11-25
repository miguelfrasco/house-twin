// Live preview for the setup guide: the house assembles as you go.
// Pin drops on the plot, walls rise from the floor, the roof settles on top, layers show up.
// Motion is short and only marks real changes; with reduced motion the final state just appears.
import * as THREE from "three";
import { Viewer, easeOut } from "../engine/viewer.js";

const SUN = { az: 205, el: 38 }; // an early-afternoon sun: long enough shadows to read the shape
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createPreview(canvas, labelsEl, { assetUrl, shiftX }) {
  const v = new Viewer(canvas, labelsEl, { fit: "element" });
  if (shiftX) { v.shiftX = shiftX; v.resize(); }
  v.controls.enablePan = false;
  let seq = 0, prev = null, placeholder = null;

  const sigOf = (p, o) => ({
    walls: p.floors.reduce((a, f) => a + f.walls.length, 0),
    shape: JSON.stringify(p.floors.map((f) => [f.elevation, f.height, f.walls.length, f.rooms.map((r) => [r.name, r.type])])),
    roof: JSON.stringify((p.roofs || []).map((r) => [r.type, r.pitch_deg, r.ridge, r.overhang, r.floor])),
    display: JSON.stringify(p.display || {}),
    ground: JSON.stringify([p.site?.aerial?.source, p.site?.aerial?.m_per_px, p.site?.aerial?.center, p.site?.terrain]),
    solar: JSON.stringify(p.modules?.solar || null),
    pin: !!o.pin,
    view: o.view,
  });

  function frameFor(view) {
    if (view === "roof") v.roofView();
    else { v.view = "house"; v.frame(); }
  }

  function drawPlaceholder(p, pin) {
    if (placeholder) { v.overlays.remove(placeholder); placeholder = null; }
    if (p.floors.some((f) => f.walls.length)) return;
    // where the house will stand: a dashed footprint, and the pin once the location is set
    const g = new THREE.Group();
    const pts = [[-5, -4], [5, -4], [5, 4], [-5, 4], [-5, -4]].map(([x, z]) => new THREE.Vector3(x, 0.03, z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x5ce1ff, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.55 }));
    line.computeLineDistances();
    g.add(line);
    if (pin) {
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), new THREE.MeshStandardMaterial({ color: 0x5ce1ff, emissive: 0x5ce1ff, emissiveIntensity: 0.6, roughness: 0.3 }));
      head.position.y = 2.2;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.6 }));
      stem.position.y = 1.1;
      const pinG = new THREE.Group(); pinG.add(head, stem); pinG.castShadow = true; head.castShadow = true;
      g.add(pinG);
      g.userData.pin = pinG;
    }
    g.userData.overlay = "placeholder";
    v.overlays.add(g);
    placeholder = g;
  }

  function rise(delay = 0) {
    const floors = [...v.house.floors.values()];
    floors.forEach((x, k) => {
      const e = x.floor.elevation, s0 = 0.001;
      x.structure.scale.y = s0; x.structure.position.y = e * (1 - s0);
      setTimeout(() => v.animate(700, (t) => { const s = Math.max(s0, t); x.structure.scale.y = s; x.structure.position.y = e * (1 - s); }, easeOut), delay + k * 140);
    });
  }

  function drop(group, from = 0.8, ms = 520, delay = 0) {
    group.position.y = from;
    setTimeout(() => v.animate(ms, (t) => (group.position.y = from * (1 - t)), easeOut), delay);
  }

  async function show(w, o = {}) {
    const my = ++seq;
    const p = structuredClone(w);
    const sig = sigOf(p, o);
    const same = prev && Object.keys(sig).every((k) => sig[k] === prev[k]);
    if (same) return;
    const needLoad = !prev || ["walls", "shape", "roof", "display", "ground", "solar"].some((k) => sig[k] !== prev[k]);
    if (needLoad) {
      await v.load(p, assetUrl);
      if (my !== seq) return;
    }
    v.profile = p;
    v.pvVisible = !!p.modules?.solar?.enabled;
    v.setSun(SUN);
    drawPlaceholder(p, sig.pin);
    const reframe = !prev || sig.view !== prev.view || sig.shape !== prev.shape || sig.walls !== prev.walls;
    if (reframe) frameFor(o.view); else { v.view = o.view === "roof" ? "roof" : "house"; v.applyFocus(); }
    if (!reduced() && prev) {
      if (sig.walls > prev.walls) rise();
      if (sig.roof !== prev.roof && p.roofs?.length && o.view === "roof") drop(v.house.roofs, 0.8);
      if (sig.solar !== prev.solar && p.modules?.solar?.enabled) drop(v.house.pv, 0.5, 420, 80);
      if (sig.pin && !prev.pin && placeholder?.userData.pin) drop(placeholder.userData.pin, 1.4, 420);
    }
    prev = sig;
  }

  return {
    show,
    setBearing(deg) { if (!v.profile) return; v.profile.location = { ...v.profile.location, bearing_deg: deg }; v.setSun(SUN); },
    dispose() { seq++; v.dispose(); },
    viewer: v,
  };
}
