import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_JERK_PEAK_ACCELERATION,
  MIN_JERK_PEAK_VELOCITY,
  buildPlan,
  minimumJerk,
  minimumJerkAcceleration,
  minimumJerkVelocity,
  planToJSON,
  samplePlan,
  stageDurationFor,
} from '../../src/trajectory-player.js';

const arm = (v) => new Array(7).fill(v);
const hand = (v) => new Array(20).fill(v);

test('quintic profile has zero position, velocity and acceleration at both ends', () => {
  for (const u of [0, 1]) {
    assert.equal(minimumJerkVelocity(u), 0);
    assert.equal(minimumJerkAcceleration(u), 0);
  }
  assert.equal(minimumJerk(0), 0);
  assert.equal(minimumJerk(1), 1);
});

test('profile is monotonic and symmetric about the midpoint', () => {
  let prev = -Infinity;
  for (let i = 0; i <= 200; i++) {
    const s = minimumJerk(i / 200);
    assert.ok(s >= prev, `not monotonic at ${i}`);
    prev = s;
  }
  for (const u of [0.1, 0.25, 0.4]) {
    assert.ok(Math.abs(minimumJerk(u) + minimumJerk(1 - u) - 1) < 1e-12);
  }
  assert.ok(Math.abs(minimumJerk(0.5) - 0.5) < 1e-12);
});

test('peak velocity and acceleration of the profile match the closed form', () => {
  let peakV = 0;
  let peakA = 0;
  for (let i = 0; i <= 2000; i++) {
    const u = i / 2000;
    peakV = Math.max(peakV, minimumJerkVelocity(u));
    peakA = Math.max(peakA, minimumJerkAcceleration(u));
  }
  assert.ok(Math.abs(peakV - MIN_JERK_PEAK_VELOCITY) < 1e-3, `peak velocity ${peakV}`);
  assert.ok(Math.abs(peakA - MIN_JERK_PEAK_ACCELERATION) < 1e-3, `peak acceleration ${peakA}`);
});

test('stage durations respect conservative joint limits', () => {
  const fast = stageDurationFor(5);
  const far = stageDurationFor(180);
  assert.ok(far > fast);
  assert.ok(far > 0.9, `180° stage should take > 0.9 s, got ${far}`);
  const d = stageDurationFor(90);
  assert.ok((MIN_JERK_PEAK_ACCELERATION * 90) / (d * d) <= 240 + 1e-9);
  assert.ok((MIN_JERK_PEAK_VELOCITY * 90) / d <= 90 + 1e-9);
});

test('buildPlan chains stages and samples continuously', () => {
  const plan = buildPlan({
    start: { arm: arm(0), hand: hand(0) },
    stages: [
      { id: 'a', label: 'A', arm: arm(30), hand: hand(0) },
      { id: 'b', label: 'B', arm: arm(30), hand: hand(60) },
    ],
    limits: { velocityDegPerSec: 90, accelerationDegPerSec2: 240 },
  });

  assert.equal(plan.stages.length, 2);
  assert.equal(plan.stages[1].from.arm[0], 30);
  assert.ok(Math.abs(plan.duration - plan.stages.reduce((s, x) => s + x.duration, 0)) < 1e-12);

  const start = samplePlan(plan, 0);
  const mid = samplePlan(plan, plan.stages[0].startTime + plan.stages[0].duration / 2);
  const end = samplePlan(plan, plan.duration);

  assert.ok(Math.abs(start.arm[0]) < 1e-9);
  assert.ok(Math.abs(end.arm[0] - 30) < 1e-9);
  assert.ok(Math.abs(end.hand[0] - 60) < 1e-9);
  assert.equal(mid.stageId, 'a');
  assert.ok(mid.arm[0] > 0 && mid.arm[0] < 30);
  assert.equal(mid.arm[0], 15, 'midpoint of a minimum-jerk move is the halfway angle');
});

test('sampling clamps out-of-range times and reports limits', () => {
  const plan = buildPlan({ start: { arm: arm(0), hand: hand(0) }, stages: [{ id: 'one', arm: arm(10), hand: hand(0) }] });
  const before = samplePlan(plan, -5);
  const after = samplePlan(plan, plan.duration + 5);
  assert.equal(before.time, 0);
  assert.equal(after.time, plan.duration);
  assert.ok(before.peakAcceleration <= plan.stages[0].peakAccelerationDegPerSec2 * MIN_JERK_PEAK_ACCELERATION + 1e-6);
});

test('planToJSON emits 27-DoF points with timestamps and metadata', () => {
  const plan = buildPlan({
    start: { arm: arm(0), hand: hand(0) },
    stages: [
      { id: 'a', arm: arm(20), hand: hand(40), duration: 0.4 },
      { id: 'b', arm: arm(20), hand: hand(40), duration: 0.2 },
    ],
    metadata: { task: 'unit-test' },
  });
  const json = planToJSON(plan, { frequency: 50 });
  assert.equal(json.trajectory.joint_names.length, 27);
  assert.equal(json.trajectory.dof, 27);
  assert.ok(json.trajectory.points.length >= 20);
  assert.equal(json.trajectory.points[0].positions.length, 27);
  assert.equal(json.trajectory.points.at(-1).positions[7], 40);
  assert.ok(Math.abs(json.trajectory.points.at(-1).time_from_start - 0.6) < 1e-3);
  assert.equal(json.metadata.task, 'unit-test');
  assert.equal(json.metadata.profile, 'quintic 10u^3 - 15u^4 + 6u^5');
});
