// Dirgha Form-7: six-stage grasp trajectory controller.
//
// Plans in joint space around the live scene: the arm waypoints are produced by
// running the DLS IK solver to a stand-off, contact and lift pose, then restored
// so planning never disturbs what the user sees. Playback is a pure minimum-jerk
// interpolation between those waypoints (see trajectory-player.js).

import * as THREE from 'three';
import { GESTURES } from './pose.js?v=short-20261012';
import { buildPlan, planToJSON, TrajectoryPlayer } from './trajectory-player.js';

export const STAGE_META = [
  { id: 'approach', label: 'Home → pre-grasp', standoff: 0.08 },
  { id: 'preshape', label: 'Finger preshape', standoff: 0.08 },
  { id: 'descend', label: 'Descend to contact', standoff: 0 },
  { id: 'grasp', label: 'Force-closure grasp', standoff: 0 },
  { id: 'lift', label: 'Payload lift +150 mm', standoff: 0.15 },
  { id: 'retract', label: 'Retract → home', standoff: 0.15 },
];

export class GraspTrajectory {
  constructor({ pose, ikSolver, benchmarks, model, onState = null }) {
    this.pose = pose;
    this.ikSolver = ikSolver;
    this.benchmarks = benchmarks;
    this.model = model;
    this.onState = onState;

    this.plan = null;
    this.player = new TrajectoryPlayer(null, {
      onFrame: (frame) => this._applyFrame(frame),
      loop: false,
    });
    this.objectMesh = null;
    this.objectBaseY = 0;
    this.liftHeight = 0.15;
    this.lastFrame = null;
    this.error = null;
  }

  _emit() {
    this.onState?.(this.getState());
  }

  getState() {
    const p = this.player;
    return {
      ready: Boolean(this.plan),
      playing: p.playing,
      loop: p.loop,
      time: p.time,
      duration: p.duration,
      progress: p.progress,
      stageId: this.lastFrame?.stageId || null,
      stageLabel: this.lastFrame?.stageLabel || null,
      stageProgress: this.lastFrame?.stageProgress || 0,
      peakVelocity: this.lastFrame?.peakVelocity || 0,
      peakAcceleration: this.lastFrame?.peakAcceleration || 0,
      stages: this.plan?.stages.map((s) => ({ id: s.id, label: s.label, duration: s.duration })) || [],
      error: this.error,
    };
  }

  _solveAt(point) {
    this.ikSolver.setEnabled(true);
    this.ikSolver.setTargetPosition(point);
    // solve() runs 8 DLS iterations; three passes converge well inside the 2 mm
    // tolerance for the reachable table workspace.
    for (let i = 0; i < 3; i++) this.ikSolver.solve();
    return [...this.pose.armAngles];
  }

  _targetFromScene() {
    const spec = this.benchmarks?.currentObject;
    const mesh = this.benchmarks?.objectMesh;
    if (spec && mesh) {
      return {
        point: mesh.position.clone().add(new THREE.Vector3(0, spec.height * 0.55, 0)),
        graspGesture: spec.recommendedGrasp || 'fist',
        objectName: spec.name,
      };
    }
    // No benchmark object: rehearse the same motion in free space in front of
    // the arm, so the planner is useful without a spawned YCB model.
    const palm = this.model.nodeByName.get('hand');
    const point = new THREE.Vector3();
    if (palm) palm.getWorldPosition(point);
    else point.set(-0.28, 0.16, 0.18);
    point.y += 0.02;
    return { point, graspGesture: 'fist', objectName: 'free-space rehearsal' };
  }

  planGrasp() {
    this.error = null;
    const armSave = [...this.pose.armAngles];
    const handSave = [...this.pose.handAngles];
    const wasEnabled = this.ikSolver.enabled;
    const targetSave = this.ikSolver.target.position.clone();

    try {
      const { point, graspGesture, objectName } = this._targetFromScene();
      const standoff = new THREE.Vector3(0, STAGE_META[0].standoff, 0);
      const lift = new THREE.Vector3(0, this.liftHeight, 0);

      const preGraspArm = this._solveAt(point.clone().add(standoff));
      const contactArm = this._solveAt(point.clone());
      const liftedArm = this._solveAt(point.clone().add(lift));

      const open = [...GESTURES.open.hand];
      const grasp = [...(GESTURES[graspGesture] || GESTURES.fist).hand];
      const relaxed = [...GESTURES.relaxed.hand];

      const homeArm = [...armSave];
      const homeHand = [...handSave];

      this.plan = buildPlan({
        start: { arm: homeArm, hand: homeHand },
        stages: [
          { ...STAGE_META[0], arm: preGraspArm, hand: homeHand },
          { ...STAGE_META[1], arm: preGraspArm, hand: open },
          { ...STAGE_META[2], arm: contactArm, hand: open },
          { ...STAGE_META[3], arm: contactArm, hand: grasp },
          { ...STAGE_META[4], arm: liftedArm, hand: grasp },
          { ...STAGE_META[5], arm: homeArm, hand: relaxed },
        ],
        metadata: {
          task: `grasp:${objectName}`,
          grasp_gesture: graspGesture,
          lift_mm: this.liftHeight * 1000,
          standoff_mm: STAGE_META[0].standoff * 1000,
        },
      });

      this.objectMesh = this.benchmarks?.currentObject ? this.benchmarks?.objectMesh : null;
      this.objectBaseY = this.objectMesh ? this.objectMesh.position.y : 0;
      this.player.plan = this.plan;
      this.player.time = 0;
      this.player.playing = false;
      this.lastFrame = null;
      this._emit();
      return this.getState();
    } catch (err) {
      this.error = err?.message || String(err);
      this._emit();
      return this.getState();
    } finally {
      // Restore the live scene exactly as the user left it.
      this.pose.setArmAngles(armSave);
      this.pose.setHandAngles(handSave);
      this.ikSolver.setEnabled(wasEnabled);
      this.ikSolver.target.position.copy(targetSave);
      this.ikSolver.gizmo.position.copy(targetSave);
    }
  }

  play() {
    if (!this.plan) this.planGrasp();
    if (!this.plan) return false;
    if (this.player.time >= this.player.duration - 1e-6) this.player.seek(0);
    this.player.play();
    this._emit();
    return true;
  }

  pause() {
    this.player.pause();
    this._emit();
  }

  toggle() {
    if (this.player.playing) this.pause();
    else this.play();
    return this.player.playing;
  }

  stop() {
    this.player.pause();
    this.player.seek(0);
    this._restoreObjectPosition();
    this._applyFrame(this.player.emit());
    this._emit();
  }

  setLoop(loop) {
    this.player.loop = Boolean(loop);
    this._emit();
  }

  seek(time) {
    if (!this.plan) return;
    this.player.seek(time);
    this._emit();
  }

  update(dt) {
    if (!this.plan || !this.player.playing) return;
    const result = this.player.update(dt);
    this._emit();
    if (result?.finished) this._restoreObjectPosition();
  }

  _restoreObjectPosition() {
    if (this.objectMesh) this.objectMesh.position.y = this.objectBaseY;
  }

  _applyFrame(frame) {
    this.lastFrame = frame;
    if (!frame) return;
    this.pose.setArmAngles(frame.arm);
    this.pose.setHandAngles(frame.hand);

    if (this.objectMesh) {
      let offset = 0;
      if (frame.stageId === 'lift') offset = this.liftHeight * frame.stageProgress;
      else if (frame.stageId === 'retract') offset = this.liftHeight * (1 - frame.stageProgress);
      this.objectMesh.position.y = this.objectBaseY + offset;
    }
  }

  exportJSON(frequency = 50) {
    if (!this.plan) this.planGrasp();
    if (!this.plan) throw new Error('No trajectory to export');
    return planToJSON(this.plan, { frequency });
  }

  downloadJSON(filename = 'dirgha_form_7_grasp_trajectory.json') {
    const data = this.exportJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    return { bytes: blob.size, filename, points: data.trajectory.points.length };
  }
}
