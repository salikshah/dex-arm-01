// DEX ARM 01: episode recorder.
//
// Frames are stored with LeRobot's feature naming so a recording can be turned
// into a dataset with scripts/lerobot_convert.py:
//   observation.state            float32[27]   arm 7 + hand 20 (degrees)
//   observation.tactile          float32[6]    5 finger tensions (N) + GWS ε
//   action                       float32[27]   commanded joint angles
//   observation.images.wrist     string        JPEG data URL (optional)
//
// The browser cannot write Parquet, so native episodes are newline-delimited
// JSON plus a metadata sidecar. The converter script is the bridge to the
// Hugging Face `lerobot` loaders.

export const HAND_JOINT_NAMES = [
  'index_abd', 'index_mcp', 'index_pip', 'index_dip',
  'middle_abd', 'middle_mcp', 'middle_pip', 'middle_dip',
  'ring_abd', 'ring_mcp', 'ring_pip', 'ring_dip',
  'little_abd', 'little_mcp', 'little_pip', 'little_dip',
  'thumb_abd', 'thumb_cmc', 'thumb_mcp', 'thumb_ip',
];

export const ARM_JOINT_NAMES = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7'];

export const STATE_NAMES = [...ARM_JOINT_NAMES, ...HAND_JOINT_NAMES];

// Matches the live LeRobot v3.0 metadata layout (verified against
// `lerobot/xarm_lift_medium`: `splits`, `data_path`, `video_path`, per-feature
// `fps`, motor names as {motors:[...]}).
export function buildInfo({ fps = 30, task = 'grasp', robotType = 'dex_arm_01', totalFrames = 0, totalEpisodes = 0 } = {}) {
  return {
    codebase_version: 'v3.0',
    robot_type: robotType,
    total_episodes: totalEpisodes,
    total_frames: totalFrames,
    total_tasks: 1,
    chunks_size: 1000,
    fps,
    splits: totalEpisodes ? { train: `0:${totalEpisodes}` } : { train: '0:0' },
    data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet',
    video_path: 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4',
    features: {
      'observation.state': { dtype: 'float32', shape: [27], names: { motors: STATE_NAMES }, fps },
      'observation.tactile': {
        dtype: 'float32',
        shape: [6],
        names: { motors: ['thumb_force_n', 'index_force_n', 'middle_force_n', 'ring_force_n', 'little_force_n', 'grasp_epsilon'] },
        fps,
      },
      action: { dtype: 'float32', shape: [27], names: { motors: STATE_NAMES }, fps },
      'observation.images.wrist': {
        dtype: 'video',
        shape: [192, 192, 3],
        names: ['height', 'width', 'channel'],
        video_info: { 'video.fps': fps, 'video.codec': 'h264', 'video.pix_fmt': 'yuv420p', 'video.is_depth_map': false, 'has_audio': false },
        fps,
      },
      timestamp: { dtype: 'float32', shape: [1], names: null, fps },
      frame_index: { dtype: 'int64', shape: [1], names: null, fps },
      episode_index: { dtype: 'int64', shape: [1], names: null, fps },
      index: { dtype: 'int64', shape: [1], names: null, fps },
      task_index: { dtype: 'int64', shape: [1], names: null, fps },
    },
    task,
  };
}

export class DatasetRecorder {
  constructor({ fps = 30, task = 'grasp', imageWidth = 192 } = {}) {
    this.fps = fps;
    this.task = task;
    this.imageWidth = imageWidth;
    this.frames = [];
    this.recording = false;
    this.startedAt = 0;
    this.lastCaptureAt = 0;
    this.episodeIndex = 0;
    this._imageFn = null;
  }

  setImageProvider(fn) {
    this._imageFn = typeof fn === 'function' ? fn : null;
  }

  setTask(task) {
    if (typeof task === 'string' && task.trim()) this.task = task.trim();
  }

  start() {
    this.frames = [];
    this.recording = true;
    this.startedAt = 0;
    this.lastCaptureAt = -Infinity;
    return true;
  }

  stop() {
    this.recording = false;
    return this.frames.length;
  }

  get frameCount() {
    return this.frames.length;
  }

  get duration() {
    return this.frames.length ? this.frames[this.frames.length - 1].timestamp : 0;
  }

  // `now` is monotonic milliseconds. `sample` carries live state:
  // { armAngles:[7], handAngles:[20], commandArm, commandHand, tensions:{...}, epsilon }
  tick(now, sample, image = null) {
    if (!this.recording || !sample) return null;
    if (this.startedAt === 0) this.startedAt = now;
    const minGap = 1000 / this.fps;
    if (now - this.lastCaptureAt < minGap - 1e-6) return null;

    const state = [...(sample.commandArm || sample.armAngles || []), ...(sample.commandHand || sample.handAngles || [])];
    if (state.length !== 27) return null;
    const action = [...(sample.targetArm || sample.armAngles || []), ...(sample.targetHand || sample.handAngles || [])];
    const tensions = sample.tensions || {};
    const tactile = [
      Number(tensions.thumb) || 0,
      Number(tensions.index) || 0,
      Number(tensions.middle) || 0,
      Number(tensions.ring) || 0,
      Number(tensions.little) || 0,
      Number(sample.epsilon) || 0,
    ];

    this.lastCaptureAt = now;
    const frame = {
      frame_index: this.frames.length,
      episode_index: this.episodeIndex,
      timestamp: Number(((now - this.startedAt) / 1000).toFixed(4)),
      task_index: 0,
      'observation.state': state.map((v) => Number(v.toFixed(3))),
      'observation.tactile': tactile.map((v) => Number(v.toFixed(3))),
      action: action.slice(0, 27).map((v) => Number(v.toFixed(3))),
      'observation.images.wrist': image,
      task: this.task,
    };
    this.frames.push(frame);
    return frame;
  }

  // Async helper: callers that capture an image should await this before
  // ticking so frames stay aligned with their pixels.
  async tickWithImage(now, sample, captureImage) {
    if (!this.recording) return null;
    const image = captureImage ? await captureImage() : null;
    return this.tick(now, sample, image);
  }

  toJSONL() {
    return this.frames.map((f) => JSON.stringify(f)).join('\n') + (this.frames.length ? '\n' : '');
  }

  toInfo() {
    return buildInfo({
      fps: this.fps,
      task: this.task,
      totalFrames: this.frames.length,
      totalEpisodes: this.frames.length ? 1 : 0,
    });
  }

  toEpisodeMeta() {
    return {
      episode_index: this.episodeIndex,
      task: this.task,
      tasks: [this.task],
      length: this.frames.length,
      fps: this.fps,
      duration_s: this.duration,
      source: 'dex-arm-01/browser',
    };
  }

  exportBundle() {
    return {
      info: this.toInfo(),
      episode: this.toEpisodeMeta(),
      frames_jsonl: this.toJSONL(),
    };
  }

  downloadJSONL(filename = 'dex_arm_01_episode.jsonl') {
    const blob = new Blob([this.toJSONL()], { type: 'application/x-ndjson' });
    download(blob, filename);
    return { filename, frames: this.frames.length, bytes: blob.size };
  }

  downloadMeta(filename = 'dex_arm_01_episode.meta.json') {
    const blob = new Blob([JSON.stringify({ info: this.toInfo(), episode: this.toEpisodeMeta() }, null, 2)], { type: 'application/json' });
    download(blob, filename);
    return { filename, bytes: blob.size };
  }
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
