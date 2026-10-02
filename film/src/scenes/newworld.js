// #18 未命名的世界 · UNNAMED WORLD — dawn on an alien sea, two suns rising, and a tiny new
// luminous life form in the shallows where our atom is reacquired.
// Environment (sky + sea + shore) is one full-screen ray pass; the life form is real geometry.
import * as THREE from '../../vendor/three.module.js';
import { hash } from '../lib/glsl.js';
import { Rand } from '../lib/random.js';
import { clamp, lerp, smoothstep, smootherstep, easeInOutSine, easeInOutCubic } from '../lib/ease.js';
import { bakeTexture, periodicNoise } from '../lib/texbake.js';

const D2R = Math.PI / 180;
const LIFE = new THREE.Vector3(0.18, 0, 0);          // base of the life form (world, metres)
const STEM_H = 0.135;

// ------------------------------------------------------------------ bakes
const BAKE_WATER_N = periodicNoise + /* glsl */`
varying vec2 vUv;
float H(vec2 p){ return pfbm(p, 8.0) * 0.7 + pfbm(p*vec2(1.0, 2.0) + 3.1, 8.0) * 0.3; }
void main(){
  vec2 p = vUv*8.0; float e = 8.0/512.0;
  float h = H(p), hx = H(p + vec2(e, 0.0)), hy = H(p + vec2(0.0, e));
  vec2 g = vec2(hx - h, hy - h) / e;
  gl_FragColor = vec4(g*0.12 + 0.5, h, 1.0);
}`;

const BAKE_CLOUD = periodicNoise + /* glsl */`
varying vec2 vUv;
void main(){
  vec2 p = vUv*4.0;
  float w = pfbm(p*1.0 + 7.0, 4.0);
  float streak = pfbm(vec2(p.x*1.0 + w*2.2, p.y*2.0 + w*1.4), 4.0);     // wispy cirrus strands
  float puff = pfbm(p*3.0 + w*2.0, 12.0);
  gl_FragColor = vec4(streak, puff, w, 1.0);
}`;

// ------------------------------------------------------------------ environment
const ENV_VERT = /* glsl */`void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const ENV_FRAG = hash + /* glsl */`
uniform sampler2D tNorm, tCloud;
uniform vec3 uCamPos; uniform mat4 uInvVP; uniform vec2 uRes;
uniform vec3 uSun1, uSun2, uLifeBase, uLifeTip, uPlanet;
uniform float uTime, uDawn, uLifeGlow;

const vec3 ZEN = vec3(0.010, 0.010, 0.050);
const vec3 MID = vec3(0.060, 0.030, 0.17);
const vec3 HOR = vec3(0.70, 0.30, 0.25);

float az(vec3 d){ return atan(d.x, -d.z); }

vec3 skyBase(vec3 d){
  float e = max(d.y, 0.0);
  float h = exp(-e*22.0);
  vec3 c = mix(ZEN, MID, exp(-e*7.0));
  c = mix(c, vec3(0.30, 0.09, 0.24), exp(-e*14.0)*0.85);    // rose-magenta band
  c = mix(c, HOR, h);
  float s1 = max(dot(d, uSun1), 0.0), s2 = max(dot(d, uSun2), 0.0);
  c += vec3(0.70, 0.30, 0.08) * pow(s1, 16.0) * (0.15 + 0.85*h);     // sunrise sky (~17 deg), golden toward the horizon
  c += vec3(0.95, 0.42, 0.14) * pow(s1, 350.0) * 0.65;               // aureole (~4 deg)
  c += vec3(3.0, 1.6, 0.6) * pow(s1, 9000.0) * 1.0;                  // corona
  c += vec3(0.12, 0.17, 0.36) * pow(s2, 40.0) * 0.5;
  c += vec3(0.6, 0.8, 1.3) * pow(s2, 2500.0) * 0.6;
  return c * uDawn;
}
// sun discs (HDR), cut by the horizon
vec3 suns(vec3 d){
  // small-angle form: angle^2 ~= 2(1 - cos) (no acos)
  float a1 = 2.0*(1.0 - dot(d, uSun1)), a2 = 2.0*(1.0 - dot(d, uSun2));
  float r1 = 0.95*0.01745, r2 = 0.42*0.01745;
  float k1 = smoothstep(r1*r1, r1*r1*0.865, a1), k2 = smoothstep(r2*r2, r2*r2*0.72, a2);
  float limb1 = 0.65 + 0.35*sqrt(max(0.0, 1.0 - a1/(r1*r1)));
  float ext = smoothstep(-0.01, 0.06, d.y);                 // horizon reddening
  vec3 c1 = mix(vec3(6.0, 2.2, 0.55), vec3(7.5, 4.2, 1.6), ext) * limb1;
  vec3 c2 = vec3(6.0, 7.5, 11.0);
  return c1*k1 + c2*k2;
}
vec4 clouds(vec3 d){
  if (d.y < 0.004) return vec4(0.0);
  vec2 uv = d.xz / (d.y + 0.02) * 0.11 + vec2(uTime*0.0016, uTime*0.0004);
  vec3 n = texture2D(tCloud, uv).rgb;
  float n2 = texture2D(tCloud, uv*2.7 + vec2(0.31, 0.77)).g;
  float band = smoothstep(0.010, 0.05, d.y) * (1.0 - smoothstep(0.12, 0.40, d.y));
  float cover = smoothstep(0.50, 0.68, texture2D(tCloud, uv*0.17 + 0.5).b);
  float dens = smoothstep(0.58, 0.88, n.r*0.8 + n2*0.35) * band * cover;
  float s1 = max(dot(d, uSun1), 0.0);
  float fw = pow(s1, 10.0), fw2 = pow(s1, 250.0);
  vec3 under = mix(vec3(0.30, 0.12, 0.40), vec3(1.4, 0.55, 0.40), exp(-d.y*12.0));
  vec3 lit = mix(under*0.45, vec3(1.1, 0.48, 0.24), fw) + vec3(1.2, 0.62, 0.26)*fw2;
  float edge = smoothstep(0.55, 0.75, n.r*0.8 + n2*0.35) - smoothstep(0.75, 0.95, n.r*0.8 + n2*0.35);
  lit += vec3(0.9, 0.45, 0.35) * edge * (0.25 + 1.6*fw);
  return vec4(lit * dens * uDawn, dens*0.85);
}
// distant headlands on the right horizon (elevation profile in radians)
float ridge(float a, float s){
  float x = a*s;
  float n = sin(x*1.0)*0.5 + sin(x*2.3+1.3)*0.25 + sin(x*5.1+0.7)*0.12 + sin(x*11.7+2.1)*0.06;
  return n;
}
vec4 lands(vec3 d){
  float a = az(d);
  float e = d.y;
  // far range
  float m1 = (0.010 + 0.006*ridge(a, 9.0)) * smoothstep(0.17, 0.30, a) * (1.0 - smoothstep(0.95, 1.2, a));
  m1 += 0.020 * pow(max(0.0, sin(a*48.0 + 0.5)), 30.0) * smoothstep(0.35, 0.5, a);   // alien spires
  // nearer headland
  float m2 = (0.006 + 0.004*ridge(a, 23.0)) * smoothstep(0.30, 0.42, a) * (1.0 - smoothstep(1.1, 1.3, a));
  vec3 hz = HOR * uDawn;
  vec4 r = vec4(0.0);
  if (e < m1) { r = vec4(mix(hz, vec3(0.30, 0.14, 0.30)*uDawn, 0.45) + vec3(0.25,0.10,0.06)*uDawn*smoothstep(m1-0.002, m1, e), 1.0); }
  if (e < m2) { r = vec4(mix(hz, vec3(0.12, 0.06, 0.14)*uDawn, 0.72), 1.0); }
  return r;
}
vec4 planet(vec3 d){
  // a giant pale ringed world, half-lost in the dawn air: returns (added light, sky occlusion)
  vec3 P = normalize(uPlanet);
  float c = dot(d, P);
  if (c < 0.985) return vec4(0.0);
  vec3 ax = normalize(cross(vec3(0.0,1.0,0.0), P)), ay = cross(P, ax);   // ax points screen-left
  vec2 q = vec2(dot(d, ax), dot(d, ay)) / 0.058;
  float r = length(q);
  vec2 rq = mat2(0.96, 0.28, -0.28, 0.96) * q;
  float re = length(rq*vec2(1.0, 4.6));
  float ring = smoothstep(1.35, 1.55, re) * (1.0 - smoothstep(1.9, 2.25, re)) * (0.7 + 0.3*sin(re*28.0));
  vec3 col = vec3(0.0); float occ = 0.0;
  if (r < 1.0) {
    vec3 n = vec3(q, sqrt(1.0 - r*r));
    vec3 L = normalize(vec3(0.80, -0.25, -0.35));            // suns low on the left and slightly behind -> crescent
    float lam = clamp(dot(n, L), 0.0, 1.0);
    float bands = 0.85 + 0.15*sin(q.y*16.0 + sin(q.x*4.0)*0.7);
    float limb = smoothstep(1.0, 0.96, r);
    col = vec3(1.0, 0.78, 0.74) * pow(lam, 0.8) * bands * 0.42 * limb;
    occ = 0.10 * limb;
    if (rq.y > 0.0) ring = 0.0;                               // far half of the ring behind the disc
  }
  col += vec3(0.95, 0.75, 0.80) * ring * 0.05;
  return vec4(col * uDawn, occ);
}
vec3 stars(vec3 d){
  if (d.y < 0.05) return vec3(0.0);
  vec2 sp = vec2(az(d)*180.0, d.y*190.0);
  vec2 cell = floor(sp); vec2 f = fract(sp) - 0.5;
  float h = hash12(cell);
  float s = step(0.985, h) * exp(-dot(f, f)*40.0) * (h - 0.985) * 120.0;
  return vec3(0.8, 0.85, 1.0) * s * smoothstep(0.05, 0.3, d.y) * 0.5;
}

vec3 skyFull(vec3 d, bool withExtras){
  vec3 c = skyBase(d);
  if (withExtras) { c += stars(d) * (1.0 - smoothstep(0.0, 16.0, uTime)*0.6); vec4 pl = planet(d); c = c*(1.0 - pl.a) + pl.rgb; }
  vec4 cl = clouds(d);
  c = c*(1.0 - cl.a) + cl.rgb;
  c += suns(d) * (1.0 - cl.a*0.8);
  if (withExtras) { vec4 l = lands(d); c = mix(c, l.rgb, l.a); }
  return c;
}

// seabed/shore height (metres; >0 is land). Shoreline runs diagonally from the right foreground to the horizon.
float ground(vec2 xz){
  float xs = 0.62 + 0.20*(-xz.y) + 0.05*sin(xz.y*1.3) + 0.02*sin(xz.y*4.1 + 1.0) + 0.36*smoothstep(-1.6, 0.6, xz.y);
  float g = (xz.x - xs) * 0.07;
  g += 0.004*sin(xz.x*9.0 + xz.y*5.0) + 0.003*sin(xz.x*23.0 - xz.y*17.0);
  return g;
}

vec2 waves(vec2 p, float dist){
  vec2 g = vec2(0.0);
  float t = uTime;
  // (dir angle, wavelength m, steepness)
  #define WAVE(ang, L, st, ph) { vec2 dr = vec2(cos(ang), sin(ang)); float k = 6.2832/L; float w = sqrt(9.8*k); float fade = 1.0 - smoothstep(L*12.0, L*60.0, dist); g += dr * st * cos(k*dot(dr, p) - w*t + ph) * fade; }
  WAVE(1.45, 5.0, 0.040, 0.0)
  WAVE(1.85, 2.3, 0.045, 1.7)
  WAVE(1.20, 1.2, 0.050, 4.1)
  WAVE(2.20, 0.55, 0.050, 2.3)
  WAVE(0.95, 0.27, 0.045, 5.2)
  WAVE(1.60, 0.13, 0.040, 0.9)
  return g;
}

void main(){
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec4 w4 = uInvVP * vec4(ndc, 1.0, 1.0);
  vec3 d = normalize(w4.xyz / w4.w - uCamPos);
  vec3 col;
  if (d.y >= 0.0) {
    col = skyFull(d, true);
    // low sea-mist glow just above the horizon
    col += HOR * uDawn * 0.18 * exp(-d.y*90.0);
  } else {
    float tw = -uCamPos.y / d.y;
    vec3 P = uCamPos + d*tw;
    float dist = tw;
    vec2 xz = P.xz;
    float gH = ground(xz);
    // wave run-up: the waterline breathes in and out
    float run = 0.0035*sin(uTime*1.15 + xz.y*0.9) + 0.002*sin(uTime*0.63 - xz.y*2.1 + 1.0);
    float depth = -(gH - run);                       // >0 under water
    // normals
    vec2 g = waves(xz, dist);
    float dfade = 1.0 - smoothstep(3.0, 40.0, dist);
    vec2 dn = (texture2D(tNorm, xz*0.85 + uTime*vec2(0.020, 0.012)).rg - 0.5)
            + (texture2D(tNorm, xz*2.1 + vec2(0.37, 0.11) - uTime*vec2(0.008, 0.031)).rg - 0.5)*0.8;
    g += dn * 0.45 * dfade;
    // ripples spreading from the life form
    vec2 rv = xz - uLifeBase.xz; float rr = length(rv) + 1e-4;
    g += (rv/rr) * cos(rr*95.0 - uTime*3.2) * exp(-rr*9.0) * 0.12;
    float calm = smoothstep(0.0, 0.03, depth);       // very shallow water is calmer
    g *= mix(0.35, 1.0, calm);
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    float cosv = max(dot(n, -d), 0.0);
    float fres = 0.02 + 0.98*pow(1.0 - cosv, 5.0);
    vec3 r = reflect(d, n); r.y = abs(r.y) + 0.002;
    vec3 refl = skyFull(r, false);
    // broad glitter lobes under the suns
    refl += vec3(4.0, 1.9, 0.6) * pow(max(dot(r, uSun1), 0.0), 3000.0) * 1.4 * uDawn;
    refl += vec3(1.6, 2.0, 2.8) * pow(max(dot(r, uSun2), 0.0), 6000.0) * 1.4 * uDawn;
    // the life form's light mirrored in the water
    if (abs(xz.x - uLifeBase.x) < 0.3 && xz.y > uLifeBase.z - 0.25 && dist < 3.0) {
      vec3 a = uLifeBase, b = uLifeTip;
      // distance from reflected ray (origin P) to segment a-b
      vec3 ba = b - a; vec3 oa = P - a;
      float bb = dot(ba, ba), rb = dot(r, ba), ob = dot(oa, ba), ro = dot(r, oa);
      float den = bb - rb*rb;
      float s = clamp((ob - rb*ro) / max(den, 1e-6), 0.0, 1.0);
      vec3 q = a + ba*s;
      float tq = max(dot(q - P, r), 0.0);
      float dd = length(P + r*tq - q);
      float wd = 0.00008 + 0.0006*tq;
      float glow = exp(-dd*dd / wd) * (0.15 + 1.0*s*s*s) + exp(-dd*60.0)*0.08*s;
      refl += mix(vec3(0.2, 1.0, 1.0), vec3(1.8, 1.2, 0.6), s) * glow * uLifeGlow * 0.55;
    }
    // what lies beneath: shallow seabed with bioluminescent specks
    float path = max(depth, 0.0) / max(-d.y, 0.05);
    vec3 trans = exp(-path * vec3(9.0, 3.2, 2.2));
    vec3 bedCol = vec3(0.10, 0.06, 0.10) * (0.7 + 0.6*texture2D(tNorm, xz*0.6).b) * uDawn;
    vec2 sc = xz * 70.0; vec2 cell = floor(sc); vec2 f = fract(sc) - 0.5;
    float hs = hash12(cell);
    float pulse = 0.5 + 0.5*sin(uTime*1.7 + hs*40.0);
    vec2 jit = vec2(hash12(cell + 17.0), hash12(cell + 41.0)) - 0.5;
    float speck = step(0.955, hs) * exp(-dot(f - jit*0.6, f - jit*0.6)*140.0) * pulse * pulse * (0.3 + 1.4*fract(hs*97.0));
    float near = exp(-length(xz - uLifeBase.xz)*1.5);
    bedCol += vec3(0.15, 1.3, 1.5) * speck * (0.6 + 2.0*near) * (1.0 - smoothstep(0.0, 0.25, depth)) * 1.4;
    vec3 deep = vec3(0.025, 0.03, 0.07) * uDawn + HOR*0.05*uDawn;
    vec3 under = bedCol*trans + deep*(1.0 - trans);
    vec3 water = refl*fres + under*(1.0 - fres);
    float lp = length(xz - uLifeBase.xz);
    water += vec3(0.15, 0.75, 0.75) * exp(-lp*lp*600.0) * 0.16 * uLifeGlow + vec3(0.6, 0.5, 0.3) * exp(-lp*lp*80.0) * 0.04 * uLifeGlow;
    // shore: wet sand mirror -> dry sand
    col = water;
    float wet = smoothstep(0.0, 0.004, -depth);
    if (wet > 0.0) {
      float grain = texture2D(tNorm, xz*1.7).b;
      float dry = smoothstep(0.006, 0.03, -depth + 0.012*(grain - 0.5));
      float sunGraze = 0.35 + 0.65*max(dot(normalize(vec3(-0.5, 0.25, -0.6)), uSun1), 0.0);
      vec3 sand = vec3(0.045, 0.034, 0.045) * (0.7 + 0.6*grain) * sunGraze * uDawn;
      vec3 wetC = refl * (0.18 + 0.75*fres) + sand*0.5;
      vec3 land = mix(wetC, sand + skyBase(r) * (0.03 + 0.25*fres) * (1.0 - grain*0.5), dry);
      col = mix(water, land, wet);
    }
    // bioluminescent tide at the waterline, flickering glints
    float line = exp(-pow((depth)/0.0022, 2.0));
    if (line > 0.002 && dist < 30.0) {
      line *= 0.35 + 0.65*smoothstep(0.35, 0.75, texture2D(tNorm, xz*vec2(0.5, 0.25) + vec2(0.0, uTime*0.01)).b);
      vec2 gc = vec2(xz.x*70.0, xz.y*70.0 + uTime*0.4); vec2 gi = floor(gc); vec2 gf = fract(gc) - 0.5;
      float gh = hash12(gi);
      vec2 gj = vec2(hash12(gi + 7.0), hash12(gi + 13.0)) - 0.5;
      float glint = step(0.6, gh) * exp(-dot(gf - gj*0.5, gf - gj*0.5)*30.0) * pow(0.5 + 0.5*sin(uTime*2.6 + gh*40.0), 2.0);
      float foamBreath = 0.6 + 0.4*sin(uTime*1.15 + xz.y*0.9 + 1.2);
      col += vec3(0.10, 0.95, 1.10) * line * (0.22 + 3.0*glint) * foamBreath * (1.0 - smoothstep(4.0, 30.0, dist)) * 1.0;
    }
    // distance haze into the horizon glow
    float fog = 1.0 - exp(-dist * 0.010);
    col = mix(col, skyBase(normalize(vec3(d.x, 0.0, d.z))) * 0.95, fog);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ life form
const LIFE_VERT = /* glsl */`
attribute float aS; attribute float aPart;
uniform float uTime;
varying float vS; varying vec3 vN; varying vec3 vW; varying float vPart;
vec3 sway(vec3 p, float s){
  float a = s*s;
  return p + vec3(sin(uTime*0.8 + s*1.6)*0.0045 + sin(uTime*1.9 + s*4.0)*0.0012, 0.0, cos(uTime*0.6 + s*1.1)*0.0030) * a;
}
void main(){
  vS = aS; vPart = aPart;
  vec3 p = sway(position, aS);
  vN = normalize(normalMatrix * normal);
  vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LIFE_FRAG = /* glsl */`
uniform float uTime, uGlow;
uniform vec3 uCamPos;
varying float vS; varying vec3 vN; varying vec3 vW; varying float vPart;
void main(){
  vec3 V = normalize(uCamPos - vW);
  vec3 N = normalize(vN);
  float rim = pow(1.0 - abs(dot(N, normalize((viewMatrix*vec4(V,0.0)).xyz))), 2.0);
  float s = vS;
  vec3 base = vec3(0.05, 0.45, 0.55);
  vec3 mid = vec3(0.30, 1.50, 1.50);
  vec3 tip = vec3(3.2, 2.1, 0.95);
  vec3 c = mix(base, mid, smoothstep(0.0, 0.6, s));
  c = mix(c, tip, smoothstep(0.75, 1.0, s));
  c *= 0.45 + 0.55*rim;
  // light pulses travelling up toward the tip
  float flow = pow(0.5 + 0.5*sin(s*30.0 - uTime*2.6), 8.0);
  c += vec3(0.5, 1.4, 1.3) * flow * (0.15 + 0.7*s) * 0.6;
  c += vec3(0.15, 0.7, 0.8) * rim * (0.3 + 0.5*s);
  c *= (0.75 + 0.25*sin(uTime*1.57)) * uGlow;
  if (vPart > 0.5 && vPart < 1.5) c *= 0.7;           // side tendrils
  if (vPart > 1.5 && vPart < 2.5) {                    // seed bulb: hot gold heart, cyan skin
    c = mix(vec3(4.0, 2.7, 1.2), vec3(0.8, 1.9, 1.9), pow(rim, 1.5)) * (0.85 + 0.15*sin(uTime*1.57)) * uGlow;
  }
  if (vPart > 3.5) {                                   // seed pod: teal with glowing veins
    float vein = pow(0.5 + 0.5*sin(vW.x*900.0 + sin(vW.z*700.0)*2.0), 6.0);
    c = vec3(0.05, 0.45, 0.5) * (0.4 + rim) + vec3(0.3, 1.4, 1.3) * vein * 0.6;
    c *= uGlow;
  }
  // under water: seen faintly through the surface
  float a = 1.0;
  if (vW.y < 0.0) { float k = exp(vW.y*90.0); c *= vec3(0.3, 0.75, 0.8) * (0.25 + 0.5*k); a = 0.12 + 0.5*k*k; }
  gl_FragColor = vec4(c * a, a);
}`;
const FIL_VERT = /* glsl */`
attribute float aS; attribute float aPart;
uniform float uTime;
varying float vU; varying float vK;
void main(){
  vU = aS; vK = aPart;
  // ride along with the swaying tip, plus each filament's own slow wave
  vec3 sw = vec3(sin(uTime*0.8 + 1.6)*0.0045 + sin(uTime*1.9 + 4.0)*0.0012, 0.0, cos(uTime*0.6 + 1.1)*0.0030);
  float u = aS;
  vec3 wave = vec3(sin(uTime*1.1 + u*3.0 + aPart*1.7), sin(uTime*0.9 + aPart)*0.4, cos(uTime*0.8 + u*2.5 + aPart*2.3)) * 0.004 * u * u;
  vec3 p = position + sw + wave;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}`;
const FIL_FRAG = /* glsl */`
uniform float uTime, uGlow;
varying float vU; varying float vK;
void main(){
  float fade = pow(1.0 - vU, 1.4) * smoothstep(0.0, 0.08, vU);
  float bead = pow(0.5 + 0.5*sin(vU*22.0 - uTime*2.2 + vK*1.3), 10.0);
  vec3 c = mix(vec3(2.4, 1.7, 0.9), vec3(0.6, 1.6, 1.7), vU) * (0.35 + 1.6*bead) * fade;
  gl_FragColor = vec4(c * uGlow * 0.9, 1.0);
}`;
const GLOW_VERT = /* glsl */`
attribute vec4 iData;   // size, intensity, kind, phase
attribute vec3 iPos;
uniform float uTime;
varying vec2 vUv; varying vec4 vD;
void main(){
  vD = iData; vUv = position.xy * 2.0;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iData.x;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */`
uniform float uTime, uGlow; uniform vec3 uCol;
varying vec2 vUv; varying vec4 vD;
void main(){
  float r = length(vUv);
  float core = exp(-r*r*120.0);
  float halo = exp(-r*r*9.0)*0.25 + exp(-r*4.0)*0.07;
  float sx = exp(-abs(vUv.y)*90.0) * exp(-abs(vUv.x)*3.5);
  float sy = exp(-abs(vUv.x)*90.0) * exp(-abs(vUv.y)*3.5);
  float spikes = (sx + sy*0.7) * vD.z;
  float pulse = 0.85 + 0.15*sin(uTime*1.57 + vD.w);
  vec3 c = uCol * (core*6.0 + halo + spikes*0.8) * vD.y * pulse * uGlow;
  gl_FragColor = vec4(c * (1.0 - smoothstep(0.8, 1.0, r)), 1.0);
}`;
const SPORE_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime, uScale; uniform vec3 uOrigin, uDrift;
varying vec3 vCol;
void main(){
  float period = 9.0 + aSeed.w*6.0;
  float age = fract((uTime + aSeed.x*period) / period);
  vec3 p = uOrigin + vec3((aSeed.y - 0.5)*0.03, 0.0, (aSeed.z - 0.5)*0.03);
  p += uDrift * age * (0.6 + aSeed.w) + vec3(sin(uTime*0.9 + aSeed.x*20.0), 0.0, cos(uTime*0.7 + aSeed.y*20.0)) * 0.01 * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float sz = 0.0035 * 804.0 * uScale / max(-mv.z, 0.01);
  float k = clamp(sz, 0.0, 1.0);
  float life = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.6, 1.0, age));
  vCol = mix(vec3(0.4, 1.4, 1.5), vec3(2.2, 1.6, 0.9), aSeed.z) * life * k * k * (0.6 + 0.6*aSeed.y);
  gl_PointSize = clamp(sz, 1.0, 6.0*uScale);
  gl_Position = projectionMatrix * mv;
}`;
const SPORE_FRAG = /* glsl */`
varying vec3 vCol;
void main(){ vec2 d = gl_PointCoord - 0.5; float a = exp(-dot(d,d)*14.0); gl_FragColor = vec4(vCol*a, 1.0); }`;

// sway, identical to the GLSL above, so the reticle stays glued to the tip
function sway(p, s, t) {
  const a = s * s;
  return new THREE.Vector3(
    p.x + (Math.sin(t * 0.8 + s * 1.6) * 0.0045 + Math.sin(t * 1.9 + s * 4.0) * 0.0012) * a,
    p.y,
    p.z + Math.cos(t * 0.6 + s * 1.1) * 0.0030 * a);
}

// tapered tube along a curve; aS = 0 at the base .. 1 at the tip
function taperedTube(curve, segs, radial, r0, r1, part, positions, normals, sAttr, partAttr, indices, sOffset = 0, sScale = 1) {
  const frames = curve.computeFrenetFrames(segs, false);
  const base = positions.length / 3;
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const c = curve.getPointAt(u);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = lerp(r0, r1, Math.pow(u, 0.9)) * (i === segs ? 0.2 : 1);
    for (let j = 0; j <= radial; j++) {
      const v = j / radial * Math.PI * 2;
      const nx = Math.cos(v) * N.x + Math.sin(v) * B.x, ny = Math.cos(v) * N.y + Math.sin(v) * B.y, nz = Math.cos(v) * N.z + Math.sin(v) * B.z;
      positions.push(c.x + r * nx, c.y + r * ny, c.z + r * nz);
      normals.push(nx, ny, nz);
      sAttr.push(sOffset + u * sScale); partAttr.push(part);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * (radial + 1) + j, b = a + radial + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
}

export default class NewWorld {
  constructor(ctx) { this.ctx = ctx; this.uScale = ctx.height / 804; this.disposables = []; }

  async init() {
    const r = this.ctx.renderer;
    const keep = (x) => { this.disposables.push(x); return x; };
    this.normRT = keep(bakeTexture(r, 512, 512, BAKE_WATER_N, {}, { wrap: THREE.RepeatWrapping }));
    this.cloudRT = keep(bakeTexture(r, 1024, 1024, BAKE_CLOUD, {}, { wrap: THREE.RepeatWrapping }));
    const S = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, this.ctx.aspect, 0.005, 5000);
    const uTime = this.uTime = { value: 0 };
    this.uGlow = { value: 1 };

    // environment pass
    const env = this.env = keep(new THREE.ShaderMaterial({
      vertexShader: ENV_VERT, fragmentShader: ENV_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tNorm: { value: this.normRT.texture }, tCloud: { value: this.cloudRT.texture },
        uCamPos: { value: new THREE.Vector3() }, uInvVP: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(this.ctx.width, this.ctx.height) },
        uSun1: { value: new THREE.Vector3() }, uSun2: { value: new THREE.Vector3() }, uPlanet: { value: new THREE.Vector3() },
        uLifeBase: { value: LIFE.clone() }, uLifeTip: { value: new THREE.Vector3() },
        uTime, uDawn: { value: 1 }, uLifeGlow: { value: 1 },
      },
    }));
    const eg = keep(new THREE.PlaneGeometry(2, 2));
    const em = new THREE.Mesh(eg, env); em.frustumCulled = false; em.renderOrder = -100; S.add(em);

    // ---- the life form
    const P = [], Nn = [], Sa = [], Pa = [], I = [];
    const b = LIFE;
    const stem = new THREE.CatmullRomCurve3([
      new THREE.Vector3(b.x, -0.03, b.z),
      new THREE.Vector3(b.x + 0.002, 0.02, b.z + 0.001),
      new THREE.Vector3(b.x - 0.004, 0.06, b.z - 0.002),
      new THREE.Vector3(b.x - 0.014, 0.10, b.z - 0.006),
      new THREE.Vector3(b.x - 0.030, 0.128, b.z - 0.012),
      new THREE.Vector3(b.x - 0.044, STEM_H + 0.004, b.z - 0.018),
    ]);
    this.stem = stem;
    taperedTube(stem, 90, 10, 0.0034, 0.0011, 0, P, Nn, Sa, Pa, I);
    // two curling side tendrils (fiddleheads)
    const tendril = (s0, dir, len, curl, part) => {
      // fiddlehead: grows outward and up, then curls in on itself
      const o = stem.getPointAt(s0);
      const pts = [o.clone()];
      let ang = 70 * D2R, x = 0, y = 0;
      const n = 14;
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        const ds = len / n * (1.25 - 0.85 * u);
        ang -= curl / n * (0.4 + 1.6 * u);
        x += Math.cos(ang) * ds; y += Math.sin(ang) * ds;
        pts.push(new THREE.Vector3(o.x + dir * x, o.y + y, o.z - x * 0.25));
      }
      taperedTube(new THREE.CatmullRomCurve3(pts), 60, 6, 0.0013, 0.0004, part, P, Nn, Sa, Pa, I, s0 * 0.8, 0.6);
      return pts[pts.length - 1];
    };
    this.tendrilTips = [tendril(0.40, 1, 0.042, 4.8, 1), tendril(0.58, -1, 0.032, 4.4, 1)];
    // seed pod at the waterline
    {
      const sg = new THREE.SphereGeometry(1, 16, 12);
      const pp = sg.attributes.position, nn = sg.attributes.normal, base = P.length / 3;
      for (let i = 0; i < pp.count; i++) {
        P.push(b.x + pp.getX(i) * 0.008, -0.004 + pp.getY(i) * 0.0055, b.z + pp.getZ(i) * 0.007);
        Nn.push(nn.getX(i), nn.getY(i), nn.getZ(i)); Sa.push(0.15); Pa.push(4);
      }
      const idx = sg.index.array; for (let i = 0; i < idx.length; i++) I.push(base + idx[i]);
      sg.dispose();
    }
    // the seed bulb at the tip: a teardrop along the stem tangent
    {
      const tip = stem.getPointAt(1), tan = stem.getTangentAt(1).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      const sg = new THREE.SphereGeometry(1, 20, 14);
      const pp = sg.attributes.position, nn = sg.attributes.normal, base = P.length / 3;
      const v = new THREE.Vector3(), nv = new THREE.Vector3();
      for (let i = 0; i < pp.count; i++) {
        const y = pp.getY(i);
        const w = 0.0042 * (1 - 0.35 * Math.max(0, y));          // teardrop: narrower toward the top
        v.set(pp.getX(i) * w, y * 0.0068, pp.getZ(i) * w).applyQuaternion(q).add(tip).addScaledVector(tan, -0.0035);
        nv.set(nn.getX(i), nn.getY(i) * 0.6, nn.getZ(i)).normalize().applyQuaternion(q);
        P.push(v.x, v.y, v.z); Nn.push(nv.x, nv.y, nv.z); Sa.push(1); Pa.push(2);
      }
      const idx = sg.index.array; for (let i = 0; i < idx.length; i++) I.push(base + idx[i]);
      sg.dispose();
    }
    const lg = keep(new THREE.BufferGeometry());
    lg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    lg.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    lg.setAttribute('aS', new THREE.Float32BufferAttribute(Sa, 1));
    lg.setAttribute('aPart', new THREE.Float32BufferAttribute(Pa, 1));
    lg.setIndex(I);
    this.lifeMat = keep(new THREE.ShaderMaterial({ vertexShader: LIFE_VERT, fragmentShader: LIFE_FRAG,
      uniforms: { uTime, uGlow: this.uGlow, uCamPos: { value: new THREE.Vector3() } },
      transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    const lm = new THREE.Mesh(lg, this.lifeMat); lm.frustumCulled = false; lm.renderOrder = 0; S.add(lm);
    // filaments of light rising from the bulb, leaning toward the suns
    {
      const FP = [], FN = [], FS = [], FA = [], FI = [];
      const tip = stem.getPointAt(1), tan = stem.getTangentAt(1).normalize();
      const toSun = new THREE.Vector3(-0.45, 0.55, -0.70).normalize();
      const rnd = new Rand(77);
      for (let k = 0; k < 6; k++) {
        const len = 0.026 + 0.03 * rnd.next();
        const dir0 = tan.clone().lerp(toSun, 0.35 + 0.4 * rnd.next()).add(new THREE.Vector3(rnd.range(-0.35, 0.35), 0, rnd.range(-0.35, 0.35))).normalize();
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const u = i / 6;
          const d = dir0.clone().lerp(toSun, u * 0.6).normalize();
          pts.push(tip.clone().addScaledVector(tan, 0.002).addScaledVector(d, len * u).add(new THREE.Vector3(0, -0.004 * u * u * (k % 2), 0)));
        }
        taperedTube(new THREE.CatmullRomCurve3(pts), 24, 4, 0.0006, 0.00025, k, FP, FN, FS, FA, FI);
      }
      const fg = keep(new THREE.BufferGeometry());
      fg.setAttribute('position', new THREE.Float32BufferAttribute(FP, 3));
      fg.setAttribute('normal', new THREE.Float32BufferAttribute(FN, 3));
      fg.setAttribute('aS', new THREE.Float32BufferAttribute(FS, 1));
      fg.setAttribute('aPart', new THREE.Float32BufferAttribute(FA, 1));
      fg.setIndex(FI);
      const fm = keep(new THREE.ShaderMaterial({ vertexShader: FIL_VERT, fragmentShader: FIL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime, uGlow: this.uGlow } }));
      const fmesh = new THREE.Mesh(fg, fm); fmesh.frustumCulled = false; fmesh.renderOrder = 5; S.add(fmesh);
    }

    // glows: tip seed, tendril tips, pod
    {
      const base = keep(new THREE.PlaneGeometry(1, 1));
      const g = keep(new THREE.InstancedBufferGeometry());
      g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
      this.glowPos = new THREE.InstancedBufferAttribute(new Float32Array(4 * 3), 3);
      const data = new Float32Array([
        0.055, 2.4, 1, 0.0,     // tip
        0.010, 0.6, 0, 1.3,     // tendril 1
        0.009, 0.5, 0, 2.1,     // tendril 2
        0.040, 0.25, 0, 0.5,    // pod
      ]);
      g.setAttribute('iPos', this.glowPos);
      g.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 4));
      g.instanceCount = 4;
      const m = keep(new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, uniforms: { uTime, uGlow: this.uGlow, uCol: { value: new THREE.Vector3(1.0, 0.85, 0.62) } } }));
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 10; S.add(mesh);
    }
    // spores drifting up toward the suns
    {
      const rnd = new Rand(234), M = 140, seeds = new Float32Array(M * 4), pos = new Float32Array(M * 3);
      for (let i = 0; i < M * 4; i++) seeds[i] = rnd.next();
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      this.sporeMat = keep(new THREE.ShaderMaterial({ vertexShader: SPORE_VERT, fragmentShader: SPORE_FRAG, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, uniforms: { uTime, uScale: { value: this.uScale }, uOrigin: { value: new THREE.Vector3(b.x - 0.04, 0.12, b.z - 0.02) },
          uDrift: { value: new THREE.Vector3(-0.10, 0.16, -0.22) } } }));
      const p = new THREE.Points(g, this.sporeMat); p.frustumCulled = false; p.renderOrder = 11; S.add(p);
    }
  }

  sunDir(azDeg, elDeg) {
    const a = azDeg * D2R, e = elDeg * D2R;
    return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
  }

  tipAt(t) { return sway(this.stem.getPointAt(1), 1, t); }

  update(shot, t, T) {
    const cam = this.camera, U = this.env.uniforms;
    this.uTime.value = t;
    // ---- camera: gentle push toward the life form, then a slow crane up / tilt to the suns
    const push = easeInOutSine(clamp(t / 13));
    const crane = smootherstep(11.5, 20.5, t);
    const pos = new THREE.Vector3(
      lerp(0.0, 0.05, push) + lerp(0, 0.03, crane),
      lerp(0.25, 0.284, push) + lerp(0, 0.06, crane),
      lerp(1.45, 0.95, push) + lerp(0, 0.30, crane));
    const pitch = lerp(-3.0, -3.2, push) + lerp(0, 3.6, crane);
    const yaw = lerp(-1.0, -0.6, push) + lerp(0, -1.2, crane);
    cam.position.copy(pos);
    cam.rotation.set(pitch * D2R, yaw * D2R, 0, 'YXZ');
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    U.uCamPos.value.copy(cam.position);
    U.uInvVP.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    this.lifeMat.uniforms.uCamPos.value.copy(cam.position);
    // ---- suns rise
    U.uSun1.value.copy(this.sunDir(-15.5, lerp(-0.35, 1.9, t / 20)));
    U.uSun2.value.copy(this.sunDir(-21.5, lerp(2.6, 4.3, t / 20)));
    U.uPlanet.value.copy(this.sunDir(19.5, 7.4));
    U.uDawn.value = lerp(0.85, 1.05, smoothstep(0, 20, t));
    // ---- life form glow: awakens at the reacquire (local 8) and blooms at the end
    const glow = 0.75 + 0.45 * smoothstep(7.6, 9.5, t) + 0.6 * smoothstep(17, 20, t);
    this.uGlow.value = glow;
    U.uLifeGlow.value = glow;
    const tip = this.tipAt(t);
    U.uLifeTip.value.copy(tip);
    const gp = this.glowPos.array;
    gp.set([tip.x, tip.y, tip.z], 0);
    const t1 = sway(this.tendrilTips[0], 0.6, t), t2 = sway(this.tendrilTips[1], 0.6, t);
    gp.set([t1.x, t1.y, t1.z], 3); gp.set([t2.x, t2.y, t2.z], 6);
    gp.set([LIFE.x, 0.0, LIFE.z], 9);
    this.glowPos.needsUpdate = true;
    // ---- grade
    const end = smoothstep(17.6, 20.0, t);
    return {
      scene: this.scene, camera: cam,
      target: t >= 7.5 ? tip : null,
      post: {
        exposure: 1.0 + 0.28 * end * end, bloomStrength: 0.42 + 0.38 * end, bloomThreshold: 1.3 - 0.4 * end, bloomKnee: 0.8, bloomRadius: 0.75 + 0.1 * end,
        streak: 0.32, streakTint: [1.0, 0.78, 0.6], saturation: 1.08, contrast: 1.05, vignette: 0.4,
        tint: [1.0 + 0.06 * end, 0.97, 0.98 - 0.12 * end], lift: [0.012 * end, 0.008 * end, 0.0], grain: 0.04, ca: 0.0012,
      },
    };
  }

  dispose() { for (const d of this.disposables) d.dispose?.(); this.disposables = []; }
}
