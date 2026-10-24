// Dirgha Form-7: WebXR hand-tracking teleoperation bridge.
//
// Apple Vision Pro / Quest expose 25 standard hand joints through the WebXR
// Hand Input module. We read the tracked joint spaces each XR frame, reduce
// each finger to four flexion channels, and drive the 20-DoF pose plus the DLS
// arm IK. The mapper lives in hand-mapping.js so it can be unit-tested with
// synthetic joint chains; the session plumbing degrades to a mock driver when
// WebXR is unavailable (desktop review, CI).

import * as THREE from 'three';
import { FINGERS, JOINT_CHAINS, mapHandJoints, mapWristToWorkspace } from './hand-mapping.js';

function toVec(p) {
  if (!p) return [0, 0, 0];
  if (Array.isArray(p)) return p;
  return [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0];
}

export { mapHandJoints, mapWristToWorkspace, turnAngleDeg } from './hand-mapping.js';

export class XRTeleop {
  constructor({ pose, ikSolver, onSample = null, onStatus = null, calibration = {} }) {
    this.pose = pose;
    this.ikSolver = ikSolver;
    this.onSample = onSample;
    this.onStatus = onStatus;
    this.calibration = calibration;

    this.session = null;
    this.referenceSpace = null;
    this.active = false;
    this.mode = null; // 'xr' | 'mock'
    this.frames = 0;
    this.lastHand = new Array(20).fill(0);
    this.lastError = null;
    this._mockTimer = 0;
    this._mockStart = 0;
    this._onXrFrame = this._onXrFrame.bind(this);
  }

  static supported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.xr?.isSessionSupported);
  }

  async isSupported(mode = 'immersive-vr') {
    if (!XRTeleop.supported()) return false;
    try { return await navigator.xr.isSessionSupported(mode); } catch { return false; }
  }

  _status(patch = {}) {
    this.onStatus?.(this.getState(patch));
  }

  getState(patch = {}) {
    return {
      active: this.active,
      mode: this.mode,
      frames: this.frames,
      error: this.lastError,
      hand: [...this.lastHand],
      ...patch,
    };
  }

  async start() {
    if (this.active) return true;
    if (!XRTeleop.supported()) {
      this.lastError = 'WebXR is not available in this browser. Use the mock driver to preview.';
      this._status();
      return false;
    }

    const modes = ['immersive-vr', 'immersive-ar'];
    let session = null;
    let lastErr = null;
    for (const mode of modes) {
      try {
        session = await navigator.xr.requestSession(mode, {
          requiredFeatures: ['hand-tracking'],
          optionalFeatures: ['local-floor', 'bounded-floor'],
        });
        this.mode = 'xr';
        this.xrSessionMode = mode;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!session) {
      this.lastError = `No hand-tracking XR session: ${lastErr?.message || 'unsupported'}`;
      this._status();
      return false;
    }

    try {
      this.session = session;
      this.referenceSpace = await session.requestReferenceSpace('local-floor');
      session.addEventListener('end', () => this.stop(), { once: true });
      this.active = true;
      this.frames = 0;
      this.lastError = null;
      this._status();
      session.requestAnimationFrame(this._onXrFrame);
      return true;
    } catch (err) {
      this.lastError = err?.message || String(err);
      try { session.end(); } catch {}
      this._status();
      return false;
    }
  }

  _onXrFrame(time, frame) {
    if (!this.active || !this.session) return;
    try {
      const input = Array.from(this.session.inputSources || []).find((s) => s.hand);
      if (input?.hand) {
        const joints = {};
        for (const finger of FINGERS) {
          for (const name of JOINT_CHAINS[finger]) {
            const space = input.hand.get(name);
            if (!space) continue;
            const pose = frame.getJointPose(space, this.referenceSpace);
            if (pose) joints[name] = { position: pose.transform.position, orientation: pose.transform.orientation };
          }
        }
        const hand = mapHandJoints(joints);
        this.lastHand = hand;
        this.pose.setHandAngles(hand);

        const wrist = joints['wrist'] || joints['index-finger-metacarpal'];
        if (wrist?.position) {
          const target = mapWristToWorkspace(toVec(wrist.position), this.calibration);
          this._driveArm(target);
          this.onSample?.({ source: 'webxr', hand, wrist: target, frame: this.frames });
        }
        this.frames++;
      }
    } catch (err) {
      this.lastError = err?.message || String(err);
    }
    this.session?.requestAnimationFrame(this._onXrFrame);
  }

  _driveArm(target) {
    if (!this.ikSolver) return;
    this.ikSolver.enabled = true;
    this.ikSolver.gizmo.visible = false; // teleop owns the target; hide the handle
    this.ikSolver.setTargetPosition(new THREE.Vector3(target[0], target[1], target[2]));
    this.ikSolver.solve();
  }

  // Desktop / CI preview: scripted finger curls and a small wrist circle. This
  // exercises exactly the same pose + IK path as a headset, without a session.
  startMock() {
    if (this.active) return true;
    this.active = true;
    this.mode = 'mock';
    this.frames = 0;
    this.lastError = null;
    this._mockStart = performance.now();
    this._status();

    const tick = () => {
      if (!this.active || this.mode !== 'mock') return;
      const t = (performance.now() - this._mockStart) / 1000;
      const hand = new Array(20).fill(0);
      for (let f = 0; f < 4; f++) {
        const phase = t * 1.6 + f * 0.55;
        const curl = 38 + 32 * Math.sin(phase);
        hand[f * 4 + 1] = Math.max(0, curl);
        hand[f * 4 + 2] = Math.max(0, curl * 1.18);
        hand[f * 4 + 3] = Math.max(0, curl * 0.72);
        hand[f * 4 + 0] = Math.sin(t * 0.7 + f) * 8;
      }
      hand[16] = -18;
      hand[17] = 24 + 14 * Math.sin(t * 1.2);
      hand[18] = 20 + 18 * Math.sin(t * 1.2);
      hand[19] = hand[18] * 0.72;
      this.lastHand = hand;
      this.pose.setHandAngles(hand);

      const target = [
        -0.24 + 0.10 * Math.cos(t * 0.6),
        0.30 + 0.06 * Math.sin(t * 0.6),
        0.16 + 0.05 * Math.sin(t * 0.9),
      ];
      this._driveArm(target);
      this.onSample?.({ source: 'mock', hand, wrist: target, frame: this.frames });
      this.frames++;
      this._mockTimer = setTimeout(tick, 33);
    };
    tick();
    return true;
  }

  stop() {
    this.active = false;
    const mode = this.mode;
    this.mode = null;
    if (this._mockTimer) clearTimeout(this._mockTimer);
    this._mockTimer = 0;
    if (this.session) {
      const session = this.session;
      this.session = null;
      try { session.end(); } catch {}
    }
    if (mode === 'xr' && this.ikSolver) {
      this.ikSolver.gizmo.visible = this.ikSolver.enabled;
    }
    this._status();
  }
}
