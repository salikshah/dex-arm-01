"""Verify a converted dataset against the live LeRobot v3.0 layout.

Checks structure, metadata keys, parquet schemas (column names and types copied
from published v3.0 datasets) and, when a video feature is advertised, the MP4
itself via `ffprobe`.

Usage
-----
    py scripts/verify_lerobot_dataset.py out/dirgha_demo
    py scripts/verify_lerobot_dataset.py out/dirgha_demo --probe

`--probe` reads every data file with pyarrow and reports row counts; without it
only metadata and the first file are opened. Exit code 1 means the dataset is
not loadable as LeRobot v3.0.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pyarrow.parquet as pq

REQUIRED_INFO_KEYS = {
    "codebase_version",
    "robot_type",
    "total_episodes",
    "total_frames",
    "total_tasks",
    "chunks_size",
    "fps",
    "splits",
    "data_path",
    "video_path",
    "features",
}

BOOKKEEPING_COLUMNS = {"episode_index", "frame_index", "timestamp", "index", "task_index"}
EPISODE_REQUIRED = {"episode_index", "data/chunk_index", "data/file_index", "dataset_from_index", "dataset_to_index", "tasks", "length"}

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"FAIL  {msg}")


def ok(msg: str) -> None:
    print(f"PASS  {msg}")


def check(cond: bool, msg: str) -> None:
    ok(msg) if cond else fail(msg)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    root: Path = args.dataset

    info_path = root / "meta" / "info.json"
    if not info_path.exists():
        print(f"FAIL  {info_path} missing")
        return 1
    info = json.loads(info_path.read_text(encoding="utf-8"))

    missing = REQUIRED_INFO_KEYS - set(info)
    check(not missing, f"meta/info.json has the v3.0 keys ({', '.join(sorted(REQUIRED_INFO_KEYS))})")
    if missing:
        fail(f"missing info keys: {sorted(missing)}")

    check(info.get("codebase_version") == "v3.0", f"codebase_version is v3.0 (got {info.get('codebase_version')})")
    check(str(info.get("data_path", "")).startswith("data/chunk-"), "data_path uses chunk/file templating")
    check("{video_key}" in str(info.get("video_path", "")), "video_path uses the {video_key} template")

    features = info.get("features", {})
    for name in ("observation.state", "action"):
        f = features.get(name, {})
        check(f.get("dtype") == "float32" and f.get("shape") == [27], f"feature {name} is float32[27]")

    data_files = sorted((root / "data").glob("chunk-*/file-*.parquet"))
    check(bool(data_files), f"data parquet present ({len(data_files)} file(s))")
    if not data_files:
        return 1

    schema = pq.read_schema(data_files[0])
    check(set(schema.names) >= BOOKKEEPING_COLUMNS, "data parquet carries the bookkeeping columns")
    for name in ("observation.state", "action"):
        if name in schema.names:
            field = schema.field(name)
            check("list" in str(field.type), f"{name} is stored as a list column")
    expected_vectors = {n for n, f in features.items() if f.get("dtype") == "float32" and isinstance(f.get("shape"), list) and f["shape"]}
    missing_cols = expected_vectors - set(schema.names)
    check(not missing_cols, "every float32 feature has a matching parquet column")
    if missing_cols:
        fail(f"missing columns: {sorted(missing_cols)}")

    ep_files = sorted((root / "meta" / "episodes").glob("chunk-*/file-*.parquet"))
    check(bool(ep_files), "meta/episodes parquet present")
    if ep_files:
        ep_schema = pq.read_schema(ep_files[0])
        check(EPISODE_REQUIRED <= set(ep_schema.names), "episodes parquet carries the v3.0 episode columns")
        stats_cols = [c for c in ep_schema.names if c.startswith("stats/")]
        check(bool(stats_cols), f"episodes parquet carries per-episode stats ({len(stats_cols)} columns)")

        ep_table = pq.read_table(ep_files[0]).to_pydict()
        count = len(ep_table["episode_index"])
        check(count == info.get("total_episodes"), f"total_episodes matches episodes table ({count})")
        lengths = sum(ep_table["length"])
        check(lengths == info.get("total_frames"), f"episode lengths sum to total_frames ({lengths})")
        contiguous = all(
            ep_table["dataset_from_index"][i] == (ep_table["dataset_to_index"][i - 1] if i else 0)
            for i in range(count)
        )
        check(contiguous, "episode index ranges are contiguous")
        check(ep_table["dataset_to_index"][-1] == info.get("total_frames"), "last episode ends at total_frames")

    tasks = root / "meta" / "tasks.parquet"
    check(tasks.exists(), "meta/tasks.parquet present")
    if tasks.exists():
        t = pq.read_table(tasks)
        check({"task_index", "task"} <= set(t.column_names), "tasks.parquet has task_index and task")
        check(t.num_rows >= 1, f"tasks.parquet has {t.num_rows} task(s)")

    check((root / "meta" / "stats.json").exists(), "meta/stats.json present")

    rows = pq.read_table(data_files[0]).num_rows
    check(rows == info.get("total_frames"), f"total_frames matches parquet rows ({rows})")
    if args.probe:
        check(all(pq.read_table(f).num_rows > 0 for f in data_files), "all data files readable")

    if "observation.images.wrist" in features:
        video = next((root / "videos").glob("observation.images.wrist/chunk-*/file-*.mp4"), None)
        check(video is not None, "advertised video feature has an MP4")
        if video is not None:
            ffprobe = shutil.which("ffprobe")
            if not ffprobe:
                print("SKIP  ffprobe not on PATH; MP4 content not inspected")
            else:
                proc = subprocess.run(
                    [ffprobe, "-v", "error", "-select_streams", "v:0", "-count_frames",
                     "-show_entries", "stream=codec_name,pix_fmt,width,height,nb_read_frames,r_frame_rate",
                     "-of", "json", str(video)],
                    capture_output=True, text=True,
                )
                if proc.returncode != 0:
                    fail(f"ffprobe could not read {video.name}: {proc.stderr.strip()[:200]}")
                else:
                    stream = json.loads(proc.stdout)["streams"][0]
                    check(stream.get("codec_name") == "h264", f"video codec is h264 (got {stream.get('codec_name')})")
                    check(stream.get("pix_fmt") in ("yuv420p", "yuvj420p"), f"video pixel format is yuv420p (got {stream.get('pix_fmt')})")
                    frames = int(stream.get("nb_read_frames", 0))
                    check(frames == rows, f"video frame count matches parquet rows ({frames})")
                    check(int(stream.get("width", 0)) == features["observation.images.wrist"]["shape"][1],
                          f"video width matches info.json ({stream.get('width')} px)")

    print()
    if failures:
        print(f"{len(failures)} check(s) failed")
        return 1
    print("dataset matches the LeRobot v3.0 layout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
