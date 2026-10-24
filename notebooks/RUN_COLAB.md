# Colab runbook: train ACT on `salik/dirgha-form-7-sim`

Verified locally against `lerobot` 0.6.1 on 24 October 2026: the dataset loads (37
episodes, 1722 frames, 30 fps, features 27/7/27) and `lerobot-train --policy.type=act`
runs and writes a checkpoint. The only thing not yet executed is the GPU run
itself.

Total wall clock: **~15 min install + 30–90 min training**, unattended.

---

## 0. Before you start

- A Hugging Face token with **write** scope: https://huggingface.co/settings/tokens
- Google account with Colab access
- Nothing else. The dataset is public and MIT.

## 1. Open a fresh notebook and set the GPU

`https://colab.research.google.com` → **New notebook** → **Runtime → Change runtime type → T4 GPU** → Save.

## 2. Cell 1 — confirm the runtime

```python
!nvidia-smi --query-gpu=name,memory.total --format=csv
import sys; print("python", sys.version.split()[0])
assert sys.version_info >= (3, 12), "lerobot 0.6.1 needs Python 3.12+; pick a newer runtime image"
```

**Expect:** `Tesla T4, 15360 MiB` and `python 3.12.x`. If the Python is older, stop
and pick a newer Colab image — the pinned package will not install.

## 3. Cell 2 — install

```python
!pip install -q "lerobot[dataset,training]==0.6.1"
!pip install -q "av>=14,<17"       # av 19 breaks lerobot's pyav_utils (seen locally)
!lerobot-train --help | head -5
```

**Expect:** the last line prints usage. Takes 5–10 min on a fresh VM.
Deliberately pinned: an unpinned `pip install lerobot` will resolve to a different
minor version whose flags may differ from the ones below.

## 4. Cell 3 — log in

```python
from huggingface_hub import notebook_login
notebook_login()
```

Paste the **write** token. It is needed to read the dataset and to push the
checkpoint.

## 5. Cell 4 — prove the dataset contract before spending GPU time

```python
from huggingface_hub import HfApi
from lerobot.datasets.lerobot_dataset import LeRobotDataset

try:
    HfApi().create_tag("salik/dirgha-form-7-sim", tag="v3.0", repo_type="dataset")
    print("created tag v3.0")
except Exception as exc:
    print("tag already present:", type(exc).__name__)

ds = LeRobotDataset("salik/dirgha-form-7-sim")
print("episodes", ds.num_episodes, "frames", ds.num_frames, "fps", ds.fps)
print("features", sorted(ds.meta.features))
s = ds[0]
print("state", tuple(s["observation.state"].shape),
      "env", tuple(s["observation.environment_state"].shape),
      "action", tuple(s["action"].shape))
assert ds.num_episodes == 37 and ds.num_frames == 1722
```

**Expect:**

```
episodes 37 frames 1722 fps 30
state (27,) env (7,) action (27,)
```

If this cell fails, **do not continue** — send me the traceback. Training would
fail later with a worse error.

## 6. Cell 5 — train

```python
!lerobot-train \
  --policy.type=act \
  --dataset.repo_id=salik/dirgha-form-7-sim \
  --output_dir=outputs/act_dirgha \
  --job_name=dirgha_act \
  --steps=20000 \
  --batch_size=16 \
  --num_workers=2 \
  --save_freq=5000 \
  --wandb.enable=false \
  --policy.push_to_hub=true \
  --policy.repo_id=salik/dirgha-form-7-act
```

**Expect:** a progress bar ending at `20000/20000`, a checkpoint every 5000
steps, and pushes to `huggingface.co/salik/dirgha-form-7-act`.

**Timing on a T4:** roughly 0.1–0.3 s/step at batch 16, so 35–100 min. If it is
far slower, the GPU was not attached — recheck cell 1.

**If Colab disconnects** (free tier is ~12 h but idle checks are aggressive), keep
the tab active. To resume after a disconnect, rerun cells 1–4, then:

```python
!lerobot-train --resume=true --config_path=outputs/act_dirgha/train_config.json --output_dir=outputs/act_dirgha
```

## 7. Cell 6 — verify the checkpoint actually landed

```python
from huggingface_hub import HfApi
files = HfApi().list_repo_files("salik/dirgha-form-7-act")
print(len(files), "files")
for f in files[:20]: print(" ", f)
assert any(f.endswith("config.json") for f in files), "checkpoint did not upload"
```

**Expect:** tens of files including `config.json`, `model.safetensors`,
`policy_preprocessor.json`.

## 8. Cell 7 — report the numbers

```python
!ls -la outputs/act_dirgha/checkpoints
```

Send me:

1. the **final loss** line and roughly where it plateaued;
2. **wall-clock training time** (from the progress bar);
3. the GPU line from cell 1;
4. the **file count** and whether `config.json` is present;
5. any warning that appeared more than once;
6. a screenshot of the loss curve if the progress bar showed one.

That is everything needed for `RESULTS.md`. Do not evaluate the checkpoint on the
37 training episodes and call the number a success rate — it was trained on them.

---

## Failure modes and what they mean

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| `'datasets' is required` / `'accelerate' is required` | installed plain `lerobot` | `pip install "lerobot[dataset,training]==0.6.1"` |
| `AttributeError: module 'av' has no attribute 'option'` | av 19 resolved | `pip install "av>=14,<17"` |
| `Your dataset must be tagged with a codebase version` | repo lacks the `v3.0` tag | cell 4 creates it |
| `ModuleNotFoundError: torchcodec` | Linux-only wheel absent | warning only; pyav fallback is used |
| OOM at batch 16 | 37 episodes is small; unlikely | `--batch_size=8` |
| Steps far slower than 0.3 s | no GPU attached | Runtime → Change runtime type → T4 |
| `Repository not found` on push | token lacks write scope | make a write token, rerun cell 3 |

## What this run will and will not show

**Will:** the dataset loads in an independent `lerobot` install, ACT trains on
27-DoF state plus 7-DoF object pose, loss falls, a checkpoint is published.

**Will not:** that the hand can grasp. 37 demonstrations of one cylinder class in
one simulator is a pipeline demonstration. Expect overfitting long before 20 000
steps and say so.
