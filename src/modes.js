// Display modes: product / transparent / open (continuous shell blends)
// + section / wiring / explode (discrete layers). One writer per channel.
import * as THREE from 'three';

export const MODES = ['product', 'transparent', 'open', 'section', 'wiring', 'explode'];
const ALIAS = { clear: 'transparent' };
const BLEND_FOR = { product: [1, 0], transparent: [0, 0], open: [0, 1] };

export class Modes {
  constructor(model, materials, wiring, renderer) {
    this.model = model;
    this.materials = materials;
    this.wiring = wiring;
    this.renderer = renderer;
    this.mode = 'transparent';
    this.blendTarget = [0, 0]; // [product, open]
    this.explodeT = 0;
    this.explodeTarget = 0;
    this.sectionOffset = 0.0;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.002);
    this.isolate = false;
    this._blendDirty = true;
    this._explodeVecs = null;
    this._computeExplode();
    this.applyVisibility();
  }

  _computeExplode() {
    // per-bucket offset direction (rest pose): away from parent bucket center
    const model = this.model;
    const centerOf = (b) => {
      const box = new THREE.Box3();
      for (const p of b.parts) box.union(p.bounds);
      if (box.isEmpty()) return null;
      const c = box.getCenter(new THREE.Vector3());
      const ownerId = b.owner.userData?.nodeId;
      const M = ownerId !== undefined ? model.restWorld.get(ownerId) : null;
      return M ? c.applyMatrix4(M) : c;
    };
    const worldCenter = new Map();
    for (const b of this.model.buckets) worldCenter.set(b, centerOf(b));
    const findParentBucket = (b) => {
      let obj = b.owner.parent;
      while (obj) {
        const found = this.model.buckets.find(x => x.owner === obj);
        if (found && worldCenter.get(found)) return found;
        obj = obj.parent;
      }
      return null;
    };
    this._explodeVecs = new Map();
    for (const b of this.model.buckets) {
      const c = worldCenter.get(b);
      if (!c || !b.meshes.length) continue;
      const pb = findParentBucket(b);
      const pc = pb ? worldCenter.get(pb) : new THREE.Vector3(0, 0.2, 0);
      const dir = c.clone().sub(pc);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      dir.normalize();
      const ownerId = b.owner.userData?.nodeId;
      const M = ownerId !== undefined ? this.model.restWorld.get(ownerId) : null;
      if (M) {
        const rot = new THREE.Matrix4().extractRotation(M).invert();
        dir.applyMatrix4(rot).normalize();
      }
      const scale = 0.028 + 0.012 * Math.min(4, depthOf(b.owner));
      this._explodeVecs.set(b, dir.multiplyScalar(scale));
    }
    function depthOf(o) { let d = 0; while (o.parent) { d++; o = o.parent; } return d; }
  }

  set(mode) {
    mode = ALIAS[mode] || mode;
    if (!MODES.includes(mode)) return;
    this._exit(this.mode);
    this.mode = mode;
    this._enter(mode);
    if (BLEND_FOR[mode]) this.blendTarget = [...BLEND_FOR[mode]];
  }

  // continuous shell blend control used by the guided tour (mode label untouched)
  setBlend(product, open) {
    this.blendTarget = [Math.min(1, Math.max(0, product)), Math.min(1, Math.max(0, open))];
  }

  get blend() {
    return [this.materials.productAmt, this.materials.openAmt];
  }

  _enter(mode) {
    if (mode === 'section') {
      this.renderer.localClippingEnabled = true;
      this.renderer.clippingPlanes = [this.clipPlane];
    }
    if (mode === 'wiring') this._dimStructure(true);
    if (mode === 'explode') this.hooks?.explode?.(true);
  }

  _exit(mode) {
    if (mode === 'section') this.renderer.clippingPlanes = [];
    if (mode === 'wiring') this._dimStructure(false);
    if (mode === 'explode') this.hooks?.explode?.(false);
  }

  _dimStructure(dim) {
    this._dimmed = dim;
    for (const [role, mat] of this.materials.coreMats) {
      const isWire = /wire|micro|polyimide|braid|power|data|signal|sleeve/.test(role);
      if (dim && !isWire) {
        mat.userData.saved = { transparent: mat.transparent, opacity: mat.opacity };
        mat.transparent = true;
        mat.opacity = 0.13;
        mat.depthWrite = false;
      } else if (mat.userData.saved) {
        mat.transparent = mat.userData.saved.transparent;
        mat.opacity = mat.userData.saved.opacity;
        mat.depthWrite = true;
        delete mat.userData.saved;
      }
    }
    this.materials.wiringDim = dim;
    this._blendDirty = true;
  }

  setSectionOffset(v) {
    this.sectionOffset = v;
    this.clipPlane.constant = v;
  }

  setIsolate(on) {
    this.isolate = !!on;
    this.applyVisibility();
  }

  applyVisibility() {
    const shellGone = this.materials.shellGone;
    const j7 = this.model.nodeByName.get('J7/axis');
    const hand = this.model.nodeByName.get('hand');
    for (const b of this.model.buckets) {
      let o = b.owner, inHand = false, inJ7 = false;
      while (o) { if (o === hand) inHand = true; if (o === j7) inJ7 = true; o = o.parent; }
      const isolateOk = !this.isolate || inHand || inJ7;
      for (const mesh of b.meshes) {
        const isShell = mesh.userData.role === 'clear-shell';
        mesh.visible = isolateOk && !(isShell && shellGone);
      }
    }
    this.wiring.setVisibleByPrefix(id => !this.isolate || id.startsWith('hand/'));
    if (this.model.stylus) this.model.stylus.visible = false;
  }

  // instant blend application (reference capture / mask rendering)
  snapBlend() {
    this.materials.productAmt = this.blendTarget[0];
    this.materials.openAmt = this.blendTarget[1];
    this.materials.updateShell();
    this.applyVisibility();
  }

  update(dt) {
    // shell blend damping (~700 ms settle, retarget-safe)
    const m = this.materials;
    const rate = 4.2;
    const step = rate * dt;
    let changed = false;
    for (const [key, idx] of [['productAmt', 0], ['openAmt', 1]]) {
      const cur = m[key], tgt = this.blendTarget[idx];
      if (Math.abs(cur - tgt) > 1e-4) {
        m[key] = Math.abs(tgt - cur) <= step ? tgt : cur + Math.sign(tgt - cur) * step;
        changed = true;
      }
    }
    if (changed || this._blendDirty) {
      this._blendDirty = false;
      m.updateShell();
      if (m.wiringDim) { m.shellMat.opacity = Math.min(m.shellMat.opacity, 0.05); m.shellMat.transmission = Math.min(m.shellMat.transmission, 0.2); }
      if (m.shellGone !== this._lastShellGone) {
        this._lastShellGone = m.shellGone;
        this.applyVisibility();
      }
    }
    // explode easing
    const prev = this.explodeT;
    const speed = 3.2;
    if (this.explodeT < this.explodeTarget) this.explodeT = Math.min(this.explodeTarget, this.explodeT + dt * speed);
    else if (this.explodeT > this.explodeTarget) this.explodeT = Math.max(this.explodeTarget, this.explodeT - dt * speed);
    if (prev !== this.explodeT) {
      const e = this.explodeT * this.explodeT * (3 - 2 * this.explodeT);
      for (const [b, vec] of this._explodeVecs || []) {
        for (const mesh of b.meshes) mesh.position.copy(vec).multiplyScalar(e);
      }
    }
  }
}
