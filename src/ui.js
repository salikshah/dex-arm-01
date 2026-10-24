/*
 * FORM / 01 — product UI controller.
 * Apple-inspired, original implementation. Pure DOM: imports no model internals,
 * touches no renderer/scene nodes, makes no network requests. Talks only to the
 * runtime `api` object defined by the parallel integration contract.
 */

const MODES = [
  ['product', 'Product'],
  ['transparent', 'Transparent'],
  ['open', 'Open'],
  ['section', 'Section'],
  ['wiring', 'Wiring'],
  ['explode', 'Explode'],
];
const SKINS = [
  ['frost', 'Frost', '#e6ebf1'],
  ['crystal', 'Crystal', '#f5f9fc'],
  ['smoke', 'Smoke', '#63666b'],
  ['glacier', 'Glacier', '#c2dcea'],
  ['amber', 'Amber', '#e2a75c'],
];
const GESTURES = [
  ['three', 'Three · 3'],
  ['one', 'One · 1'],
  ['relaxed', 'Relaxed'],
  ['open', 'Open'],
  ['fist', 'Fist'],
  ['pinch', 'Pinch'],
  ['point', 'Point'],
  ['peace', 'Peace'],
  ['ripple', 'Ripple'],
  ['wave', 'Wave'],
];
const ARM_POSES_UI = [
  ['rest', 'Rest'],
  ['reach', 'Reach'],
  ['greeting', 'Greeting'],
  ['fold', 'Fold'],
  ['precision', 'Precision'],
];
const VIEWS = [
  ['arm', 'Full arm'],
  ['hand', 'Hand'],
  ['palm', 'Palm'],
  ['forearm', 'Forearm'],
];

const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

export function initUI(api) {
  api = api || {};
  const $ = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));

  /* ------------------------------------------------------------ state */
  const state = {
    mode: 'transparent',
    skin: 'frost',
    gesture: 'relaxed',
    playing: false,
    time: 0,
    shellDepth: 1,
    curl: 0,
    focus: 'arm',
    armAngles: new Array(7).fill(0),
    handAngles: new Array(20).fill(0),
    stats: null,
  };
  const armInfo = normalizeJointInfo(api.armJointInfo, 7, (i) => 'J' + (i + 1), -Math.PI, Math.PI);
  const handInfo = normalizeJointInfo(api.handJointInfo, 20, (i) => 'Joint ' + (i + 1), 0, 1.8);

  function normalizeJointInfo(list, count, fallbackLabel, fbMin, fbMax) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const src = Array.isArray(list) && list[i] ? list[i] : {};
      const min = Number.isFinite(src.min) ? src.min : fbMin;
      const max = Number.isFinite(src.max) && src.max > min ? src.max : fbMax;
      out.push({
        id: typeof src.id === 'string' ? src.id : fallbackLabel(i),
        label: typeof src.label === 'string' && src.label.trim() ? src.label : fallbackLabel(i),
        min, max,
        // contract: joint values are always degrees (metadata.unit === 'deg')
        degrees: src.unit ? src.unit === 'deg' : true,
      });
    }
    return out;
  }

  const listeners = []; // [target, type, fn, opts] for dispose()
  function on(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }
  function callApi(name, args, failLabel) {
    const fn = api[name];
    if (typeof fn !== 'function') return undefined;
    try { return fn.apply(api, args); }
    catch (err) { toast(failLabel + ' failed: ' + errText(err), true); return undefined; }
  }
  function errText(err) { return (err && err.message) ? err.message : 'unexpected error'; }

  /* ------------------------------------------------------------ toast */
  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(msg, isErr, sticky) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!isErr);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => toastEl.classList.remove('show'), isErr ? 5200 : 2600);
  }

  /* ------------------------------------------------------------ hero */
  const hero = $('#hero');
  const heroCopy = hero?.querySelector('.hero-copy');
  const positionHeroActions = () => {
    if (heroCopy) document.documentElement.style.setProperty('--hero-action-top', heroCopy.getBoundingClientRect().bottom + 'px');
  };
  const heroSizeObserver = new ResizeObserver(positionHeroActions);
  if (heroCopy) heroSizeObserver.observe(heroCopy);
  on(window, 'resize', positionHeroActions);
  positionHeroActions();
  let heroGone = false;
  function dismissHero() {
    if (heroGone || !hero) return;
    heroGone = true;
    hero.classList.add('hide');
    hero.setAttribute('aria-hidden', 'true');
  }
  const stage = $('#stage');
  on(stage, 'pointerdown', dismissHero, { passive: true });
  on(stage, 'wheel', dismissHero, { passive: true });

  /* ------------------------------------------------------------ tour rail */
  const chaptersNav = $('#chapters');
  const btnFree = $('#btnFreeExplore');
  const btnOrbit = $('#btnOrbit');
  let storyState = null;
  const chapterBtns = [];
  function buildChapters() {
    if (!chaptersNav) return;
    const st = api.getStoryState ? api.getStoryState() : null;
    if (!st) return;
    storyState = st;
    chaptersNav.textContent = '';
    chapterBtns.length = 0;
    st.chapters.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.chapter = String(i);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.setAttribute('aria-hidden', 'true');
      const lab = document.createElement('span');
      lab.className = 'clabel';
      lab.textContent = c.label;
      b.append(dot, lab);
      b.setAttribute('aria-label', `Chapter ${i + 1}: ${c.label}`);
      on(b, 'click', () => { dismissHero(); callApi('setChapter', [i], 'Chapter'); renderTour(); });
      chaptersNav.appendChild(b);
      chapterBtns.push(b);
    });
    renderTour();
  }
  function renderTour() {
    const st = api.getStoryState ? api.getStoryState() : storyState;
    if (!st) return;
    storyState = st;
    chapterBtns.forEach((b, i) => b.classList.toggle('on', st.active && i === st.chapter));
    if (btnFree) {
      btnFree.setAttribute('aria-pressed', st.active ? 'false' : 'true');
      btnFree.textContent = st.active ? 'Free explore' : 'Resume tour';
    }
    if (btnOrbit) btnOrbit.style.display = st.active ? 'none' : '';
  }
  on(btnFree, 'click', () => {
    dismissHero();
    if (storyState && storyState.active) callApi('freeExplore', [], 'Free explore');
    else callApi('resumeTour', [], 'Resume tour');
    setTimeout(renderTour, 60);
  });
  on(btnOrbit, 'click', () => { dismissHero(); callApi('orbit360', [], 'Orbit'); });
  buildChapters();

  /* ------------------------------------------------------------ capsule groups */
  function makeCapsule(container, group, value, label, swatchColor) {
    if (!container) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.group = group;
    b.dataset.value = value;
    b.setAttribute('aria-pressed', 'false');
    if (swatchColor) {
      const s = document.createElement('span');
      s.className = 'swatch';
      s.style.background = swatchColor;
      s.setAttribute('aria-hidden', 'true');
      b.appendChild(s);
    }
    b.appendChild(document.createTextNode(label));
    on(b, 'click', () => selectValue(group, value));
    container.appendChild(b);
    return b;
  }
  function fillGroup(ids, group, pairs, withSwatch) {
    ids.forEach((id) => {
      const c = document.getElementById(id);
      pairs.forEach(([value, label, color]) => makeCapsule(c, group, value, label, withSwatch ? color : null));
    });
  }
  const modeNav = $('#modeNav');
  MODES.forEach(([v, l]) => makeCapsule(modeNav, 'mode', v, l));
  fillGroup(['modeCapsM'], 'mode', MODES);
  fillGroup(['skinCaps', 'skinCapsM'], 'skin', SKINS, true);
  fillGroup(['gestureCaps', 'gestureCapsM'], 'gesture', GESTURES);
  fillGroup(['viewCaps', 'viewCapsM'], 'view', VIEWS);

  function selectValue(group, value) {
    dismissHero();
    if (group === 'mode') setMode(value);
    else if (group === 'skin') { state.skin = value; callApi('setSkin', [value], 'Material change'); }
    else if (group === 'gesture') {
      if (api.getStoryState?.().active) callApi('freeExplore', [], 'Free explore');
      state.gesture = value; callApi('setGesture', [value], 'Gesture change');
    }
    else if (group === 'view') {
      if (api.getStoryState?.().active) callApi('freeExplore', [], 'Free explore');
      state.focus = value;
      callApi('focus', [value], 'Camera move');
    }
    closePopovers();
    render();
  }
  function setMode(m) { state.mode = m; callApi('setMode', [m], 'Display mode change'); }

  /* ------------------------------------------------------------ transport */
  const playButtons = [
    { el: $('#btnPlay'), timeline: $('#timeline'), label: $('#tlabel') },
    { el: $('#btnPlayM'), timeline: $('#timelineM'), label: $('#tlabelM') },
    { el: $('#btnMPlay'), timeline: null, label: null },
  ].filter((p) => p.el);
  const timelines = [$('#timeline'), $('#timelineM')].filter(Boolean);
  const tlabels = [$('#tlabel'), $('#tlabelM')].filter(Boolean);
  let scrubbing = false;

  playButtons.forEach((p) => on(p.el, 'click', () => {
    dismissHero();
    state.playing = !state.playing;
    callApi('setPlaying', [state.playing], 'Playback toggle');
    armPoll();
    render();
  }));
  timelines.forEach((t) => {
    on(t, 'pointerdown', () => { scrubbing = true; });
    on(t, 'input', () => {
      state.time = parseFloat(t.value) || 0;
      callApi('setTime', [state.time], 'Timeline scrub');
      renderTime();
    });
    on(t, 'change', () => { scrubbing = false; renderTime(); });
    on(t, 'keyup', () => { scrubbing = false; });
    on(t, 'keydown', () => { scrubbing = true; dismissHero(); });
  });

  /* ------------------------------------------------------------ popovers (mobile) */
  const popButtons = qa('.mpop');
  let openPop = null;
  function closePopovers() {
    if (!openPop) return;
    const panel = document.getElementById(openPop);
    if (panel) panel.hidden = true;
    popButtons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    openPop = null;
  }
  popButtons.forEach((b) => on(b, 'click', () => {
    dismissHero();
    const id = b.dataset.pop;
    if (openPop === id) { closePopovers(); return; }
    closePopovers();
    const panel = document.getElementById(id);
    if (panel) { panel.hidden = false; openPop = id; b.setAttribute('aria-expanded', 'true'); }
  }));
  on(document, 'pointerdown', (e) => {
    if (!openPop) return;
    const mobile = $('.dock-mobile');
    if (mobile && !mobile.contains(e.target)) closePopovers();
  });

  /* ------------------------------------------------------------ drawer */
  const drawer = $('#drawer');
  const btnDrawer = $('#btnDrawer');
  const scrim = $('#scrim');
  let drawerOpen = false;
  let focusBeforeDrawer = null;

  function openDrawer() {
    if (drawerOpen || !drawer) return;
    dismissHero();
    closePopovers();
    drawerOpen = true;
    focusBeforeDrawer = document.activeElement;
    drawer.classList.add('open');
    drawer.inert = false;
    if (scrim) scrim.classList.add('show');
    if (btnDrawer) btnDrawer.setAttribute('aria-expanded', 'true');
    const closeBtn = $('#btnCloseDrawer');
    if (closeBtn) closeBtn.focus();
  }
  function closeDrawer() {
    if (!drawerOpen || !drawer) return;
    drawerOpen = false;
    drawer.classList.remove('open');
    drawer.inert = true;
    if (scrim) scrim.classList.remove('show');
    if (btnDrawer) btnDrawer.setAttribute('aria-expanded', 'false');
    if (focusBeforeDrawer && focusBeforeDrawer.focus) focusBeforeDrawer.focus();
  }
  on(btnDrawer, 'click', () => (drawerOpen ? closeDrawer() : openDrawer()));
  on($('#btnCloseDrawer'), 'click', closeDrawer);
  on(scrim, 'click', closeDrawer);
  on(drawer, 'keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = drawer.querySelectorAll('button, input, select, a[href], [tabindex]:not([tabindex="-1"])');
    const list = Array.from(items).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ------------------------------------------------------------ drawer content */
  const drawerBody = $('#drawerBody');
  const jointSliders = []; // {input, out, info, arr:'arm'|'hand', index}

  function section(title, hint) {
    const s = document.createElement('section');
    s.className = 'sect';
    const h = document.createElement('h3');
    h.textContent = title;
    if (hint) {
      const span = document.createElement('span');
      span.className = 'hint';
      span.textContent = hint;
      h.appendChild(span);
    }
    s.appendChild(h);
    drawerBody.appendChild(s);
    return s;
  }
  function fmtAngle(info, v) {
    const deg = info.degrees ? v : v * 180 / Math.PI;
    return (Math.abs(deg) < 0.05 ? 0 : deg).toFixed(Math.abs(deg) < 10 ? 1 : 0) + '°';
  }
  function buildJointRows(sectEl, infos, arrKey, count) {
    infos.forEach((info, i) => {
      const row = document.createElement('div');
      row.className = 'jrow';
      const lab = document.createElement('label');
      lab.htmlFor = 'jr-' + arrKey + '-' + i;
      lab.textContent = info.label;
      lab.title = info.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'slider';
      input.id = 'jr-' + arrKey + '-' + i;
      input.min = String(info.min);
      input.max = String(info.max);
      input.step = String((info.max - info.min) / 240 || 0.01);
      input.value = '0';
      const out = document.createElement('output');
      out.htmlFor = input.id;
      out.textContent = fmtAngle(info, 0);
      row.append(lab, input, out);
      sectEl.appendChild(row);
      jointSliders.push({ input, out, info, arr: arrKey, index: i });

      let dirty = false, queued = false;
      on(input, 'input', () => {
        const arr = arrKey === 'arm' ? state.armAngles : state.handAngles;
        arr[i] = parseFloat(input.value);
        out.textContent = fmtAngle(info, arr[i]);
        dirty = true;
        if (!queued) {
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            if (!dirty) return;
            dirty = false;
            sendAngles(arrKey, count);
          });
        }
      });
    });
  }
  function sendAngles(arrKey, count) {
    if (arrKey === 'arm') callApi('setArmAngles', [state.armAngles.slice(0, count)], 'Arm pose update');
    else callApi('setHandAngles', [state.handAngles.slice(0, count)], 'Hand pose update');
  }

  const sectArm = section('Arm pose', '7 axes');
  buildJointRows(sectArm, armInfo, 'arm', 7);
  const sectHand = section('Hand pose', '20 DOF');
  buildJointRows(sectHand, handInfo, 'hand', 20);

  const sectShell = section('Shell', 'section depth');
  {
    const row = document.createElement('div');
    row.className = 'jrow';
    row.style.gridTemplateColumns = '104px 1fr 50px';
    const lab = document.createElement('label');
    lab.htmlFor = 'shellDepth';
    lab.textContent = 'Shell depth';
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'slider';
    input.id = 'shellDepth';
    input.min = '0'; input.max = '1'; input.step = '0.01'; input.value = '1';
    const out = document.createElement('output');
    out.htmlFor = input.id;
    out.textContent = '100%';
    row.append(lab, input, out);
    sectShell.appendChild(row);
    let queued = false;
    on(input, 'input', () => {
      state.shellDepth = parseFloat(input.value);
      out.textContent = Math.round(state.shellDepth * 100) + '%';
      if (!queued) {
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          callApi('setShellDepth', [state.shellDepth], 'Shell update');
        });
      }
    });
    jointSliders.push({ input, out, info: null, arr: 'shell', index: 0 });
  }

  const sectCam = section('Camera');
  {
    const row = document.createElement('div');
    row.className = 'chiprow';
    VIEWS.forEach(([v, l]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.group = 'view';
      b.dataset.value = v;
      b.setAttribute('aria-pressed', 'false');
      b.textContent = l;
      on(b, 'click', () => selectValue('view', v));
      row.appendChild(b);
    });
    sectCam.appendChild(row);
  }

  const sectPoses = section('Arm poses', 'animated');
  {
    const row = document.createElement('div');
    row.className = 'chiprow';
    ARM_POSES_UI.forEach(([v, l]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = l;
      on(b, 'click', () => { dismissHero(); callApi('setPose', [v], 'Arm pose'); });
      row.appendChild(b);
    });
    sectPoses.appendChild(row);
  }

  const sectCurl = section('Hand curl', 'all fingers');
  {
    const row = document.createElement('div');
    row.className = 'jrow';
    row.style.gridTemplateColumns = '104px 1fr 50px';
    const lab = document.createElement('label');
    lab.htmlFor = 'handCurl';
    lab.textContent = 'Global curl';
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'slider';
    input.id = 'handCurl';
    input.min = '0'; input.max = '1'; input.step = '0.01'; input.value = '0';
    const out = document.createElement('output');
    out.htmlFor = input.id;
    out.textContent = '0%';
    row.append(lab, input, out);
    sectCurl.appendChild(row);
    let queued = false;
    on(input, 'input', () => {
      state.curl = parseFloat(input.value);
      out.textContent = Math.round(state.curl * 100) + '%';
      if (!queued) {
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          callApi('setHandCurl', [state.curl], 'Hand curl');
        });
      }
    });
    jointSliders.push({ input, out, info: null, arr: 'curl', index: 0 });
  }

  const sectExplode = section('Parts layout', 'exploded view');
  const explodeLocal = { active: false, scope: 'all', layout: 'exploded', amount: 0.65 };
  {
    const row = document.createElement('div');
    row.className = 'chiprow';
    const btnEnter = document.createElement('button');
    btnEnter.type = 'button';
    btnEnter.className = 'chip';
    btnEnter.id = 'btnExplodeToggle';
    btnEnter.textContent = 'Lay out parts';
    on(btnEnter, 'click', () => {
      dismissHero();
      if (!explodeLocal.active) {
        const ok = callApi('enterExplode', [{ scope: explodeLocal.scope, layout: explodeLocal.layout, amount: explodeLocal.amount }], 'Parts layout');
        explodeLocal.active = ok !== false;
      } else {
        callApi('exitExplode', [], 'Reassemble');
        explodeLocal.active = false;
      }
      syncExplodeUI();
    });
    row.appendChild(btnEnter);
    sectExplode.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'jrow';
    row2.style.gridTemplateColumns = '104px 1fr';
    const lab = document.createElement('label');
    lab.textContent = 'Module';
    const sel = document.createElement('select');
    sel.id = 'explodeScope';
    sel.style.cssText = 'font:inherit;font-size:12.5px;padding:7px 10px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.7)';
    const mk = (v, l) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); };
    mk('all', 'Full assembly');
    mk('hand', 'Hand (module)');
    const stats = typeof api.getExplodeStats === 'function' ? api.getExplodeStats() : null;
    if (stats && Array.isArray(stats.groups)) {
      for (const g of stats.groups) mk(g.id, g.label || g.id);
    }
    on(sel, 'change', () => {
      explodeLocal.scope = sel.value;
      if (explodeLocal.active) callApi('setExplodeProgress', [explodeLocal.amount, { scope: explodeLocal.scope, layout: explodeLocal.layout }], 'Module');
    });
    row2.append(lab, sel);
    sectExplode.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'jrow';
    row3.style.gridTemplateColumns = '104px 1fr 50px';
    const lab3 = document.createElement('label');
    lab3.htmlFor = 'explodeAmount';
    lab3.textContent = 'Separation';
    const amount = document.createElement('input');
    amount.type = 'range';
    amount.className = 'slider';
    amount.id = 'explodeAmount';
    amount.min = '0'; amount.max = '1'; amount.step = '0.01'; amount.value = String(explodeLocal.amount);
    const out3 = document.createElement('output');
    out3.htmlFor = amount.id;
    out3.textContent = '65%';
    row3.append(lab3, amount, out3);
    sectExplode.appendChild(row3);
    let q3 = false;
    on(amount, 'input', () => {
      explodeLocal.amount = parseFloat(amount.value);
      out3.textContent = Math.round(explodeLocal.amount * 100) + '%';
      if (!q3) {
        q3 = true;
        requestAnimationFrame(() => {
          q3 = false;
          if (explodeLocal.active) callApi('setExplodeProgress', [explodeLocal.amount, { scope: explodeLocal.scope, layout: explodeLocal.layout }], 'Separation');
        });
      }
    });

    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.style.marginTop = '8px';
    [['exploded', 'Exploded'], ['flat', 'Flat layout']].forEach(([v, l]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = l;
      b.dataset.layout = v;
      b.classList.toggle('on', v === explodeLocal.layout);
      on(b, 'click', () => {
        explodeLocal.layout = v;
        seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.layout === v));
        if (explodeLocal.active) callApi('setExplodeProgress', [explodeLocal.amount, { scope: explodeLocal.scope, layout: explodeLocal.layout }], 'Layout');
      });
      seg.appendChild(b);
    });
    sectExplode.appendChild(seg);
  }
  function syncExplodeUI() {
    const b = document.getElementById('btnExplodeToggle');
    if (b) b.textContent = explodeLocal.active ? 'Reassemble' : 'Lay out parts';
  }

  /* ------------------------------------------------------------ Dex-YCB Benchmarks */
  const sectBenchmarks = section('Dex-YCB Manipulation Benchmarks');
  {
    const desc = document.createElement('p');
    desc.style.fontSize = '12px';
    desc.style.color = 'var(--ink-2)';
    desc.style.marginBottom = '10px';
    desc.textContent = 'Spawn standard calibrated YCB robotics benchmark objects on the test table to evaluate grasping stability, contact normals, and force-closure.';
    sectBenchmarks.appendChild(desc);

    const chipRow = document.createElement('div');
    chipRow.className = 'chiprow';
    const objButtons = [
      { id: '025_mug', label: '025 Mug' },
      { id: '021_bleach_cleanser', label: '021 Bottle' },
      { id: '002_master_chef_can', label: '002 Can' },
      { id: 'precision_stylus', label: 'Stylus' },
    ];

    objButtons.forEach(ob => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = ob.label;
      on(btn, 'click', () => {
        chipRow.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
        btn.classList.add('on');
        api.spawnBenchmark?.(ob.id);
        toast(`Spawned ${ob.label} on test platform.`);
      });
      chipRow.appendChild(btn);
    });
    sectBenchmarks.appendChild(chipRow);

    const actRow = document.createElement('div');
    actRow.style.display = 'flex';
    actRow.style.gap = '8px';
    actRow.style.marginTop = '12px';

    const btnGrasp = document.createElement('button');
    btnGrasp.type = 'button';
    btnGrasp.className = 'btn primary';
    btnGrasp.style.flex = '2';
    btnGrasp.textContent = 'Execute Grasp & Lift';

    const btnClear = document.createElement('button');
    btnClear.type = 'button';
    btnClear.className = 'btn secondary';
    btnClear.style.flex = '1';
    btnClear.textContent = 'Clear';

    actRow.append(btnGrasp, btnClear);
    sectBenchmarks.appendChild(actRow);

    const benchStatus = document.createElement('div');
    benchStatus.className = 'export-status';
    benchStatus.style.marginTop = '8px';
    benchStatus.textContent = 'Ready to test benchmark manipulation.';
    sectBenchmarks.appendChild(benchStatus);

    on(btnGrasp, 'click', () => {
      if (!api.benchmarks?.currentObject) {
        toast('Please spawn a YCB object first.', true);
        return;
      }
      btnGrasp.disabled = true;
      api.runGraspBenchmark?.((st) => {
        benchStatus.textContent = `[${st.stage}] ε: ${st.epsilon ?? '0.00'}${st.liftMm ? ` · Lift: ${st.liftMm}mm` : ''}`;
        if (st.done) {
          btnGrasp.disabled = false;
          toast('Benchmark grasp sequence completed successfully!');
        }
      });
    });

    on(btnClear, 'click', () => {
      chipRow.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      api.clearBenchmark?.();
      benchStatus.textContent = 'Platform cleared.';
      toast('Test platform cleared.');
    });
  }

  /* ------------------------------------------------------------ Biomechanics & Kinematics */
  const sectBiomech = section('Biomechanical Physics & IK');
  {
    const makeCheck = (id, labelText, defaultChecked, onChange) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.padding = '5px 0';

      const lab = document.createElement('label');
      lab.htmlFor = id;
      lab.style.fontSize = '12.5px';
      lab.style.color = 'var(--ink)';
      lab.textContent = labelText;

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id = id;
      chk.checked = defaultChecked;
      chk.style.cursor = 'pointer';
      on(chk, 'change', () => onChange(chk.checked));

      row.append(lab, chk);
      return row;
    };

    sectBiomech.appendChild(makeCheck('chkCoupling', 'Coupled DIP-PIP Kinematics (θ_DIP = 0.67 θ_PIP)', true, (v) => {
      api.setCoupledBiomechanics?.(v);
      toast(v ? 'Biological DIP-PIP coupling enabled.' : 'Coupling disabled (independent joint control).');
    }));

    sectBiomech.appendChild(makeCheck('chkIKGizmo', 'Interactive 6D Cartesian Target Gizmo', false, (v) => {
      api.setIK?.(v);
      toast(v ? '6D Cartesian IK target enabled — drag gizmo in 3D.' : 'IK target disabled.');
    }));

    sectBiomech.appendChild(makeCheck('chkEllipsoid', 'Yoshikawa Manipulability Ellipsoid', false, (v) => {
      api.setEllipsoid?.(v);
      toast(v ? '3D Manipulability Ellipsoid rendered at wrist.' : 'Manipulability ellipsoid hidden.');
    }));

    sectBiomech.appendChild(makeCheck('chkTactile', 'Tactile Normal Vectors & Friction Cones', false, (v) => {
      api.setTactileForces?.(v);
      toast(v ? '3D Tactile normal vectors & friction cones visible.' : 'Tactile vectors hidden.');
    }));
  }

  /* ------------------------------------------------------------ Grasp trajectory */
  const sectTraj = section('Minimum-Jerk Grasp Trajectory', 'MoveIt 2 compatible');
  let trajRaf = 0;
  {
    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:12px;color:var(--ink-2);line-height:1.5;margin-bottom:10px;';
    desc.textContent = 'Quintic 10u³ − 15u⁴ + 6u⁵ profiles with zero boundary velocity and acceleration. Six stages: approach, preshape, descend, grasp, +150 mm lift, retract.';
    sectTraj.appendChild(desc);

    const bar = document.createElement('div');
    bar.className = 'hud-manip-bar';
    const fill = document.createElement('div');
    fill.className = 'hud-manip-fill';
    fill.style.width = '0%';
    bar.appendChild(fill);
    sectTraj.appendChild(bar);

    const stageLine = document.createElement('div');
    stageLine.style.cssText = 'display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink-3);margin:6px 0 10px;gap:8px;';
    const stageText = document.createElement('span');
    stageText.id = 'trajStage';
    stageText.textContent = 'Not planned';
    const timeText = document.createElement('span');
    timeText.id = 'trajTime';
    timeText.style.fontVariantNumeric = 'tabular-nums';
    timeText.textContent = '0.00 / 0.00 s';
    stageLine.append(stageText, timeText);
    sectTraj.appendChild(stageLine);

    const scrubRow = document.createElement('div');
    scrubRow.className = 'jrow';
    scrubRow.style.gridTemplateColumns = '64px 1fr 48px';
    const scrubLab = document.createElement('label');
    scrubLab.htmlFor = 'trajScrub';
    scrubLab.textContent = 'Timeline';
    const scrub = document.createElement('input');
    scrub.type = 'range';
    scrub.className = 'slider';
    scrub.id = 'trajScrub';
    scrub.min = '0';
    scrub.max = '8';
    scrub.step = '0.01';
    scrub.value = '0';
    scrub.setAttribute('aria-label', 'Trajectory time');
    const scrubOut = document.createElement('output');
    scrubOut.htmlFor = 'trajScrub';
    scrubOut.textContent = '0.0s';
    scrubRow.append(scrubLab, scrub, scrubOut);
    sectTraj.appendChild(scrubRow);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
    const btnPlay = document.createElement('button');
    btnPlay.type = 'button';
    btnPlay.className = 'btn primary';
    btnPlay.style.flex = '2';
    btnPlay.textContent = 'Play trajectory';
    const btnLoop = document.createElement('button');
    btnLoop.type = 'button';
    btnLoop.className = 'btn secondary';
    btnLoop.style.flex = '1';
    btnLoop.textContent = 'Loop: off';
    btnLoop.setAttribute('aria-pressed', 'false');
    btnRow.append(btnPlay, btnLoop);
    sectTraj.appendChild(btnRow);

    const btnRow2 = document.createElement('div');
    btnRow2.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
    const btnExportTraj = document.createElement('button');
    btnExportTraj.type = 'button';
    btnExportTraj.className = 'btn secondary';
    btnExportTraj.style.width = '100%';
    btnExportTraj.textContent = 'Export trajectory JSON';
    btnRow2.appendChild(btnExportTraj);
    sectTraj.appendChild(btnRow2);

    const trajStatus = document.createElement('div');
    trajStatus.className = 'export-status';
    trajStatus.id = 'trajStatus';
    trajStatus.textContent = 'Plans from the live pose on first play.';
    sectTraj.appendChild(trajStatus);

    let scrubFocus = false;
    on(scrub, 'pointerdown', () => { scrubFocus = true; });
    on(scrub, 'focus', () => { scrubFocus = true; });
    on(scrub, 'blur', () => { scrubFocus = false; });
    on(scrub, 'input', () => { api.seekTrajectory?.(parseFloat(scrub.value)); });
    on(scrub, 'change', () => { scrubFocus = false; });

    on(btnPlay, 'click', () => {
      dismissHero();
      const st = api.getTrajectoryState?.();
      if (!st?.ready) {
        api.playTrajectory?.();
        btnPlay.textContent = 'Pause';
      } else if (st.playing) {
        api.pauseTrajectory?.();
        btnPlay.textContent = 'Play trajectory';
      } else {
        api.playTrajectory?.();
        btnPlay.textContent = 'Pause';
      }
      syncTrajectory();
    });
    on(btnLoop, 'click', () => {
      const st = api.getTrajectoryState?.() || {};
      const next = !st.loop;
      api.setTrajectoryLoop?.(next);
      btnLoop.textContent = next ? 'Loop: on' : 'Loop: off';
      btnLoop.classList.toggle('on', next);
      btnLoop.setAttribute('aria-pressed', next ? 'true' : 'false');
    });
    on(btnExportTraj, 'click', () => {
      try {
        const res = api.exportTrajectory?.();
        toast(`Trajectory exported · ${res?.points ?? 0} points`);
      } catch (err) {
        toast('Trajectory export failed: ' + errText(err), true);
      }
    });

    const syncTrajectory = () => {
      const st = api.getTrajectoryState?.();
      if (!st) return;
      const dur = Number(st.duration) || 0;
      if (dur > 0) scrub.max = String(dur);
      if (!scrubFocus) scrub.value = String(st.time || 0);
      scrubOut.textContent = (st.time || 0).toFixed(1) + 's';
      fill.style.width = `${Math.min(100, (st.progress || 0) * 100).toFixed(0)}%`;
      stageText.textContent = st.stageLabel
        ? `${(st.stages.findIndex((s) => s.id === st.stageId) + 1)}/${st.stages.length} · ${st.stageLabel}`
        : 'Not planned';
      timeText.textContent = `${(st.time || 0).toFixed(2)} / ${dur.toFixed(2)} s`;
      btnPlay.textContent = st.playing ? 'Pause' : 'Play trajectory';
      if (st.stages.length) {
        trajStatus.textContent = `Peak ${st.peakVelocity.toFixed(1)} °/s · ${st.peakAcceleration.toFixed(0)} °/s² · ${st.stages.length} stages`;
      }
      if (st.error) {
        trajStatus.textContent = 'Planner error: ' + st.error;
        trajStatus.classList.add('err');
      } else {
        trajStatus.classList.remove('err');
      }
    };
    const loopUI = () => {
      syncTrajectory();
      trajRaf = requestAnimationFrame(loopUI);
    };
    trajRaf = requestAnimationFrame(loopUI);
  }

  /* ------------------------------------------------------------ MuJoCo physics */
  const sectPhysics = section('Live MuJoCo Physics', 'WASM · 27 DoF');
  let physicsTimer = 0;
  {
    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:12px;color:var(--ink-2);line-height:1.5;margin-bottom:10px;';
    desc.textContent = 'Runs DeepMind MuJoCo 3.17 in WebAssembly at a 500 Hz timestep. The object is released above the open palm and caught by position-servoed fingers.';
    sectPhysics.appendChild(desc);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';
    const btnToggle = document.createElement('button');
    btnToggle.type = 'button';
    btnToggle.className = 'chip';
    btnToggle.id = 'btnPhysicsToggle';
    btnToggle.textContent = 'Enable physics';
    const btnDrop = document.createElement('button');
    btnDrop.type = 'button';
    btnDrop.className = 'btn secondary';
    btnDrop.style.flex = '1';
    btnDrop.textContent = 'Drop object';
    btnDrop.disabled = true;
    btnRow.append(btnToggle, btnDrop);
    sectPhysics.appendChild(btnRow);

    const physStatus = document.createElement('div');
    physStatus.className = 'export-status';
    physStatus.id = 'physStatus';
    physStatus.textContent = 'WASM is fetched only when enabled (11 MB).';
    sectPhysics.appendChild(physStatus);

    let busy = false;
    on(btnToggle, 'click', async () => {
      if (busy) return;
      busy = true;
      dismissHero();
      btnToggle.disabled = true;
      const st = api.getPhysicsState?.();
      if (st?.enabled) {
        api.disablePhysics?.();
        btnToggle.textContent = 'Enable physics';
        btnDrop.disabled = true;
        physStatus.textContent = 'Physics stopped. WASM stays cached.';
      } else {
        btnToggle.textContent = 'Loading WASM…';
        physStatus.textContent = 'Loading MuJoCo WebAssembly…';
        const ok = await api.enablePhysics?.();
        const next = api.getPhysicsState?.();
        btnToggle.textContent = ok ? 'Disable physics' : 'Enable physics';
        btnDrop.disabled = !ok;
        physStatus.textContent = ok
          ? `Running · ${next?.source === 'vendor' ? 'local vendor build' : 'CDN build'}`
          : 'Could not start physics: ' + (next?.error || 'unknown error');
        if (!ok) physStatus.classList.add('err');
      }
      btnToggle.disabled = false;
      busy = false;
      syncPhysics();
    });

    on(btnDrop, 'click', () => {
      api.dropPhysicsObject?.();
      physStatus.textContent = 'Object released 180 mm above the palm.';
    });

    const syncPhysics = () => {
      const st = api.getPhysicsState?.();
      if (!st) return;
      if (st.status === 'running' && st.telemetry) {
        const t = st.telemetry;
        physStatus.textContent = `${t.contacts} contacts · object ${t.objectHeightMm.toFixed(0)} mm · ${t.steps} steps @ ${(1 / t.timestep).toFixed(0)} Hz`;
        physStatus.classList.remove('err');
      } else if (st.status === 'error') {
        physStatus.textContent = 'Physics error: ' + st.error;
        physStatus.classList.add('err');
      }
      btnDrop.disabled = !st.enabled;
      btnToggle.textContent = st.enabled ? 'Disable physics' : 'Enable physics';
      btnToggle.classList.toggle('on', st.enabled);
    };
    physicsTimer = setInterval(syncPhysics, 600);
  }

  /* ------------------------------------------------------------ Teleoperation & datasets */
  const sectTeleop = section('Teleoperation & Datasets', 'WebXR / LeRobot');
  let teleopTimer = 0;
  {
    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:12px;color:var(--ink-2);line-height:1.5;margin-bottom:10px;';
    desc.textContent = 'Stream tracked hand joints from Vision Pro or Quest into the 20-DoF hand and DLS arm IK, or drive the same path with the desktop mock. Record 30 Hz episodes shaped for LeRobot/OpenVLA.';
    sectTeleop.appendChild(desc);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    const btnXR = document.createElement('button');
    btnXR.type = 'button';
    btnXR.className = 'chip';
    btnXR.textContent = 'Start WebXR';
    const btnMock = document.createElement('button');
    btnMock.type = 'button';
    btnMock.className = 'chip';
    btnMock.textContent = 'Simulate hand';
    const btnStopTeleop = document.createElement('button');
    btnStopTeleop.type = 'button';
    btnStopTeleop.className = 'chip';
    btnStopTeleop.textContent = 'Stop';
    btnRow.append(btnXR, btnMock, btnStopTeleop);
    sectTeleop.appendChild(btnRow);

    const teleopStatus = document.createElement('div');
    teleopStatus.className = 'export-status';
    teleopStatus.textContent = 'Checking WebXR availability…';
    sectTeleop.appendChild(teleopStatus);

    const recRow = document.createElement('div');
    recRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:12px;';
    const btnRecord = document.createElement('button');
    btnRecord.type = 'button';
    btnRecord.className = 'btn primary';
    btnRecord.style.flex = '1';
    btnRecord.textContent = 'Record episode';
    const btnExportEpisode = document.createElement('button');
    btnExportEpisode.type = 'button';
    btnExportEpisode.className = 'btn secondary';
    btnExportEpisode.style.flex = '1';
    btnExportEpisode.textContent = 'Export';
    recRow.append(btnRecord, btnExportEpisode);
    sectTeleop.appendChild(recRow);

    const imgRow = document.createElement('label');
    imgRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--ink-2);margin-top:10px;';
    const imgText = document.createElement('span');
    imgText.textContent = 'Wrist camera frames (192 px JPEG)';
    const chkImages = document.createElement('input');
    chkImages.type = 'checkbox';
    chkImages.id = 'chkRecordImages';
    chkImages.style.cursor = 'pointer';
    imgRow.append(imgText, chkImages);
    sectTeleop.appendChild(imgRow);

    const recStatus = document.createElement('div');
    recStatus.className = 'export-status';
    recStatus.textContent = 'No episode recorded.';
    sectTeleop.appendChild(recStatus);

    on(chkImages, 'change', () => api.setRecordImages?.(chkImages.checked));

    on(btnXR, 'click', async () => {
      dismissHero();
      btnXR.disabled = true;
      btnXR.textContent = 'Requesting…';
      const ok = await api.startTeleop?.();
      const st = api.getTeleopState?.();
      btnXR.textContent = 'Start WebXR';
      btnXR.disabled = false;
      if (!ok) toast(st?.error || 'WebXR hand tracking is unavailable.', true);
      syncTeleop();
    });
    on(btnMock, 'click', () => {
      dismissHero();
      api.stopTeleop?.();
      api.startTeleopMock?.();
      toast('Mock hand drive started — 20-DoF joints follow a scripted curl.');
      syncTeleop();
    });
    on(btnStopTeleop, 'click', () => { api.stopTeleop?.(); syncTeleop(); });

    on(btnRecord, 'click', () => {
      const ep = api.getEpisodeState?.();
      if (ep?.recording) {
        const frames = api.stopRecording?.();
        toast(`Episode stopped · ${frames} frames`);
      } else {
        api.startRecording?.();
        api.setRecordImages?.(chkImages.checked);
        toast('Recording started · 30 Hz');
      }
      syncTeleop();
    });
    on(btnExportEpisode, 'click', () => {
      try {
        const res = api.exportEpisode?.();
        toast(`Episode exported · ${res?.frames ?? 0} frames (JSONL + meta)`);
      } catch (err) {
        toast('Episode export failed: ' + errText(err), true);
      }
    });

    let supported = null;
    api.teleopSupported?.().then((ok) => {
      supported = ok;
      if (!ok) teleopStatus.textContent = 'WebXR hand tracking unavailable here — the mock driver runs the same IK path.';
    });

    const syncTeleop = () => {
      const st = api.getTeleopState?.();
      const ep = api.getEpisodeState?.();
      if (st?.active) {
        teleopStatus.textContent = `${st.mode === 'xr' ? 'WebXR session' : 'Mock drive'} · ${st.frames} frames${st.error ? ' · ' + st.error : ''}`;
      } else if (st?.error) {
        teleopStatus.textContent = st.error;
      } else if (supported) {
        teleopStatus.textContent = 'WebXR hand tracking available. Start a session or use the mock.'.replace('available', 'available');
      }
      btnStopTeleop.disabled = !st?.active;
      btnRecord.textContent = ep?.recording ? 'Stop recording' : 'Record episode';
      btnRecord.classList.toggle('on', Boolean(ep?.recording));
      btnExportEpisode.disabled = !ep?.frames;
      if (ep) {
        recStatus.textContent = ep.recording
          ? `Recording · ${ep.frames} frames · ${ep.duration.toFixed(1)} s · ${ep.task}`
          : (ep.frames ? `${ep.frames} frames · ${ep.duration.toFixed(1)} s · ${ep.task}` : 'No episode recorded.');
      }
    };
    teleopTimer = setInterval(syncTeleop, 700);
    syncTeleop();
  }

  const sectExport = section('Export');
  let exportStatusEl = null;
  {
    const row = document.createElement('div');
    row.className = 'export-row';
    const bPng = document.createElement('button');
    bPng.type = 'button'; bPng.className = 'btn primary'; bPng.textContent = 'Save PNG';
    const bGlb = document.createElement('button');
    bGlb.type = 'button'; bGlb.className = 'btn secondary'; bGlb.textContent = 'Export GLB';
    row.append(bPng, bGlb);
    sectExport.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'export-row';
    row2.style.marginTop = '8px';
    const bUrdf = document.createElement('button');
    bUrdf.type = 'button'; bUrdf.className = 'btn secondary'; bUrdf.textContent = 'Export URDF';
    const bMjcf = document.createElement('button');
    bMjcf.type = 'button'; bMjcf.className = 'btn secondary'; bMjcf.textContent = 'MuJoCo XML';
    row2.append(bUrdf, bMjcf);
    sectExport.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'export-row';
    row3.style.marginTop = '8px';
    const bRos = document.createElement('button');
    bRos.type = 'button'; bRos.className = 'btn secondary'; bRos.style.width = '100%'; bRos.textContent = 'ROS 2 / MoveIt 2 Package (.zip)';
    row3.append(bRos);
    sectExport.appendChild(row3);

    exportStatusEl = document.createElement('div');
    exportStatusEl.className = 'export-status';
    exportStatusEl.setAttribute('aria-live', 'polite');
    sectExport.appendChild(exportStatusEl);
    on(bPng, 'click', () => runExport('PNG', bPng));
    on(bGlb, 'click', () => runExport('GLB', bGlb));
    on(bUrdf, 'click', () => runExport('URDF', bUrdf));
    on(bMjcf, 'click', () => runExport('MJCF', bMjcf));
    on(bRos, 'click', () => runExport('ROS2', bRos));
  }

  const sectStats = section('Runtime');
  const statRows = {};
  {
    [['Mode', 'mode'], ['Finish', 'skin'], ['Gesture', 'gesture'], ['Time', 'time'],
     ['Meshes', 'meshCount'], ['Wires', 'wireCount']].forEach(([label, key]) => {
      const div = document.createElement('div');
      div.className = 'kv';
      const a = document.createElement('span'); a.textContent = label;
      const b = document.createElement('b'); b.textContent = '—';
      div.append(a, b);
      sectStats.appendChild(div);
      statRows[key] = b;
    });
  }

  /* ------------------------------------------------------------ export */
  let exporting = false;
  async function runExport(kind, btn) {
    if (exporting) return;
    const fn = api['export' + kind];
    if (typeof fn !== 'function') {
      toast(kind + ' export is not available yet.', true);
      return;
    }
    exporting = true;
    dismissHero();
    if (btn) btn.disabled = true;
    setExportStatus('Preparing ' + kind + '…', false);
    toast('Preparing ' + kind + ' export…', false, true);
    try {
      await fn.call(api);
      setExportStatus(kind + ' export complete.', false);
      toast(kind + ' exported — check your downloads.');
    } catch (err) {
      setExportStatus(kind + ' export failed: ' + errText(err), true);
      toast(kind + ' export failed: ' + errText(err), true);
    } finally {
      exporting = false;
      if (btn) btn.disabled = false;
    }
  }
  function setExportStatus(msg, isErr) {
    if (!exportStatusEl) return;
    exportStatusEl.textContent = msg;
    exportStatusEl.classList.toggle('err', !!isErr);
  }
  on($('#btnPng'), 'click', () => runExport('PNG', null));

  /* ------------------------------------------------------------ part card */
  const partcard = $('#partcard');
  function showPart(info) {
    if (!partcard || !info) return;
    $('#partRole').textContent = info.role || 'Component';
    $('#partName').textContent = info.name || 'Selected part';
    $('#partDesc').textContent = info.description || '';
    const meta = $('#partMeta');
    meta.textContent = '';
    const details = Array.isArray(info.details) ? info.details : [];
    details.forEach((d) => {
      if (!d) return;
      const div = document.createElement('div');
      div.className = 'kv';
      const a = document.createElement('span'); a.textContent = String(d.label != null ? d.label : '');
      const b = document.createElement('b'); b.textContent = String(d.value != null ? d.value : '');
      div.append(a, b);
      meta.appendChild(div);
    });
    meta.style.display = details.length ? '' : 'none';
    partcard.classList.add('show');
    partcard.inert = false;
  }
  function hidePart() {
    if (!partcard) return;
    partcard.classList.remove('show');
    partcard.inert = true;
  }
  if (partcard) partcard.inert = true;
  on($('#partClose'), 'click', hidePart);

  /* ------------------------------------------------------------ keyboard */
  on(document, 'keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (drawerOpen) closeDrawer();
    else if (openPop) closePopovers();
    else if (partcard && partcard.classList.contains('show')) hidePart();
  });

  /* ------------------------------------------------------------ snapshot sync */
  function update(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const s = snapshot;
    if (typeof s.mode === 'string') state.mode = s.mode;
    if (typeof s.skin === 'string') state.skin = s.skin;
    if (typeof s.gesture === 'string') state.gesture = s.gesture;
    if (typeof s.playing === 'boolean' && s.playing !== state.playing) { state.playing = s.playing; armPoll(); }
    if (Number.isFinite(s.time) && !scrubbing) state.time = s.time;
    if (Number.isFinite(s.shellDepth)) state.shellDepth = s.shellDepth;
    if (Number.isFinite(s.curl)) state.curl = s.curl;
    if (s.story && typeof s.story === 'object') {
      const changed = !storyState || storyState.chapter !== s.story.chapter || storyState.active !== s.story.active;
      storyState = s.story;
      if (changed) renderTour();
    }
    if (Array.isArray(s.armAngles)) s.armAngles.slice(0, 7).forEach((v, i) => { if (Number.isFinite(v)) state.armAngles[i] = v; });
    if (Array.isArray(s.handAngles)) s.handAngles.slice(0, 20).forEach((v, i) => { if (Number.isFinite(v)) state.handAngles[i] = v; });
    if (s.stats && typeof s.stats === 'object') state.stats = s.stats;
    render();
  }

  let pollTimer = 0;
  function poll() {
    if (document.hidden || typeof api.snapshot !== 'function') return;
    let snap;
    try { snap = api.snapshot(); } catch (_) { return; }
    update(snap);
  }
  function armPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, state.playing ? 220 : 1200);
  }
  armPoll();
  on(document, 'visibilitychange', () => { if (!document.hidden) poll(); });

  /* ------------------------------------------------------------ render */
  function render() {
    qa('[data-group]').forEach((b) => {
      const g = b.dataset.group;
      const current = g === 'mode' ? state.mode : g === 'skin' ? state.skin
        : g === 'gesture' ? state.gesture : g === 'view' ? state.focus : null;
      const onNow = current === b.dataset.value;
      b.classList.toggle('on', onNow);
      b.setAttribute('aria-pressed', onNow ? 'true' : 'false');
    });
    playButtons.forEach((p) => {
      if (!p.el) return;
      p.el.innerHTML = state.playing ? ICON_PAUSE : ICON_PLAY;
      p.el.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
      p.el.setAttribute('aria-label', state.playing ? 'Pause motion' : 'Play motion');
      p.el.title = state.playing ? 'Pause motion' : 'Play motion';
    });
    renderTime();
    jointSliders.forEach((js) => {
      if (document.activeElement === js.input) return;
      if (js.arr === 'shell') {
        js.input.value = String(state.shellDepth);
        js.out.textContent = Math.round(state.shellDepth * 100) + '%';
        return;
      }
      if (js.arr === 'curl') {
        js.input.value = String(state.curl || 0);
        js.out.textContent = Math.round((state.curl || 0) * 100) + '%';
        return;
      }
      const arr = js.arr === 'arm' ? state.armAngles : state.handAngles;
      const v = arr[js.index];
      if (!Number.isFinite(v)) return;
      js.input.value = String(v);
      js.out.textContent = fmtAngle(js.info, v);
    });
    if (statRows.mode) {
      statRows.mode.textContent = labelFor(MODES, state.mode);
      statRows.skin.textContent = labelFor(SKINS, state.skin);
      statRows.gesture.textContent = labelFor(GESTURES, state.gesture);
      statRows.time.textContent = state.time.toFixed(2) + ' s';
      statRows.meshCount.textContent = state.stats && Number.isFinite(state.stats.meshCount) ? String(state.stats.meshCount) : '—';
      statRows.wireCount.textContent = state.stats && Number.isFinite(state.stats.wireCount) ? String(state.stats.wireCount) : '—';
    }
  }
  function renderTime() {
    timelines.forEach((t) => {
      if (state.time > parseFloat(t.max)) t.max = String(Math.ceil(state.time));
      if (!scrubbing && document.activeElement !== t) t.value = String(state.time);
    });
    tlabels.forEach((l) => { l.textContent = state.time.toFixed(1) + 's'; });
  }
  function labelFor(pairs, value) {
    const hit = pairs.find((p) => p[0] === value);
    return hit ? hit[1] : value;
  }

  render();

  /* ------------------------------------------------------------ dispose */
  function dispose() {
    heroSizeObserver.disconnect();
    clearInterval(pollTimer);
    clearInterval(physicsTimer);
    clearInterval(teleopTimer);
    cancelAnimationFrame(trajRaf);
    clearTimeout(toastTimer);
    listeners.forEach(([t, type, fn, opts]) => t.removeEventListener(type, fn, opts));
    listeners.length = 0;
  }

  return { update, dispose, showPart };
}
