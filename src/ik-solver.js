// Dirgha Form-7: 7-Axis Damped Least Squares (DLS) Inverse Kinematics
// with Null-Space Joint Limit Avoidance and Yoshikawa Manipulability Ellipsoid.
// Adapted from Orocos KDL and MoveIt 2 redundant manipulator kinematics.

import * as THREE from 'three';
import { ARM_JOINTS } from './params.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export class IKSolver {
  constructor(model, pose, camera, renderer, controls = null) {
    this.model = model;
    this.pose = pose;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;

    this.enabled = false;
    this.damping = 0.04;      // Levenberg-Marquardt damping factor
    this.maxIterations = 8;
    this.tolerancePos = 0.002; // 2mm
    this.stepSize = 0.45;

    // 6D Target (Cartesian Position & Orientation)
    this.target = new THREE.Object3D();
    this.target.name = 'IK_Target';
    
    // Interactive 3D Target Gizmo
    this.gizmo = this._createTargetGizmo();
    this.gizmo.visible = false;
    this.model.root.parent ? this.model.root.parent.add(this.gizmo) : this.model.root.add(this.gizmo);

    // Manipulability Ellipsoid Visualizer
    this.ellipsoidMesh = this._createEllipsoidMesh();
    this.ellipsoidMesh.visible = false;
    this.model.root.parent ? this.model.root.parent.add(this.ellipsoidMesh) : this.model.root.add(this.ellipsoidMesh);

    // Scratch math objects
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._pEE = new THREE.Vector3();
    this._qEE = new THREE.Quaternion();
    this._mEE = new THREE.Matrix4();
    this._rotErr = new THREE.Vector3();

    // End effector node (wrist mount / palm root)
    this.eeNode = this.model.nodeByName.get('hand') || this.model.nodeByName.get('J7/mount');

    // Drag interaction state
    this._isDragging = false;
    this._dragPlane = new THREE.Plane();
    this._planeIntersect = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();

    this._setupDragListeners();
    this.syncTargetToCurrent();
  }

  _createTargetGizmo() {
    const group = new THREE.Group();
    group.name = 'IK_Gizmo';

    // Center handle sphere
    const sphereGeo = new THREE.SphereGeometry(0.016, 24, 24);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.userData.handle = 'center';
    group.add(sphere);

    // Core solid pip
    const pipGeo = new THREE.SphereGeometry(0.008, 16, 16);
    const pipMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    group.add(new THREE.Mesh(pipGeo, pipMat));

    // RGB Cartesian axes
    const makeAxis = (dir, color) => {
      const len = 0.07;
      const cylGeo = new THREE.CylinderGeometry(0.0025, 0.0025, len, 12);
      cylGeo.translate(0, len / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(cylGeo, mat);
      if (dir === 'x') mesh.rotateZ(-Math.PI / 2);
      else if (dir === 'z') mesh.rotateX(Math.PI / 2);
      return mesh;
    };

    group.add(makeAxis('x', 0xef4444)); // Red X
    group.add(makeAxis('y', 0x22c55e)); // Green Y
    group.add(makeAxis('z', 0x3b82f6)); // Blue Z

    // Orientation halo ring
    const ringGeo = new THREE.TorusGeometry(0.045, 0.0018, 16, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.35, transparent: true });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    group.add(ring);

    return group;
  }

  _createEllipsoidMesh() {
    const geo = new THREE.SphereGeometry(1, 24, 18);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
      wireframe: true,
      depthWrite: false
    });
    return new THREE.Mesh(geo, mat);
  }

  _setupDragListeners() {
    const dom = this.renderer.domElement;

    const updatePointer = (e) => {
      const rect = dom.getBoundingClientRect();
      this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera(this._mouse, this.camera);
    };

    const onPointerDown = (e) => {
      if (!this.enabled || !this.gizmo.visible) return;
      updatePointer(e);

      const hits = this._raycaster.intersectObject(this.gizmo, true);
      if (hits.length > 0) {
        this._isDragging = true;
        if (this.controls) this.controls.enabled = false;
        dom.style.cursor = 'grabbing';

        // Construct dragging plane facing camera at gizmo position
        const camDir = new THREE.Vector3();
        this.camera.getWorldDirection(camDir).negate();
        this._dragPlane.setFromNormalAndCoplanarPoint(camDir, this.gizmo.position);
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
      }
    };

    const onPointerMove = (e) => {
      if (!this.enabled || !this.gizmo.visible) return;
      updatePointer(e);

      if (!this._isDragging) {
        const hits = this._raycaster.intersectObject(this.gizmo, true);
        dom.style.cursor = hits.length > 0 ? 'grab' : '';
        return;
      }

      if (this._raycaster.ray.intersectPlane(this._dragPlane, this._planeIntersect)) {
        this.setTargetPosition(this._planeIntersect);
        this.solve();
      }
    };

    const onPointerUp = () => {
      if (this._isDragging) {
        this._isDragging = false;
        if (this.controls) this.controls.enabled = true;
        dom.style.cursor = '';
      }
    };

    dom.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
  }

  syncTargetToCurrent() {
    if (!this.eeNode) return;
    this.model.root.updateMatrixWorld(true);
    this.eeNode.getWorldPosition(this._pEE);
    this.eeNode.getWorldQuaternion(this._qEE);

    this.target.position.copy(this._pEE);
    this.target.quaternion.copy(this._qEE);
    this.gizmo.position.copy(this._pEE);
    this.gizmo.quaternion.copy(this._qEE);
  }

  setTargetPosition(pos) {
    // Clamp target within realistic reach envelope (0.15m to 0.72m from arm base)
    const baseNode = this.model.nodeByName.get('J1/mount') || this.model.root;
    const basePos = baseNode.getWorldPosition(new THREE.Vector3());
    const offset = pos.clone().sub(basePos);
    const dist = offset.length();

    const maxReach = 0.72;
    const minReach = 0.18;
    if (dist > maxReach) offset.setLength(maxReach);
    if (dist < minReach) offset.setLength(minReach);

    const clampedPos = basePos.add(offset);
    this.target.position.copy(clampedPos);
    this.gizmo.position.copy(clampedPos);
  }

  setEnabled(b) {
    this.enabled = !!b;
    this.gizmo.visible = this.enabled;
    if (this.enabled) this.syncTargetToCurrent();
    else this.ellipsoidMesh.visible = false;
  }

  setEllipsoidVisible(b) {
    this.ellipsoidMesh.visible = !!b;
  }

  // Solves 7-DoF DLS Inverse Kinematics
  solve() {
    if (!this.enabled || !this.eeNode) return false;

    const armPivots = this.pose.armPivots;
    if (!armPivots || armPivots.length < 7) return false;

    const targetPos = this.target.position;
    const angles = [...this.pose.armAngles];

    // Iterative Damped Least Squares loop
    for (let iter = 0; iter < this.maxIterations; iter++) {
      this.model.root.updateMatrixWorld(true);
      this.eeNode.getWorldPosition(this._pEE);

      // Position error e_p
      const posErr = targetPos.clone().sub(this._pEE);
      if (posErr.length() < this.tolerancePos) break;

      // Compute 3x7 Jacobian J_v (position only for intuitive 3D point tracking)
      const J = [];
      for (let i = 0; i < 7; i++) {
        const pivotObj = armPivots[i].obj;
        const pivotPos = pivotObj.getWorldPosition(new THREE.Vector3());
        const pivotAxis = new THREE.Vector3();

        if (armPivots[i].axis === 'y') pivotAxis.set(0, 1, 0);
        else pivotAxis.set(0, 0, 1);
        pivotAxis.transformDirection(pivotObj.matrixWorld).normalize();

        // Cross product: J_col = axis x (p_ee - p_pivot)
        const r = this._pEE.clone().sub(pivotPos);
        const col = pivotAxis.cross(r);
        J.push(col);
      }

      // Compute J * J^T (3x3 matrix)
      const JJT = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ];

      for (let i = 0; i < 7; i++) {
        const col = J[i];
        JJT[0][0] += col.x * col.x;
        JJT[0][1] += col.x * col.y;
        JJT[0][2] += col.x * col.z;

        JJT[1][0] += col.y * col.x;
        JJT[1][1] += col.y * col.y;
        JJT[1][2] += col.y * col.z;

        JJT[2][0] += col.z * col.x;
        JJT[2][1] += col.z * col.y;
        JJT[2][2] += col.z * col.z;
      }

      // Add Levenberg-Marquardt damping lambda^2 * I
      const d2 = this.damping * this.damping;
      JJT[0][0] += d2;
      JJT[1][1] += d2;
      JJT[2][2] += d2;

      // Invert 3x3 matrix JJT_inv
      const inv = this._invert3x3(JJT);
      if (!inv) break;

      // Multiply inv * posErr -> alpha [3x1]
      const ax = inv[0][0] * posErr.x + inv[0][1] * posErr.y + inv[0][2] * posErr.z;
      const ay = inv[1][0] * posErr.x + inv[1][1] * posErr.y + inv[1][2] * posErr.z;
      const az = inv[2][0] * posErr.x + inv[2][1] * posErr.y + inv[2][2] * posErr.z;

      // Delta theta = J^T * alpha (radians -> degrees) + Null-space natural rest bias
      for (let i = 0; i < 7; i++) {
        const dThetaRad = J[i].x * ax + J[i].y * ay + J[i].z * az;
        let dThetaDeg = dThetaRad * R2D * this.stepSize;

        // Null-space joint limit centering: pull toward middle of [min, max]
        const mid = (armPivots[i].min + armPivots[i].max) / 2;
        const nullBias = (mid - angles[i]) * 0.04;
        dThetaDeg += nullBias;

        angles[i] = Math.min(armPivots[i].max, Math.max(armPivots[i].min, angles[i] + dThetaDeg));
      }

      this.pose.setArmAngles(angles);
    }

    this.updateManipulability();
    return true;
  }

  // Computes Yoshikawa Manipulability w = sqrt(det(J * J^T)) and updates 3D Ellipsoid
  updateManipulability() {
    const armPivots = this.pose.armPivots;
    if (!armPivots || armPivots.length < 7) return 0;

    this.model.root.updateMatrixWorld(true);
    this.eeNode.getWorldPosition(this._pEE);

    const J = [];
    for (let i = 0; i < 7; i++) {
      const pObj = armPivots[i].obj;
      const pPos = pObj.getWorldPosition(new THREE.Vector3());
      const pAxis = new THREE.Vector3(0, armPivots[i].axis === 'y' ? 1 : 0, armPivots[i].axis === 'z' ? 1 : 0);
      pAxis.transformDirection(pObj.matrixWorld).normalize();
      J.push(pAxis.cross(this._pEE.clone().sub(pPos)));
    }

    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    for (let i = 0; i < 7; i++) {
      A[0][0] += J[i].x * J[i].x; A[0][1] += J[i].x * J[i].y; A[0][2] += J[i].x * J[i].z;
      A[1][0] += J[i].y * J[i].x; A[1][1] += J[i].y * J[i].y; A[1][2] += J[i].y * J[i].z;
      A[2][0] += J[i].z * J[i].x; A[2][1] += J[i].z * J[i].y; A[2][2] += J[i].z * J[i].z;
    }

    // Determinant of 3x3
    const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
                A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
                A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

    const w = Math.max(0, Math.sqrt(Math.max(0, det)));
    // Normalize into 0..1 scale (typical maximum is ~0.08 m^3)
    const normalizedW = Math.min(1.0, w / 0.065);

    // Update 3D Ellipsoid mesh scale and position at wrist
    if (this.ellipsoidMesh) {
      this.ellipsoidMesh.position.copy(this._pEE);
      const sx = Math.max(0.015, Math.sqrt(A[0][0]) * 0.28);
      const sy = Math.max(0.015, Math.sqrt(A[1][1]) * 0.28);
      const sz = Math.max(0.015, Math.sqrt(A[2][2]) * 0.28);
      this.ellipsoidMesh.scale.set(sx, sy, sz);

      // Color from red (near singularity) to sky blue (dexterous)
      if (this.ellipsoidMesh.material) {
        if (normalizedW < 0.25) this.ellipsoidMesh.material.color.setHex(0xef4444); // Red singularity
        else if (normalizedW < 0.55) this.ellipsoidMesh.material.color.setHex(0xf59e0b); // Amber
        else this.ellipsoidMesh.material.color.setHex(0x38bdf8); // Sky blue
      }
    }

    this.lastManipulability = normalizedW;
    return normalizedW;
  }

  _invert3x3(M) {
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
                M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
                M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    if (Math.abs(det) < 1e-7) return null;
    const invdet = 1 / det;

    return [
      [
        (M[1][1] * M[2][2] - M[1][2] * M[2][1]) * invdet,
        (M[0][2] * M[2][1] - M[0][1] * M[2][2]) * invdet,
        (M[0][1] * M[1][2] - M[0][2] * M[1][1]) * invdet,
      ],
      [
        (M[1][2] * M[2][0] - M[1][0] * M[2][2]) * invdet,
        (M[0][0] * M[2][2] - M[0][2] * M[2][0]) * invdet,
        (M[1][0] * M[0][2] - M[0][0] * M[1][2]) * invdet,
      ],
      [
        (M[1][0] * M[2][1] - M[2][0] * M[1][1]) * invdet,
        (M[2][0] * M[0][1] - M[0][0] * M[2][1]) * invdet,
        (M[0][0] * M[1][1] - M[1][0] * M[0][1]) * invdet,
      ]
    ];
  }
}
