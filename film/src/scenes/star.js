// Red supergiant: surface ECU, collapse, and supernova.
//   mode 'surface'   – telephoto wall of boiling granulation, prominence loops off the limb
//   mode 'collapse'  – dolly out to the whole star, unhealthy pulsation, implosion to a point
//   mode 'supernova' – white-out, shock shell racing past camera, filamentary debris ring
import * as THREE from '../../vendor/three.module.js';
import { simplex3, hash, softPoint } from '../lib/glsl.js';
import { Rand, fbm1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, easeInOutCubic, easeInOutSine } from '../lib/ease.js';
import { fbm3 as fbm3js } from '../lib/vnoise3.js';

const R = 1000; // star radius (world units)
const DEG = Math.PI / 180;

// ---------- shaders ----------
const STAR_VERT = /* glsl */`
uniform float uScale, uWobble, uPhase, uFreq;
varying vec3 vN; varying vec3 vPos; varying vec3 vW;
${simplex3}
void main(){
  vec3 n = normalize(position);
  float w = 0.0;
  if(uWobble > 0.0) w = uWobble * (snoise(n*1.6 + vec3(0.0, uPhase*0.05, 0.0))*0.75 + snoise(n*3.7 - vec3(uPhase*0.08))*0.25);
  // large-scale convective flow warp (low frequency: evaluated per vertex)
  vec3 pf = n*uFreq*0.33; float t = uPhase;
  vW = vec3(snoise(pf + vec3(0.0,0.0,t*0.020)), snoise(pf + vec3(19.1,4.7,-t*0.020)), snoise(pf + vec3(-7.3,11.9,t*0.017)));
  vec3 p = n * ${R.toFixed(1)} * uScale * (1.0 + w);
  vN = n; vec4 wp = modelMatrix*vec4(p,1.0); vPos = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;

const STAR_FRAG = /* glsl */`
uniform float uPhase, uFreq, uBright, uHot, uContrast, uFlow, uGrad, uRelief, uSoft;
uniform vec2 uRes;
varying vec3 vN; varying vec3 vPos; varying vec3 vW;
${simplex3}
${hash}
vec3 ramp(float h){
  const vec3 c0=vec3(0.030,0.0025,0.0012), c1=vec3(0.30,0.026,0.006), c2=vec3(1.00,0.15,0.022),
             c3=vec3(2.15,0.70,0.11), c4=vec3(3.9,2.05,0.62), c5=vec3(6.5,5.2,3.4);
  h = clamp(h, 0.0, 1.3)*4.0;
  if(h<1.0) return mix(c0,c1,h);
  if(h<2.0) return mix(c1,c2,h-1.0);
  if(h<3.0) return mix(c2,c3,h-2.0);
  if(h<4.0) return mix(c3,c4,h-3.0);
  return mix(c4,c5,min(h-4.0,1.0));
}
// animated 3D voronoi: returns F1, F2, and the nearest cell's random id
vec3 voro(vec3 p, float t){
  vec3 ip=floor(p), fp=fract(p);
  float f1=8.0, f2=8.0, id=0.0;
  for(int k=-1;k<=1;k++) for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec3 g=vec3(float(i),float(j),float(k));
    vec3 h=hash33(ip+g);
    vec3 o=0.5+0.36*sin(t*(0.25+0.35*h.yzx)+6.2831*h);
    vec3 r=g+o-fp; float d=dot(r,r);
    if(d<f1){ f2=f1; f1=d; id=h.z; } else if(d<f2){ f2=d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
// cheap 2x2x2 variant (F1 only), good enough for the soft fine granulation
float voroF1(vec3 p, float t){
  vec3 ip=floor(p - 0.5), fp=p - ip;
  float f1=8.0;
  for(int k=0;k<=1;k++) for(int j=0;j<=1;j++) for(int i=0;i<=1;i++){
    vec3 g=vec3(float(i),float(j),float(k));
    vec3 h=hash33(ip+g);
    vec3 o=0.5+0.30*sin(t*(0.25+0.35*h.yzx)+6.2831*h);
    vec3 r=g+o-fp; f1=min(f1, dot(r,r));
  }
  return sqrt(f1);
}
void main(){
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vPos);
  float mu = clamp(dot(n, V), 0.0, 1.0);
  float t = uPhase;
  vec3 p = n*uFreq;
  vec3 w = vW;
  p += w*0.62 + vec3(uFlow*t*0.010);
  // second, finer warp frays the intergranular lanes like real convection
  vec2 w2a = vec2(snoise(p*3.1 + vec3(0.0, 0.0, t*0.05)), snoise(p*3.1 + vec3(7.7, 3.1, -t*0.05)));
  vec3 w2 = vec3(w2a, -w2a.x*0.7 + w2a.y*0.5);
  vec3 F = voro(p + w2*0.085, t);
  float edge = F.y - F.x;
  float lane = smoothstep(0.0, 0.12 + 0.5*length(fwidth(p)) + 0.35*uSoft, edge);
  float lane_soft = smoothstep(0.0, 0.5, edge);
  float core = exp(-F.x*F.x*1.6);
  float flick = 0.70 + 0.30*sin(t*(0.18+0.30*F.z) + F.z*61.0);
  float cellVar = 0.45 + 0.9*fract(F.z*13.7);
  // small granulation riding on top of the giant cells: soft blobs
  vec3 q = n*uFreq*3.6 + w*1.2 + w2*0.35 + vec3(t*0.012);
  float G1 = uSoft > 0.97 ? 0.6 : voroF1(q, t*1.7);
  // anti-alias: fade the fine layers out where they get smaller than a few pixels (foreshortened limb)
  float aa2 = (1.0 - smoothstep(0.12, 0.35, length(fwidth(q))))*(1.0 - 0.8*uSoft);
  float aa1 = 1.0 - smoothstep(0.10, 0.30, length(fwidth(p)));
  float gran = mix(0.6, exp(-G1*G1*2.6), aa2);
  float fine = snoise(n*uFreq*11.0 + w2*1.5 + vec3(0.0, t*0.05, 0.0))*aa2;
  float heat = 0.06 + lane*(0.05 + 0.12*lane_soft + 0.66*pow(core, 1.3)*flick*cellVar*(0.5 + 0.7*gran)) + 0.045*fine*lane + 0.05*w.x;
  heat = mix(0.42, heat, uContrast);
  // wide-shot look: soft mottled giant cells instead of crisp lanes
  float heatSoft = 0.31 + 0.45*exp(-F.x*F.x*1.1)*smoothstep(0.0, 0.7, edge)*(0.55 + 0.45*cellVar*flick) + 0.14*w.x + 0.06*w2.y + 0.03*fine;
  heat = mix(heat, heatSoft, uSoft);
  // limb: cooler, darker, redder
  heat *= mix(0.62, 1.0, pow(mu, 0.40));
  float limb = 0.18 + 0.82*pow(mu, 0.50);
  // fake relief: upwelling domes catch light from the limb side, lanes fall into shadow
  float hs = 0.5*lane_soft + 0.6*core + 0.25*gran;
  vec2 hg = vec2(dFdx(hs), dFdy(hs)) * (uRes.y/804.0);
  float relief = clamp(1.0 + dot(hg, vec2(-0.35, 1.0))*uRelief*aa1*(1.0 - uSoft), 0.55, 1.6);
  vec3 col = ramp((heat + uHot*0.9)*mix(1.0, relief, 0.35)) * uBright * limb * relief;
  // thin hot chromospheric rim just inside the silhouette
  col += vec3(1.2, 0.22, 0.06) * uBright * pow(1.0 - mu, 6.0) * 0.6;
  // aerial perspective toward the limb: distant convection dissolves into hot haze
  col = mix(col, vec3(1.25, 0.30, 0.07) * uBright, pow(1.0 - mu, 7.0) * 0.5);
  vec2 sc = gl_FragCoord.xy/uRes;
  col *= 1.0 - uGrad*smoothstep(0.75, 0.0, length((sc - vec2(0.05, 0.18))*vec2(1.0, 1.7)));
  gl_FragColor = vec4(col, 1.0);
}`;

const CORONA_VERT = /* glsl */`
varying vec3 vW;
void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`;
const CORONA_FRAG = /* glsl */`
uniform float uR, uInt, uPhase, uRim, uDetail;
uniform vec3 uCol;
varying vec3 vW;
${simplex3}
void main(){
  vec3 ro = cameraPosition; vec3 rd = normalize(vW - ro);
  float tc = dot(-ro, rd);
  vec3 cp = ro + rd*tc;
  float x = max(length(cp)/uR, 1.0);
  vec3 q = normalize(cp);
  float h = x - 1.0;
  // radial streamers / spicule forest: noise depends on direction only => radial streaks
  float st2 = snoise(q*9.0 + vec3(uPhase*0.01))*0.5 + 0.5;
  float st = 0.6, sp = 0.5;
  if(uDetail > 0.5){
    st = snoise(q*38.0 + vec3(0.0, 0.0, uPhase*0.03))*0.5 + 0.5;
    sp = snoise(q*160.0 + vec3(h*6.0, 0.0, uPhase*0.08))*0.5 + 0.5;
  }
  float g = exp(-h*260.0)*(0.5 + 0.9*sp)*uRim*1.4
          + exp(-h*70.0)*0.14*(0.3 + 1.2*st*st2)
          + exp(-h*14.0)*0.02*(0.4 + 1.0*st2)
          + exp(-h*2.0)*0.006;
  vec3 col = uCol*g + vec3(2.4, 1.0, 0.4)*exp(-h*600.0)*uRim*0.6;
  gl_FragColor = vec4(col*uInt, 1.0);
}`;

const PROM_VERT = /* glsl */`
attribute vec3 aA; attribute vec3 aB; attribute vec4 aP; attribute vec4 aO; attribute vec3 aL;
uniform float uTime, uScale, uPx, uGrow, uInt;
varying vec3 vCol; varying float vA;
${hash}
void main(){
#ifdef LINES
  float s = aP.x;
#else
  float s = fract(aP.x + uTime*aP.y);
#endif
  vec3 base = normalize(mix(aA, aB, s));
  float sn = sin(3.14159265*s);
  float grow = 1.0 + uGrow*aO.w;
  float hgt = aP.z * grow * pow(sn, 0.85) * (1.0 + 0.07*sin(uTime*0.35 + aP.w*6.28));
  vec3 T = normalize(aB - aA + 1e-5);
  vec3 Bn = normalize(cross(T, base));
  float tw = s*5.0 + aP.w*6.28 + uTime*0.12;
  vec2 o = aO.xy*(0.55 + 0.45*sn)*(0.8 + 0.4*grow*0.5);
  o = vec2(o.x*cos(tw) - o.y*sin(tw), o.x*sin(tw) + o.y*cos(tw));
  vec3 p = (base*(${R.toFixed(1)} + hgt) + Bn*o.x + base*o.y + aL*pow(sn, 1.6)*grow) * uScale;
  vec4 mv = modelViewMatrix*vec4(p, 1.0);
  gl_Position = projectionMatrix*mv;
#ifdef LINES
  // bright condensations flowing along the field line
  float fl = s*19.0 - uTime*aP.y*40.0 + aP.w*40.0;
  float knot = 0.30 + 0.70*smoothstep(-0.3, 1.0, sin(fl)*0.65 + sin(s*47.0 + aP.w*13.0 - uTime*aP.y*70.0)*0.35);
#else
  float knot = 0.45 + 0.55*smoothstep(-0.6, 0.9, sin(s*23.0 + aP.w*40.0 + uTime*0.3)*0.6 + sin(s*61.0 - aP.w*17.0)*0.4);
#endif
  vA = uInt * aO.z * smoothstep(0.0, 0.06, s) * smoothstep(1.0, 0.94, s) * knot;
  float hf = clamp(hgt/max(aP.z,1.0), 0.0, 1.0);
  vCol = mix(vec3(3.4, 1.15, 0.32), vec3(2.6, 0.30, 0.22), hf);
  gl_PointSize = uPx*(0.75 + 0.6*hash11(aP.w*313.0 + s));
}`;
const POINT_FRAG = /* glsl */`
varying vec3 vCol; varying float vA;
${softPoint}
void main(){ float a = softDisc(gl_PointCoord)*vA; if(a<0.003) discard; gl_FragColor = vec4(vCol*a, 1.0); }`;

// infalling outer atmosphere (collapse) – clumps that swirl in with a lag
const INFALL_VERT = /* glsl */`
attribute vec4 aD; // dir.xyz, radius factor
attribute vec4 aS; // seed, lag, bright, size
#ifdef LINES
attribute float aTail;
#endif
uniform float uT, uScale, uPx, uImp0, uImpDur, uPhase;
varying vec3 vCol; varying float vA;
${simplex3}
vec3 posAt(float tt, out float e, out float u){
  vec3 d = normalize(aD.xyz);
  u = clamp((tt - uImp0 - aS.y)/uImpDur, 0.0, 1.0);
  e = pow(u, 2.2);
  float r = aD.w * mix(uScale, 0.002, e);
  // swirl in as it falls (angular momentum)
  float ang = 2.2*e*e + 0.04*uPhase*(aS.x - 0.5);
  float c = cos(ang), s = sin(ang);
  d = vec3(c*d.x + s*d.z, d.y, -s*d.x + c*d.z);
  return d*r*${R.toFixed(1)};
}
void main(){
  float e, u;
#ifdef LINES
  vec3 p = posAt(uT - aTail*0.09, e, u);
  float e0, u0; posAt(uT, e0, u0); e = e0; u = u0;
#else
  vec3 p = posAt(uT, e, u);
#endif
  vec3 dn = normalize(aD.xyz);
  p += vec3(snoise(dn*3.0 + vec3(uPhase*0.04)), snoise(dn*3.0 + vec3(9.0, uPhase*0.04, 2.0)), snoise(dn*3.0 + vec3(4.0, 1.0, uPhase*0.04)))*0.025*length(p);
  vec4 mv = modelViewMatrix*vec4(p, 1.0);
  gl_Position = projectionMatrix*mv;
  float heat = smoothstep(0.0, 1.0, e);
  vCol = mix(vec3(1.6, 0.30, 0.09), vec3(2.2, 0.9, 0.35), heat);
#ifdef LINES
  vA = aS.z * 1.6 * smoothstep(0.02, 0.3, u) * (1.0 - smoothstep(0.6, 0.95, u)) * (1.0 - aTail);
#else
  vA = aS.z * (1.0 - smoothstep(0.1, 0.5, u)) ;
#endif
  gl_PointSize = uPx*aS.w;
}`;

// supernova debris: homologous-ish expansion of a filamentary shell
const NOVA_VERT = /* glsl */`
attribute vec4 aD;  // dir.xyz, radial fraction f (0..1+)
attribute vec4 aS;  // seed, kind (0 ejecta, 1 front), bright, size
attribute vec3 aC;  // colour
uniform float uT, uRe, uRf, uPx, uFrontA, uEjA, uHeat;
uniform vec3 uStretch, uAxis;
varying vec3 vCol; varying float vA;
${simplex3}
void main(){
  vec3 d = aD.xyz;
  float front = aS.y;
  float rad = front > 0.5 ? uRf*aD.w : uRe*aD.w;
  // slow turbulent shearing of filaments
  // cheap per-particle turbulent shear (no noise calls: 320k vertices)
  float ph = aS.x*6.2831;
  vec3 tw = vec3(sin(uT*0.31 + ph + d.y*4.0), sin(uT*0.27 + ph*1.7 + d.z*4.0), sin(uT*0.23 + ph*2.3 + d.x*4.0));
  vec3 p = (d + tw*0.035*(1.0-front))*rad*uStretch;
  vec4 mv = modelViewMatrix*vec4(p, 1.0);
  gl_Position = projectionMatrix*mv;
  float dist = -mv.z;
  // suppress the faces of the shell that project onto the centre of frame (keeps title readable)
  vec3 vd = normalize(p - cameraPosition);
  float side = length(cross(normalize(p + 1e-4), uAxis));
  float limbW = mix(0.25, 1.0, smoothstep(0.30, 0.85, side));
  float a = front > 0.5 ? uFrontA*(0.15 + 0.85*pow(side, 4.0)) : uEjA*limbW;
  a *= smoothstep(4.0, 22.0, dist);
  vA = a*aS.z;
  vCol = aC*mix(1.0, 1.8, uHeat*(1.0 - aD.w*0.5));
  gl_PointSize = clamp(uPx*aS.w*(130.0/dist), 0.6*uPx, 9.0*uPx*max(1.0, aS.w*0.12));
}`;

// radial streaks racing outward (lines: head/tail)
const SPARK_VERT = /* glsl */`
attribute vec4 aD; // dir, speed
attribute vec2 aE; // isTail, bright
uniform float uT, uLen;
varying vec3 vCol; varying float vA;
void main(){
  float tt = max(uT - aE.x*uLen, 0.0);
  float r = aD.w*(1.0 - exp(-tt*1.2))/1.2 + 0.5;
  vec3 p = aD.xyz*r;
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  gl_Position = projectionMatrix*mv;
  float dist = -mv.z;
  vA = aE.y*(1.0 - aE.x)*smoothstep(2.0, 18.0, dist)*(1.0 - smoothstep(1.2, 3.2, uT));
  vCol = mix(vec3(3.0, 3.6, 5.5), vec3(4.5, 2.2, 1.0), aE.y*0.3);
}`;
const LINE_FRAG = /* glsl */`
varying vec3 vCol; varying float vA;
void main(){ gl_FragColor = vec4(vCol*vA, 1.0); }`;

const STARS_VERT = /* glsl */`
attribute vec4 aS; // bright, size, temp, twinkle
uniform float uPx, uInt;
varying vec3 vCol; varying float vA;
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  gl_Position = projectionMatrix*mv;
  vCol = mix(vec3(1.0,0.72,0.48), vec3(0.62,0.78,1.15), aS.z);
  vA = aS.x*uInt;
  gl_PointSize = uPx*aS.y;
}`;

const GLOW_VERT = /* glsl */`
uniform float uSize; uniform vec3 uPos;
void main(){ vec4 mv = modelViewMatrix*vec4(uPos,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = uSize; }`;
const GLOW_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uCore;
void main(){
  float d = length(gl_PointCoord - 0.5)*2.0;
  float g = exp(-d*d*uCore)*1.0 + exp(-d*7.0)*0.25 + 0.06*exp(-d*2.5);
  g *= 1.0 - smoothstep(0.85, 1.0, d);
  gl_FragColor = vec4(uCol*g, 1.0);
}`;

// nebulous background lit by the explosion – vertex-coloured so it costs nothing per pixel
const SKY_VERT = /* glsl */`
uniform float uInt, uT;
varying vec3 vCol;
${simplex3}
void main(){
  vec3 d = normalize(position);
  float n = fbm3(d*2.2 + vec3(1.7, 0.3, uT*0.004));
  float n2 = fbm3(d*5.0 + vec3(-3.1, 2.2, 0.7));
  float m = smoothstep(-0.15, 0.6, n)*(0.55 + 0.45*n2);
  vCol = (mix(vec3(0.08,0.02,0.06), vec3(0.03,0.05,0.10), smoothstep(-0.3,0.4,n2)) * m) * uInt;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;
const SKY_FRAG = /* glsl */`varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol,1.0); }`;

function addMat(vert, frag, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, ...extra });
}

export default class Star {
  constructor(ctx) {
    this.ctx = ctx;
    this.uScaleRes = ctx.height / 804;
    this.camera = new THREE.PerspectiveCamera(10, ctx.aspect, 5, 60000);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0, 0, 0);
  }

  // telephoto surface camera: returns pos, look direction, up, fov
  surfaceCam(t) {
    const k = clamp(t / 16);
    const kk = 0.2 * k + 0.8 * easeInOutSine(k);
    const D = lerp(1330, 1255, kk);            // slow push toward the limb
    const alpha = Math.asin(R / D);
    const pitch = alpha - lerp(3.1, 2.8, kk) * DEG + 0.035 * DEG * fbm1(t * 0.13 + 2.0);
    const yaw0 = 0.03 * DEG * fbm1(t * 0.11 + 7.0);
    const pos = new THREE.Vector3(0, 0, D);
    const dir = new THREE.Vector3(Math.sin(yaw0), Math.sin(pitch), -Math.cos(pitch)).normalize();
    // slow orbit around the star's axis: the limb slides, loops parallax against one another
    const orbit = -0.016 + 0.032 * k;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), orbit);
    pos.applyQuaternion(q); dir.applyQuaternion(q);
    const roll = 6.0 * DEG;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up0 = new THREE.Vector3().crossVectors(right, dir).normalize();
    const up = up0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(right, Math.sin(roll));
    const fov = lerp(10.4, 9.7, kk);
    return { pos, dir, up, fov };
  }

  async init() {
    const rnd = new Rand(9601);
    const S = this.scene;
    // ---- star
    this.starU = {
      uPhase: { value: 0 }, uFreq: { value: 24 }, uBright: { value: 1 }, uHot: { value: 0 }, uContrast: { value: 1 },
      uFlow: { value: 1 }, uScale: { value: 1 }, uWobble: { value: 0 }, uGrad: { value: 0 }, uRelief: { value: 9 }, uSoft: { value: 0 }, uRes: { value: new THREE.Vector2(this.ctx.width, this.ctx.height) },
    };
    const starMat = new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: this.starU });
    this.star = new THREE.Mesh(new THREE.SphereGeometry(1, 384, 192), starMat);
    this.star.frustumCulled = false; S.add(this.star);
    // dense patch covering only what the telephoto surface shot sees (per-vertex flow warp stays smooth)
    this.starPatch = new THREE.Mesh(new THREE.SphereGeometry(1, 360, 300, 52 * DEG, 76 * DEG, 28 * DEG, 70 * DEG), starMat);
    this.starPatch.frustumCulled = false; S.add(this.starPatch);

    // ---- corona / chromosphere shell
    this.coronaU = { uR: { value: R }, uInt: { value: 1 }, uPhase: { value: 0 }, uRim: { value: 1 }, uDetail: { value: 1 }, uCol: { value: new THREE.Vector3(1.5, 0.36, 0.09) } };
    this.corona = new THREE.Mesh(new THREE.SphereGeometry(R * 3.2, 96, 48),
      addMat(CORONA_VERT, CORONA_FRAG, this.coronaU, { side: THREE.BackSide }));
    S.add(this.corona);

    // ---- prominences: hero loops on the surface-shot limb + global loops for wide shots
    this.promU = { uTime: { value: 0 }, uScale: { value: 1 }, uPx: { value: 2 }, uGrow: { value: 0 }, uInt: { value: 1 } };
    const promMat = addMat(PROM_VERT, POINT_FRAG, this.promU);
    const mid = this.surfaceCam(8);
    const C = mid.pos.clone(), D = C.length(), Ch = C.clone().normalize();
    const sR = R / D, sS = Math.sqrt(1 - sR * sR);
    const e2 = new THREE.Vector3(0, 1, 0).addScaledVector(Ch, -Ch.y).normalize();
    const e1 = new THREE.Vector3().crossVectors(e2, Ch).normalize();
    const sil = (phi, beta) => {
      const n = Ch.clone().multiplyScalar(sR).addScaledVector(e1, sS * Math.cos(phi)).addScaledVector(e2, sS * Math.sin(phi));
      // beta>0 -> behind the limb (away from camera)
      return n.addScaledVector(Ch, -Math.sin(beta)).normalize();
    };
    const loops = [];
    // the hero eruptive arch, left of centre, twisted rope that swells through the shot
    loops.push({ A: sil(101.5 * DEG, 2.0 * DEG), B: sil(91.0 * DEG, 4.0 * DEG), H: 44, strands: 80, thick: 5.0, speed: 0.018, grow: 1, bright: 0.5, lean: 0.45, blobs: 9000 });
    loops.push({ A: sil(97.0 * DEG, -0.6 * DEG), B: sil(94.6 * DEG, 0.8 * DEG), H: 15, strands: 26, thick: 1.8, speed: 0.04, grow: 0.3, bright: 0.6, lean: -0.3, blobs: 2500 });
    // post-flare loop arcade on the right: a row of arches straddling a neutral line, receding in depth
    for (let i = 0; i < 8; i++) {
      const pc = (76.5 + i * 1.45 + rnd.range(-0.3, 0.3)) * DEG, w = rnd.range(1.0, 1.8) * DEG;
      const b0 = rnd.range(-1.0, 3.5) * DEG;
      loops.push({ A: sil(pc - w / 2, b0), B: sil(pc + w / 2, b0 + rnd.range(-0.8, 0.8) * DEG), H: rnd.range(9, 20), strands: rnd.int(10, 18), thick: rnd.range(0.7, 1.4), speed: 0.05, grow: 0.1, bright: rnd.range(0.3, 0.55), lean: rnd.range(-0.1, 0.5), blobs: 500 });
    }
    // scattered loops of mixed scale
    for (let i = 0; i < 9; i++) {
      const pc = rnd.range(84, 112) * DEG, dp = rnd.range(1.2, 5.5) * DEG * rnd.sign();
      const ba = rnd.range(-2.5, 6) * DEG, bb = ba + rnd.range(-2.5, 2.5) * DEG;
      const H = rnd.range(7, 30) * (0.6 + Math.abs(dp) / (5.5 * DEG));
      loops.push({ A: sil(pc - dp / 2, ba), B: sil(pc + dp / 2, bb), H, strands: rnd.int(8, 22), thick: rnd.range(0.8, 2.6), speed: rnd.range(0.02, 0.07) * rnd.sign(), grow: rnd.range(-0.2, 0.3), bright: rnd.range(0.3, 0.6), lean: rnd.range(-0.5, 0.5), blobs: 1200 });
    }
    // global loops scattered all over the sphere (visible on the limb in wide shots)
    const gl = [];
    for (let i = 0; i < 110; i++) {
      const a = new THREE.Vector3(...rnd.onSphere());
      const tg = new THREE.Vector3(...rnd.onSphere()).cross(a).normalize();
      const sep = rnd.range(0.03, 0.12);
      const b = a.clone().addScaledVector(tg, sep).normalize();
      gl.push({ A: a, B: b, H: rnd.range(25, 110) * (0.5 + sep * 6), strands: rnd.int(4, 9), thick: rnd.range(3, 9), speed: rnd.range(0.02, 0.06) * rnd.sign(), grow: 0, bright: rnd.range(0.8, 1.4), lean: rnd.range(-0.4, 0.4), blobs: 600, seg: 40 });
    }
    const lineMat = addMat(PROM_VERT, LINE_FRAG, this.promU); lineMat.defines = { LINES: 1 };
    const buildLoops = (list) => {
      // strands -> line segments
      let NL = 0, NP = 0;
      for (const l of list) { l.segs = l.seg || Math.round(clamp(l.H * 3 + 30, 40, 220)); NL += l.strands * l.segs * 2; NP += l.blobs; }
      const mk = (N) => ({ A: new Float32Array(N * 3), B: new Float32Array(N * 3), P: new Float32Array(N * 4), O: new Float32Array(N * 4), L: new Float32Array(N * 3) });
      const Lb = mk(NL), Pb = mk(NP);
      let kl = 0, kp = 0;
      const put = (buf, k, l, lv, s, speed, seed, ox, oy, br) => {
        buf.A.set([l.A.x, l.A.y, l.A.z], k * 3); buf.B.set([l.B.x, l.B.y, l.B.z], k * 3); buf.L.set([lv.x, lv.y, lv.z], k * 3);
        buf.P.set([s, speed, l.H, seed], k * 4); buf.O.set([ox, oy, br, l.grow], k * 4);
      };
      for (const l of list) {
        const lv = new THREE.Vector3().crossVectors(l.B.clone().sub(l.A), l.A.clone().add(l.B)).normalize().multiplyScalar((l.lean || 0) * l.H);
        const so = [];
        for (let st = 0; st < l.strands; st++) {
          const a = rnd.range(0, Math.PI * 2), r = l.thick * Math.pow(rnd.next(), 0.7);
          const o = [Math.cos(a) * r, Math.sin(a) * r];
          so.push(o);
          const seed = rnd.next(), sp = l.speed * rnd.range(0.7, 1.3), br = l.bright * rnd.range(0.35, 1.2) * (rnd.next() < 0.15 ? 2.0 : 1);
          for (let i = 0; i < l.segs; i++) {
            put(Lb, kl++, l, lv, i / l.segs, sp, seed, o[0], o[1], br);
            put(Lb, kl++, l, lv, (i + 1) / l.segs, sp, seed, o[0], o[1], br);
          }
        }
        for (let i = 0; i < l.blobs; i++) {
          const o = so[i % so.length];
          put(Pb, kp++, l, lv, rnd.next(), l.speed * rnd.range(0.7, 1.3), rnd.next(), o[0] + rnd.gauss() * l.thick * 0.15, o[1] + rnd.gauss() * l.thick * 0.15, l.bright * 0.25);
        }
      }
      const geo = (buf, N) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
        g.setAttribute('aA', new THREE.BufferAttribute(buf.A, 3)); g.setAttribute('aB', new THREE.BufferAttribute(buf.B, 3));
        g.setAttribute('aP', new THREE.BufferAttribute(buf.P, 4)); g.setAttribute('aO', new THREE.BufferAttribute(buf.O, 4)); g.setAttribute('aL', new THREE.BufferAttribute(buf.L, 3));
        return g;
      };
      const grp = new THREE.Group();
      const ln = new THREE.LineSegments(geo(Lb, NL), lineMat); ln.frustumCulled = false;
      const pt = new THREE.Points(geo(Pb, NP), promMat); pt.frustumCulled = false;
      grp.add(ln, pt); return grp;
    };
    this.heroProm = buildLoops(loops); S.add(this.heroProm);
    this.globalProm = buildLoops(gl); S.add(this.globalProm);

    // ---- infalling outer atmosphere (collapse)
    {
      const N = 70000;
      const D4 = new Float32Array(N * 4), S4 = new Float32Array(N * 4);
      let k = 0;
      while (k < N) {
        const d = rnd.onSphere();
        const rf = 1.0 + 0.55 * Math.pow(rnd.next(), 1.8);
        const cl = fbm3js(d[0] * 4 + 3, d[1] * 4, d[2] * 4 + rf * 2.0, 4);
        if (rnd.next() > smoothstep(-0.15, 0.35, cl)) continue;
        D4.set([d[0], d[1], d[2], rf], k * 4);
        S4.set([rnd.next(), (rf - 1) * 0.7 + rnd.range(0, 0.08), rnd.range(0.008, 0.028) * (1.3 - (rf - 1)), rnd.range(2.0, 3.6)], k * 4);
        k++;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      g.setAttribute('aD', new THREE.BufferAttribute(D4, 4)); g.setAttribute('aS', new THREE.BufferAttribute(S4, 4));
      this.infallU = { uT: { value: 0 }, uScale: { value: 1 }, uPx: { value: 2 }, uImp0: { value: 10 }, uImpDur: { value: 2.2 }, uPhase: { value: 0 } };
      this.infall = new THREE.Points(g, addMat(INFALL_VERT, POINT_FRAG, this.infallU)); this.infall.frustumCulled = false;
      S.add(this.infall);
      // the same clumps as radial streaks while they fall
      const dup = (src) => { const o = new Float32Array(src.length * 2); for (let i = 0; i < N; i++) for (let e2 = 0; e2 < 2; e2++) o.set(src.subarray(i * 4, i * 4 + 4), (i * 2 + e2) * 4); return o; };
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      lg.setAttribute('aD', new THREE.BufferAttribute(dup(D4), 4)); lg.setAttribute('aS', new THREE.BufferAttribute(dup(S4), 4));
      const tl = new Float32Array(N * 2); for (let i = 0; i < N; i++) tl[i * 2 + 1] = 1;
      lg.setAttribute('aTail', new THREE.BufferAttribute(tl, 1));
      const lm = addMat(INFALL_VERT, LINE_FRAG, this.infallU); lm.defines = { LINES: 1 };
      this.infallLines = new THREE.LineSegments(lg, lm); this.infallLines.frustumCulled = false;
      S.add(this.infallLines);
    }

    // ---- point glows (collapse pinpoint, supernova core, neutron star)
    const mkGlow = () => {
      const u = { uSize: { value: 40 }, uPos: { value: new THREE.Vector3() }, uCol: { value: new THREE.Vector3(1, 1, 1) }, uCore: { value: 60 } };
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      const p = new THREE.Points(g, addMat(GLOW_VERT, GLOW_FRAG, u, { depthTest: false })); p.frustumCulled = false; p.renderOrder = 10;
      p.userData.u = u; return p;
    };
    this.pin = mkGlow(); S.add(this.pin);
    this.novaCore = mkGlow(); S.add(this.novaCore);
    this.pulsar = mkGlow(); S.add(this.pulsar);

    // ---- starfield
    {
      const N = 9000; const P = new Float32Array(N * 3), A = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        const d = rnd.onSphere(); const r = 40000;
        P.set([d[0] * r, d[1] * r, d[2] * r], i * 3);
        const b = Math.pow(rnd.next(), 6);
        A.set([0.25 + 5.0 * b, 1.1 + 2.2 * b, rnd.next(), rnd.next()], i * 4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aS', new THREE.BufferAttribute(A, 4));
      this.starsU = { uPx: { value: 1 }, uInt: { value: 1 } };
      this.stars = new THREE.Points(g, addMat(STARS_VERT, POINT_FRAG, this.starsU)); this.stars.frustumCulled = false;
      S.add(this.stars);
    }

    // ---- supernova: sky, shell + ejecta, sparks
    this.skyU = { uInt: { value: 0 }, uT: { value: 0 } };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 128, 64), new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }));
    S.add(this.sky);
    this.buildNova(rnd);
  }

  buildNova(rnd) {
    const NSTR = 700, PSTR = 170, NFG = 520, PFG = 150, NFILL = 22000, NF = 70000, NGAS = 3200;
    const N = NSTR * PSTR + NFG * PFG + NFILL + NF + NGAS;
    const D4 = new Float32Array(N * 4), S4 = new Float32Array(N * 4), C3 = new Float32Array(N * 3);
    let k = 0;
    const put = (d, f, c, seed, front, br, size) => { D4.set([d[0], d[1], d[2], f], k * 4); C3.set(c, k * 3); S4.set([seed, front, br, size], k * 4); k++; };
    const norm = (v) => { const L = Math.hypot(v[0], v[1], v[2]); return [v[0] / L, v[1] / L, v[2] / L]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    // directions biased away from the line of sight so the centre of frame stays dark for the title
    const ringDir = () => { for (;;) { const d = rnd.onSphere(); if (rnd.next() < 0.12 + 0.88 * smoothstep(0.92, 0.55, Math.abs(d[2]))) return d; } };
    const PAL = [[1.9, 0.17, 0.22], [1.7, 0.22, 0.85], [2.2, 0.68, 0.18], [2.4, 1.45, 0.5], [0.28, 1.35, 1.25], [1.6, 1.9, 2.7]];
    const pickCol = () => { const h = rnd.next(); return PAL[h < 0.30 ? 0 : h < 0.50 ? 1 : h < 0.70 ? 2 : h < 0.80 ? 3 : h < 0.93 ? 4 : 5]; };
    // 1) filaments: smooth random-walk curves wrapped on the shell (Crab / Veil-like threads)
    for (let i = 0; i < NSTR; i++) {
      let d = ringDir(); let tg = norm(cross(d, rnd.onSphere()));
      const f0 = 0.62 + 0.36 * Math.pow(rnd.next(), 0.6), len = rnd.range(0.10, 0.45), curv = rnd.range(-1.5, 1.5);
      const c = pickCol(), bright = rnd.range(0.10, 0.30) * (rnd.next() < 0.1 ? 2.2 : 1), seed = rnd.next();
      const pts = [];
      for (let j = 0; j <= 16; j++) {
        pts.push(d);
        const step = len / 16;
        // advance along tangent, rotate tangent around d (curvature)
        d = norm([d[0] + tg[0] * step, d[1] + tg[1] * step, d[2] + tg[2] * step]);
        const bn = cross(d, tg); const cv = curv * step + rnd.gauss() * 0.12 * step * 6;
        tg = norm([tg[0] + bn[0] * cv, tg[1] + bn[1] * cv, tg[2] + bn[2] * cv]);
        const dd = tg[0] * d[0] + tg[1] * d[1] + tg[2] * d[2]; tg = norm([tg[0] - d[0] * dd, tg[1] - d[1] * dd, tg[2] - d[2] * dd]);
      }
      const ph = rnd.range(0, 6.28), kn = rnd.range(8, 30);
      for (let j = 0; j < PSTR; j++) {
        const sp = rnd.next() * 16, i0 = Math.floor(sp), fr = sp - i0;
        const A = pts[i0], B = pts[Math.min(i0 + 1, 16)];
        const sc = 0.0035;
        const dd = norm([A[0] + (B[0] - A[0]) * fr + rnd.gauss() * sc, A[1] + (B[1] - A[1]) * fr + rnd.gauss() * sc, A[2] + (B[2] - A[2]) * fr + rnd.gauss() * sc]);
        const knot = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(sp / 16 * kn + ph)), 4);
        const f = f0 + 0.06 * Math.sin(sp * 0.4 + ph) + rnd.gauss() * 0.006;
        put(dd, f, c, seed, 0, bright * knot, rnd.range(0.9, 1.7));
      }
    }
    // 2) Rayleigh–Taylor fingers: radial plumes with mushroom caps, hot tips
    for (let i = 0; i < NFG; i++) {
      const d0 = ringDir(); const fmax = rnd.range(0.85, 1.06), fmin = rnd.range(0.5, 0.65);
      const c = pickCol(), bright = rnd.range(0.12, 0.3);
      const e1 = norm(cross(d0, [0.3, 0.7, 0.2])), e2 = cross(d0, e1);
      for (let j = 0; j < PFG; j++) {
        const u = Math.pow(rnd.next(), 0.7);
        const tip = smoothstep(0.75, 1.0, u);
        const w = 0.006 + 0.035 * tip * tip, a = rnd.range(0, 6.283), r = w * Math.sqrt(rnd.next());
        const dd = norm([d0[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * r, d0[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * r, d0[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * r]);
        const f = lerp(fmin, fmax, u) - tip * 0.03 * (r / (w + 1e-4));
        const cc = tip > 0.5 ? [lerp(c[0], 2.6, 0.5), lerp(c[1], 1.8, 0.5), lerp(c[2], 1.4, 0.5)] : c;
        put(dd, f, cc, rnd.next(), 0, bright * (0.5 + 0.8 * tip), rnd.range(0.9, 1.6));
      }
    }
    // 3) diffuse fill
    for (let i = 0; i < NFILL; i++) {
      const d = ringDir();
      put(d, rnd.range(0.45, 1.0), pickCol(), rnd.next(), 0, rnd.range(0.03, 0.09), rnd.range(1.0, 2.0));
    }
    // 5) luminous gas: big soft sprites give the debris a glowing nebular body
    for (let i = 0; i < NGAS; i++) {
      const d = ringDir(); const c = pickCol();
      put(d, rnd.range(0.6, 1.0), [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], rnd.next(), 0, rnd.range(0.010, 0.022), rnd.range(14, 26));
    }
    // 4) forward shock: thin, blue-white, slightly corrugated
    for (let i = 0; i < NF; i++) {
      const d = rnd.onSphere();
      const cor = fbm3js(d[0] * 6, d[1] * 6, d[2] * 6, 3);
      put(d, 1.0 + 0.05 * cor - Math.abs(rnd.gauss()) * 0.03, [1.9, 2.5, 4.2], rnd.next(), 1, rnd.range(0.12, 0.3) * (1 + 0.8 * Math.max(0, cor)), rnd.range(0.9, 1.6));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aD', new THREE.BufferAttribute(D4, 4)); g.setAttribute('aS', new THREE.BufferAttribute(S4, 4)); g.setAttribute('aC', new THREE.BufferAttribute(C3, 3));
    this.novaU = {
      uT: { value: 0 }, uRe: { value: 1 }, uRf: { value: 1 }, uPx: { value: 1 }, uFrontA: { value: 1 }, uEjA: { value: 1 }, uHeat: { value: 0 },
      uStretch: { value: new THREE.Vector3(1.35, 1, 1.1) }, uAxis: { value: new THREE.Vector3(0, 0, 1) },
    };
    this.nova = new THREE.Points(g, addMat(NOVA_VERT, POINT_FRAG, this.novaU)); this.nova.frustumCulled = false;
    this.scene.add(this.nova);

    // sparks (line streaks)
    const NS = 12000;
    const SD = new Float32Array(NS * 2 * 4), SE = new Float32Array(NS * 2 * 2);
    for (let i = 0; i < NS; i++) {
      const d = rnd.onSphere(); const sp = rnd.range(60, 260) * (rnd.next() < 0.1 ? 1.6 : 1);
      const b = rnd.range(0.5, 1.8);
      for (let e = 0; e < 2; e++) { SD.set([d[0], d[1], d[2], sp], (i * 2 + e) * 4); SE.set([e, b], (i * 2 + e) * 2); }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 2 * 3), 3));
    sg.setAttribute('aD', new THREE.BufferAttribute(SD, 4)); sg.setAttribute('aE', new THREE.BufferAttribute(SE, 2));
    this.sparkU = { uT: { value: 0 }, uLen: { value: 0.06 } };
    this.sparks = new THREE.LineSegments(sg, addMat(SPARK_VERT, LINE_FRAG, this.sparkU)); this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
  }

  setVisible(list) {
    for (const o of [this.star, this.starPatch, this.corona, this.heroProm, this.globalProm, this.infall, this.infallLines, this.pin, this.novaCore, this.pulsar, this.stars, this.sky, this.nova, this.sparks]) o.visible = list.includes(o);
  }

  update(shot, t, T) {
    const mode = shot.mode || 'surface';
    const px = this.uScaleRes;
    this.promU.uPx.value = 1.5 * px; this.infallU.uPx.value = 2.0 * px; this.starsU.uPx.value = 1.0 * px; this.novaU.uPx.value = 1.6 * px;
    if (mode === 'surface') return this.updSurface(t);
    if (mode === 'collapse') return this.updCollapse(t);
    return this.updNova(t);
  }

  updSurface(t) {
    const cam = this.camera;
    const c = this.surfaceCam(t);
    cam.fov = c.fov; cam.near = 20; cam.far = 60000; cam.updateProjectionMatrix();
    cam.position.copy(c.pos); cam.up.copy(c.up); cam.lookAt(c.pos.clone().add(c.dir)); cam.updateMatrixWorld();
    this.setVisible([this.starPatch, this.corona, this.heroProm]);
    const ph = 40 + t;
    Object.assign(this.starU, {});
    this.starU.uPhase.value = ph; this.starU.uFreq.value = 34; this.starU.uBright.value = 0.62; this.starU.uHot.value = 0;
    this.starU.uContrast.value = 1; this.starU.uSoft.value = 0; this.starU.uGrad.value = 0.45; this.starU.uScale.value = 1; this.starU.uWobble.value = 0; this.starU.uFlow.value = 1;
    this.corona.scale.setScalar(1); this.coronaU.uDetail.value = 1; this.coronaU.uInt.value = 1; this.coronaU.uPhase.value = ph; this.coronaU.uRim.value = 1;
    this.promU.uInt.value = 1; this.promU.uTime.value = ph; this.promU.uScale.value = 1; this.promU.uGrow.value = 0.25 * clamp(t / 16);
    return {
      scene: this.scene, camera: cam, target: null,
      post: { exposure: 0.9, bloomStrength: 0.5, bloomThreshold: 1.1, bloomKnee: 0.7, bloomRadius: 0.85, streak: 0.10, streakTint: [1.0, 0.55, 0.3],
        ca: 0.0010, vignette: 0.45, grain: 0.05, saturation: 1.08, contrast: 1.06, tint: [1.0, 0.96, 0.92], lift: [0.004, 0.0, 0.0] },
    };
  }

  updCollapse(t) {
    const cam = this.camera;
    // dolly out from the boiling surface to the whole star, then lock off
    const k = easeInOutCubic(clamp(t / 7.0));
    const dist = lerp(1450, 4700, k);
    const fov = 30;
    const drift = 1 - smoothstep(6, 7.5, t);
    const az = 0.25 + 0.06 * k + 0.02 * fbm1(t * 0.2) * drift;
    const el = 0.10 + 0.01 * fbm1(t * 0.17 + 4) * drift;
    cam.fov = fov; cam.near = 20; cam.far = 80000; cam.updateProjectionMatrix();
    cam.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();

    // sick pulsation, accelerating and growing
    const A = 0.008 + 0.034 * smoothstep(0.5, 10, t);
    const ph = 2 * Math.PI * (0.28 * t + 0.024 * t * t);
    const puls = A * (Math.sin(ph) + 0.35 * Math.sin(2.37 * ph + 1.3));
    const conv = 40 + t + 0.03 * t * t * t; // convection speeds up
    // implosion: core falls in over ~2.2 s (ease-in), outer layers lag behind
    const u = clamp((t - 10) / 2.2);
    const e = Math.pow(u, 2.0);
    const sc = (1 + puls * (1 - u)) * lerp(1, 0.0012, e);
    const sick = 1 + 0.18 * Math.max(0, Math.sin(ph * 3.1 + 0.5)) * smoothstep(5, 10, t);
    const bright = 0.36 * (1.0 - puls * 7.0) * sick * lerp(1, 0.22, smoothstep(0.1, 0.9, u));
    this.setVisible([this.star, this.corona, this.globalProm, this.infall, this.infallLines, this.pin, this.stars]);
    this.infallLines.visible = t > 9.9 && t < 12.6;
    const su = this.starU;
    su.uPhase.value = conv; su.uFreq.value = 10; su.uBright.value = bright; su.uHot.value = 0.55 * smoothstep(0.3, 1.0, u);
    su.uGrad.value = 0; su.uSoft.value = 0.35 + 0.65 * smoothstep(1.0, 5.0, t); su.uContrast.value = 1 + 0.3 * smoothstep(3, 10, t); su.uScale.value = sc;
    su.uWobble.value = (0.003 + 0.02 * smoothstep(2, 10, t)) * (1 - u); su.uFlow.value = 1;
    this.star.visible = sc > 0.003;
    const uo = clamp((t - 10.3) / 2.2), eo = Math.pow(uo, 2.2);
    const so = (1 + puls * 0.6) * lerp(1, 0.002, eo);
    this.corona.scale.setScalar(Math.max(so, 0.001) * 0.42); this.coronaU.uDetail.value = 0;
    this.coronaU.uR.value = R * Math.max(so, 0.001);
    this.coronaU.uInt.value = 0.9 * (1 - smoothstep(0.0, 0.7, uo)); this.coronaU.uPhase.value = conv; this.coronaU.uRim.value = lerp(1.0, 0.12, smoothstep(0, 0.15, u));
    this.globalProm.visible = e < 0.95;
    this.promU.uInt.value = 0.035 * (1 - smoothstep(0.3, 0.9, u)); this.promU.uTime.value = conv; this.promU.uScale.value = sc; this.promU.uGrow.value = 0;
    this.infallU.uT.value = t; this.infallU.uScale.value = 1 + puls * 0.8; this.infallU.uPhase.value = conv;
    // pinpoint: what is left once the star has fallen through itself
    const pu = this.pin.userData.u;
    const pinA = smoothstep(0.75, 1.0, u);
    const fl = 1 + 0.10 * Math.sin(t * 37.0) + 0.06 * Math.sin(t * 91.0);
    pu.uPos.value.set(0, 0, 0); pu.uSize.value = 14 * this.uScaleRes; pu.uCore.value = 40;
    pu.uCol.value.set(6, 6.5, 8).multiplyScalar(pinA * fl * (1 + 1.5 * Math.exp(-Math.max(0, t - 12.2) * 3)));
    this.starsU.uInt.value = 0.35 * (1 - smoothstep(10.5, 12.3, t)) + 0.12;
    const black = smoothstep(11.6, 12.5, t);
    return {
      scene: this.scene, camera: cam, target: new THREE.Vector3(0, 0, 0),
      post: { exposure: lerp(1.0, 0.9, black), bloomStrength: 0.7, bloomThreshold: 1.0, bloomKnee: 0.7, bloomRadius: 0.8,
        streak: lerp(0.10, 0.3, pinA), streakTint: [0.7, 0.8, 1.0], ca: 0.0016, vignette: 0.5, grain: 0.05, saturation: 1.12, contrast: 1.08,
        tint: [1.0, 0.94, 0.9], lift: [0, 0, 0], shake: 0.3 * smoothstep(9.8, 10.6, t) * (1 - smoothstep(11.6, 12.3, t)) },
    };
  }

  updNova(t) {
    const cam = this.camera;
    const D = 130;
    cam.fov = 50; cam.near = 1; cam.far = 80000; cam.updateProjectionMatrix();
    cam.position.set(0, 0, D); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    this.setVisible([this.nova, this.sparks, this.novaCore, this.pulsar, this.stars, this.sky]);
    const nu = this.novaU;
    nu.uT.value = t;
    nu.uRf.value = 6 + 85 * t;
    nu.uRe.value = 2 + 48 * (1 - Math.exp(-t / 1.2)) + 1.0 * t;
    nu.uFrontA.value = 1.6 * (1 - smoothstep(1.0, 1.9, t)) * smoothstep(0.0, 0.15, t);
    nu.uEjA.value = (1.4 * Math.exp(-t / 3) + 0.55) * smoothstep(0.05, 0.6, t);
    nu.uHeat.value = Math.exp(-t / 1.5);
    nu.uAxis.value.copy(cam.position).normalize();
    this.sparkU.uT.value = t;
    const cu = this.novaCore.userData.u;
    cu.uPos.value.set(0, 0, 0); cu.uSize.value = 900 * this.uScaleRes; cu.uCore.value = 30;
    cu.uCol.value.set(30, 32, 40).multiplyScalar(Math.exp(-t * 3.0));
    const pu = this.pulsar.userData.u;
    pu.uPos.value.set(0, 0, 0); pu.uSize.value = 18 * this.uScaleRes; pu.uCore.value = 90;
    pu.uCol.value.set(2.0, 2.6, 4.2).multiplyScalar(smoothstep(0.8, 2.0, t) * (0.8 + 0.2 * Math.sin(t * 25)));
    this.starsU.uInt.value = 0.6 * smoothstep(1.0, 3.0, t);
    this.skyU.uInt.value = 0.45 * smoothstep(0.2, 2.5, t) * (0.6 + 0.4 * Math.exp(-t / 6)); this.skyU.uT.value = t;
    const flash = 7.0 * Math.exp(-3.5 * Math.max(t, 0));
    return {
      scene: this.scene, camera: cam, target: null,
      post: { exposure: 1.0, bloomStrength: 0.9, bloomThreshold: 1.0, bloomKnee: 0.7, bloomRadius: 0.9,
        streak: 0.25 + 1.6 * Math.exp(-t / 0.8), streakTint: [0.45, 0.65, 1.0], ca: 0.0028, vignette: 0.45, grain: 0.05,
        saturation: 1.15, contrast: 1.06, tint: [1, 0.97, 0.97], lift: [0.002, 0, 0.004], flash,
        shake: clamp(1.0 * Math.exp(-t / 0.9)) * (1 - smoothstep(2.0, 2.8, t)) },
    };
  }

  dispose() {
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}
