import test from 'node:test';
import assert from 'node:assert/strict';
import { mapHandJoints, mapWristToWorkspace, turnAngleDeg } from '../../src/teleop/hand-mapping.js';
import { DatasetRecorder, STATE_NAMES, buildInfo } from '../../src/teleop/dataset-logger.js';

function chain(start, direction, lengths) {
  const pts = [start];
  let [x, y, z] = start;
  for (let i = 0; i < lengths.length; i++) {
    x += direction[i][0] * lengths[i];
    y += direction[i][1] * lengths[i];
    z += direction[i][2] * lengths[i];
    pts.push([x, y, z]);
  }
  return pts;
}

function makeJoints({ bendPip = 0 } = {}) {
  const names = {
    index: ['index-finger-metacarpal', 'index-finger-proximal', 'index-finger-intermediate', 'index-finger-distal', 'index-finger-tip'],
    middle: ['middle-finger-metacarpal', 'middle-finger-proximal', 'middle-finger-intermediate', 'middle-finger-distal', 'middle-finger-tip'],
    ring: ['ring-finger-metacarpal', 'ring-finger-proximal', 'ring-finger-intermediate', 'ring-finger-distal', 'ring-finger-tip'],
  };
  const joints = {};
  const rad = (bendPip * Math.PI) / 180;
  for (const [, list] of Object.entries(names)) {
    // MCP joint at 30 mm, PIP joint at 60 mm; the distal chain bends at PIP.
    const pts = [
      [0, 0, 0],
      [0, 0.03, 0],
      [0, 0.06, 0],
      [0, 0.06 + 0.03 * Math.cos(rad), 0.03 * Math.sin(rad)],
      [0, 0.06 + 0.06 * Math.cos(rad), 0.06 * Math.sin(rad)],
    ];
    list.forEach((name, i) => { joints[name] = pts[i]; });
  }
  return joints;
}

test('turnAngleDeg is zero for a straight chain and 90° for a right angle', () => {
  assert.equal(turnAngleDeg([0, 0, 0], [0, 1, 0], [0, 2, 0]), 0);
  assert.ok(Math.abs(turnAngleDeg([0, 0, 0], [0, 1, 0], [1, 1, 0]) - 90) < 1e-9);
});

test('straight tracked fingers map to zero flexion', () => {
  const hand = mapHandJoints(makeJoints());
  assert.equal(hand.length, 20);
  for (let i = 0; i < 16; i++) {
    const v = i % 4 === 0 ? Math.abs(hand[i]) : hand[i];
    assert.ok(v < 1e-9, `joint ${i} should be straight, got ${hand[i]}`);
  }
});

test('a 90° PIP bend maps into MCP/PIP/DIP channels within limits', () => {
  const hand = mapHandJoints(makeJoints({ bendPip: 90 }));
  for (let f = 0; f < 3; f++) {
    const mcp = hand[f * 4 + 1];
    const pip = hand[f * 4 + 2];
    const dip = hand[f * 4 + 3];
    assert.ok(Math.abs(mcp) < 1e-9, `MCP should stay straight, got ${mcp}`);
    assert.ok(Math.abs(pip - 90) < 1e-6, `PIP bend ${pip}`);
    assert.ok(dip >= 0 && dip <= 95);
  }
  // Little and thumb have no tracked chain in this fixture.
  assert.deepEqual(hand.slice(12), new Array(8).fill(0));
});

test('missing joints degrade to zero instead of NaN', () => {
  const hand = mapHandJoints({ 'index-finger-metacarpal': [0, 0, 0] });
  assert.equal(hand.length, 20);
  assert.ok(hand.every((v) => Number.isFinite(v)));
  assert.ok(hand.every((v) => v === 0));
});

test('wrist calibration scales and offsets into the arm workspace', () => {
  const p = mapWristToWorkspace([0.1, 0.2, -0.1], { scale: 2, offset: [1, 2, 3] });
  assert.deepEqual(p.map((v) => +v.toFixed(6)), [1.2, 2.4, 2.8]);
  const defaults = mapWristToWorkspace([0, 0, 0]);
  assert.equal(defaults.length, 3);
  assert.ok(defaults.every((v) => Number.isFinite(v)));
});

test('dataset info declares the LeRobot v3.0 layout', () => {
  const info = buildInfo({ fps: 30, task: 'grasp the mug', totalFrames: 12, totalEpisodes: 1 });
  assert.equal(info.codebase_version, 'v3.0');
  assert.equal(info.robot_type, 'dirgha_form_7');
  assert.equal(info.features['observation.state'].shape[0], 27);
  assert.equal(info.features['observation.state'].names.motors.length, 27);
  assert.equal(info.features['observation.tactile'].shape[0], 6);
  assert.equal(info.features['observation.images.wrist'].dtype, 'video');
  assert.deepEqual(info.splits, { train: '0:1' });
  assert.match(info.data_path, /chunk-\{chunk_index:03d\}/);
  assert.match(info.video_path, /\{video_key\}/);
  assert.equal(info.total_frames, 12);
});

test('recorder throttles to 30 Hz and emits valid JSONL', () => {
  const rec = new DatasetRecorder({ fps: 30 });
  rec.start();
  const sample = {
    armAngles: new Array(7).fill(0),
    handAngles: new Array(20).fill(0),
    tensions: { thumb: 8, index: 9, middle: 10, ring: 11, little: 12 },
    epsilon: 0.42,
  };

  assert.ok(rec.tick(1000, sample));
  assert.equal(rec.tick(1010, sample), null, 'second frame inside 33 ms is dropped');
  assert.ok(rec.tick(1040, sample));
  assert.equal(rec.frameCount, 2);

  const line = rec.toJSONL().trim().split('\n')[1];
  const frame = JSON.parse(line);
  assert.equal(frame['observation.state'].length, 27);
  assert.equal(frame['observation.tactile'].length, 6);
  assert.equal(frame['observation.tactile'][5], 0.42);
  assert.equal(frame.action.length, 27);
  assert.equal(frame.task, 'grasp');
  assert.ok(Math.abs(frame.timestamp - 0.04) < 1e-6);

  rec.stop();
  assert.equal(rec.toInfo().total_frames, 2);
  assert.equal(rec.toEpisodeMeta().length, 2);
  assert.equal(STATE_NAMES.length, 27);
});
