# Data provenance

Two different things live under `data/`. They have different origins and must not
be described the same way.

## `assembly.json`, `wires.json` — static scene data

Authored for the original portfolio build of this model. They are the baked
node/wire geometry the WebGL scene loads.

**Provenance is not asserted here.** These are the only files in the repository
whose origin the code cannot demonstrate. Before publishing, the repository owner
must state in writing that they are original work under the repo's MIT licence —
or remove them and load a generated scene instead. This is blocker 1 in
`docs/OPEN_SOURCE_GAP_ANALYSIS.md`, and no amount of testing resolves it.

## `sim/` — recorded simulated episodes

Produced by `scripts/record-sim-episodes.mjs`, which drives the 27-DoF MuJoCo
model headlessly. Nothing here came from a physical hand.

- 100 scripted attempts, 3 behaviours, seed 23, 30 Hz, 27-DoF state and action.
- **37 attempts retained the object** (close_all 14/34, pinch_then_cage 8/33,
  close_then_turn 15/33). Retention is measured, not assumed.
- `episodes.jsonl` — the 37 retained demonstrations, reindexed from 0 (1722 frames).
- `episodes-all.jsonl` — every attempt, including failures, for auditing.
- `meta.json` — parameters, per-episode outcome, timing protocol.

Both bundles are newline-delimited JSON. Frames carry `observation.state` (27),
`action` (27), `episode_index`, `frame_index`, `timestamp`, `task_index` and the
task string.

### Why the retention rate is low

The collision model is a box palm with capsule fingers — no compliant pads and a
shallow cradle. Two measured sensitivities explain most of the failures:

| Variation | Retained |
| :--- | :--- |
| Level palm, centred release | ~90 % |
| ±2° jitter on every open-pose joint | 1 in 5 failures |
| ±4° per arm joint | 8 % |
| ±0.8° per arm joint | 9/34 |
| ±0.3° per arm joint | 37 % overall |

This is a property of the proxy geometry, not evidence about the real hand. It is
the reason `bench/` exists: the same weakness, quantified.

## `dataset/dex-arm-01-sim/` — LeRobot v3.0 export

`scripts/lerobot_convert.py` output from `sim/episodes.jsonl`: one data file,
37 episode rows, 3 tasks, per-episode stats. Verified by
`scripts/verify_lerobot_dataset.py` against the live Hub schema. Published on
Hugging Face: **[salik/dex-arm-01-sim](https://huggingface.co/datasets/salik/dex-arm-01-sim)**.
No video feature (these episodes are state/action only; wrist video requires the browser recorder).

## Regenerating

```bash
node scripts/record-sim-episodes.mjs --episodes 100      # ~2 min, seeded
python scripts/lerobot_convert.py data/sim/episodes.jsonl data/sim/meta.json data/dataset/dex-arm-01-sim
python scripts/verify_lerobot_dataset.py data/dataset/dex-arm-01-sim --probe
```

Results depend on physics, not on wall-clock timing, so the same seed reproduces
the same episodes on the same MuJoCo version (3.17.0).
