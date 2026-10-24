// Headless grasp benchmark for Dirgha Form-7.
//
// Protocol, per episode:
//   1. build the MJCF with a randomised grasp target (radius, length, mass,
//      surface friction) and compile it in MuJoCo,
//   2. command the open hand, release the object from a randomised offset
//      180 mm above the palm, let gravity settle it for 500 ms,
//   3. close the fingers over 600 ms, hold for 400 ms, and
//   4. call the episode a success if the object is still inside the finger
//      envelope, above the floor, and has not slipped while held.
//
// This measures the *simulated* hand against a proxy collision geometry. It is
// not a hardware success rate and it does not validate the visual mesh; see
// bench/README.md for what the numbers do and do not mean.
//
// Usage: node bench/drop-benchmark.mjs [--episodes 100] [--seed 7] [--out bench/results]

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMJCF } from '../src/robot-specs.js';
import { MujocoRuntime } from '../src/physics/mujoco-runtime.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DT = 1 / 500;

const OPEN = [0, 10, 8, 4, 0, 10, 8, 4, 0, 10, 8, 4, 0, 10, 8, 4, -15, 10, 8, 4];
const CLOSED = [0, 55, 72, 42, 0, 58, 74, 44, 0, 56, 73, 43, 0, 54, 70, 40, -20, 38, 32, 18];

const HOLD_RADIUS_M = 0.11;   // object centre must stay inside the finger envelope
const MIN_HEIGHT_MM = 850;    // and well clear of the floor
const MAX_SLIP_M = 0.030;     // movement while held counts as a dropped grasp

function args(argv) {
  const out = { episodes: 100, seed: 7, out: join(HERE, 'results') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--episodes') out.episodes = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

// Deterministic PRNG so a reported success rate can be reproduced exactly.
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

function lerpArray(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

// The WASM binding's `mj_contactForce` returns zeros for this model, so contact
// force is not reported. Instead we track how hard the fingers *hit* the object:
// the peak linear acceleration of the free body during closure, in g. A hand
// that surrounds a target imparts little acceleration; one that bats it away
// produces spikes. This is measured from qvel, which the binding does expose.
function objectAccelG(data, dofadr, prevVel, dt) {
  if (!prevVel) {
    prevVel.vx = data.qvel[dofadr];
    prevVel.vy = data.qvel[dofadr + 1];
    prevVel.vz = data.qvel[dofadr + 2];
    return 0;
  }
  const ax = (data.qvel[dofadr] - prevVel.vx) / dt;
  const ay = (data.qvel[dofadr + 1] - prevVel.vy) / dt;
  const az = (data.qvel[dofadr + 2] - prevVel.vz) / dt;
  prevVel.vx = data.qvel[dofadr];
  prevVel.vy = data.qvel[dofadr + 1];
  prevVel.vz = data.qvel[dofadr + 2];
  return Math.hypot(ax, ay, az) / 9.81;
}

async function runEpisode(mj, rnd, index) {
  const params = {
    radius: sample(rnd, 0.030, 0.042),
    halfLength: sample(rnd, 0.040, 0.056),
    mass: sample(rnd, 0.20, 0.45),
    friction: sample(rnd, 0.55, 1.05),
    lateral: sample(rnd, -0.012, 0.012),
    along: sample(rnd, -0.004, 0.016),
  };
  const xml = generateMJCF({
    object: {
      radius: params.radius,
      halfLength: params.halfLength,
      mass: params.mass,
      friction: params.friction,
    },
  });
  const rt = new MujocoRuntime({ mj, source: 'bench', xml });
  const dof = rt.objectJoint.dofadr;
  const prevVel = { vx: 0, vy: 0, vz: 0 };
  let peakAccelG = 0;
  let maxContacts = 0;
  const track = () => {
    const g = objectAccelG(rt.data, dof, prevVel, DT);
    if (g > peakAccelG) peakAccelG = g;
    if (rt.data.ncon > maxContacts) maxContacts = rt.data.ncon;
  };

  try {
    rt.setCommand(new Array(7).fill(0), OPEN);
    rt.dropObject({ lateral: params.lateral, along: params.along, height: 0.18 });

    for (let i = 0; i < 250; i++) {
      rt.step(DT);
      track();
    }
    const landed = rt.getPalmRelativeState();
    const landedRadius = Math.hypot(...landed.localPosition);

    // Closure impacts are what this measures: a surrounding grasp accelerates
    // the target gently, a bat-away grasp spikes it.
    peakAccelG = 0;
    for (let k = 1; k <= 20; k++) {
      rt.setCommand(new Array(7).fill(0), lerpArray(OPEN, CLOSED, k / 20));
      for (let i = 0; i < 30; i++) {
        rt.step(DT);
        track();
      }
    }
    const grasped = rt.getPalmRelativeState();
    const closureAccelG = peakAccelG;

    peakAccelG = 0;
    for (let i = 0; i < 200; i++) {
      rt.step(DT);
      track();
    }
    const held = rt.getPalmRelativeState();
    const holdAccelG = peakAccelG;

    const heldRadius = Math.hypot(...held.localPosition);
    const slip = Math.hypot(
      held.localPosition[0] - grasped.localPosition[0],
      held.localPosition[1] - grasped.localPosition[1],
      held.localPosition[2] - grasped.localPosition[2],
    );
    const insideEnvelope = heldRadius < HOLD_RADIUS_M;
    const aboveFloor = held.heightAboveFloorMm > MIN_HEIGHT_MM;
    const stable = slip < MAX_SLIP_M;
    const success = insideEnvelope && aboveFloor && stable;

    return {
      episode: index,
      params,
      landedRadiusM: +landedRadius.toFixed(4),
      heldRadiusM: +heldRadius.toFixed(4),
      slipM: +slip.toFixed(4),
      heightMm: +held.heightAboveFloorMm.toFixed(1),
      closureAccelG: +closureAccelG.toFixed(2),
      holdAccelG: +holdAccelG.toFixed(2),
      maxContacts,
      insideEnvelope,
      aboveFloor,
      stable,
      success,
    };
  } finally {
    rt.dispose();
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function wilson(successes, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function markdown(result) {
  const s = result.summary;
  const rows = result.episodes
    .slice()
    .sort((a, b) => Number(a.success) - Number(b.success))
    .slice(0, 8)
    .map((e) =>
      `| ${e.episode} | ${(e.params.radius * 1000).toFixed(1)} | ${(e.params.halfLength * 1000).toFixed(1)} | ${e.params.mass.toFixed(2)} | ${e.params.friction.toFixed(2)} | ${(e.params.lateral * 1000).toFixed(1)} | ${e.heldRadiusM.toFixed(3)} | ${e.slipM.toFixed(3)} | ${e.success ? 'pass' : 'fail'} |`,
    );

  return `# MuJoCo drop benchmark — ${result.generatedAt}

Protocol: ${result.episodes.length} randomised releases, seed ${result.seed},
500 Hz, open-hand release from 180 mm, 500 ms settle, 600 ms finger closure,
400 ms hold. Success = object still inside the finger envelope
(${HOLD_RADIUS_M * 1000} mm), above ${MIN_HEIGHT_MM} mm, and slipping less than
${MAX_SLIP_M * 1000} mm while held. Simulated collision proxy only, not hardware.
Force sensing is not reported: the WASM contact-force binding returns zeros
for this model, so the table reports closure-time object acceleration instead.

## Summary

| Metric | Value |
| :--- | :--- |
| Episodes | ${s.episodes} |
| Successes | ${s.successes} |
| Success rate | ${(s.successRate * 100).toFixed(1)} % (95 % CI ${(s.ci95[0] * 100).toFixed(1)}–${(s.ci95[1] * 100).toFixed(1)} %) |
| Median hold radius (successful) | ${s.heldRadiusUSD[0] === null ? 'n/a' : `${(s.heldRadiusUSD[0] * 1000).toFixed(1)} mm`} |
| Closure impact p50 / p90 / max | ${s.closureAccelG.p50 ?? 'n/a'} / ${s.closureAccelG.p90 ?? 'n/a'} / ${s.closureAccelG.max ?? 'n/a'} g |
| Contacts observed (max) | ${s.maxContacts} |
| Success with lateral offset ≤ 4 mm | ${s.lateralBins.near.successes}/${s.lateralBins.near.episodes} |
| Success with lateral offset > 4 mm | ${s.lateralBins.far.successes}/${s.lateralBins.far.episodes} |
| Failed: left the envelope | ${s.failureModes.outsideEnvelope} |
| Failed: reached the floor | ${s.failureModes.floor} |
| Failed: slipped while held | ${s.failureModes.slip} |

Failure modes are not exclusive: an object that escapes usually also reaches the
floor. Percentages are out of all ${s.episodes} episodes.

## Worst eight episodes

| # | radius mm | length mm | mass kg | friction | drop dx mm | hold r (m) | slip (m) | result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
${rows.join('\n')}
`;
}

async function main() {
  const config = args(process.argv.slice(2));
  const rnd = mulberry32(config.seed);

  const mod = await import('@mujoco/mujoco');
  const mj = await mod.default();
  console.log(`Dirgha Form-7 drop benchmark — ${config.episodes} episodes, seed ${config.seed}`);

  const episodes = [];
  const started = Date.now();
  for (let i = 0; i < config.episodes; i++) {
    const ep = await runEpisode(mj, rnd, i);
    episodes.push(ep);
    const flag = ep.success ? 'pass' : 'FAIL';
    process.stdout.write(
      `  ${String(i + 1).padStart(3)}/${config.episodes}  ${flag}  r=${ep.heldRadiusM.toFixed(3)} m  slip=${ep.slipM.toFixed(3)} m  impact=${ep.closureAccelG} g\n`,
    );
  }
  const elapsedMs = Date.now() - started;

  const successes = episodes.filter((e) => e.success).length;
  const forces = episodes.map((e) => e.closureAccelG).sort((a, b) => a - b);
  const radii = episodes.filter((e) => e.success).map((e) => e.heldRadiusM).sort((a, b) => a - b);

  const summary = {
    episodes: episodes.length,
    successes,
    successRate: episodes.length ? successes / episodes.length : 0,
    ci95: wilson(successes, episodes.length),
    heldRadiusUSD: [percentile(radii, 50), percentile(radii, 90)].map((v) => (v === null ? null : +v.toFixed(4))),
    closureAccelG: {
      p50: percentile(forces, 50),
      p90: percentile(forces, 90),
      max: forces.length ? forces[forces.length - 1] : null,
    },
    maxContacts: Math.max(0, ...episodes.map((e) => e.maxContacts)),
    // Lateral release tolerance is the dominant failure axis, so report it apart
    // (offsets are metres; 4 mm is roughly a finger-pad width).
    lateralBins: (() => {
      const bin = (list) => ({ episodes: list.length, successes: list.filter((e) => e.success).length });
      return {
        near: bin(episodes.filter((e) => Math.abs(e.params.lateral) <= 0.004)),
        far: bin(episodes.filter((e) => Math.abs(e.params.lateral) > 0.004)),
      };
    })(),
    failureModes: {
      outsideEnvelope: episodes.filter((e) => !e.insideEnvelope).length,
      floor: episodes.filter((e) => !e.aboveFloor).length,
      slip: episodes.filter((e) => !e.stable).length,
    },
    wallClockSeconds: +(elapsedMs / 1000).toFixed(1),
    secondsPerEpisode: +(elapsedMs / 1000 / Math.max(1, episodes.length)).toFixed(3),
  };

  const result = {
    generatedAt: new Date().toISOString(),
    seed: config.seed,
    mujoco: '3.17.0',
    protocol: {
      timestep: DT,
      settleSteps: 250,
      closeSteps: 600,
      holdSteps: 200,
      holdRadiusM: HOLD_RADIUS_M,
      minHeightMm: MIN_HEIGHT_MM,
      maxSlipM: MAX_SLIP_M,
      parameterRanges: {
        radiusM: [0.030, 0.042],
        halfLengthM: [0.040, 0.056],
        massKg: [0.20, 0.45],
        friction: [0.55, 1.05],
        lateralM: [-0.012, 0.012],
        alongM: [-0.004, 0.016],
      },
    },
    summary,
    episodes,
  };

  await mkdir(config.out, { recursive: true });
  const stamp = result.generatedAt.slice(0, 10);
  const jsonPath = join(config.out, `drop-benchmark-${stamp}.json`);
  const mdPath = join(config.out, `drop-benchmark-${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify(result, null, 2));
  await writeFile(mdPath, markdown(result));

  console.log(
    `\n${successes}/${episodes.length} retained (${(summary.successRate * 100).toFixed(1)} %, ` +
      `95 % CI ${(summary.ci95[0] * 100).toFixed(1)}–${(summary.ci95[1] * 100).toFixed(1)} %) in ${summary.wallClockSeconds} s`,
  );
  console.log(`closure impact p50/p90/max: ${summary.closureAccelG.p50}/${summary.closureAccelG.p90}/${summary.closureAccelG.max} g`);
  console.log(`wrote ${jsonPath}\nwrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
