// Shots #12–#14 · 夜 · 仰望 / 孩子的手 / 一生 — the emotional heart of the film.
//   wide     : 14mm locked-off night, hill silhouette, Milky Way, two amber particle people (parent + child)
//   hand     : 85mm close-up of the child's hand reaching for the stars, stars thrown into bokeh
//   lifetime : the wide again as a time-lapse: star trails, the child grows old, the parent drifts away,
//              the heart stops, the last figure rises into the sky.
// Everything is a pure function of (shot, t): no accumulation between frames.
import * as THREE from '../../vendor/three.module.js';
import { simplex3, hash } from '../lib/glsl.js';
import { Rand, fbm1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, smootherstep, easeInOutSine } from '../lib/ease.js';

const DEG = Math.PI / 180;
const WIDE_FOV = 56;            // vertical fov ≈ 14mm on full frame at 2.39:1
const PITCH = 25 * DEG;          // camera tilted up at the sky
const ZC = -6.6;                 // depth of the hill crest
const SKY_R = 800;
const BMAX = 60 * DEG;           // galactic latitude range stored in the Milky Way texture
const MW_W = 4096, MW_H = 1024;
const HAND_FOV = 10.1;           // ≈ 85mm

// ---------------------------------------------------------------- small vector helpers
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k],
  rot: (v, k, a) => {
    const c = Math.cos(a), s = Math.sin(a), d = V.dot(k, v), x = V.cross(k, v);
    return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
  },
};

// deterministic 2D value noise for terrain
function h2(ix, iy) { let n = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296; }
function vn2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}
function fbm2(x, y, o = 4) { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vn2(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 3.3; a *= 0.5; } return s; }

function blackbodyJS(K) {
  K = clamp(K, 1000, 40000) / 100;
  const r = K <= 66 ? 1 : clamp(1.29293618606 * Math.pow(K - 60, -0.1332047592), 0, 1);
  const g = K <= 66 ? clamp(0.39008157876 * Math.log(K) - 0.63184144378, 0, 1) : clamp(1.12989086089 * Math.pow(K - 60, -0.0755148492), 0, 1);
  const b = K >= 66 ? 1 : (K <= 19 ? 0 : clamp(0.54320678911 * Math.log(K - 10) - 1.19625408914, 0, 1));
  return [r ** 2.2, g ** 2.2, b ** 2.2];
}

// ---------------------------------------------------------------- shaders
const FSQ_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Milky Way, baked once into an equirectangular texture in galactic coordinates (l, b).
const MW_FRAG = simplex3 + /* glsl */`
uniform float uMode, uBmax;
varying vec2 vUv;
void main(){
  float l = (vUv.x - 0.5) * 6.2831853;
  float b = (vUv.y - 0.5) * 2.0 * uBmax;
  vec3 dg = vec3(cos(b)*cos(l), cos(b)*sin(l), sin(b));
  vec3 w = dg + 0.045*vec3(snoise(dg*3.1), snoise(dg*3.1+7.7), snoise(dg*3.1+3.3));
  float bw = b + 0.03*snoise(w*2.3+1.0);
  float thick = 0.095 + 0.035*snoise(w*1.6+2.0);
  float lfall = 0.22 + 0.78*exp(-l*l/1.2);
  float disk0 = exp(-bw*bw/(thick*thick));
  float disk = disk0 * lfall;
  float wide = exp(-bw*bw/(0.22*0.22)) * (0.3 + 0.7*lfall);
  float bulge = exp(-(l*l/(0.30*0.30) + b*b/(0.19*0.19)));
  float n1 = fbm3(w*4.2)*0.5+0.5;
  float n2 = fbm3(w*13.0+5.0)*0.5+0.5;
  float n3 = fbm3(w*42.0+2.0)*0.5+0.5;
  float clouds = (0.55 + 0.45*smoothstep(0.25, 0.85, n1)) * (0.55 + 0.75*n2) * (0.65 + 0.7*n3);
  float lum = disk*(0.12 + 1.0*clouds) + bulge*(0.40 + 0.8*clouds) + wide*(0.035 + 0.05*n1);
  // dust: the great rift + filaments
  float laneC = 0.010 + 0.028*snoise(w*1.2+5.0);
  float laneW = max(0.026 + 0.016*snoise(w*2.0+9.0), 0.008);
  float lane = exp(-pow((bw - laneC)/laneW, 2.0));
  float dn = fbm3(w*3.4+4.0)*0.5+0.5;
  float dn2 = fbm3(w*11.0+8.0)*0.5+0.5;
  float fil = ridged3(w*9.0+1.0);
  float fil2 = ridged3(w*23.0+6.0);
  float dust = lane*smoothstep(0.35, 0.80, dn*0.7 + dn2*0.45)*1.25
             + disk0*smoothstep(0.62, 0.90, fil*0.8 + dn*0.3)*0.65
             + disk0*smoothstep(0.72, 0.97, fil2*0.8 + dn2*0.3)*0.25;
  vec3 trans = exp(-dust*vec3(1.0, 1.18, 1.45)*1.15);
  vec3 cool = vec3(0.68, 0.79, 1.0);
  vec3 warm = vec3(1.0, 0.76, 0.50);
  float wk = clamp(bulge*1.4 + 0.30*exp(-l*l/0.9), 0.0, 1.0);
  vec3 col = mix(cool, warm, wk) * lum;
  float ha = smoothstep(0.62, 0.86, fbm3(w*6.5+13.0)*0.5+0.5) * disk;
  col += vec3(0.6, 0.14, 0.24) * ha * 0.30;
  col *= trans;
  if (uMode > 0.5) { gl_FragColor = vec4(clamp(lum*trans.g*0.55, 0.0, 1.0), trans.g, disk, 1.0); return; }
  gl_FragColor = vec4(col, 1.0);
}`;

const ROT_GLSL = /* glsl */`
vec3 rotA(vec3 v, vec3 k, float a){ float c=cos(a), s=sin(a); return v*c + cross(k,v)*s + k*dot(k,v)*(1.0-c); }`;

const DOME_VERT = /* glsl */`varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const DOME_FRAG = hash + ROT_GLSL + /* glsl */`
uniform sampler2D tMW; uniform mat3 uGal; uniform vec3 uPole;
uniform float uAng, uLen, uBmax, uGain, uSmear, uSkyGain;
varying vec3 vPos;
vec3 mw(vec3 d){
  vec3 g = uGal * d;
  float l = atan(g.y, g.x); float b = asin(clamp(g.z, -1.0, 1.0));
  vec2 uv = vec2(l/6.2831853 + 0.5, b/(2.0*uBmax) + 0.5);
  float inb = 1.0 - smoothstep(0.94, 1.0, abs(uv.y-0.5)*2.0);
  return texture2D(tMW, uv).rgb * inb;
}
vec3 mwLod(vec3 d, float lod){
  vec3 g = uGal * d;
  float l = atan(g.y, g.x); float b = asin(clamp(g.z, -1.0, 1.0));
  vec2 uv = vec2(l/6.2831853 + 0.5, b/(2.0*uBmax) + 0.5);
  float inb = 1.0 - smoothstep(0.94, 1.0, abs(uv.y-0.5)*2.0);
  return textureLod(tMW, uv, lod).rgb * inb;
}
void main(){
  vec3 d = normalize(vPos);
  vec3 col;
  if (abs(uLen) < 1e-4) col = mw(rotA(d, uPole, -uAng));
  else {
    col = vec3(0.0);
    float j = hash12(gl_FragCoord.xy);
    float sp = length(cross(uPole, d)) * abs(uLen) / 10.0 * ${(MW_W / (2 * Math.PI)).toFixed(2)};
    float bias = clamp(log2(max(sp*10.0/14.0, 1e-3)) + 1.0, 0.0, 9.0);
    for (int i = 0; i < 14; i++) { float s = (float(i) + j) / 14.0; col += mwLod(rotA(d, uPole, -(uAng - uLen*s)), bias); }
    col /= 14.0;
  }
  float el = d.y;
  col *= uGain * (0.22 + 0.78*smoothstep(0.0, 0.42, el));
  vec3 sky = vec3(0.0035, 0.0062, 0.017) + vec3(0.010, 0.017, 0.036) * exp(-max(el, 0.0)*5.0);
  sky += vec3(0.004, 0.009, 0.010) * exp(-pow((el - 0.07)/0.07, 2.0));
  gl_FragColor = vec4(col + sky*uSkyGain, 1.0);
}`;

const STAR_VERT = /* glsl */`
uniform mat3 uRot; uniform float uScale, uTime, uTwinkle, uFaint, uBright;
attribute vec3 aCol; attribute float aSize; attribute float aSeed; attribute float aTrail;
varying vec3 vCol;
void main(){
  vec3 p = uRot * position;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = aSize * uScale;
  float s = max(sz, 1.3);
  float k = (sz*sz)/(s*s);
  float el = normalize(p).y;
  float tw = 1.0 + uTwinkle * (0.5 + 1.5*(1.0 - smoothstep(0.0, 0.45, el))) * sin(uTime*(5.0 + aSeed*9.0) + aSeed*93.0) * sin(uTime*(2.3 + aSeed*3.1) + aSeed*17.0);
  float ext = 0.25 + 0.75*smoothstep(-0.01, 0.22, el);
  vCol = aCol * k * tw * ext * mix(uFaint, 1.0, aTrail) * uBright;
  gl_PointSize = s;
}`;
const STAR_FRAG = /* glsl */`
varying vec3 vCol;
void main(){ vec2 q = gl_PointCoord - 0.5; float d2 = dot(q,q)*4.0; float a = exp(-d2*4.0) + 0.06*exp(-d2*1.2); if (a < 0.012) discard; gl_FragColor = vec4(vCol*a, 1.0); }`;

const TRAIL_VERT = ROT_GLSL + /* glsl */`
uniform vec3 uPole; uniform float uAng, uLen, uScale, uGain; uniform vec2 uRes;
attribute float aS; attribute float aSide; attribute vec3 aCol; attribute float aW;
varying vec3 vCol; varying float vSide;
void main(){
  float a = uAng - uLen*aS;
  vec3 d = rotA(position, uPole, a);
  vec3 tg = normalize(cross(uPole, d) + 1e-5);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(d*${SKY_R.toFixed(1)}, 1.0);
  vec4 c2 = projectionMatrix * viewMatrix * vec4((d + tg*0.003)*${SKY_R.toFixed(1)}, 1.0);
  vec2 s1 = c1.xy/c1.w, s2 = c2.xy/c2.w;
  vec2 dir = (s2 - s1) * uRes; dir = dir / max(length(dir), 1e-6);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = max(aW*uScale, 1.1);
  c1.xy += nrm * aSide * w / uRes * c1.w;
  gl_Position = c1;
  float el = d.y;
  float ext = 0.25 + 0.75*smoothstep(-0.01, 0.22, el);
  vCol = aCol * (1.0 - 0.6*aS) * smoothstep(0.0, 0.02, abs(uLen)) * uGain * ext * min(aW*uScale/w, 1.0);
  vSide = aSide;
}`;
const TRAIL_FRAG = /* glsl */`
varying vec3 vCol; varying float vSide;
void main(){ float a = exp(-vSide*vSide*2.2); gl_FragColor = vec4(vCol*a, 1.0); }`;

const HILL_VERT = /* glsl */`varying vec3 vW; varying vec3 vN; void main(){ vW = position; vN = normal; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.0); }`;
const HILL_FRAG = simplex3 + /* glsl */`
uniform float uRim;
varying vec3 vW; varying vec3 vN;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
  float ndv = abs(dot(n, v));
  float rim = pow(1.0 - ndv, 12.0);
  float g = snoise(vW*vec3(5.0, 9.0, 5.0))*0.5 + 0.5;
  float g2 = snoise(vW*vec3(23.0, 40.0, 23.0))*0.5 + 0.5;
  vec3 col = vec3(0.0026, 0.0036, 0.0072) * (0.65 + 0.5*g*g2) * (0.55 + 0.45*clamp(n.y, 0.0, 1.0));
  col += vec3(0.035, 0.055, 0.110) * rim * uRim;
  gl_FragColor = vec4(col, 1.0);
}`;

const RIDGE_VERT = /* glsl */`attribute float aTop; varying vec3 vW; varying float vTop; void main(){ vW = position; vTop = aTop; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.0); }`;
const RIDGE_FRAG = /* glsl */`
varying vec3 vW; varying float vTop;
void main(){
  vec3 d = normalize(vW - cameraPosition);
  float h = clamp((vTop - d.y) * 60.0, 0.0, 1.0);
  vec3 col = mix(vec3(0.0075, 0.011, 0.022), vec3(0.0030, 0.0042, 0.0085), smoothstep(0.0, 1.0, h));
  gl_FragColor = vec4(col, 1.0);
}`;

const GRASS_VERT = /* glsl */`
uniform float uTime; attribute float aT; attribute float aPh; varying float vT;
void main(){
  vec3 p = position;
  p.x += aT * 0.010 * (sin(uTime*1.3 + aPh) + 0.5*sin(uTime*2.9 + aPh*1.7));
  vT = aT;
  gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0);
}`;
const GRASS_FRAG = /* glsl */`
uniform float uRim; varying float vT;
void main(){ vec3 col = vec3(0.0024, 0.0033, 0.0068) + vec3(0.010, 0.016, 0.030) * pow(vT, 3.0) * uRim; gl_FragColor = vec4(col, 1.0); }`;

// Figures: glowing amber particles. Positions/normals are evaluated on the CPU every frame (pure function of t)
// from a procedural skeleton; dissolve, shimmer and shading happen here.
const FIG_COMMON = simplex3 + /* glsl */`
uniform float uT, uTime, uDisStart, uDisSpan, uDisMode;
uniform vec3 uCenter;
attribute vec4 aRnd; attribute float aH; attribute float aAura;
float detachTime(){ float n = snoise(position*4.5 + vec3(uDisStart)); return uDisStart + uDisSpan * clamp(0.58*(1.0 - aH) + 0.16*aRnd.x + 0.30*n + 0.1, 0.0, 1.0); }
vec3 dissolve(vec3 p, float age, out float alpha, out float starK){
  alpha = 1.0; starK = 0.0;
  if (age <= 0.0) return p;
  if (uDisMode < 0.5) {               // carried away by the wind
    vec3 q = p*1.6 + vec3(aRnd.y*7.0, -age*0.45, aRnd.z*7.0);
    vec3 c = curl3(q);
    p += vec3(0.30, 0.0, -0.10)*age*(0.6 + 0.8*aRnd.w) + vec3(0.0, 1.0, 0.0)*(0.45*age + 0.16*age*age)*(0.6 + 0.8*aRnd.y) + c*0.30*age;
    alpha = exp(-age*0.38) * (1.0 - smoothstep(3.0, 5.0, age));
  } else {                            // rising and spiralling up into the sky
    float e = 1.0 - exp(-age*0.50);
    vec3 rel = p - uCenter;
    float ang = age*(0.8 + aRnd.w*1.1);
    float c = cos(ang), s = sin(ang);
    rel.xz = vec2(c*rel.x - s*rel.z, s*rel.x + c*rel.z);
    rel.xz *= 1.0 + e*e*(2.0 + 16.0*aRnd.y);
    rel.y += e*e*(2.0 + 12.0*aRnd.z) + 0.30*age;
    vec3 q = p*1.3 + vec3(0.0, -age*0.3, aRnd.x*9.0);
    p = uCenter + rel + curl3(q)*0.10*age;
    starK = smoothstep(0.8, 3.4, age);
    float keep = step(0.84, aRnd.w);
    alpha = mix(1.0 - smoothstep(1.4, 3.8, age), 1.0, keep) * (1.0 + 1.2*exp(-age*0.9));
  }
  return p;
}`;
const FIG_VERT = FIG_COMMON + /* glsl */`
uniform float uPx, uSize, uBright, uBias, uPulse;
uniform vec3 uWarm, uRim;
varying vec3 vCol;
void main(){
  vec3 p = position + 0.004*sin(uTime*vec3(1.1, 1.7, 1.3) + aRnd.xyz*30.0);
  float age = uT - detachTime();
  float alpha, starK;
  p = dissolve(p, age, alpha, starK);
  vec3 n = normalize(normal);
  vec3 v = normalize(cameraPosition - p);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  float top = clamp(n.y*0.5 + 0.5, 0.0, 1.0);
  vec3 col = (uWarm*(0.45 + 0.40*top) + uRim*fres*1.1) * (0.35 + 0.65*ndv);
  if (aAura > 0.5) col = uWarm*0.55 + uRim*0.25;
  float tw = (0.82 + 0.18*sin(uTime*(1.3 + aRnd.y*3.0) + aRnd.z*50.0)) * (aRnd.w > 0.96 ? 2.2 : 0.95);
  float flare = age > 0.0 ? exp(-age*2.2) : 0.0;
  col *= uBright * tw * (1.0 + uPulse) * (1.0 + 2.2*flare);
  float tw2 = 0.6 + 0.4*sin(uTime*(4.0 + aRnd.x*6.0) + aRnd.y*90.0);
  col = mix(col, vec3(0.75, 0.85, 1.0)*0.9*tw2, starK);
  col *= alpha;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.z += uBias;
  gl_Position = projectionMatrix * mv;
  float sz = mix(uSize, 0.6*uSize, starK) * uPx / max(-mv.z, 0.1);
  float s = max(sz, 1.0);
  vCol = col * (sz*sz)/(s*s);
  gl_PointSize = s;
  if (alpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
}`;
const FIG_FRAG = /* glsl */`
varying vec3 vCol;
void main(){ vec2 q = gl_PointCoord - 0.5; float a = exp(-dot(q,q)*4.0*3.0); gl_FragColor = vec4(vCol*a, 1.0); }`;
const OCC_VERT = FIG_COMMON + /* glsl */`
uniform float uPx, uOcc, uInset;
void main(){
  float age = uT - detachTime();
  if (age > 0.0 || aAura > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 p = position - normalize(normal)*uInset;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(uOcc * uPx / max(-mv.z, 0.1), 1.0);
}`;
const OCC_FRAG = /* glsl */`
uniform vec3 uColor;
void main(){ if (length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(uColor, 1.0); }`;
const HOCC_FRAG = /* glsl */`
uniform vec3 uColor; varying float vK;
void main(){ if (length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(uColor * vK, 1.0); }`;
const FOCC_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uBright, uPulse;
void main(){ if (length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(uColor * uBright/0.3 * (1.0 + uPulse), 1.0); }`;

// Hand: static particles in hand space (SDF surface samples), lit + depth of field.
const HAND_VERT = /* glsl */`
uniform float uTime, uSize, uBright, uFocus, uCoC, uBias;
uniform vec3 uL, uWarm, uWarm2, uRim;
attribute vec4 aRnd; attribute float aFade; attribute float aNail; attribute float aAO;
varying vec3 vCol;
void main(){
  vec3 p = position + 0.00045*sin(uTime*vec3(1.3, 1.9, 1.6) + aRnd.xyz*40.0);
  float drift = 0.0;
  if (aRnd.w > 0.975) {
    drift = fract(uTime*(0.10 + 0.12*aRnd.x) + aRnd.y*7.0);
    p += normal*(0.0015 + 0.010*drift) + vec3(0.0, 1.0, 0.0)*0.016*drift*drift + 0.003*drift*sin(uTime*vec3(0.7, 0.9, 1.1) + aRnd.z*20.0);
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 v = normalize(cameraPosition - wp.xyz);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.5);
  float lam = clamp(dot(n, uL)*0.6 + 0.4, 0.0, 1.0);
  float ao = aAO;
  vec3 col = mix(uWarm2, uWarm, lam) * (0.10 + 1.25*lam*lam) * ao;
  col = mix(col, col*1.1 + vec3(0.05, 0.045, 0.05)*ao, aNail);
  col += uRim * fres * 0.9 * (0.5 + 0.5*clamp(n.y*0.5 + 0.5, 0.0, 1.0)) * ao;
  col *= 0.30 + 0.70*ndv;
  float tw = (0.75 + 0.25*sin(uTime*(1.0 + aRnd.y*3.0) + aRnd.z*60.0)) * (aRnd.w > 0.955 ? 2.2 : 0.9);
  vec4 mv = viewMatrix * wp;
  float z = -mv.z;
  float coc = uCoC * abs(z - uFocus);
  float sz = sqrt(uSize*uSize + coc*coc);
  float s = max(sz, 1.0);
  vCol = col * uBright * tw * aFade * (uSize*uSize)/(s*s);
  if (drift > 0.0) vCol = uWarm * 0.9 * uBright * aFade * sin(3.14159*drift) * (uSize*uSize)/(s*s);
  mv.z += uBias;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = s;
  if (aFade < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
}`;
const HAND_OCC_VERT = /* glsl */`
uniform float uOcc, uInset;
attribute float aFade; attribute float aAO; varying float vK;
void main(){
  vK = aFade * aAO;
  vec3 p = position - normalize(normal)*uInset;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(uOcc, 1.0);
}`;

const BOKEH_VERT = /* glsl */`
uniform float uScale, uTime, uGain;
attribute vec3 aCol; attribute float aSize; attribute float aSeed;
varying vec3 vCol; varying vec2 vNdc; varying float vSize;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vNdc = gl_Position.xy / gl_Position.w;
  float s = aSize * uScale;
  gl_PointSize = s; vSize = s;
  vCol = aCol * uGain * (0.85 + 0.15*sin(uTime*(0.6 + aSeed) + aSeed*20.0));
}`;
const BOKEH_FRAG = hash + /* glsl */`
varying vec3 vCol; varying vec2 vNdc; varying float vSize;
void main(){
  vec2 q = (gl_PointCoord - 0.5) * 2.0; q.y = -q.y;
  float r = length(q);
  float aa = 3.0 / vSize;
  float disc = 1.0 - smoothstep(1.0 - aa*2.5, 1.0, r);
  vec2 rd = vNdc * vec2(2.39, 1.0);
  float rl = length(rd);
  vec2 c2 = -rd / max(rl, 1e-3) * clamp(rl*0.22, 0.0, 0.5);
  disc *= 1.0 - smoothstep(1.0 - aa*2.5, 1.0, length(q - c2) * 0.98);
  float ring = 0.80 + 0.35*smoothstep(0.45, 0.97, r) + 0.05*(hash12(floor(gl_PointCoord*vSize*0.5)) - 0.5);
  if (disc < 0.002) discard;
  gl_FragColor = vec4(vCol * disc * ring, 1.0);
}`;

const HANDBG_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const HANDBG_FRAG = simplex3 + /* glsl */`
uniform float uTime, uShift;
varying vec2 vUv;
void main(){
  vec2 p = vUv; p.x *= 2.39;
  vec3 col = mix(vec3(0.010, 0.016, 0.040), vec3(0.003, 0.005, 0.016), vUv.y);
  float dd = (vUv.y - (0.12 + 0.62*vUv.x)) + uShift;
  float band = exp(-dd*dd/0.045);
  float core = exp(-pow((vUv.x - 0.62)/0.25, 2.0)) * band;
  float n = snoise(vec3(p*1.6, 2.0))*0.5 + 0.5;
  col += vec3(0.030, 0.034, 0.060) * band * (0.6 + 0.6*n);
  col += vec3(0.060, 0.040, 0.026) * core * (0.7 + 0.5*n);
  gl_FragColor = vec4(col, 1.0);
}`;

const SPRITE_VERT = /* glsl */`
uniform float uSize, uScale; uniform vec3 uCol;
varying vec3 vCol;
void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = uSize*uScale; vCol = uCol; }`;
const SPRITE_FRAG = /* glsl */`
varying vec3 vCol;
void main(){ vec2 q = gl_PointCoord - 0.5; float d2 = dot(q,q)*4.0; float a = exp(-d2*6.0)*0.8 + exp(-d2*18.0); gl_FragColor = vec4(vCol*a, 1.0); }`;

const MOTE_VERT = /* glsl */`
uniform float uTime, uScale, uFocus, uCoC, uBright;
attribute vec4 aRnd;
varying vec3 vCol; varying float vSoft;
void main(){
  vec3 p = position + vec3(sin(uTime*0.13 + aRnd.x*30.0), 0.6*uTime*0.02 + 0.3*sin(uTime*0.11 + aRnd.y*20.0), cos(uTime*0.09 + aRnd.z*30.0)) * 0.02 * (0.5 + aRnd.w);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float coc = uCoC * abs(-mv.z - uFocus);
  float s = clamp(sqrt(2.0 + coc*coc), 1.5, 90.0*uScale);
  gl_PointSize = s;
  vCol = mix(vec3(1.0, 0.62, 0.30), vec3(0.6, 0.75, 1.0), step(0.6, aRnd.x)) * uBright * (0.4 + 0.6*aRnd.w) * 4.0 / (s*s) * 4.0 * (0.7 + 0.3*sin(uTime*(0.8 + aRnd.y) + aRnd.z*40.0));
  vSoft = 0.0;
}`;
const MOTE_FRAG = /* glsl */`
varying vec3 vCol;
void main(){ vec2 q = (gl_PointCoord - 0.5)*2.0; float r = length(q); float a = 1.0 - smoothstep(0.75, 1.0, r); if (a < 0.01) discard; gl_FragColor = vec4(vCol*a, 1.0); }`;

// ---------------------------------------------------------------- human bodies (procedural skeleton)
const ADULT = {
  pelvisH: 0.105, hipW: 0.095, thigh: 0.46, shin: 0.44, foot: 0.16, ankleH: 0.06,
  baseY: 0.14, baseZ: 0.02, hWaist: 0.17, hChest: 0.35, hNeck: 0.54, hSh: 0.48, shW: 0.18, headOff: 0.115,
  uArm: 0.30, fArm: 0.26, hand: 0.17,
  rHead: [0.078, 0.100, 0.093], rNeck: 0.047, rChest: [0.165, 0.150, 0.105], rWaist: [0.140, 0.130, 0.095], rPelvis: [0.165, 0.105, 0.120],
  rSh: 0.060, rUArm: [0.050, 0.041], rFArm: [0.040, 0.030], rHand: [0.032, 0.022], rThigh: [0.085, 0.058], rShin: [0.055, 0.038], rFoot: [0.038, 0.028],
  lean: 16 * DEG, roll: 0, hunch: 0, headPitch: 30 * DEG, thighElev: 40 * DEG, splay: 7 * DEG,
};
const CHILD = {
  pelvisH: 0.072, hipW: 0.064, thigh: 0.29, shin: 0.27, foot: 0.11, ankleH: 0.04,
  baseY: 0.095, baseZ: 0.012, hWaist: 0.11, hChest: 0.235, hNeck: 0.355, hSh: 0.315, shW: 0.118, headOff: 0.098,
  uArm: 0.19, fArm: 0.165, hand: 0.115,
  rHead: [0.072, 0.088, 0.083], rNeck: 0.033, rChest: [0.108, 0.098, 0.074], rWaist: [0.094, 0.085, 0.068], rPelvis: [0.104, 0.070, 0.080],
  rSh: 0.041, rUArm: [0.033, 0.027], rFArm: [0.027, 0.021], rHand: [0.022, 0.016], rThigh: [0.057, 0.041], rShin: [0.037, 0.027], rFoot: [0.026, 0.020],
  lean: -3 * DEG, roll: -7 * DEG, hunch: 0.01, headPitch: 34 * DEG, thighElev: 62 * DEG, splay: 5 * DEG,
};
const GROWN = { ...ADULT, rChest: [0.160, 0.150, 0.102], lean: -2 * DEG, roll: 0, hunch: 0.012, headPitch: 27 * DEG, thighElev: 57 * DEG, splay: 6 * DEG };
const OLD = { ...GROWN, rChest: [0.155, 0.145, 0.100], lean: -9 * DEG, hunch: 0.06, headPitch: 16 * DEG, thighElev: 55 * DEG };
const PARENT_OLD = { ...ADULT, lean: 6 * DEG, hunch: 0.045, headPitch: 6 * DEG };

function lerpP(a, b, k) {
  const o = {};
  for (const key in a) { const x = a[key], y = b[key]; o[key] = Array.isArray(x) ? x.map((v, i) => v + (y[i] - v) * k) : x + (y - x) * k; }
  return o;
}

function bodyJoints(P) {
  const J = {};
  J.pelvis = [0, P.pelvisH, P.baseZ];
  const F0 = [0, Math.sin(P.lean), -Math.cos(P.lean)];
  const U = V.norm([Math.sin(P.roll), Math.cos(P.lean) * Math.cos(P.roll), Math.sin(P.lean) * Math.cos(P.roll)]);
  const X = V.norm(V.cross(F0, U));
  const F = V.cross(U, X);
  const B = [0, P.baseY, P.baseZ];
  const at = (h, fw) => V.add(V.add(B, V.mul(U, h)), V.mul(F, fw));
  J.waist = at(P.hWaist, P.hunch * 0.2);
  J.chest = at(P.hChest, P.hunch * 0.6);
  J.neck = at(P.hNeck, P.hunch * 1.4);
  const shC = at(P.hSh, P.hunch * 1.1);
  J.shL = V.sub(shC, V.mul(X, P.shW)); J.shR = V.add(shC, V.mul(X, P.shW));
  const hp = P.headPitch;
  J.hU = V.add(V.mul(U, Math.cos(hp)), V.mul(F, -Math.sin(hp)));
  J.hF = V.add(V.mul(F, Math.cos(hp)), V.mul(U, Math.sin(hp)));
  J.head = V.add(V.add(J.neck, V.mul(J.hU, P.headOff)), V.mul(J.hF, 0.012));
  J.X = X; J.U = U; J.F = F;
  for (const [side, sg] of [['L', -1], ['R', 1]]) {
    const hip = [sg * P.hipW, P.pelvisH - 0.01, P.baseZ * 0.5];
    const td = V.norm([sg * Math.sin(P.splay), Math.sin(P.thighElev), -Math.cos(P.thighElev)]);
    const knee = V.add(hip, V.mul(td, P.thigh));
    const dx = sg * 0.012;
    const dy = Math.max(P.ankleH - knee[1], -Math.sqrt(P.shin * P.shin - dx * dx) * 0.995);
    const hz = Math.sqrt(Math.max(P.shin * P.shin - dy * dy - dx * dx, 1e-5));
    const ankle = V.add(knee, [dx, dy, -hz]);
    const toe = V.add(ankle, [sg * 0.01, -0.03, -P.foot]);
    J['hip' + side] = hip; J['knee' + side] = knee; J['ankle' + side] = ankle; J['toe' + side] = toe;
  }
  return J;
}

function ik2(S, T, l1, l2, pole) {
  const d = V.sub(T, S); let L = V.len(d); const dir = V.mul(d, 1 / (L || 1));
  L = clamp(L, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const a = (l1 * l1 - l2 * l2 + L * L) / (2 * L); const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  let pp = V.sub(pole, S); pp = V.norm(V.sub(pp, V.mul(dir, V.dot(pp, dir))));
  return [V.add(V.add(S, V.mul(dir, a)), V.mul(pp, h)), V.add(S, V.mul(dir, L))];
}

// arm targets for named gestures, in the figure's local frame
function armSpec(J, P, side, gesture) {
  const sg = side === 'L' ? -1 : 1, s = P.thigh / 0.46;
  const S = J['sh' + side];
  if (gesture === 'lean') return { t: [J['hip' + side][0] + sg * 0.10 * s, 0.035, J['hip' + side][2] + 0.30 * s], pole: V.add(S, [sg * 0.25, 0, 0.35]) };
  if (gesture === 'hug') {
    const mid = V.lerp(J.kneeL, J.kneeR, 0.5);
    return { t: V.add(mid, [sg * 0.03 * s, -0.07 * s, -0.06 * s]), pole: V.add(S, [sg * 0.30, -0.10, -0.12]) };
  }
  if (gesture === 'point') {
    const dir = V.norm([-0.20, 0.88, -0.44]);
    return { t: V.add(S, V.mul(dir, (P.uArm + P.fArm) * 0.97)), pole: V.add(S, [0.30, -0.25, 0.15]) };
  }
  return null;
}
function solveArm(J, P, side, spec) {
  const [E, W] = ik2(J['sh' + side], spec.t, P.uArm, P.fArm, spec.pole);
  const fd = V.norm(V.sub(W, E));
  J['el' + side] = E; J['wr' + side] = W; J['hd' + side] = V.add(W, V.mul(fd, P.hand));
}

// hair: 'bun' (parent) or 'tail' (child's ponytail)
function bodyPrims(J, P, hair) {
  const E = 0, C = 1, I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const s = P.thigh / 0.46;
  const cap = (a, b, ra, rb, k) => ({ k: C, a, b, ra, rb, sk: k * s });
  const ell = (c, ax, r, k) => ({ k: E, c, ax, r, sk: k * s });
  const hb = V.sub(J.head, V.mul(J.hF, 0.072 * s));
  const prims = [
    ell(J.head, [J.X, J.hU, J.hF], P.rHead, 0.03),
    cap(V.sub(J.neck, V.mul(J.U, 0.03)), V.sub(J.head, V.mul(J.hU, 0.03)), P.rNeck, P.rNeck * 0.92, 0.03),
    ell(J.chest, [J.X, J.U, J.F], P.rChest, 0.06),
    ell(J.waist, [J.X, J.U, J.F], P.rWaist, 0.06),
    ell(V.add(J.pelvis, [0, 0.02, 0]), I3, P.rPelvis, 0.06),
    cap(J.shL, J.shR, P.rSh, P.rSh, 0.05),
    cap(J.shL, J.elL, P.rUArm[0], P.rUArm[1], 0.035), cap(J.shR, J.elR, P.rUArm[0], P.rUArm[1], 0.035),
    cap(J.elL, J.wrL, P.rFArm[0], P.rFArm[1], 0.02), cap(J.elR, J.wrR, P.rFArm[0], P.rFArm[1], 0.02),
    cap(J.wrL, J.hdL, P.rHand[0], P.rHand[1], 0.015), cap(J.wrR, J.hdR, P.rHand[0], P.rHand[1], 0.015),
    cap(J.hipL, J.kneeL, P.rThigh[0], P.rThigh[1], 0.045), cap(J.hipR, J.kneeR, P.rThigh[0], P.rThigh[1], 0.045),
    cap(J.kneeL, J.ankleL, P.rShin[0], P.rShin[1], 0.025), cap(J.kneeR, J.ankleR, P.rShin[0], P.rShin[1], 0.025),
    cap(J.ankleL, J.toeL, P.rFoot[0], P.rFoot[1], 0.02), cap(J.ankleR, J.toeR, P.rFoot[0], P.rFoot[1], 0.02),
    hair === 'bun'
      ? ell(V.add(hb, V.mul(J.hU, 0.035 * s)), [J.X, J.hU, J.hF], [0.046 * s, 0.040 * s, 0.040 * s], 0.025)
      : cap(V.add(hb, V.mul(J.hU, 0.040 * s)), V.sub(V.sub(hb, V.mul(J.hU, 0.115 * s)), V.mul(J.hF, 0.03 * s)), 0.026 * s, 0.010 * s, 0.02),
  ];
  for (const p of prims) {
    if (p.k === C) {
      const d = V.sub(p.b, p.a); p.L = V.len(d) || 1e-4; p.ax = V.mul(d, 1 / p.L);
      const ref = Math.abs(p.ax[2]) < 0.92 ? [0, 0, -1] : [0, 1, 0];
      p.e1 = V.norm(V.cross(p.ax, ref)); p.e2 = V.cross(p.ax, p.e1);
    }
  }
  return prims;
}

function primDist(p, x, y, z) {
  if (p.k === 0) {
    const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2], a = p.ax, r = p.r;
    const qx = (dx * a[0][0] + dy * a[0][1] + dz * a[0][2]) / r[0];
    const qy = (dx * a[1][0] + dy * a[1][1] + dz * a[1][2]) / r[1];
    const qz = (dx * a[2][0] + dy * a[2][1] + dz * a[2][2]) / r[2];
    const k0 = Math.hypot(qx, qy, qz), k1 = Math.hypot(qx / r[0], qy / r[1], qz / r[2]);
    return k0 * (k0 - 1) / (k1 || 1e-6);
  }
  const pax = x - p.a[0], pay = y - p.a[1], paz = z - p.a[2];
  const u = clamp((pax * p.ax[0] + pay * p.ax[1] + paz * p.ax[2]) / p.L);
  return Math.hypot(pax - p.ax[0] * u * p.L, pay - p.ax[1] * u * p.L, paz - p.ax[2] * u * p.L) - (p.ra + (p.rb - p.ra) * u);
}
function bodySDF(prims, x, y, z) {
  let d = primDist(prims[0], x, y, z);
  for (let i = 1; i < prims.length; i++) {
    const di = primDist(prims[i], x, y, z), k = prims[i].sk;
    const h = Math.max(k - Math.abs(d - di), 0) / k; d = Math.min(d, di) - h * h * k * 0.25;
  }
  return d;
}
// bone-local coordinates of a point relative to a primitive, and the inverse mapping
function toLocal(p, x, y, z, out, o) {
  if (p.k === 0) {
    const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2], a = p.ax;
    out[o] = 1; out[o + 1] = (dx * a[0][0] + dy * a[0][1] + dz * a[0][2]) / p.r[0];
    out[o + 2] = (dx * a[1][0] + dy * a[1][1] + dz * a[1][2]) / p.r[1]; out[o + 3] = (dx * a[2][0] + dy * a[2][1] + dz * a[2][2]) / p.r[2];
    return;
  }
  const pax = x - p.a[0], pay = y - p.a[1], paz = z - p.a[2];
  const u = pax * p.ax[0] + pay * p.ax[1] + paz * p.ax[2];
  const s = clamp(u / p.L), rr = p.ra + (p.rb - p.ra) * s;
  const rx = pax - p.ax[0] * u, ry = pay - p.ax[1] * u, rz = paz - p.ax[2] * u;
  out[o + 2] = (rx * p.e1[0] + ry * p.e1[1] + rz * p.e1[2]) / rr; out[o + 3] = (rx * p.e2[0] + ry * p.e2[1] + rz * p.e2[2]) / rr;
  if (u < 0) { out[o] = 2; out[o + 1] = u / p.ra; } else if (u > p.L) { out[o] = 4; out[o + 1] = (u - p.L) / p.rb; } else { out[o] = 3; out[o + 1] = s; }
}
const _m = [0, 0, 0];
function fromLocal(p, l, o) {
  if (l[o] === 1) {
    const a = p.ax, x = l[o + 1] * p.r[0], y = l[o + 2] * p.r[1], z = l[o + 3] * p.r[2];
    _m[0] = p.c[0] + a[0][0] * x + a[1][0] * y + a[2][0] * z; _m[1] = p.c[1] + a[0][1] * x + a[1][1] * y + a[2][1] * z; _m[2] = p.c[2] + a[0][2] * x + a[1][2] * y + a[2][2] * z;
    return _m;
  }
  let bx, by, bz, rr; const c = l[o], v = l[o + 1];
  if (c === 2) { rr = p.ra; bx = p.a[0] + p.ax[0] * v * rr; by = p.a[1] + p.ax[1] * v * rr; bz = p.a[2] + p.ax[2] * v * rr; }
  else if (c === 4) { rr = p.rb; bx = p.b[0] + p.ax[0] * v * rr; by = p.b[1] + p.ax[1] * v * rr; bz = p.b[2] + p.ax[2] * v * rr; }
  else { rr = p.ra + (p.rb - p.ra) * v; bx = p.a[0] + p.ax[0] * v * p.L; by = p.a[1] + p.ax[1] * v * p.L; bz = p.a[2] + p.ax[2] * v * p.L; }
  const q1 = l[o + 2] * rr, q2 = l[o + 3] * rr;
  _m[0] = bx + p.e1[0] * q1 + p.e2[0] * q2; _m[1] = by + p.e1[1] * q1 + p.e2[1] * q2; _m[2] = bz + p.e1[2] * q1 + p.e2[2] * q2;
  return _m;
}
// frame (rotation) of a primitive: rows = basis vectors
function primFrame(p) { return p.k === 0 ? p.ax : [p.ax, p.e1, p.e2]; }

// A figure: particles sampled on the smooth-union SDF of a reference pose, skinned to their two nearest bones.
class Figure {
  constructor(refPrims, n, seed) {
    const R = new Rand(seed);
    // bounding box
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of refPrims) {
      const pts = p.k === 0 ? [p.c] : [p.a, p.b]; const r = p.k === 0 ? Math.max(...p.r) : Math.max(p.ra, p.rb);
      for (const q of pts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], q[i] - r - 0.03); mx[i] = Math.max(mx[i], q[i] + r + 0.03); }
    }
    const size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
    const h = size / 110;
    const nx = Math.ceil((mx[0] - mn[0]) / h), ny = Math.ceil((mx[1] - mn[1]) / h), nz = Math.ceil((mx[2] - mn[2]) / h);
    const grid = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
    const gi = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
    for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) grid[gi(i, j, k)] = bodySDF(refPrims, mn[0] + i * h, mn[1] + j * h, mn[2] + k * h);
    const cells = [];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let lo = 1, hi = -1;
      for (let c = 0; c < 8; c++) { const v = grid[gi(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (lo < 0 && hi > 0) cells.push(i, j, k);
    }
    const nc = cells.length / 3;
    this.n = n;
    this.b = new Uint8Array(n * 2); this.wt = new Float32Array(n); this.loc = new Float32Array(n * 8); this.nl = new Float32Array(n * 3);
    this.off = new Float32Array(n); this.aura = new Float32Array(n); this.rnd = new Float32Array(n * 4); this.h = new Float32Array(n);
    const e = h * 0.01, NP = refPrims.length, dists = new Float32Array(NP);
    let k = 0, guard = 0;
    while (k < n && guard++ < n * 30) {
      const c = Math.floor(R.next() * nc) * 3;
      let x = mn[0] + (cells[c] + R.next()) * h, y = mn[1] + (cells[c + 1] + R.next()) * h, z = mn[2] + (cells[c + 2] + R.next()) * h;
      if (Math.abs(bodySDF(refPrims, x, y, z)) > h * 0.2) continue;
      let d = 0, gx = 0, gy = 0, gz = 0;
      for (let it = 0; it < 3; it++) {
        d = bodySDF(refPrims, x, y, z);
        gx = bodySDF(refPrims, x + e, y, z) - d; gy = bodySDF(refPrims, x, y + e, z) - d; gz = bodySDF(refPrims, x, y, z + e) - d;
        const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
        x -= gx * d; y -= gy * d; z -= gz * d;
      }
      if (Math.abs(d) > h * 0.3) continue;
      // bind to the two nearest bones
      let i1 = 0, i2 = 1;
      for (let i = 0; i < NP; i++) dists[i] = primDist(refPrims[i], x, y, z);
      if (dists[i2] < dists[i1]) { i1 = 1; i2 = 0; }
      for (let i = 2; i < NP; i++) { if (dists[i] < dists[i1]) { i2 = i1; i1 = i; } else if (dists[i] < dists[i2]) i2 = i; }
      const kb = 0.012 * (refPrims[0].sk / 0.03);
      const w2 = 1 / (1 + Math.exp((dists[i2] - dists[i1]) / kb));
      this.b[k * 2] = i1; this.b[k * 2 + 1] = i2; this.wt[k] = 1 - w2;
      toLocal(refPrims[i1], x, y, z, this.loc, k * 8); toLocal(refPrims[i2], x, y, z, this.loc, k * 8 + 4);
      const F = primFrame(refPrims[i1]);
      this.nl[k * 3] = gx * F[0][0] + gy * F[0][1] + gz * F[0][2]; this.nl[k * 3 + 1] = gx * F[1][0] + gy * F[1][1] + gz * F[1][2]; this.nl[k * 3 + 2] = gx * F[2][0] + gy * F[2][1] + gz * F[2][2];
      const isAura = R.next() < 0.08;
      this.aura[k] = isAura ? 1 : 0;
      const w = R.next();
      this.off[k] = (isAura ? 0.004 + 0.02 * w * w : -0.012 * w * w * w) * (refPrims[0].sk / 0.03);
      for (let j = 0; j < 4; j++) this.rnd[k * 4 + j] = R.next();
      k++;
    }
    this.n = k;
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(this.n * 3), 3); this.pos.setUsage(THREE.DynamicDrawUsage);
    this.nrm = new THREE.BufferAttribute(new Float32Array(this.n * 3), 3); this.nrm.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos); this.geo.setAttribute('normal', this.nrm);
    this.geo.setAttribute('aRnd', new THREE.BufferAttribute(this.rnd.subarray(0, this.n * 4), 4));
    this.hAttr = new THREE.BufferAttribute(this.h.subarray(0, this.n), 1);
    this.geo.setAttribute('aH', this.hAttr);
    this.geo.setAttribute('aAura', new THREE.BufferAttribute(this.aura.subarray(0, this.n), 1));
  }
  evaluate(prims, place, out = null) {
    const P = out || this.pos.array, N = this.nrm.array;
    const cy = Math.cos(place.yaw), sy = Math.sin(place.yaw);
    const L = this.loc;
    for (let i = 0; i < this.n; i++) {
      const p1 = prims[this.b[i * 2]], p2 = prims[this.b[i * 2 + 1]], w1 = this.wt[i];
      let m = fromLocal(p1, L, i * 8); const ax = m[0], ay = m[1], az = m[2];
      m = fromLocal(p2, L, i * 8 + 4);
      let px = ax * w1 + m[0] * (1 - w1), py = ay * w1 + m[1] * (1 - w1), pz = az * w1 + m[2] * (1 - w1);
      const F = primFrame(p1), a = this.nl[i * 3], b = this.nl[i * 3 + 1], c = this.nl[i * 3 + 2];
      let nx = F[0][0] * a + F[1][0] * b + F[2][0] * c, ny = F[0][1] * a + F[1][1] * b + F[2][1] * c, nz = F[0][2] * a + F[1][2] * b + F[2][2] * c;
      const o = this.off[i]; px += nx * o; py += ny * o; pz += nz * o;
      const wx = cy * px + sy * pz, wz = -sy * px + cy * pz, j = i * 3;
      P[j] = place.x + wx; P[j + 1] = place.y + py; P[j + 2] = place.z + wz;
      N[j] = cy * nx + sy * nz; N[j + 1] = ny; N[j + 2] = -sy * nx + cy * nz;
    }
    this.pos.needsUpdate = true; this.nrm.needsUpdate = true;
  }
  setHeights(prims) {
    const tmp = new Float32Array(this.n * 3);
    this.evaluate(prims, { x: 0, y: 0, z: 0, yaw: 0 }, tmp);
    let mx = 1e-3; for (let i = 0; i < this.n; i++) mx = Math.max(mx, tmp[i * 3 + 1]);
    for (let i = 0; i < this.n; i++) this.h[i] = clamp(tmp[i * 3 + 1] / mx);
    this.hAttr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- the child's hand (SDF, hand space)
// wrist at origin, fingers +y, back of the hand +z, thumb on -x (a right hand seen from behind).
function handSkeleton() {
  const fingers = [
    { base: [-0.0212, 0.0705, 0.0006], spread: -0.075, lens: [0.0255, 0.0168, 0.0148], radii: [0.0083, 0.0076, 0.0069, 0.0060], flex: [0.03, 0.06, 0.05] },
    { base: [-0.0068, 0.0738, 0.0006], spread: 0.02, lens: [0.0280, 0.0182, 0.0152], radii: [0.0086, 0.0079, 0.0071, 0.0062], flex: [0.22, 0.38, 0.26] },
    { base: [0.0076, 0.0712, 0.0002], spread: 0.11, lens: [0.0262, 0.0172, 0.0146], radii: [0.0080, 0.0073, 0.0066, 0.0058], flex: [0.32, 0.50, 0.32] },
    { base: [0.0204, 0.0630, -0.0008], spread: 0.23, lens: [0.0205, 0.0132, 0.0126], radii: [0.0071, 0.0065, 0.0059, 0.0052], flex: [0.42, 0.58, 0.38] },
  ];
  const segs = [];
  const fingerData = [];
  for (const f of fingers) {
    let d = [Math.sin(f.spread), Math.cos(f.spread), 0];
    const axis = [Math.cos(f.spread), -Math.sin(f.spread), 0];
    const J = [f.base];
    for (let k = 0; k < 3; k++) { d = V.rot(d, axis, -f.flex[k]); J.push(V.add(J[k], V.mul(d, f.lens[k]))); }
    const fs = [];
    for (let k = 0; k < 3; k++) fs.push({ a: J[k], b: J[k + 1], ra: f.radii[k], rb: f.radii[k + 1] });
    segs.push(fs);
    fingerData.push({ J, d, axis, tip: V.add(J[3], V.mul(d, f.radii[3] * 0.9)), r: f.radii });
  }
  const tb = [-0.0190, 0.0120, -0.0040];
  const tdirs = [V.norm([-0.62, 0.70, -0.36]), V.norm([-0.40, 0.87, -0.30]), V.norm([-0.24, 0.94, -0.24])];
  const tl = [0.030, 0.021, 0.018], tr = [0.0115, 0.0099, 0.0089, 0.0076];
  const TJ = [tb];
  for (let k = 0; k < 3; k++) TJ.push(V.add(TJ[k], V.mul(tdirs[k], tl[k])));
  const thumb = [];
  for (let k = 0; k < 3; k++) thumb.push({ a: TJ[k], b: TJ[k + 1], ra: tr[k], rb: tr[k + 1] });
  const thumbData = { J: TJ, d: tdirs[2], axis: V.norm(V.cross(tdirs[2], [0, 0, 1])), r: tr };
  return { segs, thumb, fingerData, thumbData };
}

function makeHandSDF(sk) {
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const capT = (x, y, z, s) => {
    const bax = s.b[0] - s.a[0], bay = s.b[1] - s.a[1], baz = s.b[2] - s.a[2];
    const pax = x - s.a[0], pay = y - s.a[1], paz = z - s.a[2];
    const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz));
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - (s.ra + (s.rb - s.ra) * h);
  };
  const ell = (x, y, z, c, r) => {
    const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
    const k0 = Math.hypot(px, py, pz), k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
    return k0 * (k0 - 1) / (k1 || 1e-6);
  };
  const sph = (x, y, z, c, r) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
  const thenar = { c: [-0.0165, 0.0215, -0.0058], r: [0.0150, 0.0225, 0.0118] };
  const hypo = { c: [0.0195, 0.0300, -0.0040], r: [0.0100, 0.0260, 0.0100] };
  const knuckles = sk.fingerData.map(f => V.add(f.J[0], [0, 0.0015, 0.0052]));
  const wrist = { a: [0.0, 0.004, -0.001], b: [0.003, -0.040, 0.001], ra: 0.0185, rb: 0.0182 };
  const fore = { a: [0.003, -0.035, 0.001], b: [0.013, -0.280, 0.016], ra: 0.0190, rb: 0.0270 };
  const ulna = [0.0185, -0.0120, 0.0045];
  return (x, y, z) => {
    // palm: tapered, slightly domed round box
    const ty = clamp(y / 0.07);
    const sx = 1 / (0.86 + 0.14 * ty);
    const qx = Math.abs(x * sx) - 0.0200, qy = Math.abs(y - 0.0360) - 0.0300, qz = Math.abs(z + 4.0 * x * x - 0.0004) - 0.0055;
    let d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - 0.0085;
    d = smin(d, ell(x, y, z, thenar.c, thenar.r), 0.012);
    d = smin(d, ell(x, y, z, hypo.c, hypo.r), 0.010);
    for (const k of knuckles) d = smin(d, sph(x, y, z, k, 0.0058), 0.005);
    for (const fs of sk.segs) {
      let f = capT(x, y, z, fs[0]); f = smin(f, capT(x, y, z, fs[1]), 0.002); f = smin(f, capT(x, y, z, fs[2]), 0.002);
      d = smin(d, f, 0.006);
    }
    let t = capT(x, y, z, sk.thumb[0]); t = smin(t, capT(x, y, z, sk.thumb[1]), 0.003); t = smin(t, capT(x, y, z, sk.thumb[2]), 0.003);
    d = smin(d, t, 0.010);
    d = smin(d, capT(x, y, z * 1.35, wrist) / 1.15, 0.012);
    d = smin(d, capT(x, y, z * 1.22, fore) / 1.1, 0.015);
    d = smin(d, sph(x, y, z, ulna, 0.0068), 0.008);
    return d;
  };
}

function sampleHand(sdf, sk, count, seed) {
  const R = new Rand(seed);
  const h = 0.0022;
  const x0 = -0.078, y0 = -0.285, z0 = -0.048, nx = Math.ceil(0.135 / h), ny = Math.ceil(0.455 / h), nz = Math.ceil(0.096 / h);
  const grid = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  const gi = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) grid[gi(i, j, k)] = sdf(x0 + i * h, y0 + j * h, z0 + k * h);
  const cells = []; let wsum = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let mn = 1, mx = -1;
    for (let c = 0; c < 8; c++) { const v = grid[gi(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))]; mn = Math.min(mn, v); mx = Math.max(mx, v); }
    if (mn < 0 && mx > 0) {
      const y = y0 + (j + 0.5) * h;
      const w = y > -0.02 ? (y > 0.07 ? 1.25 : 1.0) : 0.22 + 0.78 * smoothstep(-0.20, -0.02, y);
      cells.push(i, j, k, w); wsum += w;
    }
  }
  const pos = [], nrm = [], fade = [], nail = [], ao = [];
  const e = 1e-4;
  const tipSegs = sk.fingerData.map(f => ({ a: f.J[2], b: f.J[3], d: V.norm(V.sub(f.J[3], f.J[2])), dorsal: V.norm(V.cross(f.axis, V.norm(V.sub(f.J[3], f.J[2])))), r: f.r[3] }));
  tipSegs.push({ a: sk.thumbData.J[2], b: sk.thumbData.J[3], d: sk.thumbData.d, dorsal: V.norm([-0.35, 0.05, 1.0]), r: sk.thumbData.r[3] });
  for (let c = 0; c < cells.length; c += 4) {
    const exp = count * cells[c + 3] / wsum;
    let n = Math.floor(exp * 3.2); if (R.next() < exp * 3.2 - n) n++;
    for (let s = 0; s < n; s++) {
      let x = x0 + (cells[c] + R.next()) * h, y = y0 + (cells[c + 1] + R.next()) * h, z = z0 + (cells[c + 2] + R.next()) * h;
      if (Math.abs(sdf(x, y, z)) > h * 0.2) continue;
      let gx = 0, gy = 0, gz = 0, d = 0;
      for (let it = 0; it < 2; it++) {
        d = sdf(x, y, z);
        gx = sdf(x + e, y, z) - d; gy = sdf(x, y + e, z) - d; gz = sdf(x, y, z + e) - d;
        const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
        x -= gx * d; y -= gy * d; z -= gz * d;
      }
      if (Math.abs(d) > 0.002) continue;
      pos.push(x, y, z); nrm.push(gx, gy, gz);
      let occ = 0;
      for (const [dd, wgt] of [[0.002, 0.5], [0.0045, 0.3], [0.009, 0.2]]) occ += wgt * clamp((dd - sdf(x + gx * dd, y + gy * dd, z + gz * dd)) / dd, 0, 1);
      ao.push(clamp(1 - 2.3 * occ, 0.08, 1));
      fade.push(smoothstep(-0.21, -0.04, y));
      let nl = 0;
      for (const t of tipSegs) {
        const px = x - t.a[0], py = y - t.a[1], pz = z - t.a[2];
        const L = V.len(V.sub(t.b, t.a));
        const along = (px * t.d[0] + py * t.d[1] + pz * t.d[2]) / L;
        const up = gx * t.dorsal[0] + gy * t.dorsal[1] + gz * t.dorsal[2];
        const radial = Math.hypot(px - t.d[0] * along * L, py - t.d[1] * along * L, pz - t.d[2] * along * L);
        if (along > 0.38 && along < 1.15 && up > 0.55 && radial < t.r * 1.6) nl = Math.max(nl, smoothstep(0.55, 0.8, up) * smoothstep(0.38, 0.5, along));
      }
      nail.push(nl);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), fade: new Float32Array(fade), nail: new Float32Array(nail), ao: new Float32Array(ao) };
}

// ================================================================= the scene
export default class Humans {
  constructor(ctx) {
    this.ctx = ctx;
    this.uScale = ctx.height / 804;
  }

  async init() {
    this.camWide = new THREE.PerspectiveCamera(WIDE_FOV, this.ctx.aspect, 0.05, 2000);
    this.camHand = new THREE.PerspectiveCamera(HAND_FOV, this.ctx.aspect, 0.05, 2000);
    this.setWideCam(0.3);
    this._bakeMilkyWay();
    this._setupSkyFrame();
    this.sceneWide = new THREE.Scene();
    this._buildDome();
    this._buildStars();
    this._buildRidge();
    this._buildHill();
    this._buildGrass();
    this._buildFigures();
    this.sceneHand = new THREE.Scene();
    this._buildHand();
  }

  setWideCam(push) {
    const c = this.camWide;
    c.position.set(0, 0, -push);
    c.rotation.set(PITCH, 0, 0);
    c.updateMatrixWorld(true);
  }
  dirFromScreen(cam, sx, sy) {
    const v = new THREE.Vector3(sx * 2 - 1, -(sy * 2 - 1), 0.5).unproject(cam);
    return v.sub(cam.position).normalize();
  }

  // ------------------------------------------------------------ sky
  _bakeMilkyWay() {
    const r = this.ctx.renderer;
    const mk = (w, h, type, mips) => new THREE.WebGLRenderTarget(w, h, {
      type, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: mips,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.mwRT = mk(MW_W, MW_H, THREE.HalfFloatType, true);
    const densRT = mk(1024, 256, THREE.UnsignedByteType, false);
    const mat = new THREE.ShaderMaterial({ vertexShader: FSQ_VERT, fragmentShader: MW_FRAG, uniforms: { uMode: { value: 0 }, uBmax: { value: BMAX } }, depthTest: false, depthWrite: false });
    const sc = new THREE.Scene(); const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false; sc.add(q);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.mwRT); r.render(sc, cam);
    mat.uniforms.uMode.value = 1; r.setRenderTarget(densRT); r.render(sc, cam);
    this.dens = new Uint8Array(1024 * 256 * 4);
    r.readRenderTargetPixels(densRT, 0, 0, 1024, 256, this.dens);
    r.setRenderTarget(prev);
    densRT.dispose(); mat.dispose(); q.geometry.dispose();
  }

  _setupSkyFrame() {
    // galactic plane: a straight diagonal on screen (great circles are straight lines in a rectilinear lens)
    const cam = this.camWide;
    const dA = this.dirFromScreen(cam, 0.0, 0.74), dB = this.dirFromScreen(cam, 1.0, -0.06);
    const n = new THREE.Vector3().crossVectors(dA, dB).normalize();
    const core = this.dirFromScreen(cam, 0.36, 0.44);
    const gx = core.clone().sub(n.clone().multiplyScalar(core.dot(n))).normalize();
    const gz = n, gy = new THREE.Vector3().crossVectors(gz, gx);
    this.gal = new THREE.Matrix3().set(gx.x, gx.y, gx.z, gy.x, gy.y, gy.z, gz.x, gz.y, gz.z);
    this.galBasis = [gx, gy, gz];
    this.pole = this.dirFromScreen(cam, 0.68, 0.12);
  }

  _densAt(l, b) {
    const u = l / (Math.PI * 2) + 0.5, v = b / (2 * BMAX) + 0.5;
    if (v <= 0 || v >= 1) return [0, 1];
    const x = clamp(Math.floor(u * 1024), 0, 1023), y = clamp(Math.floor(v * 256), 0, 255);
    const i = (y * 1024 + x) * 4;
    return [this.dens[i] / 255, this.dens[i + 1] / 255];
  }

  _buildDome() {
    this.domeU = {
      tMW: { value: this.mwRT.texture }, uGal: { value: this.gal }, uPole: { value: this.pole },
      uAng: { value: 0 }, uLen: { value: 0 }, uBmax: { value: BMAX }, uGain: { value: 0.30 }, uSmear: { value: 0 }, uSkyGain: { value: 1 },
    };
    const m = new THREE.Mesh(new THREE.SphereGeometry(900, 96, 48), new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms: this.domeU, side: THREE.BackSide, depthWrite: false, depthTest: false,
    }));
    m.renderOrder = -10; m.frustumCulled = false;
    m.name = 'dome'; this.sceneWide.add(m);
  }

  _buildStars() {
    const R = new Rand(4417);
    const N = 260000;
    const [gx, gy, gz] = this.galBasis;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N), trail = new Float32Array(N);
    const flux = new Float32Array(N);
    let n = 0, guard = 0;
    while (n < N && guard++ < N * 30) {
      const pop = R.next();
      let l, b;
      if (pop < 0.36) { // isotropic field
        const z = R.range(-1, 1); b = Math.asin(z); l = R.range(-Math.PI, Math.PI);
        const [, tr] = this._densAt(l, b);
        if (R.next() > 0.35 + 0.65 * tr) continue;
      } else if (pop < 0.92) { // disk
        l = R.range(-Math.PI, Math.PI); b = R.gauss() * 0.09;
        const [d, tr] = this._densAt(l, b);
        if (R.next() > 0.08 + 0.92 * Math.min(1, d * 1.3) * (0.3 + 0.7 * tr)) continue;
      } else { // bulge
        l = R.gauss() * 0.32; b = R.gauss() * 0.18;
        const [, tr] = this._densAt(l, b);
        if (R.next() > 0.15 + 0.85 * tr) continue;
      }
      const cb = Math.cos(b);
      const g = [cb * Math.cos(l), cb * Math.sin(l), Math.sin(b)];
      const d = new THREE.Vector3().addScaledVector(gx, g[0]).addScaledVector(gy, g[1]).addScaledVector(gz, g[2]).normalize();
      // magnitude distribution (many faint, few bright)
      const m = Math.max(-1.4, 9.6 + Math.log10(Math.max(R.next(), 1e-9)) / 0.36);
      const f = Math.pow(10, -0.4 * (m - 6));
      // temperature
      const tr = R.next();
      const bulgeK = Math.exp(-(l * l / 0.2 + b * b / 0.06));
      let K = tr < 0.12 + 0.2 * bulgeK ? R.range(2800, 4000) : tr < 0.62 ? R.range(4200, 6500) : tr < 0.88 ? R.range(6500, 10000) : R.range(10000, 26000);
      let c = blackbodyJS(K);
      const lum = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      c = c.map(x => x / lum);
      const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      c = c.map(x => L + (x - L) * 1.25);
      const I = 0.12 * Math.pow(f, 0.56);
      const sz = 1.5 + 1.1 * clamp(Math.log10(f + 1) / 2.6) + (f > 80 ? 2.5 * clamp((Math.log10(f) - 1.9) / 1.0) : 0);
      const o = n * 3;
      pos[o] = d.x * SKY_R; pos[o + 1] = d.y * SKY_R; pos[o + 2] = d.z * SKY_R;
      const k = I * (1.5 * 1.5) / (sz * sz) * 1.6;
      col[o] = c[0] * k; col[o + 1] = c[1] * k; col[o + 2] = c[2] * k;
      size[n] = sz; seed[n] = R.next(); flux[n] = f;
      n++;
    }
    // brightest stars get trails in the time-lapse
    const NT = 2200;
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => flux[b] - flux[a]).slice(0, NT);
    for (const i of idx) trail[i] = 1;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col.subarray(0, n * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size.subarray(0, n), 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed.subarray(0, n), 1));
    geo.setAttribute('aTrail', new THREE.BufferAttribute(trail.subarray(0, n), 1));
    this.starU = { uRot: { value: new THREE.Matrix3() }, uScale: { value: this.uScale }, uTime: { value: 0 }, uTwinkle: { value: 0.12 }, uFaint: { value: 1 }, uBright: { value: 1 } };
    const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: this.starU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    }));
    pts.frustumCulled = false; pts.renderOrder = 1;
    this.starPts = pts;
    this.sceneWide.add(pts);

    // trail ribbons (lifetime): S segments per star, arc computed in the vertex shader
    const S = 44;
    const vpr = (S + 1) * 2;
    const tPos = new Float32Array(NT * vpr * 3), tCol = new Float32Array(NT * vpr * 3), tS = new Float32Array(NT * vpr), tSide = new Float32Array(NT * vpr), tW = new Float32Array(NT * vpr);
    const ind = new Uint32Array(NT * S * 6);
    idx.forEach((si, k) => {
      const f = flux[si];
      const I = 0.028 * Math.pow(f, 0.5);
      const w = 0.8 + 0.8 * clamp(Math.log10(f + 1) / 2.5);
      const cl = [col[si * 3], col[si * 3 + 1], col[si * 3 + 2]];
      const cm = Math.max(1e-6, 0.2126 * cl[0] + 0.7152 * cl[1] + 0.0722 * cl[2]);
      for (let s = 0; s <= S; s++) for (let side = 0; side < 2; side++) {
        const v = k * vpr + s * 2 + side;
        tPos[v * 3] = pos[si * 3] / SKY_R; tPos[v * 3 + 1] = pos[si * 3 + 1] / SKY_R; tPos[v * 3 + 2] = pos[si * 3 + 2] / SKY_R;
        tCol[v * 3] = cl[0] / cm * I; tCol[v * 3 + 1] = cl[1] / cm * I; tCol[v * 3 + 2] = cl[2] / cm * I;
        tS[v] = s / S; tSide[v] = side ? 1 : -1; tW[v] = w;
      }
      for (let s = 0; s < S; s++) {
        const a = k * vpr + s * 2, o = (k * S + s) * 6;
        ind[o] = a; ind[o + 1] = a + 1; ind[o + 2] = a + 2; ind[o + 3] = a + 1; ind[o + 4] = a + 3; ind[o + 5] = a + 2;
      }
    });
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    tg.setAttribute('aCol', new THREE.BufferAttribute(tCol, 3));
    tg.setAttribute('aS', new THREE.BufferAttribute(tS, 1));
    tg.setAttribute('aSide', new THREE.BufferAttribute(tSide, 1));
    tg.setAttribute('aW', new THREE.BufferAttribute(tW, 1));
    tg.setIndex(new THREE.BufferAttribute(ind, 1));
    this.trailU = { uPole: { value: this.pole }, uAng: { value: 0 }, uLen: { value: 0 }, uScale: { value: this.uScale }, uGain: { value: 1 }, uRes: { value: new THREE.Vector2(this.ctx.width, this.ctx.height) } };
    this.trails = new THREE.Mesh(tg, new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, uniforms: this.trailU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    }));
    this.trails.frustumCulled = false; this.trails.renderOrder = 2; this.trails.visible = false;
    this.sceneWide.add(this.trails);
  }

  _buildRidge() {
    const SEG = 900, Rr = 320;
    const pos = new Float32Array((SEG + 1) * 2 * 3), top = new Float32Array((SEG + 1) * 2);
    const ind = [];
    for (let i = 0; i <= SEG; i++) {
      const az = -Math.PI + (i / SEG) * Math.PI * 2;
      const el = 0.010 + 0.024 * (fbm1(az * 2.2 + 3.0) * 0.5 + 0.5) + 0.007 * fbm1(az * 9.0 + 1.0) + 0.0025 * fbm1(az * 40.0);
      const dx = Math.sin(az), dz = -Math.cos(az);
      const y = Rr * Math.tan(el);
      pos.set([dx * Rr, y, dz * Rr, dx * Rr, -200, dz * Rr], i * 6);
      top[i * 2] = Math.sin(el); top[i * 2 + 1] = Math.sin(el);
      if (i < SEG) { const a = i * 2; ind.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aTop', new THREE.BufferAttribute(top, 1)); g.setIndex(ind);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: RIDGE_VERT, fragmentShader: RIDGE_FRAG, side: THREE.DoubleSide }));
    m.frustumCulled = false; m.renderOrder = 0;
    m.name = 'ridge'; this.sceneWide.add(m);
  }

  // ------------------------------------------------------------ hill
  hillShape(x, z) {
    const dx = x - this.xf;
    const crest = -0.9 * (Math.sqrt(1 + (dx / 4) ** 2) - 1) + 0.03 * dx;
    const dz = z - ZC;
    const fall = dz > 0 ? 0.062 * dz * dz : 0.07 * dz * dz;
    return crest - fall + 0.07 * fbm2(x * 0.45, z * 0.45, 3) + 0.016 * fbm2(x * 2.5 + 7, z * 2.5, 2);
  }
  hill(x, z) { return this.yc + this.hillShape(x, z); }

  _buildHill() {
    // place the figures on screen first, then shape the hill so its crest passes under them
    const cam = this.camWide;
    const d = this.dirFromScreen(cam, 0.745, 0.79);
    const tt = (ZC - cam.position.z) / d.z;
    this.gx = cam.position.x + d.x * tt; this.gy = cam.position.y + d.y * tt;
    this.xf = this.gx + 0.4;
    this.yc = 0; this.yc = this.gy - this.hillShape(this.gx, ZC);

    const NX = 900, NZ = 220;
    const xs = [], zs = [];
    for (let i = 0; i <= NX; i++) xs.push(-32 + 74 * i / NX);
    for (let j = 0; j <= NZ; j++) { const q = j / NZ * 2 - 1; zs.push(ZC + Math.sign(q) * Math.pow(Math.abs(q), 2.2) * (q < 0 ? 34 : 9.8)); }
    const pos = new Float32Array((NX + 1) * (NZ + 1) * 3);
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const o = (j * (NX + 1) + i) * 3; pos[o] = xs[i]; pos[o + 1] = this.hill(xs[i], zs[j]); pos[o + 2] = zs[j];
    }
    const ind = new Uint32Array(NX * NZ * 6);
    let k = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, e = c + 1;
      ind[k++] = a; ind[k++] = c; ind[k++] = b; ind[k++] = b; ind[k++] = c; ind[k++] = e;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(ind, 1));
    g.computeVertexNormals();
    this.hillU = { uRim: { value: 1 } };
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: HILL_VERT, fragmentShader: HILL_FRAG, uniforms: this.hillU, side: THREE.DoubleSide }));
    m.frustumCulled = false; m.renderOrder = 0;
    m.name = 'hill'; this.sceneWide.add(m);
  }

  _buildGrass() {
    const R = new Rand(9131);
    const N = 34000;
    const pos = new Float32Array(N * 9), aT = new Float32Array(N * 3), aPh = new Float32Array(N * 3);
    let n = 0;
    while (n < N) {
      const x = R.range(-15, 18), z = ZC + R.range(-0.5, 1.4);
      const clump = fbm2(x * 1.7, z * 1.7, 2) * 0.5 + 0.5;
      if (R.next() > 0.25 + 0.75 * clump) continue;
      // keep the immediate seat area a bit sparser
      const y = this.hill(x, z) - 0.01;
      const h = (0.035 + 0.17 * Math.pow(R.next(), 1.6)) * (0.5 + clump);
      const w = R.range(0.007, 0.014);
      const yaw = R.range(-0.7, 0.7);
      const rx = Math.cos(yaw) * w * 0.5, rz = Math.sin(yaw) * w * 0.5;
      const lx = R.range(-0.4, 0.4) * h, lz = R.range(-0.3, 0.3) * h;
      pos.set([x - rx, y, z - rz, x + rx, y, z + rz, x + lx, y + h, z + lz], n * 9);
      aT.set([0, 0, 1], n * 3);
      const ph = x * 1.3 + z * 0.7 + R.range(0, 0.6);
      aPh.set([ph, ph, ph], n * 3);
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aT', new THREE.BufferAttribute(aT, 1)); g.setAttribute('aPh', new THREE.BufferAttribute(aPh, 1));
    this.grassU = { uTime: { value: 0 }, uRim: { value: 1 } };
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, uniforms: this.grassU, side: THREE.DoubleSide }));
    m.frustumCulled = false; m.renderOrder = 0;
    m.name = 'grass'; this.sceneWide.add(m);
  }

  // ------------------------------------------------------------ figures
  _buildFigures() {
    this.yaw = -9 * DEG;
    const mkRef = (P, gest, hair) => { const J = bodyJoints(P); solveArm(J, P, 'L', armSpec(J, P, 'L', gest[0])); solveArm(J, P, 'R', armSpec(J, P, 'R', gest[1])); return bodyPrims(J, P, hair); };
    this.parent = new Figure(mkRef(ADULT, ['lean', 'hug'], 'bun'), 30000, 71);
    this.child = new Figure(mkRef(CHILD, ['hug', 'hug'], 'tail'), 24000, 83);
    this.parent.setHeights(mkRef(ADULT, ['lean', 'hug'], 'bun'));
    this.child.setHeights(mkRef(OLD, ['hug', 'hug'], 'tail'));
    const px = this.uPx = this.ctx.height / (2 * Math.tan(WIDE_FOV * DEG / 2));
    const mkU = () => ({
      uT: { value: 0 }, uTime: { value: 0 }, uDisStart: { value: 1e9 }, uDisSpan: { value: 1 }, uDisMode: { value: 0 }, uCenter: { value: new THREE.Vector3() },
      uPx: { value: px }, uSize: { value: 0.0125 }, uBright: { value: 0.30 }, uBias: { value: 0.03 }, uPulse: { value: 0 },
      uWarm: { value: new THREE.Vector3(1.0, 0.50, 0.17) }, uRim: { value: new THREE.Vector3(1.0, 0.74, 0.46) },
      uOcc: { value: 0.024 }, uInset: { value: 0.008 }, uColor: { value: new THREE.Vector3(0.050, 0.020, 0.006) },
    });
    for (const f of [this.parent, this.child]) {
      f.U = mkU();
      const glow = new THREE.Points(f.geo, new THREE.ShaderMaterial({ vertexShader: FIG_VERT, fragmentShader: FIG_FRAG, uniforms: f.U, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true }));
      const occ = new THREE.Points(f.geo, new THREE.ShaderMaterial({ vertexShader: OCC_VERT, fragmentShader: FOCC_FRAG, uniforms: f.U }));
      glow.frustumCulled = occ.frustumCulled = false; glow.renderOrder = 5; occ.renderOrder = 3;
      glow.name = 'figs'; occ.name = 'figs'; this.sceneWide.add(occ); this.sceneWide.add(glow);
    }
  }

  // place figure-local offsets (in the pair's frame) on the hill
  _place(offX, offZ) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const x = this.gx + cy * offX + sy * offZ, z = ZC - sy * offX + cy * offZ;
    return { x, z, y: this.hill(x, z) - 0.015, yaw: this.yaw };
  }

  // pose both figures for a given mode/time
  _poseFigures(mode, t) {
    const breath = Math.sin(t * Math.PI * 2 / 4.6);
    let Pp, Pc, childOff = 0.22, childArmR = 'hug', pointK = 0;
    if (mode === 'wide') {
      Pp = { ...ADULT, lean: ADULT.lean + 0.6 * DEG * breath };
      pointK = smootherstep(6.3, 9.2, t);
      Pc = { ...CHILD, headPitch: CHILD.headPitch + 8 * DEG * pointK, roll: CHILD.roll * (1 - 0.6 * pointK), lean: CHILD.lean + 0.5 * DEG * Math.sin(t * Math.PI * 2 / 3.7 + 1) };
    } else {
      const kg = smootherstep(0.3, 4.4, t), ko = smootherstep(5.4, 9.0, t);
      Pc = lerpP(lerpP(CHILD, GROWN, kg), OLD, ko);
      childOff = lerp(0.22, 0.32, kg);
      Pp = lerpP(ADULT, PARENT_OLD, smoothstep(0.0, 3.4, t));
    }
    const offP = -0.27;
    const placeP = this._place(offP, 0.0), placeC = this._place(childOff, 0.0);
    // child
    const Jc = bodyJoints(Pc);
    const hugL = armSpec(Jc, Pc, 'L', 'hug'); solveArm(Jc, Pc, 'L', hugL);
    let specR = armSpec(Jc, Pc, 'R', 'hug');
    if (pointK > 0) { const pt = armSpec(Jc, Pc, 'R', 'point'); specR = { t: V.lerp(specR.t, pt.t, pointK), pole: V.lerp(specR.pole, pt.pole, pointK) }; }
    solveArm(Jc, Pc, 'R', specR);
    // parent: left arm supports behind, right arm around the child's far shoulder
    const Jp = bodyJoints(Pp);
    solveArm(Jp, Pp, 'L', armSpec(Jp, Pp, 'L', 'lean'));
    const dy = placeC.y - placeP.y;
    const tgt = V.add(Jc.shR, [childOff - offP, dy + 0.025, 0.035]);
    solveArm(Jp, Pp, 'R', { t: tgt, pole: V.add(Jp.shR, [0.05, -0.30, 0.25]) });
    this.parent.evaluate(bodyPrims(Jp, Pp, 'bun'), placeP);
    this.child.evaluate(bodyPrims(Jc, Pc, 'tail'), placeC);
    return { placeP, placeC, Jc, Pc };
  }

  _figUniforms(t, T) {
    for (const f of [this.parent, this.child]) { f.U.uT.value = t; f.U.uTime.value = T; f.U.uDisStart.value = 1e9; f.U.uPulse.value = 0; f.U.uBright.value = 0.30; }
  }

  // ------------------------------------------------------------ hand
  _buildHand() {
    const sk = handSkeleton();
    this.handSk = sk;
    const sdf = makeHandSDF(sk);
    const smp = sampleHand(sdf, sk, 300000, 2024);
    const n = smp.pos.length / 3;
    const R = new Rand(555);
    const rnd = new Float32Array(n * 4); for (let i = 0; i < rnd.length; i++) rnd[i] = R.next();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(smp.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(smp.nrm, 3));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    g.setAttribute('aFade', new THREE.BufferAttribute(smp.fade, 1));
    g.setAttribute('aNail', new THREE.BufferAttribute(smp.nail, 1));
    g.setAttribute('aAO', new THREE.BufferAttribute(smp.ao, 1));
    this.handCount = n;

    // hand orientation in world: fingers up-left, away; back of the hand toward camera
    const Y = V.norm([-0.30, 1.0, -0.32]);
    const Z0 = V.norm([0.30, 0.10, 1.0]);
    const X = V.norm(V.cross(Y, Z0)); const Z = V.cross(X, Y);
    this.handBase = new THREE.Matrix4().makeBasis(new THREE.Vector3(...X), new THREE.Vector3(...Y), new THREE.Vector3(...Z));
    this.handDir = new THREE.Vector3(...Y);
    this.handGroup = new THREE.Group(); this.handGroup.matrixAutoUpdate = false;
    this.sceneHand.add(this.handGroup);
    const tipL = sk.fingerData[0].tip;
    this.tipLocal = new THREE.Vector3(tipL[0], tipL[1], tipL[2]).addScaledVector(new THREE.Vector3(...sk.fingerData[0].d), -0.004);
    this.tip0 = this.tipLocal.clone().applyMatrix4(this.handBase);

    this.handU = {
      uTime: { value: 0 }, uSize: { value: 1.8 * this.uScale }, uBright: { value: 0.72 }, uFocus: { value: 2 }, uCoC: { value: 70 * this.uScale }, uBias: { value: 0.0015 },
      uL: { value: new THREE.Vector3(-0.55, 0.65, 0.55).normalize() },
      uWarm: { value: new THREE.Vector3(1.0, 0.50, 0.23) }, uWarm2: { value: new THREE.Vector3(0.72, 0.17, 0.06) }, uRim: { value: new THREE.Vector3(0.42, 0.60, 1.0) },
      uOcc: { value: 2.6 * this.uScale }, uInset: { value: 0.0012 },
      uColor: { value: new THREE.Vector3(0.055, 0.022, 0.007) },
    };
    const glow = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: HAND_VERT, fragmentShader: FIG_FRAG, uniforms: this.handU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true }));
    const occ = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: HAND_OCC_VERT, fragmentShader: HOCC_FRAG, uniforms: this.handU }));
    glow.frustumCulled = occ.frustumCulled = false; occ.renderOrder = 3; glow.renderOrder = 5;
    this.handGroup.add(occ); this.handGroup.add(glow);

    // fingertip glow (the atom)
    this.tipU = { uSize: { value: 26 }, uScale: { value: this.uScale }, uCol: { value: new THREE.Vector3() } };
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([this.tipLocal.x, this.tipLocal.y, this.tipLocal.z]), 3));
    const tp = new THREE.Points(tg, new THREE.ShaderMaterial({ vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG, uniforms: this.tipU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    tp.frustumCulled = false; tp.renderOrder = 8;
    this.handGroup.add(tp);

    // background: blurred sky glow
    this.hbgU = { uTime: { value: 0 }, uShift: { value: 0 } };
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: HANDBG_VERT, fragmentShader: HANDBG_FRAG, uniforms: this.hbgU, depthWrite: false, depthTest: false }));
    bg.frustumCulled = false; bg.renderOrder = -10;
    this.sceneHand.add(bg);

    // camera reference for placing bokeh
    this._setHandCam(7);
    const BR = new Rand(31337);
    const NB = 95;
    const bp = new Float32Array(NB * 3), bc = new Float32Array(NB * 3), bs = new Float32Array(NB), bseed = new Float32Array(NB);
    const pal = [[0.55, 0.70, 1.0], [0.70, 0.80, 1.0], [0.85, 0.88, 1.0], [1.0, 0.80, 0.55], [1.0, 0.62, 0.32], [0.45, 0.80, 0.95], [0.80, 0.55, 0.90]];
    const palW = [0.24, 0.22, 0.16, 0.15, 0.11, 0.07, 0.05];
    for (let i = 0; i < NB; i++) {
      let sx = BR.range(-0.08, 1.08), sy = BR.range(-0.1, 1.1);
      // denser along the blurred galactic band
      if (BR.next() < 0.55) { const u = BR.next(); sx = lerp(-0.05, 1.05, u); sy = 1 - (0.12 + 0.62 * sx) + BR.gauss() * 0.13; }
      const d = this.dirFromScreen(this.camHand, sx, sy);
      const p = this.camHand.position.clone().addScaledVector(d, 60);
      bp.set([p.x, p.y, p.z], i * 3);
      let r = BR.next(), ci = 0; while (ci < pal.length - 1 && r > palW[ci]) { r -= palW[ci]; ci++; }
      const br = 0.018 + 0.20 * Math.pow(BR.next(), 3.2);
      const c = pal[ci];
      bc.set([c[0] * br, c[1] * br, c[2] * br], i * 3);
      bs[i] = BR.next() < 0.10 ? BR.range(190, 250) : BR.range(95, 140);
      bseed[i] = BR.next();
    }
    const bgG = new THREE.BufferGeometry();
    bgG.setAttribute('position', new THREE.BufferAttribute(bp, 3)); bgG.setAttribute('aCol', new THREE.BufferAttribute(bc, 3));
    bgG.setAttribute('aSize', new THREE.BufferAttribute(bs, 1)); bgG.setAttribute('aSeed', new THREE.BufferAttribute(bseed, 1));
    this.bokehU = { uScale: { value: this.uScale }, uTime: { value: 0 }, uGain: { value: 1 } };
    const bk = new THREE.Points(bgG, new THREE.ShaderMaterial({ vertexShader: BOKEH_VERT, fragmentShader: BOKEH_FRAG, uniforms: this.bokehU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true }));
    bk.frustumCulled = false; bk.renderOrder = 1;
    this.sceneHand.add(bk);

    // floating motes near the hand (out of focus specks)
    const NM = 260;
    const mp = new Float32Array(NM * 3), mr = new Float32Array(NM * 4);
    const MR = new Rand(77);
    for (let i = 0; i < NM; i++) {
      const p = this.tip0.clone().add(new THREE.Vector3(MR.range(-0.35, 0.35), MR.range(-0.25, 0.20), MR.range(-0.5, 0.9)));
      mp.set([p.x, p.y, p.z], i * 3);
      for (let j = 0; j < 4; j++) mr[i * 4 + j] = MR.next();
    }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mg.setAttribute('aRnd', new THREE.BufferAttribute(mr, 4));
    this.moteU = { uTime: { value: 0 }, uScale: { value: this.uScale }, uFocus: { value: 2 }, uCoC: { value: 70 * this.uScale }, uBright: { value: 0.05 } };
    const motes = new THREE.Points(mg, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: this.moteU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true }));
    motes.frustumCulled = false; motes.renderOrder = 6;
    this.sceneHand.add(motes);
  }

  _setHandCam(t) {
    const cam = this.camHand;
    const dist = lerp(1.42, 1.27, easeInOutSine(clamp(t / 14)));
    const toCam = new THREE.Vector3(0.10, -0.22, 1.0).normalize();
    cam.position.copy(this.tip0).addScaledVector(toCam, dist);
    const f = this.tip0.clone().sub(cam.position).normalize();
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, f);
    const tanV = Math.tan(HAND_FOV * DEG / 2), tanH = tanV * this.ctx.aspect;
    const sx = 0.42, sy = 0.30;
    const aim = this.tip0.clone().addScaledVector(right, -(sx * 2 - 1) * tanH * dist).addScaledVector(up, -(1 - sy * 2) * tanV * dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(aim);
    cam.updateMatrixWorld(true);
    return dist;
  }

  _handPose(t) {
    // breathing sway about the elbow + a slow reach upward
    const pivot = this.handDir.clone().multiplyScalar(-0.27);
    const rx = 0.010 * Math.sin(t * Math.PI * 2 / 4.6) + 0.004 * Math.sin(t * 1.7 + 0.5);
    const rz = 0.012 * Math.sin(t * Math.PI * 2 / 5.9 + 1.0) + 0.003 * Math.sin(t * 2.3);
    const reach = 0.012 * smoothstep(0, 14, t);
    const M = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
      .multiply(new THREE.Matrix4().makeTranslation(this.handDir.x * reach, this.handDir.y * reach, this.handDir.z * reach))
      .multiply(this.handBase);
    this.handGroup.matrix.copy(M);
    this.handGroup.matrixWorld.copy(M);
    this.handGroup.updateMatrixWorld(true);
    return this.tipLocal.clone().applyMatrix4(M);
  }

  // ------------------------------------------------------------ per-frame
  update(shot, t, T) {
    const mode = shot.mode || 'wide';
    if (mode === 'hand') return this._updateHand(t, T);
    return this._updateWide(mode, t, T);
  }

  _updateWide(mode, t, T) {
    const life = mode === 'lifetime';
    const tc = life ? clamp(t, -0.5, 14.5) : clamp(t, -0.5, 11.5);
    this.setWideCam(life ? 0.34 : 0.05 + 0.55 * clamp(tc / 11, 0, 1.05));
    // sky rotation (time-lapse)
    let ang = 0, len = 0;
    if (life) {
      const k = Math.max(0, tc) / 14;
      ang = -8.4 * Math.pow(k, 1.8);
      len = Math.min(Math.abs(ang), Math.PI * 2 - 1e-3);
    }
    const sgnLen = len;
    this.domeU.uAng.value = ang; this.domeU.uLen.value = -sgnLen;
    this.domeU.uGain.value = 0.30 * (1 - 0.35 * smoothstep(0, 2.5, len));
    this.trailU.uGain.value = 0.85;
    this.domeU.uSmear.value = len > 0 ? Math.max(0, Math.log2(len * (MW_W / (Math.PI * 2)) / 10) - 1.0) : 0;
    this.starU.uRot.value.setFromMatrix4(new THREE.Matrix4().makeRotationAxis(this.pole, ang));
    this.starU.uTime.value = T;
    this.starU.uTwinkle.value = life ? 0.05 : 0.12;
    this.starU.uFaint.value = life ? 1 - 0.92 * smoothstep(0.0, 0.18, len) : 1;
    this.trails.visible = life && len > 1e-3;
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search); const off = (q.get('off') || '').split(',');
      if (q.get('nostars') || off.includes('stars')) { this.starPts.visible = false; }
      if (off.includes('trails')) this.trails.visible = false;
      this._dbgOff = off;
      this.sceneWide.traverse(o => { if (o.name) o.visible = !off.includes(o.name); });
    }
    this.trailU.uAng.value = ang; this.trailU.uLen.value = -len; // trail extends backwards in time (opposite to motion)
    this.grassU.uTime.value = T;

    // figures
    this._figUniforms(tc, T);
    const pose = this._poseFigures(mode, tc);
    const dbg = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hz');
    if (dbg) { // debug: orbit a close camera around the pair
      const [dist, yawd] = dbg.split(',').map(Number);
      const c = this.camWide, ctr = new THREE.Vector3(this.gx, this.gy + 0.45, ZC);
      const base = new THREE.Vector3(0, 0, 0).sub(ctr).setY(0).normalize();
      base.applyAxisAngle(new THREE.Vector3(0, 1, 0), (yawd || 0) * DEG);
      c.position.copy(ctr).addScaledVector(base, dist).add(new THREE.Vector3(0, 0.25, 0));
      c.lookAt(ctr); c.updateMatrixWorld(true);
    }
    if (life) {
      const P = this.parent.U, C = this.child.U;
      P.uDisStart.value = 3.0; P.uDisSpan.value = 2.6; P.uDisMode.value = 0;
      C.uDisStart.value = 9.5; C.uDisSpan.value = 2.4; C.uDisMode.value = 1;
      C.uCenter.value.set(pose.placeC.x, pose.placeC.y + 0.4, pose.placeC.z);
      // heartbeat: 72 → 40 bpm until t = 9, then stillness
      if (tc < 9) {
        const ph = (72 * tc - 16 * tc * tc / 9) / 60;
        const x = ph - Math.floor(ph);
        const beat = Math.exp(-x * 16) + 0.55 * (x > 0.16 ? Math.exp(-(x - 0.16) * 16) : 0);
        C.uPulse.value = 0.10 * beat * (1 - smoothstep(7.5, 9, tc) * 0.5);
      } else {
        C.uBright.value = 0.30 * (1 - 0.18 * smoothstep(9.0, 9.4, tc));
      }
    }
    const exposure = life ? lerp(1.0, 0.8, smoothstep(10, 14, tc)) : 1.0;
    return {
      scene: this.sceneWide, camera: this.camWide, target: null,
      post: {
        exposure, bloomStrength: 0.62, bloomThreshold: 0.7, bloomKnee: 0.5, bloomRadius: 0.82,
        streak: 0.06, streakTint: [0.6, 0.75, 1.0], ca: life ? 0.0009 : 0.0014, vignette: 0.42, grain: 0.05,
        saturation: 1.08, contrast: 1.04, tint: [0.95, 0.98, 1.05], lift: [0.0, 0.0008, 0.003],
        fade: life ? smoothstep(12.9, 14.0, tc) : 0,
      },
    };
  }

  _updateHand(t, T) {
    const tc = clamp(t, -0.5, 14.5);
    const dist = this._setHandCam(tc);
    const tip = this._handPose(tc);
    const cam = this.camHand;
    const tipView = tip.clone().applyMatrix4(cam.matrixWorldInverse);
    this.handU.uFocus.value = -tipView.z;
    this.handU.uTime.value = T;
    this.moteU.uTime.value = T; this.moteU.uFocus.value = -tipView.z;
    this.bokehU.uTime.value = T;
    this.hbgU.uTime.value = T;
    // the atom: a soft glow kindles at the fingertip when the reticle locks (local t = 4)
    const k = smoothstep(3.7, 4.6, tc);
    const pulse = Math.exp(-Math.max(0, tc - 4.0) * 2.5) * (tc > 4 ? 1 : 0);
    const g = 0.10 * k + 0.5 * pulse;
    this.tipU.uCol.value.set(1.0 * g, 0.80 * g, 0.55 * g);
    return {
      scene: this.sceneHand, camera: cam, target: tip,
      post: {
        exposure: 1.0, bloomStrength: 0.7, bloomThreshold: 0.65, bloomKnee: 0.5, bloomRadius: 0.85,
        streak: 0.05, streakTint: [0.6, 0.75, 1.0], ca: 0.0013, vignette: 0.5, grain: 0.05,
        saturation: 1.06, contrast: 1.03, tint: [0.96, 0.98, 1.04], lift: [0.0, 0.0006, 0.0025],
      },
    };
  }

  dispose() {
    this.mwRT?.dispose();
    for (const s of [this.sceneWide, this.sceneHand]) s?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}
