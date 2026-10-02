// EARTH scene: 'young' (orbital sunrise over the young Earth) and 'redgiant' (the swollen Sun and the scorched Earth).
//
// Young: one full-screen ray-traced pass. Analytic sphere + single-scattering Rayleigh/Mie atmosphere
// (with planet shadowing), equirect albedo / cloud maps baked once at init, ocean glint, moonlit night side
// (the young Moon was far closer and brighter), and a screen-space sunrise starburst.
import * as THREE from '../../vendor/three.module.js';
import { simplex3, hash } from '../lib/glsl.js';
import { Rand, fbm1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, easeInOutCubic, easeOutCubic, easeInOutSine } from '../lib/ease.js';
import { makeStarfield, bake, fsQuad } from '../lib/cosmos.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ baked planet maps (equirect)
const DIR_FROM_UV = /* glsl */`
float fbmo(vec3 p, int oct){ float s=0.0,a=0.5; for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*snoise(p); p=p*2.02+vec3(17.1,9.2,3.7); a*=0.5; } return s; }
vec3 dirFromUv(vec2 uv){ float lon = (uv.x - 0.5)*6.2831853; float lat = (uv.y - 0.5)*3.1415927;
  return vec3(cos(lat)*sin(lon), sin(lat), cos(lat)*cos(lon)); }`;

const ALBEDO_BAKE = simplex3 + DIR_FROM_UV + /* glsl */`
uniform vec3 uKeep; varying vec2 vUv;
void main(){
  vec3 d = dirFromUv(vUv);
  vec3 w = vec3(fbmo(d*1.3 + 3.1, 3), fbmo(d*1.3 + 7.7, 3), fbmo(d*1.3 + 1.9, 3));
  float c = fbmo(d*1.7 + w*0.6, 5) + 0.25*fbmo(d*6.0 + 2.0, 3);
  float keep = smoothstep(0.25, 0.6, distance(d, uKeep));
  float land = smoothstep(0.30, 0.34, c*keep + (1.0 - keep)*-0.5);
  // island arcs / volcanic chains
  float arcs = smoothstep(0.83, 0.9, 1.0 - abs(fbmo(d*3.0 + 9.0, 4)))*smoothstep(0.1, 0.3, fbmo(d*9.0 + 4.0, 3))*keep;
  land = max(land, arcs);
  float shelf = smoothstep(0.16, 0.30, c*keep - 0.5*(1.0-keep));
  vec3 deep = vec3(0.004, 0.017, 0.05), shallow = vec3(0.012, 0.075, 0.095);
  vec3 ocean = mix(deep, shallow, shelf*0.85);
  ocean *= 0.8 + 0.4*(fbmo(d*4.0 + 12.0, 3)*0.5 + 0.5);
  float n = fbmo(d*14.0 + 5.0, 3);
  vec3 rock = mix(vec3(0.07, 0.06, 0.055), vec3(0.14, 0.085, 0.06), smoothstep(-0.3, 0.4, n));
  rock = mix(rock, vec3(0.03, 0.03, 0.03), smoothstep(0.3, 0.6, fbmo(d*5.0 - 3.0, 3)));
  vec3 col = mix(ocean, rock, land);
  // volcanic hot spots (glow on the night side), stored in alpha above 0.5 as emission
  float hot = land*smoothstep(0.62, 0.75, fbmo(d*22.0 + 30.0, 3));
  gl_FragColor = vec4(col, land*0.5 + hot*0.5);
}`;

const CLOUD_BAKE = simplex3 + DIR_FROM_UV + /* glsl */`
uniform vec4 uCyc[7]; varying vec2 vUv;
vec3 swirl(vec3 p){
  for (int i = 0; i < 7; i++){
    vec3 c = normalize(uCyc[i].xyz); float s = uCyc[i].w;
    float d = distance(p, c); float a = s*exp(-d*d*18.0)*9.0;
    // rotate p around axis c
    vec3 k = c; p = p*cos(a) + cross(k, p)*sin(a) + k*dot(k, p)*(1.0 - cos(a));
  }
  return p;
}
void main(){
  vec3 d = dirFromUv(vUv);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec3 p = swirl(d);
  // zonal stretching (jet streams) + domain warp
  vec3 q = vec3(p.x, p.y*1.8, p.z);
  vec3 w = vec3(fbmo(q*2.0 + 1.0, 4), fbmo(q*2.0 + 6.0, 4), fbmo(q*2.0 + 11.0, 4));
  float n = fbmo(q*3.2 + w*0.9, 5) + 0.35*fbmo(q*9.0 + w*1.5, 4);
  float band = 0.55 + 0.35*exp(-lat*lat*40.0) + 0.3*exp(-pow(abs(lat) - 0.85, 2.0)*30.0) - 0.25*exp(-pow(abs(lat) - 0.42, 2.0)*60.0);
  float cl = smoothstep(0.08, 0.4, n*0.95 + band*0.45 - 0.17 + (fbmo(q*14.0 + w, 3))*0.12);
  float fine = fbmo(q*20.0 + w*2.0, 3)*0.5 + 0.5;
  cl *= 0.7 + 0.5*fine;
  float cir = smoothstep(0.1, 0.7, fbmo(vec3(p.x*1.5, p.y*5.0, p.z*1.5) + 21.0 + w, 4))*0.6;
  gl_FragColor = vec4(clamp(cl, 0.0, 1.0), cir, 0.0, 1.0);
}`;

// ------------------------------------------------------------------ the planet + atmosphere + sun
const PLANET_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tAlb, tCloud;
uniform vec3 uCam, uSun, uMoon, uCamF, uCamR, uCamU;
uniform vec2 uTan, uRes, uSunScr;
uniform float uAirglow, uDawn, uTime, uSpin, uCloudSpin, uSunI, uMoonI, uSunVis, uSunRed, uGlare, uScale;
varying vec2 vUv;
const float R = 1.0, RA = 1.03, HR = 0.0036, HM = 0.0013;
const vec3 BR = vec3(13.0, 30.0, 74.0);
const float BM = 22.0;
vec2 sph(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd); float c = dot(ro, ro) - r*r; float h = b*b - c; if (h < 0.0) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }
vec2 uvOf(vec3 d){ return vec2(atan(d.x, d.z)/6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0))/3.1415927 + 0.5); }
// optical depth from p toward the sun (4 samples); returns large value if the planet blocks
vec2 lightDepth(vec3 p, vec3 L){
  vec2 hp = sph(p, L, R);
  if (hp.x > 0.0) return vec2(1e3);
  float tx = sph(p, L, RA).y; float ds = tx/4.0; vec2 od = vec2(0.0);
  for (int j = 0; j < 4; j++){ vec3 q = p + L*(ds*(float(j) + 0.5)); float h = length(q) - R; od += vec2(exp(-h/HR), exp(-h/HM))*ds; }
  return od;
}
void main(){
  vec2 ndc = vUv*2.0 - 1.0;
  vec3 rd = normalize(uCamF + ndc.x*uTan.x*uCamR + ndc.y*uTan.y*uCamU);
  vec3 ro = uCam;
  vec3 col = vec3(0.0); float cover = 0.0;
  float mu = dot(rd, uSun);
  vec2 ta = sph(ro, rd, RA);
  vec2 tp = sph(ro, rd, R);
  bool hit = tp.x > 0.0 && tp.x < 1e8;
  vec3 Tview = vec3(1.0);
  if (ta.y > 0.0 && ta.x < 1e8) {
    float t0 = max(ta.x, 0.0), t1 = hit ? tp.x : ta.y;
    const int N = 14; float ds = (t1 - t0)/float(N);
    vec2 od = vec2(0.0); vec3 sR = vec3(0.0), sM = vec3(0.0), mR = vec3(0.0);
    for (int i = 0; i < N; i++){
      vec3 p = ro + rd*(t0 + ds*(float(i) + 0.5));
      float h = max(length(p) - R, 0.0);
      vec2 d = vec2(exp(-h/HR), exp(-h/HM))*ds;
      od += d;
      vec2 ld = lightDepth(p, uSun);
      vec3 T = exp(-(BR*(od.x + ld.x) + BM*1.1*(od.y + ld.y)));
      sR += d.x*T; sM += d.y*T;
      mR += d.x*exp(-(BR*od.x + BM*1.1*od.y));
    }
    Tview = exp(-(BR*od.x + BM*1.1*od.y));
    float pR = 0.0597*(1.0 + mu*mu);
    float g = 0.76; float pM = 0.1194*((1.0 - g*g)*(1.0 + mu*mu))/((2.0 + g*g)*pow(1.0 + g*g - 2.0*g*mu, 1.5));
    float muM = dot(rd, uMoon);
    col += uSunI*(sR*BR*pR + sM*BM*pM);
    col += uMoonI*mR*BR*0.0597*(1.0 + muM*muM)*vec3(0.75, 0.85, 1.0);
    cover = hit ? 1.0 : clamp(1.0 - dot(Tview, vec3(0.333)), 0.0, 1.0);
    // night airglow: a thin emissive shell (O 557.7 nm green), seen edge-on at the limb
    {
      vec2 tg = sph(ro, rd, R + 0.0128); vec2 tg2 = sph(ro, rd, R + 0.0112);
      float lenOuter = max(min(tg.y, hit ? tp.x : 1e9) - max(tg.x, 0.0), 0.0);
      float lenInner = (tg2.y > 0.0 && tg2.x < 1e8) ? max(min(tg2.y, hit ? tp.x : 1e9) - max(tg2.x, 0.0), 0.0) : 0.0;
      float path = max(lenOuter - lenInner, 0.0);
      col += vec3(0.3, 1.0, 0.5)*path*uAirglow*0.35;
    }
  }
  if (hit) {
    vec3 p = ro + rd*tp.x; vec3 n = normalize(p);
    vec3 nb = rotY(n, -uSpin);
    vec4 alb = texture2D(tAlb, uvOf(nb));
    float land = clamp(alb.a*2.0, 0.0, 1.0), hot = max(alb.a*2.0 - 1.0, 0.0);
    vec3 nc = rotY(n, -uCloudSpin);
    vec4 cl = texture2D(tCloud, uvOf(nc));
    vec3 nc2 = rotY(n, -uCloudSpin*1.35 + 0.4);
    float cir = texture2D(tCloud, uvOf(nc2)).g;
    float cloud = clamp(cl.r + cir*0.35, 0.0, 1.0);
    // cloud shadow
    vec3 ns = rotY(normalize(n + uSun*0.012), -uCloudSpin);
    float csh = 1.0 - 0.6*texture2D(tCloud, uvOf(ns)).r;
    vec2 ldS = lightDepth(p + n*0.0008, uSun);
    vec3 Tsun = exp(-(BR*ldS.x + BM*1.1*ldS.y));
    float NdL = dot(n, uSun);
    float day = smoothstep(-0.02, 0.12, NdL);
    vec3 V = -rd;
    // ground / ocean
    vec3 E = uSunI*0.11*Tsun;            // direct sun irradiance (HDR)
    vec3 ground = alb.rgb*max(NdL, 0.0)*E*csh;
    // ocean glint
    vec3 H = normalize(uSun + V);
    float NdH = max(dot(n, H), 0.0), NdV = max(dot(n, V), 0.0);
    float rough = 0.09; float a2 = rough*rough;
    float D = a2/(3.14159*pow(NdH*NdH*(a2 - 1.0) + 1.0, 2.0));
    float F = 0.02 + 0.98*pow(1.0 - max(dot(H, V), 0.0), 5.0);
    float spec = D*F*0.25/max(NdV*0.5 + 0.5, 0.2);
    ground += (1.0 - land)*spec*max(NdL, 0.0)*E*csh*(1.0 - cloud);
    // sky reflection on water (fresnel)
    float Fv = 0.02 + 0.98*pow(1.0 - NdV, 5.0);
    ground += (1.0 - land)*Fv*vec3(0.05, 0.12, 0.3)*day*uSunI*0.012;
    // moonlight (cool, soft)
    float NdM = max(dot(n, uMoon), 0.0);
    vec3 moonE = uMoonI*0.11*vec3(0.62, 0.74, 1.0);
    ground += alb.rgb*NdM*moonE*2.0;
    vec3 Hm = normalize(uMoon + V); float NdHm = max(dot(n, Hm), 0.0);
    float Dm = 0.02/(3.14159*pow(NdHm*NdHm*(0.02 - 1.0) + 1.0, 2.0));
    ground += (1.0 - land)*Dm*0.05*NdM*moonE*(1.0 - cloud);
    // clouds: bright, slightly wrapped lighting; thicker clouds self-shadow
    float wrap = clamp((NdL + 0.08)/1.08, 0.0, 1.0);
    vec3 cc = vec3(0.92, 0.94, 0.97)*(wrap*E*(0.75 + 0.25*cl.r) + NdM*moonE*1.6);
    vec3 surf = mix(ground, cc, cloud);
    // volcanic glow on the night side
    surf += vec3(1.0, 0.28, 0.05)*hot*hot*(1.0 - day)*(1.0 - cloud*0.8)*0.6;
    col = surf*Tview + col;
  }
  // sun disk (only where not blocked by the planet)
  float sunAng = acos(clamp(mu, -1.0, 1.0));
  if (!hit) {
    float disk = 1.0 - smoothstep(0.0046, 0.0058, sunAng);
    col += disk*Tview*vec3(1.0, 0.95, 0.88)*40.0*mix(vec3(1.0), vec3(1.0, 0.55, 0.25), uSunRed);
  }
  // twilight arc: forward-scattered dawn light hugging the limb around the sun's azimuth
  {
    float b = -dot(ro, rd); float hmin = length(ro + rd*max(b, 0.0)) - R;
    float band = hit ? exp(-max(tp.y - tp.x, 0.0)*9.0)*0.7 : exp(-max(hmin, 0.0)/0.010);
    float near = exp(-(1.0 - mu)*70.0) + 0.22*exp(-(1.0 - mu)*16.0);
    vec3 dc = mix(vec3(1.0, 0.32, 0.08), vec3(0.35, 0.55, 1.0), smoothstep(0.0, 0.03, hmin));
    col += dc*band*near*uDawn*2.2;
  }
  // lens glare + starburst centred on the sun's screen position (a lens effect: drawn over everything)
  vec2 dp = (vUv*uRes - uSunScr)/uScale;
  float dd = length(dp);
  float ang = atan(dp.y, dp.x);
  float rays = 0.0;
  rays += pow(abs(cos(ang*3.0 + 0.3)), 900.0)*exp(-dd/150.0);
  rays += 0.5*pow(abs(cos(ang*5.0 + 1.1)), 1400.0)*exp(-dd/90.0);
  rays *= smoothstep(4.0, 20.0, dd);
  float glow = exp(-dd/10.0)*1.0 + exp(-dd/40.0)*0.06 + exp(-dd/260.0)*0.025;
  vec3 gcol = mix(vec3(1.0, 0.92, 0.82), vec3(1.0, 0.6, 0.3), uSunRed);
  col += uGlare*(glow + rays*0.7)*gcol;
  gl_FragColor = vec4(col, max(cover, 0.0));
}`;

// ------------------------------------------------------------------ red giant
const RG = { Rs: 16, Re: 0.62, earth: [-10.2, 3.2, 22.5], fov: 34 };

const SUN_VERT = /* glsl */`
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
void main(){ vN = normal; vWN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vWP = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const SUN_FRAG = simplex3 + /* glsl */`
uniform vec3 uCamPos; uniform float uTime, uGain;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
vec3 h33(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx)*p.zyx); }
// cellular noise: returns (F1, F2) with slowly drifting feature points
vec2 cells(vec3 p, float t){
  vec3 i = floor(p), f = fract(p); float F1 = 9.0, F2 = 9.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = h33(i + g);
    o = 0.5 + 0.38*sin(t + 6.2831*o);
    float d = length(g + o - f);
    if (d < F1) { F2 = F1; F1 = d; } else if (d < F2) F2 = d;
  }
  return vec2(F1, F2);
}
vec3 ramp(float T){
  vec3 c = mix(vec3(0.05, 0.003, 0.0), vec3(0.32, 0.025, 0.004), smoothstep(0.0, 0.35, T));
  c = mix(c, vec3(0.78, 0.085, 0.012), smoothstep(0.3, 0.62, T));
  c = mix(c, vec3(1.25, 0.25, 0.04), smoothstep(0.6, 0.85, T));
  c = mix(c, vec3(1.9, 0.6, 0.16), smoothstep(0.84, 1.05, T));
  return c;
}
void main(){
  vec3 V = normalize(uCamPos - vWP);
  float mu = clamp(dot(normalize(vWN), V), 0.0, 1.0);
  vec3 n = normalize(vN);
  float t = uTime;
  vec3 w = vec3(snoise(n*2.0 + vec3(0.0, t*0.03, 0.0)), snoise(n*2.0 + vec3(5.2, -t*0.025, 1.0)), snoise(n*2.0 + vec3(2.0, 3.0, t*0.025)));
  vec3 p = n + w*0.11;
  vec3 pw = p;
  vec2 cb = cells(pw*2.4, t*0.06);
  float blob = smoothstep(0.05, 0.95, 1.0 - cb.x);                  // giant convective upwellings
  float lane = 1.0 - smoothstep(0.0, 0.1, cb.y - cb.x);             // narrow downflow lanes
  float gran = smoothstep(0.0, 0.3, abs(snoise(pw*15.0 + vec3(0.0, t*0.08, 0.0))));   // fine granulation network
  float tb = 0.0, amp = 0.5; vec3 q = pw*3.2 + vec3(0.0, t*0.03, 0.0);
  for (int i = 0; i < 3; i++){ tb += amp*abs(snoise(q)); q = q*2.1 + 3.1; amp *= 0.5; }
  float spots = smoothstep(0.45, 0.8, snoise(n*1.1 + vec3(9.0, 1.0, t*0.008)));
  float T = 0.22 + 0.38*blob*blob + 0.07*gran + 0.16*tb - 0.13*lane - 0.2*spots + 0.1*smoothstep(0.55, 0.9, blob*tb*2.2);
  float ld = pow(mu, 0.6);
  T *= mix(0.6, 1.0, ld);
  vec3 col = ramp(T)*(0.32 + 0.68*ld);
  col += vec3(0.75, 0.13, 0.025)*pow(1.0 - mu, 3.0)*0.75;
  gl_FragColor = vec4(col*uGain, 1.0);
}`;

const CORONA_FRAG = simplex3 + /* glsl */`
uniform vec2 uC, uRes, uTan; uniform float uRpx, uTime, uGain, uScale, uRs;
uniform vec3 uCam, uCamF, uCamR, uCamU;
varying vec2 vUv;
void main(){
  vec2 p = vUv*uRes - uC; float a = atan(p.y, p.x);
  vec2 ndc = vUv*2.0 - 1.0;
  vec3 rd = normalize(uCamF + ndc.x*uTan.x*uCamR + ndc.y*uTan.y*uCamU);
  float b = -dot(uCam, rd); float dmin = length(uCam + rd*b);
  float x = (dmin - uRs)/uRs;   // height of the ray's closest approach above the photosphere
  if (x < -0.02) { gl_FragColor = vec4(0.0); return; }
  vec2 cs = vec2(cos(a), sin(a));
  float str = snoise(vec3(cs*2.5, uTime*0.03)) * 0.5 + 0.5;
  float str2 = snoise(vec3(cs*9.0, uTime*0.05 + 4.0))*0.5 + 0.5;
  float spic = snoise(vec3(cs*60.0, x*12.0 - uTime*0.4))*0.5 + 0.5;
  float xx = max(x, 0.0);
  float g = 0.45*exp(-xx/0.01)*(0.7 + 0.6*spic) + 0.35*exp(-xx/0.045)*(0.5 + 0.8*str2) + 0.16*exp(-xx/0.22)*(0.4 + 1.2*str) + 0.04*exp(-xx/0.9);
  vec3 c = mix(vec3(1.0, 0.36, 0.08), vec3(0.75, 0.08, 0.04), smoothstep(0.0, 0.3, xx));
  c = mix(c, vec3(0.35, 0.03, 0.06), smoothstep(0.25, 1.2, xx));
  // the red giant's dusty wind: faint mottled haze far out
  float haze = (snoise(vec3(p/uScale*0.004, uTime*0.01))*0.5 + 0.5)*smoothstep(0.1, 0.8, xx)*exp(-xx/2.0)*0.05;
  gl_FragColor = vec4((c*g + vec3(0.5, 0.08, 0.05)*haze)*uGain*smoothstep(-0.02, 0.0, x), 1.0);
}`;

const LOOP_VERT = simplex3 + /* glsl */`
attribute vec4 aL;   // loop index (as float), s0, strand offset u, v
attribute vec4 aS;   // speed, brightness, rand, rand2
uniform vec4 uLA[12]; uniform vec4 uLB[12]; uniform float uTime, uFocal, uMinPx, uRs, uGain, uSizeMul;
varying vec3 vCol;
vec3 slerpN(vec3 a, vec3 b, float s){ float d = clamp(dot(a, b), -1.0, 1.0); float th = acos(d); if (th < 1e-3) return a; return normalize((sin((1.0-s)*th)*a + sin(s*th)*b)/sin(th)); }
void main(){
  int li = int(aL.x + 0.5);
  vec4 A = uLA[0], B = uLB[0];
  for (int i = 0; i < 12; i++) if (i == li) { A = uLA[i]; B = uLB[i]; }
  float H = A.w, grow = B.w, lf = float(li)*7.31;
  float s = fract(aL.y + aS.x*uTime);
  vec3 a = normalize(A.xyz), b = normalize(B.xyz);
  vec3 base = slerpN(a, b, s);
  float Ht = H*(1.0 + grow*uTime);
  float arch = sin(3.14159*s);
  float h = Ht*pow(arch, 0.7)*(1.0 + 0.25*snoise(vec3(s*3.0, lf, uTime*0.05)));
  vec3 tang = normalize(b - a);
  vec3 side = normalize(cross(base, tang));
  // the whole arch writhes and leans
  vec3 bend = side*snoise(vec3(s*2.5 + lf, uTime*0.06, 1.0))*0.35*Ht + tang*snoise(vec3(s*2.0, lf, uTime*0.05 + 5.0))*0.2*Ht;
  float tw = s*11.0 + aS.z*6.28 + uTime*0.15;
  float th = (0.01 + 0.035*arch)*(1.0 + 0.6*snoise(vec3(s*6.0, lf, 2.0)));
  vec3 off = (side*cos(tw)*aL.z + base*sin(tw)*aL.w)*th*(1.0 + Ht*2.0);
  vec3 pos = (base*(1.0 + h) + bend + off)*uRs;
  vec4 mv = modelViewMatrix*vec4(pos, 1.0);
  float d = -mv.z;
  float sz = 0.08*uSizeMul*(0.6 + aS.w)*uFocal/d; float sp = max(sz, uMinPx);
  float knots = 0.35 + 1.3*pow(0.5 + 0.5*snoise(vec3(s*9.0, lf + aS.z*0.3, uTime*0.2)), 3.0);
  float foot = 0.7 + 0.8*(1.0 - arch);
  vec3 c = mix(vec3(1.0, 0.3, 0.07), vec3(0.9, 0.1, 0.08), smoothstep(0.03, 0.3, h));
  vCol = c*aS.y*foot*knots*uGain*(sz*sz)/(sp*sp);
  gl_PointSize = sp;
  gl_Position = projectionMatrix*mv;
}`;

const EARTH_VERT = SUN_VERT;
const EARTH_FRAG = simplex3 + /* glsl */`
uniform vec3 uCamPos, uSunPos; uniform float uTime, uGain;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 n = normalize(vWN), V = normalize(uCamPos - vWP), L = normalize(uSunPos - vWP);
  vec3 on = normalize(vN);
  float NdL = dot(n, L), mu = max(dot(n, V), 0.0);
  float r1 = 1.0 - abs(snoise(on*5.0 + 3.0)); float r2 = 1.0 - abs(snoise(on*13.0 + 7.0)); float r3 = 1.0 - abs(snoise(on*30.0));
  float crack = pow(r1, 40.0)*1.0 + pow(r2, 50.0)*0.6 + pow(r3, 60.0)*0.3;
  float mag = smoothstep(0.2, 0.7, snoise(on*2.0 + 11.0));      // molten basins
  vec3 rock = mix(vec3(0.035, 0.028, 0.025), vec3(0.06, 0.035, 0.025), snoise(on*8.0)*0.5 + 0.5);
  vec3 lava = vec3(1.0, 0.24, 0.035);
  float day = smoothstep(-0.15, 0.4, NdL);
  vec3 col = rock*(max(NdL, 0.0)*vec3(1.6, 0.55, 0.22)*2.0);
  col += lava*(crack*(0.9 + 1.2*day) + mag*0.08*(0.3 + day))*(0.9 + 0.1*sin(uTime*1.7 + on.x*20.0));
  col += vec3(1.0, 0.4, 0.1)*day*day*0.6;                          // the day side glows: surface at ~1500 K
  // thin, boiling-off atmosphere lit from behind
  float rim = pow(1.0 - mu, 4.0);
  col += vec3(1.0, 0.4, 0.14)*rim*(0.15 + 2.2*smoothstep(-0.2, 0.7, NdL));
  gl_FragColor = vec4(col*uGain, 1.0);
}`;

const TAIL_VERT = /* glsl */`
attribute vec4 aT;   // u0, speed, lateral x, lateral y
attribute vec4 aK;   // type (0 dust/gas, 1 ion), size, rand, wrap angle
uniform vec3 uE, uA, uO, uB; uniform float uTime, uFocal, uMinPx, uRe, uLen, uGain, uStrip, uSizeMul;
varying vec3 vCol;
void main(){
  float u = fract(aT.x + aT.y*uTime);
  float ion = aK.x;
  float L = uLen*(ion > 0.5 ? 1.25 : 1.0);
  float along = u*u*0.6 + u*0.4;
  vec2 lat = aT.zw*(0.35 + 2.6*u*(ion > 0.5 ? 0.15 : 1.0));
  // near the planet the flow wraps around the limb before streaming off
  float wrap = (1.0 - smoothstep(0.0, 0.08, u));
  vec3 ring = (cos(aK.w)*uO + sin(aK.w)*uB)*uRe*1.15;
  vec3 pos = uE + uA*(along*L) + (uO*lat.x + uB*lat.y)*uRe + ring*wrap - uA*uRe*0.6*wrap;
  pos += uO*(u*u*L*0.18)*(1.0 - ion);   // dust tail lags the orbit and curves
  vec4 mv = modelViewMatrix*vec4(pos, 1.0);
  float d = -mv.z;
  float sz = 0.05*aK.y*uSizeMul*uFocal/d; float sp = max(sz, uMinPx);
  vec3 c = ion > 0.5 ? vec3(0.35, 0.45, 1.0)*0.9 : mix(vec3(1.0, 0.36, 0.12), vec3(0.55, 0.08, 0.16), smoothstep(0.02, 0.4, u));
  float fade = smoothstep(0.0, 0.05, u)*(1.0 - smoothstep(0.3, 1.0, u))*(0.35 + 0.65*smoothstep(0.02, 0.2, u));
  vCol = c*fade*uGain*uStrip*(0.5 + aK.z)*(sz*sz)/(sp*sp);
  gl_PointSize = sp;
  gl_Position = projectionMatrix*mv;
}`;

// ------------------------------------------------------------------ young-Earth staging
const YOUNG = {
  fovV: 2 * Math.atan(7.53 / 50) * 180 / Math.PI, // 50mm on a 2.39:1 gate
  D: 1.62, IGN: 7.0,
  sunEl: 0.42,       // sun elevation out of the orbit plane
  omega: 0.016,      // camera arc rate (rad/s)
};

export default class Earth {
  constructor(ctx) {
    this.ctx = ctx; this.W = ctx.width; this.H = ctx.height; this.uScale = ctx.height / 804;
    this.built = {};
  }
  async init() {}

  _young() {
    if (this.built.young) return this.built.young;
    const r = this.ctx.renderer;
    // target ocean point (planet frame); keep it free of land in the bake
    const keep = this._surfacePoint(4.0, -0.4, -0.32);
    const albRT = bake(r, 2048, 1024, ALBEDO_BAKE, { uKeep: { value: keep } }, { mipmaps: false, wrapS: THREE.RepeatWrapping, type: THREE.UnsignedByteType });
    const rnd = new Rand(31);
    const cyc = [];
    for (let i = 0; i < 7; i++) { const v = [0, 0, 0]; rnd.onSphere(v); v[1] = Math.sign(v[1] || 1) * (0.25 + 0.4 * Math.abs(v[1])); cyc.push(new THREE.Vector4(v[0], v[1], v[2], (v[1] > 0 ? 1 : -1) * rnd.range(0.6, 1.0))); }
    const cloudRT = bake(r, 2048, 1024, CLOUD_BAKE, { uCyc: { value: cyc } }, { mipmaps: false, wrapS: THREE.RepeatWrapping, type: THREE.UnsignedByteType });
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tAlb: { value: albRT.texture }, tCloud: { value: cloudRT.texture },
        uCam: { value: V3(0, 0, 0) }, uSun: { value: V3(1, 0, 0) }, uMoon: { value: V3(0, 0, 1) },
        uCamF: { value: V3(0, 0, -1) }, uCamR: { value: V3(1, 0, 0) }, uCamU: { value: V3(0, 1, 0) },
        uTan: { value: new THREE.Vector2(1, 1) }, uRes: { value: new THREE.Vector2(this.W, this.H) }, uSunScr: { value: new THREE.Vector2() },
        uAirglow: { value: 0.6 }, uDawn: { value: 0 }, uTime: { value: 0 }, uSpin: { value: 0 }, uCloudSpin: { value: 0 }, uSunI: { value: 22 }, uMoonI: { value: 1 },
        uSunVis: { value: 0 }, uSunRed: { value: 1 }, uGlare: { value: 0 }, uScale: { value: this.uScale },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: PLANET_FRAG,
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    const quad = fsQuad(mat);
    const camera = new THREE.PerspectiveCamera(YOUNG.fovV, this.ctx.aspect, 0.01, 100);
    const stars = makeStarfield({ seed: 77, count: 14000, scale: this.uScale, brightness: 0.75, band: { normal: [0.1, 0.95, 0.3], width: 0.14, frac: 0.4 } });
    const sceneBG = new THREE.Scene(); sceneBG.add(stars);
    this.built.young = { albRT, cloudRT, mat, quad, camera, stars, sceneBG, keep };
    return this.built.young;
  }

  // Closed-form staging: camera arcs around the planet; the sun (fixed) clears the limb at t = IGN.
  _youngRig(t) {
    const Y = YOUNG;
    const e1 = V3(1, 0, 0), e2 = V3(0, 0, 1), e3 = V3(0, 1, 0);
    const psi = t => Y.omega * t;
    const C = tt => e1.clone().multiplyScalar(Math.cos(psi(tt)) * Y.D).addScaledVector(e2, Math.sin(psi(tt)) * Y.D);
    // sun: solve azimuth so that the line of sight from C(IGN) toward S just grazes radius Rg
    const Rg = 1.0;
    const Ci = C(Y.IGN);
    const el = Y.sunEl;
    // search azimuth (continuous) for tangent condition: |Ci x S| = Rg with Ci.S < 0
    let best = 0, bestErr = 1e9;
    for (let a = 0; a < Math.PI * 2; a += 0.0005) {
      const S = e1.clone().multiplyScalar(Math.cos(a) * Math.cos(el)).addScaledVector(e2, Math.sin(a) * Math.cos(el)).addScaledVector(e3, Math.sin(el));
      if (Ci.dot(S) >= 0) continue;
      const err = Math.abs(Ci.clone().cross(S).length() - Rg);
      // pick the branch where moving forward in psi brings the sun out (sun "ahead" of the camera)
      const fwd = C(Y.IGN + 0.5); const errF = fwd.clone().cross(S).length();
      if (errF <= Rg) continue;
      if (err < bestErr) { bestErr = err; best = a; }
    }
    const S = e1.clone().multiplyScalar(Math.cos(best) * Math.cos(el)).addScaledVector(e2, Math.sin(best) * Math.cos(el)).addScaledVector(e3, Math.sin(el)).normalize();
    return { C, S, psi };
  }

  // pure camera framing for the young-Earth shot
  _frameAt(t) {
    if (!this._rig) this._rig = this._youngRig(0);
    const { C, S } = this._rig;
    const cp = C(t);
    const up0 = cp.clone().normalize();
    const tanV = Math.tan(THREE.MathUtils.degToRad(YOUNG.fovV / 2)), tanH = tanV * this.ctx.aspect;
    const az = S.clone().addScaledVector(up0, -S.dot(up0)).normalize();
    const dip = Math.acos(1 / cp.length());
    const L = az.clone().multiplyScalar(Math.cos(dip)).addScaledVector(up0, -Math.sin(dip)).normalize();
    let rr = L.clone().cross(up0).normalize(); let uu = rr.clone().cross(L).normalize();
    const sx = lerp(0.30, 0.22, t / 12), sy = -0.2 + 0.02 * Math.sin(t * 0.2);
    const f = L.clone().addScaledVector(rr, -sx * tanH).addScaledVector(uu, -sy * tanV).normalize();
    rr = f.clone().cross(up0).normalize(); uu = rr.clone().cross(f).normalize();
    const roll = THREE.MathUtils.degToRad(-7 + 2 * Math.sin(t * 0.15));
    const r2 = rr.clone().multiplyScalar(Math.cos(roll)).addScaledVector(uu, Math.sin(roll));
    const u2 = uu.clone().multiplyScalar(Math.cos(roll)).addScaledVector(rr, -Math.sin(roll));
    return { cp, f, r2, u2, tanH, tanV, S };
  }
  static spin(t) { return 0.012 * t + 0.3; }
  // planet-frame direction of the ocean point under screen NDC (x,y) at time t
  _surfacePoint(t, x, y) {
    const F = this._frameAt(t);
    const rd = F.f.clone().addScaledVector(F.r2, x * F.tanH).addScaledVector(F.u2, y * F.tanV).normalize();
    const b = F.cp.dot(rd), c = F.cp.lengthSq() - 1, h = b * b - c;
    const tt = -b - Math.sqrt(Math.max(h, 0));
    const p = F.cp.clone().addScaledVector(rd, tt).normalize();
    const a = -Earth.spin(t); // world -> planet frame (rotY(p, -spin))
    return V3(Math.cos(a) * p.x + Math.sin(a) * p.z, p.y, -Math.sin(a) * p.x + Math.cos(a) * p.z);
  }

  updateYoung(shot, t, T) {
    const B = this._young();
    const tc = clamp(t, -1, 13);
    const F = this._frameAt(tc);
    const { cp, f, r2, u2, tanH, tanV, S } = F;
    const cam = B.camera;
    cam.position.copy(cp);
    cam.up.copy(u2); cam.lookAt(cp.clone().add(f)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    B.stars.position.copy(cp);

    const u = B.mat.uniforms;
    u.uCam.value.copy(cp); u.uSun.value.copy(S);
    u.uCamF.value.copy(f); u.uCamR.value.copy(r2); u.uCamU.value.copy(u2);
    u.uTan.value.set(tanH, tanV);
    // the young Moon: big and bright, roughly behind the camera
    u.uMoon.value.copy(cp.clone().normalize().multiplyScalar(0.8).addScaledVector(u2, 0.5).addScaledVector(r2, -0.3).normalize());
    u.uTime.value = tc; u.uSpin.value = Earth.spin(tc); u.uCloudSpin.value = 0.02 * tc + 0.3;
    const sunR = 0.0052;
    const dLine = cp.clone().cross(S).length(); // distance of the sun line from the planet centre
    const vis = smoothstep(1.0 - sunR * 1.2, 1.0 + sunR * 1.2, dLine);
    const red = 1 - smoothstep(1.0, 1.025, dLine);
    u.uSunVis.value = vis; u.uSunRed.value = red;
    u.uDawn.value = smoothstep(1.0 - 0.06, 1.0, dLine) * (1 - 0.5 * smoothstep(1.0, 1.04, dLine));
    const sp = cp.clone().add(S.clone().multiplyScalar(50)).project(cam);
    u.uSunScr.value.set((sp.x * 0.5 + 0.5) * this.W, (sp.y * 0.5 + 0.5) * this.H);
    const burst = vis * (0.45 + 0.8 * Math.exp(-Math.max(0, tc - YOUNG.IGN) * 1.0));
    u.uGlare.value = burst;
    u.uMoonI.value = 1.7;

    // target: our ocean point, riding the planet's rotation
    const a = Earth.spin(tc); const k = B.keep;
    const tw = V3(Math.cos(a) * k.x + Math.sin(a) * k.z, k.y, -Math.sin(a) * k.x + Math.cos(a) * k.z);
    const render = (renderer, target) => {
      const ac = renderer.autoClear; renderer.autoClear = false;
      renderer.render(B.sceneBG, cam);
      renderer.render(B.quad.scene, B.quad.cam);
      renderer.autoClear = ac;
    };
    return {
      scene: B.sceneBG, camera: cam, render, target: tw,
      post: {
        exposure: 1.0, bloomStrength: 0.6 + 0.35 * burst, bloomThreshold: 1.1, bloomKnee: 0.6, bloomRadius: 0.8,
        streak: 0.08 + 0.3 * burst, streakTint: [1.0, 0.72, 0.45], ca: 0.0018, vignette: 0.42, grain: 0.04,
        saturation: 1.12, contrast: 1.06, tint: [1.0, 1.0, 1.0], lift: [0.0, 0.002, 0.005],
      },
    };
  }

  _redgiant() {
    if (this.built.rg) return this.built.rg;
    const sc = this.uScale, ctx = this.ctx;
    const camera = new THREE.PerspectiveCamera(RG.fov, ctx.aspect, 0.1, 500);
    const focal = (this.H / 2) / Math.tan(THREE.MathUtils.degToRad(RG.fov / 2));
    const uTime = { value: 0 };
    const camPos = { value: V3(0, 0, 46) };
    // sun
    const sunMat = new THREE.ShaderMaterial({ uniforms: { uCamPos: camPos, uTime, uGain: { value: 1 } }, vertexShader: SUN_VERT, fragmentShader: SUN_FRAG });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(RG.Rs, 160, 96), sunMat);
    // corona (screen space, behind everything)
    const coronaMat = new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2(this.W, this.H) }, uRpx: { value: 300 }, uTime, uGain: { value: 1 }, uScale: { value: sc }, uRs: { value: RG.Rs },
        uTan: { value: new THREE.Vector2() }, uCam: { value: V3(0, 0, 0) }, uCamF: { value: V3(0, 0, -1) }, uCamR: { value: V3(1, 0, 0) }, uCamU: { value: V3(0, 1, 0) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: CORONA_FRAG, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    });
    const corona = fsQuad(coronaMat);
    // prominence loops
    const r = new Rand(616);
    const loops = [
      // phi centre, span, height, z, grow/s, brightness
      [3.62, 0.34, 0.5, 0.3, 0.03, 1.3], [2.62, 0.12, 0.16, 0.36, 0.01, 1.0], [3.05, 0.2, 0.12, 0.33, 0.01, 1.0],
      [4.05, 0.1, 0.07, 0.38, 0.0, 0.9], [2.25, 0.09, 0.22, 0.36, 0.015, 0.9], [0.3, 0.16, 0.2, 0.34, 0.012, 1.0],
      [-0.42, 0.26, 0.3, 0.3, 0.02, 1.1], [-0.85, 0.1, 0.07, 0.38, 0.0, 0.8], [3.3, 0.28, 0.24, 0.24, 0.02, 0.8],
      [2.9, 0.07, 0.05, 0.42, 0.0, 0.9], [0.8, 0.14, 0.1, 0.36, 0.01, 0.9], [-1.25, 0.2, 0.15, 0.32, 0.01, 0.9],
    ];
    const LA = [], LB = [];
    for (const [ph, sp, H, z, gr] of loops) {
      const a = V3(Math.cos(ph - sp / 2), Math.sin(ph - sp / 2), z).normalize(), b = V3(Math.cos(ph + sp / 2), Math.sin(ph + sp / 2), z).normalize();
      LA.push(new THREE.Vector4(a.x, a.y, a.z, H)); LB.push(new THREE.Vector4(b.x, b.y, b.z, gr));
    }
    const NLP = 70000; const la = new Float32Array(NLP * 4), ls = new Float32Array(NLP * 4);
    const wsum = loops.reduce((acc, l) => acc + l[1] * (1 + l[2]), 0);
    for (let i = 0; i < NLP; i++) {
      let pick = r.next() * wsum, li = 0;
      for (; li < loops.length - 1; li++) { pick -= loops[li][1] * (1 + loops[li][2]); if (pick <= 0) break; }
      const strand = r.int(0, 5);
      la.set([li, r.next(), Math.cos(strand * 1.05) * (0.6 + 0.4 * r.next()) + r.gauss() * 0.15, Math.sin(strand * 1.05) * (0.6 + 0.4 * r.next()) + r.gauss() * 0.15], i * 4);
      ls.set([(r.next() < 0.5 ? 1 : -1) * r.range(0.004, 0.02), loops[li][5] * r.range(0.4, 1.0), r.next(), r.next()], i * 4);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NLP * 3), 3));
    lg.setAttribute('aL', new THREE.BufferAttribute(la, 4)); lg.setAttribute('aS', new THREE.BufferAttribute(ls, 4));
    const loopMat = new THREE.ShaderMaterial({
      uniforms: { uLA: { value: LA }, uLB: { value: LB }, uTime, uFocal: { value: focal }, uMinPx: { value: Math.max(0.8, 1.1 * sc) }, uRs: { value: RG.Rs }, uGain: { value: 0.28 } },
      vertexShader: LOOP_VERT, fragmentShader: `varying vec3 vCol; void main(){ vec2 c = gl_PointCoord-0.5; float r2 = dot(c,c)*4.0; if (r2>1.0) discard; gl_FragColor = vec4(vCol*(exp(-r2*3.0)-0.05), 1.0); }`,
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, transparent: true,
    });
    const loopPts = new THREE.Points(lg, loopMat); loopPts.frustumCulled = false;
    loopMat.uniforms.uSizeMul = { value: 1 };
    const lgG = new THREE.BufferGeometry(); const NLG = NLP / 8;
    lgG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NLG * 3), 3));
    lgG.setAttribute('aL', new THREE.BufferAttribute(la.slice(0, NLG * 4), 4)); lgG.setAttribute('aS', new THREE.BufferAttribute(ls.slice(0, NLG * 4), 4));
    const loopGlowMat = loopMat.clone();
    loopGlowMat.uniforms = { ...loopMat.uniforms, uGain: { value: 0.035 }, uSizeMul: { value: 10 } };
    loopGlowMat.fragmentShader = `varying vec3 vCol; void main(){ vec2 c = gl_PointCoord-0.5; float r2 = dot(c,c)*4.0; if (r2>1.0) discard; float a = 1.0-r2; gl_FragColor = vec4(vCol*a*a, 1.0); }`;
    const loopGlow = new THREE.Points(lgG, loopGlowMat); loopGlow.frustumCulled = false;
    // earth
    const E = V3(...RG.earth);
    const earthMat = new THREE.ShaderMaterial({ uniforms: { uCamPos: camPos, uSunPos: { value: V3(0, 0, 0) }, uTime, uGain: { value: 1 } }, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(RG.Re, 64, 32), earthMat); earth.position.copy(E);
    // stripped atmosphere tail
    const A = E.clone().normalize(), O = A.clone().cross(V3(0, 1, 0)).normalize().multiplyScalar(-1), Bv = A.clone().cross(O).normalize();
    const NT = 80000; const ta = new Float32Array(NT * 4), tk = new Float32Array(NT * 4);
    for (let i = 0; i < NT; i++) {
      const ion = r.next() < 0.22 ? 1 : 0;
      ta.set([r.next(), r.range(0.05, 0.11), r.gauss(), r.gauss() * 0.7], i * 4);
      tk.set([ion, r.range(0.5, 1.4), r.next(), r.range(0, Math.PI * 2)], i * 4);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NT * 3), 3));
    tg.setAttribute('aT', new THREE.BufferAttribute(ta, 4)); tg.setAttribute('aK', new THREE.BufferAttribute(tk, 4));
    const tailU = { uE: { value: E }, uA: { value: A }, uO: { value: O }, uB: { value: Bv }, uTime, uFocal: { value: focal }, uMinPx: { value: Math.max(0.8, 1.1 * sc) }, uRe: { value: RG.Re }, uLen: { value: 30 }, uStrip: { value: 1 } };
    const tailFrag = `varying vec3 vCol; void main(){ vec2 c = gl_PointCoord-0.5; float r2 = dot(c,c)*4.0; if (r2>1.0) discard; float a = (1.0-r2); gl_FragColor = vec4(vCol*a*a, 1.0); }`;
    const tailMat = new THREE.ShaderMaterial({ uniforms: { ...tailU, uGain: { value: 0.045 }, uSizeMul: { value: 1 } }, vertexShader: TAIL_VERT, fragmentShader: tailFrag, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, transparent: true });
    const tail = new THREE.Points(tg, tailMat); tail.frustumCulled = false;
    const tgG = new THREE.BufferGeometry();
    tgG.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NT / 10) * 3), 3));
    tgG.setAttribute('aT', new THREE.BufferAttribute(ta.slice(0, (NT / 10) * 4), 4)); tgG.setAttribute('aK', new THREE.BufferAttribute(tk.slice(0, (NT / 10) * 4), 4));
    const tailGlowMat = new THREE.ShaderMaterial({ uniforms: { ...tailU, uGain: { value: 0.012 }, uSizeMul: { value: 9 } }, vertexShader: TAIL_VERT, fragmentShader: tailFrag, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, transparent: true });
    const tailGlow = new THREE.Points(tgG, tailGlowMat); tailGlow.frustumCulled = false;
    const stars = makeStarfield({ seed: 99, count: 9000, scale: sc, brightness: 0.45 });
    const sceneBG = new THREE.Scene(); sceneBG.add(stars);
    const scene = new THREE.Scene(); scene.add(sun); scene.add(earth); scene.add(loopGlow); scene.add(loopPts); scene.add(tailGlow); scene.add(tail);
    this.built.rg = { camera, uTime, camPos, sunMat, coronaMat, corona, earthMat, loopMat, tailMat, tailGlowMat, stars, sceneBG, scene, E };
    return this.built.rg;
  }

  updateRedGiant(shot, t, T) {
    const B = this._redgiant();
    const tc = clamp(t, -1, 17);
    const cam = B.camera;
    const k = easeInOutSine(clamp(tc / 16));
    const D = lerp(47, 39.5, k);
    cam.position.set(lerp(-1.0, 0.6, k) + 0.15 * Math.sin(tc * 0.21), lerp(0.6, -0.2, k) + 0.1 * Math.sin(tc * 0.17), D);
    cam.up.set(Math.sin(-0.035), Math.cos(-0.035), 0);
    cam.lookAt(lerp(-7.8, -7.0, k), lerp(0.4, 0.1, k), 0);
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    B.stars.position.copy(cam.position);
    B.camPos.value.copy(cam.position);
    B.uTime.value = tc;
    // sun disc in pixels for the corona pass
    const c = V3(0, 0, 0).project(cam);
    const cx = (c.x * 0.5 + 0.5) * this.W, cy = (c.y * 0.5 + 0.5) * this.H;
    const dist = cam.position.length(); const ang = Math.asin(RG.Rs / dist);
    const rpx = Math.tan(ang) / Math.tan(THREE.MathUtils.degToRad(RG.fov / 2)) * this.H / 2;
    const cu = B.coronaMat.uniforms;
    cu.uC.value.set(cx, cy); cu.uRpx.value = rpx;
    const tanV = Math.tan(THREE.MathUtils.degToRad(RG.fov / 2));
    cu.uTan.value.set(tanV * this.ctx.aspect, tanV); cu.uCam.value.copy(cam.position);
    cu.uCamR.value.setFromMatrixColumn(cam.matrixWorld, 0); cu.uCamU.value.setFromMatrixColumn(cam.matrixWorld, 1);
    cu.uCamF.value.setFromMatrixColumn(cam.matrixWorld, 2).multiplyScalar(-1);
    const strip = smoothstep(0, 3, tc);
    B.tailMat.uniforms.uStrip.value = strip; B.tailGlowMat.uniforms.uStrip.value = strip;
    const end = Math.pow(smoothstep(11, 16.2, tc), 1.5);
    B.sunMat.uniforms.uGain.value = 1 + 0.9 * end;
    B.coronaMat.uniforms.uGain.value = 1 + 1.4 * end;
    const render = (renderer, target) => {
      const ac = renderer.autoClear; renderer.autoClear = false;
      renderer.render(B.sceneBG, cam);
      renderer.render(B.corona.scene, B.corona.cam);
      renderer.render(B.scene, cam);
      renderer.autoClear = ac;
    };
    return {
      scene: B.scene, camera: cam, render, target: null,
      post: {
        exposure: 0.88 + 0.2 * end, bloomStrength: 0.7 + 0.6 * end, bloomThreshold: 1.2 - 0.3 * end, bloomKnee: 0.7, bloomRadius: 0.9,
        streak: 0.1 + 0.15 * end, streakTint: [1.0, 0.55, 0.35], ca: 0.002, vignette: 0.6, grain: 0.05,
        saturation: 1.05, contrast: 1.08, tint: [1.0, 0.95, 0.92], lift: [0.004, 0.0, 0.0], flash: 0.0,
      },
    };
  }

  update(shot, t, T) {
    if (shot.mode === 'redgiant') return this.updateRedGiant(shot, t, T);
    return this.updateYoung(shot, t, T);
  }

  dispose() {
    for (const k of Object.keys(this.built)) {
      const B = this.built[k];
      for (const key of Object.keys(B)) { const o = B[key]; if (o && o.isWebGLRenderTarget) o.dispose(); }
      B.mat?.dispose(); B.coronaMat?.dispose(); for (const sc of [B.sceneBG, B.scene]) sc?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    this.built = {};
  }
}
