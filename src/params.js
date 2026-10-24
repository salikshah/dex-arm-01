// FORM / 01 — editable design parameters (single source of truth for the build).
// Units: meters, degrees. +Y up, right-handed. See EDITING.md.

export const PARAMS = {
  // Palm shell cross-sections (smooth ellipses): y, half-width rx, half-thickness rz, center offsets
  palmSections: [
    { y: 0.007, rx: 0.0215, rz: 0.0115, cx: 0.0,    cz: 0.001 },
    { y: 0.020, rx: 0.0255, rz: 0.0140, cx: -0.0005, cz: 0.002 },
    { y: 0.037, rx: 0.0318, rz: 0.0155, cx: -0.0018, cz: 0.0025 },
    { y: 0.055, rx: 0.0340, rz: 0.0158, cx: -0.0004, cz: 0.002 },
    { y: 0.072, rx: 0.0326, rz: 0.0134, cx: 0.0008,  cz: 0.001 },
    { y: 0.081, rx: 0.0298, rz: 0.0105, cx: -0.001,  cz: 0.001 },
  ],
  palmWall: 0.0011,
  fingerWall: 0.0008,

  fingers: {
    // lengths are EFFECTIVE (already include the styling scale on the finger root node)
    index:  { scale: 0.87, spread: 0.035 },
    middle: { scale: 0.90, spread: 0.0,  lengthBoost: 1.0 }, // lengthBoost: edit demo multiplies segment lengths
    ring:   { scale: 0.84, spread: -0.025 },
    little: { scale: 0.73, spread: -0.075 },
    thumb:  { scale: 0.96, spread: 0.61, oppose: 0.58 },
  },

  arm: {
    upperLength: 0.244, upperR0: 0.042, upperR1: 0.038,
    foreLength: 0.191,  foreR0: 0.035,  foreR1: 0.029,
    shellWall: 0.0024,
  },

  wiring: {
    density: 1.0,          // 0..1 — fraction of routes built (edit demo: 0.7)
    tubeSegmentsPerPoint: 1.6,
    radialSegments: 5,
    microBundleCount: 9,   // strands per dense-batch volume at density=1
  },

  skin: 'frost',           // default skin id (edit demo: 'glacier')
  shellDepth: 1.0,         // 0..1 — shell presence (density of the frost)
};

export const FINGER_ORDER = ['index', 'middle', 'ring', 'little', 'thumb'];
export const ARM_JOINTS = [
  { id: 'J1', axis: 'y', min: -150, max: 150 },
  { id: 'J2', axis: 'z', min: -95,  max: 95 },
  { id: 'J3', axis: 'y', min: -160, max: 160 },
  { id: 'J4', axis: 'z', min: 5,    max: 145 },
  { id: 'J5', axis: 'y', min: -160, max: 160 },
  { id: 'J6', axis: 'z', min: -145, max: 100 },
  { id: 'J7', axis: 'y', min: -150, max: 150 },
];
export const HAND_JOINT_LIMITS = {
  flexion: [-5, 95],
  spread: { index: [-30, 30], middle: [-30, 30], ring: [-30, 30], little: [-30, 30], thumb: [-85, 30] },
};
