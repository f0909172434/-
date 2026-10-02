// #10 PRIMORDIAL OCEAN (T 122–138).
// Golden dawn at water level -> the camera sinks through a wavy water line (dome-port half/half)
// -> underwater: turquoise→abyss gradient, slanting god rays, shimmering underside, marine snow with DOF
// -> a bioluminescent cell emerges from the blue and divides 1 → 2 → 4.
import * as THREE from '../../vendor/three.module.js';
import { Rand } from '../lib/random.js';
import { clamp, lerp, smoothstep, easeInOutCubic } from '../lib/ease.js';
import { fbm1 } from '../lib/random.js';

// ---------------------------------------------------------------- waves (shared JS + GLSL)
// [wavelength m, amplitude m, direction deg (0 = travelling toward +z, i.e. toward camera), steepness, phase]
const WAVES = [
  [52, 0.46, 6, 0.55, 0.0],
  [33, 0.27, -17, 0.55, 1.7],
  [21, 0.17, 27, 0.6, 4.1],
  [13.5, 0.095, -36, 0.6, 2.2],
  [8.7, 0.058, 49, 0.6, 5.3],
  [5.6, 0.034, -58, 0.55, 0.9],
  [3.5, 0.019, 71, 0.5, 3.6],
  [2.3, 0.011, -83, 0.5, 2.8],
].map(([L, A, deg, s, ph]) => {
  const k = 2 * Math.PI / L, w = Math.sqrt(9.81 * k), a = deg * Math.PI / 180;
  return { k, w, A, dx: Math.sin(a), dz: Math.cos(a), Q: s / (k * A * 8), ph };
});
const f = (x) => x.toFixed(6);
// GLSL: gerstner displacement of an undisplaced point, its analytic normal, and an inverse height lookup
const WAVE_GLSL = `
vec3 gerstner(vec2 x, float t){
  vec3 p = vec3(0.0);
  float th;
${WAVES.map(W => `  th = ${f(W.k)}*dot(vec2(${f(W.dx)},${f(W.dz)}),x) - ${f(W.w)}*t + ${f(W.ph)};
  p.xz += ${f(W.Q * W.A)}*vec2(${f(W.dx)},${f(W.dz)})*cos(th); p.y += ${f(W.A)}*sin(th);`).join('\n')}
  return p;
}
vec3 gerstnerN(vec2 x, float t){
  vec3 n = vec3(0.0,1.0,0.0); float th;
${WAVES.map(W => `  th = ${f(W.k)}*dot(vec2(${f(W.dx)},${f(W.dz)}),x) - ${f(W.w)}*t + ${f(W.ph)};
  n.xz -= ${f(W.k * W.A)}*vec2(${f(W.dx)},${f(W.dz)})*cos(th); n.y -= ${f(W.Q * W.k * W.A)}*sin(th);`).join('\n')}
  return n;
}
// surface height at world xz (inverts the horizontal Gerstner shift by fixed-point iteration)
float waveH(vec2 x, float t){
  vec2 x0 = x;
  for(int i=0;i<3;i++){ vec3 d = gerstner(x0,t); x0 = x - d.xz; }
  return gerstner(x0,t).y;
}
`;
function gerstnerJS(x, z, t) {
  let px = 0, py = 0, pz = 0;
  for (const W of WAVES) {
    const th = W.k * (W.dx * x + W.dz * z) - W.w * t + W.ph;
    px += W.Q * W.A * W.dx * Math.cos(th); pz += W.Q * W.A * W.dz * Math.cos(th); py += W.A * Math.sin(th);
  }
  return [px, py, pz];
}
function waveHJS(x, z, t) {
  let x0 = x, z0 = z;
  for (let i = 0; i < 4; i++) { const d = gerstnerJS(x0, z0, t); x0 = x - d[0]; z0 = z - d[2]; }
  return gerstnerJS(x0, z0, t)[1];
}
function waveSlopeJS(x, z, t) { // finite-difference slope (for camera roll)
  const e = 0.6;
  return [(waveHJS(x + e, z, t) - waveHJS(x - e, z, t)) / (2 * e), (waveHJS(x, z + e, t) - waveHJS(x, z - e, t)) / (2 * e)];
}

// ---------------------------------------------------------------- tileable noise texture
function makeNoiseTexture(seed, N = 256) {
  const rnd = new Rand(seed);
  const data = new Uint8Array(N * N * 4);
  const chans = [];
  for (let c = 0; c < 4; c++) {
    const acc = new Float32Array(N * N);
    let amp = 0.5, tot = 0;
    for (let o = 0; o < 5; o++) {
      const L = 4 << o; // lattice cells per tile
      const g = new Float32Array(L * L); for (let i = 0; i < L * L; i++) g[i] = rnd.next();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / N * L, fy = y / N * L;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        let ux = fx - ix, uy = fy - iy; ux = ux * ux * (3 - 2 * ux); uy = uy * uy * (3 - 2 * uy);
        const a = g[(iy % L) * L + ix % L], b = g[(iy % L) * L + (ix + 1) % L];
        const cc = g[((iy + 1) % L) * L + ix % L], d = g[((iy + 1) % L) * L + (ix + 1) % L];
        acc[y * N + x] += amp * ((a * (1 - ux) + b * ux) * (1 - uy) + (cc * (1 - ux) + d * ux) * uy);
      }
      tot += amp; amp *= c === 3 ? 0.65 : 0.5;
    }
    chans.push(acc.map(v => v / tot));
  }
  for (let i = 0; i < N * N; i++) for (let c = 0; c < 4; c++) {
    // stretch contrast around 0.5
    const v = (chans[c][i] - 0.5) * 2.2 + 0.5;
    data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- shared GLSL (sky, water volume, medium)
const COMMON = /* glsl */`
uniform float uTime, uWTime, uPort, uScale, uDepthCam, uMedium;
uniform vec3 uCamPos, uSun, uSunW, uMoon;
uniform sampler2D uNoise;
${WAVE_GLSL}
float n2(vec2 uv){ return texture2D(uNoise, uv).r; }
vec3 skyBase(vec3 d){
  float e = max(d.y, 0.0);
  float sd = max(dot(d, uSun), 0.0);
  float az = 0.5 + 0.5 * dot(normalize(d.xz + vec2(1e-5)), normalize(uSun.xz));
  vec3 hor = mix(vec3(0.42, 0.33, 0.34), vec3(1.30, 0.58, 0.22), pow(az, 2.0));
  vec3 mid = mix(vec3(0.15, 0.16, 0.26), vec3(0.52, 0.33, 0.24), pow(az, 3.0));
  vec3 zen = vec3(0.045, 0.07, 0.16);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.13, e));
  c = mix(c, zen, smoothstep(0.08, 0.65, e));
  c += vec3(1.1, 0.48, 0.16) * pow(sd, 12.0) * 0.55;
  c += vec3(2.4, 1.2, 0.48) * pow(sd, 110.0) * 0.6;
  c += vec3(7.0, 4.2, 2.0) * pow(sd, 1400.0) * 2.0;
  return c;
}
vec3 skyCol(vec3 d, float detail){
  vec3 c = skyBase(d);
  float e = d.y;
  float sd = max(dot(d, uSun), 0.0);
  float hz = smoothstep(0.0, 0.012, e);
  if (detail > 0.5) {
    // thin altostratus streaks, compressed toward the horizon and lit from behind by the low sun
    vec2 cuv = d.xz / max(e + 0.05, 0.02);
    float cl = n2(cuv * vec2(0.03, 0.10) + vec2(uTime * 0.0015, 0.0)) * 0.65 + n2(cuv * vec2(0.08, 0.27) + 0.37) * 0.35;
    float cov = smoothstep(0.52, 0.80, cl) * hz * (1.0 - smoothstep(0.25, 0.5, e));
    vec3 ccol = mix(vec3(0.20, 0.13, 0.17), vec3(3.4, 1.6, 0.6), pow(sd, 14.0) + 0.3 * pow(sd, 3.0));
    c = mix(c, ccol, cov * 0.8);
    // a thin haze band that slices across the sun
    float band = exp(-pow((e - 0.024) / 0.006, 2.0)) * (0.5 + 0.5 * n2(vec2(d.x * 2.0, 0.5)));
    c = mix(c, vec3(0.9, 0.36, 0.17) * (0.5 + 3.0 * pow(sd, 40.0)), band * 0.75 * hz);
    // the young Moon: huge and pale, low in the dawn haze
    float md = dot(d, uMoon);
    float mr = 0.05;
    float mask = smoothstep(cos(mr), cos(mr * 0.97), md);
    if (mask > 0.0) {
      vec3 ax = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
      vec3 ay = cross(ax, uMoon);
      vec2 mp = vec2(dot(d, ax), dot(d, ay)) / mr;
      float zz = sqrt(max(1.0 - dot(mp, mp), 0.0));
      vec3 nrm = normalize(mp.x * ax + mp.y * ay - zz * uMoon);
      float lit = smoothstep(-0.1, 0.35, dot(nrm, uSun));
      float maria = 0.72 + 0.28 * smoothstep(0.3, 0.7, n2(mp * 0.17 + 0.6));
      vec3 mcol = vec3(0.80, 0.74, 0.80) * maria * (0.025 + 0.6 * lit);
      float ext = smoothstep(0.0, 0.25, e);
      c += mcol * (0.35 + 0.65 * ext) * mask * 0.9;
    }
  }
  // sun disc
  float disc = smoothstep(cos(0.0125), cos(0.0108), dot(d, uSun));
  c += vec3(60.0, 34.0, 15.0) * disc * (detail > 0.5 ? 1.0 : 0.0);
  return c;
}
// colour of the water volume seen along d from depth uDepthCam (>0 below surface)
vec3 waterCol(vec3 d){
  float up = d.y;
  vec3 cUp = vec3(0.06, 0.40, 0.44);
  vec3 cHor = vec3(0.004, 0.072, 0.115);
  vec3 cDn = vec3(0.000, 0.004, 0.016);
  vec3 c = up > 0.0 ? mix(cHor, cUp, pow(up, 0.9)) : mix(cHor, cDn, pow(-up, 0.55));
  float s = max(dot(d, uSunW), 0.0);
  c += vec3(0.20, 0.55, 0.45) * pow(s, 5.0) * 0.55 + vec3(0.6, 0.95, 0.75) * pow(s, 40.0) * 0.5;
  c *= exp(-uDepthCam * vec3(0.20, 0.075, 0.050));
  c *= 1.0 + 1.6 * exp(-uDepthCam * 1.2) * (1.0 - 0.5 * max(up, 0.0));
  return c;
}
// signed height of a point relative to the surface (>0 above)
float above(vec3 p){ return p.y - waveH(p.xz, uWTime); }
// medium test for the dome port; skips the wave inversion when the camera is clearly above/below
float portAbove(vec3 p){ return abs(uMedium) > 0.5 ? uMedium : above(p); }
`;

const QUAD_VERT = /* glsl */`
varying vec2 vNdc;
void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const RAY = /* glsl */`
uniform vec3 uRight, uUp, uFwd; uniform vec2 uTan;
varying vec2 vNdc;
vec3 viewRay(){ return normalize(uFwd + vNdc.x * uTan.x * uRight + vNdc.y * uTan.y * uUp); }
`;

export default class Ocean {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, ctx.aspect, 0.05, 4000);
    this.camera.rotation.order = 'YXZ';
  }

  async init() {
    const ctx = this.ctx;
    this.noise = makeNoiseTexture(1234);
    const elS = 5.2 * Math.PI / 180, azS = 9 * Math.PI / 180; // sun: low, a little right of frame centre
    this.sun = new THREE.Vector3(Math.sin(azS) * Math.cos(elS), Math.sin(elS), -Math.cos(azS) * Math.cos(elS)).normalize();
    // refracted sun direction underwater (Snell)
    const sinI = Math.cos(elS), sinT = sinI / 1.333, cosT = Math.sqrt(1 - sinT * sinT);
    this.sunW = new THREE.Vector3(Math.sin(azS) * sinT, cosT, -Math.cos(azS) * sinT).normalize();
    const elM = 9.5 * Math.PI / 180, azM = -24 * Math.PI / 180;
    this.moon = new THREE.Vector3(Math.sin(azM) * Math.cos(elM), Math.sin(elM), -Math.cos(azM) * Math.cos(elM)).normalize();

    this.U = {
      uTime: { value: 0 }, uWTime: { value: 0 }, uPort: { value: 0.8 }, uScale: { value: ctx.height / 804 },
      uDepthCam: { value: 0 }, uMedium: { value: 1 }, uCamPos: { value: new THREE.Vector3() },
      uSun: { value: this.sun }, uSunW: { value: this.sunW }, uMoon: { value: this.moon },
      uNoise: { value: this.noise },
      uRight: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() },
      uTan: { value: new THREE.Vector2() }, uYaw: { value: 0 },
      uFocus: { value: 4 }, uCellL: { value: new THREE.Vector4() }, uCoc: { value: 1 }, uRes: { value: new THREE.Vector2(ctx.width, ctx.height) },
    };
    const U = this.U;

    // ---- 1. background: sky above / water volume below (per pixel, decided at the dome port)
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: U, vertexShader: QUAD_VERT, depthTest: false, depthWrite: false,
      fragmentShader: COMMON + RAY + /* glsl */`
      void main(){
        vec3 d = viewRay();
        vec3 P = uCamPos + d * uPort;
        float a = portAbove(P);
        vec3 c = a > 0.0 ? skyCol(d, 1.0) : waterCol(d);
        gl_FragColor = vec4(c, 1.0);
      }` }));
    bg.frustumCulled = false; bg.renderOrder = -10;
    this.scene.add(bg);

    // ---- 2. the ocean surface: polar grid around the camera, Gerstner-displaced
    {
      const NR = 300, NA = 360, A0 = -1.95, A1 = 1.95;
      const pos = new Float32Array(NR * NA * 3); const idx = [];
      for (let i = 0; i < NR; i++) {
        const r = 0.15 * Math.pow(3500 / 0.15, i / (NR - 1));
        for (let j = 0; j < NA; j++) {
          const a = A0 + (A1 - A0) * j / (NA - 1);
          const o = (i * NA + j) * 3; pos[o] = r * Math.sin(a); pos[o + 1] = 0; pos[o + 2] = -r * Math.cos(a);
        }
      }
      for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NA - 1; j++) {
        const a = i * NA + j, b = a + 1, c = a + NA, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      const m = new THREE.ShaderMaterial({
        uniforms: U, side: THREE.DoubleSide,
        vertexShader: COMMON + /* glsl */`
        uniform float uYaw;
        varying vec2 vX0; varying vec3 vW;
        void main(){
          float cy = cos(uYaw), sy = sin(uYaw);
          vec2 rp = vec2(position.x * cy + position.z * sy, -position.x * sy + position.z * cy);
          vec2 x0 = uCamPos.xz + rp;
          vec3 w = vec3(x0.x, 0.0, x0.y) + gerstner(x0, uWTime);
          vX0 = x0; vW = w;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
        fragmentShader: COMMON + /* glsl */`
        varying vec2 vX0; varying vec3 vW;
        vec3 ripples(vec2 x, float t, float fade, float near){
          // small capillary/chop detail as summed sine slopes (cheap)
          vec2 g = vec2(0.0);
          g += 0.030 * vec2(0.80, 0.60) * cos(dot(x, vec2(0.80, 0.60)) * 7.3 - t * 6.0);
          g += 0.025 * vec2(-0.55, 0.83) * cos(dot(x, vec2(-0.55, 0.83)) * 9.9 - t * 7.1 + 1.3);
          g += 0.020 * vec2(0.97, -0.24) * cos(dot(x, vec2(0.97, -0.24)) * 13.1 - t * 8.3 + 2.1);
          vec4 n1 = texture2D(uNoise, x * 0.07 + vec2(t * 0.015, 0.0));
          vec4 n2_ = texture2D(uNoise, x * 0.19 - vec2(0.0, t * 0.03));
          vec4 n3 = texture2D(uNoise, x * 0.47 + vec2(t * 0.05, t * 0.02));
          g += (n1.gb - 0.5) * 0.20 + (n2_.ab - 0.5) * 0.16 + (n3.rg - 0.5) * 0.12;
          if (near > 0.0) {
            vec4 n4 = texture2D(uNoise, x * 1.31 + vec2(t * 0.09, -t * 0.04));
            vec4 n5 = texture2D(uNoise, x * 3.07 - vec2(t * 0.13, t * 0.07));
            g += ((n4.ba - 0.5) * 0.14 + (n5.gr - 0.5) * 0.10) * near;
          }
          return vec3(-g.x, 0.0, -g.y) * fade;
        }
        void main(){
          vec3 toCam = uCamPos - vW; float dist = length(toCam);
          if (dist < uPort) discard;
          vec3 v = toCam / dist;
          float fade = 1.0 - smoothstep(6.0, 140.0, dist);
          vec3 n = normalize(gerstnerN(vX0, uWTime) + ripples(vX0, uWTime, fade, 1.0 - smoothstep(3.0, 30.0, dist)));
          vec3 c;
          bool fromAbove = uMedium > 0.5 ? true : (uMedium < -0.5 ? false : (dist < 3.0 ? gl_FrontFacing : above(uCamPos - v * uPort) > 0.0));
          if (fromAbove) {
            // ---------- seen from above
            float nv = max(dot(n, v), 0.02);
            float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
            vec3 r = reflect(-v, n); r.y = abs(r.y) + 0.002;
            vec3 refl = min(skyCol(r, 0.0), vec3(6.0)) * 0.85;
            vec3 deep = vec3(0.003, 0.030, 0.040) + vec3(0.006, 0.040, 0.050) * max(n.y, 0.0);
            // light through the backlit swells (emerald subsurface glow)
            float back = pow(max(dot(-v.xz, normalize(uSun.xz)), 0.0), 4.0);
            float crest = clamp(vW.y * 1.4 + 0.25, 0.0, 1.4);
            vec3 sss = vec3(0.04, 0.46, 0.30) * back * crest * (0.3 + 0.7 * smoothstep(0.0, 1.0, dot(n, -v * vec3(1,0,1)) + 0.4));
            vec3 body = deep + sss;
            c = mix(body, refl, fres);
            // sun glitter: Beckmann lobe, roughness grows with distance (unresolved facets), with sparkle near
            vec3 hv = normalize(v + uSun);
            float nh = max(dot(n, hv), 1e-3);
            float far = smoothstep(3.0, 260.0, dist);
            float m2 = mix(0.0035, 0.03, far);
            float t2 = (1.0 - nh * nh) / (nh * nh);
            float D = exp(-t2 / m2) / (3.14159 * m2 * nh * nh * nh * nh);
            float fvh = 0.02 + 0.98 * pow(1.0 - max(dot(v, hv), 0.0), 5.0);
            float spark = texture2D(uNoise, vX0 * 5.3 + vec2(uWTime * 0.21, -uWTime * 0.13)).a * texture2D(uNoise, vX0 * 8.1 - vec2(uWTime * 0.17, uWTime * 0.11)).b;
            spark = mix(smoothstep(0.30, 0.52, spark) * 3.0 + 0.15, 1.0, far);
            float glit = D * fvh / (4.0 * nv) * spark;
            c += vec3(5.0, 2.9, 1.3) * glit * 0.10;
            // aerial perspective
            vec3 hd = normalize(vec3(-v.x, 0.0, -v.z));
            float fog = 1.0 - exp(-dist * 0.0022);
            c = mix(c, skyBase(hd), fog);
          } else {
            // ---------- seen from below: Snell's window, total internal reflection
            vec3 d = -v; // ray direction (upward)
            vec3 nd = -n; // normal facing the ray
            vec3 tr = refract(d, nd, 1.333);
            vec3 rf = reflect(d, nd);
            vec3 below = waterCol(rf) * 0.8;
            if (dot(tr, tr) < 1e-4) {
              c = below;
            } else {
              float ct = abs(dot(tr, n));
              float R = 0.02 + 0.98 * pow(1.0 - ct, 5.0);
              vec3 sky = min(skyCol(tr, 0.0), vec3(40.0));
              c = mix(sky * vec3(0.55, 0.85, 0.85), below, R);
            }
            // fog toward the turquoise volume
            float fog = 1.0 - exp(-max(dist - uPort, 0.0) / 9.0);
            c = mix(c, waterCol(d), fog);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
      });
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 0;
      this.oceanMesh = mesh;
      this.scene.add(mesh);
    }

    // ---- 3. god rays: short ray-march through the water, sampling a caustic pattern projected along the refracted sun
    {
      const m = new THREE.ShaderMaterial({
        uniforms: U, vertexShader: QUAD_VERT, depthTest: false, depthWrite: false, transparent: true,
        blending: THREE.AdditiveBlending,
        fragmentShader: COMMON + RAY + /* glsl */`
        float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
        float shaft(vec3 p){
          vec2 q = p.xz + uSunW.xz * (-p.y / uSunW.y);
          float a = texture2D(uNoise, q * 0.07 + vec2(uTime * 0.006, uTime * 0.004)).r;
          float b = texture2D(uNoise, q * 0.113 - vec2(uTime * 0.005, -uTime * 0.007)).g;
          float s = smoothstep(0.62, 0.95, a * 0.62 + b * 0.55);
          return s * s * s;
        }
        void main(){
          vec3 d = viewRay();
          vec3 S = uCamPos + d * uPort;
          if (portAbove(S) > 0.0) { gl_FragColor = vec4(0.0); return; }
          float tmax = 34.0;
          if (d.y > 0.0) tmax = min(tmax, max(-S.y, 0.0) / d.y);
          const int N = 28;
          float dt = tmax / float(N);
          float j = 0.5 + 0.3 * (hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 91.0) - 0.5);
          float acc = 0.0;
          for (int i = 0; i < N; i++) {
            float t = (float(i) + j) * dt;
            vec3 p = S + d * t;
            float depthAtt = exp(min(p.y, 0.0) * 0.085);
            acc += shaft(p) * depthAtt * exp(-t * 0.06);
          }
          acc *= dt;
          float ph = 0.35 + 1.6 * pow(max(dot(d, uSunW), 0.0), 4.0);
          vec3 col = vec3(0.30, 0.80, 0.68) * acc * ph * 0.075;
          gl_FragColor = vec4(col, 1.0);
        }` });
      // rendered at half resolution into its own target, then composited additively into the frame
      m.blending = THREE.NoBlending; m.transparent = false;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); q.frustumCulled = false;
      this.grScene = new THREE.Scene(); this.grScene.add(q);
      this.grRT = new THREE.WebGLRenderTarget(Math.max(2, Math.round(ctx.width / 2)), Math.max(2, Math.round(ctx.height / 2)),
        { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      const cm = new THREE.ShaderMaterial({
        uniforms: { tGR: { value: this.grRT.texture } }, vertexShader: QUAD_VERT, depthTest: false, depthWrite: false, transparent: true,
        blending: THREE.AdditiveBlending,
        fragmentShader: `uniform sampler2D tGR; varying vec2 vNdc; void main(){ gl_FragColor = vec4(texture2D(tGR, vNdc * 0.5 + 0.5).rgb, 1.0); }` });
      const cq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cm); cq.frustumCulled = false; cq.renderOrder = 20;
      this.godrays = cq;
      this.scene.add(cq);
    }

    // ---- 4. marine snow (wrapped box around the camera, depth-of-field sprites)
    {
      const N = 26000; const rnd = new Rand(77);
      const p = new Float32Array(N * 3), s = new Float32Array(N);
      for (let i = 0; i < N; i++) { p[i * 3] = rnd.next(); p[i * 3 + 1] = rnd.next(); p[i * 3 + 2] = rnd.next(); s[i] = rnd.next(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: COMMON + /* glsl */`
        attribute float aSeed; uniform float uFocus, uCoc; uniform vec4 uCellL;
        varying float vA; varying vec3 vC; varying float vSharp;
        void main(){
          vec3 box = vec3(26.0, 18.0, 26.0);
          vec3 ctr = uCamPos + vec3(0.0, -2.0, 0.0);
          vec3 drift = vec3(sin(aSeed * 40.0 + uTime * 0.13) * 0.4, -uTime * (0.02 + 0.05 * aSeed), cos(aSeed * 70.0 + uTime * 0.11) * 0.4);
          vec3 w = ctr + (fract(position + (drift - ctr) / box) - 0.5) * box;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          float z = -mv.z;
          gl_Position = projectionMatrix * mv;
          float under = -above(w);
          float lit = exp(min(w.y, 0.0) * 0.09);
          vec2 q = w.xz + uSunW.xz * (-w.y / uSunW.y);
          float caus = texture2D(uNoise, q * 0.07 + vec2(uTime * 0.006, uTime * 0.004)).r;
          lit *= 0.35 + 1.4 * smoothstep(0.45, 0.85, caus);
          float base = (1.0 + 2.2 * pow(aSeed, 6.0)) * uScale;
          float coc = abs(1.0 / max(z, 0.05) - 1.0 / uFocus) * uCoc * uScale;
          float sz = max(base, coc);
          gl_PointSize = min(sz, 70.0 * uScale) + 1.0;
          vA = (base * base) / (sz * sz) * step(0.0, under) * step(uPort, z) * exp(-z / 16.0) * smoothstep(0.0, 0.6, z);
          vA *= 0.9 + 0.6 * aSeed;
          vSharp = clamp(sz / max(base, 1.0) / 6.0, 0.0, 1.0);
          vC = mix(vec3(0.55, 0.85, 0.80), vec3(0.95, 1.0, 0.9), aSeed) * lit * 1.6;
          vec3 dc = w - uCellL.xyz;
          vC += vec3(0.15, 1.0, 1.2) * uCellL.w * 0.5 / (0.15 + dot(dc, dc));
        }`,
        fragmentShader: /* glsl */`
        varying float vA; varying vec3 vC; varying float vSharp;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
          if (r > 1.0 || vA < 0.002) discard;
          // small sprites: gaussian; big bokeh: flat disc with a rim
          float g = exp(-r * r * 3.5);
          float bok = smoothstep(1.0, 0.86, r) * (0.75 + 0.35 * smoothstep(0.55, 0.95, r));
          float a = mix(g, bok, vSharp);
          gl_FragColor = vec4(vC * a * vA, 1.0);
        }` });
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 30;
      this.scene.add(pts);
    }

    // ---- 5. bubbles released as the lens goes under
    {
      const N = 300; const rnd = new Rand(9);
      const sp = new Float32Array(N * 3), at = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        const ts = 6.25 + Math.pow(rnd.next(), 1.6) * 1.6;
        const c = this.camState(ts);
        const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(c.pitch, c.yaw, 0, 'YXZ'));
        const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, c.yaw, 0, 'YXZ'));
        const dz = 0.55 + Math.pow(rnd.next(), 1.5) * 2.8;
        const off = fwd.clone().multiplyScalar(dz)
          .addScaledVector(right, rnd.range(-1, 1) * dz * 0.95)
          .add(new THREE.Vector3(0, rnd.range(-0.9, 0.2) * dz * 0.45, 0));
        const p = c.pos.clone().add(off);
        sp[i * 3] = p.x; sp[i * 3 + 1] = p.y; sp[i * 3 + 2] = p.z;
        at[i * 4] = ts; at[i * 4 + 1] = rnd.range(0.25, 0.9); at[i * 4 + 2] = Math.pow(rnd.next(), 4.0); at[i * 4 + 3] = rnd.next();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      g.setAttribute('aB', new THREE.BufferAttribute(at, 4));
      const m = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: COMMON + /* glsl */`
        attribute vec4 aB; uniform float uFocus, uCoc;
        varying float vA, vSharp;
        void main(){
          float age = uTime - aB.x;
          float rad = 0.003 + 0.017 * aB.z;
          float rise = (0.35 + 6.0 * rad) * age + 0.4 * age * age * (0.5 + aB.y);
          vec3 w = position + vec3(sin(age * 9.0 + aB.w * 30.0) * 0.03, rise, cos(age * 7.0 + aB.w * 20.0) * 0.03);
          vec4 mv = viewMatrix * vec4(w, 1.0); float z = -mv.z;
          gl_Position = projectionMatrix * mv;
          float px = rad / max(z, 0.05) / uTanY * (0.5 * uResY);
          float coc = abs(1.0 / max(z, 0.05) - 1.0 / uFocus) * uCoc * uScale;
          float sz = max(px * 2.0 + coc * 0.8, 1.5 * uScale);
          gl_PointSize = min(sz, 120.0 * uScale);
          vSharp = clamp(px * 2.0 / sz, 0.0, 1.0);
          vA = step(0.0, age) * (1.0 - smoothstep(1.2, 2.4, age)) * step(0.0, -above(w)) * smoothstep(0.2, 0.5, z)
             * (1.0 - smoothstep(-0.25, 0.0, w.y - waveH(w.xz, uWTime)));
        }`.replace('uniform float uFocus, uCoc;', 'uniform float uFocus, uCoc; uniform float uTanY, uResY;'),
        fragmentShader: /* glsl */`
        varying float vA, vSharp;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
          if (r > 1.0 || vA < 0.002) discard;
          float rim = smoothstep(0.74, 0.93, r) * smoothstep(1.0, 0.95, r);
          float spec = exp(-dot(c - vec2(-0.16, 0.18), c - vec2(-0.16, 0.18)) * 160.0);
          float sharp = rim * 0.75 + spec * 1.6 + 0.04 + 0.08 * smoothstep(0.5, 0.9, r);
          float soft = smoothstep(1.0, 0.7, r) * 0.25;
          float a = mix(soft, sharp, vSharp);
          gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * a * vA * 1.05, 1.0);
        }` });
      m.uniforms.uTanY = { value: Math.tan(21 * Math.PI / 180) };
      m.uniforms.uResY = { value: ctx.height };
      this.bubbleMat = m;
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 35;
      this.bubbles = pts;
      this.scene.add(pts);
    }

    // ---- 6. the first cell(s): ray-marched metaball membranes inside a bounding sphere
    {
      this.cellU = {
        uC: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uK: { value: new THREE.Vector3() }, uCtr: { value: new THREE.Vector3() }, uBR: { value: 1 }, uBR2: { value: 1 },
        uCellA: { value: 0 }, uNucA: { value: [0, 0, 0, 0] }, uNuc: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      };
      const m = new THREE.ShaderMaterial({
        uniforms: { ...U, ...this.cellU }, transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        vertexShader: /* glsl */`
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: COMMON + /* glsl */`
        uniform vec4 uC[4]; uniform vec4 uNuc[4]; uniform vec3 uK; uniform vec3 uCtr; uniform float uBR, uBR2, uCellA;
        varying vec3 vW;
        float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
        float sdf(vec3 p){
          float a = smin(length(p - uC[0].xyz) - uC[0].w, length(p - uC[1].xyz) - uC[1].w, uK.x);
          float b = smin(length(p - uC[2].xyz) - uC[2].w, length(p - uC[3].xyz) - uC[3].w, uK.y);
          float d = smin(a, b, uK.z);
          // gentle membrane undulation
          d += 0.007 * sin(p.x * 11.0 + uTime * 1.7) * sin(p.y * 9.0 - uTime * 1.3) * sin(p.z * 10.0 + uTime) + 0.003 * sin(p.x * 31.0 + p.z * 27.0 - uTime * 2.0);
          return d;
        }
        vec3 sdfN(vec3 p){
          const vec2 e = vec2(0.004, -0.004);
          return normalize(e.xyy * sdf(p + e.xyy) + e.yyx * sdf(p + e.yyx) + e.yxy * sdf(p + e.yxy) + e.xxx * sdf(p + e.xxx));
        }
        uniform float uNucA[4];
        float nucleus(vec3 p){
          float s = 0.0;
          for (int i = 0; i < 4; i++) { vec3 q = p - uNuc[i].xyz; s += uNucA[i] * exp(-dot(q, q) / (uNuc[i].w * uNuc[i].w)); }
          return s;
        }
        vec3 hash33(vec3 p3){p3=fract(p3*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yxz+33.33);return fract((p3.xxy+p3.yxx)*p3.zyx);}
        float organelles(vec3 q){
          vec3 g = q * 9.0; vec3 id = floor(g); vec3 f = fract(g);
          vec3 h = hash33(id + 17.0);
          vec3 o = 0.2 + 0.6 * h; o += 0.12 * sin(uTime * (0.6 + h) + h * 6.28);
          float d = length(f - o);
          return step(0.5, h.x) * exp(-d * d * 140.0);
        }
        void main(){
          vec3 ro = uCamPos; vec3 rd = normalize(vW - uCamPos);
          vec3 oc = ro - uCtr; float b = dot(oc, rd); float c = dot(oc, oc) - uBR * uBR;
          float h = b * b - c; if (h < 0.0) discard;
          // march only where the ray passes through one of the (padded) cell spheres
          float t0 = 1e9, t1 = -1.0;
          for (int i = 0; i < 4; i++) {
            vec3 o2 = ro - uC[i].xyz; float b2 = dot(o2, rd); float rr = uC[i].w + 0.16;
            float h2 = b2 * b2 - (dot(o2, o2) - rr * rr);
            if (h2 > 0.0) { h2 = sqrt(h2); t0 = min(t0, max(-b2 - h2, 0.0)); t1 = max(t1, -b2 + h2); }
          }
          if (t1 < 0.0) t0 = 0.0;
          float t = t0; bool hit = false; float dmin = 1e9;
          for (int i = 0; i < 30; i++) {
            if (t1 < 0.0) break;
            float d = sdf(ro + rd * t);
            dmin = min(dmin, d);
            if (d < 0.002) { hit = true; break; }
            t += d * 0.9; if (t > t1) break;
          }
          vec3 col = vec3(0.0); float alpha = 0.0;
          // soft corona just outside the membrane
          if (t1 > 0.0) col += vec3(0.05, 0.45, 0.55) * exp(-max(dmin, 0.0) * 14.0) * 0.18;
          if (hit) {
            vec3 p = ro + rd * t;
            vec3 n = sdfN(p);
            float nv = abs(dot(n, rd));
            float fr = pow(1.0 - nv, 3.0);
            // membrane: luminous rim, a second inner membrane line, faint sheen from the sun shafts above
            col += vec3(0.25, 1.6, 2.0) * (0.01 + 3.4 * pow(1.0 - nv, 6.0) + 0.10 * pow(1.0 - nv, 2.0));
            col += vec3(0.6, 1.0, 0.9) * pow(max(dot(reflect(rd, n), uSunW), 0.0), 24.0) * 0.35;
            col += vec3(0.20, 0.9, 1.0) * max(n.y, 0.0) * 0.06;
            // interior march: faint cytoplasm, organelle specks, glowing nucleus
            vec3 glow = vec3(0.0);
            float dt = 0.065;
            float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
            for (int i = 0; i < 13; i++) {
              vec3 q = p + rd * (float(i) + jit) * dt;
              float sd = sdf(q);
              if (sd > 0.005) break;
              float inside = clamp(-sd / 0.12, 0.0, 1.0);
              float org = organelles(q - uCtr);
              float nuc = nucleus(q);
              // inner membrane shell
              float shell = exp(-pow((sd + 0.05) / 0.012, 2.0));
              glow += (vec3(0.002, 0.03, 0.045) * inside + vec3(0.6, 2.6, 2.2) * org * inside + vec3(0.08, 0.42, 0.50) * shell
                     + vec3(1.3, 3.2, 2.6) * smoothstep(0.3, 1.0, nuc) + vec3(0.04, 0.32, 0.30) * nuc) * dt;
            }
            col += glow * 3.0;
            alpha = 0.4 + 0.4 * fr;
          }
          // in-water glow: analytic single scattering from each cell treated as a point light
          vec3 halo = vec3(0.0);
          for (int i = 0; i < 4; i++) {
            vec3 cc = uC[i].xyz - ro; float tc = dot(cc, rd); float hh = max(length(cc - rd * tc), 0.02);
            float I = exp(-hh * 2.2) * step(0.0, tc);
            float edge = 1.0 - smoothstep(0.5, 1.0, hh / uBR);
            float wgt = (i == 0 || uC[i].xyz != uC[i - (i > 0 ? 1 : 0)].xyz) ? 1.0 : 0.0;
            halo += vec3(0.04, 0.32, 0.40) * I * edge * wgt * uC[i].w;
          }
          col += halo * 0.45 * (hit ? 0.0 : 1.0);
          alpha = max(alpha, 0.0);
          // underwater fog
          float dist = length(uCtr - uCamPos);
          float fog = exp(-max(dist - 1.0, 0.0) / 9.0);
          gl_FragColor = vec4(col * fog * uCellA, alpha * fog * uCellA);
        }` });
      this.cellMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), m);
      this.cellMesh.frustumCulled = false; this.cellMesh.renderOrder = 40;
      this.scene.add(this.cellMesh);
    }

    // ---- 7. a soft halo + plankton glints around the cell cluster
    {
      const N = 900; const rnd = new Rand(31);
      const p = new Float32Array(N * 3), s = new Float32Array(N);
      for (let i = 0; i < N; i++) { const v = rnd.inSphere(); const r = 0.7 + 3.0 * Math.pow(rnd.next(), 1.5); p[i * 3] = v[0] * r; p[i * 3 + 1] = v[1] * r * 0.7; p[i * 3 + 2] = v[2] * r; s[i] = rnd.next(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: { ...U, ...this.cellU }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`
        attribute float aSeed; uniform float uTime, uScale, uCellA, uFocus, uCoc; uniform vec3 uCtr;
        varying float vA;
        void main(){
          vec3 w = uCtr + position + vec3(sin(uTime * 0.3 + aSeed * 50.0), cos(uTime * 0.23 + aSeed * 31.0), sin(uTime * 0.27 + aSeed * 17.0)) * 0.15;
          vec4 mv = viewMatrix * vec4(w, 1.0); float z = -mv.z;
          gl_Position = projectionMatrix * mv;
          float base = (1.2 + 1.5 * aSeed) * uScale;
          float coc = abs(1.0 / max(z, 0.05) - 1.0 / uFocus) * uCoc * uScale;
          float sz = max(base, coc);
          gl_PointSize = min(sz, 60.0 * uScale) + 1.0;
          float tw = 0.5 + 0.5 * sin(uTime * (1.5 + 3.0 * aSeed) + aSeed * 90.0);
          vA = uCellA * (base * base) / (sz * sz) * (0.3 + 0.7 * tw) * exp(-z / 12.0) * smoothstep(0.3, 1.0, z);
        }`,
        fragmentShader: /* glsl */`
        varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0) discard;
          gl_FragColor = vec4(vec3(0.3, 1.6, 1.9) * exp(-r * 4.0) * vA, 1.0); }` });
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 38;
      this.scene.add(pts);
    }

    // ---- 8. waterline meniscus on the dome port
    {
      const m = new THREE.ShaderMaterial({
        uniforms: U, vertexShader: QUAD_VERT, depthTest: false, depthWrite: false, transparent: true,
        fragmentShader: COMMON + RAY + /* glsl */`
        void main(){
          vec3 d = viewRay();
          vec3 P = uCamPos + d * uPort;
          float a = above(P);
          float px = a / max(fwidth(a), 1e-5);
          // dark meniscus band just below the line, thin bright refracted edge on it
          float dark = smoothstep(-10.0 * uScale, -1.0, px) * (1.0 - smoothstep(-1.0, 1.5, px));
          float edge = exp(-pow((px - 0.5) / (1.3 * uScale), 2.0));
          // droplets/sheeting on the port just above the line
          float sheet = smoothstep(26.0 * uScale, 0.0, px) * step(0.0, px);
          vec3 col = vec3(0.9, 0.8, 0.65) * edge * 2.0 + vec3(0.02, 0.05, 0.06) * sheet;
          float al = clamp(dark * 0.85 + edge * 0.6 + sheet * 0.18, 0.0, 1.0);
          gl_FragColor = vec4(col, al);
        }` });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); q.frustumCulled = false; q.renderOrder = 100;
      this.meniscus = q;
      this.scene.add(q);
    }
  }

  // ---------------------------------------------------------------- camera path (closed-form in t)
  camState(t) {
    const wt = t + 40; // wave time
    const x = 0.6 * Math.sin(t * 0.17) + 0.15 * fbm1(t * 0.3 + 2);
    const z = t < 7 ? -1.15 * t : -8.05 - 4.5 * (1 - Math.exp(-(t - 7) / 3.5)) - 0.35 * (t - 7);
    const h = waveHJS(x, z, wt);
    // height relative to the local surface: ride the swell, settle at the surface, slip under, descend
    const rideAbove = 1.22 + 0.15 * Math.sin(t * 0.9);
    const k1 = smoothstep(4.2, 5.7, t); // drop to the surface
    const k2 = smoothstep(5.95, 7.0, t); // slip under
    const rel = lerp(lerp(rideAbove, 0.12, k1), -1.5, k2);
    const follow = lerp(0.82, 0.0, smoothstep(6.0, 9.0, t)); // how much it rides the waves
    const descend = t > 7 ? 6.5 * (1 - Math.exp(-(t - 7) / 4)) : 0;
    const y = h * follow + rel - descend;
    const pos = new THREE.Vector3(x, y, z);
    const sl = waveSlopeJS(x, z, wt);
    const surf = 1 - smoothstep(6.4, 8.0, t);
    // orientation: free look above / just under the surface ...
    let pitch = lerp(-6.0, -3.5, smoothstep(4.8, 6.3, t));
    pitch = lerp(pitch, 6.0, smoothstep(6.8, 8.6, t));
    pitch += (sl[1] * 9 * surf) + fbm1(t * 0.4 + 9) * 1.2;
    let yaw = -4.5 + fbm1(t * 0.25 + 4) * 1.5;
    // ... then tilt down onto the cell and keep it framed
    const cell = this.cellCentre();
    const dv = cell.clone().sub(pos);
    const lp = Math.atan2(dv.y, Math.hypot(dv.x, dv.z)) * 180 / Math.PI + 1.0;
    const ly = Math.atan2(-dv.x, -dv.z) * 180 / Math.PI + 1.2;
    const kl = smoothstep(8.9, 11.2, t);
    pitch = lerp(pitch, lp + fbm1(t * 0.3 + 3) * 0.6, kl);
    yaw = lerp(yaw, ly + fbm1(t * 0.27 + 6) * 0.6, kl);
    const roll = (-sl[0] * 10 * surf + fbm1(t * 0.35 + 1) * 1.5 * (1 - kl * 0.6)) * Math.PI / 180;
    return { pos, pitch: pitch * Math.PI / 180, yaw: yaw * Math.PI / 180, roll, wt, h };
  }

  cellCentre() { return new THREE.Vector3(0.6, -9.2, -21.3); }

  cellState(t) {
    // cluster centre in world space, ahead and below the descending camera
    const ctr = this.cellCentre();
    const R = 0.45;
    const sp = (a, b) => easeInOutCubic(clamp((t - a) / (b - a)));
    const s1 = sp(10.7, 13.0);                       // first division
    const s2a = sp(13.2, 15.3), s2b = sp(13.5, 15.6); // second division (daughters slightly out of phase)
    const ax1 = new THREE.Vector3(1, 0.25, 0.35).normalize();
    const ax2a = new THREE.Vector3(-0.2, 1, 0.3).normalize();
    const ax2b = new THREE.Vector3(0.1, 0.35, -1).normalize();
    const rot = new THREE.Euler(0.05 * t, 0.11 * t, 0.03 * t); // slow tumble
    const r1 = lerp(R, R * 0.80, s1);
    const sep1 = R * 0.86 * s1 + 0.12 * s2a;
    const A = ax1.clone().multiplyScalar(sep1), B = ax1.clone().multiplyScalar(-sep1);
    const rA = lerp(r1, r1 * 0.80, s2a), rB = lerp(r1, r1 * 0.80, s2b);
    const dA = r1 * 0.86 * s2a, dB = r1 * 0.86 * s2b;
    const local = [
      A.clone().addScaledVector(ax2a, dA), A.clone().addScaledVector(ax2a, -dA),
      B.clone().addScaledVector(ax2b, dB), B.clone().addScaledVector(ax2b, -dB),
    ];
    const c = local.map(v => v.clone().applyEuler(rot).add(ctr));
    const kfun = (s, r) => lerp(r * 0.9, r * 0.03, Math.pow(s, 0.8));
    const kA = kfun(s2a, r1), kB = kfun(s2b, r1), kC = kfun(s1, R);
    // polynomial smin inflates coincident spheres by k/4: compensate
    const breathe = 1 + 0.015 * Math.sin(t * 2.1);
    const sizes = [rA - kA / 4 - kC / 4 * (1 - s1), rA - kA / 4 - kC / 4 * (1 - s1), rB - kB / 4 - kC / 4 * (1 - s1), rB - kB / 4 - kC / 4 * (1 - s1)]
      .map(v => v * breathe);
    // nuclei lead the membrane: they separate early (prophase→anaphase), then sit in each daughter
    const lead = (s) => Math.min(1, easeInOutCubic(clamp(s * 1.6)) * 1.05);
    const n1 = R * 0.86 * lead(s1) + 0.12 * s2a;
    const NA = ax1.clone().multiplyScalar(n1), NB = ax1.clone().multiplyScalar(-n1);
    const nA = r1 * 0.86 * lead(s2a), nB = r1 * 0.86 * lead(s2b);
    const nloc = [NA.clone().addScaledVector(ax2a, nA), NA.clone().addScaledVector(ax2a, -nA), NB.clone().addScaledVector(ax2b, nB), NB.clone().addScaledVector(ax2b, -nB)];
    // nucleus dims while dividing (envelope breaks down), returns when the daughters close
    const dim = (s) => 1 - 0.3 * Math.sin(Math.PI * clamp(s));
    const nuc = nloc.map((v, i) => ({ p: v.applyEuler(rot).add(ctr), w: lerp(0.12, 0.095, s1) * lerp(1, 0.86, i < 2 ? s2a : s2b),
      a: dim(s1) * dim(i < 2 ? s2a : s2b) * (i === 0 || (i === 1 && s2a > 0) || (i === 2 && s1 > 0) || (i === 3 && s2b > 0) ? 1 : 0) }));
    return { ctr, c, sizes, k: [kA, kB, kC], nuc, A: c[0] };
  }

  update(shot, t, T) {
    const U = this.U;
    const cs = this.camState(t);
    const cam = this.camera;
    cam.position.copy(cs.pos);
    cam.rotation.set(cs.pitch, cs.yaw, cs.roll, 'YXZ');
    const fov = lerp(lerp(42, 28.5, smoothstep(9.0, 11.6, t)), 26, smoothstep(11.6, 16, t));
    cam.fov = fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    U.uTime.value = t; U.uWTime.value = cs.wt; U.uCamPos.value.copy(cs.pos);
    U.uYaw.value = cs.yaw;
    const e = cam.matrixWorld.elements;
    U.uRight.value.set(e[0], e[1], e[2]); U.uUp.value.set(e[4], e[5], e[6]); U.uFwd.value.set(-e[8], -e[9], -e[10]);
    const ty = Math.tan(fov * Math.PI / 360); U.uTan.value.set(ty * cam.aspect, ty);
    this.bubbleMat.uniforms.uTanY.value = ty;
    U.uDepthCam.value = Math.max(0, -(cs.pos.y - cs.h));
    const relH = cs.pos.y - cs.h;
    U.uMedium.value = relH > 0.95 ? 1 : (relH < -1.4 ? -1 : 0);
    this.meniscus.visible = U.uMedium.value === 0;
    this.godrays.visible = U.uMedium.value < 0.5;
    this.bubbles.visible = t > 6.0 && t < 9.6;
    // the surface leaves the frame once the camera tilts down onto the cell
    const topRay = cs.pitch + Math.atan(Math.tan(fov * Math.PI / 360) * 1.05);
    this.oceanMesh.visible = !(t > 10 && topRay < -0.02);

    // cells
    const cl = this.cellState(t);
    for (let i = 0; i < 4; i++) {
      this.cellU.uC.value[i].set(cl.c[i].x, cl.c[i].y, cl.c[i].z, cl.sizes[i]);
      this.cellU.uNuc.value[i].set(cl.nuc[i].p.x, cl.nuc[i].p.y, cl.nuc[i].p.z, cl.nuc[i].w);
      this.cellU.uNucA.value[i] = cl.nuc[i].a;
    }
    this.cellU.uK.value.set(cl.k[0], cl.k[1], cl.k[2]);
    this.cellU.uCtr.value.copy(cl.ctr);
    const br = 2.2;
    this.cellU.uBR.value = br;
    this.cellU.uBR2.value = 1.3;
    this.cellMesh.position.copy(cl.ctr); this.cellMesh.scale.setScalar(br * 1.08); this.cellMesh.updateMatrixWorld();
    this.cellU.uCellA.value = smoothstep(8.6, 10.6, t);
    U.uCellL.value.set(cl.ctr.x, cl.ctr.y, cl.ctr.z, this.cellU.uCellA.value);
    this.cellMesh.visible = t > 8.0;

    // focus: near particles early, then rack to the cell
    const dCell = cs.pos.distanceTo(cl.ctr);
    U.uFocus.value = lerp(3.0, dCell, smoothstep(8.8, 10.8, t));
    U.uCoc.value = 26;

    // grade: warm gold above, cool turquoise below
    const uw = smoothstep(6.3, 7.4, t);
    const post = {
      exposure: lerp(0.8, 1.3, uw),
      bloomStrength: lerp(0.5, 0.7, uw), bloomThreshold: lerp(1.6, 1.15, uw), bloomKnee: 0.7, bloomRadius: 0.85,
      streak: lerp(0.28, 0.12, uw), streakTint: [lerp(1.0, 0.4, uw), lerp(0.66, 0.9, uw), lerp(0.38, 1.0, uw)],
      ca: 0.0022, vignette: lerp(0.38, 0.5, uw), grain: 0.05,
      saturation: lerp(1.1, 1.12, uw), contrast: lerp(1.12, 1.05, uw),
      tint: [lerp(1.05, 0.92, uw), lerp(0.99, 1.02, uw), lerp(0.92, 1.06, uw)],
      lift: [0.0, lerp(0.0, 0.004, uw), lerp(0.0, 0.008, uw)],
    };
    const target = t >= 10.4 ? cl.A.clone() : null;
    const self = this;
    return {
      scene: this.scene, camera: cam, target, post,
      render(r, rt) {
        if (self.godrays.visible) { r.setRenderTarget(self.grRT); r.clear(); r.render(self.grScene, cam); }
        r.setRenderTarget(rt); r.clear(); r.render(self.scene, cam);
      },
    };
  }

  dispose() {
    this.scene.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.noise?.dispose(); this.grRT?.dispose();
    this.grScene?.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
