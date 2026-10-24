// A single master score, shared by native scrolling and the recording player.
// Only this controller advances time; Story derives every visual from progress.
export function initScorePlayer(api, story) {
  const record = document.body.dataset.defaultView === 'record' || new URLSearchParams(location.search).has('record');
  const defaultDuration = story.duration * (1 - story.timelineStart);
  const state = { duration: defaultDuration, playing: false, seconds: 0, speed: 1, clean: false };
  let previousTime = performance.now(), hud, range, play, clock, chapter;
  const seek = seconds => {
    state.seconds = Math.max(0, Math.min(state.duration, Number(seconds) || 0));
    if (!story.active) story.enter();
    story.setProgress(story.fromScrollProgress(state.seconds / state.duration), { immediate: true });
    if (record) syncScroll();
    render();
  };
  const playScore = () => {
    if (state.seconds >= state.duration) seek(0);
    if (!story.active) story.enter();
    story.prepareScore(); // finish packing before the clock starts
    story.exact = true;
    story.playbackDriven = true;
    state.playing = true; previousTime = performance.now(); render();
  };
  const pause = () => {
    const wasPlaying = state.playing;
    state.playing = false; story.playbackDriven = false;
    if (record && wasPlaying) syncScroll();
    render();
  };
  const clean = value => {
    state.clean = value ?? !state.clean;
    document.body.classList.toggle('score-clean', state.clean);
    render();
  };
  api.score = {
    play: playScore, pause, seek,
    setProgress: p => seek(Number(p) * state.duration),
    setDuration: seconds => {
      const p = state.seconds / state.duration;
      state.duration = Math.max(10, Math.min(600, Number(seconds) || defaultDuration));
      seek(p * state.duration);
    },
    setSpeed: speed => { state.speed = Math.max(0.25, Math.min(2, Number(speed) || 1)); },
    clean, getState: () => ({ ...state, progress: story.toScrollProgress(), storyProgress: story.progress }),
  };
  // Detached layout is prepared on-demand when entering explode chapter
  // story.prepareScore();
  if (!record) {
    const link = document.createElement('a');
    link.href = './?record=1&ui=120&v=3'; link.textContent = 'Record'; link.title = 'Open the 16:9 master score';
    link.style.cssText = 'pointer-events:auto;color:var(--ink-2);font-size:12px;text-decoration:none;padding:6px 10px;border:1px solid var(--line);border-radius:99px;background:var(--card)';
    document.querySelector('header')?.append(link);
    return { update() { if (state.playing) advance(); } };
  }
  document.body.classList.remove('score-clean', 'score-quiet');
  document.body.classList.add('recording');
  document.documentElement.dataset.recordUi = 'short-v8';
  document.title = 'FORM / 01 — Master Score';
  const style = document.createElement('link');
  style.rel = 'stylesheet'; style.href = new URL('./score.css?v=short-20261012', import.meta.url).href;
  document.head.append(style);
  hud = document.createElement('section'); hud.id = 'score-hud'; hud.setAttribute('aria-label', 'Master score recording controls');
  hud.innerHTML = `
    <div id="score-controls">
      <button id="score-play" aria-pressed="false" aria-label="Play master score" title="Play">
        <svg class="play-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.8c0-.6.7-1 1.2-.7l8 5.2c.5.3.5 1.1 0 1.4l-8 5.2c-.5.3-1.2-.1-1.2-.7Z"/></svg>
        <svg class="pause-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>
      </button>
      <input id="score-range" aria-label="Master score progress" aria-orientation="vertical" type="range" min="0" max="1" step="0.0001" value="0">
      <output id="score-clock" aria-label="Playback time"><span id="score-current">0:00</span><span id="score-duration">0:15</span></output>
      <details id="score-more">
        <summary aria-label="More recording options" title="More">···</summary>
        <div id="score-menu">
          <span id="score-chapter">3 → 1</span>
          <label for="score-gesture">Hand gesture<select id="score-gesture" aria-label="Hand gesture"><option value="three">Three · 3</option><option value="one">One · 1</option></select></label>
          <label for="score-finish">Shell finish<select id="score-finish" aria-label="Shell finish">
        <option value="frost">Frost</option><option value="crystal">Crystal</option>
        <option value="smoke">Smoke</option><option value="glacier">Glacier</option><option value="amber">Amber</option>
      </select></label>
          <label for="score-speed">Playback speed<select id="score-speed" aria-label="Playback speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option></select></label>
          <button id="score-reset">Restart <span>R</span></button>
          <button id="score-hide">Hide UI <span>H</span></button>
          <button id="score-full">Full screen</button>
          <button id="score-engineering">Engineering controls</button>
          <a id="score-back" href="./">Free explore ↗</a>
        </div>
      </details>
    </div>`;
  if (document.body.dataset.defaultView === 'record') hud.querySelector('#score-back').href = './explore.html';
  document.body.append(hud);
  play = hud.querySelector('#score-play'); range = hud.querySelector('#score-range');
  const mobileRail = window.matchMedia('(max-width:600px)');
  const orientRail = () => range.setAttribute('aria-orientation', mobileRail.matches ? 'horizontal' : 'vertical');
  mobileRail.addEventListener('change', orientRail); orientRail();
  clock = hud.querySelector('#score-clock'); chapter = hud.querySelector('#score-chapter');
  const current = hud.querySelector('#score-current'), duration = hud.querySelector('#score-duration');
  const hero = document.getElementById('hero');
  if (hero) { hero.hidden = true; hero.setAttribute('aria-hidden', 'true'); }
  const finish = hud.querySelector('#score-finish');
  const cached = {};
  const change = (key, value, write) => { if (cached[key] !== value) { cached[key] = value; write(value); } };
  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  let lastHudTime = 0;
  play.onclick = () => state.playing ? pause() : playScore();
  hud.querySelector('#score-reset').onclick = () => { pause(); seek(0); };
  range.oninput = () => { const seconds = Number(range.value) * state.duration; pause(); seek(seconds); };
  hud.querySelector('#score-speed').onchange = e => api.score.setSpeed(e.target.value);
  const more = hud.querySelector('#score-more');
  hud.querySelector('#score-finish').onchange = e => { pause(); if (story.active) api.freeExplore(); api.setSkin(e.target.value); };
  hud.querySelector('#score-gesture').onchange = e => { pause(); if (story.active) api.freeExplore(); api.setGesture(e.target.value); };
  hud.querySelector('#score-engineering').onclick = () => { more.open = false; pause(); if (story.active) api.freeExplore(); document.getElementById('btnDrawer')?.click(); };
  hud.querySelector('#score-hide').onclick = () => { more.open = false; clean(true); };
  document.addEventListener('pointerdown', e => { if (!more.contains(e.target)) more.open = false; });
  hud.querySelector('#score-full').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  window.addEventListener('keydown', e => {
    if (['SELECT', 'TEXTAREA'].includes(e.target.tagName) || (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return;
    if (e.target.type === 'range' && e.key.startsWith('Arrow')) return;
    if (e.code === 'Space' && ['SUMMARY', 'BUTTON', 'A'].includes(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); state.playing ? pause() : playScore(); }
    if (e.key.toLowerCase() === 'h') clean();
    if (e.key.toLowerCase() === 'r') { pause(); seek(0); }
    if (e.key === 'Escape') { more.open = false; clean(false); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); pause(); seek(state.seconds + (e.key === 'ArrowRight' ? 1 : -1)); }
  });
  document.addEventListener('click', e => {
    const target = e.target.closest('header, #dock, #chapters, #tourCtl, #drawer');
    if (!target) return;
    pause();
    const group = e.target.closest('[data-group]')?.dataset.group;
    if (story.active && ['mode', 'gesture', 'view'].includes(group)) api.freeExplore();
  }, { capture:true });
  window.addEventListener('wheel', pause, { passive:true });
  window.addEventListener('touchstart', e => { if (!hud.contains(e.target)) pause(); }, { passive:true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  function render() {
    if (!hud) return;
    // Only scene copy is hidden. Product navigation and transport stay visible.
    if (document.activeElement !== finish) change('finish', story.materials.skinId, v => { finish.value = v; });
    if (story.active) change('gesture', story.pose.gesture, v => { hud.querySelector('#score-gesture').value = v; });
    change('playing', state.playing, v => {
      play.dataset.playing = String(v); play.title = v ? 'Pause' : 'Play';
      play.setAttribute('aria-pressed', String(v));
      play.setAttribute('aria-label', `${v ? 'Pause' : 'Play'} master score`);
      document.body.classList.toggle('score-playing', v);
    });
    const now = performance.now();
    if (!state.playing || now - lastHudTime >= 33) {
      lastHudTime = now;
      change('progress', story.toScrollProgress().toFixed(5), v => {
        range.value = v; range.style.setProperty('--progress', `${Number(v) * 100}%`);
      });
    }
    change('time', fmt(state.seconds), v => { current.textContent = v; });
    change('duration', fmt(state.duration), v => { duration.textContent = v; });
    change('accessibleTime', `${fmt(state.seconds)} of ${fmt(state.duration)}`, v => range.setAttribute('aria-valuetext', v));
    change('chapter', story.chapterOf(story.progress), v => { chapter.textContent = story.getState().chapters[v].label; });
  }
  function syncScroll() {
    story._programmaticScrollY = Math.round(story.toScrollProgress() * story._maxScroll());
    window.scrollTo({ top: story._programmaticScrollY, behavior: 'instant' });
  }
  function advance() {
    const now = performance.now(), dt = Math.max(0, (now - previousTime) / 1000);
    previousTime = now;
    state.seconds = Math.min(state.duration, state.seconds + dt * state.speed);
    story.setProgress(story.fromScrollProgress(state.seconds / state.duration), { immediate:true });
    if (record && story.scrollFilm) syncScroll();
    if (state.seconds >= state.duration) pause();
    render();
  }
  // The score is ready before the first take starts.
  story.setProgress(story.timelineStart, { immediate:true });
  syncScroll();
  window.dispatchEvent(new Event('resize'));
  render();
  return { update() {
    if (state.playing) advance();
    else { state.seconds = story.toScrollProgress() * state.duration; render(); }
  } };
}
