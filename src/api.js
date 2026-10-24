// window.__rebuild — supervisor/UI facing API.
import * as THREE from 'three';
import { SKINS } from './materials.js';
import { MODES } from './modes.js';
import { GESTURES, ARM_POSES } from './pose.js?v=short-20261012';
import { exportPNG, exportGLB, exportURDF, exportMJCF, exportROS2 } from './exporter.js';
import { describePart } from './parts-info.js';

export function createAPI(ctx) {
  const { model, pose, modes, materials, wiring, scene, camera, renderer, controls, biomechanics, ikSolver, dynamics, benchmarks, physics, trajectory, teleop, recorder, wristCamera } = ctx;

  const api = {
    model, scene, camera, renderer, controls, pose, modes, materials, wiring,
    biomechanics, ikSolver, dynamics, benchmarks, physics, trajectory, teleop, recorder, wristCamera,
    armJointInfo: pose.armJointInfo,
    handJointInfo: pose.handJointInfo,
    skins: Object.keys(SKINS),
    modes: MODES,
    gestures: [...Object.keys(GESTURES), 'ripple', 'wave'],
    armPoses: Object.keys(ARM_POSES),
    ui: null, // set by main when initUI resolves

    setIK(enabled) { ikSolver?.setEnabled(enabled); api._changed(); },
    setEllipsoid(visible) { ikSolver?.setEllipsoidVisible(visible); api._changed(); },
    spawnBenchmark(id) { benchmarks?.spawnObject(id); api._changed(); },
    clearBenchmark() { benchmarks?.clearObject(); api._changed(); },
    runGraspBenchmark(cb) { return benchmarks?.executeGraspSequence(cb); },
    setCoupledBiomechanics(b) { if (biomechanics) biomechanics.couplingEnabled = !!b; api._changed(); },
    setTactileForces(visible) { if (biomechanics?.tactileGroup) biomechanics.tactileGroup.visible = !!visible; api._changed(); },
    collisionChecker: ctx.collisionChecker,

    setMode(mode) { modes.set(mode); modes.snapBlend(); api._changed(); },
    setShellBlend(p, o) { modes.setBlend(p, o); api._changed(); },
    setSkin(id) {
      if (!SKINS[id]) return;
      materials.applySkin(id, api._shellDepth);
      api._changed();
    },
    setShellDepth(d) {
      api._shellDepth = Math.min(1, Math.max(0, Number(d)));
      materials.applySkin(materials.skinId, api._shellDepth);
      api._changed();
    },
    setGesture(name) { pose.setGesture(name); api._changed(); },
    setPose(name) {
      if (ARM_POSES[name]) pose.setArmPose(name);
      else if (GESTURES[name] || name === 'ripple' || name === 'wave') pose.setGesture(name);
      api._changed();
    },
    setArmAngles(deg) { pose.setArmAngles(deg); api._renderOnce(); },
    setArmAngle(index, deg) { pose.setArmAngle(index, deg); api._changed(); },
    setHandAngles(deg) { pose.setHandAngles(deg); api._renderOnce(); },
    setHandCurl(v) { pose.setHandCurl(v); api._renderOnce(); },
    setPlaying(b) { pose.setPlaying(b); api._changed(); },
    setTime(t) { pose.setTime(t); api._renderOnce(); },
    setSectionOffset(v) { modes.setSectionOffset(v); api._renderOnce(); },

    focus(part) {
      if (api.story && api.story.active) api.story.exit();
      ctx.focusPart(part);
      api._renderOnce();
    },

    render() { api._renderOnce(); },

    applyReferenceFrame(f) {
      pose.cancelMotion();
      modes.set(f.mode === 'open' ? 'open' : 'transparent');
      modes.snapBlend();
      materials.applySkin(f.skin || 'frost', 1);
      api.setIsolate(!!f.isolate);
      pose.setArmAngles(f.armAngles_deg.map(a => a.angle));
      pose.setHandAngles(f.handAngles_deg.map(a => a.angle));
      // exact reference render size (1024x1024) and camera transform
      const w = f.width || 1024, h = f.height || 1024;
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      const cam = f.camera;
      camera.fov = cam.fov_y_deg;
      camera.near = cam.near;
      camera.far = cam.far;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const m = new THREE.Matrix4().fromArray(cam.worldMatrix_columnMajor);
      m.decompose(camera.position, camera.quaternion, new THREE.Vector3());
      camera.quaternion.setFromRotationMatrix(m);
      controls.enabled = false;
      api._renderOnce();
    },

    getLandmarks() { return model.getLandmarks(); },

    setIsolate(on) {
      api._isolate = !!on;
      modes.setIsolate(on);
      api._renderOnce();
    },

    setMaskMode(on) {
      if (on) {
        scene.overrideMaterial = materials.maskMat;
        api._bgSaved = scene.background;
        scene.background = new THREE.Color('#ffffff');
        ctx.env.floor.visible = false;
        ctx.env.contact.visible = false;
      } else {
        scene.overrideMaterial = null;
        scene.background = api._bgSaved;
        ctx.env.floor.visible = true;
        ctx.env.contact.visible = true;
      }
      api._renderOnce();
    },

    exportPNG() { return exportPNG(renderer, scene, camera, 'dex-arm-01-view.png'); },
    exportGLB() { return exportGLB(model.root, 'dex-arm-01.glb'); },
    exportURDF() { return exportURDF('dex_arm_01.urdf'); },
    exportMJCF() { return exportMJCF('dex_arm_01.xml'); },
    exportROS2() { return exportROS2('dex_arm_01_ros2.zip'); },

    // ---- MuJoCo physics (lazy WASM) ----
    async enablePhysics() { const ok = await physics?.enable(); api._changed(); return ok; },
    disablePhysics() { physics?.disable(); api._changed(); },
    async togglePhysics() { const ok = await physics?.toggle(); api._changed(); return ok; },
    dropPhysicsObject() { const pos = physics?.drop(); api._changed(); return pos; },
    resetPhysics() { const ok = physics?.reset(); api._changed(); return ok; },
    getPhysicsState() { return physics?.getState() || null; },

    // ---- Minimum-jerk grasp trajectory ----
    planTrajectory() { const st = trajectory?.planGrasp(); api._changed(); return st; },
    playTrajectory() { const ok = trajectory?.play(); api._changed(); return ok; },
    pauseTrajectory() { trajectory?.pause(); api._changed(); },
    toggleTrajectory() { const on = trajectory?.toggle(); api._changed(); return on; },
    stopTrajectory() { trajectory?.stop(); api._changed(); },
    seekTrajectory(t) { trajectory?.seek(t); api._changed(); },
    setTrajectoryLoop(on) { trajectory?.setLoop(on); api._changed(); },
    exportTrajectory() { return trajectory?.downloadJSON(); },
    getTrajectoryState() { return trajectory?.getState() || null; },

    // ---- WebXR teleoperation ----
    teleopSupported() { return teleop?.isSupported?.() || Promise.resolve(false); },
    async startTeleop() { const ok = await teleop?.start(); api._changed(); return ok; },
    startTeleopMock() { const ok = teleop?.startMock(); api._changed(); return ok; },
    stopTeleop() { teleop?.stop(); api._changed(); },
    getTeleopState() { return teleop?.getState() || null; },

    // ---- Episode recording (LeRobot-shaped JSONL) ----
    startRecording() {
      if (!recorder) return false;
      recorder.setTask(benchmarks?.currentObject ? `grasp the ${benchmarks.currentObject.name}` : 'free-space grasp demonstration');
      recorder.start();
      api._changed();
      return true;
    },
    stopRecording() { const n = recorder?.stop() ?? 0; api._changed(); return n; },
    setRecordImages(on) { api._recordImages = Boolean(on); api._changed(); },
    getEpisodeState() {
      if (!recorder) return null;
      return {
        recording: recorder.recording,
        frames: recorder.frameCount,
        duration: recorder.duration,
        fps: recorder.fps,
        task: recorder.task,
        images: Boolean(api._recordImages),
      };
    },
    exportEpisode() {
      if (!recorder || recorder.frameCount === 0) throw new Error('No recorded frames to export');
      const jsonl = recorder.downloadJSONL();
      const meta = recorder.downloadMeta();
      api._changed();
      return { ...jsonl, meta };
    },

    describePart,

    snapshot() {
      let meshCount = 0;
      scene.traverse(o => { if (o.isMesh && o.visible) meshCount++; });
      return {
        mode: modes.mode,
        skin: materials.skinId,
        gesture: pose.gesture,
        playing: pose.playing,
        armAngles: [...pose.armAngles],
        handAngles: [...pose.handAngles],
        time: pose.time,
        shellDepth: api._shellDepth,
        curl: pose.curl,
        blend: modes.blend,
        story: api.story ? api.story.getState() : null,
        physics: physics?.getState() || null,
        trajectory: trajectory?.getState() || null,
        teleop: teleop?.getState() || null,
        episode: api.getEpisodeState?.() || null,
        stats: {
          meshCount,
          partCount: model.buckets.reduce((a, b) => a + b.parts.length, 0),
          wireCount: (wiring.count || 0) + (model.staticWireCount || 0),
          dynamicWireCount: wiring.count || 0,
        },
      };
    },

    // internal helpers
    _shellDepth: 1,
    _isolate: false,
    _recordImages: false,
    _changed() { ctx.onStateChange?.(api.snapshot()); },
    _renderOnce() {
      pose.flush();
      renderer.render(scene, camera);
      api._changed();
    },
  };

  return api;
}
