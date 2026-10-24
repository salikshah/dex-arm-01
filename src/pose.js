// Pose control: 7 arm axes + 20 hand DOF, gestures, arm poses, curl layer,
// ripple/wave timelines, smooth tweens. All angles in DEGREES.
import * as THREE from 'three';
import { ARM_JOINTS, HAND_JOINT_LIMITS } from './params.js';

const D2R = Math.PI / 180;

export const GESTURES = {
  relaxed: {
    label: 'Relaxed',
    hand: [
      2.39855, 6.83, 12.1, 6.38,
      0.34265, 8.89, 15.19, 8.44,
      -1.02795, 12.95, 20.19, 11.5,
      -2.7412, 17.98, 25.1, 14.44,
      -12.05, 15.72, 12.26, 9.17,
    ],
  },
  open: {
    label: 'Open',
    hand: [
      8, 4, 6, 3,
      0, 5, 7, 4,
      -8, 6, 8, 5,
      -14, 9, 12, 7,
      -26, 8, 6, 4,
    ],
  },
  fist: {
    label: 'Fist',
    hand: [
      2, 78, 85, 52,
      0, 82, 88, 55,
      -2, 80, 87, 54,
      -5, 84, 90, 58,
      -32, 48, 42, 24,
    ],
  },
  pinch: {
    label: 'Pinch',
    hand: [
      6, 38, 50, 28,
      2, 14, 20, 12,
      -3, 18, 26, 14,
      -6, 24, 32, 18,
      -34, 34, 26, 14,
    ],
  },
  point: {
    label: 'Point',
    hand: [
      5, 4, 6, 3,
      0, 74, 85, 50,
      -3, 77, 86, 52,
      -6, 80, 88, 55,
      -26, 36, 30, 15,
    ],
  },
  peace: {
    label: 'Peace',
    hand: [
      14, 4, 6, 3,
      -8, 5, 7, 4,
      -4, 74, 85, 52,
      -7, 78, 87, 54,
      -28, 38, 32, 16,
    ],
  },
  three: {
    label: 'Three',
    hand: [
      12, 4, 6, 3,
      0, 5, 7, 4,
      -12, 6, 8, 5,
      -6, 80, 88, 55,
      -28, 42, 38, 22,
    ],
  },
  one: {
    label: 'One',
    hand: [
      5, 4, 6, 3,
      0, 74, 85, 50,
      -3, 77, 86, 52,
      -6, 80, 88, 55,
      -28, 42, 38, 22,
    ],
  },
};

export const ARM_POSES = {
  rest: { label: 'Rest', angles: [-12, 29, 0, 104, 0, -105, 9] },
  reach: { label: 'Reach', angles: [35, 42, 15, 96, -20, -72, 24] },
  greeting: { label: 'Greeting', angles: [8, 58, -18, 122, 12, -38, 32] },
  fold: { label: 'Fold', angles: [-60, 80, 30, 140, 45, -120, -35] },
  precision: { label: 'Precision', angles: [10, 45, 0, 90, 0, -90, 0] },
};

// ripple shape fitted from the 48-frame reference sampling, closed into a
// seamless 4 s loop (every finger returns to base before the wrap).
const RIPPLE = {
  period: 4.0,
  delay: [0.2, 0.58, 0.96, 1.34, 1.72],
  rise: 0.9, fall: 0.85, holdEnd: 2.45, holdScale: 0.3,
  peakF0: [33, 36, 41, 46, 26],
  peakF1: [42, 46, 51, 53, 23],
  peakF2: [24, 26, 28, 30, 15],
};
// wave: continuous sequential curl, sinusoidal — wrap-safe by construction
const WAVE = {
  period: 2.4,
  phase: [0, 0.62, 1.24, 1.86, 2.48],
  peakF0: [55, 58, 60, 62, 38],
  peakF1: [62, 65, 68, 70, 34],
  peakF2: [36, 38, 40, 42, 22],
};
const CURL_PEAK = [0, 72, 84, 48]; // abd, f0, f1, f2 (thumb f0 handled by scale)

function smooth01(x) { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); }

export class Pose {
  constructor(model, wiring) {
    this.model = model;
    this.wiring = wiring;
    this.armAngles = model.data.pose.arm.map(j => j.angle);
    this.handAngles = model.data.pose.hand.map(h => h.angle);
    this.curl = 0;
    this.gesture = 'relaxed';
    this.playing = false;
    this.time = 0;
    this._tween = null;
    this._dirty = true;

    this.armPivots = [];
    this.handPivots = [];
    for (const j of model.data.pose.arm) {
      const obj = model.liveNodes.get(j.pivotNode);
      const meta = ARM_JOINTS.find(a => a.id === j.id);
      this.armPivots.push({ id: j.id, obj, axis: meta.axis, min: meta.min, max: meta.max });
    }
    for (const h of model.data.pose.hand) {
      const obj = model.liveNodes.get(h.node);
      const [finger, kind] = h.id.replace('hand/', '').split('/');
      const isFlex = kind.startsWith('flexion');
      const lim = isFlex ? HAND_JOINT_LIMITS.flexion : HAND_JOINT_LIMITS.spread[finger];
      this.handPivots.push({ id: h.id, obj, axis: h.axis, min: lim[0], max: lim[1], finger, kind });
    }
    this.apply();
  }

  get armJointInfo() {
    return this.armPivots.map(p => ({ id: p.id, label: `${p.id} · ${p.axis.toUpperCase()}-axis`, min: p.min, max: p.max, unit: 'deg' }));
  }
  get handJointInfo() {
    const cap = s => s[0].toUpperCase() + s.slice(1);
    return this.handPivots.map(p => ({
      id: p.id,
      label: `${cap(p.finger)} ${p.kind === 'abduction' ? 'Spread' : 'Flex ' + p.kind.slice(-1)}`,
      min: p.min, max: p.max, unit: 'deg',
    }));
  }

  setArmAngles(deg) {
    for (let i = 0; i < 7; i++) {
      const p = this.armPivots[i];
      this.armAngles[i] = Math.min(p.max, Math.max(p.min, Number(deg[i]) || 0));
    }
    this._tween = null;
    this.apply();
  }

  setArmAngle(index, deg) {
    if (index < 0 || index >= 7) return;
    const p = this.armPivots[index];
    this.armAngles[index] = Math.min(p.max, Math.max(p.min, Number(deg) || 0));
    this._tween = null;
    this.apply();
  }

  setHandAngles(deg) {
    for (let i = 0; i < 20; i++) {
      const p = this.handPivots[i];
      this.handAngles[i] = Math.min(p.max, Math.max(p.min, Number(deg[i]) || 0));
    }
    this._tween = null;
    this.apply();
  }

  setHandCurl(v) {
    this.curl = Math.min(1, Math.max(0, Number(v) || 0));
    this.apply();
  }

  setArmPose(name, duration = 0.9) {
    const p = ARM_POSES[name];
    if (!p) return;
    this._tween = {
      t: 0, dur: duration,
      fromArm: [...this.armAngles], toArm: [...p.angles],
      fromHand: [...this.handAngles], toHand: null,
    };
  }

  setGesture(name, opts = {}) {
    if (name === 'ripple' || name === 'wave') {
      this.gesture = name;
      this._tween = null;
      this.playing = true; // selecting an animated gesture visibly starts it
      return;
    }
    const g = GESTURES[name];
    if (!g) return;
    this.gesture = name;
    const dur = opts.duration ?? 0.7;
    this._tween = {
      t: 0, dur,
      fromArm: [...this.armAngles], toArm: null,
      fromHand: [...this.handAngles], toHand: [...g.hand],
    };
  }

  setPlaying(b) { this.playing = !!b; }
  cancelMotion() {
    this.playing = false;
    this._tween = null;
  }
  setTime(t) {
    this.time = Math.max(0, Number(t) || 0);
    if (this.gesture === 'ripple') this._applyRipple(this.time);
    else if (this.gesture === 'wave') this._applyWave(this.time);
  }

  update(dt) {
    if (this._tween) {
      const tw = this._tween;
      tw.t += dt;
      const u = smooth01(tw.t / tw.dur);
      if (tw.toArm) for (let i = 0; i < 7; i++) this.armAngles[i] = tw.fromArm[i] + (tw.toArm[i] - tw.fromArm[i]) * u;
      if (tw.toHand) for (let i = 0; i < 20; i++) this.handAngles[i] = tw.fromHand[i] + (tw.toHand[i] - tw.fromHand[i]) * u;
      this.apply();
      if (tw.t >= tw.dur) this._tween = null;
    } else if (this.playing) {
      this.time += dt;
      if (this.gesture === 'ripple') this._applyRipple(this.time);
      else if (this.gesture === 'wave') this._applyWave(this.time);
    }
  }

  _applyRipple(t) {
    const T = RIPPLE.period;
    const tt = ((t % T) + T) % T;
    const base = GESTURES.relaxed.hand;
    for (let k = 0; k < 5; k++) {
      const d = RIPPLE.delay[k];
      const rise = smooth01((tt - d) / RIPPLE.rise);
      const fallStart = RIPPLE.holdEnd + d * RIPPLE.holdScale;
      const fall = 1 - smooth01((tt - fallStart) / RIPPLE.fall);
      const c = rise * fall;
      const i = k * 4;
      this.handAngles[i + 1] = base[i + 1] + (RIPPLE.peakF0[k] - base[i + 1]) * c;
      this.handAngles[i + 2] = base[i + 2] + (RIPPLE.peakF1[k] - base[i + 2]) * c;
      this.handAngles[i + 3] = base[i + 3] + (RIPPLE.peakF2[k] - base[i + 3]) * c;
      this.handAngles[i] = base[i] * (1 - 0.4 * c);
    }
    this.apply();
  }

  _applyWave(t) {
    const T = WAVE.period;
    const w = (t / T) * Math.PI * 2;
    const base = GESTURES.relaxed.hand;
    for (let k = 0; k < 5; k++) {
      const s = Math.sin(w - WAVE.phase[k]);
      const c = Math.pow(Math.max(0, s), 1.6);
      const i = k * 4;
      this.handAngles[i + 1] = base[i + 1] + (WAVE.peakF0[k] - base[i + 1]) * c;
      this.handAngles[i + 2] = base[i + 2] + (WAVE.peakF1[k] - base[i + 2]) * c;
      this.handAngles[i + 3] = base[i + 3] + (WAVE.peakF2[k] - base[i + 3]) * c;
    }
    this.apply();
  }

  apply() {
    for (let i = 0; i < 7; i++) {
      const p = this.armPivots[i];
      const a = this.armAngles[i] * D2R / 2;
      const s = Math.sin(a);
      if (p.axis === 'y') p.obj.quaternion.set(0, s, 0, Math.cos(a));
      else p.obj.quaternion.set(0, 0, s, Math.cos(a));
    }
    for (let i = 0; i < 20; i++) {
      const p = this.handPivots[i];
      const seg = i % 4;
      const thumbScale = p.finger === 'thumb' && seg > 0 ? 0.62 : 1;
      const withCurl = this.handAngles[i] + this.curl * CURL_PEAK[seg] * thumbScale;
      const v = Math.min(p.max, Math.max(p.min, withCurl));
      const a = v * D2R / 2;
      const s = Math.sin(a);
      if (p.axis === 'x') p.obj.quaternion.set(s, 0, 0, Math.cos(a));
      else p.obj.quaternion.set(0, 0, s, Math.cos(a));
    }
    this._dirty = true;
  }

  // call after renderer/scene matrix update to refresh dynamic wiring once
  flush() {
    if (!this._dirty) return false;
    this._dirty = false;
    this.model.root.updateMatrixWorld(true);
    this.wiring.update();
    return true;
  }
}
