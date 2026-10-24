// DEX ARM 01: quintic minimum-jerk trajectory planner and player.
//
// The classic closed-form quintic with zero velocity and acceleration at both
// ends is s(u) = 10u³ − 15u⁴ + 6u⁵. Its peak acceleration occurs at u = 0.5
// and equals 5.7735 / T², which is why every stage here is timed from the
// resulting limit instead of using a constant-velocity ramp.
//
// Everything in this module is framework-free so it can be unit-tested in Node
// and reused by the WebXR teleoperation bridge.

export const MIN_JERK_COEFFICIENTS = Object.freeze([0, 0, 0, 10, -15, 6]);

export function minimumJerk(u) {
  const t = Math.min(1, Math.max(0, Number(u) || 0));
  return t * t * t * (10 + t * (-15 + 6 * t));
}

export function minimumJerkVelocity(u) {
  const t = Math.min(1, Math.max(0, Number(u) || 0));
  return 30 * t * t - 60 * t * t * t + 30 * t * t * t * t;
}

export function minimumJerkAcceleration(u) {
  const t = Math.min(1, Math.max(0, Number(u) || 0));
  return 60 * t - 180 * t * t + 120 * t * t * t;
}

// Peak |ds/du| (u = 0.5) and |d²s/du²| (u = 0.5 ± √3/6) for the profile above.
export const MIN_JERK_PEAK_VELOCITY = 1.875;
export const MIN_JERK_PEAK_ACCELERATION = 5.773502691896258;

export function lerpVector(a, b, s) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * s;
  return out;
}

export function vectorDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// Limits used to warn (never silently clamp) when a stage is too short for the
// requested joint-space step. Values are deliberately conservative for a
// 7-axis arm with a 420 g hand: 90 °/s and 240 °/s².
export const DEFAULT_LIMITS = Object.freeze({
  velocityDegPerSec: 90,
  accelerationDegPerSec2: 240,
});

export function stageDurationFor(stepDeg, limits = DEFAULT_LIMITS) {
  const distance = Math.abs(stepDeg);
  if (distance < 1e-9) return 0.2;
  const byVelocity = (MIN_JERK_PEAK_VELOCITY * distance) / limits.velocityDegPerSec;
  const byAcceleration = Math.sqrt((MIN_JERK_PEAK_ACCELERATION * distance) / limits.accelerationDegPerSec2);
  return Math.max(0.2, byVelocity, byAcceleration);
}

/**
 * Builds a plan from explicit 7/20-joint waypoints.
 * Input stages: { id, label, arm, hand, duration? } where `arm`/`hand` are the
 * state at the END of the stage. The first stage's `from` is taken from `start`.
 */
export function buildPlan({ start, stages, limits = DEFAULT_LIMITS, metadata = {} }) {
  if (!start || !Array.isArray(start.arm) || !Array.isArray(start.hand)) {
    throw new TypeError('buildPlan needs start.arm and start.hand arrays');
  }
  if (!Array.isArray(stages) || stages.length === 0) throw new TypeError('buildPlan needs at least one stage');

  const built = [];
  let cursorArm = [...start.arm];
  let cursorHand = [...start.hand];
  let time = 0;

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (!Array.isArray(stage.arm) || !Array.isArray(stage.hand)) {
      throw new TypeError(`stage ${stage.id || i} needs arm and hand arrays`);
    }
    const armStep = Math.max(...stage.arm.map((v, j) => Math.abs(v - cursorArm[j])));
    const handStep = Math.max(...stage.hand.map((v, j) => Math.abs(v - cursorHand[j])));
    const duration = Number(stage.duration) > 0
      ? Number(stage.duration)
      : Math.max(stageDurationFor(armStep, limits), stageDurationFor(handStep, limits));

    const entry = {
      id: stage.id || `stage-${i}`,
      label: stage.label || stage.id || `Stage ${i + 1}`,
      duration,
      startTime: time,
      from: { arm: [...cursorArm], hand: [...cursorHand] },
      to: { arm: [...stage.arm], hand: [...stage.hand] },
      peakVelocityDegPerSec: (MIN_JERK_PEAK_VELOCITY * Math.max(armStep, handStep)) / duration,
      peakAccelerationDegPerSec2: (MIN_JERK_PEAK_ACCELERATION * Math.max(armStep, handStep)) / (duration * duration),
    };
    built.push(entry);
    cursorArm = [...stage.arm];
    cursorHand = [...stage.hand];
    time += duration;
  }

  return {
    stages: built,
    start: { arm: [...start.arm], hand: [...start.hand] },
    end: { arm: [...cursorArm], hand: [...cursorHand] },
    duration: time,
    limits,
    metadata,
  };
}

export function samplePlan(plan, time) {
  if (!plan || !plan.stages.length) throw new TypeError('samplePlan needs a plan');
  const t = Math.min(plan.duration, Math.max(0, Number(time) || 0));

  let stage = plan.stages[plan.stages.length - 1];
  for (const s of plan.stages) {
    if (t < s.startTime + s.duration) { stage = s; break; }
  }

  const u = stage.duration > 0 ? Math.min(1, Math.max(0, (t - stage.startTime) / stage.duration)) : 1;
  const s = minimumJerk(u);
  const ds = minimumJerkVelocity(u) / stage.duration;
  const dds = minimumJerkAcceleration(u) / (stage.duration * stage.duration);

  const arm = lerpVector(stage.from.arm, stage.to.arm, s);
  const hand = lerpVector(stage.from.hand, stage.to.hand, s);
  const armVelocity = stage.to.arm.map((v, i) => (v - stage.from.arm[i]) * ds);
  const handVelocity = stage.to.hand.map((v, i) => (v - stage.from.hand[i]) * ds);
  const armAcceleration = stage.to.arm.map((v, i) => (v - stage.from.arm[i]) * dds);
  const handAcceleration = stage.to.hand.map((v, i) => (v - stage.from.hand[i]) * dds);

  return {
    time: t,
    duration: plan.duration,
    stageIndex: plan.stages.indexOf(stage),
    stageId: stage.id,
    stageLabel: stage.label,
    stageProgress: s,
    stageTime: t - stage.startTime,
    stageDuration: stage.duration,
    arm,
    hand,
    armVelocity,
    handVelocity,
    armAcceleration,
    handAcceleration,
    peakVelocity: Math.max(...armVelocity.map(Math.abs), ...handVelocity.map(Math.abs)),
    peakAcceleration: Math.max(...armAcceleration.map(Math.abs), ...handAcceleration.map(Math.abs)),
  };
}

export function planToJSON(plan, { frequency = 50, jointNames } = {}) {
  if (!plan) return null;
  const armNames = jointNames?.arm || ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7'];
  const handNames = jointNames?.hand || [
    'index_abd', 'index_mcp', 'index_pip', 'index_dip',
    'middle_abd', 'middle_mcp', 'middle_pip', 'middle_dip',
    'ring_abd', 'ring_mcp', 'ring_pip', 'ring_dip',
    'little_abd', 'little_mcp', 'little_pip', 'little_dip',
    'thumb_abd', 'thumb_cmc', 'thumb_mcp', 'thumb_ip',
  ];
  const steps = Math.max(2, Math.ceil(plan.duration * frequency) + 1);
  const points = [];
  for (let i = 0; i < steps; i++) {
    const s = samplePlan(plan, (i / (steps - 1)) * plan.duration);
    points.push({
      time_from_start: Number(s.time.toFixed(4)),
      positions: [...s.arm, ...s.hand].map((v) => Number(v.toFixed(3))),
      velocities: [...s.armVelocity, ...s.handVelocity].map((v) => Number(v.toFixed(2))),
      accelerations: [...s.armAcceleration, ...s.handAcceleration].map((v) => Number(v.toFixed(2))),
    });
  }
  return {
    trajectory: {
      joint_names: [...armNames, ...handNames],
      dof: 27,
      points,
    },
    metadata: {
      generator: 'dex-arm-01/minimum-jerk',
      profile: 'quintic 10u^3 - 15u^4 + 6u^5',
      duration: plan.duration,
      sample_rate_hz: frequency,
      stages: plan.stages.map((s) => ({
        id: s.id,
        label: s.label,
        start_time: Number(s.startTime.toFixed(3)),
        duration: Number(s.duration.toFixed(3)),
        peak_velocity_deg_s: Number(s.peakVelocityDegPerSec.toFixed(2)),
        peak_acceleration_deg_s2: Number(s.peakAccelerationDegPerSec2.toFixed(2)),
      })),
      ...plan.metadata,
    },
  };
}

export class TrajectoryPlayer {
  constructor(plan, { onFrame = null, loop = false } = {}) {
    this.plan = plan;
    this.onFrame = onFrame;
    this.loop = loop;
    this.time = 0;
    this.playing = false;
  }

  get duration() {
    return this.plan?.duration || 0;
  }

  get progress() {
    return this.duration ? this.time / this.duration : 0;
  }

  play() {
    if (!this.plan) return false;
    if (this.time >= this.duration - 1e-6) this.time = 0;
    this.playing = true;
    return true;
  }

  pause() {
    this.playing = false;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
    return this.playing;
  }

  stop() {
    this.playing = false;
    this.time = 0;
    this.emit();
  }

  seek(time) {
    this.time = Math.min(this.duration, Math.max(0, Number(time) || 0));
    this.emit();
  }

  update(dt) {
    if (!this.plan || !this.playing) return null;
    this.time += Math.min(0.1, Math.max(0, Number(dt) || 0));
    let finished = false;
    if (this.time >= this.duration) {
      if (this.loop) this.time = this.time % this.duration;
      else {
        this.time = this.duration;
        this.playing = false;
        finished = true;
      }
    }
    const frame = this.emit();
    return { ...frame, finished };
  }

  emit() {
    const frame = samplePlan(this.plan, this.time);
    this.onFrame?.(frame);
    return frame;
  }
}
