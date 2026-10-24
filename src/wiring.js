// Wiring: static routes baked per rigid segment (in model.js via ctx.wireForNode)
// + dynamic routes rebuilt with 2-bone linear blend skinning so cables bend
// around the joints they cross instead of swinging into loops.
import * as THREE from 'three';
import { catmullPoints } from './geo.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

class DynamicWire {
  constructor(wire, model, materials) {
    this.wire = wire;
    this.radius = wire.radius;
    this.model = model;
    const coordRest = model.restWorldData.get(wire.coordNode) || new THREE.Matrix4();
    // rest world control points
    this.restPts = [];
    for (let i = 0; i < wire.points.length; i += 3) {
      _v.set(wire.points[i], wire.points[i + 1], wire.points[i + 2]).applyMatrix4(coordRest);
      this.restPts.push(_v.clone());
    }

    // ---- skin candidates: endpoint nodes + articulated pivots near the wire ----
    const fromN = model.data.byName.get(wire.from);
    const toN = model.data.byName.get(wire.to);
    const candIds = new Set();
    if (fromN) candIds.add(fromN.id);
    if (toN) candIds.add(toN.id);
    for (const j of model.data.pose.arm) candIds.add(j.pivotNode);
    for (const h of model.data.pose.hand) candIds.add(h.node);
    // wire spatial extent
    const box = new THREE.Box3();
    for (const p of this.restPts) box.expandByPoint(p);
    box.expandByScalar(0.03);
    this.cands = [];
    for (const id of candIds) {
      const M = model.restWorldData.get(id);
      if (!M) continue;
      const origin = new THREE.Vector3().setFromMatrixPosition(M);
      if (!box.containsPoint(origin) && this.cands.length > 1) {
        // keep distant pivots out, but always keep endpoint nodes
        if (id !== fromN?.id && id !== toN?.id) continue;
      }
      const live = model.liveNodes.get(id);
      this.cands.push({
        id,
        origin,
        restInv: M.clone().invert(),
        live: live || null,
        rest: M,
      });
    }
    if (!this.cands.length) {
      // static fallback: identity candidate at the coordinate node
      this.cands.push({
        id: wire.coordNode, origin: new THREE.Vector3(),
        restInv: coordRest.clone().invert(), live: null, rest: coordRest,
      });
    }
    // ---- per-point 2-bone weights (computed once from rest distances) ----
    const n = this.restPts.length;
    this.skin = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.restPts[i];
      let b1 = 0, b2 = -1, d1 = Infinity, d2 = Infinity;
      for (let c = 0; c < this.cands.length; c++) {
        const d = p.distanceTo(this.cands[c].origin);
        if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = c; }
        else if (d < d2) { d2 = d; b2 = c; }
      }
      if (b2 < 0) { this.skin[i] = [b1, b1, 1, 0]; continue; }
      const w1 = 1 / Math.pow(d1 + 0.0015, 4);
      const w2 = 1 / Math.pow(d2 + 0.0015, 4);
      const s = w1 + w2;
      this.skin[i] = [b1, b2, w1 / s, w2 / s];
    }
    this._deltas = this.cands.map(() => new THREE.Matrix4());

    this.segments = Math.min(Math.max(n * 2, 10), 36);
    this.radial = wire.ribbon ? 4 : 5;
    const vertsPerRing = this.radial + 1;
    const count = (this.segments + 1) * vertsPerRing;
    this.geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(count * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const idx = [];
    for (let i = 0; i < this.segments; i++) {
      for (let j = 0; j < this.radial; j++) {
        const a = i * vertsPerRing + j, b = a + vertsPerRing;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, materials.for(wire.role));
    this.mesh.name = 'dyn:' + wire.id;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.update();
  }

  update() {
    const n = this.restPts.length;
    if (n < 2) return;
    // per-candidate delta = current * rest^-1
    for (let c = 0; c < this.cands.length; c++) {
      const cd = this.cands[c];
      const M = cd.live ? cd.live.matrixWorld : cd.rest;
      this._deltas[c].copy(M).multiply(cd.restInv);
    }
    const pts = this._deformed || (this._deformed = this.restPts.map(() => new THREE.Vector3()));
    for (let i = 0; i < n; i++) {
      const [b1, b2, w1, w2] = this.skin[i];
      const p = this.restPts[i];
      _v.copy(p).applyMatrix4(this._deltas[b1]);
      if (w2 > 0) {
        _v2.copy(p).applyMatrix4(this._deltas[b2]);
        _v.multiplyScalar(w1).addScaledVector(_v2, w2);
      }
      pts[i].copy(_v);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    this._writeTube(curve);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }

  _writeTube(curve) {
    const seg = this.segments, radial = this.radial, r = this.radius;
    const pos = this.posArr;
    const frames = curve.computeFrenetFrames(seg, false);
    const vertsPerRing = radial + 1;
    let o = 0;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const p = curve.getPointAt(u);
      const N = frames.normals[Math.min(i, seg)];
      const B = frames.binormals[Math.min(i, seg)];
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const sin = Math.sin(a), cos = -Math.cos(a);
        pos[o++] = p.x + r * (cos * N.x + sin * B.x);
        pos[o++] = p.y + r * (cos * N.y + sin * B.y);
        pos[o++] = p.z + r * (cos * N.z + sin * B.z);
      }
    }
  }
}

export class Wiring {
  constructor(model, materials, scene) {
    this.model = model;
    this.materials = materials;
    this.group = new THREE.Group();
    this.group.name = 'dynamic-wiring';
    scene.add(this.group);
    this.wires = [];
    this.density = 1;
    this.build(1);
  }

  build(density) {
    this.density = density;
    for (const w of this.wires) { this.group.remove(w.mesh); w.geo.dispose(); }
    this.wires = [];
    const dyn = this.model.data.wires.filter(w => w.dynamic);
    const keep = selectDensity(dyn, density);
    for (const w of keep) this.wires.push(new DynamicWire(w, this.model, this.materials));
    for (const w of this.wires) this.group.add(w.mesh);
    this.count = keep.length;
  }

  // rebuild tubes after pose changes (single pass, no re-allocation)
  update() {
    for (const w of this.wires) w.update();
  }

  setVisibleByPrefix(fn) {
    for (const w of this.wires) w.mesh.visible = fn(w.wire.id);
  }
}

// deterministic density subsampling, stable across rebuilds
export function selectDensity(list, density) {
  if (density >= 0.999) return list;
  const keep = [];
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const h = (i * 2654435761) % 1000 / 1000;
    if (h < density) keep.push(list[i]);
  }
  return keep;
}
