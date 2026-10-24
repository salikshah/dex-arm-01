# Dirgha Form-7 — quick-swap forearm cartridge

Mechanical package for the 20-DoF tendon hand: a self-contained actuator
cartridge that leaves the hand in under two minutes, plus the wrist bracket and
a printed compliant distal phalanx.

> **Status: specification and parametric scripts, not a released design.**
> The CAD generators were authored without a local CAD kernel and have not been
> executed in CI. The packaging arithmetic in `cad/params.py` is checkable with
> plain Python, but no STEP file in this repository has been verified against a
> physical build. Read the checklist at the bottom before ordering anything.

| File | Purpose |
| :--- | :--- |
| `cad/params.py` | Single source of truth for dimensions; runs packaging checks without a CAD kernel |
| `cad/generate.py` | build123d scripts exporting three STEP solids |
| `bom.csv` | Prototype BOM, USD, quantity 1 |
| `README.md` | Architecture, sizing, assembly and verification |

## 1. Architecture

```
        wrist bayonet                    forearm tube (Ø75 × 2.4)
   ┌──────────┴──────────┐        ┌─────────────────────────────┐
   │  3-lug bracket       │◀──────▶│  cartridge (Ø69 × 118)      │
   │  AMT203 wrist encode │        │  ring A:  6 motors @ R13     │
   └──────────┬──────────┘        │  ring B: 14 motors @ R26     │
              │                   │  24 spools on two decks      │
        tendon bundle (24)         │  24 spring tensioners        │
              │                   │  24 AS5600 spool sensors     │
        ┌─────┴─────┐             └─────────────────────────────┘
        │ palm/fingers│
        └────────────┘
```

- **Distal mass:** palm, phalanges and tendon terminations only; all 20 motors
  and 24 spools ride in the forearm. Target distal mass ≈ 420 g.
- **Tendon lanes:** 24 total — 20 active (one per DoF) plus four spares for the
  thumb opposition pair and future tactile routing.
- **Transmission:** each spool is a capstan with a 5 mm pitch radius. A full
  100° MCP flexion needs ≈ 62 mm of line, i.e. 1.8 turns on an 11 mm spool.
- **Compliance:** DIP joints are not actuated independently. The printed
  phalanx uses a 1.2 mm PA12 living hinge, and the tendon routes across the
  PIP/DIP pair with a 0.67 coupling — matching the browser and MJCF models.
- **Serviceability:** the cartridge disconnects mechanically at the bayonet and
  electrically at a single 24-way connector. No tendon is cut during a swap.

## 2. Packaging arithmetic

`cad/params.py` enforces these checks:

| Check | Value | Limit |
| :--- | ---: | ---: |
| Cartridge radius | 34.5 mm | Ø69 inside Ø75 tube |
| Ring A: 6 motors at R13 | 13.6 mm pitch | > 8.6 mm motor envelope |
| Ring B: 14 motors at R26 | 11.7 mm pitch | > 8.6 mm motor envelope |
| Ring B radial extent | 30.3 mm | < 34.5 mm cartridge radius |
| Spool turns for 62 mm travel | 1.79 | < 18 turns |

Run it with any Python 3.10+ (no dependencies):

```bash
python cad/params.py
```

## 3. Actuation reality check

The original roadmap specified an 8 mm motor with a 16:1 spur gearbox. That
combination is **under-sized by roughly an order of magnitude** for the
published force target. The arithmetic:

```
fingertip force target F_tip      = 15 N at r_tip = 70 mm
required MCP torque  τ_joint      = F_tip × r_tip        = 1.05 N·m
tendon moment arm    r_tendon     = 9 mm
required cable force F_cable      = τ_joint / r_tendon   = 117 N
motor torque         τ_motor       = F_cable × r_spool / (G × η)
                                  = 117 × 0.005 / (16 × 0.75)
                                  = 48.8 mN·m
8 mm BLDC stall torque (typ.)      ≈ 1.5 mN·m
```

Even at a 64:1 reduction the 8 mm motor delivers ≈ 1.5–2 N at the fingertip,
which is fine for delicate pinch work but not for a 15 N power grasp. Three
honest options:

1. **Keep 8 mm + 64:1** and publish the hand as a *light-contact* platform
   (≈2 N fingertip, 20 DoF, 420 g). This is the BOM as shipped.
2. **Move to 13–16 mm motors** (≈10–20 mN·m) for 8–14 N fingertip force. The
   cartridge then cannot hold 20 motors in a Ø69 envelope; either enlarge the
   forearm to Ø90 or reduce to 16 DoF.
3. **Hybrid:** 16 mm motors for the four long fingers, 8 mm for the thumb and
   spread joints.

The software does not depend on the choice: joint limits and tendon moment arms
are parameters, and the MJCF servo gains are per-joint.

## 4. Tendon routing and friction

Every lane passes two wrist eyelets and one palm redirect. The capstan loss is:

```
T_distal = T_proximal · exp(−μ · Σθ)
```

With μ = 0.12 (PTFE-lined eyelets) and Σθ ≈ 1.4 rad over a full wrist sweep,
the loss is ≈ 15 %. The tensioner preload of 6 N keeps every lane above the
derailment threshold; AS5600 spool sensing closes the loop on the resulting
force error, but **wrist-pose-dependent force coupling remains** and is the
first thing to characterise on hardware.

## 5. Bill of materials

`bom.csv` totals **$5,028** at quantity 1, excluding labour and tooling. The
motor line is 45 % of the cost; the SLS parts are 13 %. Volume pricing at 50
units is expected to land near $3,400–$3,800.

## 6. Assembly sequence

1. Press the 681XZZ bearings into the spool decks; check < 20 µm axial play.
2. Mount motors and gearheads to the ring A/B pockets with M1.6 screws and
   threadlocker; route phase wires through the distributor windows.
3. Fit spools, tensioner carriages and AS5600 boards. With no tendon installed,
   verify each spool turns freely and the magnet stays centred over the sensor.
4. Terminate Dyneema with a figure-eight knot plus cyanoacrylate, then
   pre-stretch each lane at 20 N for 24 h before final tensioning.
5. Route lanes through the wrist eyelets, palm redirects and phalanx channels.
   Set preload to 6 N with the tensioner at mid-travel (±3 mm).
6. Close the bayonet (30° twist), connect the 24-way harness, and run the
   calibration sweep: 0°, 45°, 90° at each DoF, recording spool angle vs.
   commanded joint angle.
7. Fit the silicone pads last; their compression changes the effective tendon
   length by 0.3–0.8 mm.

## 7. Verification checklist (not yet performed)

- [ ] Execute `cad/generate.py` with build123d 0.9.x and inspect all three STEP
      files in a B-rep viewer (watertight, no self-intersections).
- [ ] Confirm the bayonet lug profile with an EDM quote; the script emits a
      simplified radial pocket, not the final cam profile.
- [ ] Tensile-test three tendon terminations to > 150 N.
- [ ] Cycle one finger 100,000 times at 8 N and measure creep and spool drift.
- [ ] Thermal soak the cartridge at 60 % duty for 30 min; measure motor case
      temperature (target < 85 °C) and chassis conduction path.
- [ ] Measure fingertip force with a load cell; compare against the 2 N estimate.
- [ ] Drop-test the hand from 1 m onto a steel plate; inspect phalanx hinges.

## 8. Known gaps

- No drawings, tolerances or GD&T yet; the STEP files are envelopes, not
  manufacturable definitions.
- The wrist bearing stack and the tendon pass-through geometry are unresolved.
- No EMI/ESD plan for 24 drivers in a carbon tube.
- Cable creep compensation assumes spool-side sensing; absolute distal encoders
  are not in the BOM.
- The Ø75 forearm is at the packaging limit for 20 motors; any motor upsizing
  forces a diameter change.

These gaps are deliberate: they are the work that remains before this can be
presented as a buildable open-source hardware release.
