// Stellar core at 10^-15 m: triple-alpha fusion.
// Three helium-4 nuclei spiral through a blizzard of hot plasma and fuse into carbon-12 at t = 10.5.
import * as THREE from '../../vendor/three.module.js';
import { simplex3, hash } from '../lib/glsl.js';
import { Rand, fbm1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, easeOutBack, easeInOutSine } from '../lib/ease.js';
import { ridge3 } from '../lib/vnoise3.js';

const T_FUSE = 10.5;
const BOX_MIN = new THREE.Vector3(-55, -30, -55);
const BOX_SIZE = new THREE.Vector3(110, 60, 110);

// ---------- plasma particles (shared motion) ----------
const MOTION = /* glsl */`
uniform float uT, uFocus, uCoc, uPx, uMaxPx;
uniform vec3 uBoxMin, uBoxSize, uFlow;
attribute vec4 aP0; // start xyz, seed
attribute vec4 aV;  // own velocity xyz, brightness
attribute vec4 aW;  // swirl amplitude, frequency, phase, colour class
vec3 swirl(float t){ return vec3(sin(t*aW.y + aW.z), sin(t*aW.y*1.13 + aW.z*2.1), cos(t*aW.y*0.87 + aW.z*1.7))*aW.x; }
vec3 rawAt(float t){ return aP0.xyz + (uFlow + aV.xyz)*t + swirl(t); }
vec3 posAt(float t){ return mod(rawAt(t) - uBoxMin, uBoxSize) + uBoxMin; }
vec3 velAt(float t){
  return uFlow + aV.xyz + vec3(cos(t*aW.y + aW.z)*aW.y, cos(t*aW.y*1.13 + aW.z*2.1)*aW.y*1.13, -sin(t*aW.y*0.87 + aW.z*1.7)*aW.y*0.87)*aW.x;
}
vec3 plasmaCol(float c){
  if(c < 0.5) return vec3(1.45, 1.75, 2.6);      // blue-white
  if(c < 1.5) return vec3(2.7, 1.75, 0.85);      // gold
  return vec3(2.4, 0.75, 0.32);                  // orange
}
float cocPx(float z){ return abs(1.0/z - 1.0/uFocus)*uCoc*uPx; }
`;

const STREAK_VERT = /* glsl */`
${MOTION}
attribute float aTail;
uniform float uLen;
varying vec3 vCol; varying float vA;
void main(){
  // curved trail: vertex j of the polyline sits at an earlier time, unwrapped relative to the head
  vec3 p = posAt(uT) + rawAt(uT - uLen*aTail) - rawAt(uT);
  vec4 mv = modelViewMatrix*vec4(p, 1.0);
  gl_Position = projectionMatrix*mv;
  float z = max(-mv.z, 0.1);
  float c = cocPx(z);
  float focus = 1.0 - smoothstep(3.0*uPx, 7.0*uPx, c);
  vA = 2.2*aV.w*focus*pow(1.0 - aTail, 1.5)*smoothstep(0.5, 3.0, z);
  vCol = plasmaCol(aW.w);
}`;

const BOKEH_VERT = /* glsl */`
${MOTION}
varying vec3 vCol; varying float vA;
void main(){
  vec3 p = posAt(uT);
  vec4 mv = modelViewMatrix*vec4(p, 1.0);
  gl_Position = projectionMatrix*mv;
  float z = max(-mv.z, 0.1);
  float c = cocPx(z);
  float focus = 1.0 - smoothstep(3.0*uPx, 7.0*uPx, c);
  float sz = clamp(c, 3.0*uPx, uMaxPx);
  gl_PointSize = sz;
  // energy conservation: a defocused point spreads its light
  vA = aV.w*(1.0 - focus)*clamp(12.0*uPx*uPx/(sz*sz), 0.0, 1.0)*1.5*smoothstep(0.5, 3.0, z)*smoothstep(0.04, 0.3, aV.w)*step(0.55, fract(aP0.w*7.31));
  vCol = plasmaCol(aW.w);
}`;
const BOKEH_FRAG = /* glsl */`
varying vec3 vCol; varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5)*2.0;
  float a = (1.0 - smoothstep(0.55, 1.0, d))*(0.75 + 0.25*smoothstep(0.3, 0.8, d));
  if(a*vA < 0.002) discard;
  gl_FragColor = vec4(vCol*a*vA, 1.0);
}`;
const LINE_FRAG = /* glsl */`
varying vec3 vCol; varying float vA;
void main(){ gl_FragColor = vec4(vCol*vA, 1.0); }`;

// ---------- nucleons ----------
const NUC_VERT = /* glsl */`
varying vec3 vN; varying vec3 vW; varying vec3 vL;
void main(){
  vN = normalize(mat3(modelMatrix)*normal);
  vL = normal;
  vec4 wp = modelMatrix*vec4(position, 1.0); vW = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;
const NUC_FRAG = /* glsl */`
uniform vec3 uCore, uRim, uKey;
uniform float uTime, uSeed, uHeat;
varying vec3 vN; varying vec3 vW; varying vec3 vL;
${simplex3}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  // churning interior: three quark-ish hot spots + turbulent glow
  vec3 q = vL*1.6 + vec3(uSeed*7.0);
  float n1 = snoise(q + vec3(0.0, uTime*0.9, 0.0));
  float n2 = snoise(q*2.3 - vec3(uTime*1.3, 0.0, uSeed));
  float churn = 0.6 + 0.22*n1 + 0.12*n2;
  float body = pow(mu, 1.1);
  float hot = pow(mu, 6.0);
  float fres = pow(1.0 - mu, 3.0);
  float key = 0.5 + 0.5*clamp(dot(N, normalize(uKey)), 0.0, 1.0);
  vec3 col = uCore*body*(0.35 + 0.7*churn)*key + uCore*hot*0.9*(0.6 + 0.6*churn) + uRim*fres*(0.8 + 0.4*n2);
  col *= 1.0 + uHeat;
  gl_FragColor = vec4(col, 1.0);
}`;

// soft glows
const GLOW_VERT = /* glsl */`
attribute vec4 aC; // colour rgb, size
uniform float uPx;
varying vec3 vCol;
void main(){
  vec4 mv = modelViewMatrix*vec4(position, 1.0);
  gl_Position = projectionMatrix*mv;
  gl_PointSize = aC.w*uPx/max(-mv.z, 0.5);
  vCol = aC.rgb;
}`;
const GLOW_FRAG = /* glsl */`
varying vec3 vCol;
void main(){
  float d = length(gl_PointCoord - 0.5)*2.0;
  float g = exp(-d*d*5.0)*0.6 + exp(-d*3.5)*0.4;
  g *= 1.0 - smoothstep(0.8, 1.0, d);
  gl_FragColor = vec4(vCol*g, 1.0);
}`;

// gamma burst at fusion (radial streaks)
const BURST_VERT = /* glsl */`
attribute vec4 aD; // dir, speed
attribute vec2 aE; // tail, bright
uniform float uT;
varying vec3 vCol; varying float vA;
void main(){
  float tt = max(uT - aE.x*0.07, 0.0);
  vec3 p = aD.xyz*(1.6 + aD.w*tt);
  vec4 mv = modelViewMatrix*vec4(p, 1.0);
  gl_Position = projectionMatrix*mv;
  vA = aE.y*(1.0 - aE.x)*exp(-uT*2.2)*step(0.0, uT)*smoothstep(0.5, 3.0, -mv.z);
  vCol = mix(vec3(3.0, 3.4, 4.5), vec3(4.0, 2.4, 1.2), aE.y);
}`;

// background: the incandescent core medium, vertex-coloured (cheap)
const BG_VERT = /* glsl */`
uniform float uT, uInt;
varying vec3 vCol;
${simplex3}
void main(){
  vec3 d = normalize(position);
  float n = fbm3(d*3.2 + vec3(uT*0.05, 0.0, -uT*0.03));
  float m = fbm3(d*5.5 + vec3(3.1, -uT*0.08, 1.7));
  vec3 a = vec3(0.010, 0.002, 0.003), b = vec3(0.13, 0.032, 0.012), c = vec3(0.06, 0.010, 0.05);
  vec3 col = mix(a, b, smoothstep(-0.35, 0.55, n));
  col = mix(col, c, smoothstep(0.1, 0.6, m)*0.5);
  // the medium glows hotter around the action (direction of the origin as seen from the camera)
  float focusGlow = pow(max(dot(normalize(position - cameraPosition), normalize(-cameraPosition)), 0.0), 60.0);
  vCol = col*uInt*(0.55 + 0.5*smoothstep(-0.2, 0.6, m*n + 0.3)) + vec3(0.22, 0.075, 0.03)*focusGlow*uInt*(0.6 + 0.4*n);
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0);
}`;
const BG_FRAG = /* glsl */`varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol, 1.0); }`;

const add = (vert, frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, ...extra });

export default class Fusion {
  constructor(ctx) {
    this.ctx = ctx;
    this.px = ctx.height / 804;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, ctx.aspect, 0.2, 2000);
  }

  async init() {
    const rnd = new Rand(4343);
    const S = this.scene;
    // ---- background medium
    this.bgU = { uT: { value: 0 }, uInt: { value: 1 } };
    this.bg = new THREE.Mesh(new THREE.SphereGeometry(600, 160, 80), new THREE.ShaderMaterial({ vertexShader: BG_VERT, fragmentShader: BG_FRAG, uniforms: this.bgU, side: THREE.BackSide, depthWrite: false }));
    this.bg.renderOrder = -10;
    S.add(this.bg);

    // ---- plasma blizzard
    const N = 11000;
    const P0 = new Float32Array(N * 4), V = new Float32Array(N * 4), W = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      // plasma gathers in flowing sheets and filaments (ridged noise), with a thin uniform background
      let x, y, z;
      for (;;) {
        x = BOX_MIN.x + rnd.next() * BOX_SIZE.x; y = BOX_MIN.y + rnd.next() * BOX_SIZE.y; z = BOX_MIN.z + rnd.next() * BOX_SIZE.z;
        const d = smoothstep(0.62, 0.9, ridge3(x / 26 + 3.1, y / 18, z / 26 - 1.7, 3));
        if (rnd.next() < 0.10 + 0.9 * d) break;
      }
      P0.set([x, y, z, rnd.next()], i * 4);
      const fast = rnd.next() < 0.18;
      const b = Math.pow(rnd.next(), 4.0) * (fast ? 2.6 : 1.2) + 0.03;
      V.set([rnd.gauss() * 7, rnd.gauss() * 4.5, rnd.gauss() * 7].map(x => x * (fast ? 2.4 : 1)).concat([b]), i * 4);
      const cc = rnd.next();
      W.set([rnd.range(0.8, 5.0), rnd.range(0.6, 3.2), rnd.range(0, 6.283), cc < 0.55 ? 0 : cc < 0.8 ? 1 : 2], i * 4);
    }
    this.plU = {
      uT: { value: 0 }, uFocus: { value: 25 }, uCoc: { value: 1500 }, uPx: { value: this.px }, uMaxPx: { value: 30 * this.px },
      uBoxMin: { value: BOX_MIN.clone() }, uBoxSize: { value: BOX_SIZE.clone() }, uFlow: { value: new THREE.Vector3(-5, 1.0, 2.0) }, uLen: { value: 0.24 },
    };
    {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      g.setAttribute('aP0', new THREE.BufferAttribute(P0, 4)); g.setAttribute('aV', new THREE.BufferAttribute(V, 4)); g.setAttribute('aW', new THREE.BufferAttribute(W, 4));
      this.bokeh = new THREE.Points(g, add(BOKEH_VERT, BOKEH_FRAG, this.plU)); this.bokeh.frustumCulled = false; S.add(this.bokeh);
    }
    {
      const SEG = 4, VPP = SEG * 2; // 4 segments per trail
      const dup = (src, k) => { const o = new Float32Array(src.length * VPP); for (let i = 0; i < src.length / k; i++) { for (let e = 0; e < VPP; e++) for (let j = 0; j < k; j++) o[(i * VPP + e) * k + j] = src[i * k + j]; } return o; };
      const tail = new Float32Array(N * VPP);
      for (let i = 0; i < N; i++) for (let sg = 0; sg < SEG; sg++) { tail[i * VPP + sg * 2] = sg / SEG; tail[i * VPP + sg * 2 + 1] = (sg + 1) / SEG; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * VPP * 3), 3));
      g.setAttribute('aP0', new THREE.BufferAttribute(dup(P0, 4), 4)); g.setAttribute('aV', new THREE.BufferAttribute(dup(V, 4), 4)); g.setAttribute('aW', new THREE.BufferAttribute(dup(W, 4), 4));
      g.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
      this.streaks = new THREE.LineSegments(g, add(STREAK_VERT, LINE_FRAG, this.plU)); this.streaks.frustumCulled = false; S.add(this.streaks);
    }

    // ---- nucleons
    const geo = new THREE.SphereGeometry(1, 48, 32);
    const tetra = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(v => new THREE.Vector3(...v).normalize().multiplyScalar(0.98));
    this.nucs = [];
    for (let a = 0; a < 3; a++) {
      for (let j = 0; j < 4; j++) {
        const proton = j < 2;
        const u = {
          uCore: { value: proton ? new THREE.Vector3(1.45, 0.30, 0.07) : new THREE.Vector3(0.30, 0.56, 1.30) },
          uRim: { value: proton ? new THREE.Vector3(2.6, 0.95, 0.30) : new THREE.Vector3(0.9, 1.6, 3.4) },
          uKey: { value: new THREE.Vector3(-0.5, 0.8, 0.6) },
          uTime: { value: 0 }, uSeed: { value: rnd.next() }, uHeat: { value: 0 },
        };
        const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: NUC_VERT, fragmentShader: NUC_FRAG, uniforms: u }));
        m.userData = { u, alpha: a, local: tetra[(j + a) % 4].clone(), proton };
        S.add(m); this.nucs.push(m);
      }
    }
    // alpha orbit plane, tilted toward camera
    this.orbitQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 0.3, 0.15));
    this.alphaSpin = [0, 1, 2].map(() => ({ axis: new THREE.Vector3(...rnd.onSphere()), rate: rnd.range(0.6, 1.4) * rnd.sign(), ph: rnd.range(0, 6.28) }));
    this.wob = [0, 1, 2].map(() => [rnd.range(0, 100), rnd.range(0, 100), rnd.range(0, 100)]);

    // carbon-12 target arrangement: icosahedron, antipodal pairs split into p/n
    const phi = (1 + Math.sqrt(5)) / 2;
    const ico = [];
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) { ico.push([0, s1, s2 * phi], [s1, s2 * phi, 0], [s2 * phi, 0, s1]); }
    const icoV = ico.map(v => new THREE.Vector3(...v).normalize().multiplyScalar(1.62));
    const isP = icoV.map(v => (v.x > 1e-6) || (Math.abs(v.x) < 1e-6 && (v.y > 1e-6 || (Math.abs(v.y) < 1e-6 && v.z > 0))));
    // positions at the moment of fusion -> greedy nearest assignment per type
    const X = this.nucPositions(T_FUSE, true);
    const used = new Set();
    this.nucs.forEach((m, i) => {
      let best = -1, bd = 1e9;
      icoV.forEach((v, k) => { if (used.has(k) || isP[k] !== m.userData.proton) return; const d = v.distanceTo(X[i]); if (d < bd) { bd = d; best = k; } });
      used.add(best); m.userData.target = icoV[best].clone();
    });

    // ---- glows: one per alpha (pre-fusion), one for carbon
    this.glowU = { uPx: { value: this.px } };
    {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
      g.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(16 * 4), 4));
      this.glows = new THREE.Points(g, add(GLOW_VERT, GLOW_FRAG, this.glowU)); this.glows.frustumCulled = false; this.glows.renderOrder = 5;
      S.add(this.glows);
    }
    // ---- spiral trails behind each alpha
    {
      const NT = 90;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * NT * 3), 3));
      const C = new Float32Array(3 * NT * 4);
      for (let a = 0; a < 3; a++) for (let i = 0; i < NT; i++) { const f = 1 - i / NT; C.set([0.10 * f * f, 0.06 * f * f, 0.05 * f * f, 1400 * (0.35 + 0.65 * f)], (a * NT + i) * 4); }
      g.setAttribute('aC', new THREE.BufferAttribute(C, 4));
      this.trails = new THREE.Points(g, add(GLOW_VERT, GLOW_FRAG, this.glowU)); this.trails.frustumCulled = false; this.NT = NT;
      S.add(this.trails);
    }
    // ---- gamma burst
    {
      const NB = 2600;
      const D = new Float32Array(NB * 2 * 4), E = new Float32Array(NB * 2 * 2);
      for (let i = 0; i < NB; i++) {
        const d = rnd.onSphere(), sp = rnd.range(14, 60), b = Math.pow(rnd.next(), 2) * 1.6 + 0.15;
        for (let e = 0; e < 2; e++) { D.set([d[0], d[1], d[2], sp], (i * 2 + e) * 4); E.set([e, b], (i * 2 + e) * 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NB * 2 * 3), 3));
      g.setAttribute('aD', new THREE.BufferAttribute(D, 4)); g.setAttribute('aE', new THREE.BufferAttribute(E, 2));
      this.burstU = { uT: { value: -1 } };
      this.burst = new THREE.LineSegments(g, add(BURST_VERT, LINE_FRAG, this.burstU)); this.burst.frustumCulled = false;
      S.add(this.burst);
    }
  }

  // world positions of the 12 nucleons at time t (pre-fusion trajectory if pre = true)
  nucPositions(t, pre = false) {
    const out = [];
    const tp = pre ? Math.min(t, T_FUSE) : t;
    const centres = this.alphaCentres(tp);
    for (const m of this.nucs) {
      const a = m.userData.alpha, sp = this.alphaSpin[a];
      const q = new THREE.Quaternion().setFromAxisAngle(sp.axis, sp.ph + sp.rate * tp);
      out.push(m.userData.local.clone().applyQuaternion(q).add(centres[a]));
    }
    this._centres = centres;
    return out;
  }

  alphaCentres(tp) {
    const u = clamp(tp / T_FUSE);
    const r0 = 11.5, rc = 1.92;
    const r = rc + (r0 - rc) * (1 - Math.pow(u, 1.7)) * (1 + 0.10 * Math.sin(u * 9.0) * (1 - u));
    const om = 0.22 * tp + 2.4 * Math.pow(u, 3.2);
    const centres = [];
    for (let a = 0; a < 3; a++) {
      const ang = om + a * 2 * Math.PI / 3;
      const c = new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, 0);
      // chaotic wander, damped as they bind
      const w = this.wob[a], amp = 2.2 * (1 - smoothstep(0.55, 0.97, u));
      c.add(new THREE.Vector3(fbm1(tp * 0.35 + w[0]), fbm1(tp * 0.35 + w[1]), fbm1(tp * 0.3 + w[2]) * 1.6).multiplyScalar(amp));
      c.applyQuaternion(this.orbitQ);
      centres.push(c);
    }
    return centres;
  }

  update(shot, t, T) {
    const px = this.px;
    // ---- camera: macro, slow push in, handheld micro-jitter
    const k = clamp(t / 16);
    const dist = lerp(64, 44, easeInOutSine(clamp(t / 11))) - 1.5 * smoothstep(T_FUSE, 16, t);
    const az = -0.42 + 0.30 * k, el = 0.20 - 0.06 * k;
    const cam = this.camera;
    cam.fov = 30; cam.near = 0.2; cam.far = 2000; cam.updateProjectionMatrix();
    const jit = 0.05 + 0.05 * Math.exp(-Math.max(0, t - T_FUSE) * 2.5) * (t > T_FUSE ? 3 : 0);
    const jx = fbm1(t * 1.7 + 11.3) * jit, jy = fbm1(t * 1.9 + 3.7) * jit, jz = fbm1(t * 1.3 + 7.9) * jit;
    cam.position.set(Math.sin(az) * Math.cos(el) * dist + jx, Math.sin(el) * dist + jy, Math.cos(az) * Math.cos(el) * dist + jz);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    // frame the subject centre-left / slightly low so the reticle label has room up-right
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    const look = new THREE.Vector3().addScaledVector(right, 0.10 * dist).addScaledVector(up, 0.055 * dist);
    look.x += fbm1(t * 2.3 + 1.1) * 0.012 * dist; look.y += fbm1(t * 2.1 + 5.5) * 0.012 * dist;
    cam.lookAt(look);
    cam.updateMatrixWorld();

    // ---- nucleons
    const fused = t >= T_FUSE;
    const pre = this.nucPositions(t, true);
    const tf = t - T_FUSE;
    const b = fused ? easeOutBack(clamp(tf / 0.9), 1.9) : 0;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 1, 0.2).normalize(), fused ? 0.9 * (1 - Math.exp(-tf * 1.2)) + 0.28 * tf : 0);
    const squash = fused ? 1 - 0.18 * Math.exp(-tf * 5) * Math.sin(Math.min(tf * 14, Math.PI)) : 1;
    this.nucs.forEach((m, i) => {
      let p = pre[i];
      if (fused) {
        const tgt = m.userData.target.clone().applyQuaternion(rot);
        // collective breathing (giant resonance) + per-nucleon jitter
        const vib = new THREE.Vector3(Math.sin(t * 7.1 + i), Math.sin(t * 6.3 + i * 2.3), Math.sin(t * 8.7 + i * 1.7)).multiplyScalar(0.035);
        tgt.multiplyScalar(squash * (1 + 0.025 * Math.sin(t * 3.3))).add(vib);
        p = p.clone().lerp(tgt, b);
      }
      m.position.copy(p);
      const u = m.userData.u;
      u.uTime.value = t;
      u.uHeat.value = fused ? 2.0 * Math.exp(-tf * 3.0) + 0.15 + 0.08 * Math.sin(t * 2.2) : 0.12 * smoothstep(7, 10.5, t);
    });

    // glows
    const gp = this.glows.geometry.attributes.position.array, gc = this.glows.geometry.attributes.aC.array;
    const preA = fused ? Math.exp(-tf * 4) : 1;
    for (let a = 0; a < 3; a++) {
      const c = this._centres[a];
      gp.set([c.x, c.y, c.z], a * 3);
      gc.set([0.09 * preA, 0.045 * preA, 0.03 * preA, 9000], a * 4);
    }
    const ca = fused ? (0.30 + 2.0 * Math.exp(-tf * 2.5)) * smoothstep(0, 0.1, tf) : 0;
    gp.set([0, 0, 0], 9); gc.set([0.55 * ca, 0.36 * ca, 0.24 * ca, 22000], 12);
    this.nucs.forEach((m, i) => {
      gp.set([m.position.x, m.position.y, m.position.z], (4 + i) * 3);
      const h = 1 + m.userData.u.uHeat.value;
      gc.set(m.userData.proton ? [0.30 * h, 0.07 * h, 0.02 * h, 6000] : [0.06 * h, 0.11 * h, 0.26 * h, 6000], (4 + i) * 4);
    });
    this.glows.geometry.attributes.position.needsUpdate = true; this.glows.geometry.attributes.aC.needsUpdate = true;
    this.glowU.uPx.value = px * 1.0;

    // trails (sampled analytically along the past trajectory)
    {
      const tp = this.trails.geometry.attributes.position.array;
      const fade = fused ? Math.exp(-tf * 3) : 1;
      for (let i = 0; i < this.NT; i++) {
        const cs = this.alphaCentres(Math.max(0, Math.min(t, T_FUSE) - i * 0.035));
        for (let a = 0; a < 3; a++) { const c = cs[a]; tp.set([c.x, c.y, c.z], (a * this.NT + i) * 3); }
      }
      this.trails.geometry.attributes.position.needsUpdate = true;
      this.trails.visible = fade > 0.01;
      this.trails.material.uniforms.uPx.value = px;
    }
    // plasma
    const pu = this.plU;
    pu.uT.value = t; pu.uFocus.value = cam.position.length(); pu.uPx.value = px; pu.uMaxPx.value = 72 * px;
    this.burstU.uT.value = t - T_FUSE;
    this.bgU.uT.value = t; this.bgU.uInt.value = 1 + (fused ? 1.2 * Math.exp(-tf * 2) : 0);

    const flash = fused ? 2.8 * Math.exp(-tf * 10) : 0;
    return {
      scene: this.scene, camera: cam, target: fused ? new THREE.Vector3(0, 0, 0) : null,
      post: {
        exposure: 1.0, bloomStrength: 0.8, bloomThreshold: 1.1, bloomKnee: 0.7, bloomRadius: 0.85,
        streak: 0.22 + (fused ? 1.4 * Math.exp(-tf * 2.5) : 0), streakTint: [0.6, 0.75, 1.0],
        ca: 0.0008, vignette: 0.55, grain: 0.05, saturation: 1.1, contrast: 1.06, tint: [1.0, 0.97, 0.95], lift: [0.004, 0.001, 0.0],
        flash, shake: fused ? 0.35 * Math.exp(-tf * 3) : 0,
      },
    };
  }

  dispose() {
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}
