// Self-built studio environment: softbox room -> PMREM, key/fill lights, floor.
import * as THREE from 'three';

export function buildEnvironment(renderer, scene) {
  // --- PMREM from a procedural softbox room (no external HDR) ---
  const room = new THREE.Scene();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(8, 8, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#505862'), side: THREE.BackSide }));
  room.add(box);
  const softboxes = [
    { size: [1.4, 4], pos: [-2, 1.5, 2], color: '#ffffff', i: 5 },
    { size: [0.28, 5], pos: [2, 0.8, 1], color: '#e9f3ff', i: 7 },
    { size: [3, 1.2], pos: [0, 3, -1], color: '#ffffff', i: 3.5 },
    { size: [2.5, 5], pos: [0, 0, -3], color: '#101722', i: 0.6 },
  ];
  for (const sb of softboxes) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(sb.size[0], sb.size[1]),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(sb.color).multiplyScalar(sb.i), side: THREE.DoubleSide }));
    m.position.set(...sb.pos);
    m.lookAt(0, 0, 0);
    room.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(room, 0.035);
  scene.environment = envRT.texture;
  pmrem.dispose();

  // --- lights (values from reference lighting spec) ---
  const hemi = new THREE.HemisphereLight(new THREE.Color('#ffffff'), new THREE.Color('#a7adb6'), 0.65);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(new THREE.Color('#fffaf3'), 3.1);
  key.position.set(-1.4, 2.3, 1.2);
  key.target.position.set(-0.15, 0.2, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 7;
  key.shadow.blurSamples = 8;
  key.shadow.normalBias = 0.0008;
  key.shadow.bias = -0.00015;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 5;
  key.shadow.camera.left = -1; key.shadow.camera.right = 1;
  key.shadow.camera.top = 1; key.shadow.camera.bottom = -1;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#dbe8fa'), 1.3);
  fill.position.set(1, 0.6, -1.2);
  scene.add(fill, fill.target);

  const rim = new THREE.DirectionalLight(new THREE.Color('#f4f8ff'), 2.1);
  rim.position.set(0.8, 1.6, -0.6);
  scene.add(rim, rim.target);

  // --- floor: shadow catcher + soft contact blob ---
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.ShadowMaterial({ color: new THREE.Color('#4d554f'), opacity: 0.09 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.0005;
  floor.receiveShadow = true;
  floor.name = 'floor';
  scene.add(floor);

  const contact = makeContactShadow();
  contact.position.y = 0.0003;
  contact.name = 'contactShadow';
  scene.add(contact);

  return { hemi, key, fill, rim, floor, contact };
}

function makeContactShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(52,64,55,0.24)');
  grad.addColorStop(0.45, 'rgba(52,64,55,0.12)');
  grad.addColorStop(1, 'rgba(52,64,55,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.43, 0.37),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
