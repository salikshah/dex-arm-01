# Execution plan: a credible demo without a physical hand

Written 24 October 2026. The constraint is fixed: no hardware, one Windows
machine (4 cores, 9 GB RAM, no GPU), everything reproducible online. Training
therefore happens on free cloud GPUs; everything else stays local.

The goal is not to claim a result. It is to ship a chain a reviewer can rerun:
simulated episodes → LeRobot dataset → policy trained on a free GPU → measured
rollout in the same simulator → published numbers that state their own limits.

## What runs where

| Work | Machine | Why |
| :--- | :--- | :--- |
| App, physics, benchmark, recording | Local | No GPU needed; MuJoCo WASM + Node |
| Dataset conversion and verification | Local | `pyarrow` + `ffmpeg`, seconds per run |
| CAD generation | Local | `build123d` is CPU-only |
| Policy training (ACT / diffusion) | Colab or Kaggle, free T4 | 4 cores cannot train a vision policy in useful time |
| Dataset and checkpoint hosting | HF Hub | Free, versioned, `lerobot` reads it directly |

## Phase 1 — dataset v1 (local, mostly done)

**Landed:** `scripts/record-sim-episodes.mjs` records 100 attempts across three
behaviours (close_all, pinch_then_cage, close_then_turn) with randomised object
parameters, release offsets and start pose; 37 retained, exported as 37
demonstrations / 1722 frames / 3 tasks. `scripts/lerobot_convert.py` emits the
v3.0 dataset and `scripts/verify_lerobot_dataset.py` checks it against the live
Hub schema. Both single-episode (with wrist MP4) and multi-episode paths pass.

Measured sensitivities worth knowing before widening further: retention is ~90 %
with a level palm and a centred release, 37 % once the release is randomised, and
8 % with ±4° of arm jitter — the cradle is shallow and the palm must stay level.
Details and the audit bundle are in `data/README.md`.

**Remaining, in order:**

1. ~~Widen the data~~ — done at 100 attempts / 37 kept. Next step is a *closed-loop
   controller* (close until contact, then stop) to lift retention without
   shrinking the parameter ranges.
2. **Capture wrist video.** Three episodes recorded in the browser with the
   wrist camera at 192 px, converted with MP4, verified by `ffprobe`.
   *Acceptance:* `observation.images.wrist` present in `info.json` and frame
   count matches parquet rows. The converter path is already proven with the
   synthetic fixture; only the in-browser capture is missing.
3. ~~Publish to the Hub~~ — live at
   [salik/dirgha-form-7-sim](https://huggingface.co/datasets/salik/dirgha-form-7-sim),
   MIT, public, with the retention table and limits in the dataset card.
   Verified by downloading `data/chunk-000/file-000.parquet` back from the Hub:
   1722 rows, 37 episodes, `codebase_version` v3.0. `datasets-server` was still
   indexing at upload time, so the viewer may lag.

## Phase 2 — training baseline (Colab/Kaggle)

Free tier: Colab T4 16 GB, ~12 h per session; Kaggle 2× T4 or P100, 30 h/week.
Both die on disconnect, so everything persists to the Hub, never to the VM.

Notebook: [`notebooks/train_act_colab.ipynb`](../notebooks/train_act_colab.ipynb) —
GPU check, `pip install "lerobot==0.6.1"`, login, dataset contract assertions,
`lerobot-train`, and a read-back of the published checkpoint.

One dataset change was needed to make ACT viable: it requires an image input or
`observation.environment_state`. Rather than fake a camera, the recorder now logs
the object pose in the palm frame (7 dims, exact because the scene is simulated),
and the dataset was republished with that feature.

```bash
pip install "lerobot==0.6.1"
lerobot-train \
  --policy.type=act \
  --dataset.repo_id=salik/dirgha-form-7-sim \
  --output_dir=outputs/act_dirgha \
  --steps=20000 --batch_size=16 --save_freq=5000 \
  --policy.push_to_hub=true --policy.repo_id=salik/dirgha-form-7-act
```

ACT on 27-DoF state plus 7-DoF object pose is small: batch 16 fits a T4 easily.
20 000 steps is a pipeline demonstration, not a converged policy — 1722 frames
will overfit long before that.

**Status:** the path is proven locally. `LeRobotDataset("salik/dirgha-form-7-sim")`
loads in `lerobot` 0.6.1 — 37 episodes, 1722 frames, 30 fps, feature shapes
27 / 7 / 27 — after tagging the repo `v3.0` (LeRobot refuses untagged repos).
`lerobot-train --policy.type=act` then ran 10 steps on CPU at batch 2 and wrote a
checkpoint with `config.json` and `model.safetensors`. On CPU that is ~3 s/step;
a T4 at batch 16 puts 20 000 steps in the tens of minutes.

Remaining: the GPU run itself, and a rollout recorded from the checkpoint.
Windows could not create the `checkpoints/last` symlink (needs Developer Mode or
admin); that is a local artefact and does not affect Colab or Linux.

**Explicitly not claimed:** success rate on hardware, or that 37 simulated
episodes generalise. The checkpoint is a *pipeline proof*.

## Phase 3 — context and artefacts (local)

1. **Cross-hand baseline.** Vendor `leap_hand` (MIT) and `shadow_hand`
   (Apache-2.0) from Menagerie under `bench/baselines/`, with their LICENSE
   files, and rerun the same 100-episode protocol. This is what turns "47%" into
   a statement with a reference point.
   *Acceptance:* one table in `bench/README.md` with three hands, same seed,
   same protocol.
2. **CAD that opens.** `py -m pip install build123d` (~300 MB, no GPU), run
   `hardware/dirgha-form-7/cad/generate.py`, commit the STEP files and one
   rendered PNG per solid.
   *Acceptance:* STEP files parse, bounding boxes match `cad/params.py`.
3. **Demo build.** `npm run build` → static `dist/`, deployed to any static
   host, with the benchmark and dataset numbers printed on the page.
   *Acceptance:* a URL that boots without a bundler.

## Phase 4 — the proof page

One `RESULTS.md` that a sceptical reader can follow: what was measured, on what,
with which seed and version, and what it does not show. Link each number to the
script and the committed run artefact (`bench/results/*.json`,
`meta/info.json`). Tag `v0.2.0`, archive to Zenodo for a DOI, and update
`CITATION.cff`.

## What each artefact proves

| Artefact | Proves | Does not prove |
| :--- | :--- | :--- |
| `bench/results/*.json` | The 27-DoF MJCF simulates repeatably; lateral tolerance is ~4 mm | Real grasp performance |
| `data/sim/*.jsonl` + v3.0 dataset | The pipeline produces loadable LeRobot data | That the data is diverse enough to learn from |
| Trained checkpoint + loss curve | The training path works end to end | Generality, or sim-to-real transfer |
| STEP files | The design is buildable on paper | Tolerances, assembly, part fit |
| Wrist MP4 | The observation channel exists and matches frames | That the camera or optics exist |

## Blocked on you, not on the machine

- **Hugging Face token** for pushing the dataset and checkpoints (`huggingface-cli login`).
- **A hosting choice** for the static demo if you want a live URL.
- **Decisions on claims:** whether the lateral-tolerance result (47%, centred
  releases only) goes on the landing page as-is, or after Phase 3's baseline
  comparison.

## Order I would run it

1. Widen the dataset to 100 episodes and 3 behaviours (local, ~1 day).
2. Colab run end to end, checkpoint on the Hub (local authoring, cloud compute).
3. Menagerie baselines — cheapest credibility gain per hour (local, ~1 day).
4. build123d STEP generation (local, ~1 day).
5. Proof page + tag + Zenodo (local, ~1 day).
