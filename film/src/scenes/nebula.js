// NEBULA scene: 'remnant' (supernova remnant fly-through) and 'disk' (protoplanetary disk, Sol ignition).
//
// Remnant: the shock front is a set of large wrinkled, optically thin emission sheets. Where a sheet
// folds edge-on to the camera it brightens (1/|n.v|) into fine filaments, exactly how the Veil
// nebula's threads arise. Strand detail comes from a baked tileable ridged-noise texture sampled
// anisotropically. Particle ribbons add crisp braided threads (incl. the one our atom rides), a
// low-res splat pass adds volumetric haze + dust optical depth, and a starfield sits behind.
import * as THREE from '../../vendor/three.module.js';
import { simplex3, hash } from '../lib/glsl.js';
import { Rand, fbm1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, easeInOutCubic, easeOutCubic, easeInOutSine } from '../lib/ease.js';
import { Noise3, makeStarfield, fsQuad, bake, periodicGrad } from '../lib/cosmos.js';

const HA = [1.0, 0.13, 0.36];      // H-alpha / magenta
const HA_DEEP = [0.85, 0.05, 0.12]; // crimson, [S II]
const OIII = [0.10, 0.78, 0.86];   // [O III] teal
const OIII_B = [0.25, 0.55, 1.0];  // bluer oxygen
const mixc = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ------------------------------------------------------------------ shared point shaders
const PT_VERT = /* glsl */`
attribute vec4 aCol;            // rgb = linear emission, a = size multiplier
uniform float uFocal, uWorld, uMinPx, uCap, uTime, uFar, uNear, uGain;
varying vec3 vCol;
void main(){
  vec3 p = position;
  float ph = dot(p, vec3(0.31, 0.17, 0.23));
  p += 0.05*vec3(sin(uTime*0.23 + ph*3.0), sin(uTime*0.19 + ph*2.3 + 1.0), sin(uTime*0.17 + ph*1.7 + 2.0));
  vec4 mv = modelViewMatrix*vec4(p, 1.0);
  float d = -mv.z;
  float sz = aCol.a*uWorld*uFocal/max(d, 0.05);
  float s = clamp(sz, uMinPx, uCap);
  float flux = (sz*sz)/(s*s);
  float k = smoothstep(uNear*0.4, uNear, d) * mix(1.0, 0.3, smoothstep(uFar*0.3, uFar, d));
  vCol = aCol.rgb*flux*k*uGain;
  gl_PointSize = s;
  gl_Position = projectionMatrix*mv;
  if (d < 0.05 || k <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const PT_FRAG = /* glsl */`
varying vec3 vCol;
void main(){ vec2 c = gl_PointCoord-0.5; float r2 = dot(c,c)*4.0; if (r2 > 1.0) discard;
  float a = exp(-r2*3.2) - 0.04; gl_FragColor = vec4(vCol*max(a,0.0), 1.0); }`;

// glow splats: rgb emission + dust optical depth in alpha
const GL_VERT = /* glsl */`
attribute vec4 aCol; attribute float aTau;
uniform float uFocal, uWorld, uCap, uTime, uFar, uGain, uTauGain;
varying vec4 vCol;
void main(){
  vec3 p = position;
  vec4 mv = modelViewMatrix*vec4(p, 1.0);
  float d = -mv.z;
  float sz = aCol.a*uWorld*uFocal/max(d, 0.05);
  float s = clamp(sz, 1.5, uCap);
  float flux = (sz*sz)/(s*s);
  float k = smoothstep(1.0, 5.0, d) * mix(1.0, 0.45, smoothstep(uFar*0.35, uFar, d));
  vCol = vec4(aCol.rgb*uGain, aTau*uTauGain)*flux*k;
  gl_PointSize = s;
  gl_Position = projectionMatrix*mv;
  if (d < 0.05 || k <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const GL_FRAG = /* glsl */`
varying vec4 vCol;
void main(){ vec2 c = gl_PointCoord-0.5; float r2 = dot(c,c)*4.0; if (r2 > 1.0) discard;
  float a = (1.0-r2); a = a*a*a; gl_FragColor = vCol*a; }`;

function pointsMaterial(vert, frag, uniforms, alphaAdd = false) {
  const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, transparent: true });
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
  m.blendEquationAlpha = THREE.AddEquation; m.blendSrcAlpha = alphaAdd ? THREE.OneFactor : THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
  return m;
}

// baked strand texture: R fine ridged strands, G medium ridges, B patch fbm, A warp fbm
const STRAND_BAKE = periodicGrad + /* glsl */`
varying vec2 vUv;
void main(){
  float P = 8.0; vec2 p = vUv*P;
  vec2 w = vec2(pgfbm(p*0.5 + 1.3, P*0.5, 3), pgfbm(p*0.5 + 7.1, P*0.5, 3));
  vec2 q = p + w*1.2;
  float r = 0.0, amp = 1.0, f = 1.0, sh = 14.0;
  for (int i = 0; i < 4; i++) {
    float n = pgnoise(q*f + float(i)*3.7, P*f);
    r += amp*pow(max(1.0 - abs(n)*1.1, 0.0), sh);
    f *= 2.0; amp *= 0.62; sh *= 0.8;
  }
  float g = pow(max(1.0 - abs(pgfbm(q*0.5 + 4.2, P*0.5, 3)), 0.0), 4.0);
  float b = pgfbm(p*0.5 + 9.9, P*0.5, 4)*0.5 + 0.5;
  float a = pgfbm(p + 2.2, P, 3)*0.5 + 0.5;
  gl_FragColor = vec4(r, g, b, a);
}`;

const SHEET_VERT = /* glsl */`
attribute vec2 aUV;
varying vec3 vW; varying vec3 vN; varying vec2 vUV;
void main(){
  vec4 w = modelMatrix*vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vUV = aUV;
  gl_Position = projectionMatrix*viewMatrix*w;
}`;
const SHEET_FRAG = /* glsl */`
uniform sampler2D tStrand; uniform vec3 uCamPos, uColA, uColB;
uniform float uGain, uWA, uWB, uAng, uSeed, uDiffuse, uStretch, uScaleA, uFar;
uniform vec4 uBox; // half across, along min, along max, edge softness
varying vec3 vW; varying vec3 vN; varying vec2 vUV;
void main(){
  vec3 V = uCamPos - vW; float dist = length(V); V /= dist;
  float ndv = abs(dot(normalize(vN), V));
  float e = 1.0/(ndv*0.93 + 0.07);
  float ca = cos(uAng), sa = sin(uAng);
  vec2 p = vec2(ca*vUV.x - sa*vUV.y, sa*vUV.x + ca*vUV.y);
  vec4 w = texture2D(tStrand, p*vec2(0.004, 0.018)*uScaleA + uSeed);
  vec2 q = vec2(p.x*0.011, p.y*0.011*uStretch)*uScaleA + vec2((w.a - 0.5)*0.3, (w.a - 0.5)*0.9 + (w.b - 0.5)*0.4) + uSeed*0.37;
  float s1 = texture2D(tStrand, q).r;
  float s2 = texture2D(tStrand, q + vec2(0.003, 0.016)).r;
  float med = texture2D(tStrand, q*vec2(0.5, 0.45) + 0.37).g;
  float patchy = smoothstep(0.42, 0.8, texture2D(tStrand, p*vec2(0.0025, 0.007)*uScaleA + uSeed*1.7).b);
  float edge = smoothstep(uBox.x, uBox.x*(1.0 - uBox.w), abs(vUV.y)) * smoothstep(uBox.y, uBox.y + 12.0, vUV.x) * smoothstep(uBox.z, uBox.z - 12.0, vUV.x);
  float env = patchy*edge;
  vec3 c = uColA*uWA*(s1 + 0.3*med + uDiffuse) + uColB*uWB*(s2 + 0.3*med + uDiffuse);
  float fade = smoothstep(0.8, 4.5, dist)*mix(1.0, 0.25, smoothstep(uFar*0.3, uFar, dist));
  gl_FragColor = vec4(c*env*e*uGain*fade, 1.0);
}`;

// ================================================================== REMNANT
const REM = {
  fov: 35,
  camZ: t => 6 - 2.55 * (t + 2) - 0.02 * (t + 2) * (t + 2),
  guide: s => [-2.25 + 0.45 * Math.sin(0.11 * s + 1.0) + 0.2 * Math.sin(0.037 * s), 0.72 + 0.28 * Math.sin(0.085 * s + 2.0), -s],
};
REM.cam = t => {
  const z = REM.camZ(t);
  return [0.55 * Math.sin(0.21 * t + 0.3) + 0.25 * fbm1(t * 0.13 + 4.0), 0.3 * Math.sin(0.17 * t + 1.0) + 0.15 * fbm1(t * 0.11 + 9.0), z];
};
REM.atomS = t => -REM.camZ(t) + 12.6 - 0.1 * t;

// Sheet layout (hand-composed). O origin, U across axis, V along axis, A half-width, B0..B1 along range.
const SHEETS = [
  // big left wall, two-tone, folds running along the flight path
  { O: [-6.0, 0.5, -40], U: [0.25, 1, 0.05], V: [0.06, 0.0, -1], A: 13, B0: -48, B1: 100, amp: 2.0, lam: 7, curv: -0.015, ang: 0.08, colA: HA, colB: OIII, wA: 1.0, wB: 0.8, gain: 0.05, seed: 0.13, stretch: 6, diffuse: 0.03 },
  // right wall further away, mostly hydrogen
  { O: [13.5, 1.5, -60], U: [-0.35, 1, 0.1], V: [-0.1, 0.02, -1], A: 15, B0: -45, B1: 95, amp: 2.6, lam: 9, curv: 0.01, ang: -0.15, colA: HA_DEEP, colB: HA, wA: 0.9, wB: 0.6, gain: 0.04, seed: 0.51, stretch: 5, diffuse: 0.03 },
  // ceiling, oxygen teal
  { O: [3, 7.0, -55], U: [1, 0.12, 0], V: [0.0, 0.03, -1], A: 18, B0: -40, B1: 95, amp: 2.2, lam: 8, curv: 0.008, ang: 0.25, colA: OIII, colB: OIII_B, wA: 1.0, wB: 0.5, gain: 0.045, seed: 0.77, stretch: 5, diffuse: 0.025 },
  // floor, faint deep red (keeps the subtitle zone calm)
  { O: [-2, -8.5, -60], U: [1, -0.08, 0], V: [0.0, -0.02, -1], A: 20, B0: -40, B1: 90, amp: 2.5, lam: 10, curv: 0.0, ang: -0.3, colA: HA_DEEP, colB: OIII, wA: 0.6, wB: 0.25, gain: 0.03, seed: 0.29, stretch: 4, diffuse: 0.02 },
  // far crossing curtain, mostly face-on: fine braid patterns
  { O: [1, 0, -112], U: [1, 0.25, 0], V: [-0.2, 0.9, 0.35], A: 34, B0: -18, B1: 18, amp: 3.5, lam: 9, curv: 0.0, ang: 0.6, colA: HA, colB: OIII, wA: 0.9, wB: 0.9, gain: 0.06, seed: 0.91, stretch: 4, diffuse: 0.04 },
  // oblique sheet that slides past on the right mid-shot (foreground parallax)
  { O: [4.2, -1.2, -30], U: [0.15, 1, 0.25], V: [0.35, 0.0, -1], A: 5.5, B0: -16, B1: 16, amp: 1.2, lam: 4, curv: 0.0, ang: 0.35, colA: OIII, colB: HA, wA: 0.9, wB: 0.7, gain: 0.05, seed: 0.42, stretch: 5, diffuse: 0.03 },
  // upper-left diagonal sheet, distant
  { O: [-14, 7, -85], U: [0.8, 0.6, 0], V: [0.3, -0.2, -1], A: 14, B0: -35, B1: 35, amp: 2.4, lam: 7, curv: 0.0, ang: -0.5, colA: HA, colB: OIII_B, wA: 0.9, wB: 0.6, gain: 0.05, seed: 0.66, stretch: 5, diffuse: 0.03 },
  // lower-right diagonal, distant
  { O: [16, -6, -90], U: [0.6, -0.8, 0.1], V: [-0.3, 0.1, -1], A: 14, B0: -35, B1: 35, amp: 2.4, lam: 7, curv: 0.0, ang: 0.4, colA: OIII, colB: HA, wA: 0.8, wB: 0.8, gain: 0.05, seed: 0.18, stretch: 5, diffuse: 0.03 },
];

function buildSheet(N, d, mat) {
  const U = norm(d.U); let V = norm(d.V); const Nn = norm(cross(U, V)); V = norm(cross(Nn, U));
  const segA = 40, segB = Math.max(24, Math.round((d.B1 - d.B0) / 1.0));
  const pos = new Float32Array((segA + 1) * (segB + 1) * 3), uv = new Float32Array((segA + 1) * (segB + 1) * 2);
  let k = 0;
  for (let j = 0; j <= segB; j++) {
    const b = lerp(d.B0, d.B1, j / segB);
    for (let i = 0; i <= segA; i++) {
      const a = lerp(-d.A, d.A, i / segA);
      const h = d.amp * (N.fbm(a / d.lam + d.seed * 10, b / (d.lam * 2.8), d.seed * 7, 3) * 1.4) + d.curv * a * a;
      pos[k * 3] = d.O[0] + U[0] * a + V[0] * b + Nn[0] * h;
      pos[k * 3 + 1] = d.O[1] + U[1] * a + V[1] * b + Nn[1] * h;
      pos[k * 3 + 2] = d.O[2] + U[2] * a + V[2] * b + Nn[2] * h;
      uv[k * 2] = b; uv[k * 2 + 1] = a; k++;
    }
  }
  const idx = [];
  for (let j = 0; j < segB; j++) for (let i = 0; i < segA; i++) {
    const a = j * (segA + 1) + i, b = a + 1, c = a + segA + 1, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.ShaderMaterial({ vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG, uniforms: {},
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide });
  m.uniforms.tStrand = mat.uniforms.tStrand; m.uniforms.uCamPos = mat.uniforms.uCamPos;
  Object.assign(m.uniforms, {
    uColA: { value: new THREE.Vector3(...d.colA) }, uColB: { value: new THREE.Vector3(...d.colB) },
    uGain: { value: d.gain }, uWA: { value: d.wA }, uWB: { value: d.wB }, uAng: { value: d.ang }, uSeed: { value: d.seed },
    uDiffuse: { value: d.diffuse }, uStretch: { value: d.stretch }, uScaleA: { value: 1 }, uFar: { value: 150 },
    uBox: { value: new THREE.Vector4(d.A, d.B0, d.B1, 0.45) },
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false;
  return mesh;
}

function buildRemnantParticles() {
  const N = new Noise3(1337), r = new Rand(4242);
  const pts = [], col = [];             // detail particles
  const gp = [], gc = [], gt = [];      // glow splats (pos, col+size, tau)
  const push = (p, c, size) => { pts.push(p[0], p[1], p[2]); col.push(c[0], c[1], c[2], size); };
  const glow = (p, c, size, tau) => { gp.push(p[0], p[1], p[2]); gc.push(c[0], c[1], c[2], size); gt.push(tau); };

  const cv = [0, 0, 0];
  const makeSpine = (start, dir, len, h, curlAmt, freq, seedOff) => {
    const P = []; let p = start.slice();
    for (let s = 0; s < len; s += h) {
      P.push(p.slice());
      N.curl(p[0] * freq + seedOff, p[1] * freq, p[2] * freq, cv);
      const n = norm([dir[0] + curlAmt * cv[0], dir[1] + curlAmt * cv[1], dir[2] + curlAmt * cv[2]]);
      p = [p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h];
    }
    return P;
  };
  const frames = P => {
    const T = [], Nn = [], B = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      T.push(norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
    }
    let n = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    for (let i = 0; i < P.length; i++) {
      const t = T[i]; const dd = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
      n = norm([n[0] - dd * t[0], n[1] - dd * t[1], n[2] - dd * t[2]]);
      Nn.push(n); B.push(cross(t, n));
    }
    return { T, N: Nn, B };
  };
  // ribbon of braided threads along a spine; points are placed at random arc positions (no beading)
  const ribbon = (P, o) => {
    const F = frames(P); const h = o.h;
    const th = [];
    for (let k = 0; k < o.threads; k++) th.push({ u: r.range(-1, 1), v: r.gauss() * 0.2, ph: r.range(0, 100), b: 0.4 + r.next() * r.next() * 1.6, cold: r.next() });
    const total = (P.length - 1) * h;
    const nPts = Math.round(total * o.threads * o.density);
    for (let n = 0; n < nPts; n++) {
      const s = r.next() * total; const fi = s / h; const i = Math.min(P.length - 2, Math.floor(fi)); const f = fi - i;
      const env = Math.pow(clamp(0.5 + 1.0 * N.n(s * o.envFreq + o.seed * 7.3, 2.2, o.seed)), 1.5) * smoothstep(0, 4, s) * smoothstep(0, 4, total - s);
      if (r.next() > env) continue;
      const q = th[(r.next() * th.length) | 0];
      const w = o.width * (0.5 + 0.8 * Math.max(0, 0.5 + N.n(s * 0.07 + o.seed, o.seed * 3.1, 1.7)));
      const tw = o.twist * s + 1.4 * N.n(s * 0.04, o.seed, 5.5);
      const ct = Math.cos(tw), st = Math.sin(tw);
      const nV = F.N[i], bV = F.B[i];
      const nn = [nV[0] * ct + bV[0] * st, nV[1] * ct + bV[1] * st, nV[2] * ct + bV[2] * st];
      const bb = [-nV[0] * st + bV[0] * ct, -nV[1] * st + bV[1] * ct, -nV[2] * st + bV[2] * ct];
      const wob = 0.22 * N.n(s * 0.18 + q.ph, q.ph, 3.0);
      const uu = (q.u + wob) * w, vv = (q.v + 0.12 * N.n(s * 0.15, q.ph, 9.0)) * w;
      const P0 = P[i], P1 = P[i + 1];
      const base = [lerp(P0[0], P1[0], f), lerp(P0[1], P1[1], f), lerp(P0[2], P1[2], f)];
      const j = o.jitter;
      const p = [base[0] + nn[0] * uu + bb[0] * vv + r.gauss() * j, base[1] + nn[1] * uu + bb[1] * vv + r.gauss() * j, base[2] + nn[2] * uu + bb[2] * vv + r.gauss() * j];
      let k = smoothstep(-0.2, 0.2, q.u - o.split + 0.2 * N.n(s * 0.08, o.seed, 0.0));
      if (o.mono === 'ha') k = 0; if (o.mono === 'o') k = 1;
      let c = mixc(mixc(HA, HA_DEEP, q.cold * 0.7), mixc(OIII, OIII_B, q.cold * 0.6), k);
      const I = o.I * q.b;
      const core = Math.exp(-q.u * q.u * 12.0) * o.core;
      c = [c[0] * I + core * I * 0.9, c[1] * I + core * I * 0.65, c[2] * I + core * I * 0.75];
      (o.out || push)(p, c, 0.55 + 0.5 * r.next());
    }
  };

  // the tendril our atom rides in: built in atom-local coordinates, translated with the atom each frame
  const tp = [], tc = [];
  {
    const P = [];
    for (let u = -1.0; u <= 1.6; u += 0.01) P.push([u * 2.6 + 0.5 * Math.sin(2.2 * u), u * 1.0 + 0.35 * Math.sin(3.1 * u + 1.0), -u * 6.0]);
    ribbon(P, { h: Math.hypot(2.6, 1.0, 6.0) * 0.01, threads: 12, width: 0.38, twist: 0.12, density: 55, envFreq: 0.08, seed: 3.3, split: 0.1, jitter: 0.005, I: 0.22, core: 0.6,
      out: (p, c, sz) => { tp.push(p[0], p[1], p[2]); tc.push(c[0], c[1], c[2], sz); } });
  }
  // free ribbons: long, gently curving
  for (let k = 0; k < 22; k++) {
    let start;
    for (let tries = 0; tries < 30; tries++) {
      start = [r.range(-24, 24), r.range(-11, 11), r.range(-110, 0)];
      if (Math.hypot(start[0], start[1] * 1.6) > 5) break;
    }
    const along = r.next() < 0.45;
    let dir = along ? [r.gauss() * 0.3, r.gauss() * 0.15, -1] : (() => { const a = r.range(0, Math.PI * 2); return [Math.cos(a), Math.sin(a) * 0.6, r.gauss() * 0.4]; })();
    dir = norm(dir);
    const P = makeSpine(start, dir, r.range(18, 50), 0.2, r.range(0.25, 0.6), 0.05, k * 13.1);
    const hue = r.next();
    ribbon(P, {
      h: 0.2, threads: r.int(6, 14), width: r.range(0.2, 1.0), twist: r.range(-0.08, 0.08), density: r.range(16, 26),
      envFreq: r.range(0.03, 0.07), seed: k * 1.7 + 0.3, split: r.range(-0.5, 0.5),
      mono: hue < 0.35 ? 'ha' : hue < 0.5 ? 'o' : null, jitter: 0.008, I: r.range(0.2, 0.4), core: r.range(0.0, 0.7),
      glowFrac: 0.04, glowSize: r.range(1.0, 2.0),
    });
  }
  // dust lanes: wide dark ribbons (optical depth only)
  for (let k = 0; k < 10; k++) {
    const start = [r.range(-20, 20), r.range(-8, 8), r.range(-95, -10)];
    const a = r.range(0, Math.PI * 2); const dir = norm([Math.cos(a), Math.sin(a) * 0.6, r.gauss() * 0.5]);
    const P = makeSpine(start, dir, r.range(20, 40), 0.3, 0.6, 0.05, 99 + k);
    const F = frames(P);
    for (let i = 0; i < P.length; i++) {
      const s = i * 0.3, env = smoothstep(0, 4, s) * smoothstep(0, 4, (P.length - 1) * 0.3 - s) * clamp(0.6 + N.n(s * 0.08, k, 4.0));
      for (let j = 0; j < 5; j++) {
        const w = r.gauss() * 1.5, v = r.gauss() * 0.4;
        const p = [P[i][0] + F.N[i][0] * w + F.B[i][0] * v, P[i][1] + F.N[i][1] * w + F.B[i][1] * v, P[i][2] + F.N[i][2] * w + F.B[i][2] * v];
        glow(p, [0, 0, 0], r.range(3.0, 6.0), 0.12 * env);
      }
    }
  }
  // diffuse emission clouds (glow only)
  for (let i = 0; i < 6000; i++) {
    const p = [r.range(-34, 34), r.range(-16, 16), r.range(-130, 6)];
    if (Math.hypot(p[0], p[1]) < 4) continue;
    const dns = N.fbm(p[0] * 0.04, p[1] * 0.04, p[2] * 0.04, 3);
    if (dns < 0.05 + r.next() * 0.3) continue;
    const hk = smoothstep(-0.25, 0.25, N.n(p[0] * 0.03 + 50, p[1] * 0.03, p[2] * 0.03));
    const c = mixc(mixc(HA, HA_DEEP, 0.4), OIII, hk);
    const I = 0.022 * (0.3 + dns);
    glow(p, [c[0] * I, c[1] * I, c[2] * I], r.range(11.0, 16.0), 0);
  }
  // near-field stars inside the volume (parallax) + drifting dust motes
  for (let i = 0; i < 3000; i++) {
    const p = [r.range(-40, 40), r.range(-20, 20), r.range(-130, 6)];
    if (Math.hypot(p[0], p[1]) < 2) continue;
    const m = Math.pow(r.next(), 6); const L = 0.6 + 7 * m;
    const tc = r.next(); const c = tc < 0.3 ? [1, 0.75, 0.55] : tc < 0.7 ? [1, 0.95, 0.9] : [0.75, 0.85, 1];
    push(p, [c[0] * L, c[1] * L, c[2] * L], 0.4 + 0.5 * m);
  }
  for (let i = 0; i < 2500; i++) {
    const p = [r.range(-6, 6), r.range(-3.5, 3.5), r.range(-60, 8)];
    const c = r.next() < 0.5 ? HA : OIII; const L = 0.15 * r.next();
    push(p, [c[0] * L + 0.05, c[1] * L + 0.04, c[2] * L + 0.05], 0.3);
  }

  const mk = (P, C, T) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(C), 4));
    if (T) g.setAttribute('aTau', new THREE.BufferAttribute(new Float32Array(T), 1));
    return g;
  };
  return { detail: mk(pts, col), glow: mk(gp, gc, gt), tendril: mk(tp, tc), counts: [pts.length / 3, gp.length / 3, tp.length / 3] };
}

// ================================================================== DISK
function buildDisk(ctx) { return null; }

export default class Nebula {
  constructor(ctx) {
    this.ctx = ctx;
    this.W = ctx.width; this.H = ctx.height; this.uScale = ctx.height / 804;
    this.built = {};
  }
  async init() {}

  _strandTex() {
    if (!this.strandRT) this.strandRT = bake(this.ctx.renderer, 1024, 1024, STRAND_BAKE, {}, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    return this.strandRT.texture;
  }

  // ---------------------------------------------------------------- remnant
  _remnant() {
    if (this.built.remnant) return this.built.remnant;
    const ctx = this.ctx;
    const geo = buildRemnantParticles();
    const camera = new THREE.PerspectiveCamera(REM.fov, ctx.aspect, 0.05, 500);
    const focal = (this.H / 2) / Math.tan(THREE.MathUtils.degToRad(REM.fov / 2));
    const div = 3;
    const gw = Math.round(this.W / div), gh = Math.round(this.H / div);
    const glowRT = new THREE.WebGLRenderTarget(gw, gh, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });

    const uT = { value: 0 };
    const detailMat = pointsMaterial(PT_VERT, PT_FRAG, {
      uFocal: { value: focal }, uWorld: { value: 0.03 }, uMinPx: { value: Math.max(0.8, 1.1 * this.uScale) }, uCap: { value: 18 * this.uScale },
      uTime: uT, uFar: { value: 100 }, uNear: { value: 1.5 }, uGain: { value: 1 },
    });
    const detail = new THREE.Points(geo.detail, detailMat); detail.frustumCulled = false;
    const glowMat = pointsMaterial(GL_VERT, GL_FRAG, {
      uFocal: { value: focal / div }, uWorld: { value: 0.5 }, uCap: { value: 70 * this.uScale + 10 }, uTime: uT, uFar: { value: 120 }, uGain: { value: 1 }, uTauGain: { value: 1 },
    }, true);
    const glow = new THREE.Points(geo.glow, glowMat); glow.frustumCulled = false;

    const stars = makeStarfield({ seed: 11, count: 16000, scale: this.uScale, brightness: 0.9, band: { normal: [0.3, 0.9, 0.3], width: 0.12, frac: 0.35 } });

    // emission sheets
    const sheetMat = { uniforms: { tStrand: { value: this._strandTex() }, uCamPos: { value: new THREE.Vector3() } } };
    const N = new Noise3(777);
    const sheets = SHEETS.map(d => buildSheet(N, d, sheetMat));

    // backdrop (distant nebular wall), rendered into the low-res glow buffer
    const backMat = new THREE.ShaderMaterial({
      uniforms: { uInvVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() } },
      vertexShader: `varying vec2 vNdc; void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: simplex3 + /* glsl */`
        uniform mat4 uInvVP; uniform vec3 uCamPos; varying vec2 vNdc;
        void main(){
          vec4 w = uInvVP*vec4(vNdc, 1.0, 1.0); vec3 d = normalize(w.xyz/w.w - uCamPos);
          float n = fbm3(d*2.2 + vec3(3.0, 1.0, 0.0));
          float m = fbm3(d*4.0 + vec3(-2.0, 5.0, 1.0));
          float a = smoothstep(-0.1, 0.6, n);
          vec3 c = mix(vec3(0.5, 0.06, 0.16), vec3(0.06, 0.32, 0.38), smoothstep(-0.2, 0.3, m));
          float dust = smoothstep(0.0, 0.5, fbm3(d*5.0 + 11.0));
          gl_FragColor = vec4(c*a*0.04*(1.0 - 0.7*dust) + vec3(0.005, 0.003, 0.007), 0.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    const back = fsQuad(backMat);

    // composite: haze over the full-res frame, dust attenuates what is behind
    const compMat = new THREE.ShaderMaterial({
      uniforms: { tGlow: { value: glowRT.texture }, uTexel: { value: new THREE.Vector2(1 / gw, 1 / gh) }, uSub: { value: 0 }, uHaze: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tGlow; uniform vec2 uTexel; uniform float uSub, uHaze; varying vec2 vUv;
        void main(){
          vec4 g = texture2D(tGlow, vUv)*0.4;
          g += (texture2D(tGlow, vUv+vec2(uTexel.x,0.0)) + texture2D(tGlow, vUv-vec2(uTexel.x,0.0)) + texture2D(tGlow, vUv+vec2(0.0,uTexel.y)) + texture2D(tGlow, vUv-vec2(0.0,uTexel.y)))*0.15;
          float T = exp(-max(g.a, 0.0));
          vec2 q = (vUv - vec2(0.5, 0.2))/vec2(0.3, 0.11);
          float calm = 1.0 - uSub*0.4*exp(-dot(q,q));
          vec3 haze = max(g.rgb, 0.0)*uHaze*sqrt(T)*calm;
          gl_FragColor = vec4(haze, T*calm);
        }`,
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    const comp = fsQuad(compMat);

    // our atom
    const atomGeo = new THREE.BufferGeometry();
    atomGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const atomMat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 26 * this.uScale }, uI: { value: 1 } },
      vertexShader: `uniform float uSize; void main(){ gl_PointSize = uSize; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform float uI; void main(){ vec2 c = gl_PointCoord-0.5; float r2 = dot(c,c)*4.0; float a = exp(-r2*60.0)*5.0 + exp(-r2*9.0)*0.3; gl_FragColor = vec4(vec3(1.0,0.82,0.6)*a*uI, 1.0); }`,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    const atom = new THREE.Points(atomGeo, atomMat); atom.frustumCulled = false;

    const tendril = new THREE.Points(geo.tendril, detailMat); tendril.frustumCulled = false;
    const sceneFG = new THREE.Scene(); sceneFG.add(stars); sceneFG.add(tendril); for (const s of sheets) sceneFG.add(s); sceneFG.add(detail);
    const sceneGlow = new THREE.Scene(); sceneGlow.add(glow);
    const sceneAtom = new THREE.Scene(); sceneAtom.add(atom);
    this.built.remnant = { camera, glowRT, uT, stars, back, backMat, comp, compMat, sceneFG, sceneGlow, sceneAtom, atom, tendril, atomGeo, atomMat, detailMat, glowMat, sheetMat, counts: geo.counts };
    return this.built.remnant;
  }

  updateRemnant(shot, t, T) {
    const R = this._remnant();
    const cam = R.camera;
    const tc = clamp(t, -2.5, 19);
    const p = REM.cam(tc);
    cam.position.set(p[0], p[1], p[2]);
    const look = new THREE.Vector3(p[0] * 0.25 + 0.6 * Math.sin(0.09 * tc + 0.4), p[1] * 0.2 + 0.25 * Math.sin(0.07 * tc), p[2] - 12);
    const roll = 0.06 * Math.sin(0.15 * tc + 0.5) + 0.004 * tc;
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.lookAt(look);
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    R.uT.value = tc;
    R.stars.position.copy(cam.position);
    R.sheetMat.uniforms.uCamPos.value.copy(cam.position);

    const s = REM.atomS(tc);
    const g = REM.guide(s);
    const atomPos = new THREE.Vector3(g[0] + 0.08 * Math.sin(tc * 0.7), g[1] + 0.06 * Math.sin(tc * 0.53 + 1.0), g[2]);
    R.atomGeo.attributes.position.array.set([atomPos.x, atomPos.y, atomPos.z]); R.atomGeo.attributes.position.needsUpdate = true;
    R.tendril.position.copy(atomPos); R.tendril.updateMatrixWorld();
    R.atomMat.uniforms.uI.value = 0.5 + 0.5 * smoothstep(3.0, 4.5, t);

    const sub = Math.max(smoothstep(2.4, 3.4, t) * (1 - smoothstep(9.0, 10.0, t)), smoothstep(9.8, 10.6, t) * (1 - smoothstep(16.2, 17.0, t)));
    R.compMat.uniforms.uSub.value = sub;
    const ivp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
    R.backMat.uniforms.uInvVP.value.copy(ivp); R.backMat.uniforms.uCamPos.value.copy(cam.position);

    const render = (renderer, target) => {
      const ac = renderer.autoClear; renderer.autoClear = false;
      renderer.setRenderTarget(R.glowRT); renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(R.back.scene, R.back.cam);
      renderer.render(R.sceneGlow, cam);
      renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 1);
      renderer.render(R.sceneFG, cam);
      renderer.render(R.comp.scene, R.comp.cam);
      renderer.render(R.sceneAtom, cam);
      renderer.autoClear = ac;
    };
    return {
      scene: R.sceneFG, camera: cam, render,
      target: t >= 3.5 ? atomPos : null,
      post: {
        exposure: 1.05, bloomStrength: 0.75, bloomThreshold: 0.55, bloomKnee: 0.5, bloomRadius: 0.9,
        streak: 0.06, streakTint: [0.5, 0.8, 1.0], ca: 0.0022, vignette: 0.5, grain: 0.05,
        saturation: 1.18, contrast: 1.06, tint: [1.0, 0.97, 1.02], lift: [0.002, 0.001, 0.004],
      },
    };
  }

  update(shot, t, T) {
    if (shot.mode === 'disk') return this.updateDisk(shot, t, T);
    return this.updateRemnant(shot, t, T);
  }

  updateDisk(shot, t, T) {
    const R = this._remnant();
    return { scene: R.sceneFG, camera: R.camera, target: null, post: {} };
  }

  dispose() {
    for (const k of Object.keys(this.built)) {
      const B = this.built[k];
      B.glowRT?.dispose();
      for (const sc of [B.sceneFG, B.sceneGlow, B.sceneAtom, B.scene]) sc?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    this.strandRT?.dispose(); this.strandRT = null;
    this.built = {};
  }
}
