# Contributing to DEX ARM 01

Thanks for taking the time to look. This project mixes a browser visualisation,
a controls stack and a hardware proposal, so the most useful contribution is
often a measurement rather than a feature.

## Before you start

- Open an issue for anything larger than a bug fix or a doc correction.
- Search existing issues; several "missing" features are deliberate (see
  `docs/OPEN_SOURCE_GAP_ANALYSIS.md`).
- Do not claim hardware was validated unless you ran the checklist in
  `hardware/dex-arm-01/README.md`. Say what you measured and with what.

## Development

```bash
npm install
npm run vendor:mujoco   # optional, makes physics offline
npm run dev             # http://127.0.0.1:3000/index.html
npm test
npm run test:e2e
```

There is no bundler. Keep browser code as native ES modules, use the existing
import map, and avoid adding runtime dependencies unless the alternative is
clearly worse. New npm dependencies belong in `devDependencies` unless they are
required in the browser at runtime.

## What good changes look like

- **Bug fixes** come with a test that would have caught the bug.
- **New math** (kinematics, grasp metrics, dynamics) gets a unit test with a
  hand-computed expected value, not a snapshot of its own output.
- **Physics changes** must keep the MuJoCo model compiling and the drop-and-
  catch test passing. If you change joint order or names, update
  `MJCF_HAND_JOINTS` and the mapping tests together.
- **Dataset schema changes** must keep `observation.state` at 27 values and
  document the new feature in `README.md` and `dataset-logger.js`.
- **UI changes** stay usable from the keyboard, respect `prefers-reduced-motion`
  and do not introduce layout shift on the 360 px viewport.

## Style

- ES modules, two-space indentation, single quotes, semicolons.
- Comments explain *why*, especially around numerical choices.
- Keep units in names: `standoff_mm`, `torqueNm`, `duration_s`.
- No new global state. The runtime API is `window.__rebuild` and exists for
  tests; do not build features on it.

## Tests and checks

`npm test` must pass. `npm run test:e2e` needs Chrome or Chromium; set
`CHROME_PATH` if auto-detection fails. Screenshots are opt-in
(`--screenshot`) because software WebGL is slow on CI.

If a test is flaky because of rendering speed, fix the test to exercise the
module directly rather than weakening the assertion.

## Hardware contributions

- Changes to `cad/*.py` must include the command you ran and the build123d
  version.
- BOM changes need a supplier, a price and a date; keep the total consistent
  with the README.
- Structural changes must state the load path and the failure mode.

## Review and licensing

By contributing you agree that your contribution is licensed under the
repository's MIT licence. Do not paste code or assets with incompatible
licences. If you are unsure about provenance, ask first.
