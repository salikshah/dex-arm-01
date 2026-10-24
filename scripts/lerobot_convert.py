"""Convert DEX ARM 01 episodes (JSONL bundle + meta) to LeRobot v3.0.

Frames are grouped by `episode_index`, so one JSONL file can hold either a single
browser recording or a whole batch recorded by `scripts/record-sim-episodes.mjs`.
The output layout and parquet schemas are copied from live v3.0 datasets on the
Hub (`lerobot/xarm_lift_medium`, `lerobot/pusht`), so a reader sees the same
metadata shape it sees for any published dataset.

Usage
-----
    py -m pip install pyarrow pillow
    py scripts/lerobot_convert.py episodes.jsonl [meta.json] out/dex_arm_01_sim
    py scripts/lerobot_convert.py episodes.jsonl out/dex_arm_01_sim --no-video

Output layout (LeRobot v3.0):

    out/dex_arm_01_sim/
      meta/info.json
      meta/stats.json
      meta/tasks.parquet
      meta/episodes/chunk-000/file-000.parquet
      data/chunk-000/file-000.parquet
      videos/observation.images.wrist/chunk-000/file-<ep>.mp4   (optional)

Every frame must carry `observation.state` (27) and `action` (27).
`observation.tactile` (6) is written when every frame has it.
`observation.images.wrist` is an optional JPEG data URL; episodes that have them
are assembled into one H.264 MP4 each with the system `ffmpeg`. If ffmpeg is
missing, the video feature is dropped from `info.json` rather than advertised
and absent.

Not included: channel-wise image statistics for video features. A dataset built
here is complete for state/action training and incomplete for image
normalisation statistics.
"""

from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

STATE_DIM = 27
TACTILE_DIM = 6
ENV_STATE_DIM = 7  # object pose in the palm frame: xyz + quaternion
VIDEO_KEY = "observation.images.wrist"
CHUNK = 0
FILE = 0
DEFAULT_TASK = "close the fingers around a cylinder resting in the palm"


def load_frames(jsonl_path: Path) -> list[dict]:
    frames = [json.loads(line) for line in jsonl_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not frames:
        raise SystemExit("episode file has no frames")
    for i, frame in enumerate(frames):
        if len(frame.get("observation.state", [])) != STATE_DIM:
            raise SystemExit(f"frame {i}: observation.state must have {STATE_DIM} values")
        if len(frame.get("action", [])) != STATE_DIM:
            raise SystemExit(f"frame {i}: action must have {STATE_DIM} values")
        tactile = frame.get("observation.tactile")
        if tactile is not None and len(tactile) != TACTILE_DIM:
            raise SystemExit(f"frame {i}: observation.tactile must have {TACTILE_DIM} values")
        env = frame.get("observation.environment_state")
        if env is not None and len(env) != ENV_STATE_DIM:
            raise SystemExit(f"frame {i}: observation.environment_state must have {ENV_STATE_DIM} values")
    return frames


def load_meta(meta_path: Path | None) -> dict:
    if meta_path and meta_path.exists():
        return json.loads(meta_path.read_text(encoding="utf-8"))
    return {}


def group_episodes(frames: list[dict]) -> list[tuple[int, list[dict]]]:
    groups: dict[int, list[dict]] = {}
    for frame in frames:
        groups.setdefault(int(frame.get("episode_index", 0)), []).append(frame)
    return [(idx, groups[idx]) for idx in sorted(groups)]


def decode_image(data_url: str | None) -> bytes | None:
    if not data_url or not data_url.startswith("data:image/"):
        return None
    try:
        _, encoded = data_url.split(",", 1)
        return base64.b64decode(encoded)
    except ValueError:
        return None


def write_video(frame_list: list[dict], path: Path, fps: int) -> bool:
    """Assemble one episode's JPEG data URLs into an H.264 MP4."""
    images = [decode_image(f.get(VIDEO_KEY)) for f in frame_list]
    if not any(images):
        return False
    if not all(images):
        print(f"  {path.name}: only {sum(1 for i in images if i)}/{len(images)} frames carry an image; video skipped")
        return False
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("  ffmpeg not found on PATH; video skipped")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for i, raw in enumerate(images):
            (Path(tmp) / f"frame_{i:06d}.jpg").write_bytes(raw)
        proc = subprocess.run(
            [
                ffmpeg, "-y", "-loglevel", "error",
                "-framerate", str(fps),
                "-i", str(Path(tmp) / "frame_%06d.jpg"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                str(path),
            ],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            print(f"  ffmpeg failed for {path.name}: {proc.stderr.strip()[:300]}")
            return False
    return True


def vector_stats(values: list[list[float]]) -> dict:
    n = len(values)
    d = len(values[0])
    mins = [min(row[i] for row in values) for i in range(d)]
    maxs = [max(row[i] for row in values) for i in range(d)]
    means = [sum(row[i] for row in values) / n for i in range(d)]
    stds = [(sum((row[i] - means[i]) ** 2 for row in values) / n) ** 0.5 for i in range(d)]
    return {"min": mins, "max": maxs, "mean": means, "std": stds, "count": [n] * d}


def state_names() -> list[str]:
    return [
        "J1", "J2", "J3", "J4", "J5", "J6", "J7",
        "index_abd", "index_mcp", "index_pip", "index_dip",
        "middle_abd", "middle_mcp", "middle_pip", "middle_dip",
        "ring_abd", "ring_mcp", "ring_pip", "ring_dip",
        "little_abd", "little_mcp", "little_pip", "little_dip",
        "thumb_abd", "thumb_cmc", "thumb_mcp", "thumb_ip",
    ]


def tactile_names() -> list[str]:
    return ["thumb_force_n", "index_force_n", "middle_force_n", "ring_force_n", "little_force_n", "grasp_epsilon"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("jsonl", type=Path)
    parser.add_argument("meta", type=Path, nargs="?", default=None)
    parser.add_argument("out", type=Path, nargs="?", default=None)
    parser.add_argument("--no-video", action="store_true")
    parser.add_argument("--fps", type=int, default=None)
    args = parser.parse_args()

    # Accept both `<jsonl> <meta> <out>` and `<jsonl> <out>`.
    if args.out is None and args.meta is not None:
        args.out, args.meta = args.meta, None
    if args.out is None:
        raise SystemExit("give an output directory")
    if args.meta is None:
        candidate = args.jsonl.with_suffix(".meta.json")
        args.meta = candidate if candidate.exists() else None

    frames = load_frames(args.jsonl)
    meta = load_meta(args.meta)
    episode_groups = group_episodes(frames)
    out: Path = args.out

    fps = args.fps or int(meta.get("fps") or meta.get("episode", {}).get("fps", 30))
    tasks: list[str] = []
    for _, ep_frames in episode_groups:
        task = ep_frames[0].get("task") or meta.get("task") or DEFAULT_TASK
        if task not in tasks:
            tasks.append(task)
    task_index = {t: i for i, t in enumerate(tasks)}

    has_tactile = all(f.get("observation.tactile") for f in frames)
    has_env = all(f.get("observation.environment_state") for f in frames)

    # ---- video, one MP4 per episode -------------------------------------
    video_ok: dict[int, bool] = {}
    for ep_idx, ep_frames in episode_groups:
        if args.no_video:
            video_ok[ep_idx] = False
            continue
        video_ok[ep_idx] = write_video(
            ep_frames,
            out / "videos" / VIDEO_KEY / f"chunk-{CHUNK:03d}" / f"file-{ep_idx:03d}.mp4",
            fps,
        )

    # ---- data parquet: every episode, in order --------------------------
    rows: dict[str, list] = {
        "observation.state": [],
        "action": [],
        "episode_index": [],
        "frame_index": [],
        "timestamp": [],
        "index": [],
        "task_index": [],
    }
    if has_tactile:
        rows["observation.tactile"] = []
    if has_env:
        rows["observation.environment_state"] = []

    cursor = 0
    episode_rows = []
    for ep_idx, ep_frames in episode_groups:
        start = cursor
        for i, frame in enumerate(ep_frames):
            rows["observation.state"].append(frame["observation.state"])
            rows["action"].append(frame["action"])
            rows["episode_index"].append(ep_idx)
            rows["frame_index"].append(int(frame.get("frame_index", i)))
            rows["timestamp"].append(float(frame.get("timestamp", i / fps)))
            rows["index"].append(cursor)
            rows["task_index"].append(task_index[ep_frames[0].get("task") or tasks[0]])
            if has_tactile:
                rows["observation.tactile"].append(frame["observation.tactile"])
            if has_env:
                rows["observation.environment_state"].append(frame["observation.environment_state"])
            cursor += 1
        episode_rows.append({"episode_index": ep_idx, "frames": ep_frames, "from": start, "to": cursor})

    schema = pa.schema([
        ("observation.state", pa.list_(pa.float32())),
        ("action", pa.list_(pa.float32())),
        *([("observation.tactile", pa.list_(pa.float32()))] if has_tactile else []),
        *([("observation.environment_state", pa.list_(pa.float32()))] if has_env else []),
        ("episode_index", pa.int64()),
        ("frame_index", pa.int64()),
        ("timestamp", pa.float32()),
        ("index", pa.int64()),
        ("task_index", pa.int64()),
    ])
    data_path = out / "data" / f"chunk-{CHUNK:03d}" / f"file-{FILE:03d}.parquet"
    data_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pydict({name: rows[name] for name in schema.names}, schema=schema), data_path, compression="snappy")

    # ---- episodes parquet ----------------------------------------------
    ep_fields: dict[str, pa.Array] = {
        "episode_index": pa.array([e["episode_index"] for e in episode_rows], type=pa.int64()),
        "data/chunk_index": pa.array([CHUNK] * len(episode_rows), type=pa.int64()),
        "data/file_index": pa.array([FILE] * len(episode_rows), type=pa.int64()),
        "dataset_from_index": pa.array([e["from"] for e in episode_rows], type=pa.int64()),
        "dataset_to_index": pa.array([e["to"] for e in episode_rows], type=pa.int64()),
        "tasks": pa.array([[e["frames"][0].get("task") or tasks[0]] for e in episode_rows], type=pa.list_(pa.string())),
        "length": pa.array([e["to"] - e["from"] for e in episode_rows], type=pa.int64()),
    }

    per_episode_stats = []
    for e in episode_rows:
        s = {"observation.state": vector_stats([f["observation.state"] for f in e["frames"]]),
             "action": vector_stats([f["action"] for f in e["frames"]])}
        if has_tactile:
            s["observation.tactile"] = vector_stats([f["observation.tactile"] for f in e["frames"]])
        if has_env:
            s["observation.environment_state"] = vector_stats([f["observation.environment_state"] for f in e["frames"]])
        per_episode_stats.append(s)
    for key in (
        "observation.state",
        "action",
        *(["observation.tactile"] if has_tactile else []),
        *(["observation.environment_state"] if has_env else []),
    ):
        for stat in ("min", "max", "mean", "std"):
            ep_fields[f"stats/{key}/{stat}"] = pa.array([s[key][stat] for s in per_episode_stats], type=pa.list_(pa.float64()))
        ep_fields[f"stats/{key}/count"] = pa.array([s[key]["count"] for s in per_episode_stats], type=pa.list_(pa.int64()))

    if any(video_ok.values()):
        ep_fields[f"videos/{VIDEO_KEY}/chunk_index"] = pa.array([CHUNK] * len(episode_rows), type=pa.int64())
        ep_fields[f"videos/{VIDEO_KEY}/file_index"] = pa.array([e["episode_index"] for e in episode_rows], type=pa.int64())
        ep_fields[f"videos/{VIDEO_KEY}/from_timestamp"] = pa.array([0.0] * len(episode_rows), type=pa.float64())
        ep_fields[f"videos/{VIDEO_KEY}/to_timestamp"] = pa.array(
            [(e["to"] - e["from"]) / fps for e in episode_rows], type=pa.float64()
        )
        if not all(video_ok[e["episode_index"]] for e in episode_rows):
            print("  warning: only some episodes have video; the feature is advertised for all of them")

    ep_path = out / "meta" / "episodes" / f"chunk-{CHUNK:03d}" / f"file-{FILE:03d}.parquet"
    ep_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(ep_fields), ep_path, compression="snappy")

    # ---- tasks ---------------------------------------------------------
    pq.write_table(
        pa.table({"task_index": pa.array(list(range(len(tasks))), type=pa.int64()),
                  "task": pa.array(tasks, type=pa.string())}),
        out / "meta" / "tasks.parquet",
        compression="snappy",
    )

    # ---- global stats --------------------------------------------------
    stats = {"observation.state": vector_stats([f["observation.state"] for f in frames]),
             "action": vector_stats([f["action"] for f in frames])}
    if has_tactile:
        stats["observation.tactile"] = vector_stats([f["observation.tactile"] for f in frames])
    if has_env:
        stats["observation.environment_state"] = vector_stats([f["observation.environment_state"] for f in frames])
    (out / "meta" / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")

    # ---- info ----------------------------------------------------------
    n = len(frames)
    has_video = any(video_ok.values())
    features = {
        "observation.state": {"dtype": "float32", "shape": [STATE_DIM], "names": {"motors": state_names()}, "fps": fps},
        "action": {"dtype": "float32", "shape": [STATE_DIM], "names": {"motors": state_names()}, "fps": fps},
        "episode_index": {"dtype": "int64", "shape": [1], "names": None, "fps": fps},
        "frame_index": {"dtype": "int64", "shape": [1], "names": None, "fps": fps},
        "timestamp": {"dtype": "float32", "shape": [1], "names": None, "fps": fps},
        "index": {"dtype": "int64", "shape": [1], "names": None, "fps": fps},
        "task_index": {"dtype": "int64", "shape": [1], "names": None, "fps": fps},
    }
    if has_tactile:
        features["observation.tactile"] = {
            "dtype": "float32", "shape": [TACTILE_DIM], "names": {"motors": tactile_names()}, "fps": fps,
        }
    if has_env:
        # Object pose in the palm frame; ACT accepts this in place of an image.
        features["observation.environment_state"] = {
            "dtype": "float32", "shape": [ENV_STATE_DIM], "names": None, "fps": fps,
        }
    if has_video:
        size = 192
        features[VIDEO_KEY] = {
            "dtype": "video",
            "shape": [size, size, 3],
            "names": ["height", "width", "channel"],
            "video_info": {
                "video.fps": fps,
                "video.codec": "h264",
                "video.pix_fmt": "yuv420p",
                "video.is_depth_map": False,
                "has_audio": False,
            },
            "fps": fps,
        }

    info = {
        "codebase_version": "v3.0",
        "robot_type": "dex_arm_01",
        "total_episodes": len(episode_rows),
        "total_frames": n,
        "total_tasks": len(tasks),
        "chunks_size": 1000,
        "fps": fps,
        "splits": {"train": f"0:{len(episode_rows)}"},
        "data_path": "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet",
        "video_path": "videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4",
        "features": features,
    }
    (out / "meta" / "info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")

    print(f"wrote {n} frames over {len(episode_rows)} episode(s) -> {data_path}")
    print(f"video: {'yes' if has_video else 'no'}   tasks: {len(tasks)}   features: {', '.join(features)}")
    print(f"load with: LeRobotDataset('{out}')")
    return 0


if __name__ == "__main__":
    sys.exit(main())
