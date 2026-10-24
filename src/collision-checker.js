// Dirgha Form-7: Self-Collision Detection & Workspace Safety Engine
// Implements capsule-capsule continuous distance queries (Ericson / Sunday algorithm)
// between non-adjacent manipulator segments and floor boundary checks.

import * as THREE from 'three';

export class CollisionChecker {
  constructor(model, pose) {
    this.model = model;
    this.pose = pose;

    // Segment definitions (start joint index, end joint index, capsule radius in meters)
    // Non-adjacent segment pairs to check:
    // Pair 1: Base / Shoulder (J1-J2, radius 0.048) vs Hand (J7-Tip, radius 0.045)
    // Pair 2: Upper Arm (J2-J4, radius 0.042) vs Hand (J7-Tip, radius 0.045)
    // Pair 3: Upper Arm (J2-J4, radius 0.042) vs Forearm (J5-J7, radius 0.038)
    this.segments = [
      { id: 'base', startNode: 'J1', endNode: 'J2', radius: 0.048 },
      { id: 'upper_arm', startNode: 'J2', endNode: 'J4', radius: 0.042 },
      { id: 'forearm', startNode: 'J4', endNode: 'J6', radius: 0.038 },
      { id: 'hand', startNode: 'J6', endNode: 'hand', radius: 0.045 },
    ];

    this.checkPairs = [
      ['base', 'hand'],
      ['upper_arm', 'hand'],
      ['base', 'forearm'],
    ];

    this.warningThresholdMm = 25.0; // Proximity alert if clearance < 25mm
    this.collisionThresholdMm = 0.0; // Collision if clearance <= 0mm

    this.state = {
      minClearanceMm: 120.0,
      status: 'CLEAR', // 'CLEAR' | 'PROXIMITY' | 'COLLISION'
      activePair: null,
      floorClearanceMm: 150.0,
    };
  }

  // Segment to segment closest distance (Christer Ericson algorithm)
  _segmentSegmentDistSq(p1, q1, p2, q2) {
    const d1 = new THREE.Vector3().subVectors(q1, p1);
    const d2 = new THREE.Vector3().subVectors(q2, p2);
    const r = new THREE.Vector3().subVectors(p1, p2);

    const a = d1.dot(d1);
    const e = d2.dot(d2);
    const f = d2.dot(r);

    const EPS = 1e-7;
    let s = 0.0;
    let t = 0.0;

    if (a <= EPS && e <= EPS) {
      return r.lengthSq();
    }
    if (a <= EPS) {
      s = 0.0;
      t = Math.min(Math.max(f / e, 0.0), 1.0);
    } else {
      const c = d1.dot(r);
      if (e <= EPS) {
        t = 0.0;
        s = Math.min(Math.max(-c / a, 0.0), 1.0);
      } else {
        const b = d1.dot(d2);
        const denom = a * e - b * b;

        if (denom !== 0.0) {
          s = Math.min(Math.max((b * f - c * e) / denom, 0.0), 1.0);
        } else {
          s = 0.0;
        }

        t = (b * s + f) / e;
        if (t < 0.0) {
          t = 0.0;
          s = Math.min(Math.max(-c / a, 0.0), 1.0);
        } else if (t > 1.0) {
          t = 1.0;
          s = Math.min(Math.max((b - c) / a, 0.0), 1.0);
        }
      }
    }

    const c1 = p1.clone().addScaledVector(d1, s);
    const c2 = p2.clone().addScaledVector(d2, t);
    return c1.sub(c2).lengthSq();
  }

  check() {
    this.model.root.updateMatrixWorld(true);
    const pivots = this.pose.armPivots;
    if (!pivots || pivots.length < 7) return this.state;

    // Joint landmark world positions
    const pBase = pivots[0].obj.getWorldPosition(new THREE.Vector3());
    const pShoulder = pivots[1].obj.getWorldPosition(new THREE.Vector3());
    const pElbow = pivots[3].obj.getWorldPosition(new THREE.Vector3());
    const pWrist = pivots[5].obj.getWorldPosition(new THREE.Vector3());
    const eeNode = this.model.nodeByName.get('hand') || pivots[6].obj;
    const pHand = eeNode.getWorldPosition(new THREE.Vector3());

    // Segments: [p, q, radius]
    const segMap = {
      base: { p: pBase, q: pShoulder, radius: 0.048 },
      upper_arm: { p: pShoulder, q: pElbow, radius: 0.042 },
      forearm: { p: pElbow, q: pWrist, radius: 0.038 },
      hand: { p: pWrist, q: pHand, radius: 0.045 },
    };

    let minClearanceM = 999.0;
    let closestPair = null;

    const checkPairs = [
      ['base', 'hand'],
      ['upper_arm', 'hand'],
      ['base', 'forearm'],
    ];

    for (const [idA, idB] of checkPairs) {
      const sA = segMap[idA];
      const sB = segMap[idB];
      if (!sA || !sB) continue;

      const distSq = this._segmentSegmentDistSq(sA.p, sA.q, sB.p, sB.q);
      const centerDist = Math.sqrt(distSq);
      const surfaceClearance = centerDist - (sA.radius + sB.radius);

      if (surfaceClearance < minClearanceM) {
        minClearanceM = surfaceClearance;
        closestPair = `${idA} ↔ ${idB}`;
      }
    }

    // Floor boundary check: lowest y among hand / wrist
    const lowestY = Math.min(pWrist.y, pHand.y);
    const floorClearanceM = Math.max(0, lowestY - 0.02);

    const minClearanceMm = Math.round(minClearanceM * 1000);
    const floorClearanceMm = Math.round(floorClearanceM * 1000);

    let status = 'CLEAR';
    if (minClearanceMm <= this.collisionThresholdMm || floorClearanceMm <= 0) {
      status = 'COLLISION';
    } else if (minClearanceMm <= this.warningThresholdMm || floorClearanceMm < 20) {
      status = 'PROXIMITY';
    }

    this.state = {
      minClearanceMm,
      status,
      activePair: closestPair,
      floorClearanceMm,
    };

    return this.state;
  }
}
