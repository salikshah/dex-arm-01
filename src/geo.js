// Geometry factory: turns (name, geometry type, local bounds) into real part geometry.
// No boxes-as-answer: every pattern maps to a purpose-built generator.
import * as THREE from 'three';
import { PARAMS } from './params.js';

const cache = new Map();
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function dims(node) {
  const mn = node.bmin, mx = node.bmax;
  return {
    size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]],
    center: [(mx[0] + mn[0]) / 2, (mx[1] + mn[1]) / 2, (mx[2] + mn[2]) / 2],
  };
}

function finalize(geo, center) {
  // geo may be a shared cached instance — always translate a copy
  const g = geo.clone();
  g.translate(center[0], center[1], center[2]);
  return g;
}

function cached(key, make) {
  if (cache.has(key)) return cache.get(key);
  const g = make();
  cache.set(key, g);
  return g;
}
const K = (tag, arr) => tag + ':' + arr.map(v => v.toFixed(5)).join(',');

// ---------------------------------------------------------------- lathe parts
// Bounds convention: diameter in x/y, width along local z.
function latheFromProfile(profile, seg = 40) {
  const geo = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), seg);
  geo.rotateX(Math.PI / 2); // lathe axis Y -> local Z
  return geo;
}

function ringProfile(rOut, w, opts = {}) {
  const rIn = opts.rIn ?? rOut * 0.72;
  const lip = opts.lip ?? Math.min(w * 0.28, rOut * 0.1);
  const t = w / 2;
  const p = [];
  p.push([rIn, -t]);
  p.push([rOut - lip, -t]);
  p.push([rOut, -t + lip]);
  p.push([rOut, t - lip]);
  p.push([rOut - lip, t]);
  p.push([rIn, t]);
  if (opts.groove) { p.push([rIn - lip * 0.4, t * 0.4]); p.push([rIn - lip * 0.4, -t * 0.4]); }
  p.push([rIn, -t]);
  return p;
}

function discProfile(rOut, w, opts = {}) {
  const rHub = opts.rHub ?? rOut * 0.3;
  const rimH = opts.rimH ?? w * 0.5;
  const t = w / 2;
  const dish = Math.min(opts.dish ?? rOut * 0.06, t * 0.8);
  const p = [];
  p.push([0, -t * 0.5]);
  p.push([rHub, -t * 0.5]);
  p.push([rHub * 1.15, -t]);
  p.push([rOut * 0.82, -t]);
  p.push([rOut, -t + rimH * 0.5]);
  p.push([rOut, t - rimH * 0.4]);
  p.push([rOut * 0.9, t]);
  p.push([rHub * 1.2, t - dish]);
  p.push([rHub, t - dish * 0.4]);
  p.push([0, t - dish * 0.4]);
  return p;
}

function bushingProfile(rOut, w) {
  const rIn = rOut * 0.62, t = w / 2, lip = Math.min(w * 0.22, rOut * 0.22);
  return [
    [rIn, -t], [rOut - lip, -t], [rOut, -t + lip],
    [rOut * 0.94, 0], [rOut, t - lip], [rOut - lip, t], [rIn, t], [rIn, -t],
  ];
}

function lathePart(node) {
  const { size, center } = dims(node);
  const r = Math.max(size[0], size[1]) / 2;
  const w = size[2];
  const n = node.name;
  const make = () => {
    let profile;
    if (/heatshrink|grommet|boot|standoff|palm-tie|feedthrough/.test(n)) profile = bushingProfile(r, w);
    else if (/bearing-inner|flexspline|seal|gasket|retainer|wave-generator|encoder/.test(n)) profile = ringProfile(r, w, { rIn: r * (node.role === 'graphite' ? 0.8 : 0.68) });
    else if (/shroud/.test(n)) profile = ringProfile(r, w, { rIn: r * 0.86, lip: Math.min(w * 0.2, r * 0.08) });
    else if (/neck/.test(n)) profile = discProfile(r, w, { rHub: r * 0.55, dish: r * 0.16 });
    else if (/flange|bezel|cover|cap|bulkhead|carrier|torque|flexure|brake/.test(n)) profile = discProfile(r, w);
    else profile = discProfile(r, w);
    return latheFromProfile(profile, r < 0.006 ? 24 : 44);
  };
  const tag = /heatshrink|grommet|boot|standoff|palm-tie|feedthrough/.test(n) ? 'bush'
    : /bearing-inner|flexspline|seal|gasket|retainer|wave-generator|encoder/.test(n) ? 'ring'
    : /shroud/.test(n) ? 'shroud' : /neck/.test(n) ? 'neck' : 'disc';
  return finalize(cached(K('lathe-' + tag, size), make), center);
}

// -------------------------------------------------------------- extrude parts
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function extrudePart(node) {
  const { size, center } = dims(node);
  const n = node.name;
  // corner treatment differs by part family — keep it in the cache key
  const soft = /board|substrate|inset|cover|foot|plinth/.test(n);
  const make = () => {
    // extrusion axis = smallest dimension; profile spans the other two
    const ax = size[0] <= size[1] && size[0] <= size[2] ? 0 : (size[1] <= size[2] ? 1 : 2);
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    const d = Math.max(size[ax], 1e-4);
    const bevel = Math.max(0, Math.min(d * 0.28, 0.0009, size[u] * 0.2, size[v] * 0.2));
    const w = Math.max(size[u] - 2 * bevel, 1e-4);   // bevelSize expands the profile: pre-compensate
    const h = Math.max(size[v] - 2 * bevel, 1e-4);
    const rad = Math.min(w, h) * (soft ? 0.12 : 0.24);
    const shape = roundedRectShape(w, h, rad);
    const depth = Math.max(d - bevel * 2, d * 0.4);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 1e-6,
      bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8,
    });
    geo.translate(0, 0, -depth / 2);
    // explicit right-handed basis remap: shape X→u, shape Y→v, extrusion Z→ax
    const M = new THREE.Matrix4();
    if (ax === 0) M.set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);       // (x,y,z)→(z,x,y)
    else if (ax === 1) M.set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);  // (x,y,z)→(y,z,x)
    if (ax !== 2) geo.applyMatrix4(M);
    return geo;
  };
  return finalize(cached(K(soft ? 'ext-soft' : 'ext-hard', size), make), center);
}

// ------------------------------------------------------------- cylinder/cone
function cylinderPart(node) {
  const { size, center } = dims(node);
  const make = () => {
    const r = (size[0] + size[2]) / 4;
    const geo = new THREE.CylinderGeometry(r, r, size[1], 20);
    return geo;
  };
  return finalize(cached(K('cyl', size), make), center);
}

function conePart(node) {
  const { size, center } = dims(node);
  const make = () => new THREE.ConeGeometry((size[0] + size[2]) / 4, size[1], 20);
  return finalize(cached(K('cone', size), make), center);
}

function spherePart(node) {
  const { size, center } = dims(node);
  const make = () => {
    const geo = new THREE.SphereGeometry(0.5, 26, 18);
    geo.scale(size[0], size[1], size[2]);
    geo.computeVertexNormals();
    return geo;
  };
  return finalize(cached(K('sph', size), make), center);
}

// --------------------------------------------------------------- curve utils
export function catmullPoints(flat, closed = false) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 3) pts.push(new THREE.Vector3(flat[i], flat[i + 1], flat[i + 2]));
  if (pts.length === 2) {
    const mid = pts[0].clone().lerp(pts[1], 0.5);
    pts.splice(1, 0, mid);
  }
  return new THREE.CatmullRomCurve3(pts, closed, 'centripetal', 0.5);
}

export function tubeFromCurve(curve, radius, opts = {}) {
  const len = curve.getLength();
  const seg = Math.max(opts.minSeg ?? 8, Math.round(len / Math.max(radius * (opts.segFactor ?? 3.2), 1e-5)));
  const radial = opts.radial ?? 5;
  return new THREE.TubeGeometry(curve, Math.min(seg, opts.maxSeg ?? 64), radius, radial, false);
}

export function ribbonFromCurve(curve, width, thick, opts = {}) {
  const segs = opts.segs ?? 24;
  const pts = curve.getSpacedPoints(segs);
  const pos = [], norm = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length; i++) {
    const t = curve.getTangent(i / segs);
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    if (side.lengthSq() < 0.1) side.set(1, 0, 0);
    const nrm = new THREE.Vector3().crossVectors(side, t).normalize();
    const p = pts[i];
    const hw = width / 2, ht = thick / 2;
    const corners = [
      p.clone().addScaledVector(side, -hw).addScaledVector(nrm, ht),
      p.clone().addScaledVector(side, hw).addScaledVector(nrm, ht),
      p.clone().addScaledVector(side, hw).addScaledVector(nrm, -ht),
      p.clone().addScaledVector(side, -hw).addScaledVector(nrm, -ht),
    ];
    for (const c of corners) pos.push(c.x, c.y, c.z);
    for (let k = 0; k < 4; k++) norm.push(nrm.x, nrm.y, nrm.z);
    if (i > 0) {
      const a = (i - 1) * 4, b = i * 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
      idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
      idx.push(a + 3, b + 3, a, a, b + 3, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------- buffer part kinds
function torusPart(rOut, w, rInRatio = 0.7, tubeRatio = 0.16) {
  // TorusGeometry axis is +Z by default — that is exactly the bounds width axis; keep it.
  const rIn = rOut * rInRatio;
  const major = (rOut + rIn) / 2, tube = Math.min(rOut * tubeRatio, (rOut - rIn) / 2, w * 0.48);
  const geo = new THREE.TorusGeometry(major, tube, 10, 36);
  if (w > tube * 2.4) geo.scale(1, 1, w / (tube * 2));
  return geo;
}

function bearingPart(rOut, w) {
  // knuckle bearing pair: one race on each side of the joint, both coaxial with the hinge axis (local Z)
  const tube = Math.min(rOut * 0.15, w * 0.2);
  const major = rOut * 0.86;
  const off = Math.max(w / 2 - tube * 0.7, 0);
  const geos = [];
  for (const s of [-1, 1]) {
    const t = new THREE.TorusGeometry(major, tube, 10, 34);
    t.translate(0, 0, s * off);
    geos.push(t);
  }
  return mergeGeos(geos);
}

function windingPart(rOut, w) {
  // axial copper bars around a drum — the signature finger-joint look
  const geos = [];
  const core = new THREE.CylinderGeometry(rOut * 0.66, rOut * 0.66, w * 0.92, 18);
  core.rotateX(Math.PI / 2);
  geos.push(core);
  const bars = 13;
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2;
    const bar = new THREE.CapsuleGeometry(rOut * 0.13, w * 0.8, 3, 6);
    bar.rotateX(Math.PI / 2);
    bar.translate(Math.cos(a) * rOut * 0.82, Math.sin(a) * rOut * 0.82, 0);
    geos.push(bar);
  }
  return mergeGeos(geos);
}

function magnetPart(rOut, w) {
  const geos = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const arc = new THREE.BoxGeometry(rOut * 0.36, rOut * 0.22, w * 0.92);
    const m = new THREE.Matrix4().makeRotationZ(a + Math.PI / 2);
    arc.applyMatrix4(m);
    arc.translate(Math.cos(a) * rOut * 0.82, Math.sin(a) * rOut * 0.82, 0);
    geos.push(arc);
  }
  return mergeGeos(geos);
}

function pinField(sx, sy, sz, opts = {}) {
  // grid of tiny contacts filling the bounds
  const geos = [];
  const area = sx * sy;
  const pin = Math.max(Math.min(sx, sy) / (opts.div ?? 5), 0.00012);
  const nx = Math.max(1, Math.round(sx / (pin * 1.7)));
  const ny = Math.max(1, Math.round(sy / (pin * 1.7)));
  const g = new THREE.BoxGeometry(pin, pin, Math.max(sz, 0.00012));
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const p = g.clone();
    p.translate(-sx / 2 + (i + 0.5) * sx / nx, -sy / 2 + (j + 0.5) * sy / ny, 0);
    geos.push(p);
  }
  return mergeGeos(geos);
}

function screwHeads(rOut, w) {
  const geos = [];
  const n = 6;
  const head = new THREE.CylinderGeometry(w * 0.42, w * 0.42, w * 0.5, 10);
  head.rotateX(Math.PI / 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = head.clone();
    p.translate(Math.cos(a) * rOut * 0.78, Math.sin(a) * rOut * 0.78, 0);
    geos.push(p);
  }
  return mergeGeos(geos);
}

function mergeGeos(geos) {
  // minimal non-indexed merge (positions+normals+uvs)
  let total = 0;
  const list = geos.map(g => g.index ? g.toNonIndexed() : g);
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
    g.dispose?.();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

function ribbonStrip(sx, sy, sz) {
  // tactile FPC: flat strip with a gentle S-bend inside its bounds
  const w = sx * 0.8, t = Math.max(sz * 0.22, 0.00008);
  const pts = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    pts.push(new THREE.Vector3(
      Math.sin(u * Math.PI * 1.6) * sx * 0.08,
      -sy / 2 + u * sy,
      Math.cos(u * Math.PI * 2.2) * sz * 0.3));
  }
  return ribbonFromCurve(new THREE.CatmullRomCurve3(pts), w, t, { segs: 18 });
}

function wovenPart(sx, sy, sz) {
  // braided sleeve: two families of helical strands around the sleeve volume
  const geos = [];
  const r = Math.max(sx, sz) / 2 * 0.92;
  const strands = 7;
  for (let fam = 0; fam < 2; fam++) {
    for (let i = 0; i < strands; i++) {
      const phase = (i / strands) * Math.PI * 2 + fam * 0.3;
      const pts = [];
      const N = 26;
      for (let k = 0; k < N; k++) {
        const u = k / (N - 1);
        const a = phase + u * Math.PI * 2 * 2.2 * (fam ? 1 : -1);
        pts.push(new THREE.Vector3(Math.cos(a) * r, -sy / 2 + u * sy, Math.sin(a) * r));
      }
      geos.push(tubeFromCurve(new THREE.CatmullRomCurve3(pts), Math.min(r * 0.16, 0.0004), { radial: 3, minSeg: 20 }));
    }
  }
  return mergeGeos(geos);
}

function denseBundle(node, sx, sy, sz, density) {
  // batched micro wiring filling a volume with woven strands
  const geos = [];
  const count = Math.max(2, Math.round(PARAMS.wiring.microBundleCount * density));
  const seedBase = hashStr(node.name);
  for (let i = 0; i < count; i++) {
    const h = hash(seedBase + i * 7919);
    const pts = [];
    const N = 15;
    const x0 = (h[0] - 0.5) * sx * 0.7, x1 = (h[1] - 0.5) * sx * 0.7;
    const z0 = (h[2] - 0.5) * sz * 0.7, z1 = (h[3] - 0.5) * sz * 0.7;
    const bow = (h[4] - 0.5) * sz * 0.9;
    const ph = h[5] * Math.PI * 2;
    for (let k = 0; k < N; k++) {
      const u = k / (N - 1);
      pts.push(new THREE.Vector3(
        x0 + (x1 - x0) * u + Math.sin(u * 5 + ph) * sx * 0.06,
        -sy / 2 + u * sy,
        z0 + (z1 - z0) * u + Math.sin(u * Math.PI) * bow + Math.cos(u * 7 + ph) * sz * 0.05));
    }
    const r = 0.00019 + h[6] * 0.00008;
    geos.push(tubeFromCurve(new THREE.CatmullRomCurve3(pts), r, { radial: 3, minSeg: 12, maxSeg: 24 }));
  }
  return mergeGeos(geos);
}

function hash(n) {
  // deterministic pseudo-random floats in [0,1)
  const out = [];
  let x = n >>> 0 || 1;
  for (let i = 0; i < 8; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out.push((x & 0xffffff) / 0x1000000);
  }
  return out;
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ------------------------------------------------------------- shell lofting
function ellSection(rx, rz, cx, cz, seg, arcFrom, arcTo) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = arcFrom + (arcTo - arcFrom) * (i / seg);
    pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return pts;
}

function loft(sections, seg, arcFrom, arcTo, caps = true) {
  // sections: [{y, pts:[[x,z]...]}] all with same count
  const pos = [], idx = [];
  const n = sections[0].pts.length;
  for (const s of sections) for (const p of s.pts) pos.push(p[0], s.y, p[1]);
  const rows = sections.length;
  for (let r = 0; r < rows - 1; r++) {
    for (let i = 0; i < n - 1; i++) {
      const a = r * n + i, b = (r + 1) * n + i;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  if (caps) {
    // fan caps at both ends
    for (const r of [0, rows - 1]) {
      const cIdx = pos.length / 3;
      let cx = 0, cz = 0;
      for (const p of sections[r].pts) { cx += p[0]; cz += p[1]; }
      cx /= n; cz /= n;
      pos.push(cx, sections[r].y, cz);
      for (let i = 0; i < n - 1; i++) {
        const a = r * n + i;
        if (r === 0) idx.push(cIdx, a + 1, a); else idx.push(cIdx, a, a + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function palmShell(node, dorsal) {
  const seg = 26;
  const secs = PARAMS.palmSections.map(s => ({
    y: s.y,
    pts: ellSection(s.rx, s.rz, s.cx, s.cz, seg, dorsal ? 0 : Math.PI, dorsal ? Math.PI : Math.PI * 2),
  }));
  // close the shell: add thin lip edge rows connecting both ends? keep open at split, DoubleSide material
  const geo = loft(secs, seg, 0, Math.PI, true);
  // add the split edges as thin walls
  return geo;
}

function phalanxShell(node, dorsal) {
  // tapered rounded channel along local Y covering half the finger
  const { size } = dims(node);
  const sx = size[0] / 2, sy = size[1], sz = size[2];
  const seg = 18, rows = 7;
  const secs = [];
  for (let r = 0; r < rows; r++) {
    const u = r / (rows - 1);
    const taper = 1 - 0.22 * u;
    const rx = sx * 0.96 * taper, rz = sz * (dorsal ? 1.02 : 0.98) * (1 - 0.1 * u);
    const y = -sy / 2 + u * sy;
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI; // half ellipse
      const x = Math.cos(a) * rx;
      const z = Math.sin(a) * rz * (dorsal ? 1 : -1);
      pts.push([x, z]);
    }
    secs.push({ y, pts });
  }
  // round the tip: shrink last section toward center
  const geo = loft(secs, seg, 0, Math.PI, true);
  return geo;
}

function armShell(node) {
  // tapered half-pipe along local Y
  const { size } = dims(node);
  const isUpper = node.name.startsWith('upper-arm');
  const len = isUpper ? PARAMS.arm.upperLength : PARAMS.arm.foreLength;
  const r0 = isUpper ? PARAMS.arm.upperR0 : PARAMS.arm.foreR0;
  const r1 = isUpper ? PARAMS.arm.upperR1 : PARAMS.arm.foreR1;
  const seg = 26, rows = 9;
  const secs = [];
  for (let r = 0; r < rows; r++) {
    const u = r / (rows - 1);
    const rad = (r0 + (r1 - r0) * u) * 1.0;
    const y = -size[1] / 2 + u * size[1];
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI;
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
    }
    secs.push({ y, pts });
  }
  return loft(secs, seg, 0, Math.PI, true);
}

function barrelShell(node) {
  // continuous half-cylinder joint housing, built in absolute local coordinates:
  // axis = local Y (bounds y range kept as-is), radius in XZ, half selected by sign of z bounds
  const mn = node.bmin, mx = node.bmax;
  const R = Math.max(Math.abs(mx[0]), Math.abs(mn[0]), Math.abs(mx[2]), Math.abs(mn[2]));
  const y0 = mn[1], y1 = mx[1];
  const positive = mn[2] >= 0;
  const edge = positive ? Math.max(mn[2], 0) : Math.max(-mx[2], 0);
  const a0 = Math.asin(Math.min(0.9, edge / R));
  const seg = 44;
  const lipH = Math.min((y1 - y0) * 0.1, 0.0022);
  const lipR = R * 0.035;
  // profile rows: [radius, y] with soft rims at both ends
  const rows = [
    [R, y0], [R, y0 + lipH], [R - lipR, y0 + lipH * 2.2],
    [R - lipR, y1 - lipH * 2.2], [R, y1 - lipH], [R, y1],
  ];
  const pos = [], idx = [];
  const aStart = positive ? a0 : Math.PI + a0;
  const aEnd = positive ? Math.PI - a0 : Math.PI * 2 - a0;
  for (let r = 0; r < rows.length; r++) {
    const [rad, y] = rows[r];
    for (let i = 0; i <= seg; i++) {
      const a = aStart + (aEnd - aStart) * (i / seg);
      pos.push(Math.cos(a) * rad, y, Math.sin(a) * rad);
    }
  }
  const n = seg + 1;
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * n + i, b = (r + 1) * n + i;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function cuffShell(node) {
  // sculpted wrist cuff half: flared collar segment
  const { size } = dims(node);
  const seg = 20, rows = 6;
  const secs = [];
  for (let r = 0; r < rows; r++) {
    const u = r / (rows - 1);
    const rad = size[2] / 2 * (1.0 + 0.3 * Math.sin(u * Math.PI));
    const y = -size[1] / 2 + u * size[1];
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI;
      pts.push([Math.cos(a) * size[0] / 2, Math.sin(a) * rad]);
    }
    secs.push({ y, pts });
  }
  return loft(secs, seg, 0, Math.PI, true);
}

// ------------------------------------------------------------ main dispatch
export function buildNodeGeometry(node, ctx = {}) {
  const n = node.name;
  const { size, center } = dims(node);
  const density = ctx.density ?? 1;

  if (node.geo === 2) return lathePart(node);          // LatheGeometry
  if (node.geo === 1) return extrudePart(node);        // ExtrudeGeometry
  if (node.geo === 4) return cylinderPart(node);       // CylinderGeometry
  if (node.geo === 6) return conePart(node);           // ConeGeometry
  if (node.geo === 5) return spherePart(node);         // SphereGeometry
  if (node.geo === 3) {                                 // TubeGeometry (static wire paths)
    if (ctx.wireForNode) {
      const ws = ctx.wireForNode(node.id);
      if (ws && ws.length) {
        ctx.onStaticWire?.(ws.length);
        const geos = [];
        for (const w of ws) {
          if (w.ribbon) geos.push(ribbonFromCurve(catmullPoints(w.points), w.radius * 7, w.radius * 1.6));
          else geos.push(tubeFromCurve(catmullPoints(w.points), w.radius));
        }
        return finalize(mergeGeos(geos), [0, 0, 0]);
      }
    }
    // fallback: structural curved rail inside bounds
    const pts = [];
    const N = 12;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      pts.push(new THREE.Vector3(
        Math.sin(u * Math.PI) * size[0] * 0.12,
        -size[1] / 2 + u * size[1],
        Math.sin(u * Math.PI * 0.8) * size[2] * 0.2));
    }
    return finalize(tubeFromCurve(new THREE.CatmullRomCurve3(pts), Math.max(size[0], size[2]) * 0.14), center);
  }

  // BufferGeometry — semantic patterns
  const base = n.split('/').pop();
  let geo;
  if (/^bearing/.test(base)) geo = bearingPart(size[0] / 2, size[2]);
  else if (/^motor-\d/.test(base)) geo = windingPart(size[0] / 2, size[2]);
  else if (/^motor-core/.test(base)) { geo = new THREE.CylinderGeometry(size[0] / 2, size[0] / 2, size[1], 16); }
  else if (/rotor-magnets/.test(base)) geo = magnetPart(size[0] / 2, size[2]);
  else if (/abduction-winding/.test(base)) geo = torusPart(size[0] / 2, size[2], 0.42, 0.3);
  else if (/screw-heads/.test(base)) geo = screwHeads(size[0] / 2, size[2]);
  else if (/screw-recess/.test(base)) geo = torusPart(size[0] / 2, size[2], 0.8, 0.3);
  else if (/contact-cavities|contacts|crimp-pins|passives|fpc-contact-fingers|sense-components/.test(base)) geo = pinField(size[0], size[1], size[2]);
  else if (/traces/.test(base)) geo = pinField(size[0], size[1], Math.max(size[2], 0.00006), { div: 9 });
  else if (/encoder-track|strain-patches/.test(base)) { geo = new THREE.CylinderGeometry(size[0] / 2, size[0] / 2, Math.max(size[2], 0.0002), 30); geo.rotateX(Math.PI / 2); }
  else if (/tactile-fpc/.test(base)) geo = ribbonStrip(size[0], size[1], size[2]);
  else if (/woven-strands/.test(base)) geo = wovenPart(size[0], size[1], size[2]);
  else if (/^barrel-shell/.test(base)) return barrelShell(node);       // absolute local coords
  else if (/^dorsal-shell/.test(base)) return palmShell(node, true);   // absolute sections, no re-centering
  else if (/^palmar-shell/.test(base)) return palmShell(node, false);
  else if (/^dorsal-cover/.test(base)) geo = phalanxShell(node, true);
  else if (/^palmar-wrap/.test(base)) geo = phalanxShell(node, false);
  else if (/^(upper-arm|forearm)\/shell/.test(n)) geo = armShell(node);
  else if (/^sculpted-cuff/.test(base)) geo = cuffShell(node);
  else if (/^dense-batch-/.test(base)) geo = denseBundle(node, size[0], size[1], size[2], density);
  else if (/fingers$/.test(base)) geo = pinField(size[0], size[1], size[2], { div: 8 }); // comb guide fingers
  else geo = pinField(size[0], size[1], size[2], { div: 4 }); // generic populated detail
  return finalize(geo, center);
}
