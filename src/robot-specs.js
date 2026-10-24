// DEX ARM 01: Kinematic specifications, URDF, and MuJoCo XML generator.
// Calibrated with standard harmonic drive strain-wave reducers and 20-DoF tendon finger kinematics.
//
// Convention note: this model is built along +Y with X lateral and Z as the
// palm normal, and gravity acts along -Y. That keeps the exported MJCF
// consistent with the browser scene (Y-up) instead of MuJoCo's usual Z-up.

export const ROBOT_METRICS = {
  name: 'DEX ARM 01',
  modelId: 'DEX-ARM-01',
  degreesOfFreedom: 27, // 7 Arm + 20 Hand
  payloadContinuousKg: 5.0,
  payloadPeakKg: 8.0,
  repeatabilityMm: 0.03,
  totalWeightKg: 4.85,
  busProtocol: 'EtherCAT / CAN-FD 1Mbps',
  controlLoopHz: 1000,
  armJoints: [
    { id: 'J1', name: 'Base Yaw', axis: [0, 1, 0], limitDeg: [-180, 180], maxTorqueNm: 120, ratedTorqueNm: 42, maxVelRadS: 3.14 },
    { id: 'J2', name: 'Shoulder Pitch', axis: [0, 0, 1], limitDeg: [-120, 120], maxTorqueNm: 120, ratedTorqueNm: 42, maxVelRadS: 3.14 },
    { id: 'J3', name: 'Shoulder Roll', axis: [0, 1, 0], limitDeg: [-170, 170], maxTorqueNm: 80, ratedTorqueNm: 28, maxVelRadS: 4.18 },
    { id: 'J4', name: 'Elbow Pitch', axis: [0, 0, 1], limitDeg: [-150, 150], maxTorqueNm: 80, ratedTorqueNm: 28, maxVelRadS: 4.18 },
    { id: 'J5', name: 'Forearm Roll', axis: [0, 1, 0], limitDeg: [-170, 170], maxTorqueNm: 35, ratedTorqueNm: 14, maxVelRadS: 5.23 },
    { id: 'J6', name: 'Wrist Pitch', axis: [0, 0, 1], limitDeg: [-110, 110], maxTorqueNm: 35, ratedTorqueNm: 14, maxVelRadS: 5.23 },
    { id: 'J7', name: 'Wrist Roll', axis: [0, 1, 0], limitDeg: [-180, 180], maxTorqueNm: 20, ratedTorqueNm: 8, maxVelRadS: 6.28 },
  ],
  fingers: [
    { id: 'thumb', name: 'Thumb', joints: 4, tendonLimitN: 45 },
    { id: 'index', name: 'Index Finger', joints: 4, tendonLimitN: 40 },
    { id: 'middle', name: 'Middle Finger', joints: 4, tendonLimitN: 40 },
    { id: 'ring', name: 'Ring Finger', joints: 4, tendonLimitN: 35 },
    { id: 'little', name: 'Little Finger', joints: 4, tendonLimitN: 30 },
  ]
};

// The 20 hand joints in the same order as `Pose.handAngles` (4 per finger,
// abduction → mcp → pip → dip) so physics and visual state map 1:1.
export const MJCF_HAND_JOINTS = [
  { finger: 'index', name: 'index_abd', kind: 'abduction' },
  { finger: 'index', name: 'index_mcp', kind: 'flexion' },
  { finger: 'index', name: 'index_pip', kind: 'flexion' },
  { finger: 'index', name: 'index_dip', kind: 'flexion' },
  { finger: 'middle', name: 'middle_abd', kind: 'abduction' },
  { finger: 'middle', name: 'middle_mcp', kind: 'flexion' },
  { finger: 'middle', name: 'middle_pip', kind: 'flexion' },
  { finger: 'middle', name: 'middle_dip', kind: 'flexion' },
  { finger: 'ring', name: 'ring_abd', kind: 'abduction' },
  { finger: 'ring', name: 'ring_mcp', kind: 'flexion' },
  { finger: 'ring', name: 'ring_pip', kind: 'flexion' },
  { finger: 'ring', name: 'ring_dip', kind: 'flexion' },
  { finger: 'little', name: 'little_abd', kind: 'abduction' },
  { finger: 'little', name: 'little_mcp', kind: 'flexion' },
  { finger: 'little', name: 'little_pip', kind: 'flexion' },
  { finger: 'little', name: 'little_dip', kind: 'flexion' },
  { finger: 'thumb', name: 'thumb_abd', kind: 'abduction' },
  { finger: 'thumb', name: 'thumb_cmc', kind: 'flexion' },
  { finger: 'thumb', name: 'thumb_mcp', kind: 'flexion' },
  { finger: 'thumb', name: 'thumb_ip', kind: 'flexion' },
];

export const MJCF_ARM_JOINTS = ROBOT_METRICS.armJoints.map((j) => j.id);
export const MJCF_ALL_JOINTS = [...MJCF_ARM_JOINTS, ...MJCF_HAND_JOINTS.map((j) => j.name)];

// (parent → child) offset, in metres, for the seven arm links.
const ARM_OFFSETS = [0.08, 0.09, 0.12, 0.14, 0.11, 0.09, 0.07, 0.06];
const ARM_RADII = [0.05, 0.045, 0.04, 0.038, 0.035, 0.032, 0.030];

const FINGER_GEOMETRY = {
  index:  { x: -0.025, scale: 1.00, abd: 25 },
  middle: { x: -0.008, scale: 1.06, abd: 25 },
  ring:   { x: 0.008, scale: 0.98, abd: 25 },
  little: { x: 0.024, scale: 0.86, abd: 30 },
};

const FINGER_LENGTHS = [0.034, 0.023, 0.018];

function fingerXml(id) {
  const g = FINGER_GEOMETRY[id];
  const [l1, l2, l3] = FINGER_LENGTHS.map((l) => (l * g.scale).toFixed(4));
  const r = (0.0068 * Math.max(0.8, g.scale)).toFixed(4);
  return `
      <body name="${id}_abd" pos="${g.x} 0.066 0">
        <joint name="${id}_abd" axis="0 0 1" range="${-g.abd} ${g.abd}"/>
        <geom type="capsule" fromto="0 0 0 0 0.008 0" size="${r}" rgba="0.86 0.89 0.93 1"/>
        <body name="${id}_mcp" pos="0 0.008 0">
          <joint name="${id}_mcp" axis="1 0 0" range="-10 95"/>
          <geom type="capsule" fromto="0 0 0 0 ${l1} 0" size="${r}" rgba="0.9 0.92 0.95 1"/>
          <body name="${id}_pip" pos="0 ${l1} 0">
            <joint name="${id}_pip" axis="1 0 0" range="0 100"/>
            <geom type="capsule" fromto="0 0 0 0 ${l2} 0" size="${(Number(r) * 0.92).toFixed(4)}" rgba="0.9 0.92 0.95 1"/>
            <body name="${id}_dip" pos="0 ${l2} 0">
              <joint name="${id}_dip" axis="1 0 0" range="0 80"/>
              <geom type="capsule" fromto="0 0 0 0 ${l3} 0" size="${(Number(r) * 0.84).toFixed(4)}" rgba="0.93 0.95 0.97 1"/>
              <site name="${id}_tip" pos="0 ${l3} 0" size="0.004"/>
            </body>
          </body>
        </body>
      </body>`;
}

function thumbXml() {
  return `
      <body name="thumb_abd" pos="-0.030 0.024 0.010" quat="0.9063 0 0 -0.4226">
        <joint name="thumb_abd" axis="0 0 1" range="-35 40"/>
        <geom type="capsule" fromto="0 0 0 0 0.012 0" size="0.0072" rgba="0.86 0.89 0.93 1"/>
        <body name="thumb_cmc" pos="0 0.012 0">
          <joint name="thumb_cmc" axis="0 1 0" range="-20 60"/>
          <geom type="capsule" fromto="0 0 0 0 0.030 0" size="0.0072" rgba="0.9 0.92 0.95 1"/>
          <body name="thumb_mcp" pos="0 0.030 0">
            <joint name="thumb_mcp" axis="1 0 0" range="-15 80"/>
            <geom type="capsule" fromto="0 0 0 0 0.026 0" size="0.0066" rgba="0.9 0.92 0.95 1"/>
            <body name="thumb_ip" pos="0 0.026 0">
              <joint name="thumb_ip" axis="1 0 0" range="-10 70"/>
              <geom type="capsule" fromto="0 0 0 0 0.022 0" size="0.0060" rgba="0.93 0.95 0.97 1"/>
              <site name="thumb_tip" pos="0 0.022 0" size="0.004"/>
            </body>
          </body>
        </body>
      </body>`;
}

export function generateURDF() {
  const D2R = Math.PI / 180;
  let urdf = `<?xml version="1.0" encoding="utf-8"?>
<!-- =================================================================================== -->
<!-- |    DEX ARM 01 Dexterous Manipulator URDF Model                                    | -->
<!-- |    7-Axis Arm with 20-DoF Tendon-Driven Anthropomorphic Hand                       | -->
<!-- |    Generated for ROS 2 / MoveIt 2 / NVIDIA Isaac Sim / PyBullet                   | -->
<!-- =================================================================================== -->
<robot name="dex_arm_01">

  <material name="matte_dark">
    <color rgba="0.12 0.12 0.14 1.0"/>
  </material>
  <material name="frost_shell">
    <color rgba="0.92 0.94 0.96 0.6"/>
  </material>
  <material name="anodized_aluminum">
    <color rgba="0.65 0.68 0.72 1.0"/>
  </material>

  <link name="world"/>

  <joint name="world_fixed_joint" type="fixed">
    <parent link="world"/>
    <child link="base_link"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
  </joint>

  <link name="base_link">
    <inertial>
      <mass value="1.8"/>
      <origin xyz="0 0.04 0"/>
      <inertia ixx="0.004" ixy="0" ixz="0" iyy="0.005" iyz="0" izz="0.004"/>
    </inertial>
    <visual>
      <geometry>
        <cylinder radius="0.065" length="0.08"/>
      </geometry>
      <material name="matte_dark"/>
    </visual>
    <collision>
      <geometry>
        <cylinder radius="0.065" length="0.08"/>
      </geometry>
    </collision>
  </link>
`;

  // Arm joints
  const linkOffsets = [
    [0, 0.08, 0],
    [0, 0.09, 0],
    [0, 0.12, 0],
    [0, 0.14, 0],
    [0, 0.11, 0],
    [0, 0.09, 0],
    [0, 0.07, 0],
  ];

  ROBOT_METRICS.armJoints.forEach((j, i) => {
    const parent = i === 0 ? 'base_link' : `link_${i}`;
    const child = `link_${i + 1}`;
    const [x, y, z] = linkOffsets[i];
    const [ax, ay, az] = j.axis;
    const lower = (j.limitDeg[0] * D2R).toFixed(4);
    const upper = (j.limitDeg[1] * D2R).toFixed(4);

    urdf += `
  <joint name="${j.id}" type="revolute">
    <parent link="${parent}"/>
    <child link="${child}"/>
    <origin xyz="${x} ${y} ${z}" rpy="0 0 0"/>
    <axis xyz="${ax} ${ay} ${az}"/>
    <limit lower="${lower}" upper="${upper}" effort="${j.maxTorqueNm}" velocity="${j.maxVelRadS}"/>
    <dynamics damping="0.5" friction="0.1"/>
  </joint>

  <link name="${child}">
    <inertial>
      <mass value="${(1.2 - i * 0.12).toFixed(2)}"/>
      <origin xyz="0 0.04 0"/>
      <inertia ixx="0.002" ixy="0" ixz="0" iyy="0.002" iyz="0" izz="0.001"/>
    </inertial>
    <visual>
      <geometry>
        <cylinder radius="${(0.045 - i * 0.003).toFixed(3)}" length="0.08"/>
      </geometry>
      <material name="anodized_aluminum"/>
    </visual>
  </link>
`;
  });

  // Hand root
  urdf += `
  <joint name="hand_mount_joint" type="fixed">
    <parent link="link_7"/>
    <child link="palm_link"/>
    <origin xyz="0 0.06 0" rpy="0 0 0"/>
  </joint>

  <link name="palm_link">
    <inertial>
      <mass value="0.65"/>
      <origin xyz="0 0.04 0"/>
      <inertia ixx="0.0008" ixy="0" ixz="0" iyy="0.0006" iyz="0" izz="0.0004"/>
    </inertial>
    <visual>
      <geometry>
        <box size="0.075 0.085 0.028"/>
      </geometry>
      <material name="frost_shell"/>
    </visual>
  </link>
`;

  // Fingers: four joints per digit so the URDF, MJCF, controller and dataset
  // all expose the same 20 names (abd, mcp, pip, dip).
  const fingerDefs = [
    {
      id: 'thumb', name: 'Thumb',
      pos: [-0.025, 0.020, 0.015],
      lengths: [0.030, 0.026, 0.022],
      joints: ['thumb_abd', 'thumb_cmc', 'thumb_mcp', 'thumb_ip'],
      links: ['thumb_proximal', 'thumb_middle', 'thumb_distal', 'thumb_tip'],
      axes: ['0 0 1', '0 1 0', '1 0 0', '1 0 0'],
      limits: [[-0.61, 0.70], [-0.35, 1.05], [-0.26, 1.40], [-0.17, 1.22]],
      effort: 1.2,
    },
    {
      id: 'index', name: 'Index Finger',
      pos: [-0.022, 0.085, 0],
      lengths: [0.034, 0.023, 0.018],
      joints: ['index_abd', 'index_mcp', 'index_pip', 'index_dip'],
      links: ['index_proximal', 'index_middle', 'index_distal', 'index_tip'],
      axes: ['0 0 1', '1 0 0', '1 0 0', '1 0 0'],
      limits: [[-0.52, 0.52], [-0.17, 1.66], [0, 1.75], [0, 1.40]],
      effort: 1.5,
    },
    {
      id: 'middle', name: 'Middle Finger',
      pos: [0.0, 0.088, 0],
      lengths: [0.036, 0.024, 0.019],
      joints: ['middle_abd', 'middle_mcp', 'middle_pip', 'middle_dip'],
      links: ['middle_proximal', 'middle_middle', 'middle_distal', 'middle_tip'],
      axes: ['0 0 1', '1 0 0', '1 0 0', '1 0 0'],
      limits: [[-0.52, 0.52], [-0.17, 1.66], [0, 1.75], [0, 1.40]],
      effort: 1.5,
    },
    {
      id: 'ring', name: 'Ring Finger',
      pos: [0.020, 0.084, 0],
      lengths: [0.033, 0.023, 0.018],
      joints: ['ring_abd', 'ring_mcp', 'ring_pip', 'ring_dip'],
      links: ['ring_proximal', 'ring_middle', 'ring_distal', 'ring_tip'],
      axes: ['0 0 1', '1 0 0', '1 0 0', '1 0 0'],
      limits: [[-0.52, 0.52], [-0.17, 1.66], [0, 1.75], [0, 1.40]],
      effort: 1.4,
    },
    {
      id: 'little', name: 'Little Finger',
      pos: [0.038, 0.076, 0],
      lengths: [0.029, 0.020, 0.016],
      joints: ['little_abd', 'little_mcp', 'little_pip', 'little_dip'],
      links: ['little_proximal', 'little_middle', 'little_distal', 'little_tip'],
      axes: ['0 0 1', '1 0 0', '1 0 0', '1 0 0'],
      limits: [[-0.52, 0.52], [-0.17, 1.66], [0, 1.75], [0, 1.40]],
      effort: 1.2,
    },
  ];

  for (const f of fingerDefs) {
    const [fx, fy, fz] = f.pos;
    urdf += `\n  <!-- Finger: ${f.name} -->`;
    for (let i = 0; i < f.joints.length; i++) {
      const parent = i === 0 ? 'palm_link' : f.links[i - 1];
      const child = f.links[i];
      const length = f.lengths[i] || f.lengths[f.lengths.length - 1];
      const [lower, upper] = f.limits[i];
      urdf += `
  <joint name="${f.joints[i]}" type="revolute">
    <parent link="${parent}"/>
    <child link="${child}"/>
    <origin xyz="${i === 0 ? `${fx} ${fy} ${fz}` : '0 ' + f.lengths[i - 1] + ' 0'}" rpy="0 0 0"/>
    <axis xyz="${f.axes[i]}"/>
    <limit lower="${lower.toFixed(4)}" upper="${upper.toFixed(4)}" effort="${f.effort}" velocity="8.0"/>
    <dynamics damping="0.02" friction="0.01"/>
  </joint>

  <link name="${child}">
    <inertial>
      <mass value="0.020"/>
      <origin xyz="0 ${(length / 2).toFixed(4)} 0"/>
      <inertia ixx="0.000004" ixy="0" ixz="0" iyy="0.000006" iyz="0" izz="0.000004"/>
    </inertial>
    <visual>
      <geometry>
        <box size="0.012 ${length.toFixed(4)} 0.010"/>
      </geometry>
      <material name="frost_shell"/>
    </visual>
    <collision>
      <geometry>
        <box size="0.012 ${length.toFixed(4)} 0.010"/>
      </geometry>
    </collision>
  </link>
`;
    }
  }

  urdf += `\n</robot>`;
  return urdf;
}

// Full 27-DoF MuJoCo model: 7 arm hinges, 20 hand hinges, position servos,
// DIP/PIP extensor coupling, a free YCB-scale object, and a grasp floor.
// `object` lets benchmark runs swap the grasp target (radius, halfLength, mass,
// friction) without editing the model by hand. Defaults are the demo cylinder.
export function generateMJCF({ object = {} } = {}) {
  const obj = {
    radius: 0.038,
    halfLength: 0.050,
    mass: 0.414,
    friction: null,
    ...object,
  };
  // Solid-cylinder principal moments; MuJoCo cylinders spin about local Z.
  const radial = (obj.mass * (3 * obj.radius ** 2 + 4 * obj.halfLength ** 2)) / 12;
  const axial = (obj.mass * obj.radius ** 2) / 2;
  const objectFriction = obj.friction ? ` friction="${obj.friction} 0.02 0.001"` : '';

  let armXml = '';
  ROBOT_METRICS.armJoints.forEach((j, i) => {
    const offsetY = ARM_OFFSETS[i];
    const radius = ARM_RADII[i];
    const length = ARM_OFFSETS[i + 1];
    const [ax, ay, az] = j.axis;
    armXml += `
        <body name="link_${i + 1}" pos="0 ${offsetY} 0">
          <joint name="${j.id}" axis="${ax} ${ay} ${az}" range="${j.limitDeg[0]} ${j.limitDeg[1]}"/>
          <geom type="capsule" fromto="0 0 0 0 ${length} 0" size="${radius}" rgba="0.72 0.75 0.79 1"/>`;
  });
  armXml += `
          <body name="palm" pos="0 0.06 0">
            <geom type="box" size="0.036 0.040 0.013" pos="0 0.030 0" rgba="0.90 0.92 0.95 1"/>
            <site name="palm_site" pos="0 0.030 0" size="0.005"/>
            <site name="grasp_site" pos="0 0.052 0.030" size="0.004" rgba="0.2 0.8 0.6 1"/>
${['index', 'middle', 'ring', 'little'].map(fingerXml).join('')}
${thumbXml()}
          </body>`;
  // Close the seven link bodies; the palm is closed above and `base` in the template.
  for (let i = 0; i < 7; i++) armXml += '\n        </body>';

  const actuators = MJCF_ALL_JOINTS.map((name) => {
    const isArm = MJCF_ARM_JOINTS.includes(name);
    const kp = isArm ? 320 : 0.9;
    const kv = isArm ? 40 : 0.08;
    return `    <position name="act_${name}" joint="${name}" kp="${kp}" kv="${kv}" ctrlrange="-3.2 3.2"/>`;
  }).join('\n');

  const couplings = [
    ...['index', 'middle', 'ring', 'little'].map(
      (f) => `    <joint joint1="${f}_dip" joint2="${f}_pip" polycoef="0 0.67 0 0 0"/>`,
    ),
    '    <joint joint1="thumb_ip" joint2="thumb_mcp" polycoef="0 0.72 0 0 0"/>',
  ].join('\n');

  return `<mujoco model="dex_arm_01">
  <!-- Generated by the DEX ARM 01 scene. 27 DoF: 7 arm + 20 hand. -->
  <!-- Y-up convention, gravity along -Y to match the browser scene. -->
  <compiler angle="degree" coordinate="local" autolimits="true"/>
  <option timestep="0.002" integrator="implicitfast" gravity="0 -9.81 0" cone="elliptic" impratio="10"/>

  <default>
    <joint damping="0.35" armature="0.01" frictionloss="0.01"/>
    <geom friction="0.95 0.02 0.001" solref="0.006 1" solimp="0.92 0.96 0.001" condim="4"/>
    <position kp="0.9" kv="0.08"/>
  </default>

  <worldbody>
    <light directional="true" pos="0 0.5 1" dir="0 -0.4 -1"/>
    <!-- Floor: a plane rotated so its normal points along +Y (above the surface). -->
    <geom name="floor" type="plane" size="2 2 0.1" quat="0.707107 -0.707107 0 0" rgba="0.93 0.94 0.96 1"/>

    <!-- Base pitched -90° about X so the open palm faces +Y (up) and objects
         dropped under -Y gravity land inside the grasp rather than sliding past. -->
    <body name="base" pos="0 0.90 0" quat="0.707107 -0.707107 0 0">
      <geom type="cylinder" size="0.065 0.04" rgba="0.16 0.17 0.20 1"/>
${armXml}
    </body>

    <!-- Free object: YCB 002 Master Chef Can scale (414 g, 76 mm dia).
         Parked clear of the arm; the runtime re-seats it above the palm on reset. -->
    <body name="grasp_object" pos="0.35 0.25 0.30">
      <freejoint name="object_free"/>
      <inertial pos="0 0 0" mass="${obj.mass.toFixed(5)}" diaginertia="${radial.toExponential(6)} ${radial.toExponential(6)} ${axial.toExponential(6)}"/>
      <geom name="object_geom" type="cylinder" size="${obj.radius.toFixed(5)} ${obj.halfLength.toFixed(5)}" rgba="0.72 0.45 0.15 1"${objectFriction}/>
    </body>
  </worldbody>

  <actuator>
${actuators}
  </actuator>

  <equality>
${couplings}
  </equality>

  <sensor>
    <framepos name="palm_pos" objtype="body" objname="palm"/>
    <framequat name="palm_quat" objtype="body" objname="palm"/>
    <framepos name="object_pos" objtype="body" objname="grasp_object"/>
  </sensor>
</mujoco>`;
}
