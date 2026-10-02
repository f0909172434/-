// FLines: the GlowLines look (anti-aliased screen-space ribbons, soft core, additive HDR, optional flow
// pulses and depth fade) built WITHOUT instancing. SwiftShader pays ~20 µs per instance, so the instanced
// GlowLines is limited to a few thousand segments per frame on the CPU; this variant expands every segment
// into 4 real vertices of one big indexed geometry and costs ~30x less per segment.
//
// API mirrors GlowLines: new FLines({resolution, flow, flowFreq, flowSpeed, fade, opacity}),
// setPolylines([...]) with the same per-polyline options, .mesh, .uniforms.
// Extras (all optional, per polyline):
//   phase    : added to the arc param u (desynchronise pulses)
//   colors   : rgb per vertex (as GlowLines)
//   alpha    : per-vertex alpha
//   widths   : per-vertex width
//   flowAmt  : per-polyline flow multiplier (0 = steady line, 1 = full pulses), multiplies uFlow
// Extra material features:
//   dof      : { focus, aperture } -> out-of-focus lines widen and dim (energy conserving), like SoftPoints
//   reveal   : per-polyline [u0,u1] growth is done by uReveal (lines visible where vU < uReveal + aRev)
import * as THREE from '../../vendor/three.module.js';

const VERT = /* glsl */`
uniform vec2 uRes;
uniform float uPxScale;
uniform float uFocus;
uniform float uAperture;
uniform float uMaxW;
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aColA;
attribute vec4 aColB;
attribute vec2 aW;
attribute vec2 aU;
attribute vec2 aCorner;   // x: 0 at A, 1 at B ; y: side -1/+1
attribute float aFlow;
varying vec4 vCol;
varying float vAcross;
varying float vU;
varying float vWpx;
varying float vDepth;
varying float vFlow;
void main(){
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(aA, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
  // clip the segment against the near plane (z = -w) instead of dropping it
  float fa = ca.z + ca.w, fb = cb.z + cb.w;
  if (fa <= 0.0 && fb <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  if (fa < 0.0) { ca = mix(ca, cb, fa / (fa - fb) + 1e-4); }
  if (fb < 0.0) { cb = mix(cb, ca, fb / (fb - fa) + 1e-4); }
  vec2 sa = ca.xy / ca.w * 0.5 * uRes;
  vec2 sb = cb.xy / cb.w * 0.5 * uRes;
  vec2 d = sb - sa; float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float t = aCorner.x;
  float side = aCorner.y;
  float w = mix(aW.x, aW.y, t) * uPxScale;
  vec4 c = mix(ca, cb, t);
  float gain = 1.0;
  if (uAperture > 0.0) {
    float z = c.w;
    float coc = uAperture * abs(z - uFocus) / max(z, 1e-6) * uPxScale * 100.0;
    float w2 = min(sqrt(w * w + coc * coc), uMaxW);
    gain = w / max(w2, 1e-3);
    w = w2;
  }
  float hw = 0.5 * w + 1.0;
  vec2 s = mix(sa, sb, t) + nrm * side * hw + dir * (t * 2.0 - 1.0) * hw * 0.5;
  gl_Position = vec4(s / (0.5 * uRes) * c.w, c.z, c.w);
  vCol = mix(aColA, aColB, t);
  vCol.rgb *= gain;
  vAcross = side * hw;
  vWpx = 0.5 * w;
  vU = mix(aU.x, aU.y, t);
  vDepth = c.w;
  vFlow = aFlow;
}`;

const FRAG = /* glsl */`
uniform float uTime;
uniform float uFlow;
uniform float uFlowFreq;
uniform float uFlowSpeed;
uniform float uFlowSharp;
uniform float uFlowBase;
uniform vec2 uFade;
uniform float uOpacity;
varying vec4 vCol;
varying float vAcross;
varying float vU;
varying float vWpx;
varying float vDepth;
varying float vFlow;
void main(){
  float d = abs(vAcross);
  float edge = 1.0 - smoothstep(vWpx - 0.5, vWpx + 0.75, d);
  float core = exp(-d * d / max(vWpx * vWpx, 0.25) * 1.6);
  float a = edge * (0.55 + 0.45 * core) * vCol.a * uOpacity;
  float fl = uFlow * vFlow;
  if (fl > 0.0) {
    float p = fract(vU * uFlowFreq - uTime * uFlowSpeed);
    a *= 1.0 + fl * (pow(1.0 - p, uFlowSharp) * 3.0 - uFlowBase);
  }
  if (uFade.y > 0.0) a *= 1.0 - smoothstep(uFade.x, uFade.y, vDepth);
  if (a <= 0.0005) discard;
  gl_FragColor = vec4(vCol.rgb * a, 1.0);
}`;

export class FLines {
  constructor({ resolution = [1920, 804], flow = 0, flowFreq = 1, flowSpeed = 0.5, flowSharp = 6, flowBase = 0.35, fade = [0, 0], opacity = 1,
    depthTest = true, aperture = 0, focus = 10, maxWidth = 40 } = {}) {
    this.uniforms = {
      uRes: { value: new THREE.Vector2(resolution[0], resolution[1]) },
      uPxScale: { value: resolution[1] / 804 },
      uTime: { value: 0 }, uFlow: { value: flow }, uFlowFreq: { value: flowFreq }, uFlowSpeed: { value: flowSpeed },
      uFlowSharp: { value: flowSharp }, uFlowBase: { value: flowBase },
      uFade: { value: new THREE.Vector2(fade[0], fade[1]) }, uOpacity: { value: opacity },
      uFocus: { value: focus }, uAperture: { value: aperture }, uMaxW: { value: maxWidth * resolution[1] / 804 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending,
    });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.capacity = 0;
  }

  _alloc(n) {
    if (n <= this.capacity) return;
    const cap = Math.max(n, Math.ceil(this.capacity * 1.5));
    const g = this.geometry;
    const mk = (k) => { const a = new THREE.BufferAttribute(new Float32Array(cap * 4 * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    for (const [name, k] of [['aA', 3], ['aB', 3], ['aColA', 4], ['aColB', 4], ['aW', 2], ['aU', 2], ['aFlow', 1]]) g.setAttribute(name, mk(k));
    const corner = new Float32Array(cap * 4 * 2);
    for (let i = 0; i < cap; i++) corner.set([0, -1, 1, -1, 0, 1, 1, 1], i * 8);
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    // position is required by three.js; keep a dummy
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 4 * 3), 3));
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6); }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.capacity = cap;
  }

  setPolylines(polylines) {
    let n = 0;
    for (const p of polylines) n += Math.max(0, p.points.length / 3 - 1);
    this._alloc(Math.max(n, 1));
    const g = this.geometry;
    const A = g.attributes.aA.array, B = g.attributes.aB.array, CA = g.attributes.aColA.array, CB = g.attributes.aColB.array;
    const W = g.attributes.aW.array, U = g.attributes.aU.array, F = g.attributes.aFlow.array;
    let k = 0;
    for (const p of polylines) {
      const pts = p.points, m = pts.length / 3;
      if (m < 2) continue;
      const col = p.color || { r: 1, g: 1, b: 1 }, I = p.intensity ?? 1, w = p.width ?? 1.2;
      const ph = p.phase ?? 0;
      const u0 = (p.u0 ?? 0) + ph, u1 = (p.u1 ?? 1) + ph;
      const fa = p.flowAmt ?? 1;
      for (let i = 0; i < m - 1; i++, k++) {
        const ax = pts[i * 3], ay = pts[i * 3 + 1], az = pts[i * 3 + 2], bx = pts[i * 3 + 3], by = pts[i * 3 + 4], bz = pts[i * 3 + 5];
        const aa = p.alpha ? p.alpha[i] : 1, ab = p.alpha ? p.alpha[i + 1] : 1;
        let ra = col.r, ga = col.g, ba = col.b, rb = col.r, gb = col.g, bb = col.b;
        if (p.colors) { ra = p.colors[i * 3]; ga = p.colors[i * 3 + 1]; ba = p.colors[i * 3 + 2]; rb = p.colors[i * 3 + 3]; gb = p.colors[i * 3 + 4]; bb = p.colors[i * 3 + 5]; }
        const wa = p.widths ? p.widths[i] : w, wb = p.widths ? p.widths[i + 1] : w;
        const ua = u0 + (u1 - u0) * i / (m - 1), ub = u0 + (u1 - u0) * (i + 1) / (m - 1);
        for (let v = 0; v < 4; v++) {
          const q = k * 4 + v;
          A[q * 3] = ax; A[q * 3 + 1] = ay; A[q * 3 + 2] = az;
          B[q * 3] = bx; B[q * 3 + 1] = by; B[q * 3 + 2] = bz;
          CA[q * 4] = ra * I; CA[q * 4 + 1] = ga * I; CA[q * 4 + 2] = ba * I; CA[q * 4 + 3] = aa;
          CB[q * 4] = rb * I; CB[q * 4 + 1] = gb * I; CB[q * 4 + 2] = bb * I; CB[q * 4 + 3] = ab;
          W[q * 2] = wa; W[q * 2 + 1] = wb;
          U[q * 2] = ua; U[q * 2 + 1] = ub;
          F[q] = fa;
        }
      }
    }
    for (const key of ['aA', 'aB', 'aColA', 'aColB', 'aW', 'aU', 'aFlow']) g.attributes[key].needsUpdate = true;
    g.setDrawRange(0, k * 6);
    this.count = k;
    return k;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
