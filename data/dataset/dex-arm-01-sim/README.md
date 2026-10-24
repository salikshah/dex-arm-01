---
license: mit
task_categories:
  - robotics
tags:
  - lerobot
  - mujoco
  - dexterous-manipulation
  - simulated
  - dex-arm-01
pretty_name: DEX ARM 01 simulated grasp demonstrations
size_categories:
  - n<1K
---

# DEX ARM 01 — simulated grasp demonstrations

**Simulated data. No physical hand was involved in producing any frame.**

37 demonstrations of a 27-DoF dexterous hand (7 arm + 20 finger joints) closing
on a cylinder resting in an open palm. Recorded by driving a MuJoCo model
headlessly at 500 Hz and sampling state/action at 30 Hz.

- Robot: DEX ARM 01, `dex_arm_01`
- Format: LeRobot v3.0 (`codebase_version: v3.0`)
- Episodes: 37 · Frames: 1722 · Tasks: 3 · FPS: 30
- Features: `observation.state` float32[27], `action` float32[27],
  `observation.environment_state` float32[7] (object pose in the palm frame:
  `x, y, z, qw, qx, qy, qz`)
- No video: these episodes carry state/action and object pose only

`observation.environment_state` exists because ACT requires an image input or an
environment-state input. This dataset has no camera, so the object's pose in the
palm frame is the environment channel. It is exact here because the scene is
simulated — a real hand would need a tracker or vision to obtain it.

## Provenance

Recorded on 24 October 2026 from `scripts/record-sim-episodes.mjs`, seed 23, in
the DEX ARM 01 repository (MIT). 100 scripted attempts were made and **37
retained the object**; only retained demonstrations are included. The retention
rate is reported rather than hidden:

| Behaviour | Retained |
| :--- | :--- |
| `close_all` | 14 / 34 |
| `pinch_then_cage` | 8 / 33 |
| `close_then_turn` | 15 / 33 |

Per-episode parameters and outcomes for all 100 attempts are in
`provenance/sim-meta.json`; the benchmark behind the failure-mode analysis is in
`provenance/benchmark.md`.

## Tasks

- close all fingers around a cylinder resting in the palm (simulated)
- pinch the cylinder with thumb and index, then cage it with the remaining fingers (simulated)
- close the fingers around the cylinder and turn the wrist 20 degrees (simulated)

## What this data is

Contact dynamics from MuJoCo 3.17.0 with the hand's MJCF: capsule fingers, a box
palm, elliptic friction cone, 2 ms timestep, DIP/PIP coupling at 0.67.

## What this data is not

- **Not hardware.** No physical hand, camera, or actuator was used.
- **Not the visual model.** Collision geometry is a simple proxy, not the render mesh.
- **Not diverse.** One object class (cylinders 32–40 mm radius, 0.22–0.40 kg) and
  a shallow cradle. Retention falls from ~90% with a level palm and centred
  release to 8% with ±4° of arm tilt, so anything but near-level, near-centred
  grasps is under-represented.
- **Not evidence of grasp skill.** A policy trained here learns from 37 successful
  closures of one object class in one simulator.

## Loading

```python
from lerobot.datasets.lerobot_dataset import LeRobotDataset

ds = LeRobotDataset("salik/dex-arm-01-sim")
sample = ds[0]
sample["observation.state"]              # 27 joint angles (degrees)
sample["observation.environment_state"]  # 7, object pose in the palm frame
sample["action"]                         # 27 commanded joint angles
```

## Training

```bash
lerobot-train \
  --policy.type=act \
  --dataset.repo_id=salik/dex-arm-01-sim \
  --output_dir=outputs/act \
  --steps=20000 \
  --policy.repo_id=salik/dex-arm-01-act
```

## Licence

MIT, matching the source repository.
