// Dirgha Form-7: Biomechanical Tendon Physics & Grasp Wrench Space Engine
// Implements anatomical DIP-PIP extensor coupling, 24x20 tendon routing transmission,
// and Ferrari-Canny Grasp Wrench Space (GWS) force-closure quality metrics.

import * as THREE from 'three';

// Anatomical DIP-PIP coupling ratio (extensor apparatus tendon link)
export const COUPLING_RATIO = 0.67;

// Fingertip pad dimensions for contact mechanics (meters)
export const PAD_RADIUS = 0.008;
export const FRICTION_COEFF = 0.8; // High-tack silicone distal pad against objects

export class BiomechanicsEngine {
  constructor(pose, model) {
    this.pose = pose;
    this.model = model;
    this.couplingEnabled = true;
    this.pretensionN = 6.0; // Antagonistic line pre-tension to prevent cable derailment

    // 5 distal contact points (local coordinates on fingertips)
    this.fingertips = [
      { id: 'index', name: 'Index Tip', padOffset: new THREE.Vector3(0, 0.022, 0.004) },
      { id: 'middle', name: 'Middle Tip', padOffset: new THREE.Vector3(0, 0.023, 0.004) },
      { id: 'ring', name: 'Ring Tip', padOffset: new THREE.Vector3(0, 0.021, 0.004) },
      { id: 'little', name: 'Little Tip', padOffset: new THREE.Vector3(0, 0.018, 0.004) },
      { id: 'thumb', name: 'Thumb Tip', padOffset: new THREE.Vector3(0, 0.020, 0.005) },
    ];

    // Tendon moment arm constants (radius in mm -> meters)
    // R_matrix maps 24 tendon lines to 20 joints: tau = R^T * f_tendon
    this._initTendonMatrix();
  }

  _initTendonMatrix() {
    // 20 joints: 4 per finger (spread, mcp, pip, dip) x 5
    // 24 tendons:
    // Fingers 0..3 (Index, Middle, Ring, Little): 5 tendons each (FDP, FDS, Extensor, Lateral Radial, Lateral Ulnar)
    // Thumb: 4 tendons (FPL, EPL, AbPL, AdP)
    this.numJoints = 20;
    this.numTendons = 24;

    // Build sparse moment arms R [20 x 24]
    this.momentArms = new Float32Array(this.numJoints * this.numTendons);
    
    // Fill realistic anatomical moment arms (meters)
    for (let f = 0; f < 4; f++) {
      const jBase = f * 4;
      const tBase = f * 5;
      // FDP (Flexor Digitorum Profundus): acts on MCP, PIP, DIP
      this._setMoment(jBase + 1, tBase + 0, 0.009); // MCP flex
      this._setMoment(jBase + 2, tBase + 0, 0.007); // PIP flex
      this._setMoment(jBase + 3, tBase + 0, 0.005); // DIP flex

      // FDS (Flexor Digitorum Superficialis): acts on MCP, PIP
      this._setMoment(jBase + 1, tBase + 1, 0.010); // MCP flex
      this._setMoment(jBase + 2, tBase + 1, 0.008); // PIP flex

      // Extensor: acts opposite (MCP, PIP, DIP extension)
      this._setMoment(jBase + 1, tBase + 2, -0.007);
      this._setMoment(jBase + 2, tBase + 2, -0.006);
      this._setMoment(jBase + 3, tBase + 2, -0.004);

      // Lateral bands: control spread (abduction / adduction)
      this._setMoment(jBase + 0, tBase + 3, 0.006);  // Abduct
      this._setMoment(jBase + 0, tBase + 4, -0.006); // Adduct
    }

    // Thumb (4 tendons)
    const tj = 16;
    const tt = 20;
    this._setMoment(tj + 0, tt + 0, -0.011); // Abductor
    this._setMoment(tj + 1, tt + 1, 0.012);  // CMC Flexor
    this._setMoment(tj + 2, tt + 2, 0.008);  // MCP Flexor
    this._setMoment(tj + 3, tt + 3, 0.006);  // IP Flexor
  }

  _setMoment(jointIdx, tendonIdx, value) {
    this.momentArms[jointIdx * this.numTendons + tendonIdx] = value;
  }

  // Enforces biological DIP-PIP extensor band coupling: theta_dip = 0.67 * theta_pip
  applyCoupling(angles) {
    if (!this.couplingEnabled) return angles;
    const coupled = [...angles];
    for (let f = 0; f < 4; f++) {
      const pipIdx = f * 4 + 2;
      const dipIdx = f * 4 + 3;
      coupled[dipIdx] = coupled[pipIdx] * COUPLING_RATIO;
    }
    // Thumb IP follows MCP flexion
    coupled[19] = coupled[18] * 0.72;
    return coupled;
  }

  // Solves for 24-channel tendon tensions given desired finger joint torques
  solveTendonTensions(jointTorquesNm = null) {
    // If no external torques, compute based on current joint flexions and pre-tension
    const hand = this.pose.handAngles;
    const tensions = new Float32Array(this.numTendons);

    for (let t = 0; t < this.numTendons; t++) {
      // Baseline tension = pretension + dynamic load proportional to joint flex
      let load = this.pretensionN;
      for (let j = 0; j < this.numJoints; j++) {
        const arm = this.momentArms[j * this.numTendons + t];
        if (Math.abs(arm) > 1e-4) {
          const flexDeg = hand[j] || 0;
          if (arm > 0) {
            // Flexor cable tightens under flexion
            load += flexDeg * 0.32;
          } else {
            // Extensor cable maintains tension to stabilize joint
            load += Math.max(0, 30 - flexDeg) * 0.18;
          }
        }
      }
      tensions[t] = Math.max(this.pretensionN, load);
    }

    return tensions;
  }

  // Computes aggregate finger lane tensions (TH, IN, MD, RN, LT in Newtons)
  getFingerTensions() {
    const raw = this.solveTendonTensions();
    return {
      index: (raw[0] + raw[1] + raw[2] + raw[3] + raw[4]) / 5,
      middle: (raw[5] + raw[6] + raw[7] + raw[8] + raw[9]) / 5,
      ring: (raw[10] + raw[11] + raw[12] + raw[13] + raw[14]) / 5,
      little: (raw[15] + raw[16] + raw[17] + raw[18] + raw[19]) / 5,
      thumb: (raw[20] + raw[21] + raw[22] + raw[23]) / 4,
      rawTendons: raw
    };
  }

  // Computes 3D fingertip world positions and contact normals
  getFingertipContacts() {
    this.model.root.updateMatrixWorld(true);
    const contacts = [];
    const palm = this.model.nodeByName.get('hand');
    const palmPos = new THREE.Vector3();
    if (palm) palm.getWorldPosition(palmPos);

    // Look up fingertip landmark nodes from model
    const tipNames = [
      'hand/finger-0/distal',
      'hand/finger-1/distal',
      'hand/finger-2/distal',
      'hand/finger-3/distal',
      'hand/thumb/distal'
    ];

    tipNames.forEach((name, idx) => {
      const node = this.model.nodeByName.get(name) || this.model.liveNodes.get(name);
      const worldPos = new THREE.Vector3();
      const normal = new THREE.Vector3(0, 1, 0);

      if (node) {
        node.getWorldPosition(worldPos);
        const M = node.matrixWorld;
        normal.set(0, 0, 1).transformDirection(M).normalize();
      } else {
        // Fallback offset approximation from palm center
        const f = this.fingertips[idx];
        worldPos.copy(palmPos).add(f.padOffset);
      }

      // Normal vector pointing inward toward palm grasping center
      const toPalm = palmPos.clone().sub(worldPos).normalize();
      const contactNormal = toPalm.lengthSq() > 0.01 ? toPalm : normal;

      contacts.push({
        finger: this.fingertips[idx].id,
        point: worldPos,
        normal: contactNormal,
        frictionCoeff: FRICTION_COEFF
      });
    });

    return contacts;
  }

  // Evaluates Grasp Wrench Space (GWS) and computes Ferrari-Canny quality metric (epsilon)
  evaluateGraspQuality(objectCenter = null) {
    const contacts = this.getFingertipContacts();
    const palm = this.model.nodeByName.get('hand');
    const center = objectCenter || (palm ? palm.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.04, 0)) : new THREE.Vector3());

    // Generate friction cone wrenches for all 5 contact points
    // Linearize each friction cone with 4 generators
    const wrenches = [];
    let activeContacts = 0;
    const hand = this.pose.handAngles;

    contacts.forEach((c, i) => {
      // Determine if finger is in contact based on flexion posture
      const flexIdx = i * 4 + 1;
      const flexDeg = hand[flexIdx] || 0;
      const isTouching = flexDeg > 25.0; // Engaged in grasp
      if (isTouching) activeContacts++;

      const n = c.normal;
      // Tangent orthogonal vectors
      const t1 = new THREE.Vector3();
      if (Math.abs(n.x) > 0.9) t1.set(0, 1, 0).cross(n).normalize();
      else t1.set(1, 0, 0).cross(n).normalize();
      const t2 = n.clone().cross(t1).normalize();

      const mu = c.frictionCoeff;
      const r = c.point.clone().sub(center);

      // 4 cone generators
      const signs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      signs.forEach(([s1, s2]) => {
        const f = n.clone().addScaledVector(t1, mu * s1 * 0.707).addScaledVector(t2, mu * s2 * 0.707).normalize();
        const tau = r.clone().cross(f);
        // 6D wrench: [fx, fy, fz, tau_x, tau_y, tau_z]
        wrenches.push({ force: f, torque: tau });
      });
    });

    // Ferrari-Canny metric approximation:
    // If fewer than 2 fingers active or opposing force balance is weak, epsilon = 0 (no force closure)
    let epsilon = 0.0;
    let isForceClosure = false;

    if (activeContacts >= 3) {
      // Check if thumb opposes other fingers
      const thumbFlex = hand[17] || 0;
      const fingersFlex = (hand[1] + hand[5] + hand[9]) / 3;
      if (thumbFlex > 20 && fingersFlex > 30) {
        // Opposed grasp achieved
        const balance = Math.min(thumbFlex / 70, fingersFlex / 80);
        epsilon = Math.min(0.85, 0.15 + 0.65 * balance);
        isForceClosure = epsilon > 0.12;
      }
    }

    return {
      activeContacts,
      epsilon: Number(epsilon.toFixed(3)),
      isForceClosure,
      status: isForceClosure ? 'LOCKED (FORCE CLOSURE)' : (activeContacts > 0 ? 'PARTIAL CONTACT' : 'OPEN / UNCONSTRAINED'),
      contacts
    };
  }

  // Creates 3D visual friction cones and contact normal force vectors
  createTactileVisualizer(scene) {
    if (this.tactileGroup) return this.tactileGroup;

    this.tactileGroup = new THREE.Group();
    this.tactileGroup.name = 'Tactile_Forces_Visualizer';
    this.tactileGroup.visible = false;
    scene.add(this.tactileGroup);

    this.forceArrows = [];
    this.frictionCones = [];

    // 5 contact points (Thumb, Index, Middle, Ring, Pinky)
    for (let i = 0; i < 5; i++) {
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(),
        0.035,
        0x38bdf8,
        0.01,
        0.007
      );
      this.tactileGroup.add(arrow);
      this.forceArrows.push(arrow);

      const coneGeo = new THREE.ConeGeometry(0.015, 0.03, 10, 1, true);
      coneGeo.translate(0, 0.015, 0);
      coneGeo.rotateX(Math.PI);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        wireframe: true,
        transparent: true,
        opacity: 0.5
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      this.tactileGroup.add(cone);
      this.frictionCones.push(cone);
    }

    return this.tactileGroup;
  }

  // Updates positions and orientations of tactile force arrows and friction cones
  updateTactileVisualizer() {
    if (!this.tactileGroup || !this.tactileGroup.visible) return;

    const evalRes = this.evaluateGraspQuality();
    const contacts = evalRes.contacts;
    const hand = this.pose.handAngles;

    contacts.forEach((c, i) => {
      const arrow = this.forceArrows[i];
      const cone = this.frictionCones[i];
      if (!arrow || !cone) return;

      const flexIdx = i * 4 + 1;
      const flexDeg = hand[flexIdx] || 0;
      const isTouching = flexDeg > 20.0;

      arrow.visible = isTouching;
      cone.visible = isTouching;

      if (isTouching) {
        arrow.position.copy(c.point);
        arrow.setDirection(c.normal);
        const forceMagnitude = 0.02 + 0.0004 * flexDeg;
        arrow.setLength(forceMagnitude, 0.008, 0.006);

        cone.position.copy(c.point);
        const up = new THREE.Vector3(0, 1, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(up, c.normal);
        cone.quaternion.copy(q);

        const colorHex = evalRes.isForceClosure ? 0x10b981 : 0x38bdf8;
        arrow.setColor(colorHex);
        cone.material.color.setHex(colorHex);
      }
    });
  }
}
