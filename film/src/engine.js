// The film engine: maps global time T -> one fully composited frame.
// Pure function of T: any frame can be rendered on any worker, in any order.
import * as THREE from '../vendor/three.module.js';
import { Post, POST_DEFAULTS } from './post.js';
import { Overlay } from './overlay.js';
import { smoothstep, lerp, clamp } from './lib/ease.js';
import { fbm1 } from './lib/random.js';

const SCENE_MODULES = {
  black: './scenes/black.js',
  boot: './scenes/black.js',
  star: './scenes/star.js',
  fusion: './scenes/fusion.js',
  nebula: './scenes/nebula.js',
  earth: './scenes/earth.js',
  ocean: './scenes/ocean.js',
  tree: './scenes/tree.js',
  humans: './scenes/humans.js',
  planetary: './scenes/planetary.js',
  newworld: './scenes/newworld.js',
};

function lerpPost(a, b, k) {
  const o = {};
  for (const key of Object.keys(POST_DEFAULTS)) {
    const x = a[key] ?? POST_DEFAULTS[key], y = b[key] ?? POST_DEFAULTS[key];
    o[key] = Array.isArray(x) ? x.map((v, i) => lerp(v, y[i], k)) : lerp(x, y, k);
  }
  return o;
}

export class Film {
  constructor(timeline, { canvas, scale = 1 }) {
    this.tl = timeline;
    this.W = Math.round(timeline.width * scale);
    this.H = Math.round(timeline.height * scale);
    this.scale = scale;
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
    this.scenes = {}; // scene name -> instance
    this.ctx = { THREE, renderer: this.renderer, width: this.W, height: this.H, aspect: this.W / this.H, scale, timeline };
  }

  shotIndexAt(T) {
    const s = this.tl.shots;
    for (let i = 0; i < s.length; i++) if (T >= s[i].start && T < s[i].end) return i;
    return s.length - 1;
  }

  // Load the scene modules needed for [T0, T1] and drop the rest (keeps memory bounded per worker).
  async prepare(T0, T1) {
    const need = new Set();
    this.tl.shots.forEach((s, i) => {
      if (s.end > T0 && s.start <= T1) {
        need.add(s.scene);
        if (s.in && s.in.type === 'dissolve' && i > 0) need.add(this.tl.shots[i - 1].scene);
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

  renderShot(shot, T, target) {
    const inst = this.scenes[shot.scene];
    const lt = T - shot.start;
    const res = inst.update(shot, lt, T) || {};
    const cam = res.camera;
    const post = res.post || {};
    // deterministic camera shake
    let saved = null;
    if (cam && post.shake > 0) {
      saved = cam.quaternion.clone();
      const a = post.shake * 0.012;
      const e = new THREE.Euler(fbm1(T * 9.0 + 1.3) * a, fbm1(T * 9.0 + 7.1) * a, fbm1(T * 7.0 + 3.7) * a * 0.5);
      cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(e));
      cam.updateMatrixWorld();
    }
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    if (res.render) res.render(this.renderer, target);
    else if (res.scene && cam) this.renderer.render(res.scene, cam);
    if (saved) { cam.quaternion.copy(saved); cam.updateMatrixWorld(); }
    // project tracked atom
    let ret = null;
    if (res.target && cam) {
      const v = res.target.clone().project(cam);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      ret = { x: (v.x * 0.5 + 0.5) * 1920, y: (1 - (v.y * 0.5 + 0.5)) * 804, on };
    } else if (res.targetScreen) {
      ret = { x: res.targetScreen.x * 1920, y: res.targetScreen.y * 804, on: true };
    }
    return { post, reticle: ret };
  }

  async renderTime(T, frame) {
    const i = this.shotIndexAt(T);
    const shot = this.tl.shots[i];
    const lt = T - shot.start;
    await this.prepare(T, T);
    const A = this.renderShot(shot, T, this.post.hdrA);
    let src = this.post.hdrA;
    let post = { ...POST_DEFAULTS, ...A.post };
    let reticle = A.reticle;

    const tin = shot.in || { type: 'cut' };
    if (tin.type === 'dissolve' && lt < tin.dur && i > 0) {
      const prev = this.tl.shots[i - 1];
      const B = this.renderShot(prev, T, this.post.hdrB);
      const pb = { ...POST_DEFAULTS, ...B.post };
      const k = smoothstep(0, tin.dur, lt);
      src = this.post.blend(this.post.hdrB, this.post.hdrA, k, pb.exposure, post.exposure);
      post = lerpPost(pb, post, k); post.exposure = 1;
      if (k < 0.5 && B.reticle) reticle = B.reticle;
    }
    let fade = post.fade || 0;
    if (tin.type === 'fade') fade = Math.max(fade, 1 - smoothstep(0, tin.dur, lt));
    if (tin.type === 'white') post.flash = (post.flash || 0) + 4 * Math.pow(1 - clamp(lt / tin.dur), 2);
    if (shot.out && shot.out.type === 'fade') fade = Math.max(fade, smoothstep(shot.end - shot.out.dur, shot.end, T));
    post.fade = fade;

    this.overlay.draw({ T, shot, lt, frame, reticle });
    this.overlayTex.needsUpdate = true;
    this.post.finish(src, post, this.overlayTex, frame);
  }

  readPixels() {
    const gl = this.renderer.getContext();
    const buf = new Uint8Array(this.W * this.H * 4);
    gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }
}
