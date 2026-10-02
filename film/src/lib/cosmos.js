// Shared helpers for the cosmic scenes (nebula / earth): seeded JS simplex noise,
// a background starfield, and a one-shot procedural texture baker.
import * as THREE from '../../vendor/three.module.js';
import { Rand } from './random.js';

// ---------------------------------------------------------------- JS simplex 3D (seeded)
const G3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
export class Noise3 {
  constructor(seed = 1) {
    const r = new Rand(seed); const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512); this.pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.pm12[i] = this.perm[i] % 12; }
  }
  n(x, y, z) {
    const F3 = 1 / 3, G = 1 / 6, perm = this.perm, pm = this.pm12;
    const s = (x + y + z) * F3; const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G; const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
    else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
    const x1 = x0 - i1 + G, y1 = y0 - j1 + G, z1 = z0 - k1 + G;
    const x2 = x0 - i2 + 2 * G, y2 = y0 - j2 + 2 * G, z2 = z0 - k2 + 2 * G;
    const x3 = x0 - 1 + 0.5, y3 = y0 - 1 + 0.5, z3 = z0 - 1 + 0.5;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt, g;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0; if (tt > 0) { g = G3[pm[ii + perm[jj + perm[kk]]]]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0 + g[2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1; if (tt > 0) { g = G3[pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]]]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1 + g[2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2; if (tt > 0) { g = G3[pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2 + g[2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3; if (tt > 0) { g = G3[pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]]; tt *= tt; n += tt * tt * (g[0] * x3 + g[1] * y3 + g[2] * z3); }
    return 32 * n; // ~[-1,1]
  }
  fbm(x, y, z, oct = 4) { let s = 0, a = 0.5; for (let i = 0; i < oct; i++) { s += a * this.n(x, y, z); x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; z = z * 2.03 + 3.7; a *= 0.5; } return s; }
  // curl of a noise vector potential (divergence free flow), returned into out
  curl(x, y, z, out = [0, 0, 0]) {
    const e = 0.02, n = (a, b, c, o) => this.n(a + o * 31.4, b + o * 7.1, c - o * 9.7);
    const dPz_dy = (n(x, y + e, z, 2) - n(x, y - e, z, 2)), dPy_dz = (n(x, y, z + e, 1) - n(x, y, z - e, 1));
    const dPx_dz = (n(x, y, z + e, 0) - n(x, y, z - e, 0)), dPz_dx = (n(x + e, y, z, 2) - n(x - e, y, z, 2));
    const dPy_dx = (n(x + e, y, z, 1) - n(x - e, y, z, 1)), dPx_dy = (n(x, y + e, z, 0) - n(x, y - e, z, 0));
    out[0] = (dPz_dy - dPy_dz) / (2 * e); out[1] = (dPx_dz - dPz_dx) / (2 * e); out[2] = (dPy_dx - dPx_dy) / (2 * e);
    return out;
  }
}

// ---------------------------------------------------------------- starfield
// Stars on a unit sphere, drawn at infinity (the Points object should be positioned at the camera).
// Size/brightness are per-star; output is linear HDR.
export function makeStarfield({ seed = 7, count = 20000, scale = 1, brightness = 1, band = null, minSize = 1.0 } = {}) {
  const r = new Rand(seed);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 4);
  const v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    r.onSphere(v);
    // optional galactic band concentration
    if (band && r.next() < band.frac) {
      const [bx, by, bz] = band.normal; const d = v[0] * bx + v[1] * by + v[2] * bz;
      const k = band.width * r.gauss();
      v[0] -= bx * (d - k); v[1] -= by * (d - k); v[2] -= bz * (d - k);
      const l = Math.hypot(v[0], v[1], v[2]); v[0] /= l; v[1] /= l; v[2] /= l;
    }
    pos.set([v[0] * 100, v[1] * 100, v[2] * 100], i * 3);
    // magnitude distribution: many faint, few bright
    const m = Math.pow(r.next(), 9.0);
    const L = (0.05 + 3.5 * m + 0.25 * r.next() * r.next()) * brightness;
    const tK = r.next();
    // colour temperature: red dwarfs .. blue giants
    let c;
    if (tK < 0.25) c = [1.0, 0.72, 0.52]; else if (tK < 0.55) c = [1.0, 0.9, 0.8]; else if (tK < 0.85) c = [0.85, 0.9, 1.0]; else c = [0.65, 0.78, 1.0];
    col.set([c[0] * L, c[1] * L, c[2] * L, minSize + 1.6 * Math.sqrt(m) + 0.4 * r.next()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: scale }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec4 aCol; uniform float uScale, uGain; varying vec3 vCol;
      void main(){
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        float s = aCol.a*uScale*1.25; float sc = max(s, 1.0);
        vCol = aCol.rgb*uGain*(s*s)/(sc*sc);
        gl_PointSize = sc + 1.0;
        gl_Position = projectionMatrix*mv; gl_Position.z = gl_Position.w*0.9999;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      void main(){ vec2 d = gl_PointCoord-0.5; float r2 = dot(d,d)*4.0; float a = exp(-r2*3.5)*(1.0-smoothstep(0.7,1.0,r2)); gl_FragColor = vec4(vCol*a, 1.0); }`,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = -10;
  return pts;
}

// ---------------------------------------------------------------- one-shot bake
const BVERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
export function bake(renderer, w, h, frag, uniforms = {}, { wrapS = THREE.RepeatWrapping, wrapT = THREE.ClampToEdgeWrapping, mipmaps = true, type = THREE.HalfFloatType } = {}) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type, depthBuffer: false, generateMipmaps: mipmaps,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS, wrapT,
  });
  const mat = new THREE.ShaderMaterial({ vertexShader: BVERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
  return rt;
}

// Full-screen quad helper (for composite passes inside a scene's custom render()).
export function fsQuad(material) {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, cam, quad };
}

// Tileable 2D gradient noise for baked textures (period P in lattice cells).
export const periodicGrad = /* glsl */`
vec2 pgrad2(vec2 i, float P){ i = mod(i, P); vec3 p3 = fract(vec3(i.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33);
  float h = fract((p3.x+p3.y)*p3.z); float a = h*6.2831853; return vec2(cos(a), sin(a)); }
float pgnoise(vec2 p, float P){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float a=dot(pgrad2(i,P),f), b=dot(pgrad2(i+vec2(1,0),P),f-vec2(1,0)), c=dot(pgrad2(i+vec2(0,1),P),f-vec2(0,1)), d=dot(pgrad2(i+vec2(1,1),P),f-vec2(1,1));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.42; }
float pgfbm(vec2 p, float P, int oct){ float s=0.0,a=0.5; for(int i=0;i<8;i++){ if(i>=oct) break; s+=a*pgnoise(p,P); p*=2.0; P*=2.0; a*=0.5; } return s; }
`;
