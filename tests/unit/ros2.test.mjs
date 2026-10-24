import test from 'node:test';
import assert from 'node:assert/strict';
import { generateURDF, MJCF_HAND_JOINTS } from '../../src/robot-specs.js';
import { generateSRDF, generateControllersYAML } from '../../src/ros2-packager.js';

const jointNames = (xml) => [...xml.matchAll(/<joint\s+name="([^"]+)"/g)].map((m) => m[1]);
const linkNames = (xml) => [...xml.matchAll(/<link\s+name="([^"]+)"/g)].map((m) => m[1]);
const stateJoints = (srdf) => [...srdf.matchAll(/<joint\s+name="([^"]+)"\s+value=/g)].map((m) => m[1]);

function controllerJoints(yaml, controller) {
  const lines = yaml.split('\n');
  // Top-level keys only: controller_manager also nests arm_controller/hand_controller.
  const start = lines.findIndex((l) => l === `${controller}:`);
  if (start < 0) throw new Error(`controller ${controller} not found`);
  const jointsAt = lines.findIndex((l, i) => i > start && l.trim() === 'joints:');
  if (jointsAt < 0) throw new Error(`joints list missing for ${controller}`);
  const out = [];
  for (let i = jointsAt + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*(\S+)\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

test('URDF exposes 7 arm and 20 hand revolute joints', () => {
  const urdf = generateURDF();
  const joints = jointNames(urdf);
  for (const arm of ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7']) {
    assert.ok(joints.includes(arm), `missing arm joint ${arm}`);
  }
  const hand = joints.filter((j) => !/^J\d$/.test(j) && j !== 'world_fixed_joint' && j !== 'hand_mount_joint');
  assert.equal(hand.length, 20, `expected 20 hand joints, got ${hand.length}`);
  const expected = MJCF_HAND_JOINTS.map((j) => j.name);
  assert.deepEqual([...hand].sort(), [...expected].sort(), 'URDF hand joints must match MJCF names');
});

test('SRDF links and group states reference URDF names', () => {
  const urdf = generateURDF();
  const urdfJoints = new Set(jointNames(urdf));
  const urdfLinks = new Set(linkNames(urdf));
  const srdf = generateSRDF();

  const srdfJoints = stateJoints(srdf);
  assert.ok(srdfJoints.length >= 27, `expected group states for 27 joints, got ${srdfJoints.length}`);
  for (const j of srdfJoints) assert.ok(urdfJoints.has(j), `SRDF references unknown joint ${j}`);

  const start = srdf.indexOf('<group name="hand">');
  const end = srdf.indexOf('</group>', start);
  assert.ok(start >= 0 && end > start, 'hand group not found');
  for (const link of linkNames(srdf.slice(start, end))) {
    assert.ok(urdfLinks.has(link), `SRDF hand group references unknown link ${link}`);
  }
});

test('controller joint lists match the URDF exactly', () => {
  const urdfJoints = new Set(jointNames(generateURDF()));
  const yaml = generateControllersYAML();
  const arm = controllerJoints(yaml, 'arm_controller');
  const hand = controllerJoints(yaml, 'hand_controller');

  assert.equal(arm.length, 7, `arm controller lists ${arm.length} joints`);
  assert.equal(hand.length, 20, `hand controller lists ${hand.length} joints`);
  for (const j of [...arm, ...hand]) assert.ok(urdfJoints.has(j), `controller references unknown joint ${j}`);
});

test('every URDF revolute joint has finite, ordered limits', () => {
  const urdf = generateURDF();
  let count = 0;
  for (const m of urdf.matchAll(/<joint name="([^"]+)" type="revolute">[\s\S]*?<limit lower="([^"]+)" upper="([^"]+)"/g)) {
    const [, name, lower, upper] = m;
    count++;
    assert.ok(Number.isFinite(Number(lower)), `${name} lower limit`);
    assert.ok(Number.isFinite(Number(upper)), `${name} upper limit`);
    assert.ok(Number(upper) > Number(lower), `${name} limits must be ordered`);
  }
  assert.equal(count, 27, `expected 27 revolute joints, parsed ${count}`);
});
