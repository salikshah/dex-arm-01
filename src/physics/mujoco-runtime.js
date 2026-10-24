// DEX ARM 01: MuJoCo WASM physics runtime.
//
// Loads the canonical Google DeepMind JavaScript bindings lazily, compiles the
// generated 27-DoF MJCF, mirrors commanded joint angles into position servos,
// and exposes palm-relative object state so the Three.js scene can draw the
// free body where the physics engine actually put it.
//
// The WASM build is ~11 MB, so it is never part of the initial page load. The
// local `vendor/mujoco/` copy is preferred (offline, reproducible) and the
// pinned jsDelivr build is the fallback for a fresh clone.

import { generateMJCF, MJCF_ALL_JOINTS, MJCF_HAND_JOINTS } from '../robot-specs.js';

export const MUJOCO_VERSION = '3.17.0';
export const MUJOCO_CDN_URL = `https://cdn.jsdelivr.net/npm/@mujoco/mujoco@${MUJOCO_VERSION}/mujoco.js`;
export const MUJOCO_LOCAL_URL = new URL('../../vendor/mujoco/mujoco.js', import.meta.url).href;

const HAND_ORDER = ['index', 'middle', 'ring', 'little', 'thumb'];

function radians(deg) {
  return (Number(deg) || 0) * Math.PI / 180;
}

function degrees(rad) {
  return (Number(rad) || 0) * 180 / Math.PI;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Rotation matrix (row-major 3x3) → quaternion [w, x, y, z].
export function quatFromMatrix3(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
}

export function quatConjugate([w, x, y, z]) {
  return [w, -x, -y, -z];
}

export function quatMultiply([aw, ax, ay, az], [bw, bx, by, bz]) {
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export function rotateByQuat([w, x, y, z], [vx, vy, vz]) {
  // t = 2 · (q.xyz × v);  v' = v + w·t + q.xyz × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

export async function loadMujoco({ localUrl = MUJOCO_LOCAL_URL, cdnUrl = MUJOCO_CDN_URL, timeoutMs = 30000 } = {}) {
  const attempts = [
    { source: 'vendor', url: localUrl },
    { source: 'cdn', url: cdnUrl },
  ];
  const errors = [];

  for (const attempt of attempts) {
    try {
      const load = withTimeout(import(/* @vite-ignore */ attempt.url), timeoutMs, `MuJoCo import (${attempt.source})`);
      const mod = await load;
      const mj = await withTimeout(Promise.resolve(mod.default ? mod.default() : mod), timeoutMs, `MuJoCo init (${attempt.source})`);
      if (!mj || !mj.MjModel) throw new Error('module did not expose MjModel');
      return { mj, source: attempt.source, url: attempt.url };
    } catch (err) {
      errors.push(`${attempt.source}: ${err?.message || err}`);
    }
  }
  throw new Error(
    'MuJoCo WASM could not be loaded. Run `npm run vendor:mujoco` for an offline copy, or check network access to jsDelivr.\n' +
    errors.join('\n'),
  );
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export class MujocoRuntime {
  constructor({ mj, source = 'unknown', xml = generateMJCF(), timestep = 0.002 }) {
    this.mj = mj;
    this.source = source;
    this.xml = xml;
    this.baseTimestep = timestep;
    this.accumulator = 0;
    this.steps = 0;
    this.ready = false;

    this.model = mj.MjModel.from_xml_string(xml);
    this.data = new mj.MjData(this.model);
    this.timestep = Number(this.model.opt?.timestep) || timestep;

    this.joints = new Map();
    for (const name of MJCF_ALL_JOINTS) {
      this.joints.set(name, {
        qposadr: this.model.jnt(name).qposadr,
        dofadr: this.model.jnt(name).dofadr,
        actuator: this.model.actuator(`act_${name}`).id,
      });
    }
    this.objectJoint = this.model.jnt('object_free');
    this.objectBody = 'grasp_object';
    this.commanded = { arm: new Array(7).fill(0), hand: new Array(20).fill(0) };
    this._quat = new Float64Array(4);
    this.ready = true;
    this.setCommand([0, 0, 0, 0, 0, 0, 0], new Array(20).fill(0));
    mj.mj_forward(this.model, this.data);
  }

  static async create(opts = {}) {
    // Tests and Node scripts can inject an already-initialised module, since
    // Node's ESM loader does not fetch https:// module URLs.
    if (opts.mj) {
      return new MujocoRuntime({ mj: opts.mj, source: opts.source || 'injected', xml: opts.xml || generateMJCF() });
    }
    const loaded = await loadMujoco(opts);
    return new MujocoRuntime({ ...loaded, xml: opts.xml || generateMJCF() });
  }

  get dof() {
    return this.model.njnt;
  }

  get actuatorCount() {
    return this.model.nu;
  }

  _adr(name) {
    const j = this.joints.get(name);
    if (!j) throw new Error(`Unknown joint ${name}`);
    return j;
  }

  _setJoint(name, deg) {
    const j = this._adr(name);
    const range = this.model.jnt(name).range;
    const target = clamp(radians(deg), range[0], range[1]);
    this.data.qpos[j.qposadr] = target;
    this.data.ctrl[j.actuator] = target;
    return target;
  }

  // Drives the position servos. DIP/PIP coupling is enforced by joint equality
  // constraints; their servo targets are kept consistent so they do not fight.
  setCommand(armDeg = this.commanded.arm, handDeg = this.commanded.hand) {
    const arm = [...armDeg].slice(0, 7);
    const hand = [...handDeg].slice(0, 20);
    while (arm.length < 7) arm.push(0);
    while (hand.length < 20) hand.push(0);
    this.commanded = { arm, hand };
    for (let i = 0; i < 7; i++) this._setJoint(`J${i + 1}`, arm[i]);
    for (let i = 0; i < 20; i++) this._setJoint(MJCF_HAND_JOINTS[i].name, hand[i]);

    // Keep coupled joints' targets matched to their drivers (fraction from MJCF).
    const couples = [
      ['index_pip', 'index_dip', 0.67],
      ['middle_pip', 'middle_dip', 0.67],
      ['ring_pip', 'ring_dip', 0.67],
      ['little_pip', 'little_dip', 0.67],
      ['thumb_mcp', 'thumb_ip', 0.72],
    ];
    for (const [driver, follower, ratio] of couples) {
      const jd = this._adr(driver);
      const jf = this._adr(follower);
      const range = this.model.jnt(follower).range;
      const target = clamp(this.data.qpos[jd.qposadr] * ratio, range[0], range[1]);
      this.data.ctrl[jf.actuator] = target;
    }
    this.mj.mj_forward(this.model, this.data);
  }

  setObjectPose(pos, quat = [1, 0, 0, 0]) {
    const adr = this.objectJoint.qposadr;
    this.data.qpos[adr] = pos[0];
    this.data.qpos[adr + 1] = pos[1];
    this.data.qpos[adr + 2] = pos[2];
    this.data.qpos[adr + 3] = quat[0];
    this.data.qpos[adr + 4] = quat[1];
    this.data.qpos[adr + 5] = quat[2];
    this.data.qpos[adr + 6] = quat[3];
    const dof = this.objectJoint.dofadr;
    for (let i = 0; i < 6; i++) this.data.qvel[dof + i] = 0;
    this.mj.mj_forward(this.model, this.data);
  }

  // Releases the free object 180 mm above the palm along its normal and 10 mm
  // toward the fingertips, from rest. With the base pitched so the palm faces
  // up, gravity carries the object into the open grasp. `lateral` (palm-frame
  // X) and `height` are varied by the benchmark to test off-centre releases.
  dropObject({ lateral = 0, along = 0.01, height = 0.18 } = {}) {
    const site = this.data.site('grasp_site');
    const R = this.data.body('palm').xmat;
    const offset = [lateral, along, height];
    const pos = [
      site.xpos[0] + R[0] * offset[0] + R[1] * offset[1] + R[2] * offset[2],
      site.xpos[1] + R[3] * offset[0] + R[4] * offset[1] + R[5] * offset[2],
      site.xpos[2] + R[6] * offset[0] + R[7] * offset[1] + R[8] * offset[2],
    ];
    this.setObjectPose(pos, [1, 0, 0, 0]);
    return pos;
  }

  step(dt) {
    if (!this.ready) return { steps: 0 };
    this.accumulator += clamp(Number(dt) || 0, 0, 0.05);
    let steps = 0;
    const maxSteps = 24;
    while (this.accumulator >= this.timestep && steps < maxSteps) {
      this.mj.mj_step(this.model, this.data);
      this.accumulator -= this.timestep;
      steps++;
    }
    this.steps += steps;
    return { steps, time: this.data.time, contacts: this.data.ncon };
  }

  readAngles() {
    const arm = [];
    const hand = [];
    for (let i = 0; i < 7; i++) arm.push(degrees(this.data.qpos[this._adr(`J${i + 1}`).qposadr]));
    for (let i = 0; i < 20; i++) hand.push(degrees(this.data.qpos[this._adr(MJCF_HAND_JOINTS[i].name).qposadr]));
    return { arm, hand };
  }

  getJointOrder() {
    return [...MJCF_ALL_JOINTS];
  }

  getHandOrder() {
    return HAND_ORDER;
  }

  // Object pose expressed in the palm body frame. The scene draws the object
  // from this so the physics body follows the visual hand without pretending
  // that the two meshes are identical.
  getPalmRelativeState() {
    const palm = this.data.body('palm');
    const object = this.data.body(this.objectBody);
    const R = palm.xmat;
    const qPalm = quatFromMatrix3(R);
    const dx = object.xpos[0] - palm.xpos[0];
    const dy = object.xpos[1] - palm.xpos[1];
    const dz = object.xpos[2] - palm.xpos[2];
    // local = R^T · d
    const local = [
      R[0] * dx + R[3] * dy + R[6] * dz,
      R[1] * dx + R[4] * dy + R[7] * dz,
      R[2] * dx + R[5] * dy + R[8] * dz,
    ];
    const qObj = object.xquat;
    const localQuat = quatMultiply(quatConjugate(qPalm), [qObj[0], qObj[1], qObj[2], qObj[3]]);
    return {
      palmPosition: [palm.xpos[0], palm.xpos[1], palm.xpos[2]],
      palmQuaternion: qPalm,
      objectPosition: [object.xpos[0], object.xpos[1], object.xpos[2]],
      objectQuaternion: [qObj[0], qObj[1], qObj[2], qObj[3]],
      localPosition: local,
      localQuaternion: localQuat,
      heightAboveFloorMm: object.xpos[1] * 1000,
    };
  }

  telemetry() {
    const rel = this.getPalmRelativeState();
    return {
      source: this.source,
      timestep: this.timestep,
      steps: this.steps,
      time: this.data.time,
      contacts: this.data.ncon,
      joints: this.model.njnt,
      actuators: this.model.nu,
      objectLocal: rel.localPosition,
      objectHeightMm: rel.heightAboveFloorMm,
    };
  }

  dispose() {
    this.ready = false;
    try { this.data.delete(); } catch {}
    try { this.model.delete(); } catch {}
  }
}
