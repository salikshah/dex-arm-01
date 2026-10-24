// Copies the MuJoCo WASM build out of node_modules into vendor/mujoco/ so the
// demo can run fully offline. The runtime falls back to the jsDelivr copy when
// this directory is absent, so vendoring stays optional for contributors.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pkg = join(root, 'node_modules', '@mujoco', 'mujoco');
const out = join(root, 'vendor', 'mujoco');

if (!existsSync(join(pkg, 'mujoco.js'))) {
  console.error('Missing node_modules/@mujoco/mujoco. Run `npm install` first.');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
for (const file of ['mujoco.js', 'mujoco.wasm', 'LICENSE']) {
  const src = join(pkg, file);
  if (!existsSync(src)) continue;
  copyFileSync(src, join(out, file));
}

// The npm package declares Apache-2.0 but does not ship the licence text.
writeFileSync(
  join(out, 'NOTICE.txt'),
  [
    'MuJoCo WebAssembly build, vendored from @mujoco/mujoco (Google DeepMind).',
    'Upstream: https://github.com/google-deepmind/mujoco/tree/main/wasm',
    'Licence: Apache-2.0 — https://www.apache.org/licenses/LICENSE-2.0',
    'Version: 3.17.0',
    'Files: mujoco.js, mujoco.wasm',
    '',
  ].join('\n'),
);

const kb = (f) => (statSync(join(out, f)).size / 1024).toFixed(0) + ' KB';
console.log(`Vendored MuJoCo 3.17.0 → vendor/mujoco/ (mujoco.js ${kb('mujoco.js')}, mujoco.wasm ${kb('mujoco.wasm')})`);
