// Exploded / flat-lay detached layout for the FORM·01 (KIMI rebuild) model.
//
// Extracts real per-part geometry ranges from the merged per-role bucket
// meshes (mesh.userData.parts: {nodeId,name,role,owner,layer,bounds,
// vertStart,vertCount}) and rebuilds every part as an independent,
// pickable mesh inside a detached root group. Supports a reversible
// axial/radial exploded layout and a non-overlapping 2D flat-lay board,
// 'all' or per-module scope, click metadata, exact progress-0 entry
// placement, and full dispose. No animation loop: setProgress() is a pure
// function of its arguments and is meant to be driven by the core each
// frame. Materials are always shared with the source model (never
// cloned, never disposed here); only sliced geometry clones are owned.
import * as THREE from 'three';
import { packContourBoard } from './contour-board.js';

// Rotation axis (pivot-local) of each arm joint of the current KIMI model.
const JOINT_LOCAL_AXIS = { J1: 'y', J2: 'z', J3: 'y', J4: 'z', J5: 'y', J6: 'z', J7: 'y' };
const FINGERS = ['index', 'middle', 'ring', 'little', 'thumb'];
const GROUP_ORDER = [
  'base', 'J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7',
  'upper-arm', 'forearm',
  'hand-palm', 'hand-controller',
  'hand-index', 'hand-middle', 'hand-ring', 'hand-little', 'hand-thumb',
  'tool',
];
const LAYOUTS = ['exploded', 'flat'];
const EPS = 1e-9;

function moduleOf(groupId) {
  return groupId.startsWith('hand-') ? 'hand' : groupId;
}

function groupLabel(id) {
  if (id === 'base') return 'Base';
  if (/^J[1-7]$/.test(id)) return `${id} joint module`;
  if (id === 'upper-arm') return 'Upper arm';
  if (id === 'forearm') return 'Forearm';
  if (id === 'hand-palm') return 'Hand · palm';
  if (id === 'hand-controller') return 'Hand · controller';
  if (id.startsWith('hand-')) return `Hand · ${id.slice(5)} finger`;
  if (id === 'tool') return 'Precision stylus (hidden prop)';
  return id;
}

// Map a bucket name (model.buckets[i].name) to a layout group id.
function groupIdForBucket(name) {
  if (!name) return 'misc';
  if (name === 'base' || name.startsWith('base/')) return 'base';
  const j = /^J([1-7])(\/|$)/.exec(name);
  if (j) return 'J' + j[1];
  if (name === 'upper-arm' || name.startsWith('upper-arm/')) return 'upper-arm';
  if (name === 'forearm' || name.startsWith('forearm/')) return 'forearm';
  if (name === 'hand') return 'hand-palm';
  if (name.startsWith('hand/controller')) return 'hand-controller';
  const f = /^hand\/(index|middle|ring|little|thumb)(\/|$)/.exec(name);
  if (f) return 'hand-' + f[1];
  if (name.startsWith('hand/')) return 'hand-palm';
  if (name === 'tool' || name.startsWith('tool/')) return 'tool';
  if (name === 'root') return 'root';
  return name.split('/')[0];
}

function vec3(a) { return new THREE.Vector3(a[0], a[1], a[2]); }

export class ExplodedLayout {
  constructor({ model } = {}) {
    if (!model || !model.root) throw new Error('ExplodedLayout: { model } with model.root is required');
    this.model = model;
    this.root = new THREE.Group();
    this.root.name = 'exploded-layout';
    this.root.visible = false; // core adds it and flips visibility

    this.layout = 'exploded';
    this.scope = 'all';
    this.progress = 0;

    this.parts = [];              // part records in stable extraction order
    this.groups = new Map();      // group id -> group record
    this.byMesh = new Map();      // THREE.Mesh -> part record (picking)
    this.omittedFromExtraction = [];
    this.coverage = null;
    this.flatInfo = null;

    this._activeGroups = new Set();
    this._geoCache = new Map();   // source mesh.uuid -> { geometry, signature, slices:[{geometry,center,box}] }
    this._captured = false;
    this._boundsCache = { key: null, box: null };
  }

  // ---------------------------------------------------------------- capture
  // Snapshots current model transforms and derives detached geometries +
  // entry world transforms. Never mutates/hides/reparents the model.
  // Reuses previously sliced geometry when the source mesh is unchanged.
  capture() {
    const model = this.model;
    model.root.updateMatrixWorld(true);

    this._teardownParts();        // keep _geoCache for reuse
    this.omittedFromExtraction = [];

    const landmarks = this._safeLandmarks();
    const coverage = {
      meshesTotal: 0, meshesWithParts: 0, meshesFallbackSinglePart: 0,
      sourceVerts: 0, coveredVerts: 0, duplicateRanges: 0, rangeErrors: 0,
      partsWithoutRanges: 0,
    };
    const bucketMeshes = new Set();

    let partIndex = 0;
    for (const bucket of model.buckets || []) {
      const groupId = groupIdForBucket(bucket.name);
      for (const mesh of bucket.meshes || []) {
        if (!mesh || !mesh.geometry) continue;
        bucketMeshes.add(mesh);
        coverage.meshesTotal++;
        const srcParts = Array.isArray(mesh.userData.parts) ? mesh.userData.parts : [];
        const slices = this._slicesForMesh(mesh, srcParts, coverage);
        if (!slices.length) continue;
        coverage.meshesWithParts++;
        const group = this._group(groupId, bucket.name);
        for (let i = 0; i < slices.length; i++) {
          const sl = slices[i];
          const rec = this._makePart(mesh, bucket, group, sl, partIndex++);
          group.parts.push(rec);
          this.parts.push(rec);
          this.byMesh.set(rec.mesh, rec);
          group.group3d.add(rec.mesh);
        }
      }
    }

    // Anything mesh-like under the model root that buckets do not own is
    // reported, never silently dropped (dynamic wires live outside buckets).
    const seen = new Set(this.parts.map(p => p.sourceMesh));
    model.root.traverse(o => {
      if (o.isMesh && !seen.has(o) && !bucketMeshes.has(o)) {
        this.omittedFromExtraction.push({
          kind: 'unbucketed-mesh', name: o.name || '(unnamed)',
          parent: o.parent ? o.parent.name : null, visible: o.visible,
        });
      }
    });
    this._reportDynamicWires();

    // Group order + layout derivation.
    this._orderGroups();
    this._deriveExploded(landmarks);
    this._deriveFlat();
    this._refreshMeta();

    this.coverage = coverage;
    this._captured = true;
    this._activeGroups = new Set(this.groups.keys());
    this.setScope(this.scope, { keepProgress: true });
    this.setProgress(this.progress, { layout: this.layout });
    return this.getStats();
  }

  _safeLandmarks() {
    const map = new Map();
    try {
      if (typeof this.model.getLandmarks === 'function') {
        for (const lm of this.model.getLandmarks()) map.set(lm.name, vec3(lm.world_m));
      }
    } catch (e) { /* landmarks are an axis-quality hint only */ }
    return map;
  }

  _reportDynamicWires() {
    const wires = this.model.data && Array.isArray(this.model.data.wires) ? this.model.data.wires : [];
    const dyn = wires.filter(w => w && w.dynamic);
    if (dyn.length) {
      this.omittedFromExtraction.push({
        kind: 'dynamic-wire-groups',
        count: dyn.length,
        note: 'Dynamic skinned wire tubes are rebuilt by the core Wiring module outside model.buckets; core must snapshot/hide them separately. Identifiers preserved.',
        identifiers: dyn.map(w => `${w.from || '?'} -> ${w.to || '?'}`),
      });
    }
  }

  _group(id, bucketName) {
    let g = this.groups.get(id);
    if (!g) {
      g = {
        id, label: groupLabel(id), module: moduleOf(id),
        parts: [], buckets: new Set(),
        group3d: new THREE.Group(),
        axis: null, center: null,
        exploded: null, flat: null,
      };
      g.group3d.name = 'exploded-layout/' + id;
      g.group3d.userData.groupId = id;
      g.group3d.userData.label = g.label;
      this.groups.set(id, g);
      this.root.add(g.group3d);
    }
    if (bucketName) g.buckets.add(bucketName);
    return g;
  }

  _orderGroups() {
    const known = new Map(GROUP_ORDER.map((id, i) => [id, i]));
    const sorted = [...this.groups.values()].sort((a, b) => {
      const ia = known.has(a.id) ? known.get(a.id) : GROUP_ORDER.length + a.id.localeCompare(b.id) * 0.01;
      const ib = known.has(b.id) ? known.get(b.id) : GROUP_ORDER.length + b.id.localeCompare(a.id) * 0.01;
      return ia - ib;
    });
    for (const g of sorted) {
      this.root.remove(g.group3d);
      this.root.add(g.group3d);
    }
    this._groupOrder = sorted.map(g => g.id);
  }

  // ---------------------------------------------------- geometry extraction
  // Slices one part vertex range out of a merged role mesh. Handles both
  // indexed and non-indexed merged geometry; output is always a centered,
  // non-indexed clone carrying every source attribute (position/normal/
  // uv/gradT/color...). Material stays shared with the source mesh.
  _slicesForMesh(mesh, srcParts, coverage) {
    const geo = mesh.geometry;
    const posCount = geo.attributes.position ? geo.attributes.position.count : 0;
    const rangeCount = geo.index ? geo.index.count : posCount;
    coverage.sourceVerts += posCount;

    let list = srcParts;
    if (!list.length) {
      // no registry on this mesh: keep the whole mesh as a single part
      list = [{
        nodeId: mesh.userData.bucket?.owner?.userData?.nodeId ?? null,
        name: mesh.name, role: mesh.userData.role || null,
        owner: null, layer: null, vertStart: 0, vertCount: rangeCount,
      }];
      coverage.meshesFallbackSinglePart++;
      coverage.partsWithoutRanges++;
    }

    // coverage / duplicate audit within this mesh
    const sorted = list.map(p => [p.vertStart | 0, (p.vertStart | 0) + (p.vertCount | 0)]).sort((a, b) => a[0] - b[0]);
    let covered = 0, cursor = -1;
    for (const [s, e] of sorted) {
      if (s < cursor) coverage.duplicateRanges++;
      if (s < 0 || e > rangeCount || e <= s) coverage.rangeErrors++;
      covered += Math.max(0, e - Math.max(s, cursor));
      cursor = Math.max(cursor, e);
    }
    coverage.coveredVerts += Math.min(covered, posCount);

    const signature = list.map(p => `${p.vertStart}:${p.vertCount}`).join(',');
    const cached = this._geoCache.get(mesh.uuid);
    if (cached && cached.geometry === geo && cached.signature === signature) {
      return cached.slices.map(sl => ({ meta: sl.meta, geometry: sl.geometry, center: sl.center, box: sl.box }));
    }

    const slices = [];
    for (const p of list) {
      const sl = this._extractSlice(geo, p);
      if (!sl) continue;
      slices.push(sl);
    }
    this._geoCache.set(mesh.uuid, { geometry: geo, signature, slices });
    return slices.map(sl => ({ meta: sl.meta, geometry: sl.geometry, center: sl.center, box: sl.box }));
  }

  _extractSlice(geo, p) {
    const start = p.vertStart | 0;
    const count = p.vertCount | 0;
    if (count <= 0) return null;
    const out = new THREE.BufferGeometry();
    const index = geo.index;
    for (const [name, attr] of Object.entries(geo.attributes)) {
      const itemSize = attr.itemSize;
      let arr;
      if (index) {
        const ArrayT = attr.array.constructor;
        arr = new ArrayT(count * itemSize);
        for (let i = 0; i < count; i++) {
          const src = index.getX(start + i);
          for (let k = 0; k < itemSize; k++) arr[i * itemSize + k] = attr.array[src * itemSize + k];
        }
      } else {
        arr = attr.array.slice(start * itemSize, (start + count) * itemSize);
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
    }
    // center locally: geometry recenters on its own bbox center; the entry
    // transform compensates so progress 0 matches the source exactly.
    out.computeBoundingBox();
    const box = out.boundingBox;
    if (!box || box.isEmpty()) { out.dispose(); return null; }
    const center = box.getCenter(new THREE.Vector3());
    out.translate(-center.x, -center.y, -center.z);
    out.computeBoundingBox();
    return {
      geometry: out, center, box: out.boundingBox.clone(),
      meta: {
        nodeId: p.nodeId ?? null, name: p.name || '(unnamed part)',
        role: p.role ?? null, owner: p.owner ?? null, layer: p.layer ?? null,
        vertStart: start, vertCount: count,
      },
    };
  }

  _makePart(sourceMesh, bucket, group, slice, index) {
    const id = 'p' + String(index).padStart(4, '0');
    const mesh = new THREE.Mesh(slice.geometry, sourceMesh.material);
    mesh.name = slice.meta.name;
    mesh.castShadow = sourceMesh.castShadow;
    mesh.receiveShadow = sourceMesh.receiveShadow;
    // effective visibility: a hidden ancestor group (e.g. the precision
    // stylus prop) hides the part even when the merged mesh flag is true.
    // model.root.visible is deliberately ignored: it is the core's display
    // toggle while the detached view is active, not model state.
    let vis = sourceMesh.visible;
    for (let o = sourceMesh.parent; o && o !== this.model.root; o = o.parent) {
      if (o.visible === false) { vis = false; break; }
    }
    mesh.visible = vis;

    // entry world transform = source world * translation(slice center)
    const entryMatrix = sourceMesh.matrixWorld.clone()
      .multiply(new THREE.Matrix4().makeTranslation(slice.center.x, slice.center.y, slice.center.z));
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
    entryMatrix.decompose(pos, quat, scale);

    const rec = {
      id, index,
      nodeId: slice.meta.nodeId, name: slice.meta.name,
      role: slice.meta.role, owner: slice.meta.owner, layer: slice.meta.layer,
      vertStart: slice.meta.vertStart, vertCount: slice.meta.vertCount,
      verts: slice.geometry.attributes.position.count,
      groupId: group.id, module: group.module,
      bucket: bucket.name,
      sourceMesh: sourceMesh, sourceMeshName: sourceMesh.name,
      harness: /harness|\/(in|out)-\d/.test(bucket.name),
      mesh,
      entry: { position: pos, quaternion: quat, scale },
      localBox: slice.box, // centered box in part-local frame
      targets: { exploded: null, flat: null },
      cell: null,
    };
    mesh.userData.partId = id;
    mesh.userData.explodedLayout = this._publicMeta(rec);
    return rec;
  }

  // Re-stamps pick metadata once layout targets exist (targets/cell are
  // derived after the part records are created).
  _refreshMeta() {
    for (const rec of this.parts) rec.mesh.userData.explodedLayout = this._publicMeta(rec);
  }

  _publicMeta(rec) {
    const t = {};
    for (const k of LAYOUTS) {
      const tg = rec.targets[k];
      t[k] = tg ? {
        position: tg.position.toArray(), quaternion: tg.quaternion.toArray(), scale: tg.scale.toArray(),
      } : null;
    }
    return {
      partId: rec.id, nodeId: rec.nodeId, name: rec.name,
      role: rec.role, owner: rec.owner, layer: rec.layer,
      groupId: rec.groupId, module: rec.module, groupLabel: groupLabel(rec.groupId),
      bucket: rec.bucket, sourceMesh: rec.sourceMeshName, harness: rec.harness,
      vertStart: rec.vertStart, vertCount: rec.vertCount, verts: rec.verts,
      entry: {
        position: rec.entry.position.toArray(), quaternion: rec.entry.quaternion.toArray(),
        scale: rec.entry.scale.toArray(),
      },
      targets: t, cell: rec.cell,
    };
  }

  // ------------------------------------------------------- exploded layout
  _deriveExploded(landmarks) {
    const groups = [...this.groups.values()].filter(g => g.parts.length);
    // per-group semantic axis + center
    for (const g of groups) {
      g.center = this._groupCenter(g);
      g.axis = this._groupAxis(g, landmarks);
    }
    // axial layer packing + radial gain, offsets relative to group center
    for (const g of groups) this._explodeGroup(g);
    // inter-module anti-pileup: translate overlapping group spheres apart
    this._separateGroups(groups);
    for (const g of groups) {
      for (const rec of g.parts) {
        rec.targets.exploded = {
          position: rec._expPos.clone(),
          quaternion: rec.entry.quaternion.clone(), // exploded keeps rest orientation
          scale: rec.entry.scale.clone(),
        };
      }
    }
  }

  _groupCenter(g) {
    const c = new THREE.Vector3();
    for (const rec of g.parts) c.add(rec.entry.position);
    return c.multiplyScalar(1 / g.parts.length);
  }

  _groupAxis(g, landmarks) {
    const axis = new THREE.Vector3();
    const lm = (n) => landmarks.get(n);
    if (/^J[1-7]$/.test(g.id)) {
      // world direction of the joint rotation axis (pivot-local y/z table)
      const jointIdx = this.model.data?.pose?.arm?.findIndex(j => j.id === g.id) ?? -1;
      const pivotNode = jointIdx >= 0 ? this.model.data.pose.arm[jointIdx].pivotNode : null;
      const obj = pivotNode != null && this.model.liveNodes ? this.model.liveNodes.get(pivotNode) : null;
      const local = JOINT_LOCAL_AXIS[g.id];
      if (obj && local) {
        const q = obj.getWorldQuaternion(new THREE.Quaternion());
        axis.set(local === 'x' ? 1 : 0, local === 'y' ? 1 : 0, local === 'z' ? 1 : 0).applyQuaternion(q);
        if (axis.lengthSq() > 0.5) return axis.normalize();
      }
    }
    if (g.id === 'base' || g.id === 'tool') return axis.set(0, 1, 0);
    if (g.id === 'upper-arm' && lm('J3') && lm('J4')) return lm('J4').clone().sub(lm('J3')).normalize();
    if (g.id === 'forearm' && lm('J5') && lm('J6')) return lm('J6').clone().sub(lm('J5')).normalize();
    if ((g.id === 'hand-palm' || g.id === 'hand-controller') && lm('J7') && lm('hand/wrist')) {
      return lm('hand/wrist').clone().sub(lm('J7')).normalize();
    }
    if (g.id.startsWith('hand-')) {
      const f = g.id.slice(5);
      if (FINGERS.includes(f) && lm(`hand/${f}/joint-0`) && lm(`hand/${f}/joint-2`)) {
        return lm(`hand/${f}/joint-2`).clone().sub(lm(`hand/${f}/joint-0`)).normalize();
      }
      if (lm('J7') && lm('hand/wrist')) return lm('hand/wrist').clone().sub(lm('J7')).normalize();
    }
    // generic fallback: largest-variance axis of part centers (PCA-light)
    return this._pcaAxis(g);
  }

  _pcaAxis(g) {
    const c = g.center;
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    const d = new THREE.Vector3();
    for (const rec of g.parts) {
      d.subVectors(rec.entry.position, c);
      xx += d.x * d.x; xy += d.x * d.y; xz += d.x * d.z;
      yy += d.y * d.y; yz += d.y * d.z; zz += d.z * d.z;
    }
    // power iteration on the covariance matrix
    const v = new THREE.Vector3(1, 0.37, 0.73).normalize();
    const m = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
    for (let it = 0; it < 24; it++) {
      const nv = new THREE.Vector3(
        m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
        m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
        m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z);
      if (nv.lengthSq() < EPS) break;
      nv.normalize();
      if (nv.dot(v) < 0) nv.negate();
      v.copy(nv);
    }
    if (v.lengthSq() < EPS || !isFinite(v.x)) v.set(0, 1, 0);
    return v.normalize();
  }

  // Axial "shaft" packing: parts sharing an axial layer keep the layer slot,
  // layers separate along the group axis with a guaranteed gap; off-axis
  // parts additionally gain radial distance. Deterministic in capture order.
  _explodeGroup(g) {
    const A = g.axis, C = g.center;
    const items = g.parts.map(rec => {
      const d = rec.entry.position.clone().sub(C);
      const t = d.dot(A);
      const r = d.clone().addScaledVector(A, -t);
      // world-space half-extent of the part along A (conservative via local box)
      const size = rec.localBox.getSize(new THREE.Vector3()).multiply(rec.entry.scale);
      const halfLen = 0.5 * (Math.abs(size.x * A.x) + Math.abs(size.y * A.y) + Math.abs(size.z * A.z));
      const radius = Math.max(size.x, size.y, size.z) * 0.5;
      return { rec, t, r, halfLen, radius };
    });
    items.sort((a, b) => (a.t - b.t) || (a.rec.index - b.rec.index));

    const halfLens = items.map(i => i.halfLen).sort((a, b) => a - b);
    const medianHalf = halfLens[Math.floor(halfLens.length / 2)] || 0.01;
    const layerTol = Math.max(0.0015, medianHalf * 0.9);
    const gap = THREE.MathUtils.clamp(medianHalf * 1.0, 0.003, 0.02);

    // cluster into axial layers
    const layers = [];
    for (const it of items) {
      const last = layers[layers.length - 1];
      if (last && it.t - last.maxT <= layerTol) {
        last.items.push(it);
        last.maxT = Math.max(last.maxT, it.t);
        last.half = Math.max(last.half, it.halfLen);
      } else {
        layers.push({ items: [it], maxT: it.t, half: it.halfLen });
      }
    }
    // pack layers along the axis, centered on the original mean projection
    let total = 0;
    for (const L of layers) total += L.half * 2;
    total += gap * (layers.length - 1);
    const meanT = items.reduce((a, i) => a + i.t, 0) / items.length;
    let cursor = meanT - total / 2;
    for (const L of layers) {
      cursor += L.half;
      L.slot = cursor;
      cursor += L.half + gap;
    }
    // radial gain: shells/covers sitting off-axis move further out
    const radialGain = 1.7;
    for (const L of layers) {
      for (const it of L.items) {
        it.rec._expPos = C.clone()
          .addScaledVector(A, L.slot)
          .add(it.r.clone().multiplyScalar(radialGain));
        it.rec._expRadius = it.radius;
      }
    }
    g.exploded = { gap, layerCount: layers.length, radialGain };
  }

  // Inter-module anti-pileup for the exploded layout: instead of shrinking
  // each group's explosion (which would collapse it back into an assembled
  // look), overlapping group spheres are translated apart along their
  // center line — the internal explosion shape is preserved. Deterministic
  // fixed-order passes; the smaller group yields.
  _separateGroups(groups) {
    const info = groups.map(g => {
      let radius = 0;
      for (const rec of g.parts) {
        radius = Math.max(radius, rec._expPos.distanceTo(g.center) + rec._expRadius);
      }
      return { g, radius, shift: new THREE.Vector3() };
    });
    const d = new THREE.Vector3();
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let i = 0; i < info.length; i++) {
        for (let j = i + 1; j < info.length; j++) {
          const a = info[i], b = info[j];
          if (a.radius + b.radius < 1e-6) continue;
          d.copy(b.g.center).add(b.shift).sub(a.g.center).sub(a.shift);
          let dist = d.length();
          const overlap = a.radius + b.radius - dist;
          if (overlap <= 1e-6) continue;
          if (dist < 1e-6) { d.set(0, 1, 0); dist = 1; }
          d.multiplyScalar(1 / dist);
          const target = a.radius <= b.radius ? a : b;
          target.shift.addScaledVector(d, (target === a ? -1 : 1) * overlap * 0.6);
          moved = true;
        }
      }
      if (!moved) break;
    }
    let residual = 0;
    for (const { g, shift } of info) {
      g._explodeShift = shift.clone();
      if (shift.lengthSq() > 0) for (const rec of g.parts) rec._expPos.add(shift);
    }
    for (let i = 0; i < info.length; i++) {
      for (let j = i + 1; j < info.length; j++) {
        const a = info[i], b = info[j];
        const dist = d.copy(b.g.center).add(b.shift).sub(a.g.center).sub(a.shift).length();
        if (a.radius + b.radius - dist > 1e-6) residual++;
      }
    }
    this._explodeResidualOverlaps = residual;
  }

  // ------------------------------------------------------------ flat layout
  // One outline-aware 16:9 sheet. Groups remain metadata/filtering only.
  _deriveFlat() {
    const groups = [...this.groups.values()].filter(g => g.parts.length);
    for (const rec of this.parts) {
      const { q, flatSize } = this._flatQuaternion(rec);
      rec._flatQuat = q; rec._flatSize = flatSize;
    }
    // Flat geometry is pose-independent: reuse its deterministic packing on
    // recapture, while entry/explosion transforms still follow the live pose.
    const signature = this.parts.map(r => `${r.id}:${r._flatSize.toArray().map(v => v.toFixed(8))}`).join('|');
    let packed;
    if (this._flatCache?.signature === signature) {
      packed = this._flatCache.packed;
      for (const rec of this.parts) rec._flatLocal = this._flatCache.positions[rec.index].clone();
    } else {
      packed = packContourBoard(this.parts);
      this._flatCache = { signature, packed, positions: this.parts.map(r => r._flatLocal.clone()) };
    }
    const entryBox = new THREE.Box3();
    const m = new THREE.Matrix4();
    for (const rec of this.parts) {
      m.compose(rec.entry.position, rec.entry.quaternion, rec.entry.scale);
      entryBox.union(rec.localBox.clone().applyMatrix4(m));
    }
    const offsetX = entryBox.max.x + 0.06;
    this._board = { ...packed, offset: [offsetX, 0, 0] };
    for (const rec of this.parts) {
      rec._flatPos = new THREE.Vector3(offsetX + rec._flatLocal.x, rec._flatLocal.y, -rec._flatSize.z / 2);
      rec.cell = { x: rec._flatPos.x, y: rec._flatPos.y, w: rec._flatSize.x, h: rec._flatSize.y, group: rec.groupId };
      rec.targets.flat = { position: rec._flatPos.clone(), quaternion: rec._flatQuat.clone(), scale: rec.entry.scale.clone() };
    }
    for (const g of groups) g.flat = null; // no module tiles or label strips
    const audit = this._auditFlat(groups);
    this.flatInfo = { ...audit, ...packed, aabbOverlapCount: audit.overlapCountXY,
      overlapCountXY: packed.contourOverlapCount, overlapMetric: 'dilated projected triangle cells' };
  }

  // Canonical flat orientation: proper rotation (det=+1 signed permutation)
  // mapping the part's smallest world extent axis to +Z and largest to +X.
  _flatQuaternion(rec) {
    const size = rec.localBox.getSize(new THREE.Vector3()).multiply(rec.entry.scale);
    const w = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)];
    // z: smallest (tie priority z,y,x), x: largest of the rest (tie priority x,y)
    let z = 0;
    for (const cand of [2, 1, 0]) if (w[cand] <= w[z] + EPS) z = cand;
    const rest = [0, 1, 2].filter(i => i !== z);
    let x = rest[0];
    for (const cand of rest) if (w[cand] >= w[x] - EPS) x = cand;
    const y = rest.find(i => i !== x);
    // basis images: local axis x -> world X, y -> world Y, z -> world Z
    const f = (i) => (i === x ? 0 : i === y ? 1 : 2);
    const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();
    bx.setComponent(f(0), 1);
    by.setComponent(f(1), 1);
    bz.setComponent(f(2), 1);
    let R = new THREE.Matrix4().makeBasis(bx, by, bz);
    if (R.determinant() < 0) { by.negate(); R = new THREE.Matrix4().makeBasis(bx, by, bz); }
    const q = new THREE.Quaternion().setFromRotationMatrix(R);
    const flatSize = new THREE.Vector3(w[x], w[y], w[z]);
    return { q, flatSize };
  }

  // AABB overlap audit of the flat layout (part boxes only; group label
  // boxes are metadata strips and are excluded by construction).
  _auditFlat(groups) {
    const boxes = [];
    for (const g of groups) {
      for (const rec of g.parts) {
        const hw = rec._flatSize.x / 2, hh = rec._flatSize.y / 2;
        boxes.push({
          rec,
          minX: rec._flatPos.x - hw, maxX: rec._flatPos.x + hw,
          minY: rec._flatPos.y - hh, maxY: rec._flatPos.y + hh,
        });
      }
    }
    boxes.sort((a, b) => a.minX - b.minX);
    let overlaps = 0;
    const TOL = 1e-6;
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        if (b.minX >= a.maxX - TOL) break;
        if (b.minY < a.maxY - TOL && b.maxY > a.minY + TOL) overlaps++;
      }
    }
    return {
      overlapCountXY: overlaps,
      boardWidth: this._board.width, boardHeight: this._board.height,
      gap: this._board.gap, groupScale: 1,
      boxes: boxes.length,
    };
  }

  // ------------------------------------------------------------- runtime
  setScope(scope, { keepProgress = true } = {}) {
    if (scope == null || scope === 'all' || scope === '') {
      this.scope = 'all';
      this._activeGroups = new Set(this.groups.keys());
    } else {
      const s = String(scope);
      const match = [...this.groups.keys()].filter(id => id === s || moduleOf(id) === s);
      if (!match.length) {
        console.warn(`ExplodedLayout: unknown scope "${s}", keeping "${this.scope}"`);
        return false;
      }
      this.scope = s;
      this._activeGroups = new Set(match);
    }
    if (keepProgress && this._captured) this.setProgress(this.progress, { layout: this.layout });
    return true;
  }

  getScope() { return this.scope; }

  // Pure 0..1 mapping from captured entry placement to the group layouts.
  // No internal animation state; safe to call every frame in any order.
  setProgress(amount, { layout, scope } = {}) {
    if (layout && LAYOUTS.includes(layout)) this.layout = layout;
    if (scope !== undefined && scope !== this.scope) this.setScope(scope, { keepProgress: false });
    const t = THREE.MathUtils.clamp(Number(amount) || 0, 0, 1);
    this.progress = t;
    if (!this._captured) return { progress: t, layout: this.layout, scope: this.scope, parts: 0 };

    for (const rec of this.parts) {
      const tg = this._activeGroups.has(rec.groupId) ? rec.targets[this.layout] : null;
      const dst = tg || rec.entry;
      const m = rec.mesh;
      m.position.lerpVectors(rec.entry.position, dst.position, t);
      m.quaternion.slerpQuaternions(rec.entry.quaternion, dst.quaternion, t);
      m.scale.lerpVectors(rec.entry.scale, dst.scale, t);
      m.matrixWorldNeedsUpdate = true;
    }
    this._boundsCache.key = null;
    return { progress: t, layout: this.layout, scope: this.scope, parts: this.parts.length };
  }

  // Continuous score: assembly -> full explosion -> single contour board.
  // The second leg starts at the explosion, never jumps back to assembly.
  setScoreProgress(p) {
    const ease = t => t * t * (3 - 2 * t);
    if (p <= 0.44) return this.setProgress(ease(p / 0.44), { layout: 'exploded', scope: 'all' });
    const t = ease(Math.min(1, (p - 0.44) / 0.5));
    this.setProgress(t, { layout: 'flat', scope: 'all' });
    for (const rec of this.parts) {
      const a = rec.targets.exploded, b = rec.targets.flat;
      rec.mesh.position.lerpVectors(a.position, b.position, t);
      rec.mesh.quaternion.slerpQuaternions(a.quaternion, b.quaternion, t);
      rec.mesh.scale.copy(rec.entry.scale);
      rec.mesh.matrixWorldNeedsUpdate = true;
    }
    this._boundsCache.key = null;
  }

  getBounds() {
    const key = `${this.progress}|${this.layout}|${this.scope}`;
    if (this._boundsCache.key === key && this._boundsCache.box) return this._boundsCache.box.clone();
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    const m = new THREE.Matrix4();
    for (const rec of this.parts) {
      if (!this._activeGroups.has(rec.groupId)) continue;
      if (!rec.mesh.visible) continue;
      m.compose(rec.mesh.position, rec.mesh.quaternion, rec.mesh.scale);
      tmp.copy(rec.localBox).applyMatrix4(m);
      box.union(tmp);
    }
    if (this.layout === 'flat' && this.progress === 1 && this.scope === 'all' && this._board) {
      box.expandByPoint(new THREE.Vector3(this._board.offset[0], 0, 0));
      box.expandByPoint(new THREE.Vector3(this._board.offset[0] + this._board.width, this._board.height, 0));
    }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    this._boundsCache = { key, box: box.clone() };
    return box;
  }

  getStats() {
    const groups = this._groupOrder
      ? this._groupOrder.map(id => this.groups.get(id)).filter(Boolean)
      : [...this.groups.values()];
    return {
      partCount: this.parts.length,
      groupCount: groups.filter(g => g.parts.length).length,
      meshCount: this.parts.length, // one detached mesh per extracted part
      totalVerts: this.parts.reduce((a, r) => a + r.verts, 0),
      groups: groups.filter(g => g.parts.length).map(g => ({
        id: g.id, label: g.label, module: g.module, count: g.parts.length,
        verts: g.parts.reduce((a, r) => a + r.verts, 0),
        buckets: [...g.buckets],
        exploded: g.exploded ? {
          layers: g.exploded.layerCount, gap: g.exploded.gap, radialGain: g.exploded.radialGain,
          shift: g._explodeShift ? g._explodeShift.toArray() : [0, 0, 0],
        } : null,
        flat: g.flat ? {
          blockW: g.flat.blockW, blockH: g.flat.blockH, gap: g.flat.gap,
          labelAnchor: g.flat.labelAnchor, labelBox: g.flat.labelBox,
        } : null,
      })),
      coverage: this.coverage,
      explodedResidualGroupOverlaps: this._explodeResidualOverlaps ?? null,
      flat: this.flatInfo ? { ...this.flatInfo } : null,
      hiddenParts: this.parts.filter(r => !r.mesh.visible).length,
      hiddenGroups: groups.filter(g => g.parts.length && g.parts.every(r => !r.mesh.visible)).map(g => g.id),
      omittedFromExtraction: this.omittedFromExtraction,
      scope: this.scope, layout: this.layout, progress: this.progress,
      activeGroups: [...this._activeGroups],
    };
  }

  // Pick mapping: accepts a detached Mesh, an intersection ({object}), or a
  // part id string; returns stable metadata or null.
  getPart(meshOrIntersection) {
    if (meshOrIntersection == null) return null;
    if (typeof meshOrIntersection === 'string') {
      const rec = this.parts.find(r => r.id === meshOrIntersection);
      return rec ? rec.mesh.userData.explodedLayout : null;
    }
    const obj = meshOrIntersection.object || meshOrIntersection;
    const rec = this.byMesh.get(obj);
    return rec ? rec.mesh.userData.explodedLayout : null;
  }

  _teardownParts() {
    for (const rec of this.parts) {
      rec.mesh.removeFromParent();
      this.byMesh.delete(rec.mesh);
    }
    for (const g of this.groups.values()) this.root.remove(g.group3d);
    this.parts = [];
    this.groups = new Map();
    this._groupOrder = [];
    this._boundsCache = { key: null, box: null };
    this._captured = false;
  }

  // Releases owned geometry clones. Shared source materials and the original
  // model geometry are never touched. After dispose, capture() rebuilds.
  dispose() {
    const disposedGeometries = this._geoCache.size;
    let disposedSlices = 0;
    for (const entry of this._geoCache.values()) {
      for (const sl of entry.slices) { sl.geometry.dispose(); disposedSlices++; }
    }
    this._geoCache.clear();
    const partCount = this.parts.length;
    this._teardownParts();
    this.omittedFromExtraction = [];
    this.coverage = null;
    this.flatInfo = null;
    this.root.visible = false;
    this.progress = 0;
    return { disposedGeometries, disposedSlices, partCount };
  }
}
