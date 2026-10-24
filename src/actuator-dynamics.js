// DEX ARM 01: Actuator Dynamics, Harmonic Drive Torque Curves, and Thermal Model
// Models strain-wave gear reducers (Harmonic Drive AG), continuous vs. peak torque envelopes,
// real-time gravity static loads, and I^2*R coil thermal saturation.

import * as THREE from 'three';

export const ACTUATORS = [
  { id: 'J1', name: 'Base Yaw', gearRatio: 100, ratedTorque: 42, peakTorque: 120, maxRpm: 180, coilResistance: 0.85, thermalRes: 1.8, massKg: 1.8 },
  { id: 'J2', name: 'Shoulder Pitch', gearRatio: 100, ratedTorque: 42, peakTorque: 120, maxRpm: 180, coilResistance: 0.85, thermalRes: 1.8, massKg: 1.2 },
  { id: 'J3', name: 'Shoulder Roll', gearRatio: 80, ratedTorque: 28, peakTorque: 80, maxRpm: 220, coilResistance: 1.15, thermalRes: 2.2, massKg: 1.0 },
  { id: 'J4', name: 'Elbow Pitch', gearRatio: 80, ratedTorque: 28, peakTorque: 80, maxRpm: 220, coilResistance: 1.15, thermalRes: 2.2, massKg: 0.9 },
  { id: 'J5', name: 'Forearm Roll', gearRatio: 50, ratedTorque: 14, peakTorque: 35, maxRpm: 300, coilResistance: 1.65, thermalRes: 3.1, massKg: 0.6 },
  { id: 'J6', name: 'Wrist Pitch', gearRatio: 50, ratedTorque: 14, peakTorque: 35, maxRpm: 300, coilResistance: 1.65, thermalRes: 3.1, massKg: 0.45 },
  { id: 'J7', name: 'Wrist Roll', gearRatio: 30, ratedTorque: 8, peakTorque: 20, maxRpm: 360, coilResistance: 2.10, thermalRes: 4.2, massKg: 0.35 },
];

export class ActuatorDynamics {
  constructor(model, pose) {
    this.model = model;
    this.pose = pose;

    this.ambientTemp = 25.0; // °C
    this.temperatures = ACTUATORS.map(() => 25.0); // Current winding temps (°C)
    this.torques = new Float32Array(7);             // Static + dynamic torque (Nm)
    this.payloadKg = 0.0;                          // Optional held payload

    // Link mass center offsets (meters in local segment frame)
    this.linkCOMs = [
      new THREE.Vector3(0, 0.04, 0),
      new THREE.Vector3(0, 0.06, 0),
      new THREE.Vector3(0, 0.08, 0),
      new THREE.Vector3(0, 0.07, 0),
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(0, 0.04, 0),
      new THREE.Vector3(0, 0.03, 0),
    ];
    this.handMassKg = 0.65;
  }

  setPayload(kg) {
    this.payloadKg = Math.max(0, Number(kg) || 0);
  }

  // Updates static gravitational torques for all 7 axes
  updateTorques() {
    this.model.root.updateMatrixWorld(true);
    const pivots = this.pose.armPivots;
    if (!pivots || pivots.length < 7) return this.torques;

    const g = 9.81; // m/s^2

    // Get world positions of all pivots
    const pivotPositions = [];
    const pivotAxes = [];
    for (let i = 0; i < 7; i++) {
      const p = pivots[i].obj;
      pivotPositions.push(p.getWorldPosition(new THREE.Vector3()));
      const axis = new THREE.Vector3(0, pivots[i].axis === 'y' ? 1 : 0, pivots[i].axis === 'z' ? 1 : 0);
      axis.transformDirection(p.matrixWorld).normalize();
      pivotAxes.push(axis);
    }

    // End effector payload position
    const eeNode = this.model.nodeByName.get('hand') || pivots[6].obj;
    const eePos = eeNode.getWorldPosition(new THREE.Vector3());

    // Recursive calculation: torque on joint i = sum over downstream links k >= i of (r_k x m_k * g) . axis_i
    for (let i = 0; i < 7; i++) {
      let tau = 0.0;
      const p_i = pivotPositions[i];
      const z_i = pivotAxes[i];

      // Downstream link masses
      for (let k = i; k < 7; k++) {
        const m_k = ACTUATORS[k].massKg;
        const p_k = pivotPositions[k].clone().add(this.linkCOMs[k]);
        const r = p_k.sub(p_i);
        // Force vector = (0, -m*g, 0)
        const gravityTorque = new THREE.Vector3(0, -m_k * g, 0).cross(r);
        tau += gravityTorque.dot(z_i);
      }

      // Hand + payload mass
      const totalTipMass = this.handMassKg + this.payloadKg;
      const r_tip = eePos.clone().sub(p_i);
      const tipGravityTorque = new THREE.Vector3(0, -totalTipMass * g, 0).cross(r_tip);
      tau += tipGravityTorque.dot(z_i);

      this.torques[i] = Math.abs(tau);
    }

    return this.torques;
  }

  // Integrates thermal dissipation model: dT/dt = (tau^2 * R / K_t^2 - (T - T_amb)/tau_cool)
  updateThermal(dt) {
    this.updateTorques();

    for (let i = 0; i < 7; i++) {
      const spec = ACTUATORS[i];
      const tau = this.torques[i];

      // Heating power: P = I^2 * R = (tau / K_t)^2 * R
      // K_t roughly estimated from peak torque / peak current
      const Kt = spec.ratedTorque / 8.0; // Nm/A
      const current = tau / Kt;
      const heatWatts = current * current * spec.coilResistance * 0.08;

      // Cooling rate (convective dissipation to casing)
      const coolingWatts = (this.temperatures[i] - this.ambientTemp) / spec.thermalRes;

      // Net thermal rise (°C/sec)
      const dT = (heatWatts - coolingWatts) * dt * 0.12;
      this.temperatures[i] = Math.max(this.ambientTemp, Math.min(115.0, this.temperatures[i] + dT));
    }

    return this.temperatures;
  }

  // Returns full actuator health, torque utilization, and thermal status
  getActuatorStatus() {
    this.updateTorques();

    return ACTUATORS.map((spec, i) => {
      const tau = this.torques[i];
      const temp = this.temperatures[i];
      const utilRated = tau / spec.ratedTorque;
      const utilPeak = tau / spec.peakTorque;

      let status = 'NOMINAL';
      if (temp > 85.0 || utilRated > 1.0) status = 'OVERLOAD_WARNING';
      if (temp > 100.0 || utilPeak > 1.0) status = 'THERMAL_CUTOFF';

      return {
        id: spec.id,
        name: spec.name,
        torqueNm: Number(tau.toFixed(1)),
        ratedTorque: spec.ratedTorque,
        peakTorque: spec.peakTorque,
        utilizationPct: Number((utilRated * 100).toFixed(0)),
        temperatureC: Number(temp.toFixed(1)),
        status
      };
    });
  }
}
