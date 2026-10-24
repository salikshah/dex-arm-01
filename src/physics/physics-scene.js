// Dirgha Form-7: Three.js ⇄ MuJoCo bridge.
//
// Owns the lazily-created WASM runtime, feeds it the commanded joint pose, and
// draws the free physics body in the visual hand's frame. The visual hand and
// the collision proxy are not the same mesh, so joint positions are NOT copied
// back into the kinematic model — that would make the position servos chase
// their own gravity sag. What is shared is the object's pose in the palm frame,
// which is the part of the simulation we can honestly display.

import * as THREE from 'three';
import { GESTURES } from '../pose.js?v=short-20261012';
import { MujocoRuntime } from './mujoco-runtime.js';

export class PhysicsScene {
  constructor({ scene, model, pose, onStatus = () => {} }) {
    this.scene = scene;
    this.model = model;
    this.pose = pose;
    this.onStatus = onStatus;

    this.runtime = null;
    this.enabled = false;
    this.status = 'idle'; // idle | loading | running | error
    this.error = null;
    this.source = null;
    this.lastTelemetry = null;
    this.lastDrop = null;

    this.group = new THREE.Group();
    this.group.name = 'MuJoCo_Physics_Object';
    this.group.visible = false;
    this.scene.add(this.group);

    // MuJoCo cylinders are aligned with the body's local Z; Three.js cylinders
    // are Y-aligned, so bake the difference into the geometry.
    const objectGeometry = new THREE.CylinderGeometry(0.038, 0.038, 0.10, 32);
    objectGeometry.rotateX(Math.PI / 2);
    this.proxy = new THREE.Mesh(
      objectGeometry,
      new THREE.MeshStandardMaterial({ color: 0xb45309, metalness: 0.55, roughness: 0.32 }),
    );
    this.proxy.castShadow = true;
    this.group.add(this.proxy);

    this.contactRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.052, 0.0025, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.65 }),
    );
    this.contactRing.visible = false;
    this.group.add(this.contactRing);

    this._palmPosition = new THREE.Vector3();
    this._palmQuaternion = new THREE.Quaternion();
    this._localPosition = new THREE.Vector3();
    this._localQuaternion = new THREE.Quaternion();
  }

  setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.onStatus?.(this.getState());
  }

  async enable() {
    if (this.status === 'running') return true;
    if (this.status === 'loading') return false;
    this.setStatus('loading');
    try {
      const runtime = await MujocoRuntime.create();
      this.runtime = runtime;
      this.source = runtime.source;
      this.enabled = true;
      this.group.visible = true;
      this.setStatus('running');
      this.drop();
      return true;
    } catch (err) {
      this.enabled = false;
      this.group.visible = false;
      this.setStatus('error', err?.message || String(err));
      return false;
    }
  }

  disable() {
    this.enabled = false;
    this.group.visible = false;
    this.contactRing.visible = false;
    if (this.status !== 'error') this.setStatus('idle');
  }

  toggle() {
    if (this.enabled) {
      this.disable();
      return Promise.resolve(false);
    }
    return this.enable();
  }

  // Stage the palm-up drop pose, then release a fresh object. The MJCF base is
  // pitched so zero arm angles put the open palm face up; visual and physical
  // hands therefore share the same joint command for the demo.
  drop({ stagePose = true } = {}) {
    if (!this.runtime) return null;
    if (stagePose) {
      this.pose.setArmAngles(new Array(7).fill(0));
      this.pose.setHandAngles([...GESTURES.open.hand]);
    }
    this.runtime.setCommand(this.pose.armAngles, this.pose.handAngles);
    const pos = this.runtime.dropObject();
    this.lastDrop = pos;
    this.group.visible = true;
    return pos;
  }

  reset() {
    if (!this.runtime) return false;
    this.runtime.setCommand(this.pose.armAngles, this.pose.handAngles);
    this.drop();
    return true;
  }

  update(dt) {
    if (!this.runtime || !this.enabled) return;
    this.runtime.setCommand(this.pose.armAngles, this.pose.handAngles);
    this.runtime.step(dt);
    const rel = this.runtime.getPalmRelativeState();
    this.lastTelemetry = this.runtime.telemetry();

    const palm = this.model.nodeByName.get('hand') || this.model.nodeByName.get('palm');
    if (!palm) return;
    palm.getWorldPosition(this._palmPosition);
    palm.getWorldQuaternion(this._palmQuaternion);

    this._localPosition.set(...rel.localPosition).applyQuaternion(this._palmQuaternion);
    this.proxy.position.copy(this._palmPosition).add(this._localPosition);
    this._localQuaternion.set(
      rel.localQuaternion[1], rel.localQuaternion[2], rel.localQuaternion[3], rel.localQuaternion[0],
    );
    this.proxy.quaternion.copy(this._palmQuaternion).multiply(this._localQuaternion);

    // A contact ring appears when the object is close enough to be inside the
    // finger envelope (within 60 mm of the palm surface).
    const inside = Math.hypot(rel.localPosition[0], rel.localPosition[1], rel.localPosition[2]) < 0.10;
    this.contactRing.visible = inside;
    this.contactRing.position.copy(this.proxy.position);
    this.contactRing.quaternion.copy(this.proxy.quaternion);
  }

  getState() {
    return {
      status: this.status,
      enabled: this.enabled,
      source: this.source,
      error: this.error,
      telemetry: this.lastTelemetry,
    };
  }

  dispose() {
    this.runtime?.dispose();
    this.runtime = null;
    this.enabled = false;
    this.scene.remove(this.group);
  }
}
