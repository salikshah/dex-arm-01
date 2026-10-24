import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMJCF, MJCF_ALL_JOINTS, MJCF_HAND_JOINTS } from '../../src/robot-specs.js';
import {
  MujocoRuntime,
  loadMujoco,
  quatConjugate,
  quatFromMatrix3,
  quatMultiply,
  rotateByQuat,
} from '../../src/physics/mujoco-runtime.js';

let mj = null;
try {
  const mod = await import('@mujoco/mujoco');
  mj = await mod.default();
} catch {
  try {
    const loaded = await loadMujoco();
    mj = loaded.mj;
  } catch (err) {
    mj = null;
    console.warn('MuJoCo devDependency unavailable, physics tests will be skipped:', err.message);
  }
}

const skipOpts = { skip: mj ? false : 'install devDependencies or vendor MuJoCo to run physics tests' };

test('MJCF declares 7 arm + 20 hand joints and 27 actuators', skipOpts, () => {
  assert.equal(MJCF_ALL_JOINTS.length, 27);
  assert.equal(MJCF_HAND_JOINTS.length, 20);
  const model = mj.MjModel.from_xml_string(generateMJCF());
  assert.equal(model.njnt, 28, '27 hinges + one free joint');
  assert.equal(model.nu, 27);
  assert.equal(model.neq, 5, 'four DIP/PIP couples plus thumb IP');
  for (const name of MJCF_ALL_JOINTS) {
    assert.ok(model.jnt(name).qposadr >= 0, `missing joint ${name}`);
    assert.ok(model.actuator(`act_${name}`).id >= 0, `missing actuator for ${name}`);
  }
  model.delete();
});

test('runtime maps commanded degrees into radians and drives the servos', skipOpts, async () => {
  const rt = await MujocoRuntime.create({ mj });
  rt.setCommand([0, 30, 0, 90, 0, -80, 0], new Array(20).fill(0));
  const read = rt.readAngles();
  assert.ok(Math.abs(read.arm[1] - 30) < 1e-6);
  assert.ok(Math.abs(read.arm[3] - 90) < 1e-6);
  assert.ok(Math.abs(read.arm[5] + 80) < 1e-6);
  assert.equal(rt.dof, 28);
  assert.equal(rt.actuatorCount, 27);
  rt.setCommand([0, 0, 0, 0, 0, 0, 0], new Array(20).fill(0));
  rt.data.qpos[rt._adr('index_pip').qposadr] = 1.0;
  rt.data.ctrl[rt._adr('index_pip').actuator] = 1.0;
  rt.data.ctrl[rt._adr('index_dip').actuator] = 0.67;
  for (let i = 0; i < 800; i++) rt.step(1 / 500);
  const pip = rt.data.qpos[rt._adr('index_pip').qposadr];
  const dip = rt.data.qpos[rt._adr('index_dip').qposadr];
  const ratio = dip / pip;
  assert.ok(ratio > 0.6 && ratio < 0.72, `DIP/PIP coupling should be ≈0.67, got ${ratio.toFixed(3)}`);
  rt.dispose();
});

test('dropped object lands in an open palm and is retained when fingers close', skipOpts, async () => {
  const rt = await MujocoRuntime.create({ mj });
  const open = [0, 10, 8, 4, 0, 10, 8, 4, 0, 10, 8, 4, 0, 10, 8, 4, -15, 10, 8, 4];
  const closed = [0, 55, 72, 42, 0, 58, 74, 44, 0, 56, 73, 43, 0, 54, 70, 40, -20, 38, 32, 18];

  rt.setCommand([0, 0, 0, 0, 0, 0, 0], open);
  const drop = rt.dropObject();
  assert.ok(drop[1] > 1.0, 'object starts above the palm');

  for (let i = 0; i < 250; i++) rt.step(1 / 500);
  const landed = rt.getPalmRelativeState();
  assert.ok(Math.abs(landed.localPosition[0]) < 0.05, `lateral drift ${landed.localPosition[0]}`);
  assert.ok(landed.localPosition[2] > 0.02, 'object rests on the palm side');

  // Gradual finger closure, as a gesture tween would produce.
  for (let k = 1; k <= 20; k++) {
    const blend = k / 20;
    const hand = open.map((v, i) => v + (closed[i] - v) * blend);
    rt.setCommand([0, 0, 0, 0, 0, 0, 0], hand);
    for (let i = 0; i < 30; i++) rt.step(1 / 500);
  }

  const held = rt.getPalmRelativeState();
  const radius = Math.hypot(...held.localPosition);
  assert.ok(radius < 0.14, `object should stay inside the grasp, got ${radius.toFixed(3)} m`);
  assert.ok(held.heightAboveFloorMm > 900, 'object should not reach the floor');
  rt.dispose();
});

test('quaternion helpers agree with rotation matrices and rotations', () => {
  const identity = quatFromMatrix3([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(identity.map((v) => +v.toFixed(6)), [1, 0, 0, 0]);

  const s = Math.SQRT1_2;
  const q = quatFromMatrix3([0, -1, 0, 1, 0, 0, 0, 0, 1]); // +90° about Z
  const rotated = rotateByQuat(q, [1, 0, 0]);
  assert.ok(Math.abs(rotated[0]) < 1e-9);
  assert.ok(Math.abs(rotated[1] - 1) < 1e-9);
  assert.ok(Math.abs(q[3] - s) < 1e-9);

  const conj = quatConjugate(q);
  const composed = quatMultiply(q, conj);
  assert.ok(Math.abs(composed[0] - 1) < 1e-9);
  assert.ok(Math.abs(composed[1]) < 1e-9);
});
