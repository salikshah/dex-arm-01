// Materials: five transparent skins + opaque core materials + baked arm gradient.
import * as THREE from 'three';

export const SKINS = {
  frost: {
    label: 'Frost', swatch: 'linear-gradient(135deg,#bfc9c8,#e5eae5 55%,#fffdf5)',
    opacity: 0.58, color: '#f0f1f3', roughness: 0.27, transmission: 0.83, thickness: 0.0025,
    ior: 1.46, attenuationColor: '#e5e7ec', attenuationDistance: 0.055,
    clearcoatRoughness: 0.3, envMapIntensity: 0.7,
    gradient: ['#b6bcc5', '#f6f6f2'], alpha: [1, 0.94],
    core: ['#8b919b', '#dde0e5', '#8e9392', '#b3a184'],
  },
  crystal: {
    label: 'Crystal', swatch: 'linear-gradient(135deg,#fff,#d5e0e6 55%,#a5b5c1)',
    opacity: 0.36, color: '#ffffff', roughness: 0.018, transmission: 0.99, thickness: 0.0012,
    ior: 1.49, attenuationColor: '#e9f4ff', attenuationDistance: 0.2,
    clearcoatRoughness: 0.025, envMapIntensity: 0.85,
    gradient: ['#d7e1e8', '#ffffff'], alpha: [0.88, 0.62],
    core: ['#89959f', '#e2e9ef', '#8e9392', '#b3a184'],
  },
  smoke: {
    label: 'Smoke', swatch: 'linear-gradient(135deg,#25303b,#657580 55%,#e5edf0)',
    opacity: 0.42, color: '#edf0f2', roughness: 0.045, transmission: 0.96, thickness: 0.0015,
    ior: 1.54, attenuationColor: '#b6bfc4', attenuationDistance: 0.055,
    clearcoatRoughness: 0.06, envMapIntensity: 0.65,
    gradient: ['#242525', '#f4f7f9'], alpha: [1, 0.64],
    core: ['#535e69', '#dce1e5', '#926747', '#b7a17a'],
  },
  glacier: {
    label: 'Glacier', swatch: 'linear-gradient(135deg,#3b819e,#8ecae1 55%,#e4f8ff)',
    opacity: 0.49, color: '#a7e1fa', roughness: 0.035, transmission: 0.97, thickness: 0.0021,
    ior: 1.48, attenuationColor: '#4aadd7', attenuationDistance: 0.025,
    clearcoatRoughness: 0.035, envMapIntensity: 1.0,
    gradient: ['#31769a', '#d6f4ff'], alpha: [1, 0.8],
    core: ['#697e90', '#d7eafa', '#87939e', '#bbc8cf'],
  },
  amber: {
    label: 'Amber', swatch: 'linear-gradient(135deg,#673a20,#c08a45 55%,#f8dfab)',
    opacity: 0.55, color: '#f6cf91', roughness: 0.065, transmission: 0.94, thickness: 0.002,
    ior: 1.54, attenuationColor: '#c7893f', attenuationDistance: 0.018,
    clearcoatRoughness: 0.05, envMapIntensity: 0.75,
    gradient: ['#673d22', '#ffe6b2'], alpha: [1, 0.82],
    core: ['#766b5c', '#e4d8bc', '#af7842', '#d3b071'],
  },
};

const CORE_HEX = {
  ceramic: ['f1f0eb', 0.17, 0.26], aluminum: ['535e69', 0.82, 0.29], polished: ['dce1e5', 0.94, 0.18],
  graphite: ['161b21', 0.42, 0.34], rubber: ['15191d', 0.02, 0.74], copper: ['926747', 0.78, 0.32],
  gold: ['b7a17a', 0.78, 0.26], board: ['171e24', 0.18, 0.4], silicon: ['080d12', 0.18, 0.32],
  power: ['ab6844', 0.3, 0.45], data: ['497b80', 0.35, 0.43], signal: ['577fbc', 0.2, 0.48],
  sleeve: ['252c32', 0.12, 0.58], light: ['bedcca', 0.1, 0.28],
  wireRed: ['ad4b3f', 0.06, 0.58], wireBlack: ['30383e', 0.06, 0.58], wireIvory: ['d7ceb4', 0.06, 0.58],
  wireBlue: ['6086a9', 0.06, 0.58], wireGold: ['c2a65e', 0.06, 0.58], wireGreen: ['6d9278', 0.06, 0.58],
  connectorIvory: ['929993', 0.08, 0.44], braid: ['525f66', 0.15, 0.7], polyimide: ['a77838', 0.35, 0.38],
  softPearl: ['ced0c8', 0.04, 0.58], nailPearl: ['e6e7e1', 0.32, 0.21],
  microGraphite: ['25363d', 0.09, 0.48], microTeal: ['487873', 0.09, 0.48], microIvory: ['a9ada6', 0.09, 0.48],
  microBlue: ['486877', 0.09, 0.48], microAmber: ['a18b62', 0.15, 0.43], microSage: ['506f55', 0.09, 0.48],
  microCopper: ['995849', 0.09, 0.48],
  'label-BUS': ['39424a', 0.2, 0.5],
};

// per-skin core overrides: [frameMetal, paleMetal, dark, warmMetal]
const CORE_SKIN_MAP = {
  aluminum: 0, polished: 1, graphite: 2, copper: 3, gold: 3, wireGold: 3, microCopper: 3,
  microGraphite: 2, braid: 2, sleeve: 2, board: 2, silicon: 2,
};

export class Materials {
  constructor() {
    this.skinId = 'frost';
    this.shellDepth = 1;
    this.productAmt = 0;   // 0 = pure skin transmission, 1 = product frosting
    this.openAmt = 0;      // 0 = shell present, 1 = shell removed
    this.coreMats = new Map();
    this.shellMat = null;
    this.maskMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    this._gradUniforms = {
      gradA: { value: new THREE.Color('#b6bcc5') },
      gradB: { value: new THREE.Color('#f6f6f2') },
    };
    this._makeCore();
    this._makeShell();
  }

  _makeCore() {
    for (const [role, [hex, metal, rough]] of Object.entries(CORE_HEX)) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#' + hex), metalness: metal, roughness: rough,
        envMapIntensity: 0.9, name: 'core-' + role,
      });
      this.coreMats.set(role, m);
    }
  }

  _makeShell() {
    const s = SKINS[this.skinId];
    const mat = new THREE.MeshPhysicalMaterial({
      name: 'shell',
      color: new THREE.Color(s.color),
      metalness: 0, roughness: s.roughness,
      transmission: s.transmission, thickness: s.thickness, ior: s.ior,
      attenuationColor: new THREE.Color(s.attenuationColor), attenuationDistance: s.attenuationDistance,
      clearcoat: 0.6, clearcoatRoughness: s.clearcoatRoughness,
      envMapIntensity: s.envMapIntensity,
      transparent: true, opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // vertical gradient baked as per-vertex attribute "gradT" (straightened arm Y, 0..1)
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.gradA = this._gradUniforms.gradA;
      sh.uniforms.gradB = this._gradUniforms.gradB;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float gradT; varying float vGradT;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGradT = gradT;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 gradA; uniform vec3 gradB; varying float vGradT;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 gradCol = mix(gradA, gradB, clamp(vGradT, 0.0, 1.0));
          diffuseColor.rgb *= gradCol;`);
    };
    this.shellMat = mat;
    this.applySkin('frost', 1);
  }

  // Single source of truth for shell appearance:
  // skin params × concentration (shellDepth) × product frosting × open fade.
  updateShell() {
    const s = this._blendedSkin ?? SKINS[this.skinId];
    const m = this.shellMat;
    const d = this.shellDepth;
    const P = this.productAmt, O = this.openAmt;
    // base skin × concentration
    let transmission = s.transmission * (0.35 + 0.65 * d);
    let roughness = s.roughness;
    let opacity = s.opacity * (0.45 + 0.55 * d);
    let thickness = s.thickness * (0.5 + d);
    // product frosting on top
    transmission *= (1 - P) + P * 0.82;
    roughness = Math.min(0.6, roughness + P * 0.1);
    opacity = Math.min(1, opacity * (1 + P * 0.18));
    // open: fade out before hiding
    opacity *= (1 - O);
    transmission *= (1 - O * 0.85);
    m.transmission = Math.min(0.995, transmission);
    m.roughness = roughness;
    m.opacity = opacity;
    m.thickness = thickness;
    m.ior = s.ior;
    m.attenuationColor.set(s.attenuationColor);
    m.attenuationDistance = s.attenuationDistance;
    m.clearcoatRoughness = s.clearcoatRoughness;
    m.envMapIntensity = s.envMapIntensity;
    m.color.set(s.color);
    this.shellGone = O >= 0.985;
    m.needsUpdate = false;
  }

  applySkin(id, shellDepth = this.shellDepth) {
    this._blendedSkin = null;
    this.skinId = id;
    this.shellDepth = shellDepth;
    const s = SKINS[id];
    this.updateShell();
    this.shellMat.needsUpdate = true;
    this._gradUniforms.gradA.value.set(s.gradient[0]);
    this._gradUniforms.gradB.value.set(s.gradient[1]);
    // core tint overrides
    for (const [role, idx] of Object.entries(CORE_SKIN_MAP)) {
      const mat = this.coreMats.get(role);
      if (mat) mat.color.set(s.core[idx]);
    }
  }

  // Deterministic score-space tinting; reverse seek produces the same material.
  applySkinBlend(from, to, amount) {
    const a = SKINS[from], b = SKINS[to];
    const t = THREE.MathUtils.clamp(amount, 0, 1), s = {};
    for (const key of ['opacity', 'roughness', 'transmission', 'thickness', 'ior', 'attenuationDistance', 'clearcoatRoughness', 'envMapIntensity']) {
      s[key] = THREE.MathUtils.lerp(a[key], b[key], t);
    }
    for (const key of ['color', 'attenuationColor']) s[key] = new THREE.Color(a[key]).lerp(new THREE.Color(b[key]), t);
    this._blendedSkin = s;
    this.skinId = t < 0.5 ? from : to;
    this.updateShell();
    this._gradUniforms.gradA.value.set(a.gradient[0]).lerp(new THREE.Color(b.gradient[0]), t);
    this._gradUniforms.gradB.value.set(a.gradient[1]).lerp(new THREE.Color(b.gradient[1]), t);
    for (const [role, idx] of Object.entries(CORE_SKIN_MAP)) {
      this.coreMats.get(role)?.color.set(a.core[idx]).lerp(new THREE.Color(b.core[idx]), t);
    }
  }

  for(role) {
    if (role === 'clear-shell') return this.shellMat;
    return this.coreMats.get(role) || this.coreMats.get('aluminum');
  }
}
