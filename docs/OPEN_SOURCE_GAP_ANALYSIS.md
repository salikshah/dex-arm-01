# Open-source readiness: what the reference projects ship, and what is still missing here

Survey date: **24 October 2026**. Licence and star counts come from the GitHub
REST API at that time; "what it ships" comes from each project's README and
documentation. Star counts are a popularity snapshot, not a quality score.

## 1. The reference set

| Project | Licence | Stars | What it actually ships |
| :--- | :--- | ---: | :--- |
| [leap-hand/LEAP_Hand_Sim](https://github.com/leap-hand/LEAP_Hand_Sim) | MIT | 214 | URDF, IsaacGym environment, sim2real deployment code for a 16-DoF low-cost hand |
| [google-deepmind/mujoco_menagerie](https://github.com/google-deepmind/mujoco_menagerie) | per-model (API reports `NOASSERTION`) | 4,258 | Curated MJCF models with meshes; each model directory has README, LICENSE and CHANGELOG |
| [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) | Apache-2.0 | 15,845 | The simulator, C/C++/Python/JS bindings, tests, docs, release engineering |
| [NVlabs/dex-ycb-toolkit](https://github.com/NVlabs/dex-ycb-toolkit) | GPL-3.0 (dataset: CC BY-NC 4.0) | 213 | Evaluation and visualisation toolkit for the DexYCB grasp dataset |
| [huggingface/lerobot](https://github.com/huggingface/lerobot) | Apache-2.0 | 28,436 | Dataset format, loaders, policies, hardware integrations, training scripts |
| [openvla/openvla](https://github.com/openvla/openvla) | MIT | 7,206 | 7B VLA model code and fine-tuning recipes for Open X-Embodiment |
| [moveit/moveit2](https://github.com/moveit/moveit2) | BSD-3-Clause | 2,084 | ROS 2 motion planning, IK, collision checking, MoveIt Setup Assistant |
| [CyanHaze/Awesome-Dexterous-Hands](https://github.com/CyanHaze/Awesome-Dexterous-Hands) | CC-BY-4.0 | 46 | Curated index of hands, datasets, simulators and papers |

Two patterns stand out:

1. **The credible hardware repos ship models plus a reproducible environment.**
   LEAP's value is not the CAD alone; it is URDF + tuned sim + deployment code
   that someone else can run. Menagerie's value is per-model provenance: every
   directory carries its own licence and README.
2. **The credible learning repos ship data contracts, not demos.** LeRobot's
   format and OpenVLA's OXE/RLDS pipeline are the reason other people can reuse
   them. A pretty viewer without a dataset or a benchmark result is not
   contributable in the same way.

## 2. Gap matrix

Status key: **yes** = present and verified in this repo, **partial** = present
but unverified or incomplete, **no** = missing.

| Expectation | Reference example | Before this pass | Now | Still missing |
| :--- | :--- | :--- | :--- | :--- |
| Clear licence | LEAP (MIT), MuJoCo (Apache-2.0) | **no** | **yes** — MIT + third-party notices | Hardware licence decision (MIT vs CERN-OHL-S) |
| README with honest scope | Menagerie per-model README | **no** | **yes** — "real vs simulated" table | A dated changelog and release notes |
| One-command run | MuJoCo docs | **no** | **yes** — `npm install && npm run dev` | A hosted static build independent of the portfolio site |
| Model assets | Menagerie MJCF + meshes | **partial** — URDF and MJCF generated, but the URDF hand had 10 joints and the SRDF/controller names did not exist | **yes** — 27-joint URDF and MJCF, cross-checked by tests | Meshes (STL/OBJ) for the collision model |
| Simulator environment | LEAP IsaacGym | **no** | **partial** — MuJoCo WASM in the browser, 27 servos, coupling, drop test | A headless Python MuJoCo env for RL, domain randomisation |
| Tests | MuJoCo, LeRobot | **no** | **yes** — 22 unit tests + 22 browser checks | Coverage reporting, flake budget, regression fixtures |
| CI | MuJoCo, MoveIt | **no** | **partial** — unit CI on Node 22/24; browser job manual | Nightly browser run on a GPU runner |
| Contribution docs | LeRobot, MoveIt | **no** | **yes** — CONTRIBUTING, CoC, SECURITY | Issue/PR templates, good-first-issue labels |
| Citation | Most research repos | **no** | **yes** — CITATION.cff | A DOI / archived release (Zenodo) |
| Calibration data | LEAP sim2real | **no** | **no** | Joint zero offsets, tendon stiffness, measured torque constants |
| Benchmark results | DexYCB / LEAP papers | **no** | **partial** — seeded 100-trial MuJoCo drop benchmark, 47 % retention with CI, per-episode JSON in `bench/results/` | Hardware trials; per-object breakdown; contact-force logs |
| Dataset | LeRobot / OXE | **no** | **partial** — recorder writes v3.0 metadata, converter emits a v3.0 dataset (parquet + MP4) verified against the live Hub schema by `scripts/verify_lerobot_dataset.py` | A real recorded episode set, hosted, with a datasheet; a `LeRobotDataset` load in a `lerobot` env |
| Teleoperation validation | LEAP + Quest/AVP rigs | **no** | **partial** — WebXR path implemented, mock + unit tests only | Test on Vision Pro and Quest 3; latency and drift numbers |
| Hardware package | LEAP CAD + BOM | **no** | **partial** — cartridge spec, BOM, build123d scripts | Executed STEP files, drawings, tolerance stack, physical build |
| Reproducible exports | Menagerie | **partial** — ZIP export existed but was internally inconsistent | **yes** — URDF/SRDF/controller consistency tested | `ros2 launch` smoke test in a ROS container |
| Safety case | Industrial repos | **no** | **no** | E-stop, watchdog, current limits, pinch-force limits, risk assessment |

## 3. Blockers before calling this open-source ready

These are not polish items; each one can invalidate a claim.

1. **Asset provenance.** `data/assembly.json` and `data/wires.json` (1.4 MB)
   came from the portfolio build. Their authorship and licence must be stated
   before the repository is public. Until then, publish the code and the
   generators, and keep the baked scene data out of the release or document it
   as original work.
2. **No standalone repository.** The app currently lives under
   `website/work/dexterous-arm/` with links to a personal site and parent
   folders. A public repo needs its own root, its own `package.json`, and a
   working demo deployed from that root.
3. **No measured performance.** Every force, temperature and ε value is
   computed from a model. The README says so, which is necessary but not
   sufficient: a credible release needs at least one measured comparison
   (e.g. fingertip force vs. commanded flexion, or MuJoCo drop height vs. a
   high-speed video).
4. **No real dataset.** The recorder works, but "compatible with LeRobot" means
   someone can load a published episode. Record and host a small set with a
   datasheet (10 episodes, 3 objects, 30 Hz, known camera).
5. **Hardware claims outrun the design.** The 8 mm motor / 15 N target is
   internally inconsistent (see `hardware/dirgha-form-7/README.md §3`). Either
   restate the force target or change the actuator, and do it in public.

## 4. What is genuinely differentiated

- **Zero-build browser stack.** No bundler, no server, no Python: a researcher
  can open the page and inspect IK, tendon and grasp telemetry live. The
  MuJoCo WASM path adds real contact physics without a native install.
- **One joint contract across four representations.** Scene, MuJoCo, URDF and
  dataset now share 27 names and are tested for agreement. That is the part
  most hand projects get wrong.
- **Physics and dataset in the same tab.** A teleoperated or scripted episode
  can be recorded with contact state and exported without leaving the browser,
  which is a short path from demo to LeRobot dataset.
- **Honest failure surfaces.** The interface exposes singularity warnings,
  clearance, thermal saturation and grasp quality, rather than only a pretty
  render.

## 5. Prioritised plan

### P0 — before public announcement (1–2 weeks)

| Task | Acceptance criterion |
| :--- | :--- |
| Standalone repo + deploy | Clone → `npm ci` → `npm run dev` works from the repo root; a public URL serves that build |
| Asset provenance | `data/` has a LICENSE/README stating authorship, or is replaced by a generator |
| README truth pass | Every numeric claim traces to code or a measurement; no orphan claims |
| Release v0.1.0 | Tag, changelog, Zenodo DOI, CITATION updated |
| Issue templates | Bug, hardware-claim and dataset-report templates |

### P1 — first credible research artifact (4–6 weeks)

| Task | Acceptance criterion |
| :--- | :--- |
| ~~MuJoCo benchmark harness~~ | Done in Node, not Python: `npm run bench` runs 100 seeded randomised drops and publishes a success rate (47 %, 95 % CI 37.5–56.7 %); contact force unavailable in the WASM binding, so impacts are reported as object acceleration |
| Hardware truth | Fingertip force measured on one finger; BOM and target force reconciled |
| Real dataset | 30+ episodes recorded in-browser (wrist camera render, no phone needed), hosted on the Hub, loaded once with `LeRobotDataset` |
| XR validation | Vision Pro or Quest 3 session; report latency, tracking loss and drift |
| ROS 2 smoke test | `ros2 launch` brings up RViz + controllers in a container in CI |

### P2 — contribution magnet (2–3 months)

| Task | Acceptance criterion |
| :--- | :--- |
| Sim2real / calibration tooling | Scripted calibration sweep with residuals < 2° |
| Tactile upgrade | GelSight or magnetic skin with slip detection, logged in the same dataset schema |
| Policy baseline | Behaviour-cloning baseline on the recorded episodes with a reproducible eval |
| Hardware release | Executed STEP + drawings + tolerance stack + one built hand |

## 6. Readiness score

| Dimension | Score | Why |
| :--- | :---: | :--- |
| Code quality and modularity | 4/5 | Clear boundaries, testable math; a few pre-existing rough edges remain |
| Documentation | 4/5 | Honest and complete for software; hardware still proposal-grade |
| Reproducibility | 3/5 | Software yes; physics model is a proxy; CAD unexecuted |
| Evidence | 2/5 | One reproducible simulated benchmark with a published failure mode; no hardware measurement |
| Community readiness | 4/5 | Licence, CI, templates-ready policies, contribution guide |
| Safety / industrial readiness | 1/5 | No e-stop or risk case; must not be presented as production hardware |

The software is close to publishable. The claims are not yet backed by
measurement, and that is the difference between a good portfolio piece and a
repository other robotics people can build on.
