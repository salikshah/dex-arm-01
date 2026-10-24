// Build a synthetic, clearly-labelled episode fixture for the LeRobot converter.
//
// The frames come from ffmpeg's `testsrc` pattern, not from the robot: this
// exists to test the JSONL -> LeRobot v3.0 conversion path deterministically.
// For real observations, record in the browser (wrist camera captures the
// rendered palm view) and pass that export through the same converter.
//
// Usage: node scripts/make-fixture-episode.mjs [outDir]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatasetRecorder } from '../src/teleop/dataset-logger.js';

const OUT = resolve(process.argv[2] || 'tests/fixtures/lerobot');
const FPS = 30;
const FRAMES = 30;

const OPEN = [0, 10, 8, 4, 0, 10, 8, 4, 0, 10, 8, 4, 0, 10, 8, 4, -15, 10, 8, 4];
const CLOSED = [0, 55, 72, 42, 0, 58, 74, 44, 0, 56, 73, 43, 0, 54, 70, 40, -20, 38, 32, 18];
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function makeFrames(dir) {
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `testsrc=size=192x192:rate=${FPS}`,
    '-frames:v', String(FRAMES),
    join(dir, 'frame_%04d.jpg'),
  ]);
  return Array.from({ length: FRAMES }, (_, i) =>
    `data:image/jpeg;base64,${readFileSync(join(dir, `frame_${String(i + 1).padStart(4, '0')}.jpg`)).toString('base64')}`,
  );
}

const tmp = mkdtempSync(join(tmpdir(), 'dirgha-fixture-'));
try {
  const images = makeFrames(tmp);
  const recorder = new DatasetRecorder({ fps: FPS, task: 'close the hand around a cylinder (synthetic fixture)' });
  recorder.start();

  for (let i = 0; i < FRAMES; i++) {
    const t = i / (FRAMES - 1);
    const hand = lerp(OPEN, CLOSED, t);
    recorder.tick(i * (1000 / FPS), {
      commandArm: new Array(7).fill(0),
      commandHand: hand,
      targetArm: new Array(7).fill(0),
      targetHand: hand,
      tensions: { thumb: 4 + 2 * t, index: 3 + 2 * t, middle: 3 + 2 * t, ring: 2 + 2 * t, little: 2 + 1.5 * t },
      epsilon: 0.05 + 0.2 * t,
    }, images[i]);
  }
  recorder.stop();

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'episode.jsonl'), recorder.toJSONL());
  writeFileSync(
    join(OUT, 'episode.meta.json'),
    JSON.stringify({ info: recorder.toInfo(), episode: recorder.toEpisodeMeta() }, null, 2),
  );
  console.log(`wrote ${recorder.frameCount} fixture frames to ${OUT}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
