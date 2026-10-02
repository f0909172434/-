// PathLines: FLines whose end points live in a TextField's path coordinates (s along the path, h along its up
// vector U, n along N = T x U) and flow along the path on the GPU, exactly like path text (s + speed * uTime).
// Width is in world units (it shrinks with distance like the text it belongs to), never below minPx.
// Use for things that travel with the river: tape edges, bamboo sticks, yarrow stalks, paper outlines.
//
//   const pl = new PathLines({ resolution: [w, h], tf });          // shares tf's path texture (call after tf.setPaths)
//   pl.set([{ a: [s, h, n], b: [s, h, n], w: 0.01, color, intensity, speed, show: [t0, t1, fin, fout], path: 0 }, ...]);
//   pl.uniforms.uTime.value = uTimeOfTheTextField;  pl.uniforms.uFocus / uAperture like the text
import * as THREE from '../../vendor/three.module.js';

const VERT = /* glsl */`
precision highp float;
precision highp sampler2D;
uniform sampler2D uPath;
uniform int uPathN;
uniform vec4 uPathL;          // lengths of paths 0..3
uniform vec2 uRes;
uniform float uPxScale, uTime, uFocus, uAperture, uMaxW, uMinPx;
uniform vec4 uFade;
attribute vec3 aA;            // (s, h, n) at uTime = 0
attribute vec3 aB;
attribute vec4 aCol;          // rgb * intensity, alpha
attribute vec4 aShow;         // t0, t1, fadeIn, fadeOut
attribute vec2 aW;            // world width, speed
attribute vec2 aCorner;       // x: 0 at A, 1 at B ; y: side -1/+1
attribute float aPath;
varying vec4 vCol;
varying float vAcross;
varying float vWpx;
float win(float t, float a, float f) { if (f <= 0.0) return step(a, t); float s = clamp((t - a) / f, 0.0, 1.0); return s * s * (3.0 - 2.0 * s); }
vec3 pathPos(int p, float s, float h, float n) {
  float L = p == 0 ? uPathL.x : p == 1 ? uPathL.y : p == 2 ? uPathL.z : uPathL.w;
  float n1 = float(uPathN - 1);
  float f = s / L * n1;
  float fc = clamp(f, 0.0, n1 - 1e-3);
  int i0 = int(fc); float k = fc - float(i0);
  vec3 p0 = texelFetch(uPath, ivec2(2 * i0, p), 0).xyz;
  vec3 p1 = texelFetch(uPath, ivec2(2 * i0 + 2, p), 0).xyz;
  vec3 u0 = texelFetch(uPath, ivec2(2 * i0 + 1, p), 0).xyz;
  vec3 u1 = texelFetch(uPath, ivec2(2 * i0 + 3, p), 0).xyz;
  vec3 T = normalize(p1 - p0);
  vec3 P = mix(p0, p1, k) + T * (f - fc) * (L / n1);
  vec3 U = normalize(mix(u0, u1, k));
  return P + U * h + cross(T, U) * n;
}
void main(){
  float vis = win(uTime, aShow.x, aShow.z) * (1.0 - win(uTime, aShow.y - aShow.w, aShow.w));
  if (vis <= 0.0 || aCol.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  int p = int(aPath + 0.5);
  float ds = aW.y * uTime;
  vec3 A = pathPos(p, aA.x + ds, aA.y, aA.z), B = pathPos(p, aB.x + ds, aB.y, aB.z);
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(A, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(B, 1.0);
  float fa = ca.z + ca.w, fb = cb.z + cb.w;
  if (fa <= 0.0 && fb <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  if (fa < 0.0) { ca = mix(ca, cb, fa / (fa - fb) + 1e-4); }
  if (fb < 0.0) { cb = mix(cb, ca, fb / (fb - fa) + 1e-4); }
  vec2 sa = ca.xy / ca.w * 0.5 * uRes, sb = cb.xy / cb.w * 0.5 * uRes;
  vec2 d = sb - sa; float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float t = aCorner.x, side = aCorner.y;
  vec4 c = mix(ca, cb, t);
  float z = c.w;
  // world width -> px at this depth; thin lines keep a minimum width and lose brightness instead
  float wpx = min(aW.x * projectionMatrix[1][1] * 0.5 * uRes.y / max(z, 1e-4), uMaxW * uPxScale);
  float gain = 1.0;
  if (wpx < uMinPx * uPxScale) { gain = wpx / (uMinPx * uPxScale); wpx = uMinPx * uPxScale; }
  if (uAperture > 0.0) {
    float coc = uAperture * abs(z - uFocus) / max(z, 1e-6) * uPxScale * 100.0;
    float w2 = min(sqrt(wpx * wpx + coc * coc), uMaxW * uPxScale);
    gain *= min(1.0, wpx / max(w2, 1e-3));
    wpx = w2;
  }
  float fade = (uFade.y > 0.0 ? smoothstep(uFade.x, uFade.y, z) : 1.0) * (uFade.w > 0.0 ? 1.0 - smoothstep(uFade.z, uFade.w, z) : 1.0);
  float hw = 0.5 * wpx + 1.0;
  vec2 s = mix(sa, sb, t) + nrm * side * hw + dir * (t * 2.0 - 1.0) * hw * 0.5;
  gl_Position = vec4(s / (0.5 * uRes) * c.w, c.z, c.w);
  vCol = vec4(aCol.rgb * gain * vis * fade, aCol.a);
  vAcross = side * hw;
  vWpx = 0.5 * wpx;
}`;

const FRAG = /* glsl */`
uniform float uOpacity;
varying vec4 vCol;
varying float vAcross;
varying float vWpx;
void main(){
  float d = abs(vAcross);
  float edge = 1.0 - smoothstep(vWpx - 0.5, vWpx + 0.75, d);
  float core = exp(-d * d / max(vWpx * vWpx, 0.25) * 1.2);
  float a = edge * (0.7 + 0.3 * core) * vCol.a * uOpacity;
  if (a <= 0.0005) discard;
  gl_FragColor = vec4(vCol.rgb * a, 1.0);
}`;

export class PathLines {
  constructor({ resolution = [1920, 804], tf, focus = 10, aperture = 0, maxWidth = 30, minPx = 0.7, fade = [0, 0, 0, 0], opacity = 1 } = {}) {
    this.tf = tf;
    this.uniforms = {
      uPath: { value: tf.uniforms.uPath.value }, uPathN: { value: tf.uniforms.uPathN.value },
      uPathL: { value: new THREE.Vector4(...[0, 1, 2, 3].map(i => tf.pathLen[i] ?? 1)) },
      uRes: { value: new THREE.Vector2(resolution[0], resolution[1]) }, uPxScale: { value: resolution[1] / 804 },
      uTime: { value: 0 }, uFocus: { value: focus }, uAperture: { value: aperture }, uMaxW: { value: maxWidth }, uMinPx: { value: minPx },
      uFade: { value: new THREE.Vector4(...fade) }, uOpacity: { value: opacity },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  // segs: [{ a: [s,h,n], b: [s,h,n], w, color, intensity, alpha, speed, show, path }]
  set(segs) {
    const n = Math.max(1, segs.length), g = this.geometry;
    const A = new Float32Array(n * 12), B = new Float32Array(n * 12), C = new Float32Array(n * 16), S = new Float32Array(n * 16);
    const W = new Float32Array(n * 8), K = new Float32Array(n * 8), P = new Float32Array(n * 4);
    const idx = new Uint32Array(n * 6);
    segs.forEach((q, i) => {
      const c0 = q.color || { r: 1, g: 1, b: 1 }, col = Array.isArray(c0) ? { r: c0[0], g: c0[1], b: c0[2] } : c0, I = q.intensity ?? 1, al = q.alpha ?? 1;
      const sh = q.show || [-1e6, 1e6, 0, 0];
      for (let v = 0; v < 4; v++) {
        const o = i * 4 + v;
        A.set(q.a, o * 3); B.set(q.b, o * 3);
        C[o * 4] = col.r * I; C[o * 4 + 1] = col.g * I; C[o * 4 + 2] = col.b * I; C[o * 4 + 3] = al;
        S[o * 4] = sh[0]; S[o * 4 + 1] = sh[1]; S[o * 4 + 2] = sh[2] ?? 0; S[o * 4 + 3] = sh[3] ?? 0;
        W[o * 2] = q.w ?? 0.01; W[o * 2 + 1] = q.speed ?? 0;
        K[o * 2] = v & 1; K[o * 2 + 1] = v & 2 ? 1 : -1;
        P[o] = q.path ?? 0;
      }
      const b = i * 4; idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], i * 6);
    });
    g.setAttribute('aA', new THREE.BufferAttribute(A, 3)); g.setAttribute('aB', new THREE.BufferAttribute(B, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(C, 4)); g.setAttribute('aShow', new THREE.BufferAttribute(S, 4));
    g.setAttribute('aW', new THREE.BufferAttribute(W, 2)); g.setAttribute('aCorner', new THREE.BufferAttribute(K, 2));
    g.setAttribute('aPath', new THREE.BufferAttribute(P, 1));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, segs.length * 6);
    this.count = segs.length;
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
