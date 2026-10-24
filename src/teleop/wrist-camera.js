// Offscreen wrist camera for dataset frames. Renders a small square view from
// the palm into a render target and returns a JPEG data URL. Kept at 192 px and
// opt-in because the readback stalls the GPU pipeline for a few milliseconds.

import * as THREE from 'three';

export class WristCamera {
  constructor({ renderer, scene, model, size = 192 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.size = size;

    this.camera = new THREE.PerspectiveCamera(74, 1, 0.006, 2.5);
    this.rig = new THREE.Object3D();
    this.rig.name = 'Wrist_Camera_Rig';
    this.rig.position.set(0, 0.028, 0.055);
    this.rig.rotation.x = Math.PI / 2; // look along the fingers (+Y)
    this.rig.add(this.camera);

    const hand = model.nodeByName.get('hand') || model.nodeByName.get('palm') || model.root;
    hand.add(this.rig);

    this.target = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.pixels = new Uint8Array(size * size * 4);
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = size;
      this.canvas.height = size;
      this.ctx = this.canvas.getContext('2d');
    }
  }

  capture() {
    if (!this.canvas || !this.ctx) return null;
    const previous = this.renderer.getRenderTarget();
    const previousColor = this.renderer.getClearColor(new THREE.Color());
    const previousAlpha = this.renderer.getClearAlpha();

    try {
      this.renderer.setRenderTarget(this.target);
      this.renderer.setClearColor(0x0b0c0e, 1);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.readRenderTargetPixels(this.target, 0, 0, this.size, this.size, this.pixels);

      const image = this.ctx.createImageData(this.size, this.size);
      const row = this.size * 4;
      for (let y = 0; y < this.size; y++) {
        const src = (this.size - 1 - y) * row;
        image.data.set(this.pixels.subarray(src, src + row), y * row);
      }
      this.ctx.putImageData(image, 0, 0);
      return this.canvas.toDataURL('image/jpeg', 0.66);
    } catch (err) {
      console.warn('[wrist-camera] capture failed:', err?.message || err);
      return null;
    } finally {
      this.renderer.setRenderTarget(previous);
      this.renderer.setClearColor(previousColor, previousAlpha);
    }
  }

  dispose() {
    this.rig.removeFromParent();
    this.target.dispose();
  }
}
