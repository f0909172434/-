// SoftPoints: round, soft, energy-conserving points with physical-ish depth of field.
// In-focus points are small gaussian dots; out-of-focus points grow into dim flat bokeh discs
// (brightness divided by area), so defocus never adds light or sparkle.
//
//   const sp = new SoftPoints({ count, resolution:[w,h] });
//   sp.positions / sp.colors (rgb*intensity) / sp.sizes (px @ 804p) are Float32Arrays; call sp.update() after writing.
//   sp.uniforms.uFocus.value = distance; sp.uniforms.uAperture.value = 0..; (0 = everything sharp)
import * as THREE from '../../vendor/three.module.js';

const VERT = /* glsl */`
uniform float uPxScale;
uniform float uFocus;
uniform float uAperture;
uniform float uMaxSize;
attribute vec3 color;
attribute float size;
varying vec3 vCol;
varying float vBokeh;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float z = -mv.z;
  gl_Position = projectionMatrix * mv;
  float base = size * uPxScale;
  float coc = uAperture * abs(z - uFocus) / max(z, 1e-3) * uPxScale * 100.0;
  float s = clamp(sqrt(base * base + coc * coc), 1.0, uMaxSize);
  vBokeh = smoothstep(2.0, 8.0, coc);
  vCol = color * (base * base) / (s * s) * (1.0 + 2.0 * vBokeh);
  gl_PointSize = s + 2.0;
  if (z <= 0.0) gl_PointSize = 0.0;
}`;
const FRAG = /* glsl */`
varying vec3 vCol;
varying float vBokeh;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float g = exp(-r * r * 4.5);
  float disc = (1.0 - smoothstep(0.82, 1.0, r)) * (0.75 + 0.25 * smoothstep(0.5, 0.95, r));
  float a = mix(g, disc * 0.6, vBokeh);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

export class SoftPoints {
  constructor({ count, resolution = [1920, 804], focus = 10, aperture = 0, maxSize = 64, depthTest = true } = {}) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count).fill(2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = g;
    this.uniforms = {
      uPxScale: { value: resolution[1] / 804 }, uFocus: { value: focus }, uAperture: { value: aperture },
      uMaxSize: { value: maxSize * resolution[1] / 804 },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Points(g, this.material);
    this.mesh.frustumCulled = false;
  }
  update(n = this.count) {
    this.geometry.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size']) this.geometry.attributes[k].needsUpdate = true;
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
