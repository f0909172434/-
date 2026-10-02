// BONE (100–130 s): Yinxu, night, firelight. The only "real material" of the film, drawn like a catalogue plate:
// the plastron is relief seen as contour lines (iso-height), sutures and sulci as fine lines, the carvings as knife
// cuts filled with cinnabar, the cracks as fissures of light.
//
//   100–102   dissolve in from the river's narrowing slit onto one chiselled hollow (鑿) on the back of the plastron
//   102–103   pull back along the rows of hollows (長鑿 + 圓鑽); a red-hot bronze rod comes in
//   103.0     the rod touches the round hollow (鑽) of that pair; hiss to 105.5, the bone around it heats and glows
//   104.604   cut (between frames) to the front, where the heat shows through the thin floor
//   105.5     the snap: the crack 卜 (lib/crack.js) bursts from the junction, white-hot, grown with crackFront()
//   106–113   it cools to a warm line; pull back to the pair of charges facing each other across the midline (對貞)
//   113–119   read the question: 壬午卜，㱿貞：婦好肩凡有疾 (cinnabar), a slow reading glint runs down the columns
//   120–125   the whole plastron as a catalogue plate: rows of old cracks with their numerals, sutures, sulci
//   125.4–129.8  push into the crack: complete, front-on, junction at (962, 352), 338 px tall (as the title and
//                lineage use it) ; held to 131.5 for the dissolve into lineage
//
// Pure function of (shot, t). CPU work (fresh crack rebuild, reading glint) is cached per frame.
import * as THREE from '../../vendor/three.module.js';
import { PAL, PALETTE_GLSL } from '../look/palette.js';
import { SoftPoints } from '../look/points.js';
import { crackGeometry, crackFront, crackReach, crackWidth } from '../lib/crack.js';
import { hash1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, smootherstep, easeInOutSine, easeOutCubic } from '../lib/ease.js';
import * as PL from '../lib/plastron.js';
import { GLYPHS, TEXTS, NUMERALS } from '../lib/oracle_glyphs.js';

// ------------------------------------------------------------------------------------------------ timing (film s)
const T_START = 100, T_ROD = 101.3, T_TOUCH = 103.0, T_CUT = 104.604, T_SNAP = 105.5;
const CARDS = [[106, 112.4], [113, 119.4], [121, 127.4], [128, 134.2]];
const FOV = 28, TANH = Math.tan(FOV / 2 * Math.PI / 180);
const SC = 2.2;                          // crack scale: 1 unit of lib/crack.js = 2.2 cm on the bone
const FINAL = { fh: SC * 804 / 338, sx: 962, sy: 352 };
const HERO = PL.HERO, J = HERO.J;
const breath = T => 1 + 0.085 * Math.sin(2 * Math.PI * T / 4.7 + 0.3) + 0.05 * Math.sin(2 * Math.PI * T / 2.9 + 1.7) + 0.035 * Math.sin(2 * Math.PI * T / 7.3 + 4.1);
const FIRE_FRONT = new THREE.Vector3(-21, -3.5, 9.5), FIRE_BACK = new THREE.Vector3(-21, -5, -9.5);
const FIRE_COL = new THREE.Color().copy(PAL.line).lerp(PAL.c, 0.55);

// shared uniforms: screen-space calm for the cards (lower third) and the HUD corner (top left)
const SCREEN_GLSL = /* glsl */`
uniform vec2 uRes;
uniform float uCardDim;
float screenDim(){
  vec2 q = gl_FragCoord.xy / uRes;
  float lower = 1.0 - uCardDim * 0.6 * (1.0 - smoothstep(0.17, 0.40, q.y));
  float hud = 1.0 - 0.65 * (1.0 - smoothstep(0.15, 0.25, q.x)) * smoothstep(0.74, 0.84, q.y);
  return lower * hud;
}`;

// ------------------------------------------------------------------------------------------------ world-width lines
// Like lib/flines.js (non-instanced screen-space ribbons, additive), but widths are in world units (cm) so cuts and
// fissures scale with the camera; thinner than uMinW px they keep that width and dim instead (no aliasing).
// mode 0: soft glowing line ; mode 1: an engraved cut (fill colour in the groove, the wall facing the fire lit)
const WL_VERT = /* glsl */`
uniform vec2 uRes;
uniform float uPxScale;
uniform float uMinW;
uniform float uFocus;
uniform float uAperture;
uniform vec2 uLight2;
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aColA;
attribute vec4 aColB;
attribute vec2 aW;
attribute vec2 aCorner;
attribute float aRim;
varying vec4 vCol;
varying float vAcross;
varying float vWpx;
varying float vLit;
varying float vRim;
void main(){
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(aA, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
  float fa = ca.z + ca.w, fb = cb.z + cb.w;
  if (fa <= 0.0 && fb <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  if (fa < 0.0) ca = mix(ca, cb, fa / (fa - fb) + 1e-4);
  if (fb < 0.0) cb = mix(cb, ca, fb / (fb - fa) + 1e-4);
  vec2 sa = ca.xy / ca.w * 0.5 * uRes, sb = cb.xy / cb.w * 0.5 * uRes;
  vec2 d = sb - sa; float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float t = aCorner.x, side = aCorner.y;
  vec4 c = mix(ca, cb, t);
  float w = mix(aW.x, aW.y, t) * projectionMatrix[1][1] * 0.5 * uRes.y / max(c.w, 1e-5);
  float gain = 1.0, mw = uMinW * uPxScale;
  if (w < mw) { gain = w / mw; w = mw; }
  if (uAperture > 0.0) {
    float coc = uAperture * abs(c.w - uFocus) / max(c.w, 1e-6) * uPxScale * 100.0;
    float w2 = min(sqrt(w * w + coc * coc), 40.0 * uPxScale);
    gain *= w / max(w2, 1e-3); w = w2;
  }
  float hw = 0.5 * w + 1.0;
  vec2 s = mix(sa, sb, t) + nrm * side * hw;
  gl_Position = vec4(s / (0.5 * uRes) * c.w, c.z, c.w);
  vCol = mix(aColA, aColB, t); vCol.a *= gain;
  vAcross = side * hw; vWpx = 0.5 * w;
  vLit = dot(nrm, uLight2) >= 0.0 ? 1.0 : -1.0;
  vRim = aRim;
}`;
const WL_FRAG = SCREEN_GLSL + /* glsl */`
uniform float uOpacity;
uniform int uMode;
uniform vec3 uRimCol;
varying vec4 vCol;
varying float vAcross;
varying float vWpx;
varying float vLit;
varying float vRim;
void main(){
  float d = abs(vAcross);
  float edge = 1.0 - smoothstep(vWpx - 0.5, vWpx + 0.75, d);
  vec3 col; float a;
  if (uMode == 0) {
    float core = exp(-d * d / max(vWpx * vWpx, 0.25) * 1.6);
    a = edge * (0.55 + 0.45 * core);
    col = vCol.rgb;
  } else {
    float x = vAcross / max(vWpx, 0.5);
    float fill = 1.0 - smoothstep(0.35, 1.05, abs(x));
    float wall = exp(-pow((-x * vLit - 0.66) / 0.2, 2.0));   // the far wall of the cut catches the light
    float detail = smoothstep(1.4, 3.6, vWpx);
    vec3 thin = vCol.rgb * 0.95 + uRimCol * vRim * 0.12;
    vec3 wide = vCol.rgb * (0.5 + 0.5 * fill) + uRimCol * vRim * wall * 0.45;
    col = mix(thin, wide, detail);
    a = edge;
  }
  a *= vCol.a * uOpacity * screenDim();
  if (a <= 0.0004) discard;
  gl_FragColor = vec4(col * a, 1.0);
}`;

class WLines {
  constructor(shared, { mode = 0, minW = 1.0, depthTest = false, rimCol = PAL.line, aperture = 0, focus = 10 } = {}) {
    this.uniforms = {
      ...shared,
      uPxScale: { value: shared.uRes.value.y / 804 },
      uMinW: { value: minW }, uFocus: { value: focus }, uAperture: { value: aperture },
      uOpacity: { value: 1 }, uMode: { value: mode }, uRimCol: { value: new THREE.Color(rimCol) },
      uLight2: { value: new THREE.Vector2(-0.9, -0.35).normalize() },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: WL_VERT, fragmentShader: WL_FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.capacity = 0;
  }
  _alloc(n) {
    if (n <= this.capacity) return;
    const cap = Math.max(n, Math.ceil(this.capacity * 1.5)), g = this.geometry;
    const mk = k => { const a = new THREE.BufferAttribute(new Float32Array(cap * 4 * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    for (const [name, k] of [['aA', 3], ['aB', 3], ['aColA', 4], ['aColB', 4], ['aW', 2], ['aRim', 1]]) g.setAttribute(name, mk(k));
    const corner = new Float32Array(cap * 8);
    for (let i = 0; i < cap; i++) corner.set([0, -1, 1, -1, 0, 1, 1, 1], i * 8);
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 12), 3));
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6); }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.capacity = cap;
  }
  // lines: [{ p: Float32Array xyz, c: Float32Array rgba per vertex, w: Float32Array cm per vertex, rim }]
  set(lines) {
    let n = 0;
    for (const l of lines) n += Math.max(0, l.p.length / 3 - 1);
    this._alloc(Math.max(1, n));
    const g = this.geometry, A = g.attributes.aA.array, B = g.attributes.aB.array, CA = g.attributes.aColA.array,
      CB = g.attributes.aColB.array, W = g.attributes.aW.array, R = g.attributes.aRim.array;
    let k = 0;
    for (const l of lines) {
      const p = l.p, c = l.c, w = l.w, m = p.length / 3, rim = l.rim ?? 1;
      for (let i = 0; i < m - 1; i++, k++) {
        for (let v = 0; v < 4; v++) {
          const q = k * 4 + v;
          A[q * 3] = p[i * 3]; A[q * 3 + 1] = p[i * 3 + 1]; A[q * 3 + 2] = p[i * 3 + 2];
          B[q * 3] = p[i * 3 + 3]; B[q * 3 + 1] = p[i * 3 + 4]; B[q * 3 + 2] = p[i * 3 + 5];
          CA[q * 4] = c[i * 4]; CA[q * 4 + 1] = c[i * 4 + 1]; CA[q * 4 + 2] = c[i * 4 + 2]; CA[q * 4 + 3] = c[i * 4 + 3];
          CB[q * 4] = c[i * 4 + 4]; CB[q * 4 + 1] = c[i * 4 + 5]; CB[q * 4 + 2] = c[i * 4 + 6]; CB[q * 4 + 3] = c[i * 4 + 7];
          W[q * 2] = w[i]; W[q * 2 + 1] = w[i + 1];
          R[q] = rim;
        }
      }
    }
    for (const key of ['aA', 'aB', 'aColA', 'aColB', 'aW', 'aRim']) g.attributes[key].needsUpdate = true;
    g.setDrawRange(0, k * 6);
    return k;
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

// ------------------------------------------------------------------------------------------------ the bone surface
// A grid over the plastron's bounding box, displaced to the front (dome + grooves) or back (dome - thickness +
// hollows) face, clipped by the outline SDF. Light lives only in iso-height lines lit by the fire (raking), plus the
// heat of the rod and, on the back, the scorch of the hollows already used. The hero hollow is drawn analytically
// by its own fine patch.
const SURF_VERT = PL.DOME_GLSL + PL.HOLLOW_GLSL + /* glsl */`
uniform sampler2D tRelief;
uniform vec4 uBox;
uniform int uBack;
uniform int uHero;
uniform vec2 uZc; uniform vec3 uZ; uniform vec2 uUc; uniform vec2 uU;
varying vec2 vP;
varying vec3 vW;
varying float vDepth;
float heroDepth(vec2 p){ return min(hollowDepth(p, uZc, uZ.x, uZ.y, uZ.z, uUc, uU.x, uU.y), thick(p) - 0.09); }
void main(){
  vec2 p = position.xy;
  float z = dome(p);
  if (uBack == 1) {
    float rel = uHero == 1 ? heroDepth(p) : texture2D(tRelief, (p - uBox.xy) * uBox.zw).r;
    z = z - thick(p) + rel;
  } else {
    z += texture2D(tRelief, (p - uBox.xy) * uBox.zw).r;
  }
  vec4 wp = modelMatrix * vec4(p, z, 1.0);
  vec4 mv = viewMatrix * wp;
  vP = p; vW = wp.xyz; vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const SURF_FRAG = PALETTE_GLSL + SCREEN_GLSL + PL.DOME_GLSL + PL.HOLLOW_GLSL + /* glsl */`
uniform sampler2D tRelief;
uniform sampler2D tSdf;
uniform vec4 uBox;
uniform int uBack;
uniform int uHero;
uniform vec2 uZc; uniform vec3 uZ; uniform vec2 uUc; uniform vec2 uU;
uniform vec4 uHole;          // xy0, xy1 of the hero patch (the main back mesh leaves it to the patch)
uniform float uSpacing;
uniform float uWidth;
uniform float uPxScale;
uniform float uFocus;
uniform float uAperture;
uniform vec3 uFirePos;
uniform vec3 uFireCol;
uniform float uFireI;
uniform float uAmb;
uniform float uFill;
uniform vec2 uHeatPos;
uniform float uHeat;
uniform float uHeatR;
uniform float uHeroBurn;
uniform float uRim;
uniform float uOpacity;
uniform float uLineGain;
varying vec2 vP;
varying vec3 vW;
varying float vDepth;
float aaLines(float f, float wpx){
  float fw = max(fwidth(f), 1e-5);
  float d = abs(fract(f + 0.5) - 0.5) / fw;
  float line = 1.0 - smoothstep(wpx * 0.5 - 0.5, wpx * 0.5 + 0.75, d);
  float dense = smoothstep(0.2, 0.5, fw);
  return mix(line, 0.3 * min(1.0, wpx * fw), dense);
}
float heroDepth(vec2 p){ return min(hollowDepth(p, uZc, uZ.x, uZ.y, uZ.z, uUc, uU.x, uU.y), thick(p) - 0.09); }
void main(){
  vec2 uv = (vP - uBox.xy) * uBox.zw;
  float sdf = texture2D(tSdf, uv).r;
  float sw = max(fwidth(sdf), 1e-4);
  float inside = 1.0 - smoothstep(-0.5 * sw, 0.5 * sw, sdf);
  if (inside <= 0.002) discard;
  if (uBack == 1 && uHero == 0 && vP.x > uHole.x && vP.x < uHole.z && vP.y > uHole.y && vP.y < uHole.w) discard;
  float z; vec2 g; float burn = 0.0;
  if (uBack == 1) {
    vec4 R;
    if (uHero == 1) {
      float e = 0.003;
      float h0 = heroDepth(vP);
      R = vec4(h0, (heroDepth(vP + vec2(e, 0.0)) - heroDepth(vP - vec2(e, 0.0))) / (2.0 * e),
                   (heroDepth(vP + vec2(0.0, e)) - heroDepth(vP - vec2(0.0, e))) / (2.0 * e), 0.0);
      float r = length(vP - uUc) / uU.x;
      burn = uHeroBurn * (1.0 - smoothstep(0.5, 1.0, r));
    } else {
      R = texture2D(tRelief, uv);
      burn = R.a;
    }
    z = dome(vP) - thick(vP) + R.r;
    g = domeGrad(vP) - thickGrad(vP) + R.gb;
  } else {
    vec4 R = texture2D(tRelief, uv);
    z = dome(vP) + R.r;
    g = domeGrad(vP) + R.gb;
  }
  vec3 N = uBack == 1 ? normalize(vec3(g, -1.0)) : normalize(vec3(-g, 1.0));
  // iso-height lines, widened and dimmed out of focus (energy conserving)
  float wpx = uWidth * uPxScale, gain = 1.0;
  if (uAperture > 0.0) {
    float coc = uAperture * abs(vDepth - uFocus) / max(vDepth, 1e-4) * uPxScale * 100.0;
    float w2 = sqrt(wpx * wpx + coc * coc); gain = wpx / w2; wpx = w2;
  }
  float lines = aaLines(z / uSpacing, wpx) * gain;
  // firelight: raking, slowly breathing
  vec3 Lv = uFirePos - vW; float dist = length(Lv); vec3 L = Lv / dist;
  float diff = max(dot(N, L), 0.0);
  float att = uFireI / (1.0 + dist * dist / 330.0);
  vec3 lineCol = (PAL_LINE * uAmb + uFireCol * diff * att) * uLineGain;
  // heat of the rod (back) or through the thin floor (front)
  float hd = length(vP - uHeatPos);
  float heat = uHeat * exp(-hd * hd / (2.0 * uHeatR * uHeatR));
  vec3 heatCol = mix(PAL_C, PAL_HOT, clamp(heat * heat, 0.0, 1.0));
  lineCol = lineCol * (1.0 - 0.75 * burn) + heatCol * heat * 2.2;
  vec3 col = lineCol * lines;
  col += PAL_C * (uFill * diff * att) + heatCol * heat * heat * 0.35;
  // scorched floor of used hollows: a fine engraver's hatch, dim and warm
  if (burn > 0.01) {
    float hf = (vP.x + vP.y) / 0.035;
    col += PAL_C * 0.05 * burn * aaLines(hf, 0.8 * uPxScale) * (0.3 + diff * att);
  }
  // the cut edge of the bone
  float rim = exp(-sdf * sdf / (sw * sw * 2.2)) * uRim * (0.25 + 0.75 * diff * att / max(uFireI, 1e-3));
  col += PAL_LINE * rim;
  col *= inside * uOpacity * screenDim();
  gl_FragColor = vec4(col, 1.0);
}`;

function gridGeometry(x0, x1, y0, y1, step) {
  const nx = Math.max(2, Math.round((x1 - x0) / step) + 1), ny = Math.max(2, Math.round((y1 - y0) / step) + 1);
  const pos = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const o = (j * nx + i) * 3;
    pos[o] = x0 + (x1 - x0) * i / (nx - 1); pos[o + 1] = y0 + (y1 - y0) * j / (ny - 1);
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let k = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function halfTexture(data, W, H, channels) {
  const n = data.length, out = new Uint16Array(n), toHalf = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < n; i++) out[i] = toHalf(data[i]);
  const tex = new THREE.DataTexture(out, W, H, channels === 4 ? THREE.RGBAFormat : THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------------------------------------ helpers
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function lightAt(fire, x, y, z, nx, ny, nz) {        // the surface shader's fire term, for line colours on the CPU
  const lx = fire.x - x, ly = fire.y - y, lz = fire.z - z, d = Math.hypot(lx, ly, lz);
  const diff = Math.max(0, (lx * nx + ly * ny + lz * nz) / d);
  return diff / (1 + d * d / 330);
}
function frontNormal(x, y) { const [gx, gy] = PL.domeGrad(x, y); const l = Math.hypot(gx, gy, 1); return [-gx / l, -gy / l, 1 / l]; }
function backNormal(x, y) { const [gx, gy] = PL.domeGrad(x, y); const l = Math.hypot(gx, gy, 1); return [gx / l, gy / l, -1 / l]; }
const zFront = (x, y) => PL.dome(x, y) + 0.004;
const zBack = (x, y) => PL.dome(x, y) - PL.thickness(x, y) - 0.004;

// subdivide a 2D polyline so it follows the curved surface and can taper
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}

// a line on a face: colour from the fire (lit) + ambient, width per vertex
function faceLine(pts2, { back = false, fire, base, lit, amb = 0, alpha = 1, width, taper = 0, wvar = null, rim = 1, step = 0.05 }) {
  const P = densify(pts2, step), m = P.length;
  const p = new Float32Array(m * 3), c = new Float32Array(m * 4), w = new Float32Array(m);
  let L = 0; const cum = [0];
  for (let i = 1; i < m; i++) { L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); cum.push(L); }
  for (let i = 0; i < m; i++) {
    const [x, y] = P[i], z = back ? zBack(x, y) : zFront(x, y);
    const n = back ? backNormal(x, y) : frontNormal(x, y);
    const l = lightAt(fire, x, y, z, n[0], n[1], n[2]);
    p.set([x, y, z], i * 3);
    const k = amb + lit * l;
    c.set([base.r * k, base.g * k, base.b * k, alpha], i * 4);
    let ww = width;
    if (taper > 0) ww *= (0.3 + 0.7 * smoothstep(0, taper, cum[i])) * (0.3 + 0.7 * smoothstep(0, taper, L - cum[i]));
    if (wvar) ww *= wvar(cum[i] / Math.max(L, 1e-6));
    w[i] = ww;
  }
  return { p, c, w, rim };
}

// glyph strokes placed on the bone: centre (cx, cy) in cm, height `size`, mirrored if `mirror`
function glyphStrokes(ch, cx, cy, size, mirror) {
  const g = GLYPHS[ch];
  if (!g) return [];
  return g.s.map(s => {
    const pts = [];
    for (let i = 0; i < s.length; i += 2) {
      const x = (s[i] - 0.5) * size;
      pts.push([cx + (mirror ? -x : x), cy - (s[i + 1] - 0.5) * size]);
    }
    return pts;
  });
}
// a vertical inscription: columns of glyphs, read top-down; columns advance by `dx`
function inscription(cols, x0, dx, yTop, pitch, size, mirror) {
  const out = [];
  cols.forEach((col, ci) => [...col].forEach((ch, i) => out.push({ ch, cx: x0 + dx * ci, cy: yTop - pitch * (i + 0.5), size, mirror })));
  return out;
}
// crack polylines of lib/crack.js placed at junction J (cm), scale s, mirrored for the right half, rotated by rot
function crackPlace(C, Jx, Jy, s, mirror, rot = 0) {
  const cr = Math.cos(rot), sr = Math.sin(rot), sg = mirror ? -1 : 1;
  return C.lines.map(P => P.pts.map(([x, y]) => [Jx + sg * (x * cr - y * sr) * s, Jy + (x * sr + y * cr) * s]));
}

// outline of a hollow: the slot's edge outside the round hollow, and the round hollow's edge outside the slot
function hollowRim(h) {
  const z = h.zao, u = h.zuan, segs = [];
  const inZuan = (x, y) => Math.hypot(x - u.c[0], y - u.c[1]) < u.R * 0.995;
  const inZao = (x, y) => { const v = (y - z.c[1]) / z.a; if (Math.abs(v) >= 1) return false; return Math.abs(x - z.c[0]) < z.b * Math.pow(1 - v * v, 0.75) * 0.995; };
  const push = (pts, inside) => { let cur = []; for (const p of pts) { if (inside(p[0], p[1])) { if (cur.length > 1) segs.push(cur); cur = []; } else cur.push(p); } if (cur.length > 1) segs.push(cur); };
  for (const sg of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 48; i++) { const v = -1 + 2 * i / 48; pts.push([z.c[0] + sg * z.b * Math.pow(1 - v * v, 0.75), z.c[1] + v * z.a]); }
    push(pts, inZuan);
  }
  const cp = [];
  for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; cp.push([u.c[0] + Math.cos(a) * u.R, u.c[1] + Math.sin(a) * u.R]); }
  push(cp, inZao);
  return segs;
}

// ------------------------------------------------------------------------------------------------ cameras
function lookCam(cam, pos, look) { cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(look); cam.updateMatrixWorld(); }

// front-view rig keys: [T, cx, cy, frame height (cm), yaw°, pitch°]
const JX = J[0], JY = J[1];
const FKEYS = [
  [T_CUT - 0.1, JX + 0.32, JY - 0.30, 4.85, 0, 0],
  [T_SNAP, JX + 0.32, JY - 0.30, 4.62, 0, 0],
  [106.3, JX + 0.32, JY - 0.30, 4.58, 0, 0],
  [112.3, 0.0, 2.72, 8.3, 0, -2.5],
  [113.0, -0.1, 2.72, 8.2, 0, -2.5],
  [119.3, -2.55, 2.98, 7.0, -3.5, -1.5],
  [121.5, 0.0, -0.9, 34.0, -3.0, 1.5],
  [125.4, 0.0, -0.75, 32.0, 2.0, 0],
];
const T_ZOOM0 = 125.4, T_ZOOM1 = 129.8;
function frontRig(T) {
  if (T >= T_ZOOM0) {
    const k0 = FKEYS[FKEYS.length - 1];
    const sx0 = 960 + (JX - k0[1]) / k0[3] * 804, sy0 = 402 - (JY - k0[2]) / k0[3] * 804;
    const k = easeInOutSine(clamp((T - T_ZOOM0) / (T_ZOOM1 - T_ZOOM0)));
    const kz = smootherstep(0, 1, clamp((T - T_ZOOM0) / (T_ZOOM1 - T_ZOOM0)));
    const fh = Math.exp(lerp(Math.log(k0[3]), Math.log(FINAL.fh), kz));
    // keep the junction on a straight screen path while zooming into it
    const sx = lerp(sx0, FINAL.sx, k), sy = lerp(sy0, FINAL.sy, k);
    const drift = smoothstep(T_ZOOM1, 131.5, T);
    return { cx: JX - (sx - 960) / 804 * fh, cy: JY - (402 - sy) / 804 * fh, fh: fh * (1 - 0.006 * drift), yaw: lerp(k0[4], 0, k), pitch: lerp(k0[5], 0, k) };
  }
  let i = 0;
  while (i < FKEYS.length - 2 && T > FKEYS[i + 1][0]) i++;
  const a = FKEYS[i], b = FKEYS[i + 1];
  const k = easeInOutSine(clamp((T - a[0]) / (b[0] - a[0])));
  return {
    cx: lerp(a[1], b[1], k), cy: lerp(a[2], b[2], k), fh: Math.exp(lerp(Math.log(a[3]), Math.log(b[3]), k)),
    yaw: lerp(a[4], b[4], k), pitch: lerp(a[5], b[5], k),
  };
}

// ------------------------------------------------------------------------------------------------ the scene
export default class Bone {
  constructor(ctx) { this.ctx = ctx; }

  async init() {
    const { width, height } = this.ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 400);
    this.shared = { uRes: { value: new THREE.Vector2(width, height) }, uCardDim: { value: 0 } };
    const shared = this.shared;

    // ---- fields and textures
    const F = PL.buildFields();
    this.texFront = halfTexture(F.front.data, F.front.W, F.front.H, 4);
    this.texBack = halfTexture(F.back.data, F.back.W, F.back.H, 4);
    this.texSdf = halfTexture(F.sdf.data, F.sdf.W, F.sdf.H, 1);
    const B = PL.BBOX, box = new THREE.Vector4(B.x0, B.y0, 1 / (B.x1 - B.x0), 1 / (B.y1 - B.y0));
    const hz = HERO.zao, hu = HERO.zuan;
    const holeRect = new THREE.Vector4(hz.c[0] - 0.62, hz.c[1] - 0.98, hz.c[0] + 0.62 + 0.36, hz.c[1] + 0.98);
    if (HERO.side < 0) { holeRect.x -= 0.36; holeRect.z -= 0.36; }
    const surf = (back, hero) => new THREE.ShaderMaterial({
      vertexShader: SURF_VERT, fragmentShader: SURF_FRAG, side: THREE.DoubleSide,
      uniforms: {
        ...shared,
        tRelief: { value: back ? this.texBack : this.texFront }, tSdf: { value: this.texSdf }, uBox: { value: box },
        uBack: { value: back ? 1 : 0 }, uHero: { value: hero ? 1 : 0 },
        uZc: { value: new THREE.Vector2(...hz.c) }, uZ: { value: new THREE.Vector3(hz.a, hz.b, hz.D) },
        uUc: { value: new THREE.Vector2(...hu.c) }, uU: { value: new THREE.Vector2(hu.R, hu.D) },
        uHole: { value: holeRect },
        uSpacing: { value: back ? 0.048 : 0.022 }, uWidth: { value: 1.0 }, uPxScale: { value: height / 804 },
        uFocus: { value: 10 }, uAperture: { value: 0 },
        uFirePos: { value: back ? FIRE_BACK.clone() : FIRE_FRONT.clone() }, uFireCol: { value: FIRE_COL.clone() },
        uFireI: { value: 1 }, uAmb: { value: 0.04 }, uFill: { value: 0.003 },
        uHeatPos: { value: new THREE.Vector2(...hu.c) }, uHeat: { value: 0 }, uHeatR: { value: 0.4 }, uHeroBurn: { value: 0 },
        uRim: { value: 0.55 }, uOpacity: { value: 1 }, uLineGain: { value: back ? 0.9 : 0.62 },
      },
    });
    this.matFront = surf(false, false); this.matBack = surf(true, false); this.matHero = surf(true, true);
    this.front = new THREE.Mesh(gridGeometry(B.x0, B.x1, B.y0, B.y1, 0.15), this.matFront);
    // the back is only seen around the hero hollow: a fine grid over that region only
    this.back = new THREE.Mesh(gridGeometry(B.x0, 3.5, -2.5, 12.2, 0.05), this.matBack);
    this.heroPatch = new THREE.Mesh(gridGeometry(holeRect.x - 0.03, holeRect.z + 0.03, holeRect.y - 0.03, holeRect.w + 0.03, 0.018), this.matHero);
    for (const m of [this.front, this.back, this.heroPatch]) { m.frustumCulled = false; this.scene.add(m); }

    // ---- lines of the front face
    const ff = FIRE_FRONT, fb = FIRE_BACK;
    this.frontLines = new WLines(shared, { mode: 0, minW: 1.0 });
    const fl = [];
    fl.push(faceLine(PL.OUTLINE, { fire: ff, base: PAL.line, lit: 1.25, amb: 0.06, width: 0.03, step: 0.08 }));
    for (const s of PL.SULCI) fl.push(faceLine(s, { fire: ff, base: PAL.line, lit: 0.95, amb: 0.035, width: 0.026, taper: 0.4, step: 0.08 }));
    for (const s of PL.SUTURES) fl.push(faceLine(s, { fire: ff, base: PAL.line, lit: 0.55, amb: 0.02, width: 0.012, step: 0.08 }));
    // old cracks with their crack-order numerals
    const crackLines = [], numerals = [];
    const halves = [-1, 1].map(sg => PL.HOLLOWS.filter(h => h.used && Math.sign(h.J[0]) === sg).sort((a, b) => b.J[1] - a.J[1] || Math.abs(a.J[0]) - Math.abs(b.J[0])));
    let seed = 1;
    for (const list of halves) list.forEach((h, i) => {
      const mirror = h.J[0] > 0, sd = seed++;
      const C = crackGeometry({ seed: h.mate ? 7 : sd });
      const s = h.mate ? SC : SC * (0.8 + 0.22 * hash1(sd * 3.1));
      const rot = h.mate ? 0 : (hash1(sd * 7.7) - 0.5) * 0.14;
      const placed = crackPlace(C, h.J[0], h.J[1], s, mirror, rot);
      placed.forEach((pts, li) => {
        const P = C.lines[li];
        crackLines.push(faceLine(pts, { fire: ff, base: PAL.line, lit: 1.3, amb: 0.1, width: 0.016 * s / SC, step: 0.03,
          wvar: u => crackWidth(P, u * P.L) }));
      });
      const n = NUMERALS[i % 5], ns = 0.38, side = h.side;
      for (const st of glyphStrokes(n, h.J[0] + side * 0.6 * s / SC, h.J[1] + 0.34, ns, false))
        numerals.push(faceLine(st, { fire: ff, base: PAL.line, lit: 0.6, amb: 0.03, width: 0.028, taper: 0.06, step: 0.04 }));
    });
    this.oldCracks = crackLines.length;
    fl.push(...crackLines);
    this.frontLines.set(fl);
    this.scene.add(this.frontLines.mesh);

    // ---- carvings (engraved): the question in cinnabar, older ones plain
    this.cuts = new WLines(shared, { mode: 1, minW: 1.0, rimCol: PAL.line });
    const main = inscription(['壬午卜㱿', '貞帚好肩', '凡㞢疾'], -1.62, -0.9, 5.62, 0.9, 0.8, false);
    const mate = inscription(['貞帚好', '弗其肩', '凡㞢疾'], 1.62, 0.9, 5.62, 0.9, 0.8, true);
    const rainL = inscription(['貞今日', '其雨'], -1.05, -0.8, -1.5, 0.8, 0.7, false);
    const rainR = inscription(['今日不', '其雨'], 1.05, 0.8, -1.5, 0.8, 0.7, true);
    this.mainGlyphs = main;
    const cutLine = (st, color, lit, amb, width, rim) => faceLine(st, { fire: ff, base: color, lit, amb, width, taper: 0.1, step: 0.035, rim,
      wvar: u => 0.92 + 0.16 * Math.sin(u * 5.3 + st[0][0] * 7.1) });
    this.cutStatic = [];
    for (const g of mate) for (const st of glyphStrokes(g.ch, g.cx, g.cy, g.size, g.mirror)) this.cutStatic.push(cutLine(st, PAL.cinnabar, 1.25, 0.12, 0.042, 0.8));
    for (const g of [...rainL, ...rainR]) for (const st of glyphStrokes(g.ch, g.cx, g.cy, g.size, g.mirror)) this.cutStatic.push(cutLine(st, PAL.line, 0.38, 0.025, 0.036, 0.6));
    this.cutStatic.push(...numerals);
    // the main inscription is rebuilt per frame for the reading glint
    this.mainStrokes = main.map((g, gi) => glyphStrokes(g.ch, g.cx, g.cy, g.size, g.mirror).map(st => ({ gi, line: cutLine(st, PAL.cinnabar, 1.25, 0.12, 0.044, 0.8) })));
    this.scene.add(this.cuts.mesh);

    // ---- the back face: outline, sutures, the king's prognostication
    this.backLines = new WLines(shared, { mode: 0, minW: 1.0, depthTest: true, aperture: 0, focus: 10 });
    const bl = [];
    bl.push(faceLine(PL.OUTLINE, { back: true, fire: fb, base: PAL.line, lit: 1.2, amb: 0.05, width: 0.03, step: 0.08 }));
    for (const s of PL.SUTURES) bl.push(faceLine(s, { back: true, fire: fb, base: PAL.line, lit: 0.7, amb: 0.03, width: 0.014, step: 0.06 }));
    // the rim of every hollow (the union of the slot and the round hollow), as a catalogue drawing outlines it
    for (const h of PL.HOLLOWS) {
      if (h.J[0] > 3.5 || h.J[1] < -2.0) continue;
      for (const seg of hollowRim(h)) bl.push(faceLine(seg, { back: true, fire: fb, base: PAL.line, lit: 1.1, amb: 0.05, width: 0.011, step: 0.03 }));
    }
    this.backLines.set(bl);
    this.scene.add(this.backLines.mesh);
    this.backCuts = new WLines(shared, { mode: 1, minW: 1.0, depthTest: true, rimCol: PAL.line });
    const backTxt = inscription([TEXTS.back], -5.86, 0, 3.78, 0.86, 0.74, true);
    const bc = [];
    for (const g of backTxt) for (const st of glyphStrokes(g.ch, g.cx, g.cy, g.size, g.mirror))
      bc.push(faceLine(st, { back: true, fire: fb, base: PAL.line, lit: 0.75, amb: 0.04, width: 0.05, taper: 0.09, step: 0.035, rim: 0.8 }));
    this.backCuts.set(bc);
    this.backCuts.uniforms.uLight2.value.set(0.9, -0.35).normalize();
    this.scene.add(this.backCuts.mesh);

    // ---- the fresh crack (rebuilt per frame while it grows and cools) + its halo
    this.crackC = crackGeometry();
    this.crack = new WLines(shared, { mode: 0, minW: 1.0 });
    this.halo = new WLines(shared, { mode: 0, minW: 2.0 });
    this.scene.add(this.halo.mesh); this.scene.add(this.crack.mesh);
    this.crackPts = crackPlace(this.crackC, JX, JY, SC, false, 0).map(pts => densify(pts, 0.012));

    // ---- the bronze rod, red-hot at the tip
    this.rodLen = 26; this.rodR = 0.25;
    this.rodMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uFirePos: { value: FIRE_BACK.clone() }, uFireCol: { value: FIRE_COL.clone() }, uFireI: { value: 1 },
        uHalf: { value: this.rodLen / 2 + this.rodR }, uPxScale: { value: height / 804 }, uHeat: { value: 1 } },
      vertexShader: /* glsl */`
        varying vec3 vL; varying vec3 vN; varying vec3 vW;
        void main(){ vL = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: PALETTE_GLSL + SCREEN_GLSL + /* glsl */`
        uniform vec3 uFirePos; uniform vec3 uFireCol; uniform float uFireI; uniform float uHalf; uniform float uPxScale; uniform float uHeat;
        varying vec3 vL; varying vec3 vN; varying vec3 vW;
        float aaL(float f, float wpx){ float fw = max(fwidth(f), 1e-5); float d = abs(fract(f + 0.5) - 0.5) / fw;
          float line = 1.0 - smoothstep(wpx * 0.5 - 0.5, wpx * 0.5 + 0.75, d); return mix(line, min(1.0, wpx * fw), smoothstep(0.2, 0.5, fw)); }
        void main(){
          float s = vL.y + uHalf;                       // cm from the tip
          float ang = atan(vL.z, vL.x) / 6.2831853 * 10.0;
          float rings = aaL(s / 0.32, 1.0 * uPxScale), longi = aaL(ang, 1.0 * uPxScale);
          vec3 Lv = uFirePos - vW; float d = length(Lv);
          float diff = max(dot(normalize(vN), Lv / d), 0.0) * uFireI / (1.0 + d * d / 330.0);
          float e1 = exp(-s / 0.28), e2 = exp(-s / 0.9), e3 = exp(-s / 2.6);
          vec3 glow = (PAL_HOT * 4.0 * e1 + PAL_C * 1.6 * e2 + PAL_C * 0.12 * e3) * uHeat;
          vec3 lineC = PAL_LINE * (0.025 + 0.55 * diff) + glow;
          vec3 col = lineC * max(rings, 0.18 * longi) + glow * 0.45;
          gl_FragColor = vec4(col * screenDim(), 1.0);
        }`,
    });
    this.rod = new THREE.Mesh(new THREE.CapsuleGeometry(this.rodR, this.rodLen, 8, 32), this.rodMat);
    this.rod.frustumCulled = false;
    this.scene.add(this.rod);
    // contact: the rod's round tip sits in the round hollow
    const cz = PL.dome(hu.c[0], hu.c[1]) - PL.thickness(hu.c[0], hu.c[1]) + Math.min(hu.D, PL.thickness(hu.c[0], hu.c[1]) - 0.09);
    this.contact = v3(hu.c[0], hu.c[1], cz);
    this.rodDir = v3(-0.50, -0.40, -0.77).normalize();           // from the tip outward (toward the back-side camera)

    // ---- small soft lights: rod tip glow, the snap flash, embers
    this.glow = new SoftPoints({ count: 2, resolution: [width, height], maxSize: 90 });
    this.scene.add(this.glow.mesh);
    this.NE = 16;
    this.embers = new SoftPoints({ count: this.NE, resolution: [width, height], focus: 10, aperture: 0.7, maxSize: 60 });
    this.scene.add(this.embers.mesh);

    // ---- faint warm haze on the fire side
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { ...shared, uA: { value: 0.01 }, uC: { value: new THREE.Vector2(0.05, 0.3) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: PALETTE_GLSL + SCREEN_GLSL + 'uniform float uA; uniform vec2 uC; varying vec2 vUv; void main(){ vec2 p = (vUv - uC) * vec2(2.39, 1.0); float d = length(p); gl_FragColor = vec4(PAL_C * uA * exp(-d * d * 1.6) * screenDim(), 1.0); }',
      depthTest: true, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    }));
    this.bg.frustumCulled = false; this.bg.renderOrder = -10;
    this.scene.add(this.bg);

    this._frameKey = null;
  }

  // ---------------------------------------------------------------------------------------------- per frame CPU
  buildMain(T) {
    // a slow reading glint runs down the columns while the king's question is on screen (113–119)
    const lines = [];
    for (const glyph of this.mainStrokes) for (const { gi, line } of glyph) {
      const tau = 113.5 + gi * 0.48;
      const g = 1 + 0.45 * Math.exp(-Math.pow((T - tau) / 0.55, 2));
      if (g === 1) { lines.push(line); continue; }
      const c = line.c.slice();
      for (let i = 0; i < c.length; i += 4) { c[i] *= g; c[i + 1] *= g; c[i + 2] *= g; }
      lines.push({ ...line, c });
    }
    this.cuts.set([...this.cutStatic, ...lines]);
  }

  buildCrack(T) {
    const t = T - T_SNAP;
    const lines = [], halo = [];
    if (t <= 0) { this.crack.set([]); this.halo.set([]); return; }
    const endGlow = 1 + 0.25 * smoothstep(128.4, 130.2, T);
    for (let li = 0; li < this.crackC.lines.length; li++) {
      const P = this.crackC.lines[li], pts = this.crackPts[li];
      const front = crackFront(P, t) * SC;
      if (front <= 0) continue;
      const p = [], c = [], w = [], ch = [], wh = [];
      let s = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        let [x, y] = pts[i];
        if (s > front) {   // end exactly at the front
          const [px, py] = pts[i - 1], seg = Math.hypot(x - px, y - py) || 1e-6, u = 1 - (s - front) / seg;
          x = px + (x - px) * u; y = py + (y - py) * u; s = front;
        }
        const age = t - crackReach(P, s / SC);
        const hot = Math.exp(-Math.max(age, 0) / 0.32);
        const k = P.glow * (1.2 + 0.8 * Math.exp(-t / 1.8) + 0.3 * Math.exp(-t / 0.9)) * endGlow;
        const r = PAL.c.r * k + PAL.hot.r * 3.2 * hot * P.glow, g = PAL.c.g * k + PAL.hot.g * 3.2 * hot * P.glow, b = PAL.c.b * k + PAL.hot.b * 3.2 * hot * P.glow;
        p.push(x, y, zFront(x, y) + 0.002);
        c.push(r, g, b, 1);
        const wr = crackWidth(P, s / SC) * 0.0175 * (1 + 0.25 * hot);
        w.push(wr);
        ch.push(r * 0.06, g * 0.06, b * 0.06, 1); wh.push(wr * 5 + 0.012);
        if (s >= front) break;
      }
      if (p.length >= 6) {
        lines.push({ p: new Float32Array(p), c: new Float32Array(c), w: new Float32Array(w) });
        halo.push({ p: new Float32Array(p), c: new Float32Array(ch), w: new Float32Array(wh) });
      }
    }
    this.crack.set(lines); this.halo.set(halo);
  }

  // ---------------------------------------------------------------------------------------------- update
  update(shot, t, T) {
    const cam = this.camera;
    cam.aspect = shot._aspect || this.ctx.aspect; cam.fov = FOV; cam.near = 0.05; cam.far = 400; cam.updateProjectionMatrix();
    const backView = T < T_CUT;
    const br = breath(T);
    // calm lower third under the cards
    let cd = 0;
    for (const [a, b] of CARDS) cd = Math.max(cd, Math.min(smoothstep(a - 0.6, a + 0.4, T), 1 - smoothstep(b - 0.2, b + 0.8, T)));
    this.shared.uCardDim.value = cd;

    // heat: rises from the touch, seen on the back, then through the floor on the front, released by the snap
    const ht = T - T_TOUCH;
    const heatRise = ht > 0 ? 1 - Math.exp(-ht / 0.9) : 0;
    const snapT = T - T_SNAP;

    this.front.visible = !backView; this.frontLines.mesh.visible = !backView; this.cuts.mesh.visible = !backView;
    this.crack.mesh.visible = !backView && snapT > 0; this.halo.mesh.visible = this.crack.mesh.visible;
    this.back.visible = backView; this.heroPatch.visible = backView; this.backLines.mesh.visible = backView;
    this.backCuts.mesh.visible = backView; this.rod.visible = backView;

    const key = Math.round(T * 24);
    const growing = snapT > -0.05 && snapT < 0.7;
    if (!backView && (growing || key !== this._frameKey)) {
      this.buildCrack(T);
      this.buildMain(T);
      this._frameKey = growing ? null : key;
    }

    let post = { bloomStrength: 0.55, bloomThreshold: 0.95, halation: 0.09, streak: 0.0, vignette: 0.42, grain: 0.012, ca: 0.0007 };
    const G = this.glow;
    if (backView) {
      // ------------------------------------------------ the back: hollows, the rod, the heat
      const zb = PL.dome(HERO.zao.c[0], HERO.zao.c[1]) - PL.thickness(HERO.zao.c[0], HERO.zao.c[1]);
      const k1 = smootherstep(0.55, 3.0, t), k2 = smoothstep(3.0, 4.8, t);
      const fh = Math.exp(lerp(Math.log(2.6), Math.log(6.2), k1)) * lerp(1, 0.84, k2);
      const dist = fh / (2 * TANH);
      const tA = v3(HERO.zao.c[0] + 0.06, HERO.zao.c[1] + 0.05 + 0.1 * t, zb);
      const tB = v3(this.contact.x - 0.55, this.contact.y + 0.62, zb);
      const tC = v3(this.contact.x - 0.25, this.contact.y + 0.32, zb);
      const look = tA.clone().lerp(tB, k1).lerp(tC, k2);
      const dA = v3(0, 0, -1), dB = v3(0.22, -0.27, -1).normalize();
      const dir = dA.clone().lerp(dB, k1).normalize();
      lookCam(cam, look.clone().addScaledVector(dir, dist), look);
      // rod: approaches along its axis, decelerating into the hollow at 103.0, pressed in until the cut
      const ra = clamp((T - T_ROD) / (T_TOUCH - T_ROD));
      const away = 16 * (1 - easeOutCubic(ra)) + (T < T_ROD ? 4 * (T_ROD - T) : 0);
      const press = T > T_TOUCH ? 0.012 * (1 - Math.exp(-(T - T_TOUCH) / 0.4)) : 0;
      const tip = this.contact.clone().addScaledVector(this.rodDir, this.rodR + away - press);
      this.rod.quaternion.setFromUnitVectors(v3(0, 1, 0), this.rodDir);
      this.rod.position.copy(tip).addScaledVector(this.rodDir, this.rodLen / 2);
      this.rod.updateMatrixWorld();
      for (const m of [this.matBack, this.matHero]) {
        const u = m.uniforms;
        u.uFireI.value = br; u.uHeat.value = heatRise * 1.1; u.uHeatR.value = 0.22 + 0.42 * Math.sqrt(clamp(ht, 0, 3));
        u.uHeroBurn.value = 0.85 * smoothstep(0.2, 2.2, ht);
        u.uFocus.value = dist; u.uAperture.value = 0.45;
      }
      this.rodMat.uniforms.uFireI.value = br;
      this.backLines.uniforms.uOpacity.value = br; this.backCuts.uniforms.uOpacity.value = br;
      this.backLines.uniforms.uFocus.value = dist; this.backLines.uniforms.uAperture.value = 0.45;
      this.backCuts.uniforms.uFocus.value = dist; this.backCuts.uniforms.uAperture.value = 0.45;
      // glow of the hot tip
      const tipC = tip.clone().addScaledVector(this.rodDir, -this.rodR * 0.6);
      G.positions.set([tipC.x, tipC.y, tipC.z], 0);
      const gI = 0.55 + 0.35 * heatRise;
      G.colors.set([PAL.c.r * gI, PAL.c.g * gI, PAL.c.b * gI], 0); G.sizes[0] = 70;
      G.positions.set([this.contact.x, this.contact.y, this.contact.z - 0.05], 3);
      const hI = 0.6 * heatRise;
      G.colors.set([PAL.c.r * hI, PAL.c.g * hI, PAL.c.b * hI], 3); G.sizes[1] = 40 + 50 * heatRise;
      G.update();
      this.bg.material.uniforms.uA.value = 0.012 * br; this.bg.material.uniforms.uC.value.set(0.92, 0.25);
    } else {
      // ------------------------------------------------ the front: the snap, the crack, the question
      const r = frontRig(T);
      const dist = r.fh / (2 * TANH);
      const look = v3(r.cx, r.cy, PL.dome(r.cx, r.cy));
      const yw = r.yaw * Math.PI / 180, pt = r.pitch * Math.PI / 180;
      const dir = v3(Math.sin(yw) * Math.cos(pt), Math.sin(pt), Math.cos(yw) * Math.cos(pt));
      lookCam(cam, look.clone().addScaledVector(dir, dist), look);
      const u = this.matFront.uniforms;
      u.uFireI.value = br;
      const through = heatRise * (snapT < 0 ? 0.75 + 0.25 * smoothstep(-0.9, 0, snapT) : Math.exp(-snapT / 0.7));
      const flare = snapT > 0 ? 0.35 * Math.exp(-snapT / 0.1) : 0;
      u.uHeat.value = Math.min(1, through * 0.8 + flare); u.uHeatR.value = 0.42 + 0.22 * smoothstep(-0.9, 0, snapT);
      u.uHeatPos.value.set(lerp(HERO.zuan.c[0], JX, 0.45), lerp(HERO.zuan.c[1], JY, 0.45));
      const endDim = 1 - 0.72 * smoothstep(128.4, 130.2, T);
      u.uOpacity.value = endDim;
      this.frontLines.uniforms.uOpacity.value = br * endDim;
      this.cuts.uniforms.uOpacity.value = br * endDim;
      // snap flash at the junction
      const z = PL.dome(JX, JY) + 0.01;
      G.positions.set([JX, JY, z], 0);
      const f1 = snapT > 0 ? Math.exp(-snapT / 0.09) : 0, f2 = snapT > 0 ? Math.exp(-snapT / 0.7) : 0;
      G.colors.set([PAL.hot.r * 1.3 * f1 + PAL.c.r * 0.35 * f2, PAL.hot.g * 1.3 * f1 + PAL.c.g * 0.35 * f2, PAL.hot.b * 1.3 * f1 + PAL.c.b * 0.35 * f2], 0);
      G.sizes[0] = 26 + 30 * f1;
      G.positions.set([JX, JY, z], 3); G.colors.set([0, 0, 0], 3); G.sizes[1] = 1;
      G.update();
      if (snapT > 0) {
        post.flash = 0.008 * Math.exp(-snapT / 0.05);
        post.shake = 0.3 * Math.exp(-snapT / 0.1);
      }
      this.bg.material.uniforms.uA.value = 0.012 * br; this.bg.material.uniforms.uC.value.set(0.06, 0.3);
    }

    // embers: few, slow, out of focus, on the fire side; they fade in only above the lower third
    const E = this.embers, right = new THREE.Vector3(), upv = new THREE.Vector3(), fwd = new THREE.Vector3();
    cam.matrixWorld.extractBasis(right, upv, fwd); fwd.negate();
    const fireSide = backView ? 1 : -1;
    for (let i = 0; i < this.NE; i++) {
      const per = 6 + 3 * hash1(i * 1.7), ph = hash1(i * 9.1) * per;
      const a = ((T + ph) % per) / per;
      const life = Math.sin(Math.PI * a);
      const sx = fireSide * (0.62 + 0.3 * hash1(i * 3.3)) + 0.04 * Math.sin(T * 0.5 + i);
      const sy = -0.7 + 1.55 * a;
      const depth = 14 + 22 * hash1(i * 5.9);
      const hh = depth * TANH;
      const p = cam.position.clone().addScaledVector(fwd, depth).addScaledVector(right, sx * hh * cam.aspect).addScaledVector(upv, sy * hh);
      E.positions.set([p.x, p.y, p.z], i * 3);
      const vis = life * smoothstep(-0.25, 0.1, sy) * (1 - smoothstep(0.55, 0.9, sy)) * 0.22;
      E.colors.set([PAL.c.r * vis, PAL.c.g * vis, PAL.c.b * vis], i * 3);
      E.sizes[i] = 2.2;
    }
    E.uniforms.uFocus.value = backView ? 6 : 10; E.update();

    return { scene: this.scene, camera: cam, post };
  }

  dispose() {
    for (const l of [this.frontLines, this.cuts, this.backLines, this.backCuts, this.crack, this.halo]) l.dispose();
    this.glow.dispose(); this.embers.dispose();
    for (const t of [this.texFront, this.texBack, this.texSdf]) t.dispose();
  }
}
