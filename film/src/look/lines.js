// GlowLines: anti-aliased screen-space ribbons built from polylines.
// Every segment is an instanced quad expanded in the vertex shader to a fixed pixel width,
// with a soft gaussian core and a 1px feathered edge. Additive, HDR, depth-tested (occluded by
// contour surfaces), not depth-writing.
//
//   const gl = new GlowLines({ resolution: [ctx.width, ctx.height] });
//   gl.setPolylines([{ points: [x,y,z, x,y,z, ...], color: PAL.line, intensity: 0.6, width: 1.2 }, ...]);
//   scene.add(gl.mesh);
//   gl.uniforms.uTime.value = t;   // drives the optional flow pulses
//
// Per-polyline options: color (THREE.Color), intensity, width (px @ 804p), alpha (array per vertex, optional),
// flow (0..1 pulse amount), u0/u1 (arc-length param range, used by flow), fade ([near, far] depth fade).
import * as THREE from '../../vendor/three.module.js';

const VERT = /* glsl */`
uniform vec2 uRes;
uniform float uPxScale;
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aColA;   // rgb * intensity, a = per-vertex alpha
attribute vec4 aColB;
attribute vec2 aW;      // width at A, width at B (px @ 804p)
attribute vec2 aU;      // arc param at A, B
varying vec4 vCol;
varying float vAcross;
varying float vU;
varying float vWpx;
varying float vDepth;
void main(){
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(aA, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
  // degenerate if behind the camera
  if (ca.w <= 0.0 || cb.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  vec2 sa = ca.xy / ca.w * 0.5 * uRes;
  vec2 sb = cb.xy / cb.w * 0.5 * uRes;
  vec2 d = sb - sa; float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float t = position.x;            // 0 at A, 1 at B
  float side = position.y;         // -1 / +1
  float w = mix(aW.x, aW.y, t) * uPxScale;
  float hw = 0.5 * w + 1.0;        // + feather
  vec4 c = mix(ca, cb, t);
  vec2 s = mix(sa, sb, t) + nrm * side * hw + dir * (t * 2.0 - 1.0) * hw * 0.5;
  gl_Position = vec4(s / (0.5 * uRes) * c.w, c.z, c.w);
  vCol = mix(aColA, aColB, t);
  vAcross = side * hw;
  vWpx = 0.5 * w;
  vU = mix(aU.x, aU.y, t);
  vDepth = c.w;
}`;

const FRAG = /* glsl */`
uniform float uTime;
uniform float uFlow;
uniform float uFlowFreq;
uniform float uFlowSpeed;
uniform vec2 uFade;      // depth fade: full at < x, zero at > y (0,0 = off)
uniform float uOpacity;
varying vec4 vCol;
varying float vAcross;
varying float vU;
varying float vWpx;
varying float vDepth;
void main(){
  float d = abs(vAcross);
  float edge = 1.0 - smoothstep(vWpx - 0.5, vWpx + 0.75, d);      // coverage with 1px AA
  float core = exp(-d * d / max(vWpx * vWpx, 0.25) * 1.6);         // soft centre
  float a = edge * (0.55 + 0.45 * core) * vCol.a * uOpacity;
  if (uFlow > 0.0) {
    float p = fract(vU * uFlowFreq - uTime * uFlowSpeed);
    a *= 1.0 + uFlow * (pow(1.0 - p, 6.0) * 3.0 - 0.35);
  }
  if (uFade.y > 0.0) a *= 1.0 - smoothstep(uFade.x, uFade.y, vDepth);
  if (a <= 0.0005) discard;
  gl_FragColor = vec4(vCol.rgb * a, 1.0);
}`;

export class GlowLines {
  constructor({ resolution = [1920, 804], flow = 0, flowFreq = 1, flowSpeed = 0.5, fade = [0, 0], opacity = 1, depthTest = true, blending = THREE.AdditiveBlending } = {}) {
    this.uniforms = {
      uRes: { value: new THREE.Vector2(resolution[0], resolution[1]) },
      uPxScale: { value: resolution[1] / 804 },
      uTime: { value: 0 }, uFlow: { value: flow }, uFlowFreq: { value: flowFreq }, uFlowSpeed: { value: flowSpeed },
      uFade: { value: new THREE.Vector2(fade[0], fade[1]) }, uOpacity: { value: opacity },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest, blending,
    });
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    this.geometry = quad;
    this.mesh = new THREE.Mesh(quad, this.material);
    this.mesh.frustumCulled = false;
    this.capacity = 0;
  }

  _alloc(n) {
    if (n <= this.capacity) return;
    const cap = Math.max(n, Math.ceil(this.capacity * 1.5));
    const g = this.geometry;
    const mk = (k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('aA', mk(3)); g.setAttribute('aB', mk(3));
    g.setAttribute('aColA', mk(4)); g.setAttribute('aColB', mk(4));
    g.setAttribute('aW', mk(2)); g.setAttribute('aU', mk(2));
    this.capacity = cap;
  }

  // polylines: [{ points:Float32Array|number[] (xyz...), color, intensity, width, alpha?:number[], u0?, u1?, colors?:number[] (rgb per vertex) }]
  setPolylines(polylines) {
    let n = 0;
    for (const p of polylines) n += Math.max(0, p.points.length / 3 - 1);
    this._alloc(n);
    const g = this.geometry;
    const A = g.attributes.aA.array, B = g.attributes.aB.array, CA = g.attributes.aColA.array, CB = g.attributes.aColB.array;
    const W = g.attributes.aW.array, U = g.attributes.aU.array;
    let k = 0;
    for (const p of polylines) {
      const pts = p.points, m = pts.length / 3;
      if (m < 2) continue;
      const col = p.color || { r: 1, g: 1, b: 1 }, I = p.intensity ?? 1, w = p.width ?? 1.2;
      const u0 = p.u0 ?? 0, u1 = p.u1 ?? 1;
      for (let i = 0; i < m - 1; i++, k++) {
        A[k * 3] = pts[i * 3]; A[k * 3 + 1] = pts[i * 3 + 1]; A[k * 3 + 2] = pts[i * 3 + 2];
        B[k * 3] = pts[i * 3 + 3]; B[k * 3 + 1] = pts[i * 3 + 4]; B[k * 3 + 2] = pts[i * 3 + 5];
        const aa = p.alpha ? p.alpha[i] : 1, ab = p.alpha ? p.alpha[i + 1] : 1;
        let ra = col.r, ga = col.g, ba = col.b, rb = col.r, gb = col.g, bb = col.b;
        if (p.colors) { ra = p.colors[i * 3]; ga = p.colors[i * 3 + 1]; ba = p.colors[i * 3 + 2]; rb = p.colors[i * 3 + 3]; gb = p.colors[i * 3 + 4]; bb = p.colors[i * 3 + 5]; }
        CA[k * 4] = ra * I; CA[k * 4 + 1] = ga * I; CA[k * 4 + 2] = ba * I; CA[k * 4 + 3] = aa;
        CB[k * 4] = rb * I; CB[k * 4 + 1] = gb * I; CB[k * 4 + 2] = bb * I; CB[k * 4 + 3] = ab;
        const wa = p.widths ? p.widths[i] : w, wb = p.widths ? p.widths[i + 1] : w;
        W[k * 2] = wa; W[k * 2 + 1] = wb;
        U[k * 2] = u0 + (u1 - u0) * i / (m - 1); U[k * 2 + 1] = u0 + (u1 - u0) * (i + 1) / (m - 1);
      }
    }
    for (const key of ['aA', 'aB', 'aColA', 'aColB', 'aW', 'aU']) g.attributes[key].needsUpdate = true;
    g.instanceCount = k;
    return k;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
