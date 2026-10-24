# Credits & Sources

**DEX ARM 01** stands on the shoulders of open-source robotics, deep learning research, and web standards. This document provides complete attribution for all foundational algorithms, simulation engines, datasets, libraries, and publications that made this project possible.

---

## 1. Project Leadership & Engineering

- **Salik Shah** ([salikshah.com](https://salikshah.com)) — Lead architect and systems engineer:
  - Articulated 27-DoF forward kinematic hierarchy and WebGL scene graph.
  - 7-DoF Damped Least Squares (DLS) inverse kinematics with null-space limit centering.
  - Biomechanical 24×20 tendon moment-arm matrix and Ferrari-Canny GWS $\varepsilon$ grasp quality heuristic.
  - Browser-native MuJoCo WebAssembly bridge, position servos, and 500 Hz contact dynamics loop.
  - Six-stage quintic minimum-jerk trajectory planner and MoveIt-compatible export.
  - WebXR spatial hand teleoperation runtime and LeRobot v3.0 episode recorder.
  - Zero-dependency in-memory ROS 2 Iron/Jazzy workspace package generator.

---

## 2. Conceptual Genesis & Initial Visual Design

- [**@crystalsssup**](https://x.com/crystalsssup/status/2113684128734625948) & **Kimi 3.1 Pro** — Initial conceptual design and exploratory 3D aesthetic:
  - Provided the original visual concept and exploratory renders for the robotic hand and arm styling.
  - This visual concept was subsequently adopted as the aesthetic foundation and completely re-engineered by Salik Shah into a mathematically rigorous, physically accurate, and scientifically validated robotics research platform (introducing true forward/inverse kinematics trees, 500 Hz DeepMind MuJoCo WASM contact physics, 24×20 tendon moment-arm matrices, Ferrari-Canny grasp quality metrics, LeRobot ACT imitation learning, and ROS 2/MoveIt 2 export).

---

## 3. Upstream Physics & Simulation

- **MuJoCo (Multi-Joint dynamics with Contact)**  
  *Google DeepMind* — [mujoco.org](https://mujoco.org) | [github.com/google-deepmind/mujoco](https://github.com/google-deepmind/mujoco)  
  *License:* Apache-2.0  
  *Role:* Official `@mujoco/mujoco` WebAssembly JavaScript runtime running client-side at 500 Hz (2 ms timestep), computing rigid-body contacts, elliptic friction cones, position servos, and tendon equality constraints.  
  *Citation:*  
  ```bibtex
  @inproceedings{todorov2012mujoco,
    title={MuJoCo: A physics engine for model-based control},
    author={Todorov, Emanuel and Echeveste, Tom and Tassa, Yuval},
    booktitle={IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS)},
    pages={5026--5033},
    year={2012}
  }
  ```

---

## 4. Robot Learning & Imitation Policies

- **LeRobot (State-of-the-art Machine Learning for Real-World Robotics)**  
  *Hugging Face* — [github.com/huggingface/lerobot](https://github.com/huggingface/lerobot)  
  *License:* Apache-2.0  
  *Role:* Data loader schemas (v3.0 standard), training pipeline, Hugging Face Hub dataset publishing, and pre-trained policy checkpoints.  
  *Citation:*  
  ```bibtex
  @misc{cadene2024lerobot,
    author = {Cadene, Remi and Alibert, Simon and Soare, Alexander and Gallouedec, Quentin and Zouitine, Adil and Palma, Steven and Kooijmans, Pepijn and Aractingi, Michel and Shukor, Mustafa and Aubakirova, Dana and Russi, Martino and Capuano, Francesco and Pascal, Caroline and Choghari, Jade and Moss, Jess and Wolf, Thomas},
    title = {LeRobot: State-of-the-art Machine Learning for Real-World Robotics in Pytorch},
    howpublished = {\url{https://github.com/huggingface/lerobot}},
    year = {2024}
  }
  ```

- **Action Chunking with Transformers (ACT)**  
  *Tony Z. Zhao, Vikash Kumar, Sergey Levine, Chelsea Finn* — [arxiv.org/abs/2304.13705](https://arxiv.org/abs/2304.13705)  
  *Role:* Imitation learning model architecture that predicts action trajectory chunks from teleoperated or simulated states.  
  *Citation:*  
  ```bibtex
  @inproceedings{zhao2023learning,
    title={Learning fine-grained bimanual manipulation with low-cost hardware},
    author={Zhao, Tony Z and Kumar, Vikash and Levine, Sergey and Finn, Chelsea},
    booktitle={Robotics: Science and Systems (RSS)},
    year={2023}
  }
  ```

---

## 5. 3D Web Graphics & Math

- **Three.js**  
  *Ricardo Cabello (Mr.doob) and the Three.js Community* — [threejs.org](https://threejs.org)  
  *License:* MIT License  
  *Role:* WebGL 3D rendering engine, hierarchical scenegraph, lighting physics, camera controls, `OrbitControls`, `BufferGeometryUtils`, and `GLTFExporter`.

---

## 6. Kinematics, Control & Optimization Algorithms

- **Yoshikawa Manipulability Measure & Ellipsoid**  
  *Tsuneo Yoshikawa*  
  *Citation:*  
  ```bibtex
  @article{yoshikawa1985manipulability,
    title={Manipulability of robotic mechanisms},
    author={Yoshikawa, Tsuneo},
    journal={The International Journal of Robotics Research},
    volume={4},
    number={2},
    pages={3--9},
    year={1985}
  }
  ```

- **Singularity-Robust Inverse Kinematics (Damped Least Squares / Levenberg-Marquardt)**  
  *S. Chiaverini, B. Siciliano, and O. Egeland*  
  *Citation:*  
  ```bibtex
  @article{chiaverini1994review,
    title={Review of the damped least-squares inverse kinematics with experiments on an industrial robot manipulator},
    author={Chiaverini, Stefano and Siciliano, Bruno and Egeland, Olav},
    journal={IEEE Transactions on Control Systems Technology},
    volume={2},
    number={2},
    pages={123--134},
    year={1994}
  }
  ```

- **Grasp Wrench Space (GWS) & Force-Closure Quality ($\varepsilon$-metric)**  
  *C. Ferrari and J. Canny*  
  *Citation:*  
  ```bibtex
  @inproceedings{ferrari1992planning,
    title={Planning optimal grasps},
    author={Ferrari, Carlo and Canny, John},
    booktitle={IEEE International Conference on Robotics and Automation (ICRA)},
    pages={2290--2295},
    year={1992}
  }
  ```

- **Minimum-Jerk Trajectory Planning (Quintic Polynomial Profile)**  
  *T. Flash and N. Hogan*  
  *Citation:*  
  ```bibtex
  @article{flash1985coordination,
    title={The coordination of arm movements: an experimentally confirmed mathematical model},
    author={Flash, Tamar and Hogan, Neville},
    journal={Journal of Neuroscience},
    volume={5},
    number={7},
    pages={1688--1703},
    year={1985}
  }
  ```

---

## 7. Benchmarks & Manipulation Props

- **Dex-YCB & The YCB Object and Model Set**  
  *Berk Calli, Aaron Walsman, Arjun Singh, Siddhartha Srinivasa, Pieter Abbeel, Aaron M. Dollar*  
  *Citation:*  
  ```bibtex
  @article{calli2015benchmarking,
    title={Benchmarking in manipulation research: The YCB object and model set and benchmarking protocols},
    author={Calli, Berk and Walsman, Aaron and Singh, Arjun and Srinivasa, Siddhartha and Abbeel, Pieter and Dollar, Aaron M},
    journal={IEEE Robotics \& Automation Magazine},
    volume={22},
    number={3},
    pages={36--52},
    year={2015}
  }
  ```

---

## 8. Robotics Middleware & Standards

- **ROS 2 (Robot Operating System)**  
  *Open Source Robotics Foundation (OSRF)* — [ros.org](https://www.ros.org)  
  *Role:* Package layout, URDF (Unified Robot Description Format), and `robot_state_publisher`.

- **MoveIt 2**  
  *PickNik Robotics & MoveIt Community* — [moveit.picknik.ai](https://moveit.picknik.ai)  
  *Role:* Semantic Robot Description Format (SRDF), kinematic planning groups, and joint limit specifications.

- **WebXR Device API & WebXR Hand Input Module**  
  *W3C Immersive Web Working Group* — [w3.org/TR/webxr-hand-input-1/](https://www.w3.org/TR/webxr-hand-input-1/)  
  *Role:* Spatial joint tracking standard for VR/AR headsets (Meta Quest 3, Apple Vision Pro).

---

## 9. Typography & Design Tokens

- **Literata** — TypeTogether ([Google Fonts](https://fonts.google.com/specimen/Literata)), licensed under SIL Open Font License (OFL-1.1).
- **Instrument Sans** — Instrument ([Google Fonts](https://fonts.google.com/specimen/Instrument+Sans)), licensed under SIL Open Font License (OFL-1.1).
- **JetBrains Mono** — JetBrains ([jetbrains.com/lp/mono](https://www.jetbrains.com/lp/mono/)), licensed under SIL Open Font License (OFL-1.1).
- **Aamukh / Salik Shah Design System** — Editorial warm linen (`#f4efe4`), deep obsidian (`#14120f`), terracotta cinnabar (`#963d2b` / `#d47a5d`), and antique gold accents.
