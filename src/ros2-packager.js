// Dirgha Form-7: ROS 2 & MoveIt 2 Package Generator
// Generates a complete colcon-buildable ROS 2 Iron/Jazzy workspace package
// with URDF, SRDF, MoveIt 2 configs, ros2_controllers, RViz launch files, and MuJoCo MJCF.
// Pure vanilla JS with zero external dependencies (standard uncompressed ZIP store format).

import { generateURDF, generateMJCF } from './robot-specs.js';

// Minimal zero-dependency ZIP encoder (RFC 1950 / PKWARE spec)
function createZip() {
  const files = [];

  return {
    add(path, contentStr) {
      const encoder = new TextEncoder();
      const data = encoder.encode(contentStr);
      files.push({ path, data, crc: crc32(data) });
    },
    toBlob() {
      let totalLocalSize = 0;
      files.forEach((f) => {
        const nameBytes = new TextEncoder().encode(f.path);
        f.nameBytes = nameBytes;
        f.localHeaderOffset = totalLocalSize;
        // Local header: 30 bytes + name length + data length
        totalLocalSize += 30 + nameBytes.length + f.data.length;
      });

      let cdSize = 0;
      files.forEach((f) => {
        // Central directory entry: 46 bytes + name length
        cdSize += 46 + f.nameBytes.length;
      });

      const totalSize = totalLocalSize + cdSize + 22; // 22 bytes EOCD
      const buf = new Uint8Array(totalSize);
      const view = new DataView(buf.buffer);

      let offset = 0;

      // 1. Write Local File Headers + Data
      files.forEach((f) => {
        view.setUint32(offset, 0x04034b50, true); // Local header signature
        view.setUint16(offset + 4, 20, true);     // Version needed (2.0)
        view.setUint16(offset + 6, 0, true);      // Flags
        view.setUint16(offset + 8, 0, true);      // Compression: 0 (Store)
        view.setUint16(offset + 10, 0x4821, true); // Time: 09:01:02
        view.setUint16(offset + 12, 0x5d58, true); // Date: 2026-10-24
        view.setUint32(offset + 14, f.crc, true);  // CRC32
        view.setUint32(offset + 18, f.data.length, true); // Compressed size
        view.setUint32(offset + 22, f.data.length, true); // Uncompressed size
        view.setUint16(offset + 26, f.nameBytes.length, true); // Filename length
        view.setUint16(offset + 28, 0, true);     // Extra field length
        offset += 30;

        buf.set(f.nameBytes, offset);
        offset += f.nameBytes.length;

        buf.set(f.data, offset);
        offset += f.data.length;
      });

      const cdOffset = offset;

      // 2. Write Central Directory Headers
      files.forEach((f) => {
        view.setUint32(offset, 0x02014b50, true); // Central header signature
        view.setUint16(offset + 4, 20, true);     // Version made by
        view.setUint16(offset + 6, 20, true);     // Version needed
        view.setUint16(offset + 8, 0, true);      // Flags
        view.setUint16(offset + 10, 0, true);     // Compression: 0
        view.setUint16(offset + 12, 0x4821, true); // Time
        view.setUint16(offset + 14, 0x5d58, true); // Date
        view.setUint32(offset + 16, f.crc, true);  // CRC32
        view.setUint32(offset + 20, f.data.length, true); // Compressed size
        view.setUint32(offset + 24, f.data.length, true); // Uncompressed size
        view.setUint16(offset + 28, f.nameBytes.length, true); // Name len
        view.setUint16(offset + 30, 0, true);     // Extra len
        view.setUint16(offset + 32, 0, true);     // Comment len
        view.setUint16(offset + 34, 0, true);     // Disk start
        view.setUint16(offset + 36, 0, true);     // Internal file attr
        view.setUint32(offset + 38, 0, true);     // External file attr
        view.setUint32(offset + 42, f.localHeaderOffset, true); // Local header rel offset
        offset += 46;

        buf.set(f.nameBytes, offset);
        offset += f.nameBytes.length;
      });

      // 3. Write End of Central Directory Record (EOCD)
      view.setUint32(offset, 0x06054b50, true);     // EOCD signature
      view.setUint16(offset + 4, 0, true);          // Disk number
      view.setUint16(offset + 6, 0, true);          // Start disk
      view.setUint16(offset + 8, files.length, true); // Entries on disk
      view.setUint16(offset + 10, files.length, true); // Total entries
      view.setUint32(offset + 12, cdSize, true);    // Central dir size
      view.setUint32(offset + 16, cdOffset, true);  // Central dir offset
      view.setUint16(offset + 20, 0, true);         // Comment len

      return new Blob([buf], { type: 'application/zip' });
    }
  };
}

// Standard table-less CRC32
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function generateSRDF() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<robot name="dirgha_form_7">
  <!-- MoveIt 2 Planning Groups -->
  <group name="arm">
    <chain base_link="base_link" tip_link="link_7"/>
  </group>

  <group name="hand">
    <link name="palm_link"/>
    <link name="thumb_proximal"/>
    <link name="thumb_middle"/>
    <link name="thumb_distal"/>
    <link name="thumb_tip"/>
    <link name="index_proximal"/>
    <link name="index_middle"/>
    <link name="index_distal"/>
    <link name="index_tip"/>
    <link name="middle_proximal"/>
    <link name="middle_middle"/>
    <link name="middle_distal"/>
    <link name="middle_tip"/>
    <link name="ring_proximal"/>
    <link name="ring_middle"/>
    <link name="ring_distal"/>
    <link name="ring_tip"/>
    <link name="little_proximal"/>
    <link name="little_middle"/>
    <link name="little_distal"/>
    <link name="little_tip"/>
  </group>

  <group name="manipulator">
    <group name="arm"/>
    <group name="hand"/>
  </group>

  <!-- End-Effector Definition -->
  <end_effector name="hand_ee" parent_link="link_7" group="hand" parent_group="arm"/>

  <!-- Preset Group States -->
  <group_state name="home" group="arm">
    <joint name="J1" value="0"/>
    <joint name="J2" value="0"/>
    <joint name="J3" value="0"/>
    <joint name="J4" value="1.5708"/>
    <joint name="J5" value="0"/>
    <joint name="J6" value="-1.5708"/>
    <joint name="J7" value="0"/>
  </group_state>

  <group_state name="ready" group="arm">
    <joint name="J1" value="0.61"/>
    <joint name="J2" value="0.73"/>
    <joint name="J3" value="0.26"/>
    <joint name="J4" value="1.67"/>
    <joint name="J5" value="-0.35"/>
    <joint name="J6" value="-1.25"/>
    <joint name="J7" value="0.42"/>
  </group_state>

  <group_state name="open" group="hand">
    <joint name="index_abd" value="0"/>
    <joint name="index_mcp" value="0.14"/>
    <joint name="index_pip" value="0.10"/>
    <joint name="index_dip" value="0.07"/>
    <joint name="middle_abd" value="0"/>
    <joint name="middle_mcp" value="0.14"/>
    <joint name="middle_pip" value="0.10"/>
    <joint name="middle_dip" value="0.07"/>
    <joint name="ring_abd" value="0"/>
    <joint name="ring_mcp" value="0.14"/>
    <joint name="ring_pip" value="0.10"/>
    <joint name="ring_dip" value="0.07"/>
    <joint name="little_abd" value="0"/>
    <joint name="little_mcp" value="0.14"/>
    <joint name="little_pip" value="0.10"/>
    <joint name="little_dip" value="0.07"/>
    <joint name="thumb_abd" value="0"/>
    <joint name="thumb_cmc" value="0.14"/>
    <joint name="thumb_mcp" value="0.10"/>
    <joint name="thumb_ip" value="0.07"/>
  </group_state>

  <!-- Adjacent link collision exclusions -->
  <disable_collisions link1="base_link" link2="link_1" reason="Adjacent"/>
  <disable_collisions link1="link_1" link2="link_2" reason="Adjacent"/>
  <disable_collisions link1="link_2" link2="link_3" reason="Adjacent"/>
  <disable_collisions link1="link_3" link2="link_4" reason="Adjacent"/>
  <disable_collisions link1="link_4" link2="link_5" reason="Adjacent"/>
  <disable_collisions link1="link_5" link2="link_6" reason="Adjacent"/>
  <disable_collisions link1="link_6" link2="link_7" reason="Adjacent"/>
  <disable_collisions link1="link_7" link2="palm_link" reason="Adjacent"/>
</robot>
`;
}

export function generateJointLimitsYAML() {
  return `# Joint Limits specification for Dirgha Form-7 (Harmonic Drive Strain-Wave limits)
joint_limits:
  J1:
    has_velocity_limits: true
    max_velocity: 3.14159 # 180 deg/s
    has_acceleration_limits: true
    max_acceleration: 6.28
  J2:
    has_velocity_limits: true
    max_velocity: 3.14159
    has_acceleration_limits: true
    max_acceleration: 6.28
  J3:
    has_velocity_limits: true
    max_velocity: 3.84
    has_acceleration_limits: true
    max_acceleration: 7.68
  J4:
    has_velocity_limits: true
    max_velocity: 3.84
    has_acceleration_limits: true
    max_acceleration: 7.68
  J5:
    has_velocity_limits: true
    max_velocity: 5.23
    has_acceleration_limits: true
    max_acceleration: 10.47
  J6:
    has_velocity_limits: true
    max_velocity: 5.23
    has_acceleration_limits: true
    max_acceleration: 10.47
  J7:
    has_velocity_limits: true
    max_velocity: 6.28
    has_acceleration_limits: true
    max_acceleration: 12.56
`;
}

export function generateControllersYAML() {
  return `controller_manager:
  ros__parameters:
    update_rate: 500 # Hz

    arm_controller:
      type: joint_trajectory_controller/JointTrajectoryController

    hand_controller:
      type: position_controllers/JointGroupPositionController

    joint_state_broadcaster:
      type: joint_state_broadcaster/JointStateBroadcaster

arm_controller:
  ros__parameters:
    joints:
      - J1
      - J2
      - J3
      - J4
      - J5
      - J6
      - J7
    command_interfaces:
      - position
    state_interfaces:
      - position
      - velocity

hand_controller:
  ros__parameters:
    joints:
      - index_abd
      - index_mcp
      - index_pip
      - index_dip
      - middle_abd
      - middle_mcp
      - middle_pip
      - middle_dip
      - ring_abd
      - ring_mcp
      - ring_pip
      - ring_dip
      - little_abd
      - little_mcp
      - little_pip
      - little_dip
      - thumb_abd
      - thumb_cmc
      - thumb_mcp
      - thumb_ip
`;
}

export function generatePackageXML() {
  return `<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>dirgha_form_7_description</name>
  <version>1.0.0</version>
  <description>Dirgha Form-7 Sovereign 7-Axis Manipulator and 20-DoF Dexterous Tendon Hand Description Package</description>
  <maintainer email="salik@salikshah.com">Salik Shah</maintainer>
  <license>Apache-2.0</license>

  <buildtool_depend>ament_cmake</buildtool_depend>
  <exec_depend>robot_state_publisher</exec_depend>
  <exec_depend>joint_state_publisher_gui</exec_depend>
  <exec_depend>rviz2</exec_depend>
  <exec_depend>moveit</exec_depend>
  <exec_depend>ros2_control</exec_depend>
  <exec_depend>xacro</exec_depend>

  <export>
    <build_type>ament_cmake</build_type>
  </export>
</package>
`;
}

export function generateCMakeLists() {
  return `cmake_minimum_required(VERSION 3.8)
project(dirgha_form_7_description)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)

install(
  DIRECTORY urdf config launch mujoco
  DESTINATION share/\${PROJECT_NAME}
)

ament_package()
`;
}

export function generateLaunchPy() {
  return `import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    pkg_share = get_package_share_directory('dirgha_form_7_description')
    urdf_path = os.path.join(pkg_share, 'urdf', 'dirgha_form_7.urdf')

    with open(urdf_path, 'r') as infp:
        robot_desc = infp.read()

    return LaunchDescription([
        Node(
            package='robot_state_publisher',
            executable='robot_state_publisher',
            name='robot_state_publisher',
            output='screen',
            parameters=[{'robot_description': robot_desc}]
        ),
        Node(
            package='joint_state_publisher_gui',
            executable='joint_state_publisher_gui',
            name='joint_state_publisher_gui',
            output='screen'
        ),
        Node(
            package='rviz2',
            executable='rviz2',
            name='rviz2',
            output='screen'
        )
    ])
`;
}

export function generateReadme() {
  return `# Dirgha Form-7 ROS 2 & MoveIt 2 Package

Autonomous 7-Axis Manipulator + 20-DoF Tendon Hand.
Architected and engineered by Salik Shah (https://salikshah.com/code/index.html).

## Features
- Complete 7-DoF kinematic tree with Harmonic Drive gear limits.
- 20-DoF Dexterous tendon hand with extensor-flexor moment arms.
- MoveIt 2 kinematic planning groups: \`arm\`, \`hand\`, \`manipulator\`.
- DeepMind MuJoCo MJCF model in \`mujoco/dirgha_form_7.xml\`.

## Build & Launch
\`\`\`bash
# 1. Source ROS 2
source /opt/ros/iron/setup.bash

# 2. Build in your ROS 2 workspace
cd ~/ros2_ws
colcon build --packages-select dirgha_form_7_description
source install/setup.bash

# 3. Launch in RViz 2
ros2 launch dirgha_form_7_description view_robot.launch.py
\`\`\`
`;
}

export function exportROS2Package(filename = 'dirgha_form_7_ros2.zip') {
  const zip = createZip();
  const pkg = 'dirgha_form_7_description/';

  zip.add(pkg + 'package.xml', generatePackageXML());
  zip.add(pkg + 'CMakeLists.txt', generateCMakeLists());
  zip.add(pkg + 'README.md', generateReadme());
  zip.add(pkg + 'urdf/dirgha_form_7.urdf', generateURDF());
  zip.add(pkg + 'config/dirgha_form_7.srdf', generateSRDF());
  zip.add(pkg + 'config/joint_limits.yaml', generateJointLimitsYAML());
  zip.add(pkg + 'config/ros2_controllers.yaml', generateControllersYAML());
  zip.add(pkg + 'launch/view_robot.launch.py', generateLaunchPy());
  zip.add(pkg + 'mujoco/dirgha_form_7.xml', generateMJCF());

  const blob = zip.toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);

  return Promise.resolve({ bytes: blob.size, filename });
}
