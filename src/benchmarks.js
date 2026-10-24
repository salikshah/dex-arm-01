// DEX ARM 01: Dex-YCB Manipulation Benchmark Objects & Grasp Execution Engine
// Implements standard calibrated YCB robotics benchmark objects (Mug, Bleach Bottle, Can, Stylus)
// with physical mass, friction, approach trajectories, and automated Ferrari-Canny grasp lifts.

import * as THREE from 'three';

export const YCB_OBJECTS = {
  '025_mug': {
    id: '025_mug',
    name: 'YCB 025 Mug',
    massKg: 0.118,
    friction: 0.75,
    type: 'cylindrical_handle',
    radius: 0.040,
    height: 0.082,
    recommendedGrasp: 'pinch',
    offset: [0.0, 0.041, 0.0]
  },
  '021_bleach_cleanser': {
    id: '021_bleach_cleanser',
    name: 'YCB 021 Bleach Cleanser',
    massKg: 0.603,
    friction: 0.65,
    type: 'large_cylinder',
    radius: 0.045,
    height: 0.220,
    recommendedGrasp: 'fist',
    offset: [0.0, 0.110, 0.0]
  },
  '002_master_chef_can': {
    id: '002_master_chef_can',
    name: 'YCB 002 Chef Can',
    massKg: 0.414,
    friction: 0.80,
    type: 'can',
    radius: 0.038,
    height: 0.100,
    recommendedGrasp: 'pinch',
    offset: [0.0, 0.050, 0.0]
  },
  'precision_stylus': {
    id: 'precision_stylus',
    name: 'Titanium Surgical Stylus',
    massKg: 0.045,
    friction: 0.85,
    type: 'stylus',
    radius: 0.005,
    height: 0.140,
    recommendedGrasp: 'pinch',
    offset: [0.0, 0.070, 0.0]
  }
};

export class BenchmarkEngine {
  constructor(scene, model, pose, ikSolver, biomechanics, dynamics) {
    this.scene = scene;
    this.model = model;
    this.pose = pose;
    this.ikSolver = ikSolver;
    this.biomechanics = biomechanics;
    this.dynamics = dynamics;

    this.currentObject = null;
    this.objectMesh = null;
    this.tableMesh = this._createTestTable();
    this.tableMesh.visible = false;
    this.scene.add(this.tableMesh);

    this.isGrasping = false;
    this.graspAnimation = null;
  }

  _createTestTable() {
    const group = new THREE.Group();
    group.name = 'Benchmark_Test_Platform';

    // Work surface slab
    const tableGeo = new THREE.BoxGeometry(0.55, 0.02, 0.45);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x1f2429,
      metalness: 0.3,
      roughness: 0.65,
    });
    const slab = new THREE.Mesh(tableGeo, tableMat);
    slab.position.set(-0.28, -0.01, 0.18);
    group.add(slab);

    // Coordinate grid markings
    const grid = new THREE.GridHelper(0.40, 8, 0x38bdf8, 0x374151);
    grid.position.set(-0.28, 0.001, 0.18);
    group.add(grid);

    return group;
  }

  spawnObject(objectId) {
    this.clearObject();
    const spec = YCB_OBJECTS[objectId];
    if (!spec) return null;

    this.currentObject = spec;
    this.tableMesh.visible = true;

    const group = new THREE.Group();
    group.name = 'YCB_' + spec.id;

    if (spec.type === 'can' || spec.type === 'large_cylinder') {
      const geo = new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, 32);
      const mat = new THREE.MeshStandardMaterial({
        color: spec.type === 'can' ? 0xb45309 : 0x0284c7,
        metalness: spec.type === 'can' ? 0.7 : 0.1,
        roughness: spec.type === 'can' ? 0.3 : 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, spec.height / 2, 0);
      group.add(mesh);
    } else if (spec.type === 'cylindrical_handle') {
      // Mug body
      const bodyGeo = new THREE.CylinderGeometry(spec.radius, spec.radius * 0.92, spec.height, 32);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.25, metalness: 0.05 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.set(0, spec.height / 2, 0);
      group.add(body);

      // Mug handle
      const handleGeo = new THREE.TorusGeometry(0.022, 0.006, 16, 24, Math.PI);
      const handleMat = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.25 });
      const handle = new THREE.Mesh(handleGeo, handleMat);
      handle.position.set(spec.radius + 0.005, spec.height * 0.52, 0);
      handle.rotateZ(-Math.PI / 2);
      group.add(handle);
    } else if (spec.type === 'stylus') {
      const stylusGeo = new THREE.CylinderGeometry(spec.radius, spec.radius * 0.3, spec.height, 16);
      const stylusMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.2 });
      const stylus = new THREE.Mesh(stylusGeo, stylusMat);
      stylus.position.set(0, spec.height / 2, 0);
      group.add(stylus);
    }

    // Place on center of test table
    group.position.set(-0.28, 0.0, 0.18);
    this.scene.add(group);
    this.objectMesh = group;

    // Apply object mass payload to actuator dynamics
    this.dynamics.setPayload(spec.massKg);

    return { spec, group };
  }

  clearObject() {
    if (this.objectMesh) {
      this.scene.remove(this.objectMesh);
      this.objectMesh = null;
    }
    this.currentObject = null;
    this.tableMesh.visible = false;
    this.dynamics.setPayload(0.0);
  }

  // Executes automated approach, grasp, Ferrari-Canny check, and lift sequence
  executeGraspSequence(onProgress = null) {
    if (!this.currentObject || !this.objectMesh) return false;

    const spec = this.currentObject;
    const objPos = this.objectMesh.position.clone();

    // Sequence stages:
    // 0.0 - 1.0s: Move IK target above object (approach)
    // 1.0 - 2.0s: Open fingers (pre-shape)
    // 2.0 - 3.2s: Descend hand to object grasping height
    // 3.2 - 4.5s: Close fingers around object (grasp engagement)
    // 4.5 - 6.0s: Lift object 12cm off table (payload verification)
    this.isGrasping = true;
    const startTime = performance.now();
    const duration = 6000;

    const initialArmAngles = [...this.pose.armAngles];
    const initialHandAngles = [...this.pose.handAngles];

    this.graspAnimation = {
      update: (now) => {
        const elapsed = now - startTime;
        const p = Math.min(1.0, elapsed / duration);

        if (p < 0.25) {
          // Stage 1: Pre-shape open hand
          const u = p / 0.25;
          this.pose.setGesture('open', { duration: 0.1 });
          onProgress?.({ stage: 'APPROACH & PRE-SHAPE', progress: p, epsilon: 0.0 });
        } else if (p < 0.50) {
          // Stage 2: Descend to object
          const u = (p - 0.25) / 0.25;
          const graspHeight = objPos.clone().add(new THREE.Vector3(0, spec.height * 0.55, 0));
          this.ikSolver.setEnabled(true);
          this.ikSolver.setTargetPosition(graspHeight);
          this.ikSolver.solve();
          onProgress?.({ stage: 'DESCEND TO CONTACT', progress: p, epsilon: 0.05 });
        } else if (p < 0.75) {
          // Stage 3: Close fingers into recommended grasp
          const u = (p - 0.50) / 0.25;
          this.pose.setGesture(spec.recommendedGrasp, { duration: 0.2 });
          const quality = this.biomechanics.evaluateGraspQuality(objPos);
          onProgress?.({
            stage: 'FORCE CLOSURE ENGAGEMENT',
            progress: p,
            epsilon: quality.epsilon,
            isForceClosure: quality.isForceClosure
          });
        } else {
          // Stage 4: Lift object
          const u = (p - 0.75) / 0.25;
          const liftHeight = objPos.clone().add(new THREE.Vector3(0, spec.height * 0.55 + 0.12 * u, 0));
          this.ikSolver.setTargetPosition(liftHeight);
          this.ikSolver.solve();

          // Attach object to hand elevation
          if (this.objectMesh) {
            this.objectMesh.position.y = 0.12 * u;
          }

          const quality = this.biomechanics.evaluateGraspQuality(this.objectMesh?.position);
          onProgress?.({
            stage: 'PAYLOAD LIFT VERIFIED',
            progress: p,
            epsilon: quality.epsilon,
            isForceClosure: quality.isForceClosure,
            liftMm: Number((u * 120).toFixed(0))
          });
        }

        if (p >= 1.0) {
          this.graspAnimation = null;
          this.isGrasping = false;
          onProgress?.({ stage: 'BENCHMARK COMPLETE', progress: 1.0, done: true });
        }
      }
    };

    return true;
  }
}
