// contourMaterial: the house style for solids. The surface itself is (near) black and writes depth,
// so it occludes; light lives only in anti-aliased iso-lines ("slices") and an optional silhouette rim.
//
//   const m = contourMaterial({ color: PAL.line, intensity: 0.8, spacing: 0.05, width: 1.1,
//                               mode: 'plane', dir: [0,1,0], space: 'object', rim: 0.6, rimColor: PAL.line });
//   m.uniforms.uOffset.value = t * 0.1;   // slide the slices (scan effect)
//
// modes: 'plane'  — slices perpendicular to `dir`
//        'radial' — concentric shells around `center` (in the chosen space)
//        'both'   — plane + a second family along `dir2` (cross-hatch / graticule)
// space: 'object' (lines stick to the object, use for moving things) | 'world'
// Dense-line safety: where lines would be closer than ~3 px they fade to their average brightness (no moiré).
import * as THREE from '../../vendor/three.module.js';
import { PALETTE_GLSL } from './palette.js';

const VERT = /* glsl */`
uniform int uSpace;
varying vec3 vP;
varying vec3 vN;
varying vec3 vV;
varying float vDepth;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = uSpace == 0 ? position : wp.xyz;
  vN = normalize(uSpace == 0 ? normal : mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vV = normalize(cameraPosition - wp.xyz);
  if (uSpace == 0) { vV = normalize((inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position); }
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = PALETTE_GLSL + /* glsl */`
uniform int uMode;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform vec3 uRimColor;
uniform vec3 uFillColor;
uniform vec3 uDir;
uniform vec3 uDir2;
uniform vec3 uCenter;
uniform float uSpacing;
uniform float uSpacing2;
uniform float uWidth;
uniform float uOffset;
uniform float uOffset2;
uniform float uRim;
uniform float uRimPow;
uniform float uFill;
uniform vec2 uFade;
uniform float uOpacity;
uniform float uPxScale;
uniform float uFacing;   // > 0: lines dim on surfaces facing away from the viewer (silhouette emphasis)
varying vec3 vP;
varying vec3 vN;
varying vec3 vV;
varying float vDepth;

float aaLines(float f, float wpx){
  float fw = max(fwidth(f), 1e-5);
  float d = abs(fract(f + 0.5) - 0.5) / fw;          // distance to nearest line in px
  float line = 1.0 - smoothstep(wpx * 0.5 - 0.5, wpx * 0.5 + 0.75, d);
  float dense = smoothstep(0.18, 0.45, fw);            // lines closer than ~3px -> average
  return mix(line, min(1.0, wpx * fw), dense);
}

void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float ndv = abs(dot(n, v));
  float wpx = uWidth * uPxScale;
  float f1;
  if (uMode == 1) f1 = length(vP - uCenter) / uSpacing + uOffset;
  else f1 = dot(vP, normalize(uDir)) / uSpacing + uOffset;
  float l1 = aaLines(f1, wpx);
  vec3 col = uFillColor * uFill + uColor * l1 * mix(1.0, ndv, uFacing);
  if (uMode == 2) {
    float f2 = dot(vP, normalize(uDir2)) / uSpacing2 + uOffset2;
    col += uColor2 * aaLines(f2, wpx) * mix(1.0, ndv, uFacing);
  }
  float rim = pow(1.0 - ndv, uRimPow);
  col += uRimColor * rim * uRim;
  if (uFade.y > 0.0) col *= 1.0 - smoothstep(uFade.x, uFade.y, vDepth);
  gl_FragColor = vec4(col * uOpacity, 1.0);
}`;

export function contourMaterial({
  color = new THREE.Color(1, 1, 1), intensity = 0.8, color2 = null, intensity2 = null,
  spacing = 0.05, spacing2 = null, width = 1.1, mode = 'plane', dir = [0, 1, 0], dir2 = [1, 0, 0], center = [0, 0, 0],
  space = 'object', rim = 0.5, rimPow = 3.0, rimColor = null, fill = 0.0, fillColor = null,
  fade = [0, 0], opacity = 1, facing = 0.35, resolution = [1920, 804], side = THREE.FrontSide,
  transparent = false, blending = THREE.NormalBlending, depthWrite = true,
} = {}) {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const c2 = new THREE.Color(color2 || color).multiplyScalar(intensity2 ?? intensity);
  const rc = new THREE.Color(rimColor || color);
  const fc = new THREE.Color(fillColor || color);
  const uniforms = {
    uMode: { value: mode === 'radial' ? 1 : mode === 'both' ? 2 : 0 },
    uSpace: { value: space === 'object' ? 0 : 1 },
    uColor: { value: c }, uColor2: { value: c2 }, uRimColor: { value: rc }, uFillColor: { value: fc },
    uDir: { value: new THREE.Vector3(...dir) }, uDir2: { value: new THREE.Vector3(...dir2) }, uCenter: { value: new THREE.Vector3(...center) },
    uSpacing: { value: spacing }, uSpacing2: { value: spacing2 ?? spacing }, uWidth: { value: width },
    uOffset: { value: 0 }, uOffset2: { value: 0 }, uRim: { value: rim }, uRimPow: { value: rimPow },
    uFill: { value: fill }, uFade: { value: new THREE.Vector2(fade[0], fade[1]) }, uOpacity: { value: opacity },
    uPxScale: { value: resolution[1] / 804 }, uFacing: { value: facing },
  };
  const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side, transparent, blending, depthWrite });
  m.extensions = { derivatives: true };
  return m;
}

// A black occluder: writes depth, draws nothing. Use to hide lines behind solid things.
export function occluderMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x000000 });
}
