# Grasp benchmark

`npm run bench` runs a randomised, headless MuJoCo assessment of the Form-7
collision model and writes a dated JSON + Markdown report to `bench/results/`.

```bash
npm run bench -- --episodes 100 --seed 7
```

Requires the MuJoCo devDependency (`npm install`), which also backs the physics
unit tests. No browser, Python or GPU is involved.

## Protocol

Each episode compiles a fresh MJCF with a randomised grasp target, so the object
geometry, inertia and friction are genuinely different per trial rather than
resampled states of one model.

| Parameter | Range |
| :--- | :--- |
| Cylinder radius | 30–42 mm |
| Cylinder half-length | 40–56 mm |
| Mass | 0.20–0.45 kg |
| Contact friction | 0.55–1.05 |
| Release offset, palm X | ±12 mm |
| Release offset, palm Y | −4…+16 mm |

The hand is commanded to the open pose, the object is released from 180 mm above
the palm and settles for 500 ms at 500 Hz, the fingers close over 600 ms
(20 interpolated steps), and the grasp is held for 400 ms. "Success" requires
all three of:

1. the object centre stays inside a 110 mm envelope around the palm origin,
2. it stays above 850 mm (i.e. it never reaches the floor), and
3. it moves less than 30 mm between the end of closure and the end of the hold.

A fixed seed (`--seed`) makes a run reproducible: the harness uses a seeded
PRNG, so `--episodes 100 --seed 7` reproduces the published numbers exactly.

## Published result (seed 7, 100 episodes)

| Metric | Value |
| :--- | :--- |
| Retained grasps | **47 / 100** (47.0 %, 95 % CI 37.5–56.7 %) |
| Median hold radius (successful) | 66.1 mm |
| Closure impact, p50 / p90 / max | 16.1 / 135.0 / 163.4 g |
| Success with lateral offset ≤ 4 mm | 29 / 35 |
| Success with lateral offset > 4 mm | 18 / 65 |

The result is dominated by release position, not by mass or friction. Binned by
lateral offset, success falls from 12/13 at 0–2 mm to 1/16 at 10–12 mm. In other
words this hand's simulated grasp is close to *centred-only*: the collision
proxy has a flat palm and thin finger capsules with no compliant pads, so an
object released off-centre tips over the palm edge before the fingers can
surround it.

## What this does and does not show

**Does:** that the 27-DoF MJCF compiles and simulates repeatably; that the
collision model can hold the nominal target; that its lateral tolerance is a few
millimetres in simulation; and that closing on an off-centre object can launch
it (impacts above 100 g appear only in failures).

**Does not:** validate the visual mesh, the tendon routing, or any hardware.
The collision geometry is a capsule-and-box proxy, far simpler than the render
model, and there is no actuator saturation, tendon stretch, or skin compliance.
Force sensing is not reported because the WASM `mj_contactForce` binding returns
zeros for this model; the harness reports object acceleration instead. A hardware
success rate requires building the hand — see `hardware/dirgha-form-7/README.md`.

## Regenerating the report

Reports are committed alongside their data so a claim can be traced to a run.
Re-running with the same seed overwrites the same dated files; use a different
`--seed` for an independent sample.
