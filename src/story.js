// Guided tour coordinator: one story progress 0..1 driving camera + mode +
// gesture state. Native scroll, chapter buttons, Prev/Next and keyboard all
// write the same progress. Free explore releases the camera; Resume returns.
import * as THREE from 'three';
import { GESTURES, ARM_POSES } from './pose.js?v=short-20261012';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (u) => u * u * u * (u * (u * 6 - 15) + 10);

export const CHAPTERS = [
  { id: 'overview', label: 'Overview' },
  { id: 'palm', label: 'Palm' },
  { id: 'shell', label: 'Through the shell' },
  { id: 'forearm', label: 'Forearm' },
  { id: 'upper-arm', label: 'Upper arm' },
  { id: 'orbit', label: 'Whole form' },
  { id: 'orbit-360', label: '360° orbit', duration: 12 },
  { id: 'parts', label: 'Parts laid out' },
];
// Retain every original shot's duration; the orbit is an additional 12 seconds.
const STORY_DURATION = 108;

// Smooth acceleration/deceleration over 15% at each end, steady speed between.
const orbitEase = u => {
  const ramp = 0.15;
  if (u < ramp) { const t = u / ramp; return ramp * (t ** 3 - 0.5 * t ** 4) / (1 - ramp); }
  if (u > 1 - ramp) return 1 - orbitEase(1 - u);
  return (u - ramp / 2) / (1 - ramp);
};

export class Story {
  constructor(ctx) {
    // ctx: { model, pose, modes, materials, camera, controls, renderer, api,
    //        fullArmBounds, boundsOf, fitDistance, defaultDir }
    Object.assign(this, ctx);
    this.chapters = ctx.chapters ?? CHAPTERS;
    this.chapterDurations = this.chapters.map(c => c.duration ?? 96 / 7);
    this.chapterStarts = this.chapterDurations.map((_, i) => this.chapterDurations.slice(0, i).reduce((a, b) => a + b, 0));
    this.progress = 0;
    this.active = true;          // tour drives the camera
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._camPos = null;
    this._camTgt = null;
    this._appliedChapter = -1;
    this._explode = null;        // parallel worker module (setExplode)
    this._explodeEntered = false;
    this._camDir = new THREE.Vector3();
    this._spacer = null;
    this._scrollHandler = null;
    this._keyHandler = null;
    this._smooth = false;
    this.onChapter = null;       // UI callback(chapterIndex, progress)
    this._anchors = {};
    this.exact = document.body.dataset.defaultView === 'record' || new URLSearchParams(location.search).has('record');
    this.duration = ctx.duration ?? STORY_DURATION;
    this.timelineStart = ctx.timelineStart ?? (this.exact ? 15 / STORY_DURATION : 0);
    this.progress = this.timelineStart;
    this._scorePose(0);
    this._computeAnchors();
    this.enter();
  }

  /* ------------------------------------------------------------- anchors */
  _computeAnchors() {
    const { model, boundsOf, fullArmBounds } = this;
    model.root.updateMatrixWorld(true);
    const arm = fullArmBounds();
    this._anchors.arm = arm;
    const hand = model.nodeByName.get('hand');
    this._anchors.hand = boundsOf(hand);
    // One stable framing envelope for every gesture. Following live finger
    // bounds makes an otherwise stationary camera breathe on each pose change.
    this.pose.handAngles = [...GESTURES.open.hand];
    this.pose.apply();
    model.root.updateMatrixWorld(true);
    this._anchors.hand.union(boundsOf(hand));
    this._scorePose(0);
    model.root.updateMatrixWorld(true);
    const j6 = model.nodeByName.get('J6/mount');
    const fore = model.nodeByName.get('forearm');
    this._anchors.forearm = fore ? boundsOf(fore) : (j6 ? boundsOf(j6) : arm);
    const upper = model.nodeByName.get('upper-arm');
    const j2 = model.nodeByName.get('J2/mount');
    this._anchors.upper = upper ? boundsOf(upper) : (j2 ? boundsOf(j2) : arm);
    // Fixed rest-pose opening anchor: hand + wrist + forearm + elbow.
    // Keep it independent of later gesture bounds so reverse seeking is exact.
    const elbow = model.nodeByName.get('J4/mount');
    this._anchors.opening = elbow ? boundsOf(elbow) : this._anchors.hand.clone().union(this._anchors.forearm);
  }

  _frame(box, dir, margin = 1.12, lift = 0) {
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
    if (lift) center.y += lift;
    const dist = this.fitDistance(radius, margin);
    return {
      pos: center.clone().addScaledVector(dir, dist),
      tgt: center,
    };
  }

  /* --------------------------------------------------------- chapter map */
  chapterCount() { return this.chapters.length; }
  chapterOf(progress) {
    const seconds = clamp01(progress) * this.duration;
    for (let i = this.chapters.length - 1; i >= 0; i--) if (seconds >= this.chapterStarts[i]) return i;
    return 0;
  }
  localOf(progress) {
    const idx = this.chapterOf(progress);
    return clamp01((clamp01(progress) * this.duration - this.chapterStarts[idx]) / this.chapterDurations[idx]);
  }
  chapterProgress(idx, local = 0) { return (this.chapterStarts[idx] + this.chapterDurations[idx] * local) / this.duration; }

  _chapterState(progress) {
    const idx = this.chapterOf(progress);
    const local = this.localOf(progress);
    const A = this._anchors;
    const dir = this._camDir.copy(this.defaultDir);
    const st = { idx, local, cam: null, blend: null, side: null };
    switch (this.chapters[idx].id) {
      case 'overview':
        st.cam = this._openingFrame(local);
        st.blend = [1, 0];
        break;
      case 'palm': {
        // ease into a palm-side closeup
        const d = new THREE.Vector3(-0.55, 0.38, 0.74).normalize();
        const push = ease(clamp01((local - 0.18) / 0.66));
        st.cam = this._frame(A.hand, d, THREE.MathUtils.lerp(1.12, 0.92, push), 0);
        st.blend = [1, 0];
        break;
      }
      case 'shell': {
        const d = new THREE.Vector3(-0.55, 0.38, 0.74).normalize();
        st.cam = this._frame(A.hand, d, 0.92, 0);
        // One continuous shell passage: opaque -> frost -> open -> frost.
        const u = local;
        if (u < 0.4) st.blend = [1 - ease(u / 0.4), 0];
        else if (u < 0.7) st.blend = [0, ease((u - 0.4) / 0.3)];
        else st.blend = [0, 1 - ease((u - 0.7) / 0.3)];
        break;
      }
      case 'forearm': {
        const d = new THREE.Vector3(-0.35, 0.5, 0.79).normalize();
        st.cam = this._sweepFrame(A.forearm, d, local);
        st.blend = [0, 0];
        break;
      }
      case 'upper-arm': {
        const d = new THREE.Vector3(0.62, 0.3, 0.72).normalize();
        st.cam = this._sweepFrame(A.upper, d, local);
        st.blend = [0, 0];
        break;
      }
      case 'orbit': {
        st.cam = this._wholeFrame();
        const from = this._chapterState(this.chapterProgress(idx) - 1e-7).cam;
        const pull = ease(clamp01(local / 0.76));
        st.cam.pos.lerpVectors(from.pos, st.cam.pos.clone(), pull);
        st.cam.tgt.lerpVectors(from.tgt, st.cam.tgt.clone(), pull);
        st.blend = [0, 0];
        break;
      }
      case 'orbit-360': {
        st.cam = this._wholeFrame(orbitEase(local) * Math.PI * 2);
        st.blend = [0, 0];
        break;
      }
      case 'parts': {
        const assembled = this._chapterState(this.chapterProgress(idx) - 1e-7).cam;
        const separated = this._explodeFrame(clamp01((local - 0.14) / 0.86));
        const reveal = ease(clamp01((local - 0.14) / 0.22));
        st.cam = { pos: assembled.pos.lerp(separated.pos, reveal), tgt: assembled.tgt.lerp(separated.tgt, reveal) };
        st.blend = [0, 0];
        break;
      }
    }
    return st;
  }

  _wholeFrame(turn = 0) {
    const c = this._anchors.arm.getCenter(new THREE.Vector3());
    // A bounding sphere keeps the entire arm in frame from every azimuth.
    const r = this.fitDistance(Math.max(this._anchors.arm.getSize(new THREE.Vector3()).length() / 2, 0.05), 1.1);
    const theta = Math.atan2(this.defaultDir.x, this.defaultDir.z) + turn;
    return { pos: new THREE.Vector3(c.x + Math.sin(theta) * r, c.y + r * 0.18, c.z + Math.cos(theta) * r), tgt: c };
  }

  _openingFrame(local) {
    // 0–1.8 s: hold the upper assembly below the hero typography.
    // 1.8–11.2 s: dolly back and lower the target to reveal the full arm.
    // 11.2–13.7 s: a small lateral arc leads into the existing hand tour.
    const smoother = v => { const t = clamp01(v); return t * t * t * (t * (t * 6 - 15) + 10); };
    const pull = smoother((local - 0.13) / 0.69);
    const arc = smoother((local - 0.82) / 0.18);
    const direction = this.defaultDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), arc * 0.06);
    const full = this._frame(this._anchors.arm, direction, 1.04);
    const startTarget = this._anchors.opening.getCenter(new THREE.Vector3()).add(new THREE.Vector3(0.028, 0.007, 0));
    const target = startTarget.lerp(full.tgt, pull);
    const fullDistance = full.pos.distanceTo(full.tgt);
    const distance = fullDistance * THREE.MathUtils.lerp(this.camera.aspect < 0.8 ? 0.72 : 0.52, 1, pull);
    // Keep a constant screen-space gap below the copy throughout the pullback.
    // Recenter only after the introduction has completely faded.
    const screenUp = new THREE.Vector3(0, 1, 0).addScaledVector(direction, -direction.y).normalize();
    const settle = smoother((local - 0.78) / 0.22);
    target.addScaledVector(screenUp, distance * 0.105 * (1 - settle));
    return { pos: target.clone().addScaledVector(direction, distance), tgt: target };
  }

  getIntroOpacity() {
    if (!this.active || this.chapterOf(this.progress) !== 0) return 0;
    return 1 - ease(clamp01((this.localOf(this.progress) - 0.38) / 0.4));
  }

  _sweepFrame(box, direction, local) {
    const u = ease(local), size = box.getSize(new THREE.Vector3());
    const d = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (u - 0.5) * 0.3);
    const frame = this._frame(box, d, 0.98);
    const shift = new THREE.Vector3(0, (u - 0.5) * size.y * 0.24, 0);
    frame.pos.add(shift); frame.tgt.add(shift);
    return frame;
  }

  _explodeFrame(local) {
    if (this._explode) {
      const b = this._explode.getBounds?.();
      if (b && !b.isEmpty()) {
        const u = ease(clamp01((local - 0.44) / 0.5));
        const c = b.getCenter(new THREE.Vector3());
        const size = b.getSize(new THREE.Vector3());
        const d = new THREE.Vector3(0.25 * (1 - u), 0.75 * (1 - u), 0.62 + 0.38 * u).normalize();
        const tan = Math.tan(this.camera.fov * Math.PI / 360);
        const flatDist = Math.max(size.x / this.camera.aspect, size.y) / (2 * tan) * 1.065 + size.z / 2;
        const orbitDist = this.fitDistance(Math.max(size.length() / 2, 0.05), 1.06);
        return { pos: c.clone().addScaledVector(d, THREE.MathUtils.lerp(orbitDist, flatDist, u)), tgt: c };
      }
    }
    return this._frame(this._anchors.arm, this.defaultDir, 1.1);
  }

  // Pure gesture track: no independent play clock, so seeking is reversible.
  _scorePose(progress) {
    const idx = this.chapterOf(progress), local = this.localOf(progress);
    const pose = this.pose;
    pose.cancelMotion(); pose.curl = 0;
    pose.armAngles = [...ARM_POSES.rest.angles];
    let hand = [...GESTURES.relaxed.hand];
    if (idx === 1) {
      const keys = ['relaxed', 'open', 'pinch', 'point', 'peace', 'fist', 'open'];
      const t = local * (keys.length - 1), i = Math.min(keys.length - 2, Math.floor(t));
      const u = ease(t - i);
      hand = GESTURES[keys[i]].hand.map((v, j) => THREE.MathUtils.lerp(v, GESTURES[keys[i + 1]].hand[j], u));
    } else if (idx === 2) {
      // A scroll-driven finger wave underneath the shell transition.
      hand = [...GESTURES.open.hand];
      const envelope = Math.sin(Math.PI * local) ** 2;
      for (let f = 0; f < 5; f++) {
        const curl = Math.max(0, Math.sin(local * Math.PI * 5 - f * 0.65)) * envelope;
        for (let j = 1; j <= 3; j++) hand[f * 4 + j] += curl * [0, 38, 48, 26][j];
      }
      if (local > 0.8) hand = hand.map((v, j) => THREE.MathUtils.lerp(v, GESTURES.relaxed.hand[j], ease((local - 0.8) / 0.2)));
    }
    pose.handAngles = hand;
    pose.apply();
  }

  prepareScore() {
    if (this._scorePrepared || !this._explode) return;
    this.pose.cancelMotion();
    this.pose.armAngles = [...ARM_POSES.rest.angles];
    this.pose.handAngles = [...GESTURES.relaxed.hand];
    this.pose.curl = 0;
    this.pose.apply(); this.pose.flush();
    this.modes.set('transparent'); this.modes.snapBlend();
    this._explode.capture();
    this._scorePrepared = true;
  }

  /* ------------------------------------------------------------ entering */
  enter() {
    this.active = true;
    this._lastRenderedProgress = null;
    this._lastPoseKey = null;
    this._lastPoseProgress = null;
    this._scorePrepared = false;
    this.modes.set('transparent');
    document.body.classList.add('story');
    this.controls.enabled = false;
    // scroll track
    if (!this._spacer) {
      const sp = document.createElement('div');
      sp.id = 'story-space';
      sp.setAttribute('aria-hidden', 'true');
      document.body.appendChild(sp);
      this._spacer = sp;
    }
    this._spacer.style.display = 'block';
    document.body.style.overflow = 'auto';
    const vh = window.innerHeight;
    this._spacer.style.height = `${this.chapters.length * 110}vh`;
    if (!this._scrollHandler) {
      this._scrollHandler = () => {
        if (this.playbackDriven) return;
        if (Math.abs(window.scrollY - this._programmaticScrollY) < 1) return;
        this._programmaticScrollY = undefined;
        this.setProgress(this.fromScrollProgress(window.scrollY / this._maxScroll()), { fromScroll: true });
      };
      window.addEventListener('scroll', this._scrollHandler, { passive: true });
      this._keyHandler = (e) => {
        if (!this.active) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.key === 'PageDown') { e.preventDefault(); this.goTo(this.chapterOf(this.progress) + 1); }
        else if (e.key === 'PageUp') { e.preventDefault(); this.goTo(this.chapterOf(this.progress) - 1); }
        else if (e.key === 'Home') { e.preventDefault(); this.goTo(0); }
        else if (e.key === 'End') { e.preventDefault(); this.goTo(this.chapters.length - 1); }
      };
      window.addEventListener('keydown', this._keyHandler);
    }
    window.scrollTo({ top: this.toScrollProgress() * this._maxScroll(), behavior: 'instant' });
    this._applyChapterSideEffects(true);
  }

  exit() {
    this.active = false;
    document.body.classList.remove('story');
    document.body.style.overflow = 'hidden';
    if (this._spacer) this._spacer.style.display = 'none';
    this.controls.enabled = true;
    this._leaveParts();
  }

  _maxScroll() {
    return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  fromScrollProgress(p) { return this.timelineStart + clamp01(p) * (1 - this.timelineStart); }
  toScrollProgress(p = this.progress) { return clamp01((p - this.timelineStart) / (1 - this.timelineStart)); }

  setProgress(p, { fromScroll = false, immediate = false } = {}) {
    const target = Math.max(this.timelineStart, clamp01(p));
    if (!fromScroll && !immediate) {
      // Native scroll is the sole writer during a chapter-button journey.
      // Do not briefly jump the score to its destination before scrolling.
      const top = this.toScrollProgress(target) * this._maxScroll();
      this._programmaticScrollY = undefined;
      window.scrollTo({ top, behavior: this.reduced ? 'instant' : 'smooth' });
      if (Math.abs(window.scrollY - top) >= 1) return;
    }
    this.progress = target;
    this.onChapter?.(this.chapterOf(this.progress), this.progress);
  }

  goTo(idx) {
    idx = Math.min(this.chapters.length - 1, Math.max(0, idx));
    // Clicking the parts chapter reveals the finished layout; scrolling
    // remains available to scrub its assembly/explosion transition.
    const target = idx === this.chapters.length - 1 ? 1 : this.chapterProgress(idx, 0.001);
    this.setProgress(target);
  }

  next() { this.goTo(this.chapterOf(this.progress) + 1); }
  prev() { this.goTo(this.chapterOf(this.progress)); } // restart current chapter first

  setExplode(explodeLayout) {
    this._explode = explodeLayout;
  }

  _leaveParts() {
    if (!this._explodeEntered) return;
    this._explodeEntered = false;
    if (this._explode) {
      this._explode.root.visible = false;
      this._explode.setProgress?.(0, { layout: 'exploded', scope: 'all' });
    }
    this.model.root.visible = true;
    this.wiring.group.visible = true;
    this.pose.setPlaying(this._wasPlaying ?? false);
  }

  _applyChapterSideEffects(force = false) {
    const idx = this.chapterOf(this.progress);
    const showingParts = idx === this.chapters.length - 1 && this.localOf(this.progress) >= 0.14;
    if (!force && idx === this._appliedChapter && showingParts === this._explodeEntered) return;
    this._appliedChapter = idx;
    if (showingParts) {
      this.prepareScore();
      this._explodeEntered = true;
      if (this._explode) this._explode.root.visible = true;
      this.model.root.visible = false;
      this.wiring.group.visible = false;
    } else this._leaveParts();
  }

  update(dt) {
    if (!this.active) return;
    if (this.exact && this._lastRenderedProgress === this.progress && this._lastRenderedAspect === this.camera.aspect) return;
    this._applyChapterSideEffects();
    const changed = this._lastPoseProgress !== this.progress;
    const poseChapter = this.chapterOf(this.progress);
    const poseKey = poseChapter === 1 || poseChapter === 2 ? this.progress : 'rest';
    if (this._lastPoseKey !== poseKey) {
      this._scorePose(this.progress);
      this._lastPoseKey = poseKey;
    }
    this._lastPoseProgress = this.progress;
    const idx = this.chapterOf(this.progress), local = this.localOf(this.progress);
    if (idx === this.chapters.length - 1 && this._explode) this._explode.setScoreProgress(clamp01((local - 0.14) / 0.86));
    const st = this._chapterState(this.progress);
    // Camera keyframes blend in score space; the same value gives the same
    // desired frame whether reached by wheel, play, slider, or reverse seek.
    if (idx > 0 && local < 0.18 && this.chapters[idx].id !== 'orbit-360' && !(idx === 1 && this.timelineStart > 0)) {
      const prev = this._chapterState(this.chapterProgress(idx) - 1e-7);
      const k = ease(local / 0.18);
      st.cam.pos.lerpVectors(prev.cam.pos, st.cam.pos.clone(), k);
      st.cam.tgt.lerpVectors(prev.cam.tgt, st.cam.tgt.clone(), k);
      if (prev.blend && st.blend) st.blend = st.blend.map((v, j) => THREE.MathUtils.lerp(prev.blend[j], v, k));
    }
    const k = this.exact || this.reduced ? 1 : 1 - Math.exp(-dt * 7);
    if (!this._camPos) { this._camPos = st.cam.pos.clone(); this._camTgt = st.cam.tgt.clone(); }
    this._camPos.lerp(st.cam.pos, k); this._camTgt.lerp(st.cam.tgt, k);
    this.camera.position.copy(this._camPos);
    this.controls.target.copy(this._camTgt);
    this.camera.lookAt(this._camTgt);
    if (st.blend) {
      this.modes.setBlend(...st.blend);
      if (changed || this._lastExact !== this.exact) this.modes.snapBlend();
    }
    this._lastExact = this.exact;
    this._lastRenderedProgress = this.progress;
    this._lastRenderedAspect = this.camera.aspect;
  }

  resize() {
    // Model-space anchors do not depend on viewport size or current gesture.
    if (this._spacer && this.active) this._spacer.style.height = `${this.chapters.length * 110}vh`;
  }

  getState() {
    return {
      active: this.active,
      progress: this.progress,
      chapter: this.chapterOf(this.progress),
      chapters: this.chapters.map(c => ({ id: c.id, label: c.label })),
      explodeReady: !!this._explode,
    };
  }
}
