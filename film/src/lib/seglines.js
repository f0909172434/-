// SegLines: many independent straight segments (yao lines, rules, holes, dots, dashes) rebuilt on the CPU
// every update(), drawn as ONE non-instanced additive quad mesh (SwiftShader pays ~20 µs per instance).
//
// Unlike FLines / GlowLines, the ends are anti-aliased exactly (box-filtered along the segment), so two
// segments that abut sum to exactly one coverage at the joint, a broken line's gap is exactly as wide as
// asked, and a short bar keeps its true length at any sub-pixel offset. cap = 1 gives round ends
// (a zero-length round segment is a disc: holes, dots, vias).
//
//   const sl = new SegLines({ resolution: [ctx.width, ctx.height], capacity: 4096 });
//   scene.add(sl.mesh);
//   // update(shot, t):
//   sl.begin();
//   sl.seg(ax, ay, az, bx, by, bz, widthPx, r, g, b, alpha, cap);   // r,g,b = linear colour × intensity
//   sl.end();
//
// Widths are px at 804p (scaled with the render height). Thin segments (< 1 px) keep their energy
// (coverage = width) instead of shrinking into aliasing.
import * as THREE from '../../vendor/three.module.js';

const VERT = /* glsl */`
uniform vec2 uRes;
uniform float uPxScale;
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aCol;
attribute vec2 aW;        // x: width px @804p, y: cap (0 flat, 1 round)
attribute vec2 aCorner;   // x: 0 at A, 1 at B ; y: side -1/+1
varying vec4 vCol;
varying vec3 vL;          // along (px from A), across (px), length (px)
varying vec2 vH;          // half width px, cap
void main(){
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(aA, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
  float fa = ca.z + ca.w, fb = cb.z + cb.w;
  if ((fa <= 0.0 && fb <= 0.0) || aCol.a <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); vL = vec3(0.0); vH = vec2(0.0); return;
  }
  if (fa < 0.0) ca = mix(ca, cb, fa / (fa - fb) + 1e-4);
  if (fb < 0.0) cb = mix(cb, ca, fb / (fb - fa) + 1e-4);
  vec2 sa = ca.xy / ca.w * 0.5 * uRes;
  vec2 sb = cb.xy / cb.w * 0.5 * uRes;
  vec2 d = sb - sa; float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = 0.5 * aW.x * uPxScale;
  float m = max(hw, 0.5) + 1.0;
  float t = aCorner.x, side = aCorner.y;
  vec2 s = mix(sa, sb, t) + nrm * side * m + dir * (t * 2.0 - 1.0) * m;
  float z = mix(ca.z / ca.w, cb.z / cb.w, t);
  gl_Position = vec4(s / (0.5 * uRes), z, 1.0);
  vL = vec3(t * len + (t * 2.0 - 1.0) * m, side * m, len);
  vH = vec2(hw, aW.y);
  vCol = aCol;
}`;

const FRAG = /* glsl */`
uniform float uOpacity;
uniform float uCore;
varying vec4 vCol;
varying vec3 vL;
varying vec2 vH;
void main(){
  float u = vL.x, v = vL.y, len = vL.z, hw = vH.x;
  float top = min(2.0 * hw, 1.0);
  float cov;
  if (vH.y > 0.5) {
    float du = max(max(-u, u - len), 0.0);
    cov = clamp(hw + 0.5 - length(vec2(du, v)), 0.0, top);
  } else {
    float ac = clamp(hw + 0.5 - abs(v), 0.0, top);
    float al = clamp(u + 0.5, 0.0, 1.0) * clamp(len - u + 0.5, 0.0, 1.0);
    cov = ac * al;
  }
  if (uCore > 0.0) cov *= mix(1.0, 0.62 + 0.38 * exp(-v * v / max(hw * hw, 0.25) * 1.6), uCore);
  float a = cov * vCol.a * uOpacity;
  if (a <= 0.0004) discard;
  gl_FragColor = vec4(vCol.rgb * a, 1.0);
}`;

export class SegLines {
  constructor({ resolution = [1920, 804], capacity = 2048, depthTest = false, opacity = 1, core = 0 } = {}) {
    this.uniforms = {
      uRes: { value: new THREE.Vector2(resolution[0], resolution[1]) },
      uPxScale: { value: resolution[1] / 804 },
      uOpacity: { value: opacity }, uCore: { value: core },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending,
    });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.capacity = 0; this.n = 0;
    this._alloc(capacity);
  }

  _alloc(n) {
    if (n <= this.capacity) return;
    const cap = Math.max(n, Math.ceil(this.capacity * 1.5));
    const g = this.geometry;
    const keep = this.capacity ? { A: this.A, B: this.B, C: this.C, W: this.W } : null;
    const mk = (name, k) => {
      const a = new THREE.BufferAttribute(new Float32Array(cap * 4 * k), k); a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a); return a.array;
    };
    this.A = mk('aA', 3); this.B = mk('aB', 3); this.C = mk('aCol', 4); this.W = mk('aW', 2);
    if (keep) { this.A.set(keep.A); this.B.set(keep.B); this.C.set(keep.C); this.W.set(keep.W); }
    const corner = new Float32Array(cap * 4 * 2);
    for (let i = 0; i < cap; i++) corner.set([0, -1, 1, -1, 0, 1, 1, 1], i * 8);
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 4 * 3), 3));
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) { const v = i * 4; idx[i * 6] = v; idx[i * 6 + 1] = v + 1; idx[i * 6 + 2] = v + 2; idx[i * 6 + 3] = v + 2; idx[i * 6 + 4] = v + 1; idx[i * 6 + 5] = v + 3; }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.capacity = cap;
  }

  begin() { this.n = 0; }

  seg(ax, ay, az, bx, by, bz, w, r, g, b, a = 1, cap = 0) {
    if (a <= 0.0005 || w <= 0) return -1;
    if (this.n >= this.capacity) this._alloc(this.n + 1);
    const i = this.n++, A = this.A, B = this.B, C = this.C, W = this.W;
    for (let v = 0; v < 4; v++) {
      const q = i * 4 + v;
      A[q * 3] = ax; A[q * 3 + 1] = ay; A[q * 3 + 2] = az;
      B[q * 3] = bx; B[q * 3 + 1] = by; B[q * 3 + 2] = bz;
      C[q * 4] = r; C[q * 4 + 1] = g; C[q * 4 + 2] = b; C[q * 4 + 3] = a;
      W[q * 2] = w; W[q * 2 + 1] = cap;
    }
    return i;
  }

  end() {
    const g = this.geometry, n = Math.max(this.n, 0);
    for (const [key, k] of [['aA', 3], ['aB', 3], ['aCol', 4], ['aW', 2]]) {
      const at = g.attributes[key];
      at.clearUpdateRanges(); at.addUpdateRange(0, Math.max(n, 1) * 4 * k); at.needsUpdate = true;
    }
    g.setDrawRange(0, n * 6);
    return n;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
