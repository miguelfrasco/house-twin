// Three.js viewer: scene, camera, sun light, floor focus, labels and picking.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { buildHouse, buildGround, polygonCentroid, ghostMaterial, wallDisplay } from "./build3d.js";
import { sunVector } from "./sun.js";
import { buildSite, animateGates } from "./site.js";
import { buildFurnitureGroup, applyModelOverrides } from "./furniture.js";

export class Viewer {
  /** opts.fit: "window" (default, full screen) or "element" (size to the canvas box, e.g. a preview). */
  constructor(canvas, labelsEl, opts = {}) {
    this.canvas = canvas;
    this.labelsEl = labelsEl;
    this.fit = opts.fit || "window";
    this.view = "house"; // "house" (dollhouse when walls are cut) or "roof"
    this.tick = []; // per-frame callbacks (animations)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.localClippingEnabled = true; // half-height walls on imported models
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
    // floor layout: "stacked" (the real house) or "exploded" (floors spread apart); a focused floor overrides both
    this.layout = "stacked";
    this.offsets = new Map(); // floorId -> current vertical offset (m)
    this.roofLift = 0;
    this._leaving = new Set();
    this._layoutToken = 0;
    this.hoverFloor = null;
    this.onFloorTag = null; // (floorId | "roof") => void, from the floating floor tags in the exploded view
    this.onPick = null;
    this.raycaster = new THREE.Raycaster();
    this._resize = () => this.resize();
    window.addEventListener("resize", this._resize);
    if (this.fit === "element" && window.ResizeObserver) { this._ro = new ResizeObserver(this._resize); this._ro.observe(canvas); }
    canvas.addEventListener("pointerdown", (e) => (this._down = [e.clientX, e.clientY]));
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      const r = this.rect();
      this.setHover(this.floorAt(e.clientX - r.left, e.clientY - r.top));
    });
    canvas.addEventListener("pointerleave", () => this.setHover(null));
    canvas.addEventListener("pointerup", (e) => {
      if (!this._down || Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) > 6) return;
      const r = this.rect();
      this.pick(e.clientX - r.left, e.clientY - r.top);
    });
    this.resize();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.controls.update();
      if (this.tick.length) { const t = performance.now(); this.tick = this.tick.filter((f) => f(t) !== false); }
      if (this.site?.gates.length) animateGates(this.site.gates);
      this.syncLayout();
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
    };
    loop();
  }

  rect() {
    if (this.fit !== "element") return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const r = this.canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, width: Math.max(1, this.canvas.clientWidth), height: Math.max(1, this.canvas.clientHeight) };
  }

  resize() {
    const { width: w, height: h } = this.rect();
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the subject centred in the part of the canvas that isn't covered (e.g. by the setup guide's card)
    const s = this.shiftX?.() || 0;
    if (s) this.camera.setViewOffset(w, h, -s / 2, 0, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  async load(profile, assetUrl) {
    this.profile = profile;
    if (this.house) this.scene.remove(this.house.root);
    if (this.ground) this.scene.remove(this.ground);
    this.clearLabels();
    this._layoutToken++; this.offsets.clear(); this.roofLift = 0; this._leaving.clear(); this._synced = false; this._proxies = null; this.hoverFloor = null;
    this.house = buildHouse(profile);
    this.scene.add(this.house.root);
    const aerial = profile.site?.aerial;
    const asset = aerial && (profile.assets || []).find((a) => a.id === aerial.asset);
    this.ground = buildGround(profile, this.house.bounds, asset ? assetUrl(asset) : null);
    this.scene.add(this.ground);
    if (this.site) this.scene.remove(this.site.group);
    this.site = buildSite(profile);
    this.scene.add(this.site.group);
    this.house.occluders.push(...this.site.occluders);
    this.furniture = buildFurnitureGroup(profile);
    for (const p of [...this.furniture.children]) this.house.floors.get(p.userData.floorId)?.group.add(p); // follows floor focus
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
        this.house.floors.get(f.id).model = m;
        if (f.model.crop) cropModel(m, f.model.crop, f.elevation);
        if (this.house.display.mode === "half") cutModel(m, f.elevation, this.house.display.cut);
        m.userData.modelRoot = true;
        applyModelOverrides(m, profile.modules?.furniture?.overrides);
      } catch (e) { console.warn("model failed", e); }
    }
    for (const [, fl] of this.house.floors) {
      for (const r of fl.floor.rooms) {
        const [x, y] = polygonCentroid(r.polygon);
        this.addLabel(r.name, new THREE.Vector3(x, fl.floor.elevation + 0.2, y), fl.floor.id, "room");
      }
    }
    this.buildFloorAids();
    this.frame();
    this.applyLayout();
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

  /** Focus one floor: the camera eases in and the other floors drift away and hide. null = all floors.
   *  opts.animate: ease the change (skipped under prefers-reduced-motion). Returns a Promise. */
  setFocus(floorId, opts = {}) { this.focusFloor = floorId || null; this.view = "house"; return this.applyLayout(opts); }

  /** "stacked" (all floors together, as built) or "exploded" (floors spread apart). Leaves any floor focus. */
  setLayout(mode, opts = {}) {
    if (mode !== "stacked" && mode !== "exploded") return Promise.resolve();
    this.layout = mode; this.focusFloor = null; this.view = "house";
    return this.applyLayout(opts);
  }

  floorOrder() { return [...(this.profile?.floors || [])].sort((a, b) => a.elevation - b.elevation); }
  floorOffset(id) { return this.offsets.get(id) || 0; }
  /** Extra space between floors in the exploded view: about a third of the house's size, 3.2 to 7 m. */
  explodeGap() { const b = this.house.bounds; return Math.max(3.2, Math.min(7, Math.max(b.w, b.h) * 0.3)); }

  /** Target offsets for the current layout, focus and view (pure: see layoutTargets below). */
  applyLayout({ animate = false } = {}) {
    if (!this.house) return Promise.resolve();
    const order = this.floorOrder();
    const visible = new Set(order.filter((f) => this.house.floors.get(f.id)?.group.visible !== false).map((f) => f.id));
    const plan = layoutTargets({
      order, layout: this.layout, focus: this.focusFloor, view: this.view, gap: this.explodeGap(),
      current: new Map(order.map((f) => [f.id, this.floorOffset(f.id)])), visible, prevFocus: this._prevFocus ?? null,
    });
    this._leaving = new Set(plan.leaving);
    for (const [id, y] of plan.from) this.offsets.set(id, y); // floors coming in start a little away
    const cam = this.cameraFor(plan.to, plan.roof);
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone(), r0 = this.roofLift;
    const from = new Map(plan.from);
    this.applyFocus();
    const token = ++this._layoutToken;
    const ms = animate && !reducedMotion() ? 760 : 0;
    this._animating = true;
    return this.animate(ms, (k) => {
      if (token !== this._layoutToken) return;
      for (const [id, y] of plan.to) this.offsets.set(id, from.get(id) + (y - from.get(id)) * k);
      this.roofLift = r0 + (plan.roof - r0) * k;
      if (cam) { this.camera.position.lerpVectors(p0, cam.pos, k); this.controls.target.lerpVectors(t0, cam.target, k); }
    }, easeInOut).then(() => {
      if (token !== this._layoutToken) return;
      this._animating = false;
      this._leaving.clear();
      this._prevFocus = this.focusFloor;
      this.applyFocus();
    });
  }

  /** Where the camera goes for a layout: keeps the current compass direction, changes distance and height. */
  cameraFor(to, roofLift) {
    const b = this.house.bounds, span = Math.max(b.w, b.h, 8);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0.4, 0, 0.9);
    dir.normalize();
    let target, dist, elev;
    if (this.view === "roof") {
      const top = Math.max(...this.profile.floors.map((f) => f.elevation + f.height));
      target = new THREE.Vector3(b.cx, top, b.cy); dist = span * 1.6; elev = 62;
    } else if (this.focusFloor) {
      const f = this.profile.floors.find((q) => q.id === this.focusFloor);
      const box = this.floorBoxes?.get(this.focusFloor);
      const c = box && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(b.cx, 0, b.cy);
      const s = box && !box.isEmpty() ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 6) : span;
      target = new THREE.Vector3(c.x, (f?.elevation || 0) + 0.6, c.z); dist = s * 1.65; elev = 50;
    } else {
      const fl = this.profile.floors;
      const bottom = Math.min(...fl.map((f) => f.elevation));
      const top = Math.max(...fl.map((f) => f.elevation + f.height + (to.get(f.id) || 0))) + (roofLift ? roofLift + 1.5 : 0);
      const ex = roofLift > 0 || [...to.values()].some((y) => y > 0.01);
      target = new THREE.Vector3(b.cx, ex ? (bottom + top) / 2 : 1.5, b.cy);
      dist = ex ? Math.max(span * 2.2, (top - bottom) * 2.3) : span * 2.2;
      elev = ex ? 22 : 32;
    }
    dist *= Math.max(1, 0.8 / Math.max(0.2, this.camera.aspect)); // portrait screens: step back so the width fits
    const r = (elev * Math.PI) / 180;
    const pos = target.clone().addScaledVector(dir, Math.cos(r) * dist).add(new THREE.Vector3(0, Math.sin(r) * dist, 0));
    return { target, pos };
  }

  /** Per floor: a box (for framing and hover), a faint cyan cage, an invisible hit box, and a floating tag. */
  buildFloorAids() {
    this.floorBoxes = new Map(); this.floorHits = []; this.cages = new Map();
    for (const [id, x] of this.house.floors) {
      x.group.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const one = new THREE.Box3();
      for (const r of [x.structure, ...x.roomMeshes]) r.traverseVisible((o) => { if (o.isMesh) box.union(one.setFromObject(o)); }); // cropped model parts don't count
      if (box.isEmpty()) continue;
      this.floorBoxes.set(id, box);
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 0.3, size.y + 0.1, size.z + 0.3)), new THREE.LineBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0, depthWrite: false }));
      cage.position.copy(c); cage.renderOrder = 3; cage.raycast = () => {}; cage.userData.aid = true; cage.visible = false;
      const hit = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y + 0.4, size.z), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(c); hit.userData = { aid: true, floorHit: id };
      x.group.add(cage, hit);
      this.cages.set(id, { cage, k: 0 });
      this.floorHits.push(hit);
      this.addTag(x.floor.name, new THREE.Vector3(box.max.x + 0.4, c.y, c.z), id);
    }
    if (this.house.roofs.children.length) {
      const g = this.house.roofs.children[0];
      const box = new THREE.Box3().setFromObject(this.house.roofs);
      if (!box.isEmpty()) this.addTag(null, new THREE.Vector3(box.max.x + 0.4, box.max.y - 0.4, (box.min.z + box.max.z) / 2), g.userData.floorId, true);
    }
  }

  addTag(name, pos, floorId, roof = false) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "lbl ftag";
    el.innerHTML = `<b></b><small></small>`;
    el.querySelector("b").textContent = name || "";
    el.onclick = (e) => { e.stopPropagation(); this.onFloorTag?.(roof ? "roof" : floorId); };
    el.onpointerenter = () => this.setHover(roof ? null : floorId);
    el.onpointerleave = () => this.setHover(null);
    this.labelsEl.appendChild(el);
    this.labels.push({ el, pos, floorId, tag: true, roof });
  }

  /** Text for the floating tags (the app knows the language). */
  setTagText(fn) { for (const l of this.labels) if (l.tag) { const [b, s] = fn(l.roof ? "roof" : l.floorId); if (b != null) l.el.querySelector("b").textContent = b; l.el.querySelector("small").textContent = s || ""; } }

  /** The floor under a canvas point (all-floors views only). */
  floorAt(cx, cy) {
    if (!this.floorHits?.length || this.focusFloor || this.view !== "house" || this.fit !== "window") return null;
    const R = this.rect();
    this.raycaster.setFromCamera(new THREE.Vector2((cx / R.width) * 2 - 1, -(cy / R.height) * 2 + 1), this.camera);
    const hits = this.raycaster.intersectObjects(this.floorHits.filter((h) => h.parent?.visible), false);
    return hits[0]?.object.userData.floorHit || null;
  }

  setHover(id) {
    if (id === this.hoverFloor) return;
    this.hoverFloor = id;
    for (const l of this.labels) if (l.tag) l.el.classList.toggle("hot", !l.roof && l.floorId === id);
    if (this.fit === "window") this.canvas.style.cursor = id ? "pointer" : "";
  }

  /** Every frame: move floors, roofs, panels, markers and overlays by their floor's offset; fade the cages. */
  syncLayout() {
    if (!this.house) return;
    const active = this._animating || this.roofLift > 1e-3 || [...this.offsets.values()].some((y) => Math.abs(y) > 1e-3);
    if (active || this._synced) {
      for (const [id, x] of this.house.floors) x.group.position.y = this.floorOffset(id);
      const lift = (o) => { if (o.userData._y == null) o.userData._y = o.position.y; o.position.y = o.userData._y + this.floorOffset(o.userData.floorId) + this.roofLift; };
      this.house.roofs.children.forEach(lift);
      this.house.pv.children.forEach(lift);
      for (const m of [...this.markers.children, ...this.overlays.children]) {
        if (!m.userData.floorId) continue;
        if (m.userData._y == null) m.userData._y = m.position.y;
        m.position.y = m.userData._y + this.floorOffset(m.userData.floorId);
      }
      this.roofLook();
      this._synced = active;
    }
    if (this.cages) {
      const ex = this.layout === "exploded" && !this.focusFloor && this.view === "house";
      for (const [id, c] of this.cages) {
        const want = this.focusFloor || this.view !== "house" ? 0 : this.hoverFloor === id ? 0.85 : ex ? 0.22 : 0;
        c.k += (want - c.k) * 0.18;
        c.cage.material.opacity = c.k;
        c.cage.visible = c.k > 0.01;
      }
    }
  }

  /** Roofs: invisible shadow casters over half-height walls, solid in the roof view or when lifted off in the exploded view. */
  roofLook() {
    const lifted = this.roofLift > 0.05 || (this.layout === "exploded" && !this.focusFloor && this.view === "house");
    const solid = this.house.display?.mode !== "half" || this.view === "roof" || lifted;
    const key = `${solid}|${lifted}`;
    if (this._roofKey === key && this._roofHouse === this.house) return;
    this._roofKey = key; this._roofHouse = this.house;
    this.house.roofs.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.solidMat) o.userData.solidMat = o.material;
      o.material = solid ? o.userData.solidMat : CASTER;
      o.castShadow = !lifted; // a lifted roof must not shade the floor below it
    });
    this.house.pv.traverse((o) => { if (o.isMesh) o.castShadow = !lifted; });
  }

  /** Occluders for sun exposure at the floors' real heights, whatever the layout on screen. */
  sunOccluders() {
    const occ = this.house.occluders;
    const moved = this.roofLift > 1e-3 || [...this.offsets.values()].some((y) => Math.abs(y) > 1e-3);
    if (!moved) return occ;
    if (this._proxies?.src === occ && this._proxies.n === occ.length) return this._proxies.list;
    const save = new Map(this.offsets), lift = this.roofLift;
    this.offsets.clear(); this.roofLift = 0; this._synced = true; this.syncLayout();
    this.scene.updateMatrixWorld(true);
    const list = occ.map((o) => {
      const p = new THREE.Mesh(o.geometry, o.material);
      p.matrixAutoUpdate = false; p.matrixWorldAutoUpdate = false;
      p.matrixWorld.copy(o.matrixWorld); p.matrix.copy(o.matrixWorld);
      return p;
    });
    for (const [k, v] of save) this.offsets.set(k, v);
    this.roofLift = lift; this._synced = true; this.syncLayout();
    this.scene.updateMatrixWorld(true);
    this._proxies = { src: occ, n: occ.length, list };
    return list;
  }

  applyFocus() {
    if (!this.house) return;
    const fl = this.profile.floors, focus = this.focusFloor, roofView = this.view === "roof";
    const ex = this.layout === "exploded" && !focus && !roofView;
    const shown = (id) => !focus || id === focus || this._leaving.has(id);
    for (const [id, x] of this.house.floors) x.group.visible = shown(id);
    const ff = focus && fl.find((f) => f.id === focus);
    if (this.ground) this.ground.visible = !ff || Math.abs(ff.elevation) <= 0.5; // a basement or an upper floor floats on its own
    if (this.site) this.site.group.visible = !ff || ff.elevation <= 0.5;
    this.house.roofs.children.forEach((g) => (g.visible = !focus));
    this.roofLook();
    this.house.pv.visible = !focus && this.pvVisible !== false;
    for (const l of this.labels) {
      if (l.tag) { l.hidden = !ex || (!l.roof && !shown(l.floorId)) || (l.roof && !this.house.roofs.children.length); continue; }
      l.hidden = !!(l.floorId && this.floorHidden(l.floorId)) || (!focus && l.el.classList.contains("room")) || (roofView && !!l.floorId);
    }
    this.markers.children.forEach((m) => (m.visible = (!m.userData.floorId || !this.floorHidden(m.userData.floorId)) && !(roofView && m.userData.floorId)));
    this.overlays.children.forEach((m) => (m.visible = !m.userData.floorId || !this.floorHidden(m.userData.floorId)));
  }

  floorHidden(floorId) {
    const x = this.house?.floors.get(floorId);
    if (!x) return false;
    if (!x.group.visible) return true;
    return !!(this.focusFloor && floorId !== this.focusFloor);
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
    const { width: w, height: h } = this.rect();
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      if (l.hidden || l.off) { l.el.style.display = "none"; continue; }
      v.copy(l.pos);
      if (l.floorId) v.y += this.floorOffset(l.floorId) + (l.roof ? this.roofLift : 0);
      v.project(this.camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { l.el.style.display = "none"; continue; }
      l.el.style.display = "";
      const x = ((v.x + 1) / 2) * w;
      l.el.style.left = `${l.tag ? Math.max(8, Math.min(w - (l.el.offsetWidth || 120) - 8, x)) : x}px`; // floor tags stay on screen
      l.el.style.top = `${((1 - v.y) / 2) * h}px`;
    }
  }

  /** Raycast a click; reports floor/room and plan coordinates. */
  pick(cx, cy) {
    if (!this.onPick || !this.house) return;
    const R = this.rect();
    const ndc = new THREE.Vector2((cx / R.width) * 2 - 1, -(cy / R.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const markers = this.raycaster.intersectObjects(this.markers.children.filter((m) => m.visible), true);
    if (markers.length) {
      let o = markers[0].object;
      while (o && !o.userData.markerId) o = o.parent;
      if (o) return this.onPick({ marker: o.userData });
    }
    if (this.pickModel) { // furniture editing: report the model node under the cursor
      const objs = [];
      for (const [id, x] of this.house.floors) if (x.group.visible && !this.floorHidden(id)) objs.push(x.structure, ...x.group.children.filter((c) => c.userData.furnitureId));
      const h = this.raycaster.intersectObjects(objs, true).find((q) => q.object.visible && !q.object.userData.ghost && !q.object.isLineSegments);
      if (h && this.pickModel(h)) return;
    }
    const targets = [];
    for (const [, x] of this.house.floors) if (x.group.visible && !this.floorHidden(x.floor.id)) targets.push(...x.roomMeshes);
    const ground = this.ground?.visible ? this.ground.children : [];
    const site = this.site ? this.site.group.children : [];
    const floorHit = !this.focusFloor && this.view === "house" && this.floorHits?.length ? this.raycaster.intersectObjects(this.floorHits.filter((h) => h.parent?.visible), false)[0]?.object.userData.floorHit || null : null;
    const hit = this.raycaster.intersectObjects([...targets, ...ground, ...site], false)[0];
    if (!hit) return floorHit ? this.onPick({ floorHit }) : undefined;
    const u = hit.object.userData;
    if (u.kind === "gate") return this.onPick({ gate: u, pos: [hit.point.x, hit.point.z] });
    let floorId = u.floorId || this.focusFloor;
    if (!floorId) { // ground or site: the floor whose level is closest to the hit point
      let best = Infinity;
      for (const f of this.profile.floors) { const d = Math.abs(f.elevation - hit.point.y); if (d < best) { best = d; floorId = f.id; } }
    }
    const ground2 = u.kind === "ground" || site.includes(hit.object);
    this.onPick({ floorId, roomId: u.roomId || null, pos: [hit.point.x, hit.point.z], ground: ground2, floorHit: ground2 ? null : floorHit });
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

  /** Look down at the roofs (solar layout); shows every floor and roof. */
  roofView(opts = {}) {
    this.focusFloor = null; this.view = "roof";
    return this.applyLayout(opts); // the floors come back together under the roof
  }

  /** Open/closed state for gates linked to Home Assistant covers: { entity_id: "open" | "closed" | ... }. */
  setGates(states) {
    for (const g of this.site?.gates || []) {
      const s = states[g.feature.entity_id]?.state;
      if (s) g.open = s === "open" || s === "opening";
    }
  }

  snapshot() { return this.renderer.domElement.toDataURL("image/png"); }

  /** Run fn(progress 0..1) over ms with an ease; resolves when done. Instant when ms is 0. */
  animate(ms, fn, ease = easeOut) {
    return new Promise((res) => {
      if (!ms) { fn(1); return res(); }
      const t0 = performance.now();
      this.tick.push((t) => { const k = Math.min(1, (t - t0) / ms); fn(ease(k)); if (k >= 1) { res(); return false; } });
    });
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._resize);
    this._ro?.disconnect();
    this.controls.dispose();
    this.clearLabels();
    this.renderer.dispose();
  }
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Plan the floor offsets for a layout change (pure, tested).
 *  order: floors bottom to top; current: Map id -> offset now; visible: Set of floors on screen now.
 *  Returns { from, to, leaving, roof }: start and end offsets, the floors that drift away and hide, the roof lift. */
export function layoutTargets({ order, layout, focus, view, gap, current, visible, prevFocus = null }) {
  const ex = layout === "exploded" && !focus && view === "house";
  const fi = focus ? order.findIndex((f) => f.id === focus) : -1;
  const pi = prevFocus ? order.findIndex((f) => f.id === prevFocus) : -1;
  const from = new Map(), to = new Map(), leaving = [];
  order.forEach((f, i) => {
    const now = current.get(f.id) || 0;
    const rest = ex ? i * gap : 0;
    const show = fi < 0 || i === fi;
    if (show) {
      to.set(f.id, rest);
      // coming back into view: start a little away, on its own side of the floor that was in focus
      from.set(f.id, visible.has(f.id) ? now : rest + (pi >= 0 && pi !== i ? Math.sign(i - pi) * gap * 0.6 : 0));
    } else if (visible.has(f.id)) {
      leaving.push(f.id);
      from.set(f.id, now);
      to.set(f.id, now + Math.sign(i - fi) * gap * 0.8);
    } else { from.set(f.id, now); to.set(f.id, now); }
  });
  return { from, to, leaving, roof: ex ? gap * 0.9 : 0 };
}

// cubic-bezier(0.23, 1, 0.32, 1) is close to an ease-out-quint
export const easeOut = (t) => 1 - Math.pow(1 - t, 5);
export const easeInOut = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2);

// invisible, still casts shadows (roofs in the cut-away view)
const CASTER = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });

/** Half-height walls on an imported model: clip everything at the cut, add a faint glass copy above it.
 *  Shadows are not clipped, so the sun still sees full walls. */
export function cutModel(root, elevation, cut) {
  root.updateMatrixWorld(true);
  const y = elevation + cut;
  const below = new THREE.Plane(new THREE.Vector3(0, -1, 0), y);
  const above = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  const ghost = ghostMaterial(); ghost.clippingPlanes = [above];
  const edge = new THREE.LineBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.3, depthWrite: false, clippingPlanes: [above] });
  const box = new THREE.Box3(), meshes = [];
  root.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  for (const o of meshes) {
    box.setFromObject(o);
    if (box.max.y <= y + 0.02) continue;
    const mats = [].concat(o.material).map((m) => { const c = m.clone(); c.clippingPlanes = [below]; c.clipShadows = false; c.side = THREE.DoubleSide; return c; });
    o.material = Array.isArray(o.material) ? mats : mats[0];
    if (box.max.y - box.min.y > 1.6 && box.min.y < y) {
      const g = new THREE.Mesh(o.geometry, ghost);
      g.userData.ghost = true; g.raycast = () => {};
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 40), edge));
      g.children[0].raycast = () => {};
      o.add(g);
    }
  }
}

/** Hide model meshes that reach outside crop {x0, y0, x1, y1} (plan metres) or below min_h (metres from the floor):
 *  CAD exports often include the garden, the plot slab or a pool that the site features replace. */
export function cropModel(root, c, elevation = 0) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), e = 0.05;
  let hidden = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    const out = box.min.x < c.x0 - e || box.max.x > c.x1 + e || box.min.z < c.y0 - e || box.max.z > c.y1 + e || (c.min_h != null && box.min.y < elevation + c.min_h);
    if (out) { o.visible = false; hidden++; }
  });
  return hidden;
}
