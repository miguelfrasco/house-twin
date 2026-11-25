// Three.js viewer: scene, camera, sun light, floor focus, labels and picking.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { buildHouse, buildGround, polygonCentroid } from "./build3d.js";
import { sunVector } from "./sun.js";

export class Viewer {
  constructor(canvas, labelsEl) {
    this.canvas = canvas;
    this.labelsEl = labelsEl;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b11);
    this.scene.fog = new THREE.Fog(0x070b11, 70, 160);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 120;
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x2a3320, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.overlays = new THREE.Group();
    this.markers = new THREE.Group();
    this.scene.add(this.overlays, this.markers);
    this.labels = []; // {el, pos: Vector3, floorId}
    this.focusFloor = null; // null = all
    this.onPick = null;
    this.raycaster = new THREE.Raycaster();
    this._resize = () => this.resize();
    window.addEventListener("resize", this._resize);
    canvas.addEventListener("pointerdown", (e) => (this._down = [e.clientX, e.clientY]));
    canvas.addEventListener("pointerup", (e) => {
      if (!this._down || Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) > 6) return;
      this.pick(e.clientX, e.clientY);
    });
    this.resize();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
    };
    loop();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(profile, assetUrl) {
    this.profile = profile;
    if (this.house) this.scene.remove(this.house.root);
    if (this.ground) this.scene.remove(this.ground);
    this.clearLabels();
    this.house = buildHouse(profile);
    this.scene.add(this.house.root);
    const aerial = profile.site?.aerial;
    const asset = aerial && (profile.assets || []).find((a) => a.id === aerial.asset);
    this.ground = buildGround(profile, this.house.bounds, asset ? assetUrl(asset) : null);
    this.scene.add(this.ground);
    // custom models per floor (e.g. a GLB exported from a CAD tool)
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    for (const f of profile.floors) {
      if (!f.model?.asset) continue;
      const a = (profile.assets || []).find((x) => x.id === f.model.asset);
      if (!a) continue;
      try {
        const gltf = await loader.loadAsync(assetUrl(a));
        const m = gltf.scene;
        const [px, py, pz] = f.model.position || [0, 0, 0];
        m.position.set(px, py, pz);
        m.rotation.y = ((f.model.rotation_deg || 0) * Math.PI) / 180;
        m.scale.setScalar(f.model.scale || 1);
        m.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = o.receiveShadow = true;
            const glassy = [].concat(o.material).some((mt) => mt && mt.transparent && mt.opacity < 0.6);
            if (!glassy) this.house.occluders.push(o);
          }
        });
        this.house.floors.get(f.id).structure.add(m);
      } catch (e) { console.warn("model failed", e); }
    }
    for (const [, fl] of this.house.floors) {
      for (const r of fl.floor.rooms) {
        const [x, y] = polygonCentroid(r.polygon);
        this.addLabel(r.name, new THREE.Vector3(x, fl.floor.elevation + 0.2, y), fl.floor.id, "room");
      }
    }
    this.frame();
    this.applyFocus();
  }

  frame() {
    const b = this.house.bounds;
    const span = Math.max(b.w, b.h, 8);
    this.controls.target.set(b.cx, 1.5, b.cy);
    this.camera.position.set(b.cx + span * 0.75, span * 1.25, b.cy + span * 1.7);
    this.controls.update();
    this.sun.shadow.camera.left = -span; this.sun.shadow.camera.right = span;
    this.sun.shadow.camera.top = span; this.sun.shadow.camera.bottom = -span;
    this.sun.shadow.camera.far = span * 6;
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Focus one floor: hide everything above it (cutaway). null = whole house. */
  setFocus(floorId) { this.focusFloor = floorId; this.applyFocus(); }

  applyFocus() {
    if (!this.house) return;
    const fl = this.profile.floors;
    const idx = this.focusFloor ? fl.findIndex((f) => f.id === this.focusFloor) : fl.length - 1;
    const maxElev = fl[idx]?.elevation ?? Infinity;
    for (const [id, x] of this.house.floors) x.group.visible = x.floor.elevation <= maxElev + 1e-6 || id === this.focusFloor;
    const showRoof = !this.focusFloor;
    if (this.ground) this.ground.visible = !(this.focusFloor && maxElev < -0.5); // looking at a basement: lift the lawn away
    this.house.roofs.children.forEach((g) => {
      const f = fl.find((q) => q.id === g.userData.floorId);
      g.visible = showRoof || (f && f.elevation < maxElev - 1e-6);
    });
    this.house.pv.visible = showRoof && this.pvVisible !== false;
    for (const l of this.labels) l.hidden = !!(l.floorId && this.floorHidden(l.floorId)) || (!this.focusFloor && l.el.classList.contains("room"));
    this.markers.children.forEach((m) => (m.visible = !m.userData.floorId || !this.floorHidden(m.userData.floorId)));
    this.overlays.children.forEach((m) => (m.visible = !m.userData.floorId || !this.floorHidden(m.userData.floorId)));
  }

  floorHidden(floorId) {
    const x = this.house?.floors.get(floorId);
    if (!x) return false;
    if (!x.group.visible) return true;
    if (this.focusFloor && floorId !== this.focusFloor) {
      // show lower floors only faintly: hide their labels and markers
      return true;
    }
    return false;
  }

  /** Sun position: { az, el } in compass degrees. */
  setSun(pos) {
    const b = this.house?.bounds || { cx: 0, cy: 0, w: 20, h: 20 };
    const v = sunVector(pos, this.profile?.location?.bearing_deg ?? 90);
    const d = Math.max(b.w, b.h, 10) * 2;
    const up = pos.el > 0;
    this.sun.visible = up;
    this.sun.position.set(b.cx + v[0] * d, Math.max(0.5, v[1] * d), b.cy + v[2] * d);
    this.sun.target.position.set(b.cx, 0, b.cy);
    const k = Math.max(0, Math.min(1, pos.el / 25));
    this.sun.intensity = up ? 0.6 + 2.0 * k : 0;
    this.sun.color.setHSL(0.09 + 0.03 * k, 0.9 - 0.5 * k, 0.6 + 0.25 * k);
    this.hemi.intensity = up ? 0.45 + 0.5 * k : 0.25;
    const bg = up ? new THREE.Color().setHSL(0.58, 0.45, 0.04 + 0.05 * k) : new THREE.Color(0x05070b);
    this.scene.background = bg;
    this.scene.fog.color = bg;
  }

  addLabel(text, pos, floorId, cls = "") {
    const el = document.createElement("div");
    el.className = `lbl ${cls}`;
    el.textContent = text;
    this.labelsEl.appendChild(el);
    const l = { el, pos, floorId };
    this.labels.push(l);
    return l;
  }

  removeLabels(cls) {
    this.labels = this.labels.filter((l) => {
      if (l.el.classList.contains(cls)) { l.el.remove(); return false; }
      return true;
    });
  }

  clearLabels() { this.labels.forEach((l) => l.el.remove()); this.labels = []; }

  updateLabels() {
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      if (l.hidden || l.off) { l.el.style.display = "none"; continue; }
      v.copy(l.pos).project(this.camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { l.el.style.display = "none"; continue; }
      l.el.style.display = "";
      l.el.style.left = `${((v.x + 1) / 2) * w}px`;
      l.el.style.top = `${((1 - v.y) / 2) * h}px`;
    }
  }

  /** Raycast a click; reports floor/room and plan coordinates. */
  pick(cx, cy) {
    if (!this.onPick || !this.house) return;
    const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const markers = this.raycaster.intersectObjects(this.markers.children.filter((m) => m.visible), true);
    if (markers.length) {
      let o = markers[0].object;
      while (o && !o.userData.markerId) o = o.parent;
      if (o) return this.onPick({ marker: o.userData });
    }
    const targets = [];
    for (const [, x] of this.house.floors) if (x.group.visible && !this.floorHidden(x.floor.id)) targets.push(...x.roomMeshes);
    const ground = this.ground ? this.ground.children : [];
    const hit = this.raycaster.intersectObjects([...targets, ...ground], false)[0];
    if (!hit) return;
    const u = hit.object.userData;
    this.onPick({ floorId: u.floorId || this.focusFloor || this.profile.floors[0].id, roomId: u.roomId || null, pos: [hit.point.x, hit.point.z], ground: u.kind === "ground" });
  }

  /** Simple glowing marker sphere. */
  marker({ id, floorId, pos, y = 1, color = 0x5ce1ff, size = 0.22, kind = "" }) {
    const g = new THREE.Group();
    const fl = this.profile.floors.find((f) => f.id === floorId);
    const e = fl ? fl.elevation : 0;
    g.position.set(pos[0], e + y, pos[1]);
    const s = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 14), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.3 }));
    g.add(s);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, y, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }));
    stem.position.y = -y / 2;
    g.add(stem);
    g.userData = { markerId: id, floorId, kind };
    this.markers.add(g);
    return g;
  }

  clearMarkers(kind) {
    for (const m of [...this.markers.children]) if (!kind || m.userData.kind === kind) this.markers.remove(m);
  }

  clearOverlays(kind) {
    for (const m of [...this.overlays.children]) if (!kind || m.userData.overlay === kind) this.overlays.remove(m);
  }

  topView() {
    const b = this.house.bounds;
    const span = Math.max(b.w, b.h, 8);
    this.controls.target.set(b.cx, 0, b.cy);
    this.camera.position.set(b.cx, span * 2.1, b.cy + 0.01);
    this.controls.update();
  }

  snapshot() { return this.renderer.domElement.toDataURL("image/png"); }
}
