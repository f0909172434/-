// Edge-lit boxes: many axis-aligned boxes merged into one geometry, drawn black (occluding, additive so a
// fading level never paints black over earlier levels) with anti-aliased glowing EDGES computed from the
// per-face UVs (no z-fighting, one draw call). Optional faint iso-lines across the faces, a rim term,
// depth fade, and light pulses that travel along each box's long axis (signals on a wire).
//
//   const g = boxGeometry([{ min:[x,y,z], max:[x,y,z], axis:0|1|2, pulse:[phase, speed, amount], bright:1 }, ...]);
//   const m = edgeMaterial({ color, intensity, width, fade:[near,far], resolution });
//   m.uniforms.uTime.value = t; m.uniforms.uOpacity.value = k;
import * as THREE from '../../vendor/three.module.js';

const VERT = /* glsl */`
attribute vec2 aUvx;     // face uv
attribute vec4 aBox;     // x: along-axis coordinate (world units), y: pulse phase, z: pulse speed, w: pulse amount
attribute float aBright;
attribute vec2 aFaceSize; // world size of the face (u, v) for constant-width iso-lines
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDepth;
varying vec4 vBox;
varying float vBright;
varying vec2 vFace;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  vUv = aUvx; vBox = aBox; vBright = aBright; vFace = aFaceSize;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uPulseColor;
uniform float uWidth;
uniform float uPxScale;
uniform float uOpacity;
uniform float uRim;
uniform float uTime;
uniform float uPulse;
uniform float uPulseLen;
uniform vec2 uFade;
uniform float uIso;       // spacing (world units) of faint iso-lines across faces (0 = off)
uniform float uIsoI;
uniform float uFacing;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDepth;
varying vec4 vBox;
varying float vBright;
varying vec2 vFace;
float lineAA(float d, float fw, float wpx){
  float px = d / max(fw, 1e-6);
  return 1.0 - smoothstep(wpx * 0.5 - 0.5, wpx * 0.5 + 0.75, px);
}
void main(){
  vec2 fw = fwidth(vUv);
  float wpx = uWidth * uPxScale;
  vec2 dd = min(vUv, 1.0 - vUv);
  float e = max(lineAA(dd.x, fw.x, wpx), lineAA(dd.y, fw.y, wpx));
  // tiny faces: fade to average coverage instead of shimmering
  float dense = smoothstep(0.12, 0.35, max(fw.x, fw.y));
  float avg = min(1.0, wpx * (fw.x + fw.y));
  e = mix(e, avg, dense);
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float facing = mix(1.0, 0.35 + 0.65 * ndv, uFacing);
  float I = e * facing;
  if (uIso > 0.0) {
    float f = vUv.x * vFace.x / uIso;
    float fwi = max(fwidth(f), 1e-5);
    float di = abs(fract(f + 0.5) - 0.5) / fwi;
    float li = 1.0 - smoothstep(wpx * 0.5 - 0.5, wpx * 0.5 + 0.75, di);
    li = mix(li, min(1.0, wpx * fwi), smoothstep(0.18, 0.45, fwi));
    I += li * uIsoI * facing;
  }
  vec3 col = uColor * I * vBright;
  // signal pulses along the box axis
  if (uPulse > 0.0 && vBox.w > 0.0) {
    float p = fract(vBox.x / uPulseLen - uTime * vBox.z + vBox.y);
    float pk = pow(1.0 - p, 10.0) * smoothstep(0.0, 0.02, p) + 0.0;
    col += uPulseColor * e * pk * vBox.w * uPulse * 4.0;
  }
  col += uColor * pow(1.0 - ndv, 3.0) * uRim * vBright;
  if (uFade.y > 0.0) col *= 1.0 - smoothstep(uFade.x, uFade.y, vDepth);
  gl_FragColor = vec4(col * uOpacity, 1.0);
}`;

export function edgeMaterial({ color = new THREE.Color(1, 1, 1), intensity = 0.6, pulseColor = null, width = 1.1, rim = 0.0, fade = [0, 0],
  iso = 0, isoI = 0.25, facing = 0.4, pulseLen = 1, resolution = [1920, 804], side = THREE.FrontSide } = {}) {
  const uniforms = {
    uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
    uPulseColor: { value: new THREE.Color(pulseColor || color) },
    uWidth: { value: width }, uPxScale: { value: resolution[1] / 804 }, uOpacity: { value: 1 }, uRim: { value: rim },
    uTime: { value: 0 }, uPulse: { value: 0 }, uPulseLen: { value: pulseLen }, uFade: { value: new THREE.Vector2(fade[0], fade[1]) },
    uIso: { value: iso }, uIsoI: { value: isoI }, uFacing: { value: facing },
  };
  const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side,
    transparent: false, depthWrite: true, blending: THREE.AdditiveBlending });
  m.extensions = { derivatives: true };
  return m;
}

// boxes: [{ min:[x,y,z], max:[x,y,z], axis (0|1|2 long axis for pulses/iso), pulse:[phase,speed,amount], bright }]
export function boxGeometry(boxes) {
  const n = boxes.length;
  const P = new Float32Array(n * 24 * 3), N = new Float32Array(n * 24 * 3), UV = new Float32Array(n * 24 * 2);
  const BX = new Float32Array(n * 24 * 4), BR = new Float32Array(n * 24), FS = new Float32Array(n * 24 * 2);
  const idx = new Uint32Array(n * 36);
  // faces: normal axis a, sign s; u axis, v axis
  const faces = [[0, 1, 2, 1], [0, -1, 2, 1], [1, 1, 0, 2], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 0, 1]];
  let v = 0, ii = 0;
  for (let b = 0; b < n; b++) {
    const B = boxes[b], mn = B.min, mx = B.max, ax = B.axis ?? 0;
    const pulse = B.pulse || [0, 0, 0], br = B.bright ?? 1;
    for (const [a, s, ua, va] of faces) {
      // long-axis faces put the long axis on u where possible
      let U = ua, V = va;
      if (V === ax) { U = va; V = ua; }
      const base = v;
      for (let c = 0; c < 4; c++) {
        const cu = (c & 1), cv = (c >> 1);
        const p = [0, 0, 0];
        p[a] = s > 0 ? mx[a] : mn[a];
        p[U] = cu ? mx[U] : mn[U];
        p[V] = cv ? mx[V] : mn[V];
        P.set(p, v * 3);
        const nn = [0, 0, 0]; nn[a] = s; N.set(nn, v * 3);
        UV[v * 2] = cu; UV[v * 2 + 1] = cv;
        BX[v * 4] = p[ax]; BX[v * 4 + 1] = pulse[0]; BX[v * 4 + 2] = pulse[1]; BX[v * 4 + 3] = pulse[2];
        BR[v] = br;
        FS[v * 2] = mx[U] - mn[U]; FS[v * 2 + 1] = mx[V] - mn[V];
        v++;
      }
      // winding: make the triangle normal agree with the face normal
      const e1 = [0, 0, 0], e2 = [0, 0, 0];
      for (let k = 0; k < 3; k++) { e1[k] = P[(base + 1) * 3 + k] - P[base * 3 + k]; e2[k] = P[(base + 2) * 3 + k] - P[base * 3 + k]; }
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const ok = cr[a] * s > 0;
      if (ok) idx.set([base, base + 1, base + 2, base + 2, base + 1, base + 3], ii);
      else idx.set([base, base + 2, base + 1, base + 1, base + 2, base + 3], ii);
      ii += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('aUvx', new THREE.BufferAttribute(UV, 2));
  g.setAttribute('aBox', new THREE.BufferAttribute(BX, 4));
  g.setAttribute('aBright', new THREE.BufferAttribute(BR, 1));
  g.setAttribute('aFaceSize', new THREE.BufferAttribute(FS, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
