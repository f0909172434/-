// The dark room in front of the screen: near-black, a whisper of screen light, a few slow motes of dust
// drifting out of focus. Used for the chat, the title and the credits.
import * as THREE from '../../vendor/three.module.js';
import { SoftPoints } from '../look/points.js';
import { PAL } from '../look/palette.js';
import { Rand } from '../lib/random.js';

export default class Void {
  constructor(ctx) { this.ctx = ctx; }
  init() {
    const { width, height } = this.ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 10);
    const N = 220, r = new Rand(11);
    this.motes = new SoftPoints({ count: N, resolution: [width, height], focus: 10, aperture: 0.9, maxSize: 70 });
    this.base = [];
    for (let i = 0; i < N; i++) {
      const p = [r.range(-14, 14), r.range(-6, 6), r.range(-12, 6)];
      this.base.push({ p, ph: r.range(0, 6.28), sp: r.range(0.02, 0.07), b: r.range(0.02, 0.09) });
      this.motes.sizes[i] = r.range(1.2, 2.2);
    }
    this.scene.add(this.motes.mesh);
    // faint screen glow: a huge soft disc low in frame
    const g = new THREE.PlaneGeometry(40, 20);
    this.glow = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0.02 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ vec2 p=(vUv-vec2(0.5,0.38))*vec2(1.0,2.0); float d=length(p); gl_FragColor=vec4(vec3(0.55,0.62,0.75)*uA*exp(-d*d*9.0),1.0); }',
    }));
    this.glow.position.z = -20;
    this.scene.add(this.glow);
  }
  update(shot, t, T) {
    this.camera.aspect = shot._aspect || this.ctx.aspect; this.camera.updateProjectionMatrix();
    const black = shot.mode === 'black';
    const k = black ? 0.35 : 1;
    for (let i = 0; i < this.base.length; i++) {
      const b = this.base[i];
      const x = b.p[0] + Math.sin(T * b.sp + b.ph) * 0.6 + T * 0.03;
      const y = b.p[1] + Math.cos(T * b.sp * 0.8 + b.ph) * 0.4 + T * 0.01;
      this.motes.positions.set([((x + 14) % 28 + 28) % 28 - 14, y, b.p[2]], i * 3);
      const c = b.b * k;
      this.motes.colors.set([PAL.line.r * c, PAL.line.g * c, PAL.line.b * c], i * 3);
    }
    this.motes.update();
    this.glow.material.uniforms.uA.value = black ? 0.0 : 0.035;
    return { scene: this.scene, camera: this.camera, post: { bloomStrength: 0.2, streak: 0, halation: 0, vignette: 0.45, grain: 0.02 } };
  }
  dispose() { this.motes.dispose(); }
}
