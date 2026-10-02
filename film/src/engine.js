// The film engine: maps global time T -> one fully composited frame.
// Pure function of T: any frame can be rendered on any worker, in any order.
//
// Per frame: N sub-frames spread over the shutter interval (motion blur), each with a sub-pixel
// camera jitter (anti-aliasing), accumulated in HDR. A shot can be a single scene, a split screen
// (two scenes side by side, scissored), a time-remapped replay of another shot (the rewind montage),
// or a dissolve between two of those.
import * as THREE from '../vendor/three.module.js';
import { Post, POST_DEFAULTS } from './post.js';
import { Overlay } from './overlay.js';
import { smoothstep, lerp, clamp } from './lib/ease.js';
import { fbm1 } from './lib/random.js';

const SCENE_MODULES = {
  void: './scenes/void.js',
  chip: './scenes/chip.js',
  star: './scenes/star.js',
  drift: './scenes/drift.js',
  earth: './scenes/earth.js',
  life: './scenes/life.js',
  stone: './scenes/stone.js',
  beach: './scenes/beach.js',
  foundry: './scenes/foundry.js',
  contact: './scenes/contact.js',
};

function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

function lerpPost(a, b, k) {
  const o = {};
  for (const key of Object.keys(POST_DEFAULTS)) {
    const x = a[key] ?? POST_DEFAULTS[key], y = b[key] ?? POST_DEFAULTS[key];
    o[key] = Array.isArray(x) ? x.map((v, i) => lerp(v, y[i], k)) : lerp(x, y, k);
  }
  return o;
}

export class Film {
  constructor(timeline, { canvas, scale = 1, samples = null }) {
    this.tl = timeline;
    this.W = Math.round(timeline.width * scale);
    this.H = Math.round(timeline.height * scale);
    this.scale = scale;
    this.samplesOverride = samples;
    this.byId = Object.fromEntries(timeline.shots.map(s => [s.id, s]));
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.W, this.H, false);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.post = new Post(this.renderer, this.W, this.H);
    this.overlay = new Overlay(timeline, this.W, this.H);
    this.overlayTex = new THREE.CanvasTexture(this.overlay.canvas);
    this.overlayTex.colorSpace = THREE.NoColorSpace;
    this.overlayTex.minFilter = THREE.LinearFilter; this.overlayTex.generateMipmaps = false;
    this.scenes = {};
    this.ctx = { THREE, renderer: this.renderer, width: this.W, height: this.H, aspect: this.W / this.H, scale, timeline };
  }

  shotIndexAt(T) {
    const s = this.tl.shots;
    for (let i = 0; i < s.length; i++) if (T >= s[i].start && T < s[i].end) return i;
    return s.length - 1;
  }

  scenesOf(shot) {
    if (shot.split) return [shot.split.L.scene, shot.split.R.scene];
    return [shot.scene];
  }

  async prepare(T0, T1) {
    const need = new Set();
    this.tl.shots.forEach((s, i) => {
      if (s.end > T0 && s.start <= T1) {
        this.scenesOf(s).forEach(n => need.add(n));
        if (s.in && s.in.type === 'dissolve' && i > 0 && T0 < s.start + s.in.dur) this.scenesOf(this.tl.shots[i - 1]).forEach(n => need.add(n));
      }
    });
    for (const name of Object.keys(this.scenes)) {
      if (!need.has(name)) { this.scenes[name].dispose?.(); delete this.scenes[name]; }
    }
    for (const name of need) {
      if (this.scenes[name]) continue;
      const mod = await import(SCENE_MODULES[name]);
      const inst = new mod.default(this.ctx);
      await inst.init?.();
      this.scenes[name] = inst;
    }
  }

  // The scene calls ("views") that make up a shot at sub-frame time Ts.
  views(shot, Ts) {
    const aspect = this.W / this.H;
    if (shot.split) {
      const seam = this.tl.split?.seam ?? 0.5;
      return ['L', 'R'].map(side => {
        const spec = shot.split[side];
        const src = spec.source ? this.byId[spec.source] : shot;
        const vshot = { ...src, ...spec, id: src.id, start: src.start, end: src.end, split: undefined, _half: side, _aspect: aspect };
        const lt = spec.hold != null ? spec.hold : Ts - src.start;
        return { vshot, lt, T: Ts, half: side, seam };
      });
    }
    if (shot.remap) {
      const src = this.byId[shot.source];
      const k = clamp((Ts - shot.start) / (shot.end - shot.start), 0, 1);
      const lt = lerp(shot.remap[0], shot.remap[1], k);
      const vshot = { ...src, scene: shot.scene, mode: shot.mode ?? src.mode, split: undefined, _aspect: aspect, _rewind: true };
      return [{ vshot, lt, T: src.start + lt }];
    }
    return [{ vshot: { ...shot, _aspect: aspect }, lt: Ts - shot.start, T: Ts }];
  }

  // Render all views of a shot into `rt`. Returns exposures per half, post params and projected targets.
  renderViews(views, rt, jitter, wantTargets) {
    const r = this.renderer;
    r.setRenderTarget(rt); rt.scissorTest = false; r.setClearColor(0x000000, 1); r.clear();
    const out = { exp: [1, 1], seam: 2, post: null, targets: {} };
    for (const v of views) {
      const inst = this.scenes[v.vshot.scene];
      const res = inst.update(v.vshot, v.lt, v.T) || {};
      const cam = res.camera;
      const post = { ...POST_DEFAULTS, ...(res.post || {}) };
      if (!out.post || v.half === 'L') out.post = post;
      if (v.half === 'R') out.exp[1] = post.exposure; else { out.exp[0] = post.exposure; if (!v.half) out.exp[1] = post.exposure; }
      if (v.half) {
        out.seam = v.seam;
        const x = v.half === 'L' ? 0 : Math.round(v.seam * this.W);
        const w = v.half === 'L' ? Math.round(v.seam * this.W) : this.W - Math.round(v.seam * this.W);
        rt.scissor.set(x, 0, w, this.H); rt.scissorTest = true;
      } else rt.scissorTest = false;
      r.setRenderTarget(rt);
      // targets are projected with the un-jittered camera
      if (wantTargets && cam) {
        cam.updateMatrixWorld();
        for (const [name, p] of Object.entries(res.targets || {})) {
          if (!p) continue;
          const q = p.clone().project(cam);
          out.targets[name] = { x: (q.x * 0.5 + 0.5) * 1920, y: (1 - (q.y * 0.5 + 0.5)) * 804, on: q.z < 1 && q.z > -1, half: v.half };
        }
      }
      for (const [name, p] of Object.entries(res.targetsScreen || {})) if (p && wantTargets) out.targets[name] = { x: p.x * 1920, y: p.y * 804, on: true, half: v.half };
      let saved = null;
      if (cam) {
        if (post.shake > 0) {
          saved = cam.quaternion.clone();
          const a = post.shake * 0.012;
          cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(fbm1(v.T * 9.0 + 1.3) * a, fbm1(v.T * 9.0 + 7.1) * a, fbm1(v.T * 7.0 + 3.7) * a * 0.5)));
          cam.updateMatrixWorld();
        }
        if (jitter[0] || jitter[1]) cam.setViewOffset(this.W, this.H, jitter[0], jitter[1], this.W, this.H);
      }
      if (res.render) res.render(r, rt);
      else if (res.scene && cam) r.render(res.scene, cam);
      if (cam) {
        if (jitter[0] || jitter[1]) cam.clearViewOffset();
        if (saved) { cam.quaternion.copy(saved); cam.updateMatrixWorld(); }
      }
    }
    rt.scissorTest = false;
    return out;
  }

  async renderTime(T, frame) {
    const i = this.shotIndexAt(T);
    const shot = this.tl.shots[i];
    const lt = T - shot.start;
    await this.prepare(T, T);
    const D = this.tl.defaults || {};
    const N = Math.max(1, this.samplesOverride ?? shot.samples ?? D.samples ?? 1);
    const shutter = shot.shutter ?? D.shutter ?? 0.5;
    const tin = shot.in || { type: 'cut' };
    const prev = i > 0 ? this.tl.shots[i - 1] : null;
    const P = this.post;
    P.clearAccum();
    let mid = null;
    const midIdx = Math.floor(N / 2);
    for (let s = 0; s < N; s++) {
      const Ts = N > 1 ? T + ((s + 0.5) / N - 0.5) * shutter / this.tl.fps : T;
      const jit = N > 1 ? [halton(s + 1, 2) - 0.5, halton(s + 1, 3) - 0.5] : [0, 0];
      const want = s === midIdx;
      const A = this.renderViews(this.views(shot, Ts), P.hdrA, jit, want);
      let B = null, k = 1;
      if (tin.type === 'dissolve' && prev && Ts - shot.start < tin.dur) {
        B = this.renderViews(this.views(prev, Ts), P.hdrB, jit, want);
        k = smoothstep(0, tin.dur, Ts - shot.start);
      }
      P.accumulate({ rt: P.hdrA, exp: A.exp, seam: A.seam }, B ? { rt: P.hdrB, exp: B.exp, seam: B.seam } : null, k, 1 / N);
      if (want) mid = { A, B, k };
    }

    let post = mid.A.post;
    let targets = mid.A.targets;
    if (mid.B) {
      post = lerpPost(mid.B.post, mid.A.post, mid.k);
      if (mid.k < 0.5) targets = { ...mid.A.targets, ...mid.B.targets };
    }
    post = { ...post, exposure: 1 };
    let fade = post.fade || 0;
    if (tin.type === 'fade') fade = Math.max(fade, 1 - smoothstep(0, tin.dur, lt));
    if (tin.type === 'white') post.flash = (post.flash || 0) + 4 * Math.pow(1 - clamp(lt / tin.dur), 2);
    if (shot.out && shot.out.type === 'fade') fade = Math.max(fade, smoothstep(shot.end - shot.out.dur, shot.end, T));
    post.fade = fade;

    this.overlay.draw({ T, shot, lt, frame, targets });
    this.overlayTex.needsUpdate = true;
    P.finish(P.accum, post, this.overlayTex, frame);
  }

  readPixels() {
    const gl = this.renderer.getContext();
    const buf = new Uint8Array(this.W * this.H * 4);
    gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }
}
