// Headless simulated episode recorder.
//
// Drives the 27-DoF MuJoCo model through three scripted grasp behaviours with
// randomised object parameters, randomised starting pose and off-centre
// releases, and writes every frame to one JSONL bundle (frames carry
// `episode_index` and `task_index`). `scripts/lerobot_convert.py` turns the
// bundle into a LeRobot v3.0 dataset.
//
// No browser and no GPU: this is state/action data from contact physics, not
// video. Wrist frames require the WebGL page and the in-browser recorder.
//
// Usage: node scripts/record-sim-episodes.mjs [--episodes 100] [--seed 23]

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMJCF, MJCF_HAND_JOINTS } from '../src/robot-specs.js';
import { MujocoRuntime } from '../src/physics/mujoco-runtime.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'data', 'sim');
const DT = 1 / 500;
const RECORD_HZ = 30;
const STEPS_PER_FRAME = Math.round((1 / DT) / RECORD_HZ);

const OPEN = [0, 10, 8, 4, 0, 10, 8, 4, 0, 10, 8, 4, 0, 10, 8, 4, -15, 10, 8, 4];
const CLOSED = [0, 55, 72, 42, 0, 58, 74, 44, 0, 56, 73, 43, 0, 54, 70, 40, -20, 38, 32, 18];

// Digit blocks inside the 20-value hand vector: index, middle, ring, little,
// thumb — four joints each, in the order the MJCF declares them.
const DIGITS = {
  index: [0, 4],
  middle: [4, 8],
  ring: [8, 12],
  little: [12, 16],
  thumb: [16, 20],
};

const BEHAVIOURS = [
  {
    id: 'close_all',
    task: 'close all fingers around a cylinder resting in the palm (simulated)',
    // Everything closes together, then holds.
    plan: [{ frames: 18, blend: 1, digits: ['index', 'middle', 'ring', 'little', 'thumb'] }],
  },
  {
    id: 'pinch_then_cage',
    task: 'pinch the cylinder with thumb and index, then cage it with the remaining fingers (simulated)',
    // Opposition first, then wrap — a different action distribution, same target.
    plan: [
      { frames: 10, blend: 0.75, digits: ['thumb', 'index'] },
      { frames: 8, blend: 1, digits: ['thumb', 'index', 'middle'] },
      { frames: 8, blend: 1, digits: ['ring', 'little'] },
    ],
  },
  {
    id: 'close_then_turn',
    task: 'close the fingers around the cylinder and turn the wrist 20 degrees (simulated)',
    plan: [{ frames: 18, blend: 1, digits: ['index', 'middle', 'ring', 'little', 'thumb'] }],
    // Yaw about J1 keeps the palm face up. Pitching J2 by 8° ejects the object in
    // this collision proxy (measured: held radius 0.066 -> 0.162 m), so the
    // carry demonstration rotates instead of lifting.
    turn: { joint: 0, degrees: 20, frames: 10 },
  },
];

function args(argv) {
  const out = { episodes: 100, seed: 23 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--episodes') out.episodes = Number(argv[++i]);
    else if (argv[i] === '--seed') out.seed = Number(argv[++i]);
  }
  return out;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sample = (rnd, lo, hi) => lo + (hi - lo) * rnd();
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Start from an open hand that is not identical every episode, so the policy
// cannot memorise one initial state.
function jitterPose(rnd, base, amount) {
  return base.map((v) => v + sample(rnd, -amount, amount));
}

function blendDigits(current, target, digits, blend) {
  const next = [...current];
  for (const name of digits) {
    const [from, to] = DIGITS[name];
    for (let i = from; i < to; i++) next[i] = current[i] + (target[i] - current[i]) * blend;
  }
  return next;
}

async function main() {
  const config = args(process.argv.slice(2));
  const rnd = mulberry32(config.seed);
  const mod = await import('@mujoco/mujoco');
  const mj = await mod.default();

  const frames = [];
  const episodes = [];
  let index = 0;

  for (let ep = 0; ep < config.episodes; ep++) {
    const behaviour = BEHAVIOURS[ep % BEHAVIOURS.length];
    const params = {
      radius: sample(rnd, 0.032, 0.040),
      halfLength: sample(rnd, 0.042, 0.054),
      mass: sample(rnd, 0.22, 0.40),
      friction: sample(rnd, 0.70, 1.00),
      // Bench says retention collapses beyond ~4 mm of lateral offset.
      lateral: sample(rnd, -0.003, 0.003),
      along: sample(rnd, 0.004, 0.014),
      // Arm jitter tilts the grasp plane, and this cradle is shallow enough that
      // the resulting gravity component pushes the object out: ±4°/joint left 8 %
      // retained, ±0.8° left 9/34. Variation comes from the release offset and
      // object parameters instead.
      armPose: jitterPose(rnd, new Array(7).fill(0), 0.3),
      // Measured: ±2° of jitter on every open-pose joint drops 1 in 5 grasps
      // (the cradle margin is a few degrees). ±0.5° keeps the grasp while still
      // varying the initial state.
      openPose: jitterPose(rnd, OPEN, 0.5),
    };

    const rt = new MujocoRuntime({
      mj,
      source: 'sim-recorder',
      xml: generateMJCF({
        object: { radius: params.radius, halfLength: params.halfLength, mass: params.mass, friction: params.friction },
      }),
    });

    const episodeStart = frames.length;
    const taskIndex = BEHAVIOURS.findIndex((b) => b.id === behaviour.id);
    const push = (armCmd, handCmd) => {
      const state = rt.readAngles();
      // ACT requires an image input or `observation.environment_state`; this
      // dataset has no camera, so the object pose in the palm frame is the
      // environment channel. It is known exactly here because it is simulated.
      const rel = rt.getPalmRelativeState();
      frames.push({
        frame_index: index,
        episode_index: ep,
        timestamp: Number((index / RECORD_HZ).toFixed(4)),
        task_index: taskIndex,
        task: behaviour.task,
        behaviour: behaviour.id,
        'observation.state': [...state.arm, ...state.hand].map((v) => Number(v.toFixed(3))),
        'observation.environment_state': [...rel.localPosition, ...rel.localQuaternion].map((v) => Number(v.toFixed(4))),
        action: [...armCmd, ...handCmd].map((v) => Number(v.toFixed(3))),
      });
      index++;
    };

    let armCmd = [...params.armPose];
    let handCmd = [...params.openPose];
    let palmHeightAtGrasp = 0;

    try {
      rt.setCommand(armCmd, handCmd);
      rt.dropObject({ lateral: params.lateral, along: params.along, height: 0.16 });

      for (let f = 0; f < 18; f++) {
        for (let s = 0; s < STEPS_PER_FRAME; s++) rt.step(DT);
        push(armCmd, handCmd);
      }

      for (const stage of behaviour.plan) {
        const target = lerp(OPEN, CLOSED, stage.blend);
        for (let f = 1; f <= stage.frames; f++) {
          handCmd = blendDigits(handCmd, target, stage.digits, f / stage.frames);
          rt.setCommand(armCmd, handCmd);
          for (let s = 0; s < STEPS_PER_FRAME; s++) rt.step(DT);
          push(armCmd, handCmd);
        }
      }
      palmHeightAtGrasp = rt.getPalmRelativeState().palmPosition[1];

      if (behaviour.turn) {
        const { joint, degrees, frames: turnFrames } = behaviour.turn;
        for (let f = 1; f <= turnFrames; f++) {
          armCmd = [...armCmd];
          armCmd[joint] = params.armPose[joint] + (degrees * f) / turnFrames;
          rt.setCommand(armCmd, handCmd);
          for (let s = 0; s < STEPS_PER_FRAME; s++) rt.step(DT);
          push(armCmd, handCmd);
        }
      } else {
        for (let f = 0; f < 8; f++) {
          for (let s = 0; s < STEPS_PER_FRAME; s++) rt.step(DT);
          push(armCmd, handCmd);
        }
      }

      const held = rt.getPalmRelativeState();
      const radiusHeld = Math.hypot(...held.localPosition);
      const liftDeltaMm = (held.palmPosition[1] - palmHeightAtGrasp) * 1000;
      const retained = radiusHeld < 0.11 && held.heightAboveFloorMm > 850;

      episodes.push({
        episode_index: ep,
        behaviour: behaviour.id,
        task_index: taskIndex,
        length: frames.length - episodeStart,
        params,
        heldRadiusM: +radiusHeld.toFixed(4),
        liftDeltaMm: +liftDeltaMm.toFixed(2),
        retained,
      });
    } finally {
      rt.dispose();
    }

    const e = episodes[episodes.length - 1];
    const flag = e.retained ? 'held' : 'DROPPED';
    console.log(
      `  ${String(ep + 1).padStart(3)}/${config.episodes}  ${behaviour.id.padEnd(16)} ${flag.padEnd(12)} ` +
      `r=${e.heldRadiusM} m  lift=${e.liftDeltaMm} mm`,
    );
  }

  const retained = episodes.filter((e) => e.retained).length;
  const meta = {
    generated_at: new Date().toISOString(),
    source: 'dex-arm-01/mujoco-sim',
    seed: config.seed,
    fps: RECORD_HZ,
    timestep: DT,
    episodes: episodes.length,
    frames: frames.length,
    retained,
    behaviours: BEHAVIOURS.map((b) => ({ id: b.id, task: b.task })),
    joint_order: MJCF_HAND_JOINTS.map((j) => j.name),
    task: BEHAVIOURS[0].task,
    episode_meta: episodes,
  };    await mkdir(OUT, { recursive: true });

  // Two bundles: every attempt (for auditing the retention rate) and the kept
  // demonstrations. Imitation data should not teach the failure cases.
  const keptIndices = new Set(episodes.filter((e) => e.retained).map((e) => e.episode_index));
  const kept = frames
    .filter((f) => keptIndices.has(f.episode_index))
    .map((f) => ({ ...f }));
  const remap = new Map([...keptIndices].sort((a, b) => a - b).map((old, i) => [old, i]));
  kept.forEach((f, i) => {
    f.episode_index = remap.get(f.episode_index);
    f.frame_index = i;
  });

  await writeFile(join(OUT, 'episodes.jsonl'), kept.map((f) => JSON.stringify(f)).join('\n') + '\n');
  await writeFile(join(OUT, 'episodes-all.jsonl'), frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
  await writeFile(join(OUT, 'meta.json'), JSON.stringify({ ...meta, kept_frames: kept.length, kept_episodes: keptIndices.size }, null, 2));

  console.log(
    `\n${retained}/${episodes.length} episodes retained` +
    `, ${frames.length} frames -> ${OUT}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
