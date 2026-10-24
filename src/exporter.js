// PNG, GLB, URDF, and MuJoCo MJCF export for Dirgha Form-7.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { generateURDF, generateMJCF } from './robot-specs.js';
import { exportROS2Package } from './ros2-packager.js';

export function exportPNG(renderer, scene, camera, filename = 'dirgha-form-7-view.png') {
  renderer.render(scene, camera);
  return new Promise((resolve, reject) => {
    renderer.domElement.toBlob((blob) => {
      if (!blob) return reject(new Error('PNG encoding failed'));
      download(blob, filename);
      resolve({ bytes: blob.size, filename });
    }, 'image/png');
  });
}

export function exportGLB(modelRoot, filename = 'dirgha-form-7.glb') {
  return new Promise((resolve, reject) => {
    const cloneTree = (src) => {
      const out = src.isMesh ? new src.constructor(src.geometry, src.material) : new THREE.Group();
      out.name = src.name;
      out.position.copy(src.position);
      out.quaternion.copy(src.quaternion);
      out.scale.copy(src.scale);
      out.visible = src.visible;
      for (const c of src.children) out.add(cloneTree(c));
      return out;
    };
    const clone = cloneTree(modelRoot);
    const exporter = new GLTFExporter();
    exporter.parse(
      clone,
      (buf) => {
        const blob = new Blob([buf], { type: 'model/gltf-binary' });
        download(blob, filename);
        resolve({ bytes: blob.size, filename });
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true, onlyVisible: true },
    );
  });
}

export function exportURDF(filename = 'dirgha_form_7.urdf') {
  const xml = generateURDF();
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  download(blob, filename);
  return Promise.resolve({ bytes: blob.size, filename });
}

export function exportMJCF(filename = 'dirgha_form_7.xml') {
  const xml = generateMJCF();
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  download(blob, filename);
  return Promise.resolve({ bytes: blob.size, filename });
}

export function exportROS2(filename = 'dirgha_form_7_ros2.zip') {
  return exportROS2Package(filename);
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
