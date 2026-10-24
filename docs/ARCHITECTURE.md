# Architecture

## Coordinate and unit conventions

| Context | Convention |
| :--- | :--- |
| Three.js scene | metres, +Y up, +X right, +Z toward viewer |
| Joint API (`pose`, `api.set*Angles`) | degrees |
| Internal kinematics | radians, converted at the `apply()` boundary |
| MuJoCo MJCF | metres, +Y up with gravity `0 -9.81 0`, degrees in XML (`angle="degree"`) |
| MuJoCo runtime API | degrees in/out; radians inside `qpos`/`ctrl` |
| Dataset | degrees for state/action, newtons for tension, ε dimensionless |

The scene is Y-up rather than MuJoCo's usual Z-up so the physics model can use
the same gravity vector as the visuals. The MJCF base is pitched −90° about X
so zero arm angles place the open palm face up.

## Boot sequence

`src/main.js`:

1. Renderer, scene, camera, `OrbitControls`, studio environment.
2. `loadData()` fetches `data/assembly.json` and `data/wires.json`.
3. `Model` builds the articulated node chain and merged geometry buckets.
4. `Wiring` routes 1,369 harness curves (dynamic subset is rebuilt per pose).
5. `Pose` binds 7 arm pivots and 20 hand pivots to scene nodes.
6. Controllers: `BiomechanicsEngine`, `IKSolver`, `ActuatorDynamics`,
   `CollisionChecker`, `BenchmarkEngine`, `GraspTrajectory`, `PhysicsScene`,
   `XRTeleop`, `DatasetRecorder`, `WristCamera`.
7. `createAPI()` exposes `window.__rebuild` for the UI and tests.
8. `initUI`, score player, telemetry HUD, picking listeners, render loop.

## Frame order (matters)

```
pose.update(dt)          tweens/gestures advance the commanded pose
modes.update(dt)
story.update(dt)         camera tour
trajectory.update(dt)    may overwrite pose with a planned frame
physics.update(dt)       reads the pose as servo targets, steps MuJoCo
recorder.tick(...)       samples the resulting state at 30 Hz
dynamics / biomechanics  derive telemetry from the current pose
pose.flush()             update matrices + rebuild dynamic wires
renderer.render()
```

`physics.update()` runs after `trajectory.update()` so a planned motion is what
the servos receive. The physics state is deliberately **not** copied back into
`pose`: doing so would make the position servos chase their own gravity sag.

## Joint identity

There is one canonical order, repeated in four places:

```
arm:  J1..J7
hand: index_abd, index_mcp, index_pip, index_dip,
      middle_…, ring_…, little_…,
      thumb_abd, thumb_cmc, thumb_mcp, thumb_ip
```

Sources of truth:

- `MJCF_HAND_JOINTS` in `src/robot-specs.js` (physics + URDF)
- `HAND_JOINT_NAMES` in `src/teleop/dataset-logger.js` (dataset)
- `Pose.handPivots` order from `data/assembly.json` (scene)
- `GESTURES` / `ARM_POSES` arrays in `src/pose.js`

`tests/unit/ros2.test.mjs` asserts the URDF, SRDF and controllers agree.
`tests/unit/physics.test.mjs` asserts every MJCF joint has a servo. If you add a
joint, update all four and the mapping tests together.

## Module boundaries

- **No DOM in physics/planning math.** `trajectory-player.js`, `hand-mapping.js`
  and `mujoco-runtime.js` are testable in Node without a browser.
- **No Three.js in the planner.** `GraspTrajectory` uses THREE only to pass a
  target to the IK solver; the plan itself is plain arrays and objects.
- **UI talks only to `api`.** `ui.js` never imports model internals.
- **Third-party runtime code is vendored.** Three.js lives in `vendor/`; the
  MuJoCo WASM is an optional 11 MB asset with a pinned CDN fallback.

## Physics bridge

`MujocoRuntime` compiles `generateMJCF()` and exposes:

- `setCommand(armDeg, handDeg)` — writes `qpos` and position-servo `ctrl`;
  coupled DIP/IP targets are derived so they do not fight the equality.
- `step(dt)` — fixed 2 ms substeps, max 24 per frame, accumulator clamped.
- `dropObject()` — places the free body 180 mm along the palm normal and zeroes
  its velocity.
- `getPalmRelativeState()` — object pose in the palm frame; the scene maps it
  through the visual palm's world transform.

The MJCF is a collision proxy. It is not a CAD twin and has not been identified
against hardware.

## Performance

- Scene: ~1,534 meshes and ~510 visible harnesses after merging; the render loop
  budgets < 16 ms on discrete GPUs.
- Physics: 500 Hz for 34 `qpos` / 27 actuators; single-threaded WASM. No
  `SharedArrayBuffer`, no cross-origin isolation needed.
- Dataset images: 192 px JPEG readback is opt-in; it stalls the pipeline for a
  few milliseconds per captured frame.
- The headless test environment uses SwiftShader and may run below 1 FPS; tests
  that depend on time advance the player directly.

## Extension recipes

**Add a hand joint**
1. Add the pivot to `data/assembly.json` and `Pose` (it reads the data file).
2. Add the joint to `MJCF_HAND_JOINTS` and the MJCF finger chain.
3. Add the name to `HAND_JOINT_NAMES` (dataset shape becomes 28).
4. Update `ros2-packager` group, controller list and joint limits.
5. Extend `mapHandJoints` and its tests.

**Change the drop object**
1. Edit the `grasp_object` body in `generateMJCF()`.
2. Keep the geom name `object_geom` and body name `grasp_object`.
3. Update `PhysicsScene`'s proxy geometry to match.
4. Re-run the drop-and-catch test.

**Add a trajectory stage**
1. Add the waypoint in `GraspTrajectory.planGrasp()` and `STAGE_META`.
2. Keep the ids stable; the UI and tests reference them.
3. Confirm `planToJSON` still produces 27-wide points.
