// Model build: live articulated node chain + per-segment merged geometry,
// rest-pose world matrices, straightened-gradient attribute, part registry.
import * as THREE from 'three';
import { buildNodeGeometry } from './geo.js';

const D2R = Math.PI / 180;

// palmar cover layer removed per user request (see review/palm-shell-fix-result.md)
const PALMAR_COVER_EXCLUDED = new Set([
  'hand/palmar-shell',   // id 3380
  'hand/thenar',         // id 3381
  'hand/hypothenar',     // id 3382
  'hand/distal-pad',     // id 3383
  'hand/palm-flex-seam', // id 3384
]);

export class Model {
  constructor(data, materials, opts = {}) {
    this.data = data;
    this.materials = materials;
    this.density = opts.density ?? 1;
    this.root = new THREE.Group();
    this.root.name = 'FORM_01';
    this.liveNodes = new Map();     // nodeId -> Object3D (articulated chain + anchors)
    this.nodeByName = new Map();
    this.restWorld = new Map();     // nodeId -> Matrix4 at reference pose
    this.buckets = [];              // merged rigid segments
    this.parts = [];                // pickable part registry
    this.pivots = { arm: [], hand: [] };
    this.landmarkNodes = {};
    this._build();
  }

  _build() {
    const { data, density } = this;
    const pivotIds = new Set();
    const pivotMeta = new Map();
    for (const j of data.pose.arm) {
      pivotIds.add(j.pivotNode);
      pivotMeta.set(j.pivotNode, { kind: 'arm', id: j.id, refAngle: j.angle });
    }
    for (const h of data.pose.hand) {
      pivotIds.add(h.node);
      pivotMeta.set(h.node, { kind: 'hand', id: h.id, axis: h.axis, refAngle: h.angle });
    }

    // articulated path = pivots + all their ancestors
    const onPath = new Set();
    for (const pid of pivotIds) {
      let n = data.byId.get(pid);
      while (n) { onPath.add(n.id); n = n.parent !== null ? data.byId.get(n.parent) : null; }
    }
    // dynamic-wire endpoint anchors must stay live too
    for (const w of data.wires) {
      if (!w.dynamic) continue;
      for (const nm of [w.from, w.to]) {
        const n = data.byName.get(nm);
        if (n) { let c = n; while (c && !onPath.has(c.id)) { onPath.add(c.id); c = c.parent !== null ? data.byId.get(c.parent) : null; } }
      }
    }

    const ctx = {
      density,
      wireForNode: this._wireIndex(data),
      onStaticWire: (n) => { this.staticWireCount = (this.staticWireCount || 0) + n; },
    };

    // recursive build: live chain nodes + merged buckets for off-path content
    const buildNode = (node, parentObj, bucket) => {
      // user-requested removal: the palmar cover layer clips through the palm
      // (protruding translucent panels). Excluded everywhere — normal view,
      // detached exploded layout, GLB export.
      if (PALMAR_COVER_EXCLUDED.has(node.name)) return parentObj;
      // the precision stylus is a holdable prop, hidden by default (not part of reference frames)
      if (node.name === 'tool/precision-stylus') {
        const g = new THREE.Group();
        g.name = node.name;
        g.visible = false;
        g.userData.nodeId = node.id;
        g.position.set(...node.p);
        g.quaternion.set(...node.q);
        g.scale.set(...node.s);
        parentObj.add(g);
        const bkt = this._newBucket(g, node.name);
        for (const c of node.children) {
          if (c.mesh) this._mergePart(c, bkt, ctx);
        }
        this.stylus = g;
        return g;
      }
      const live = onPath.has(node.id);
      let obj = parentObj;
      let bkt = bucket;
      if (live) {
        obj = new THREE.Group();
        obj.name = node.name;
        obj.userData.nodeId = node.id;
        obj.position.set(...node.p);
        obj.quaternion.set(...node.q);
        obj.scale.set(...node.s);
        parentObj.add(obj);
        this.liveNodes.set(node.id, obj);
        this.nodeByName.set(node.name, obj);
        if (pivotMeta.has(node.id)) {
          const meta = pivotMeta.get(node.id);
          obj.userData.pivot = meta;
          this.pivots[meta.kind].push(obj);
        }
        bkt = this._newBucket(obj, node.name);
      } else if (node.mesh) {
        this._mergePart(node, bkt, ctx);
      }
      for (const c of node.children) buildNode(c, obj, bkt);
      return obj;
    };

    const rootBucket = this._newBucket(this.root, 'root');
    for (const c of data.root.children) {
      if (c.mesh && c.geo === 3) continue; // root-level tubes are dynamic wires, built by Wiring
      buildNode(c, this.root, rootBucket);
    }
    this._finalizeBuckets(ctx);
    this._computeRestWorld();
    this._setupLandmarks();
    this._bakeGradient();
  }

  _wireIndex(data) {
    const byCoord = new Map();
    for (const w of data.wires) {
      if (w.dynamic) continue;
      if (!byCoord.has(w.coordNode)) byCoord.set(w.coordNode, []);
      byCoord.get(w.coordNode).push(w);
    }
    return (id) => byCoord.get(id);
  }

  _newBucket(ownerObj, name) {
    const b = { owner: ownerObj, name, geoms: new Map(), parts: [], meshes: [] };
    this.buckets.push(b);
    return b;
  }

  _mergePart(node, bucket, ctx) {
    // skip building stylus by default? keep it; hidden later via name
    let geo;
    try {
      geo = buildNodeGeometry(node, ctx);
    } catch (e) {
      console.warn('geo fail', node.name, e);
      return;
    }
    // transform part geometry into bucket-owner local frame (rest pose)
    const m = this._relMatrix(node, bucket.owner.userData.nodeId ?? 0);
    geo.applyMatrix4(m);
    if (!bucket.geoms.has(node.role)) bucket.geoms.set(node.role, []);
    bucket.geoms.get(node.role).push(geo);
    // record part for picking (bounds in bucket frame)
    geo.computeBoundingBox();
    bucket.parts.push({
      nodeId: node.id, name: node.name, role: node.role, owner: node.owner, layer: node.layer,
      bounds: geo.boundingBox.clone(), vertStart: 0,
      vertCount: geo.index ? geo.index.count : geo.attributes.position.count,
    });
  }

  _relMatrix(node, ancestorId) {
    // node local-chain product up to (but excluding) ancestor with ancestorId
    const chain = [];
    let n = node;
    while (n && n.id !== ancestorId) { chain.push(n); n = n.parent !== null ? this.data.byId.get(n.parent) : null; }
    const m = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      tmp.compose(new THREE.Vector3(...c.p), new THREE.Quaternion(...c.q), new THREE.Vector3(...c.s));
      m.multiply(tmp);
    }
    return m;
  }

  _finalizeBuckets(ctx) {
    for (const b of this.buckets) {
      for (const [role, geos] of b.geoms) {
        if (!geos.length) continue;
        const merged = mergeBucketGeos(geos);
        const mat = this.materials.for(role);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = b.name + '::' + role;
        mesh.castShadow = role !== 'clear-shell';
        mesh.receiveShadow = true;
        mesh.userData.bucket = b;
        mesh.userData.role = role;
        b.meshes.push(mesh);
        b.owner.add(mesh);
        // vertex ranges per part, in merge order (merge order == parts push order per role)
        let v = 0;
        const roleParts = b.parts.filter(p => p.role === role);
        for (const p of roleParts) { p.vertStart = v; v += p.vertCount; }
        mesh.userData.parts = roleParts;
      }
    }
  }

  _computeRestWorld() {
    this.root.updateMatrixWorld(true);
    for (const [id, obj] of this.liveNodes) {
      this.restWorld.set(id, obj.matrixWorld.clone());
    }
    // rest world for every data node (wire routing + landmark fallback)
    this.restWorldData = new Map();
    const world = new Map();
    const walk = (n, m) => {
      const tmp = new THREE.Matrix4().compose(
        new THREE.Vector3(...n.p), new THREE.Quaternion(...n.q), new THREE.Vector3(...n.s));
      const w = m.clone().multiply(tmp);
      world.set(n.id, w);
      for (const c of n.children) walk(c, w);
    };
    walk(this.data.root, new THREE.Matrix4());
    this.restWorldData = world;
  }

  _setupLandmarks() {
    const byName = this.data.byName;
    const lm = {};
    for (let j = 1; j <= 7; j++) lm['J' + j] = byName.get(`J${j}/mount`).id;
    lm['hand/wrist'] = byName.get('hand').id;
    for (const f of ['index', 'middle', 'ring', 'little', 'thumb']) {
      for (let k = 0; k < 3; k++) lm[`hand/${f}/joint-${k}`] = byName.get(`hand/${f}/joint-${k}`).id;
      lm[`hand/${f}/flexion-2`] = byName.get(`hand/${f}/flexion-2`).id;
    }
    this.landmarkNodes = lm;
    // finger segment data for tips (original, pre-scale lengths)
    this.tipLocal = {
      index: [0, 0.019 / 0.87 - 0.002, 0.0007],
      middle: [0, 0.020 / 0.90 - 0.002, 0.0007],
      ring: [0, 0.019 / 0.84 - 0.002, 0.0007],
      little: [0, 0.016 / 0.73 - 0.002, 0.0007],
      thumb: [0, 0.021 / 0.96 - 0.002, 0.0007],
    };
  }

  _bakeGradient() {
    // straightened world Y per vertex: zero all pivots, transform, smoothstep(0.04..1.1)
    const saved = [];
    for (const kind of ['arm', 'hand']) {
      for (const obj of this.pivots[kind]) {
        saved.push([obj, obj.quaternion.clone()]);
        obj.quaternion.identity();
      }
    }
    this.root.updateMatrixWorld(true);
    const straight = new Map();
    for (const [id, obj] of this.liveNodes) straight.set(id, obj.matrixWorld.clone());
    for (const [obj, q] of saved) obj.quaternion.copy(q);
    this.root.updateMatrixWorld(true);

    const v = new THREE.Vector3();
    for (const b of this.buckets) {
      const ownerId = b.owner.userData?.nodeId;
      const M = straight.get(ownerId);
      for (const mesh of b.meshes) {
        const pos = mesh.geometry.attributes.position;
        const t = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          if (M) v.applyMatrix4(M);
          let u = (v.y - 0.04) / (1.1 - 0.04);
          u = Math.min(1, Math.max(0, u));
          t[i] = u * u * (3 - 2 * u);
        }
        mesh.geometry.setAttribute('gradT', new THREE.BufferAttribute(t, 1));
      }
    }
    this.straightWorld = straight;
  }

  getLandmarks() {
    this.root.updateMatrixWorld(true);
    const out = [];
    const v = new THREE.Vector3();
    for (let j = 1; j <= 7; j++) {
      const obj = this.liveNodes.get(this.landmarkNodes['J' + j]);
      obj.getWorldPosition(v);
      out.push({ name: 'J' + j, world_m: [v.x, v.y, v.z] });
    }
    const wrist = this.liveNodes.get(this.landmarkNodes['hand/wrist']);
    wrist.getWorldPosition(v);
    out.push({ name: 'hand/wrist', world_m: [v.x, v.y, v.z] });
    for (const f of ['index', 'middle', 'ring', 'little', 'thumb']) {
      for (let k = 0; k < 3; k++) {
        const o = this.liveNodes.get(this.landmarkNodes[`hand/${f}/joint-${k}`]);
        o.getWorldPosition(v);
        out.push({ name: `hand/${f}/joint-${k}`, world_m: [v.x, v.y, v.z] });
      }
      const fl = this.liveNodes.get(this.landmarkNodes[`hand/${f}/flexion-2`]);
      const lp = this.tipLocal[f];
      v.set(lp[0], lp[1], lp[2]).applyMatrix4(fl.matrixWorld);
      out.push({ name: `hand/${f}/tip`, world_m: [v.x, v.y, v.z] });
    }
    return out;
  }

  setDensityNotice() { /* placeholder for rebuild notices */ }
}

function mergeBucketGeos(geos) {
  // concatenate as non-indexed, then weld duplicate vertices into indexed geometry
  let total = 0;
  const list = geos.map(g => (g.index ? g.toNonIndexed() : g));
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const map = new Map();
  const idx = new Uint32Array(total);
  const p2 = [], n2 = [], u2 = [];
  let out = 0;
  for (let i = 0; i < total; i++) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const key = ((px * 2e5) | 0) + '_' + ((py * 2e5) | 0) + '_' + ((pz * 2e5) | 0) + '_'
      + ((nor[i * 3] * 400) | 0) + '_' + ((nor[i * 3 + 1] * 400) | 0) + '_' + ((nor[i * 3 + 2] * 400) | 0);
    let j = map.get(key);
    if (j === undefined) {
      j = out++;
      map.set(key, j);
      p2.push(px, py, pz);
      n2.push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
      u2.push(uv[i * 2], uv[i * 2 + 1]);
    }
    idx[i] = j;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p2), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n2), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(u2), 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}
