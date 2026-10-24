// End-to-end browser smoke test over the Chrome DevTools Protocol.
// No Playwright/Puppeteer: Node 20+ ships fetch and Node 22+ ships WebSocket.
//
//   node tests/e2e/smoke.mjs [--keep]
//
// Exit code 0 only when the app boots, renders, and every checked runtime
// feature answers. Screenshots land in tests/e2e/.artifacts/.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const artifacts = join(here, '.artifacts');
mkdirSync(artifacts, { recursive: true });

const PORT = Number(process.env.PORT || 4173);
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const URL_UNDER_TEST = process.env.APP_URL || `http://127.0.0.1:${PORT}/index.html`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome found. Set CHROME_PATH to a Chrome/Chromium binary.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {}
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: done, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else done(msg.result);
        return;
      }
      if (msg.method) this.events.push(msg);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 45000);
    });
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Page exception: ${desc}`);
    }
    return res.result?.value;
  }

  async waitFor(expression, { timeout = 30000, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) return true;
      } catch (err) {
        lastErr = err;
      }
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${label}${lastErr ? ` (${lastErr.message})` : ''}`);
  }

  async screenshot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = join(artifacts, name);
    writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function launch() {
  const profile = join(artifacts, 'chrome-profile-' + Date.now());
  const child = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    '--remote-allow-origins=*',
    '--window-size=1024,700',
    // Software WebGL so headless CI can render the scene.
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    'about:blank',
  ], { stdio: 'ignore' });

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return { child, wsUrl: page.webSocketDebuggerUrl };
    } catch {}
    await sleep(150);
  }
  child.kill();
  throw new Error('Chrome did not expose a CDP page target');
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', (e) => reject(new Error('WebSocket error: ' + (e.message || 'unknown'))), { once: true });
  });
}

let activeChrome = null;
let activeServer = null;
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  if (!process.env.APP_URL) {
    // Boot a throwaway static server unless the caller supplies a URL.
    const server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs'), '--port', String(PORT), '--quiet'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeServer = server;
    process.on('exit', () => server.kill());
    await waitForHttp(`http://127.0.0.1:${PORT}/index.html`);
  }

  const { child, wsUrl } = await launch();
  activeChrome = child;
  const page = new CDP(await openWs(wsUrl));
  page._chrome = child;

  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Log.enable');

  console.log(`\n→ ${URL_UNDER_TEST}`);
  await page.send('Page.navigate', { url: URL_UNDER_TEST });

  console.log('   booting (software WebGL can take ~30 s)…');
  await page.waitFor('window.__formReady === true', { timeout: 180000, label: 'app boot (window.__formReady)' });
  await page.waitFor('window.__rebuild && typeof window.__rebuild.snapshot === "function"', { timeout: 15000, label: 'runtime API' });
  await sleep(1500);

  const snap = await page.evaluate('window.__rebuild.snapshot()');
  check('runtime API snapshot', snap && snap.stats, JSON.stringify(snap?.stats));
  check('scene has meshes', snap?.stats?.meshCount > 50, `${snap?.stats?.meshCount} meshes`);
  check('harness wires routed', snap?.stats?.wireCount > 0, `${snap?.stats?.wireCount} wires`);
  check('telemetry HUD mounted', await page.evaluate('!!document.getElementById("telemetry-hud")'));
  check('engineering drawer sections', (await page.evaluate('document.querySelectorAll("#drawerBody .sect").length')) >= 4);
  check('joint sliders built', (await page.evaluate('document.querySelectorAll("#drawerBody input[type=range]").length')) >= 27);

  // Public API surface expected by the open-source contract.
  const surface = await page.evaluate(`(() => {
    const api = window.__rebuild;
    return {
      exportMJCF: typeof api.exportMJCF,
      exportROS2: typeof api.exportROS2,
      snapshot: typeof api.snapshot,
      hand: api.handJointInfo.length,
      arm: api.armJointInfo.length,
    };
  })()`);
  check('27 kinematic joints exposed', surface.arm === 7 && surface.hand === 20, `${surface.arm} arm + ${surface.hand} hand`);

  // ---- Phase 2: minimum-jerk grasp trajectory ----
  const planned = await page.evaluate(`(() => {
    const st = window.__rebuild.planTrajectory();
    return { ready: st.ready, stages: st.stages.length, duration: st.duration, error: st.error };
  })()`);
  check('trajectory plans six stages', planned.ready && planned.stages === 6, `${planned.stages} stages, ${planned.duration?.toFixed(2)} s`);
  check('trajectory has no planner error', !planned.error, planned.error || '');

  const exportSchema = await page.evaluate(`(() => {
    const data = window.__rebuild.trajectory.exportJSON(20);
    return {
      dof: data.trajectory.dof,
      names: data.trajectory.joint_names.length,
      points: data.trajectory.points.length,
      task: data.metadata.task,
      profile: data.metadata.profile,
    };
  })()`);
  check('trajectory JSON is 27-DoF', exportSchema.dof === 27 && exportSchema.names === 27, `${exportSchema.points} points`);
  check('trajectory JSON carries metadata', Boolean(exportSchema.task) && exportSchema.profile.includes('quintic'));

  // Software WebGL can render below 1 FPS, so drive the player through its own
  // frame path rather than the render clock. The player clamps each step to
  // 100 ms (so a stalled tab does not teleport the arm), so step at that size.
  const playing = await page.evaluate(`(() => {
    const c = window.__rebuild.trajectory;
    c.play();
    for (let i = 0; i < 8; i++) c.player.update(0.1);
    const st = c.getState();
    c.pause();
    return st;
  })()`);
  check('trajectory playback advances', playing.time >= 0.5, `t=${playing.time?.toFixed(2)} s`);
  const sought = await page.evaluate(`(() => {
    const api = window.__rebuild;
    const dur = api.getTrajectoryState().duration;
    api.seekTrajectory(dur * 0.5);
    const st = api.getTrajectoryState();
    return { time: st.time, stage: st.stageId, stageCount: st.stages.length };
  })()`);
  check('trajectory scrubber seeks into a stage', Boolean(sought.stage) && sought.time > 0.1, `${sought.stage} @ ${sought.time.toFixed(2)} s`);

  check('physics control panel present', await page.evaluate('!!document.getElementById("btnPhysicsToggle")'));

  // ---- Phase 3: mock teleoperation drives the same pose + IK path ----
  await page.evaluate('window.__rebuild.startTeleopMock()');
  await sleep(700);
  const teleop = await page.evaluate('window.__rebuild.getTeleopState()');
  check('mock teleoperation streams frames', teleop?.mode === 'mock' && teleop.frames > 5, `${teleop?.frames} frames`);
  check('tracked hand drives finger joints', teleop?.hand?.some((v) => v > 5), `max ${Math.max(...(teleop?.hand || [0])).toFixed(1)}°`);
  await page.evaluate('window.__rebuild.stopTeleop()');

  // ---- Phase 1: MuJoCo WASM, in a WebGL-free fixture page ----
  // Software WebGL plus an 11 MB WASM compile in the same tab is punishingly
  // slow on CI, so the physics runtime is verified on its own page.
  console.log('\n→ MuJoCo fixture');
  await page.send('Page.navigate', { url: new URL('/tests/e2e/physics.html', URL_UNDER_TEST).href });
  await page.waitFor('window.__physicsTest && window.__physicsTest.status !== "loading"', {
    timeout: 120000,
    label: 'MuJoCo fixture',
  });
  const phys = await page.evaluate('window.__physicsTest');
  check('MuJoCo WASM compiles the 27-DoF model', phys.status === 'done', phys.error || `${phys.source} in ${phys.loadMs} ms`);
  check('physics runs at 500 Hz', phys.telemetry?.steps >= 800, `${phys.telemetry?.steps} steps`);
  check('object lands in the open palm', Math.abs(phys.landed?.localPosition?.[0] ?? 1) < 0.05, `${phys.landed?.localPosition?.map((v) => v.toFixed(3)).join(', ')}`);
  check('closed fingers retain the object', phys.heldRadius < 0.16 && phys.telemetry?.objectHeightMm > 500, `r=${phys.heldRadius?.toFixed(3)} m`);

  // Make sure nothing threw while the render loop ran.
  const errors = page.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text);
  const consoleErrors = page.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
    .map((e) => (e.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
    .filter((t) => !/favicon|net::ERR_|Failed to load resource/i.test(t));
  check('no uncaught page exceptions', errors.length === 0, errors.join(' | ').slice(0, 400));
  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 400));

  // Screenshots are opt-in: software WebGL can make capture very slow in CI.
  if (process.argv.includes('--screenshot')) {
    const shot = await page.screenshot('boot.png');
    console.log(`\nScreenshot: ${shot}`);
  }

  page.close();
  child.kill();
  await sleep(300);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  cleanup();
  process.exit(failed.length ? 1 : 0);
}

function cleanup() {
  try { activeChrome?.kill(); } catch {}
  try { activeServer?.kill(); } catch {}
}

main().catch(async (err) => {
  console.error('\nE2E harness error:', err);
  cleanup();
  process.exit(1);
});
