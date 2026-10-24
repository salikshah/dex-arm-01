// English part descriptions for the picking card.
const RULES = [
  [/isolation-foot|plinth/, ['Base plinth', 'Machined foundation plate with vibration-isolation feet. Carries the full arm stack and the power/communication distribution board.']],
  [/distribution/, ['Power distribution', 'Base power and communication distribution board: processor, switching MOSFETs, passive components and routed traces.']],
  [/external-port|bus-out/, ['External interface port', 'Keyed external connector with latch, contact cavities and crimp pins for power and field-bus lines.']],
  [/status-light/, ['Status light', 'Diffused status indicator on the base face.']],
  [/stator/, ['Joint stator', 'Stationary electromagnetic stack of the joint actuator, paired with the rotor carrier.']],
  [/rotor-carrier|rotor-magnets/, ['Joint rotor', 'Rotating actuator carrier with permanent-magnet poles arranged around its rim.']],
  [/flexspline|wave-generator/, ['Strain-wave reducer', 'Harmonic reduction stage: flexspline and wave generator for zero-backlash torque.']],
  [/bearing-inner|bearing-retainer|abduction-bearing|^bearing/, ['Bearing ring', 'Cross-roller bearing ring supporting the joint axis with polished races.']],
  [/encoder/, ['Encoder', 'Optical/magnetic encoder track for absolute joint position feedback.']],
  [/front-cover|service-cap|output-bezel/, ['Joint cover', 'Removable machined cover sealing the actuator cartridge; service access at the center.']],
  [/torque-flexure|strain-patches/, ['Torque sensor', 'Flexure element with strain gauges measuring output torque in closed loop.']],
  [/brake/, ['Holding brake', 'Spring-applied holding brake keeping the joint position when unpowered.']],
  [/harness|grommet|feedthrough/, ['Harness feedthrough', 'Sealed cable feedthrough guiding the service loop across the joint.']],
  [/pedestal|fork/, ['Shoulder yoke', 'Cast shoulder yoke linking the base rotation to the first pitch axis.']],
  [/rail-relief/, ['Rail lightening slot', 'Lightening relief machined into the structural rail.']],
  [/rail/, ['Structural rail', 'Longitudinal load-bearing rail; the two rails form the segment skeleton inside the shell.']],
  [/bulkhead/, ['End bulkhead', 'Ring bulkhead closing the segment and locating the rails, shells and seals.']],
  [/interface-seal/, ['Interface seal', 'Elastomer seal ring between shell and joint cartridge.']],
  [/shell-fastener|threaded-boss/, ['Shell fastener', 'Flush fastener and threaded boss clamping the two shell halves.']],
  [/dorsal-shell|palmar-shell/, ['Palm shell', 'Sculpted palm shell half with a natural arch, narrowed wrist and smooth split seam.']],
  [/shell|dorsal-cover|palmar-wrap|cuff/, ['Shell panel', 'Thin-wall polymer shell panel. Frost-transmissive so the internals stay faintly visible.']],
  [/thenar|hypothenar|distal-pad/, ['Contact pad', 'Soft palm contact region shaped for stable, gentle grasping.']],
  [/palm-flex-seam/, ['Palm flex seam', 'Flexible seam allowing the palm shell to follow metacarpal motion.']],
  [/metacarpal-bridge/, ['Metacarpal bridge', 'Cross tie between metacarpal blades keeping the finger spacing rigid.']],
  [/metacarpal/, ['Metacarpal blade', 'Slim metacarpal frame blade inside the palm; fingers mount on its distal end.']],
  [/palm-side-rail|palm-cross-rail/, ['Palm frame rail', 'Structural rail of the palm frame; side rails and cross rails carry the finger roots.']],
  [/controller|interface-bridge/, ['Hand controller', 'Palm-side controller board bridging the arm bus to the five finger looms.']],
  [/router-board|sense-board/, ['Palm circuit board', 'Routing/sensing PCB inside the palm with connectors to each finger loom.']],
  [/motor-core/, ['Actuator core', 'Finger actuator rotor core on the joint axis.']],
  [/motor-\d/, ['Finger actuator', 'Coreless axial-flux winding driving the phalanx; the copper coil ring visible at every knuckle.']],
  [/joint-shroud|joint-cap/, ['Knuckle shroud', 'Clear knuckle shroud capping the finger joint bearings.']],
  [/phalanx-crossmember/, ['Phalanx crossmember', 'Cross tie linking the two phalanx cheek plates.']],
  [/side-cheek/, ['Phalanx cheek', 'Open-frame phalanx cheek plate; pairs form the finger skeleton.']],
  [/sensor-board|sensor-ic|sensor-passives/, ['Phalanx sensor', 'Position/tactile sensing board with IC and passives inside the phalanx.']],
  [/tactile-fpc|fpc-contact|tactile-socket|pad-terminal/, ['Tactile FPC', 'Polyimide flex circuit carrying the fingertip tactile array.']],
  [/strain-guide/, ['Wire guide', 'Molded guide keeping the flex loop centered across the joint.']],
  [/hinge-out|hinge-in|flex-out|flex-in/, ['Flex connector', 'Micro connector jumping the knuckle hinge; its loop flexes with every bend.']],
  [/scan-source|scan-return|proximal-header|dense-proximal|palm-header|sense-header|controller-header/, ['Header connector', 'Multi-pin header with keying latch and gold contacts.']],
  [/dense-comb|lower-comb|upper-comb|guide/, ['Wire comb', 'Comb organizer separating the dense micro-wire runs.']],
  [/dense-batch/, ['Micro-wire bundle', 'Batched micro wiring: color-coded sensor and actuator lines woven through the volume.']],
  [/palm-loom|hub-link/, ['Finger loom', 'Braided loom trunk from the palm hub into the finger root.']],
  [/palm-sleeve|loom-sleeve|heatshrink|woven-strands/, ['Braided sleeve', 'Woven protective sleeve with heat-shrink cuffs finishing the loom ends.']],
  [/palm-lacing|loom-clamp/, ['Loom clamp', 'Lacing clamp anchoring the loom to the frame.']],
  [/finger-id|loom-ident/, ['Identification collar', 'Color-coded identification collar marking the bus or finger index.']],
  [/phalanx-wire|intermodule-feed|hinge-wire|abduction-feed/, ['Finger wiring', 'Insulated hookup wire routing power and sensing along the finger.']],
  [/longitudinal|twisted-return|board-spur/, ['Segment wiring', 'Longitudinal trunk wiring inside the arm segment with twisted return pairs.']],
  [/service-\d/, ['Service loop', 'Service loop crossing the joint with bend allowance for the full travel range.']],
  [/bus\//, ['Bus trunk', 'Main bus trunk bridging consecutive arm segments.']],
  [/standoff/, ['Board standoff', 'Hex standoff spacing the PCB off the frame.']],
  [/mount/, ['Joint mount', 'Mounting frame locating the joint cartridge on the previous segment.']],
  [/substrate|processor|mosfet|passives|traces/, ['Board electronics', 'Populated PCB area: substrate, processor, power stage and routed traces.']],
  [/pin-\d/, ['Connector pin', 'Gold-plated contact pin.']],
  [/key-latch|key|latch/, ['Connector latch', 'Keyed latch locking the connector against vibration.']],
  [/contact-cavities|contacts|crimp-pins/, ['Contact set', 'Contact cavities and crimp pins of the connector.']],
  [/stylus|barrel|grip-band|end-cap|tool\/tip/, ['Precision stylus', 'Handheld precision stylus used for pointing demos.']],
  [/comb/, ['Wire comb', 'Comb organizer separating dense micro-wire runs.']],
];

export function describePart(part) {
  const name = part.name || '';
  const base = name.split('/').pop();
  let title = humanize(base), desc = 'Machined and molded element of the FORM / 01 assembly.';
  for (const [re, [t, d]] of RULES) {
    if (re.test(name) || re.test(base)) { title = t; desc = d; break; }
  }
  const details = [];
  if (part.owner) details.push({ label: 'Assembly', value: humanize(part.owner) });
  if (part.layer) details.push({ label: 'Layer', value: humanize(part.layer) });
  if (part.role) details.push({ label: 'Material', value: humanize(part.role) });
  if (part.bounds) {
    const sz = { x: part.bounds.max.x - part.bounds.min.x, y: part.bounds.max.y - part.bounds.min.y, z: part.bounds.max.z - part.bounds.min.z };
    details.push({ label: 'Size', value: `${(sz.x * 1000).toFixed(1)} × ${(sz.y * 1000).toFixed(1)} × ${(sz.z * 1000).toFixed(1)} mm` });
  }
  return { name: title, partName: name, role: part.role ? humanize(part.role) : 'Structure', description: desc, details };
}

function humanize(s) {
  if (!s) return '';
  return String(s)
    .replace(/^(wire|micro|label)-/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
