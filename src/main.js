// FORM / 01 — core boot: renderer, environment, model, wiring, pose, modes, API.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadData } from './data.js';
import { Materials } from './materials.js?v=short-20261012';
import { buildEnvironment } from './environment.js';
import { Model } from './model.js?v=palm-cover-3';
import { Wiring } from './wiring.js';
import { Pose } from './pose.js?v=short-20261012';
import { Modes } from './modes.js';
import { Story } from './story.js?v=short-20261012';
import { ShortStory } from './short-story.js?v=hand-opening-20261013';
import { ScrollStory } from './scroll-story.js?v=scroll-20261013';
import { BiomechanicsEngine } from './biomechanics.js';
import { IKSolver } from './ik-solver.js';
import { ActuatorDynamics } from './actuator-dynamics.js';
import { CollisionChecker } from './collision-checker.js';
import { BenchmarkEngine } from './benchmarks.js';
import { GraspTrajectory } from './grasp-trajectory.js';
import { PhysicsScene } from './physics/physics-scene.js';
import { XRTeleop } from './teleop/webxr-teleop.js';
import { DatasetRecorder } from './teleop/dataset-logger.js';
import { WristCamera } from './teleop/wrist-camera.js';
import { createAPI } from './api.js';

const stage = document.getElementById('stage');
const loadBar = document.getElementById('loadBar');
const loadStep = document.getElementById('loadStep');
const setProgress = (p, s) => {
  if (loadBar) loadBar.style.width = (p * 100).toFixed(0) + '%';
  if (loadStep && s) loadStep.textContent = s;
};

async function boot() {
  setProgress(0.03, 'Renderer');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // The DOM hero sits behind the model; empty canvas pixels must stay transparent.
  scene.background = null;
  renderer.setClearColor(0x000000, 0);

  const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.008, 30);
  camera.position.set(-0.34, 0.56, 1.28);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-0.2, 0.33, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.06;
  controls.maxDistance = 4;
  controls.update();

  setProgress(0.08, 'Studio environment');
  const env = buildEnvironment(renderer, scene);

  setProgress(0.12, 'Assembly data');
  const data = await loadData(setProgress);

  setProgress(0.3, 'Materials');
  const materials = new Materials();

  setProgress(0.4, 'Machining parts');
  const model = new Model(data, materials, { density: 1 });
  scene.add(model.root);
  await tick();

  setProgress(0.62, 'Routing 1,369 wires');
  const wiring = new Wiring(model, materials, scene);
  await tick();

  setProgress(0.78, 'Kinematics');
  const pose = new Pose(model, wiring);
  pose.flush();
  const modes = new Modes(model, materials, wiring, renderer);

  // camera focus helper (smooth tween)
  const camTween = { active: false, t: 0, dur: 0.9, fromP: new THREE.Vector3(), toP: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() };
  function fitDistance(radius, margin = 1.12) {
    const fovY = camera.fov * Math.PI / 180;
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
    const d = Math.max(radius / Math.sin(fovY / 2), radius / Math.sin(fovX / 2));
    return d * margin;
  }
  function worldBoundsOf(rootObj) {
    const box = new THREE.Box3();
    for (const b of model.buckets) {
      let o = b.owner, inside = false;
      while (o) { if (o === rootObj) { inside = true; break; } o = o.parent; }
      if (!inside) continue;
      const M = b.owner.matrixWorld;
      for (const p of b.parts) {
        const bb = p.bounds.clone();
        bb.applyMatrix4(M);
        box.union(bb);
      }
    }
    return box;
  }
  const FOCUS = {
    arm: { p: [-0.34, 0.56, 1.28], t: [-0.2, 0.33, 0] },
    hand: { around: 'hand', margin: 1.18 },
    palm: { around: 'hand', margin: 0.78, lift: 0.045 },
    forearm: { around: 'J6/mount', radius: 0.16, margin: 1.3 },
  };
  function focusPart(part) {
    if (story && story.active) story.exit();
    const v = new THREE.Vector3();
    if (FOCUS[part]) {
      const f = FOCUS[part];
      if (f.p) { flyTo(new THREE.Vector3(...f.p), new THREE.Vector3(...f.t)); return; }
      const node = model.nodeByName.get(f.around);
      if (!node) return;
      model.root.updateMatrixWorld(true);
      const box = worldBoundsOf(node);
      const center = box.isEmpty() ? node.getWorldPosition(v).clone() : box.getCenter(new THREE.Vector3());
      const radius = f.radius ?? (box.isEmpty() ? 0.08 : box.getSize(new THREE.Vector3()).length() / 2);
      if (f.lift) center.y += f.lift;
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (dir.lengthSq() < 0.5) dir.set(-0.5, 0.35, 1).normalize();
      flyTo(center.clone().addScaledVector(dir, fitDistance(radius, f.margin ?? 1.15)), center);
      return;
    }
    // part name lookup
    for (const b of model.buckets) {
      const p = b.parts.find(pp => pp.name === part || pp.name.endsWith('/' + part));
      if (p) {
        const ownerId = b.owner.userData?.nodeId;
        const M = ownerId !== undefined ? model.restWorld.get(ownerId) : null;
        const target = p.bounds.getCenter(new THREE.Vector3());
        if (M) target.applyMatrix4(M);
        const dir = camera.position.clone().sub(controls.target).normalize();
        const d = fitDistance(p.bounds.getSize(new THREE.Vector3()).length() / 2, 1.25);
        flyTo(target.clone().addScaledVector(dir, d), target);
        return;
      }
    }
  }
  function flyTo(p, t) {
    userFramed = true;
    controls.enabled = true;
    camTween.active = true; camTween.t = 0;
    camTween.fromP.copy(camera.position); camTween.toP.copy(p);
    camTween.fromT.copy(controls.target); camTween.toT.copy(t);
  }

  // ---- initial framing: whole product fitted to the *usable* viewport ----
  let userFramed = false;
  const DEFAULT_DIR = new THREE.Vector3(-0.14, 0.23, 1.28).normalize();
  function fullArmBounds() {
    model.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const b of model.buckets) {
      const M = b.owner.matrixWorld;
      for (const p of b.parts) {
        const bb = p.bounds.clone().applyMatrix4(M);
        box.union(bb);
      }
    }
    return box;
  }
  function frameFullArm() {
    const box = fullArmBounds();
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const topPad = 76;
    const css = getComputedStyle(document.documentElement).getPropertyValue('--dock-clear');
    const bottomPad = Number.parseFloat(css) || 122;
    const usable = Math.max(260, window.innerHeight - topPad - bottomPad);
    const fitScale = window.innerHeight / usable;
    const dist = fitDistance(radius, 1.05 * fitScale);
    const worldPerPixel = (2 * dist * Math.tan(camera.fov * Math.PI / 360)) / window.innerHeight;
    const target = center.clone();
    target.y -= worldPerPixel * (bottomPad - topPad) * 0.4; // lift model clear of the bottom bar
    camera.position.copy(target).addScaledVector(DEFAULT_DIR, dist);
    controls.target.copy(target);
    controls.update();
  }
  if (camera.aspect < 0.95) frameFullArm();

  setProgress(0.82, 'Biomechanics & IK');
  const biomechanics = new BiomechanicsEngine(pose, model);
  biomechanics.createTactileVisualizer(scene);
  const ikSolver = new IKSolver(model, pose, camera, renderer, controls);
  const dynamics = new ActuatorDynamics(model, pose);
  const collisionChecker = new CollisionChecker(model, pose);
  const benchmarks = new BenchmarkEngine(scene, model, pose, ikSolver, biomechanics, dynamics);

  setProgress(0.85, 'Trajectory planner');
  let api = null;
  const physics = new PhysicsScene({
    scene, model, pose,
    onStatus: () => api?._changed(),
  });
  const trajectory = new GraspTrajectory({
    pose, ikSolver, benchmarks, model,
    onState: () => api?._changed(),
  });
  const teleop = new XRTeleop({
    pose, ikSolver,
    onStatus: () => api?._changed(),
  });
  const recorder = new DatasetRecorder({ fps: 30 });
  const wristCamera = new WristCamera({ renderer, scene, model });

  setProgress(0.88, 'Interface');
  api = createAPI({
    model, pose, modes, materials, wiring, scene, camera, renderer, controls, env,
    focusPart, onStateChange, biomechanics, ikSolver, dynamics, benchmarks, collisionChecker,
    physics, trajectory, teleop, recorder, wristCamera,
  });
  window.__rebuild = api;

  // guided tour coordinator (owns the camera until Free explore)
  const recording = document.body.dataset.defaultView === 'record' || new URLSearchParams(location.search).has('record');
  const StoryController = recording ? (new URLSearchParams(location.search).get('tour') === 'scroll' ? ScrollStory : ShortStory) : Story;
  const story = new StoryController({
    model, pose, modes, materials, camera, controls, renderer, wiring,
    fullArmBounds, boundsOf: worldBoundsOf, fitDistance, defaultDir: DEFAULT_DIR,
  });
  api.story = story;
  api.setChapter = (i) => story.goTo(i);
  api.storyNext = () => story.next();
  api.storyPrev = () => story.prev();
  api.freeExplore = () => {
    document.getElementById('hero')?.classList.add('hide');
    story.exit();
    api._changed();
  };
  api.resumeTour = () => { story.enter(); api._changed(); };
  api.setStoryProgress = (p) => story.setProgress(p);
  api.getStoryState = () => story.getState();

  // Direct lab mode: start in free interactive mode immediately
  api.freeExplore();

  // one-shot 360° orbit (free explore): exactly one revolution, cancellable
  const orbit = { active: false, t: 0, dur: 5.2, theta0: 0, center: new THREE.Vector3(), r: 0, y: 0 };
  function orbit360() {
    if (story.active) return; // chapter 5 already orbits via the tour
    orbit.active = true; orbit.t = 0;
    orbit.center.copy(controls.target);
    const off = camera.position.clone().sub(orbit.center);
    orbit.r = Math.hypot(off.x, off.z);
    orbit.y = off.y;
    orbit.theta0 = Math.atan2(off.x, off.z);
    controls.enabled = false;
  }
  api.orbit360 = orbit360;
  renderer.domElement.addEventListener('pointerdown', () => {
    if (orbit.active) { orbit.active = false; controls.enabled = true; }
  }, { capture: true });

  // exploded/flat-lay module (parallel worker) — picked up automatically
  let explodeActive = false;
  try {
    const mod = await import('./explode-layout.js');
    const layout = new mod.ExplodedLayout({ model });
    if (layout && layout.root && typeof layout.capture === 'function' && typeof layout.setProgress === 'function') {
      layout.root.visible = false;
      scene.add(layout.root);
      story.setExplode(layout);
      api.explode = layout;
      api.enterExplode = (opts = {}) => {
        if (story.active) story.exit();
        layout.capture();
        layout.root.visible = true;
        model.root.visible = false;
        wiring.group.visible = false;
        pose.cancelMotion();
        explodeActive = true;
        explodeActiveScope = opts.scope || 'all';
        explodeActiveLayout = opts.layout || 'exploded';
        layout.setProgress(opts.amount ?? 0.65, { layout: explodeActiveLayout, scope: explodeActiveScope });
        frameExplode();
        api._changed();
        return true;
      };
      api.exitExplode = () => {
        layout.root.visible = false;
        model.root.visible = true;
        wiring.group.visible = true;
        explodeActive = false;
        api._changed();
      };
      api.setExplodeProgress = (amount, opts = {}) => {
        if (!explodeActive) return false;
        const scopeChanged = (opts.scope && opts.scope !== explodeActiveScope) || (opts.layout && opts.layout !== explodeActiveLayout);
        const ok = layout.setProgress(amount, { layout: opts.layout || 'exploded', scope: opts.scope || 'all' });
        if (opts.scope) explodeActiveScope = opts.scope;
        if (opts.layout) explodeActiveLayout = opts.layout;
        if (scopeChanged) frameExplode();
        return ok;
      };
      let explodeActiveScope = 'all';
      let explodeActiveLayout = 'exploded';
      function frameExplode() {
        const b = layout.getBounds();
        if (!b || b.isEmpty()) return;
        const c = b.getCenter(new THREE.Vector3());
        const r = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 0.05);
        const flat = explodeActiveLayout === 'flat';
        const dir = flat ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0.28, 0.62, 0.73).normalize();
        const size = b.getSize(new THREE.Vector3());
        const dist = flat ? Math.max(size.x / camera.aspect, size.y) / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.065 + size.z / 2 : fitDistance(r, 1.12);
        flyTo(c.clone().addScaledVector(dir, dist), c);
      }
      api.getExplodeStats = () => layout.getStats();
      api.explodeIsActive = () => explodeActive;
      // the 'Explode' display mode drives the detached layout
      modes.hooks = { explode: (on) => { on ? api.enterExplode() : api.exitExplode(); } };
      console.info('[core] exploded layout module loaded:', JSON.stringify(layout.getStats?.()).slice(0, 200));
    } else {
      console.info('[core] explode-layout.js is a placeholder — parts chapter uses tour fallback');
    }
  } catch (e) {
    console.info('[core] explode-layout.js not present yet:', e.message);
  }

  let ui = null;
  function onStateChange(snap) { ui?.update?.(snap); }
  try {
    const mod = await import('./ui.js?v=short-20261012');
    ui = mod.initUI(api);
    api.ui = ui;
    let visibleChapter = -1;
    story.onChapter = chapter => {
      if (chapter === visibleChapter) return;
      visibleChapter = chapter;
      api._changed();
    };
    story.onChapter(story.chapterOf(story.progress));
  } catch (e) {
    console.info('[core] ui.js not present yet — running headless API only', e.message);
  }

  const { initScorePlayer } = await import('./score-player.js?v=scroll-20261013');
  const scorePlayer = initScorePlayer(api, story);

  // const { initTelemetryHUD } = await import('./telemetry-hud.js');
  // const telemetryHUD = initTelemetryHUD(api);

  // part picking
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downAt = 0;
  renderer.domElement.addEventListener('pointerdown', () => { downAt = performance.now(); userFramed = true; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (performance.now() - downAt > 220) return; // drag, not click
    ptr.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    // detached exploded view first when it covers the model
    if (explodeActive && api.explode) {
      const dh = ray.intersectObject(api.explode.root, true);
      if (dh.length) {
        const meta = api.explode.getPart(dh[0]);
        if (meta) {
          const info = {
            name: meta.title || meta.name.split('/').pop(),
            partName: meta.name,
            role: meta.role || 'Component',
            description: api.describePart({ name: meta.name, role: meta.role, owner: meta.owner, layer: meta.layer }).description,
            details: [
              meta.group ? { label: 'Group', value: meta.group } : null,
              meta.owner ? { label: 'Assembly', value: meta.owner } : null,
              meta.layer ? { label: 'Layer', value: meta.layer } : null,
            ].filter(Boolean),
          };
          ui?.showPart ? ui.showPart(info) : console.log('[part]', info);
          return;
        }
      }
    }
    const hits = ray.intersectObjects(model.root.children, true);
    for (const h of hits) {
      const parts = h.object.userData.parts;
      if (!parts) continue;
      const vi = h.faceIndex * 3;
      const part = parts.find(p => vi >= p.vertStart && vi < p.vertStart + p.vertCount);
      if (part) {
        const info = api.describePart(part);
        if (ui?.showPart) ui.showPart(info);
        else console.log('[part]', info);
        break;
      }
    }
  });

  window.addEventListener('resize', () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    story.resize();
    if (!userFramed && !story.active && camera.aspect < 0.95) frameFullArm();
  });

  window.dispatchEvent(new Event('resize'));
  setProgress(1, 'Ready');
  document.getElementById('loader')?.classList.add('done');
  document.getElementById('hero')?.classList.remove('hide');

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    scorePlayer.update();
    pose.update(dt);
    modes.update(dt);
    story.update(dt);
    trajectory.update(dt);
    physics.update(dt);

    if (recorder.recording) {
      const grasp = biomechanics.evaluateGraspQuality();
      const tensions = biomechanics.getFingerTensions();
      recorder.tick(performance.now(), {
        armAngles: pose.armAngles,
        handAngles: pose.handAngles,
        tensions,
        epsilon: grasp.epsilon,
        task: benchmarks.currentObject?.name,
      }, api._recordImages ? wristCamera.capture() : null);
    }

    dynamics.updateThermal(dt);
    biomechanics.updateTactileVisualizer();

    if (benchmarks.isGrasping && benchmarks.graspAnimation) {
      benchmarks.graspAnimation.update(performance.now());
    }
    if (ikSolver.enabled && !story.active) {
      ikSolver.solve();
    }
    if (orbit.active) {
      orbit.t += dt;
      const u = Math.min(1, orbit.t / orbit.dur);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const th = orbit.theta0 + e * Math.PI * 2;
      camera.position.set(
        orbit.center.x + Math.sin(th) * orbit.r,
        orbit.center.y + orbit.y,
        orbit.center.z + Math.cos(th) * orbit.r);
      camera.lookAt(orbit.center);
      if (u >= 1) { orbit.active = false; controls.enabled = true; }
    }
    if (camTween.active && controls.enabled) {
      camTween.t += dt;
      const u = Math.min(1, camTween.t / camTween.dur);
      const e = u * u * (3 - 2 * u);
      camera.position.lerpVectors(camTween.fromP, camTween.toP, e);
      controls.target.lerpVectors(camTween.fromT, camTween.toT, e);
      if (u >= 1) camTween.active = false;
    }
    if (controls.enabled) controls.update();
    pose.flush();
    renderer.render(scene, camera);
  });

  // resume orbiting after a reference-frame capture: retarget then re-enable
  renderer.domElement.addEventListener('pointerdown', () => {
    if (controls.enabled || story.active) return;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    controls.target.copy(camera.position).addScaledVector(fwd, Math.max(0.4, camera.position.length() * 0.55));
    controls.enabled = true;
    controls.update();
  }, { capture: true });

  window.__formReady = true;
}

const tick = () => new Promise(r => setTimeout(r, 0));

boot().catch(err => {
  console.error(err);
  setProgress(1, 'Failed: ' + err.message);
  document.getElementById('loadStep').style.color = '#c00';
});
