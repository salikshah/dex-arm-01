// WebXR 25-joint hand → 20-DoF Dirgha joint vector.
// Dependency-free: unit tests exercise this without a browser or Three.js.

import { HAND_JOINT_LIMITS } from '../params.js';

export const FINGERS = ['index', 'middle', 'ring', 'little', 'thumb'];

export const JOINT_CHAINS = {
  index: ['index-finger-metacarpal', 'index-finger-proximal', 'index-finger-intermediate', 'index-finger-distal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-proximal', 'middle-finger-intermediate', 'middle-finger-distal', 'middle-finger-tip'],
  ring: ['ring-finger-metacarpal', 'ring-finger-proximal', 'ring-finger-intermediate', 'ring-finger-distal', 'ring-finger-tip'],
  little: ['pinky-finger-metacarpal', 'pinky-finger-proximal', 'pinky-finger-intermediate', 'pinky-finger-distal', 'pinky-finger-tip'],
  thumb: ['thumb-metacarpal', 'thumb-proximal', 'thumb-distal', 'thumb-tip'],
};

function toVec(p) {
  if (!p) return null;
  if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
  return [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Turn angle at `b`, in degrees. 0° means the chain is perfectly straight.
export function turnAngleDeg(a, b, c) {
  const v1 = sub(a, b);
  const v2 = sub(c, b);
  const n1 = norm(v1);
  const n2 = norm(v2);
  if (n1 < 1e-9 || n2 < 1e-9) return 0;
  const cos = clamp((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2), -1, 1);
  return 180 - (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Maps WebXR joint poses to the canonical 20-DoF vector used by Pose.
 * `joints` is an object keyed by WebXR joint name, each value either a
 * THREE.Vector3, {x,y,z}, or {position:{x,y,z}}. Missing chains stay at 0.
 */
export function mapHandJoints(joints) {
  const hand = new Array(20).fill(0);
  const positions = {};
  for (const [name, value] of Object.entries(joints || {})) {
    positions[name] = toVec(value?.position || value);
  }

  FINGERS.forEach((finger, fi) => {
    const chain = JOINT_CHAINS[finger].map((n) => positions[n]).filter(Boolean);
    const base = fi * 4;
    if (chain.length < 3) return;

    if (finger === 'thumb') {
      const [meta, prox, dist, tip] = chain;
      const cmc = turnAngleDeg(meta, prox, dist);
      const mcp = turnAngleDeg(prox, dist, tip || dist);
      const spread = HAND_JOINT_LIMITS.spread.thumb;
      hand[base + 0] = clamp(0, spread[0], spread[1]);
      hand[base + 1] = clamp(cmc, HAND_JOINT_LIMITS.flexion[0], HAND_JOINT_LIMITS.flexion[1]);
      hand[base + 2] = clamp(mcp, HAND_JOINT_LIMITS.flexion[0], HAND_JOINT_LIMITS.flexion[1]);
      // No separate tracked IP joint; follow the MCP at 0.72 like the MJCF
      // tendon equality constraint.
      hand[base + 3] = clamp(mcp * 0.72, HAND_JOINT_LIMITS.flexion[0], HAND_JOINT_LIMITS.flexion[1]);
      return;
    }

    const [meta, prox, inter, dist, tip] = chain;
    const mcp = turnAngleDeg(meta, prox, inter);
    const pip = turnAngleDeg(prox, inter, dist || inter);
    const dip = turnAngleDeg(inter, dist || inter, tip || dist || inter);
    const spread = HAND_JOINT_LIMITS.spread[finger];

    hand[base + 0] = clamp(0, spread[0], spread[1]);
    hand[base + 1] = clamp(mcp, HAND_JOINT_LIMITS.flexion[0], HAND_JOINT_LIMITS.flexion[1]);
    hand[base + 2] = clamp(pip, HAND_JOINT_LIMITS.flexion[0], HAND_JOINT_LIMITS.flexion[1]);
    hand[base + 3] = clamp(dip, HAND_JOINT_LIMITS.flexion[0], HAND_JOINT_LIMITS.flexion[1]);
  });

  return hand;
}

// Maps a wrist position in XR space to a reachable point in the scene. Every
// headset has a different seated origin, and the arm only reaches 0.72 m.
export function mapWristToWorkspace(position, calibration = {}) {
  const scale = calibration.scale ?? 1.5;
  const offset = calibration.offset || [0, 0.28, -0.30];
  return [
    position[0] * scale + offset[0],
    position[1] * scale + offset[1],
    position[2] * scale + offset[2],
  ];
}
