"""Dirgha Form-7 quick-swap forearm cartridge — parametric dimensions.

Pure Python (no CAD kernel required). Run `python params.py` to validate the
packaging arithmetic before generating solids:

    forearm bore      75.0 mm
    motor envelope     8.6 mm  (ECX SPEED 8 M + 64:1 gearhead, cable exit)
    two-ring layout   ring A radius 13.0 mm (6), ring B radius 26.0 mm (14)
    pitch             13.6 mm / 11.7 mm  (> 8.6 mm envelope)
    radial check      26.0 + 4.3 = 30.3 mm  (< 34.5 mm cartridge radius)

All dimensions in millimetres unless noted.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class CartridgeParams:
    # Envelope
    forearm_outer_diameter: float = 75.0
    forearm_wall: float = 2.4
    cartridge_clearance: float = 0.6
    cartridge_length: float = 118.0

    # Actuation: 20 finger motors + 4 spare tendon lanes
    motor_count: int = 20
    motor_diameter: float = 8.0
    motor_length: float = 16.8
    motor_envelope: float = 8.6
    motor_ring_a_count: int = 6
    motor_ring_a_radius: float = 13.0
    motor_ring_b_radius: float = 26.0
    motor_pocket_depth: float = 18.0

    # Spools and tendon
    spool_count: int = 24
    spool_diameter: float = 11.0
    spool_width: float = 7.5
    tendon_diameter: float = 0.4
    tendon_pitch_radius: float = 5.0
    tendon_travel: float = 62.0  # mm of line for full 100 deg MCP flexion

    # Tensioner
    tensioner_travel: float = 6.0
    tensioner_spring_rate: float = 0.35  # N/mm
    tensioner_preload: float = 6.0  # N

    # Bayonet interface
    bayonet_lug_count: int = 3
    bayonet_lug_width: float = 9.0
    bayonet_lug_height: float = 3.0
    bayonet_rotation: float = 30.0  # degrees of twist to lock

    # Wrist / distal
    wrist_bracket_width: float = 46.0
    wrist_bracket_height: float = 38.0
    wrist_bracket_thickness: float = 4.0
    wrist_bearing_bore: float = 12.0

    # Phalanx (SLS PA12, living hinge)
    phalanx_length: float = 21.0
    phalanx_width: float = 12.0
    phalanx_height: float = 7.5
    hinge_slot_width: float = 0.6
    hinge_web: float = 1.2

    @property
    def cartridge_radius(self) -> float:
        return self.forearm_outer_diameter / 2 - self.forearm_wall - self.cartridge_clearance

    @property
    def motor_ring_b_count(self) -> int:
        return self.motor_count - self.motor_ring_a_count

    def ring_pitch(self, radius: float, count: int) -> float:
        """Arc distance between neighbouring motor centres."""
        return 2 * math.pi * radius / count

    def validate(self) -> list[str]:
        errors: list[str] = []
        if self.motor_ring_a_radius + self.motor_envelope / 2 > self.cartridge_radius:
            errors.append("ring A motors intersect the cartridge wall")
        if self.motor_ring_b_radius + self.motor_envelope / 2 > self.cartridge_radius:
            errors.append("ring B motors intersect the cartridge wall")
        for radius, count, label in (
            (self.motor_ring_a_radius, self.motor_ring_a_count, "ring A"),
            (self.motor_ring_b_radius, self.motor_ring_b_count, "ring B"),
        ):
            pitch = self.ring_pitch(radius, count)
            if pitch < self.motor_envelope:
                errors.append(
                    f"{label} arc pitch {pitch:.1f} mm < motor envelope {self.motor_envelope} mm"
                )
        if self.spool_diameter * 4 > self.cartridge_radius * 2:
            errors.append("four spools do not fit across the cartridge")
        line_per_rev = math.pi * self.spool_diameter
        if line_per_rev <= 0:
            errors.append("spool diameter must be positive")
        if self.tendon_travel / line_per_rev > 18:
            errors.append("spool needs more than 18 turns for the requested travel")
        if self.hinge_web <= self.hinge_slot_width:
            errors.append("living-hinge web must be thicker than the slot")
        return errors

    def summary(self) -> dict:
        return {
            "cartridge_radius_mm": round(self.cartridge_radius, 2),
            "ring_a_pitch_mm": round(self.ring_pitch(self.motor_ring_a_radius, self.motor_ring_a_count), 2),
            "ring_b_pitch_mm": round(self.ring_pitch(self.motor_ring_b_radius, self.motor_ring_b_count), 2),
            "spool_turns_for_travel": round(self.tendon_travel / (math.pi * self.spool_diameter), 2),
            "tensioner_preload_n": self.tensioner_preload,
        }


PARAMS = CartridgeParams()


if __name__ == "__main__":
    errors = PARAMS.validate()
    print(json.dumps({"params": asdict(PARAMS), "summary": PARAMS.summary()}, indent=2))
    if errors:
        raise SystemExit("packaging errors:\n- " + "\n- ".join(errors))
    print("\npackaging checks passed")
