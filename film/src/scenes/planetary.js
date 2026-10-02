// #16 行星狀星雲 · 上帝之眼 (mode 'eye') and #17 恆星育嬰室 (mode 'nursery').
// Both are built from baked procedural textures (computed once in init on the GPU) layered
// in depth for parallax, plus point / instanced-sprite clouds for the fine luminous detail.
import * as THREE from '../../vendor/three.module.js';
import { simplex3, hash } from '../lib/glsl.js';
import { Rand, fbm1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, smootherstep, easeInOutSine, easeOutCubic } from '../lib/ease.js';
import { bakeTexture, periodicNoise } from '../lib/texbake.js';

const R = 10;        // ring radius (world units) of the planetary nebula
const EXT = 1.9;     // baked nebula texture half-extent, in units of R

// ---------------------------------------------------------------- shared GLSL
const PREMUL = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation };
const ADD = { blending: THREE.AdditiveBlending };

// ---------------------------------------------------------------- bake shaders
const BAKE_DETAIL = periodicNoise + /* glsl */`
varying vec2 vUv;
void main(){
  vec2 p = vUv*8.0;
  float a = pfbm(p, 8.0);
  float b = pfbm(p*1.0 + 31.7, 8.0);
  float c = 1.0 - abs(pfbm(p*2.0 + 11.3, 16.0)*2.0 - 1.0);
  gl_FragColor = vec4(a, b, c, 1.0);
}`;

// Helix-like nebula, face-on. RGB = HDR emission, A = dust opacity.
const BAKE_NEBULA = simplex3 + /* glsl */`
uniform float uSeed, uKind;
varying vec2 vUv;
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
void main(){
  vec2 p = (vUv-0.5)*2.0*${EXT.toFixed(2)};
  vec2 q = rot(0.35)*p; q.y *= 1.07;
  float r0 = length(q);
  vec2 dir = q/max(r0,1e-3);
  float warp = fbm3(vec3(q*1.1, uSeed+3.0));
  float r = r0 + 0.08*warp + 0.03*snoise(vec3(q*4.5, uSeed+1.0));
  // radial striations: fast in angle, slow in radius
  float sp = fbm3(vec3(dir*6.5, r*1.1 + uSeed));
  float spokes = clamp(0.5 + 1.1*sp, 0.0, 1.0);
  float sp2 = clamp(0.5 + 0.8*snoise(vec3(dir*24.0, r*2.5 + uSeed*1.7)), 0.0, 1.0);
  float clump = smoothstep(0.42, 0.92, ridged3(vec3(q*3.0 + 0.5*warp, uSeed+7.0)));
  float cells = smoothstep(0.45, 0.95, ridged3(vec3(q*8.0, uSeed+17.0)));
  float fil = ridged3(vec3(q*6.0 + warp, uSeed+13.0));
  float gaps = smoothstep(0.30, 0.70, 0.5 + 0.9*fbm3(vec3(q*1.7, uSeed+29.0)));
  // ---- profiles
  float interior = pow(smoothstep(0.04, 0.84, r), 1.5) * (1.0 - smoothstep(0.80, 0.97, r));
  float core = exp(-r*r/0.03);
  float rimIn = exp(-pow((r-0.865)/0.03, 2.0));
  float ringP = r < 1.0 ? exp(-pow((r-1.0)/0.09, 2.0)) : exp(-pow((r-1.0)/0.14, 2.0));
  vec2 q2 = rot(-0.9)*p; q2.y *= 1.42; q2 = rot(0.9)*q2;
  float r2 = length(q2 - vec2(0.06, -0.04)) + 0.06*warp;
  float ring2 = exp(-pow((r2-1.30)/0.09, 2.0)) * smoothstep(0.25, 0.7, 0.5+0.7*snoise(vec3(q2*1.2, uSeed+21.0)));
  float halo = exp(-pow((r-1.40)/0.30, 2.0));
  // ---- dust lanes in the ring
  float dmask = smoothstep(0.84, 0.96, r) * (1.0 - smoothstep(1.12, 1.40, r));
  float dust = smoothstep(0.60, 0.84, fil) * dmask * 0.85;
  // ---- colours (linear HDR)
  vec3 teal = mix(vec3(0.10, 0.28, 0.95), vec3(0.14, 0.80, 0.80), smoothstep(0.20, 0.78, r));
  vec3 gold = vec3(1.9, 1.30, 0.55);
  vec3 red  = mix(vec3(1.75, 0.58, 0.18), vec3(0.85, 0.08, 0.15), smoothstep(0.93, 1.20, r));
  vec3 e = vec3(0.0);
  if (uKind < 0.5) {
    e += teal * interior * (0.10 + 1.0*spokes*(0.45+0.8*sp2)) * 0.9;
    e += vec3(0.30, 0.60, 1.2) * core * 0.25;
    e += gold * rimIn * smoothstep(0.35, 0.9, clump) * (0.3 + 0.9*spokes) * 0.75;
    e += red * ringP * (0.05 + 2.1*pow(clump, 1.6)*(0.55 + 0.6*cells)) * mix(0.15, 1.0, gaps) * (0.6 + 0.5*spokes);
    e += vec3(1.20, 0.20, 0.15) * ring2 * (0.15 + 1.1*pow(fil, 2.0)) * 0.75;
    e += vec3(0.62, 0.07, 0.15) * halo * pow(fil, 4.0) * 0.30;
    e *= 1.0 - dust*0.7;
  } else {
    // veil: filaments and spokes only, sparser
    float vf = pow(fil, 4.0);
    e += teal * interior * pow(spokes, 2.0) * sp2 * 0.5;
    e += mix(gold, red, smoothstep(0.85, 1.05, r)) * ringP * vf * 1.4 * gaps;
    e += vec3(0.9, 0.14, 0.14) * halo * vf * 0.5;
    e += vec3(1.1, 0.22, 0.14) * ring2 * vf * 0.7;
    dust *= 0.5;
  }
  float edge = 1.0 - smoothstep(1.75, 1.88, max(abs(p.x), abs(p.y)));
  gl_FragColor = vec4(e*edge, dust*edge);
}`;

// Pillar of creation: RGB = premultiplied HDR colour, A = opacity.
const BAKE_PILLAR = simplex3 + /* glsl */`
uniform float uSeed, uLean, uHead, uNeck;
varying vec2 vUv;
float field(vec2 p){
  // p.x in [-0.5,0.5], p.y in [0,1] (1 = top). Signed distance-ish: >0 inside.
  float y = p.y;
  float x = p.x - uLean*y*y - 0.025*sin(y*6.0 + uSeed);
  float yh = 0.80;
  float w = mix(0.27, 0.085, pow(clamp(y/yh, 0.0, 1.0), 0.75));
  w -= uNeck*exp(-pow((y-0.70)/0.05, 2.0));
  float dT = min(w - abs(x), yh + 0.02 - y);
  float rh = 0.085 + uHead;
  float dH = rh - length(vec2(x*1.1, (y - yh)*0.9));
  float d = max(dT, dH);
  // finger-like protrusions (EGGs) near the top, ragged edges everywhere
  float n = fbm3(vec3(p*vec2(4.0, 2.6), uSeed)) * 0.075 + fbm3(vec3(p*vec2(14.0, 9.0), uSeed+5.0))*0.022;
  float fing = smoothstep(0.55, 0.95, y) * max(0.0, snoise(vec3(p.x*18.0, p.y*5.0, uSeed+9.0))) * 0.035;
  return d + n + fing;
}
float surf(vec2 p){ return fbm3(vec3(p*vec2(7.0, 5.0), uSeed+21.0)) + 0.35*fbm3(vec3(p*vec2(20.0, 14.0), uSeed+33.0)); }
void main(){
  vec2 p = vec2(vUv.x - 0.5, vUv.y);
  float e = 0.004;
  float d = field(p);
  float dx = field(p + vec2(e, 0.0)) - d;
  float dy = field(p + vec2(0.0, e)) - d;
  vec2 g = normalize(vec2(dx, dy) + 1e-6);        // points inward
  float a = smoothstep(-0.010, 0.016, d);
  float halo = smoothstep(-0.06, 0.0, d) * (1.0 - a);
  vec2 L2 = normalize(vec2(0.25, 1.0));             // light from above, slightly right
  float facing = clamp(dot(-g, L2), 0.0, 1.0);
  float edge = exp(-max(d, 0.0)/0.014);
  float thick = smoothstep(0.0, 0.10, d);
  // bumpy cloud relief lit from the top/front
  float h0 = surf(p), hx = surf(p + vec2(0.003, 0.0)), hy = surf(p + vec2(0.0, 0.003));
  vec3 nrm = normalize(vec3(-(hx-h0)*1.6, -(hy-h0)*1.6, 0.012*1.0));
  nrm = normalize(nrm + vec3(-g*0.8*(1.0-thick), 0.0));
  float lam = clamp(dot(nrm, normalize(vec3(0.25, 0.9, 0.45))), 0.0, 1.0);
  float height = smoothstep(0.0, 0.95, p.y);
  float lit = (0.15 + 0.85*lam) * mix(0.25, 1.0, height) * mix(1.0, 0.55, thick);
  vec3 dark = vec3(0.020, 0.010, 0.007);
  vec3 amber = vec3(0.42, 0.20, 0.085);
  vec3 body = mix(dark, amber, lit) * (0.75 + 0.5*h0);
  // rim: ionisation front on the light-facing silhouette, hottest at the head
  vec3 rimc = mix(vec3(1.3, 0.62, 0.26), vec3(2.6, 1.55, 0.95), smoothstep(0.55, 0.95, p.y));
  float rim = edge * (0.05 + 1.2*pow(facing, 1.5)) * (0.25 + 0.75*height) * (0.6 + 0.6*h0);
  vec3 col = body + rimc * rim;
  float ha = halo * 0.5 * (0.5 + 0.5*h0);
  vec3 hc = mix(vec3(0.50, 0.28, 0.12), vec3(1.0, 0.70, 0.42), height) * ha * (0.3 + 0.9*facing);
  float A = clamp(a + ha*0.55, 0.0, 1.0);
  gl_FragColor = vec4(col*a + hc, A);
}`;

// Ionised gas backdrop for the nursery: RGB HDR emission (soft, large-scale).
const BAKE_GAS = simplex3 + /* glsl */`
varying vec2 vUv;
void main(){
  vec2 p = vUv*vec2(2.4, 1.0)*1.25;
  float w = fbm3(vec3(p*0.6, 4.0));
  float a = fbm3(vec3(p*1.1 + w*0.7, 1.0));
  float b = ridged3(vec3(p*1.4 + w*1.2, 7.0));
  float c = fbm3(vec3(p*2.6 + w, 11.0));
  float topLit = smoothstep(0.05, 1.0, vUv.y);
  vec3 teal = vec3(0.12, 0.62, 0.72);
  vec3 blue = vec3(0.05, 0.13, 0.36);
  float m = smoothstep(-0.35, 0.55, a + 0.25*c);
  vec3 col = mix(blue, teal, m*topLit) * (0.10 + 0.40*m) * (0.35 + 1.3*topLit*topLit);
  col += vec3(0.75, 0.42, 0.20) * pow(b, 5.0) * 0.30 * (1.0 - 0.6*topLit);
  col += vec3(0.55, 0.85, 1.0) * pow(smoothstep(0.6, 1.0, vUv.y), 2.0) * 0.30 * (0.6 + 0.6*m);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- runtime shaders
const LAYER_VERT = /* glsl */`
varying vec2 vUv; varying float vCamDist;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vCamDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

// All gas slices in ONE full-screen pass: intersect the view ray with each slice plane
// (back to front), composite premultiplied emission/absorption. Parallax for free.
const NEB_VOL_VERT = /* glsl */`void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const NEB_VOL_FRAG = /* glsl */`
uniform sampler2D tNeb, tVeil, tDetail;
uniform vec3 uCamPos; uniform mat4 uInvVP; uniform vec2 uRes;
uniform float uTime, uFlow, uDetail, uGain;
vec3 gRay; vec3 gCol; float gT;
void slice(sampler2D tex, float z, float gain, float rot, float sc, float ab, float near, float det){
  float tt = (z - uCamPos.z) / gRay.z;
  float vis = step(0.0, tt) * smoothstep(near*0.25, near, tt);
  vec2 xy = uCamPos.xy + gRay.xy * tt;
  xy /= 1.0 + uFlow*uTime;
  float c = cos(rot), s = sin(rot);
  vec2 uv = (mat2(c,-s,s,c) * xy) / (sc * ${(2 * EXT * R).toFixed(1)}) + 0.5;
  vec4 n = texture2D(tex, uv);
  float d = 1.0;
  if (uDetail > 0.001) {
    vec3 dt = texture2D(tDetail, xy*0.19 + vec2(rot, z*0.37)).rgb;
    d = mix(1.0, (0.30 + 1.4*dt.r) * (0.6 + 0.8*dt.b), uDetail*det);
  }
  vec3 e = n.rgb * gain * d * vis;
  float a = clamp(n.a * ab * d, 0.0, 1.0) * vis;
  gCol = gCol*(1.0 - a) + e;
  gT *= 1.0 - a;
}
void main(){
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec4 w = uInvVP * vec4(ndc, 1.0, 1.0);
  gRay = normalize(w.xyz / w.w - uCamPos);
  gCol = vec3(0.0); gT = 1.0;
  slice(tVeil, -3.2, 0.16,  0.90, 1.05, 0.00, 1.5, 0.8);
  slice(tNeb,  -1.4, 0.11,  0.10, 1.03, 0.35, 1.5, 0.6);
  slice(tNeb,   0.0, 0.15,  0.00, 1.00, 0.45, 1.5, 0.55);
  slice(tNeb,   1.3, 0.10, -0.12, 0.97, 0.35, 1.5, 0.65);
  slice(tVeil,  3.0, 0.14, -0.60, 0.95, 0.15, 2.5, 0.85);
  gl_FragColor = vec4(gCol * uGain, 1.0 - gT);
}`;

const POINTS_VERT = /* glsl */`
attribute vec3 color; attribute float aSize; attribute float aPhase;
uniform float uScale, uTime, uSizeK, uMaxSize, uFlow;
varying vec3 vCol;
void main(){
  vec3 p = position;
  p.xy *= 1.0 + uFlow*uTime;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float sz = aSize * uSizeK * uScale / max(-mv.z, 0.01);
  float tw = 0.75 + 0.25*sin(uTime*(1.3 + aPhase) + aPhase*20.0);
  float k = clamp(sz, 0.0, 1.0);                 // sub-pixel points: keep energy, shrink brightness
  vCol = color * tw * k * k;
  gl_PointSize = clamp(sz, 1.0, uMaxSize * uScale);
  gl_Position = projectionMatrix * mv;
}`;
const POINTS_FRAG = /* glsl */`
varying vec3 vCol;
void main(){
  vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d)*4.0;
  float a = exp(-r2*3.5) * (1.0 - smoothstep(0.7, 1.0, r2));
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

const STAR_VERT = /* glsl */`
attribute vec3 color; attribute float aSize; attribute float aPhase;
uniform float uScale, uTime;
varying vec3 vCol;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float sz = aSize * uScale;
  float k = clamp(sz, 0.0, 1.0);
  vCol = color * k * k * (0.85 + 0.15*sin(uTime*2.0 + aPhase*30.0));
  gl_PointSize = max(sz, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

// Cometary knots: instanced quads in the nebula plane, head toward the star, tail radially outward.
const KNOT_VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iData; // ang, len, wid, bri
attribute float iHue;
uniform float uTime, uFlow, uPxK;
varying vec2 vLocal; varying vec3 vInfo; varying float vHue;
void main(){
  float ang = iData.x, len = iData.y, wid = iData.z;
  vec3 c0 = iPos; c0.xy *= 1.0 + uFlow*uTime;
  float dist = max(-(modelViewMatrix * vec4(c0, 1.0)).z, 0.01);
  float minW = 2.2 * uPxK * dist;              // keep heads >= ~2px wide
  float k = wid / max(wid, minW);
  float bri = iData.w * k * k;
  wid = max(wid, minW); len = max(len, wid*2.5);
  vec2 ax = vec2(cos(ang), sin(ang)), pe = vec2(-ax.y, ax.x);
  float along = mix(-wid, len, position.x + 0.5);
  float perp = position.y * 2.0 * wid * (1.0 + 0.6*(position.x + 0.5));
  vec3 c = iPos; c.xy *= 1.0 + uFlow*uTime;
  vec3 wp = c + vec3(ax*along + pe*perp, 0.0);
  vLocal = vec2(along, perp); vInfo = vec3(len, wid, bri); vHue = iHue;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
}`;
const KNOT_FRAG = /* glsl */`
varying vec2 vLocal; varying vec3 vInfo; varying float vHue;
void main(){
  float a = vLocal.x, pr = vLocal.y, len = vInfo.x, wid = vInfo.y, bri = vInfo.z;
  float hw = wid*0.32;
  float d2 = (a*a + pr*pr)/(hw*hw);
  float head = exp(-d2*1.6);
  float tw = hw*(0.75 + 1.4*clamp(a/len, 0.0, 1.0));
  float tail = smoothstep(-hw*0.5, hw*0.8, a) * exp(-pr*pr/(tw*tw)) * exp(-2.6*max(a,0.0)/len) * (1.0 - smoothstep(0.75*len, len, a));
  // ionised crescent on the star-facing side
  float rr = sqrt(a*a + pr*pr);
  float rim = exp(-pow((rr - hw*1.15)/(hw*0.35), 2.0)) * smoothstep(0.2*hw, -0.9*hw, a);
  vec3 headC = mix(vec3(3.2, 2.2, 1.1), vec3(2.6, 2.6, 2.4), vHue);
  vec3 tailC = mix(vec3(1.25, 0.42, 0.12), vec3(1.1, 0.25, 0.12), vHue);
  vec3 rimC = vec3(0.55, 1.25, 1.35);
  vec3 col = headC*head*1.4 + tailC*tail*0.85 + rimC*rim*0.9;
  gl_FragColor = vec4(col*bri, 1.0);
}`;

// Hot point sprite (white dwarf, new stars) with optional diffraction spikes.
const FLARE_VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iData;   // size(world), t0, kind, seed
uniform float uTime, uScale;
varying vec2 vUv; varying float vI; varying float vKind; varying float vSeed;
void main(){
  float t0 = iData.y;
  float age = uTime - t0;
  // ignition: flash spike then settle to a steady glow
  float I = age < 0.0 ? 0.0 : (1.0 + 7.0*exp(-age*2.6)) * smoothstep(0.0, 0.08, age);
  if (t0 < -50.0) I = 1.0;
  vI = I; vKind = iData.z; vSeed = iData.w; vUv = position.xy * 2.0;
  float sz = iData.x * (0.55 + 0.45*min(I, 3.0)/3.0) * (1.0 + 0.6*exp(-max(age,0.0)*2.0));
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * sz;
  gl_Position = projectionMatrix * mv;
  if (I <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FLARE_FRAG = /* glsl */`
uniform vec3 uCol, uCore;
varying vec2 vUv; varying float vI; varying float vKind; varying float vSeed;
float spike(vec2 p, float ang, float w){
  vec2 d = vec2(cos(ang), sin(ang));
  float along = abs(dot(p, d)), perp = abs(dot(p, vec2(-d.y, d.x)));
  return exp(-perp/w) * exp(-along*4.0) ;
}
void main(){
  vec2 p = vUv; float r = length(p);
  float core = exp(-r*r*900.0);
  float glow = exp(-r*r*60.0)*0.35 + exp(-r*9.0)*0.10;
  float sp = 0.0;
  if (vKind > 0.5) {
    for (int i = 0; i < 3; i++) sp += spike(p, 1.5708 + float(i)*1.0472, 0.006);
    sp += 0.35*spike(p, 0.0, 0.004);
  }
  vec3 c = uCore*core*5.0 + uCol*(glow + sp*0.55);
  float fall = 1.0 - smoothstep(0.75, 1.0, r);
  gl_FragColor = vec4(c * vI * fall, 1.0);
}`;

// Nursery: textured billboard (premultiplied) with distance haze.
const BILL_VERT = /* glsl */`
varying vec2 vUv; varying float vDist;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`;
const PILLAR_FRAG = /* glsl */`
uniform sampler2D tMap; uniform float uGain, uHaze; uniform vec3 uHazeCol;
varying vec2 vUv; varying float vDist;
void main(){
  vec4 c = texture2D(tMap, vUv);
  float h = uHaze;
  vec3 col = c.rgb * uGain * (1.0 - h) + uHazeCol * c.a * h;
  gl_FragColor = vec4(col, c.a * (1.0 - 0.5*h));
}`;
const GAS_FRAG = /* glsl */`
uniform sampler2D tMap, tDetail; uniform float uGain, uTime, uAlpha; uniform vec2 uOff, uRep;
varying vec2 vUv; varying float vDist;
void main(){
  vec2 uv = vUv*uRep + uOff;
  vec3 c = texture2D(tMap, uv).rgb;
  float d = texture2D(tDetail, uv*vec2(3.0, 1.5) + vec2(uTime*0.004, 0.0)).r;
  float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
  vec3 e = c * (0.55 + 0.9*d) * uGain * edge;
  gl_FragColor = vec4(e, uAlpha * edge * dot(c, vec3(0.3)));
}`;
// Photo-evaporation streamers rising off a pillar tip.
const STREAM_FRAG = /* glsl */`
uniform sampler2D tDetail; uniform float uTime, uGain, uSeed; uniform vec3 uCol;
varying vec2 vUv; varying float vDist;
void main(){
  vec2 p = vec2(vUv.x - 0.5, vUv.y);           // y: 0 at the tip, 1 high above
  float w = 0.06 + 0.40*p.y;
  float cone = exp(-pow(p.x/w, 2.0)) * smoothstep(0.0, 0.06, p.y) * (1.0 - smoothstep(0.35, 1.0, p.y));
  vec2 q = vec2(p.x/(0.25 + p.y), p.y*0.8);
  float n1 = texture2D(tDetail, q*vec2(2.0, 1.0) + vec2(uSeed, -uTime*0.035)).b;
  float n2 = texture2D(tDetail, q*vec2(5.0, 2.2) + vec2(uSeed*1.7, -uTime*0.06)).r;
  float wisp = pow(n1, 3.0) * (0.4 + 1.2*n2);
  vec3 col = mix(uCol, vec3(0.45, 0.75, 1.0), smoothstep(0.1, 0.8, p.y)) * cone * wisp * uGain;
  gl_FragColor = vec4(col, 0.0);
}`;

function pointsMaterial(extra = {}, vert = POINTS_VERT) {
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: POINTS_FRAG, transparent: true, depthWrite: false, depthTest: false, ...ADD,
    uniforms: { uScale: { value: 1 }, uTime: { value: 0 }, uSizeK: { value: 1 }, uMaxSize: { value: 6 }, uFlow: { value: 0 }, ...extra },
  });
}

export default class Planetary {
  constructor(ctx) {
    this.ctx = ctx;
    this.uScale = ctx.height / 804;
    this.disposables = [];
  }

  async init() {
    const r = this.ctx.renderer;
    const keep = (x) => { this.disposables.push(x); return x; };
    this.detailRT = keep(bakeTexture(r, 512, 512, BAKE_DETAIL, {}, { wrap: THREE.RepeatWrapping }));
    this.nebRT = keep(bakeTexture(r, 1024, 1024, BAKE_NEBULA, { uSeed: { value: 1.7 }, uKind: { value: 0 } }));
    this.veilRT = keep(bakeTexture(r, 1024, 1024, BAKE_NEBULA, { uSeed: { value: 8.3 }, uKind: { value: 1 } }));
    this.buildEye();
    this.buildNursery();
  }

  // ================================================================ EYE
  buildEye() {
    const S = new THREE.Scene();
    this.eye = { scene: S, camera: new THREE.PerspectiveCamera(40, this.ctx.aspect, 0.05, 2000), uniforms: [] };
    const E = this.eye; const rnd = new Rand(207);
    const uTime = { value: 0 };
    E.uTime = uTime;
    const FLOW = 0.0018;

    // --- background stars
    {
      const N = 5000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
      const v = [0, 0, 0];
      for (let i = 0; i < N; i++) {
        rnd.onSphere(v); if (v[2] > 0.2) v[2] = -v[2];
        pos.set([v[0] * 900, v[1] * 900, v[2] * 900 - 100], i * 3);
        const m = Math.pow(rnd.next(), 6);
        const tcol = rnd.next();
        const c = tcol < 0.3 ? [1.0, 0.8, 0.6] : tcol < 0.7 ? [1, 0.95, 0.9] : [0.7, 0.82, 1.0];
        const I = 0.12 + 2.2 * m;
        col.set([c[0] * I, c[1] * I, c[2] * I], i * 3);
        size[i] = 0.7 + 2.2 * m; ph[i] = rnd.next();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      const m = new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: POINTS_FRAG, transparent: true, depthWrite: false, depthTest: false, ...ADD,
        uniforms: { uScale: { value: this.uScale }, uTime } });
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -100; S.add(p);
      this.disposables.push(g, m);
    }

    // --- gas: one full-screen ray-slice pass
    {
      const m = new THREE.ShaderMaterial({
        vertexShader: NEB_VOL_VERT, fragmentShader: NEB_VOL_FRAG, transparent: true, depthWrite: false, depthTest: false, ...PREMUL,
        uniforms: { tNeb: { value: this.nebRT.texture }, tVeil: { value: this.veilRT.texture }, tDetail: { value: this.detailRT.texture },
          uCamPos: { value: new THREE.Vector3() }, uInvVP: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(this.ctx.width, this.ctx.height) },
          uTime, uFlow: { value: FLOW }, uDetail: { value: 1 }, uGain: { value: 1 } },
      });
      const g = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = -10;
      S.add(mesh); E.vol = m; this.disposables.push(g, m);
    }

    // --- gas motes: fine luminous dust following the nebula profile
    {
      const N = 140000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
      let i = 0;
      while (i < N) {
        const a = rnd.range(0, Math.PI * 2);
        const rr = Math.sqrt(rnd.next()) * 1.75;
        // acceptance by profile: interior + ring + halo
        const prof = 0.25 * smoothstep(0.1, 0.85, rr) * (1 - smoothstep(0.85, 1.0, rr)) + 1.0 * Math.exp(-Math.pow((rr - 0.98) / 0.13, 2)) + 0.18 * Math.exp(-Math.pow((rr - 1.35) / 0.25, 2));
        if (rnd.next() > prof) continue;
        const wob = 1 + 0.06 * fbm1(a * 3 + 1.7);
        const x = Math.cos(a) * rr * R * wob, y = Math.sin(a) * rr * R * wob * 0.94;
        const z = rnd.gauss() * (0.6 + 1.2 * rr);
        pos.set([x, y, z], i * 3);
        let c;
        if (rr < 0.8) c = [0.25, 0.85, 1.0];
        else if (rr < 0.92) c = [1.3, 0.95, 0.5];
        else if (rr < 1.15) c = [1.2, 0.42, 0.16];
        else c = [0.9, 0.18, 0.15];
        const I = 0.10 + 0.5 * Math.pow(rnd.next(), 4);
        col.set([c[0] * I, c[1] * I, c[2] * I], i * 3);
        size[i] = 0.5 + rnd.next() * 1.4; ph[i] = rnd.next();
        i++;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      const m = pointsMaterial({ uTime, uFlow: { value: FLOW }, uSizeK: { value: 2.4 }, uMaxSize: { value: 7 } });
      m.uniforms.uScale.value = this.uScale;
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 0; S.add(p);
      this.disposables.push(g, m);
    }

    // --- cometary knots
    {
      const N = 2600;
      const base = new THREE.PlaneGeometry(1, 1);
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
      const ip = new Float32Array(N * 3), id = new Float32Array(N * 4), ih = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = rnd.range(0, Math.PI * 2);
        let rr = 0.5 + 0.45 * Math.pow(rnd.next(), 0.6);
        if (rnd.next() < 0.25) rr = 0.8 + 0.25 * rnd.next();
        const wob = 1 + 0.06 * fbm1(a * 3 + 1.7);
        const x = Math.cos(a) * rr * R * wob, y = Math.sin(a) * rr * R * wob * 0.94;
        const z = rnd.gauss() * 1.1;
        ip.set([x, y, z], i * 3);
        const ang = Math.atan2(y, x) + rnd.gauss() * 0.05;
        const len = (0.12 + 0.55 * Math.pow(rnd.next(), 2)) * (0.6 + rr);
        const wid = 0.035 + 0.05 * rnd.next();
        const bri = (0.25 + 0.95 * Math.pow(rnd.next(), 3)) * smoothstep(0.45, 0.75, rr);
        id.set([ang, len, wid, bri], i * 4); ih[i] = rnd.next();
      }
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 3));
      g.setAttribute('iData', new THREE.InstancedBufferAttribute(id, 4));
      g.setAttribute('iHue', new THREE.InstancedBufferAttribute(ih, 1));
      g.instanceCount = N;
      const m = new THREE.ShaderMaterial({ vertexShader: KNOT_VERT, fragmentShader: KNOT_FRAG, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, ...ADD,
        uniforms: { uTime, uFlow: { value: FLOW }, uPxK: { value: 2 * Math.tan(20 * Math.PI / 180) / this.ctx.height } } });
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 1; S.add(mesh);
      this.disposables.push(g, m, base);
    }

    // --- white dwarf
    {
      const base = new THREE.PlaneGeometry(1, 1);
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0]), 3));
      g.setAttribute('iData', new THREE.InstancedBufferAttribute(new Float32Array([5.0, -100, 0, 0]), 4));
      g.instanceCount = 1;
      const m = new THREE.ShaderMaterial({ vertexShader: FLARE_VERT, fragmentShader: FLARE_FRAG, transparent: true, depthWrite: false, depthTest: false, ...ADD,
        uniforms: { uTime, uScale: { value: this.uScale }, uCol: { value: new THREE.Vector3(1.6, 2.2, 3.2) }, uCore: { value: new THREE.Vector3(14, 15, 18) } } });
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 5; S.add(mesh);
      this.disposables.push(g, m, base);
    }

    // --- our atom: a single slightly brighter mote drifting outward through the ring
    {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([2.6, 2.1, 1.4]), 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([1.6]), 1));
      g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array([0.3]), 1));
      const m = pointsMaterial({ uTime, uSizeK: { value: 3.0 }, uMaxSize: { value: 6 } });
      m.uniforms.uScale.value = this.uScale;
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 2; S.add(p);
      E.atom = p; this.disposables.push(g, m);
    }
  }

  setVolCam(mat, cam) {
    mat.uniforms.uCamPos.value.copy(cam.position);
    mat.uniforms.uInvVP.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
  }

  atomEye(t) {
    const a = Math.PI * 0.93 + 0.003 * t;
    const rr = (0.62 + 0.007 * t) * R;
    return new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr * 0.94 + 0.2, 0.5);
  }

  updateEye(t) {
    const E = this.eye, cam = E.camera;
    E.uTime.value = t;
    // pull-back reveal: log-space dolly from inside the ring to the full eye
    const x = clamp(t / 13.0);
    const e = 1 - Math.pow(1 - smootherstep(0, 1, Math.pow(x, 0.8)), 1.35);
    const D = Math.exp(lerp(Math.log(2.6), Math.log(36), e)) * (1 + 0.006 * Math.max(0, t - 13));
    const L = new THREE.Vector3(lerp(-8.4, 0.2, e), lerp(1.3, 0.55, e), lerp(-0.3, 0, e));
    const dir = new THREE.Vector3(lerp(0.62, 0, e), lerp(-0.22, 0, e), lerp(0.75, 1, e)).normalize();
    cam.position.copy(L).addScaledVector(dir, D);
    const roll = lerp(0.22, 0.0, smootherstep(0, 1, x)) + 0.01 * Math.sin(t * 0.3);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.lookAt(L);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    this.setVolCam(E.vol, cam);
    E.vol.uniforms.uDetail.value = 1 - smoothstep(8, 22, D);
    const atom = this.atomEye(t);
    E.atom.geometry.attributes.position.array.set([atom.x, atom.y, atom.z]);
    E.atom.geometry.attributes.position.needsUpdate = true;
    const swell = smoothstep(4, 12, t);
    return {
      scene: E.scene, camera: cam,
      target: t >= 1.8 ? atom : null,
      post: {
        exposure: 1.05 + 0.15 * swell, bloomStrength: 0.75, bloomThreshold: 0.75, bloomKnee: 0.7, bloomRadius: 0.9,
        streak: 0.18, streakTint: [0.55, 0.85, 1.0], saturation: 1.06, contrast: 1.06, vignette: 0.42,
        tint: [1.0, 0.98, 0.97], grain: 0.04, ca: 0.0022,
      },
    };
  }

  // ================================================================ NURSERY
  buildNursery() {
    const r = this.ctx.renderer;
    const keep = (x) => { this.disposables.push(x); return x; };
    const S = new THREE.Scene();
    const N = this.nursery = { scene: S, camera: new THREE.PerspectiveCamera(48, this.ctx.aspect, 0.1, 3000), uTime: { value: 0 } };
    const uTime = N.uTime;
    const rnd = new Rand(222);
    const gasRT = keep(bakeTexture(r, 1024, 512, BAKE_GAS, {}));
    const pillarTex = [
      keep(bakeTexture(r, 512, 1024, BAKE_PILLAR, { uSeed: { value: 3.1 }, uLean: { value: 0.05 }, uHead: { value: 0.06 }, uNeck: { value: 0.02 } })),
      keep(bakeTexture(r, 512, 1024, BAKE_PILLAR, { uSeed: { value: 7.7 }, uLean: { value: -0.07 }, uHead: { value: 0.035 }, uNeck: { value: 0.015 } })),
      keep(bakeTexture(r, 512, 1024, BAKE_PILLAR, { uSeed: { value: 12.4 }, uLean: { value: 0.10 }, uHead: { value: 0.05 }, uNeck: { value: 0.03 } })),
    ];
    const geo = keep(new THREE.PlaneGeometry(1, 1));
    const bill = (frag, uniforms, blend) => keep(new THREE.ShaderMaterial({ vertexShader: BILL_VERT, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, depthTest: false, ...blend }));

    // --- far stars
    {
      const M = 2600, pos = new Float32Array(M * 3), col = new Float32Array(M * 3), size = new Float32Array(M), ph = new Float32Array(M);
      for (let i = 0; i < M; i++) {
        pos.set([rnd.range(-420, 420), rnd.range(-200, 230), -260 - rnd.range(0, 30)], i * 3);
        const m = Math.pow(rnd.next(), 7), I = 0.15 + 2.5 * m;
        const c = rnd.next() < 0.5 ? [1, 0.85, 0.7] : [0.75, 0.85, 1];
        col.set([c[0] * I, c[1] * I, c[2] * I], i * 3); size[i] = 0.7 + 2.0 * m; ph[i] = rnd.next();
      }
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      const m = keep(new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: POINTS_FRAG, transparent: true, depthWrite: false, depthTest: false, ...ADD, uniforms: { uScale: { value: this.uScale }, uTime } }));
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -100; S.add(p);
    }
    // --- ionised gas backdrop + haze veils
    const gasPlane = (z, w, h, x, y, gain, alpha, off, rep, order, blend) => {
      const m = bill(GAS_FRAG, { tMap: { value: gasRT.texture }, tDetail: { value: this.detailRT.texture }, uGain: { value: gain }, uTime, uAlpha: { value: alpha },
        uOff: { value: new THREE.Vector2(...off) }, uRep: { value: new THREE.Vector2(...rep) } }, blend);
      const mesh = new THREE.Mesh(geo, m); mesh.scale.set(w, h, 1); mesh.position.set(x, y, z); mesh.frustumCulled = false; mesh.renderOrder = order; S.add(mesh);
    };
    gasPlane(-250, 760, 330, 0, 10, 1.0, 0.85, [0, 0], [1, 1], -90, PREMUL);
    gasPlane(-140, 420, 190, 10, 5, 0.22, 0.0, [0.31, 0.12], [0.8, 0.9], -60, ADD);

    // --- pillars: [tex, x, baseY, z, height, gain, haze]
    const P = [
      [1, -38, -70, -175, 85, 0.85, 0.55],   // distant left
      [2, 52, -68, -160, 70, 0.85, 0.55],    // distant right
      [0, -16, -62, -96, 100, 1.0, 0.18],    // hero pillar
      [1, 22, -58, -80, 66, 1.0, 0.12],      // right companion
      [2, 52, -45, -48, 52, 1.05, 0.0],      // near right
      [0, -46, -60, -34, 78, 0.9, 0.0],      // foreground left mass
    ];
    N.tips = [];
    P.forEach(([ti, x, by, z, h, gain, haze], i) => {
      const w = h * 0.5;
      const m = bill(PILLAR_FRAG, { tMap: { value: pillarTex[ti].texture }, uGain: { value: gain }, uHaze: { value: haze }, uHazeCol: { value: new THREE.Vector3(0.10, 0.28, 0.36) } }, PREMUL);
      const mesh = new THREE.Mesh(geo, m); mesh.scale.set(w, h, 1); mesh.position.set(x, by + h / 2, z);
      mesh.frustumCulled = false; mesh.renderOrder = -50 + i * 2; S.add(mesh);
      const lean = [0.05, -0.07, 0.10][ti];
      const tip = new THREE.Vector3(x + lean * 0.8 * 0.8 * w, by + h * 0.90, z + 0.5);
      N.tips.push(tip);
      // streamers off the tip
      const sm = bill(STREAM_FRAG, { tDetail: { value: this.detailRT.texture }, uTime, uGain: { value: 0.55 * gain * (1 - haze * 0.6) }, uSeed: { value: i * 0.37 },
        uCol: { value: new THREE.Vector3(1.0, 0.62, 0.32) } }, ADD);
      const st = new THREE.Mesh(geo, sm); st.scale.set(w * 0.9, h * 0.55, 1); st.position.set(tip.x, tip.y - h * 0.04 + h * 0.275, z + 0.6);
      st.frustumCulled = false; st.renderOrder = -49 + i * 2; S.add(st);
    });

    // --- drifting dust motes along the flight path
    {
      const M = 16000, pos = new Float32Array(M * 3), col = new Float32Array(M * 3), size = new Float32Array(M), ph = new Float32Array(M);
      for (let i = 0; i < M; i++) {
        const z = rnd.range(-150, -6);
        pos.set([rnd.range(-1, 1) * (20 - z * 0.75), rnd.range(-1, 1) * (12 - z * 0.38), z], i * 3);
        const I = 0.05 + 0.35 * Math.pow(rnd.next(), 3);
        const c = rnd.next() < 0.6 ? [1.0, 0.7, 0.45] : [0.5, 0.8, 1.0];
        col.set([c[0] * I, c[1] * I, c[2] * I], i * 3); size[i] = 0.5 + rnd.next(); ph[i] = rnd.next();
      }
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      const m = keep(pointsMaterial({ uTime, uSizeK: { value: 14 }, uMaxSize: { value: 5 } }));
      m.uniforms.uScale.value = this.uScale;
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 20; S.add(p);
    }

    // --- stars: already-shining young stars + ignitions at the tips, one by one
    {
      const T = N.tips;
      const atomStar = new THREE.Vector3().copy(T[2]).add(new THREE.Vector3(1.2, -2.0, 0.8));
      N.atomStar = atomStar;
      const list = [
        // pos, size, t0 (-100 = always on), kind(1=spikes)
        [T[2].clone().add(new THREE.Vector3(-3, -6, 1)), 3.0, 1.0, 1],
        [T[3].clone().add(new THREE.Vector3(0.5, -1.0, 1)), 2.6, 2.3, 1],
        [T[4].clone().add(new THREE.Vector3(-1.0, -2.5, 1)), 2.2, 3.6, 1],
        [T[0].clone().add(new THREE.Vector3(0, -2, 1)), 4.0, 4.6, 1],
        [atomStar, 3.4, 6.0, 1],
        [T[1].clone().add(new THREE.Vector3(1, -3, 1)), 4.0, 7.2, 1],
        [T[5].clone().add(new THREE.Vector3(2.0, -3.0, 1)), 2.0, 8.4, 1],
        [T[3].clone().add(new THREE.Vector3(-2.5, -7, 1)), 2.2, 9.6, 1],
        [T[2].clone().add(new THREE.Vector3(4, -14, 1)), 2.4, 10.6, 1],
        [new THREE.Vector3(-70, 60, -200), 9, -100, 1],
        [new THREE.Vector3(35, 48, -190), 7, -100, 1],
        [new THREE.Vector3(120, -10, -230), 6, -100, 1],
      ];
      const base = keep(new THREE.PlaneGeometry(1, 1));
      const g = keep(new THREE.InstancedBufferGeometry());
      g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
      const ip = new Float32Array(list.length * 3), id = new Float32Array(list.length * 4);
      list.forEach(([p, sz, t0, k], i) => { ip.set([p.x, p.y, p.z], i * 3); id.set([sz, t0, k, i], i * 4); });
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 3));
      g.setAttribute('iData', new THREE.InstancedBufferAttribute(id, 4));
      g.instanceCount = list.length;
      const m = keep(new THREE.ShaderMaterial({ vertexShader: FLARE_VERT, fragmentShader: FLARE_FRAG, transparent: true, depthWrite: false, depthTest: false, ...ADD,
        uniforms: { uTime, uScale: { value: this.uScale }, uCol: { value: new THREE.Vector3(1.6, 1.5, 1.4) }, uCore: { value: new THREE.Vector3(12, 11, 10) } } }));
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 30; S.add(mesh);
    }
    // --- our atom
    {
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([2.4, 2.0, 1.5]), 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([1.4]), 1));
      g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array([0.6]), 1));
      const m = keep(pointsMaterial({ uTime, uSizeK: { value: 40 }, uMaxSize: { value: 5 } }));
      m.uniforms.uScale.value = this.uScale;
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 25; S.add(p);
      N.atom = p;
    }
  }

  atomNursery(t) {
    const end = this.nursery.atomStar;
    const k = easeOutCubic(clamp(t / 6.0));
    return new THREE.Vector3(end.x - lerp(9, 0, k), end.y - lerp(7, 0, k), end.z + lerp(10, 0, k));
  }

  updateNursery(t) {
    const N = this.nursery, cam = N.camera;
    N.uTime.value = t;
    const x = clamp((t + 1.5) / 14.0);
    cam.position.set(lerp(-2, 6, x), lerp(-4, 2, x), lerp(10, -26, x));
    const look = new THREE.Vector3(lerp(-4, 2, x), lerp(-2, 8, x), -120);
    cam.up.set(Math.sin(0.03 - 0.03 * x), 1, 0);
    cam.lookAt(look); cam.updateMatrixWorld();
    const atom = this.atomNursery(t);
    N.atom.geometry.attributes.position.array.set([atom.x, atom.y, atom.z]);
    N.atom.geometry.attributes.position.needsUpdate = true;
    N.atom.visible = t < 6.0;
    const dark = 1 - 0.55 * smoothstep(8.5, 12, t);
    return {
      scene: N.scene, camera: cam,
      target: t < 6.0 ? atom : null,
      post: {
        exposure: 1.0 * dark, bloomStrength: 0.7, bloomThreshold: 0.8, bloomKnee: 0.7, bloomRadius: 0.85,
        streak: 0.14, streakTint: [1.0, 0.8, 0.6], saturation: 1.08, contrast: 1.08, vignette: 0.5,
        tint: [1.02, 0.98, 0.95], grain: 0.045, ca: 0.002,
        fade: smoothstep(10.8, 12.0, t),
      },
    };
  }

  update(shot, t, T) {
    if (shot.mode === 'nursery') return this.updateNursery(t);
    return this.updateEye(t);
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
    this.disposables = [];
  }
}
