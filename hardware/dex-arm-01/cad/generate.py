"""Generate STEP models for the DEX ARM 01 quick-swap forearm cartridge.

Requires build123d (we recommend a pinned virtual environment):

    python -m venv .venv
    .venv/Scripts/activate        # Windows
    pip install "build123d==0.9.*"
    python generate.py --out ../../build

Outputs:
    forearm_cartridge_core.step
    pulley_bracket_wrist.step
    finger_distal_compliant_phalanx.step

NOTE: these scripts were authored without a local CAD kernel and have not been
executed in this repository's CI. Treat the exported solids as a reviewed
starting point, not as released drawings. See the hardware README for the
verification checklist.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from build123d import (
    Box,
    BuildPart,
    Cylinder,
    Locations,
    Mode,
    PolarLocations,
    export_step,
)

from params import PARAMS


def cartridge_core():
    """Ø69 mm actuator cartridge: hollow core, two motor rings, bayonet lugs."""
    p = PARAMS
    with BuildPart() as core:
        Cylinder(p.cartridge_radius, p.cartridge_length)

        # Central tendon pass-through / wiring spine.
        with Locations((0, 0, 0)):
            Cylinder(7.5, p.cartridge_length + 2, mode=Mode.SUBTRACT)

        # Ring A: 6 motors.
        with PolarLocations(p.motor_ring_a_radius, p.motor_ring_a_count):
            with Locations((0, 0, p.cartridge_length / 2 - p.motor_pocket_depth / 2)):
                Cylinder(p.motor_envelope / 2, p.motor_pocket_depth, mode=Mode.SUBTRACT)

        # Ring B: 14 motors, rotated half a pitch to nest between ring A pockets.
        with PolarLocations(
            p.motor_ring_b_radius,
            p.motor_ring_b_count,
            start_angle=180 / p.motor_ring_b_count,
        ):
            with Locations((0, 0, p.cartridge_length / 2 - p.motor_pocket_depth / 2)):
                Cylinder(p.motor_envelope / 2, p.motor_pocket_depth, mode=Mode.SUBTRACT)

        # Distributor windows for the 24 tendon lanes.
        with PolarLocations(p.cartridge_radius - 6.0, 12):
            with Locations((0, 0, -p.cartridge_length / 2 + 5)):
                Cylinder(2.2, 10, mode=Mode.SUBTRACT)

        # Three bayonet lugs at the distal face.
        with PolarLocations(p.cartridge_radius - 3.0, p.bayonet_lug_count):
            with Locations((0, 0, p.cartridge_length / 2 - p.bayonet_lug_height / 2)):
                Box(p.bayonet_lug_width, 6, p.bayonet_lug_height, mode=Mode.ADD)

        # Indexing flat so the cartridge only seats one way.
        with Locations((0, p.cartridge_radius, 0)):
            Box(16, 8, p.cartridge_length, mode=Mode.SUBTRACT)

    return core.part


def wrist_bracket():
    """Wrist-side bearing bracket that receives the bayonet cartridge."""
    p = PARAMS
    with BuildPart() as bracket:
        Box(p.wrist_bracket_width, p.wrist_bracket_height, p.wrist_bracket_thickness)

        # Central bearing bore.
        with Locations((0, 0, 0)):
            Cylinder(p.wrist_bearing_bore / 2, p.wrist_bracket_thickness + 2, mode=Mode.SUBTRACT)

        # Four M2 clearance holes on a 36 x 28 mm pattern.
        for x in (-18, 18):
            for y in (-14, 14):
                with Locations((x, y, 0)):
                    Cylinder(1.1, p.wrist_bracket_thickness + 2, mode=Mode.SUBTRACT)

        # Bayonet cam slots (simplified as radial pockets; final profile is EDM).
        with PolarLocations(26, p.bayonet_lug_count):
            with Locations((0, 0, 0)):
                Box(p.bayonet_lug_width, 4.2, p.wrist_bracket_thickness + 2, mode=Mode.SUBTRACT)

        # Tendon window.
        with Locations((0, 12, 0)):
            Box(22, 12, p.wrist_bracket_thickness + 2, mode=Mode.SUBTRACT)

        # Wrist bearing bosses.
        with Locations((0, 0, p.wrist_bracket_thickness / 2 + 2)):
            Cylinder(p.wrist_bearing_bore / 2 + 3, 4)

    return bracket.part


def distal_phalanx():
    """SLS PA12 distal phalanx with a living hinge and tendon channel."""
    p = PARAMS
    with BuildPart() as phalanx:
        Box(p.phalanx_length, p.phalanx_width, p.phalanx_height)

        # Proximal hinge barrel.
        with Locations((-p.phalanx_length / 2 + 3.0, 0, 0)):
            Cylinder(p.phalanx_height / 2, p.phalanx_width, rotation=(90, 0, 0))

        # Two living-hinge slots leave a 1.2 mm PA12 web in the middle.
        for y in (-p.phalanx_width / 2 + 2.4, p.phalanx_width / 2 - 2.4):
            with Locations((p.phalanx_length / 2 - 4.0, y, 0)):
                Box(p.hinge_slot_width, 6.0, p.phalanx_height + 2, mode=Mode.SUBTRACT)

        # 0.6 mm tendon channel along the palmar face.
        with Locations((0, 0, -p.phalanx_height / 2 + 0.9)):
            Box(p.phalanx_length - 4, p.tendon_diameter + 0.2, 0.8, mode=Mode.SUBTRACT)

        # Distal pad pocket.
        with Locations((p.phalanx_length / 2 - 3.0, 0, p.phalanx_height / 2 - 0.8)):
            Box(4.5, p.phalanx_width - 2, 1.2, mode=Mode.SUBTRACT)

        # M1.6 cross-pin bore for the flexor anchor.
        with Locations((0, 0, 0)):
            Cylinder(0.85, p.phalanx_width + 2, rotation=(90, 0, 0), mode=Mode.SUBTRACT)

    return phalanx.part


def describe(name, part, path):
    bbox = part.bounding_box()
    print(
        f"{name}: volume {part.volume / 1000:.1f} cm3 | "
        f"bbox {bbox.size.X:.1f} x {bbox.size.Y:.1f} x {bbox.size.Z:.1f} mm -> {path.name}"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="../../build", help="output directory for STEP files")
    args = parser.parse_args()

    errors = PARAMS.validate()
    if errors:
        raise SystemExit("packaging errors:\n- " + "\n- ".join(errors))

    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    parts = {
        "forearm_cartridge_core.step": cartridge_core(),
        "pulley_bracket_wrist.step": wrist_bracket(),
        "finger_distal_compliant_phalanx.step": distal_phalanx(),
    }
    for filename, part in parts.items():
        path = out / filename
        export_step(part, str(path))
        describe(filename.removesuffix(".step"), part, path)


if __name__ == "__main__":
    main()
