// The plastron (腹甲) of a Shang divination turtle, Yinxu, Wu Ding period (c. 1200 BCE), as catalogue data.
// Used by scenes/bone.js. Units: centimetres. Front (ventral) face toward +z, head toward +y, midline x = 0.
// "Left" below means x < 0 in the front view (the turtle's right).
//
// Anatomy (front view):
//   bones (sutures 齒縫, interdigitated):  epiplastra 首甲 (pair), entoplastron 中甲 (single, a kite between them),
//                                         hyoplastra 前甲, hypoplastra 後甲 (with the bridges 甲橋), xiphiplastra 尾甲
//   midline suture 千里路 (x = 0)
//   scute sulci 盾紋 (smooth grooves on the front face only): gular | humeral | pectoral | abdominal | femoral | anal
//   back (inner) face: hollows 鑽鑿 in columns, a jujube-pit shaped chiselled slot 鑿 with a round drilled hollow 鑽 cut
//   into its side toward the midline, so the crack's branch (兆枝) on the front points toward the midline.
//
//   dome(x, y)       front surface height (z) ; DOME_GLSL is the same function in GLSL (+ its gradient)
//   thickness(x, y)  bone thickness ; back surface z = dome - thickness + hollow depth
//   OUTLINE          closed polyline [[x, y], ...]
//   SUTURES, SULCI   arrays of polylines ; HOLLOWS: [{ J, side, zao, zuan, used, ... }]
//   buildFields()    Float32 fields for the textures: front relief, back relief (+ burn), outline SDF
import { hash1 } from './random.js';

export const BBOX = { x0: -8.8, x1: 8.8, y0: -13.5, y1: 13.4 };

export function dome(x, y) {
  const b = Math.max(0, Math.abs(x) - 6.2), x2 = x * x;
  return 0.42 - 0.0042 * x2 - 0.0016 * y * y - 0.000035 * x2 * x2 - 0.03 * b * b;
}
export function domeGrad(x, y) {
  const b = Math.max(0, Math.abs(x) - 6.2);
  return [-0.0084 * x - 0.00014 * x * x * x - 0.06 * b * Math.sign(x), -0.0032 * y];
}
export function thickness(x, y) { return 0.62 * (1 - 0.33 * (x * x / 72 + y * y / 175)); }

export const DOME_GLSL = /* glsl */`
float dome(vec2 p){ float b = max(0.0, abs(p.x) - 6.2); float x2 = p.x * p.x;
  return 0.42 - 0.0042 * x2 - 0.0016 * p.y * p.y - 0.000035 * x2 * x2 - 0.03 * b * b; }
vec2 domeGrad(vec2 p){ float b = max(0.0, abs(p.x) - 6.2);
  return vec2(-0.0084 * p.x - 0.00014 * p.x * p.x * p.x - 0.06 * b * sign(p.x), -0.0032 * p.y); }
float thick(vec2 p){ return 0.62 * (1.0 - 0.33 * (p.x * p.x / 72.0 + p.y * p.y / 175.0)); }
vec2 thickGrad(vec2 p){ return -0.62 * 0.33 * vec2(2.0 * p.x / 72.0, 2.0 * p.y / 175.0); }
`;

// ------------------------------------------------------------------------------------ curves
function crClosed(ctrl, seg) {
  const m = ctrl.length, out = [];
  for (let i = 0; i < m; i++) {
    const p0 = ctrl[(i - 1 + m) % m], p1 = ctrl[i], p2 = ctrl[(i + 1) % m], p3 = ctrl[(i + 2) % m];
    for (let s = 0; s < seg; s++) out.push(crPoint(p0, p1, p2, p3, s / seg));
  }
  out.push(out[0].slice());
  return out;
}
function crOpen(ctrl, seg) {
  const m = ctrl.length, out = [];
  for (let i = 0; i < m - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(m - 1, i + 2)];
    for (let s = 0; s < seg; s++) out.push(crPoint(p0, p1, p2, p3, s / seg));
  }
  out.push(ctrl[m - 1].slice());
  return out;
}
// centripetal Catmull-Rom
function crPoint(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const L = (a, b, ta, tb) => [(tb - u) / (tb - ta) * a[0] + (u - ta) / (tb - ta) * b[0], (tb - u) / (tb - ta) * a[1] + (u - ta) / (tb - ta) * b[1]];
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}
export function resample(pts, step) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1], n = Math.max(2, Math.ceil(L / step) + 1), out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = L * k / (n - 1);
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const u = (s - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]);
  }
  return out;
}
const mirror = pts => pts.map(([x, y]) => [-x, y]);

// ------------------------------------------------------------------------------------ outline
// right half from the front midline round to the anal notch (Mauremys / Ocadia proportions, bridges sawn straight)
const RIGHT = [
  [0.00, 12.72], [0.90, 12.86], [2.10, 12.80], [3.20, 12.45], [4.20, 11.70], [4.95, 10.60], [5.45, 9.20],
  [5.75, 7.80], [5.95, 6.60], [6.35, 5.78], [7.05, 5.38], [7.85, 5.26], [8.25, 4.82], [8.40, 3.00],
  [8.42, 0.00], [8.32, -2.60], [8.02, -3.68], [7.30, -4.04], [6.50, -4.22], [5.95, -4.85], [5.75, -6.00],
  [5.45, -7.80], [4.95, -9.60], [4.25, -11.10], [3.35, -12.40], [2.58, -13.08], [1.78, -12.58], [0.88, -11.78],
];
const OUT_CTRL = [...RIGHT, [0.0, -11.40], ...mirror(RIGHT.slice(1)).reverse()];
export const OUTLINE = resample(crClosed(OUT_CTRL, 10), 0.05);

// ------------------------------------------------------------------------------------ sutures (齒縫)
// centrelines; the interdigitation is added by serrate()
const SUT_BASE = [
  [[0, 12.72], [0, 11.5], [0, 10.30]],                                   // between the epiplastra
  [[0, 10.30], [1.05, 9.62], [2.05, 8.85], [1.05, 7.75], [0, 6.75]],     // entoplastron, right border
  [[0, 10.30], [-1.05, 9.62], [-2.05, 8.85], [-1.05, 7.75], [0, 6.75]],  // entoplastron, left border
  [[0, 6.75], [0, 0], [0, -11.40]],                                       // 千里路
  [[2.05, 8.85], [3.6, 9.35], [5.38, 9.82]],                              // epi | hyo
  [[-2.05, 8.85], [-3.6, 9.35], [-5.38, 9.82]],
  [[0, 0.55], [3.5, 0.48], [6.4, 0.22], [8.42, 0.06]],                    // hyo | hypo, across the bridge
  [[0, 0.55], [-3.5, 0.48], [-6.4, 0.22], [-8.42, 0.06]],
  [[0, -7.45], [2.6, -7.78], [5.42, -8.40]],                              // hypo | xiphi
  [[0, -7.45], [-2.6, -7.78], [-5.42, -8.40]],
];
function serrate(base, seed, amp = 0.07, pitch = 0.16) {
  const c = resample(crOpen(base, 12), 0.01), out = [];
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
  const L = cum[cum.length - 1];
  // teeth: alternate sides at irregular pitch, amplitude modulated slowly
  let s = 0, k = 0, j = 0;
  while (s <= L) {
    while (j < c.length - 2 && cum[j + 1] < s) j++;
    const u = (s - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9);
    const x = c[j][0] + (c[j + 1][0] - c[j][0]) * u, y = c[j][1] + (c[j + 1][1] - c[j][1]) * u;
    const dx = c[j + 1][0] - c[j][0], dy = c[j + 1][1] - c[j][1], dl = Math.hypot(dx, dy) || 1;
    const env = Math.min(1, s / 0.25, (L - s) / 0.25);
    const a = amp * env * (0.55 + 0.45 * Math.sin(s * 2.1 + seed) * Math.sin(s * 0.7 + seed * 1.7) + 0.35 * (hash1(seed + k * 1.37) - 0.5));
    const sg = k % 2 ? 1 : -1;
    out.push([x - dy / dl * a * sg, y + dx / dl * a * sg]);
    s += pitch * (0.6 + 0.8 * hash1(seed * 3.1 + k * 7.9)); k++;
  }
  const last = c[c.length - 1];
  out.push([last[0], last[1]]);
  return out;
}
export const SUTURE_BASE = SUT_BASE.map(b => resample(crOpen(b, 12), 0.05));
export const SUTURES = SUT_BASE.map((b, i) => serrate(b, 11.3 + i * 5.7, i === 3 ? 0.06 : 0.07, i === 3 ? 0.13 : 0.16));

// ------------------------------------------------------------------------------------ sulci (盾紋)
const SUL_RIGHT = [
  [[0, 10.75], [1.6, 11.45], [3.22, 12.42]],                               // gular | humeral
  [[0, 7.55], [1.8, 7.78], [3.8, 7.36], [5.82, 7.15]],                     // humeral | pectoral
  [[0, 3.15], [2.5, 3.40], [4.3, 4.30], [5.45, 5.05], [6.12, 5.62]],       // pectoral | abdominal
  [[0, -4.25], [2.6, -4.08], [4.6, -4.24], [6.25, -4.52]],                 // abdominal | femoral
  [[0, -9.05], [1.6, -9.38], [3.4, -10.02], [4.55, -10.75]],               // femoral | anal
  [[6.12, 5.62], [6.72, 3.0], [6.80, 0.0], [6.70, -2.6], [6.25, -4.52]],   // plastral | marginal (on the bridge)
  [[6.76, 2.35], [7.6, 2.38], [8.41, 2.42]],                               // marginal scutes across the bridge
  [[6.76, -1.25], [7.6, -1.27], [8.37, -1.30]],
];
const midSulcus = [];
for (let y = 12.76; y >= -11.4; y -= 0.1) midSulcus.push([0.09 * Math.sin(y * 0.43 + 0.6) + 0.04 * Math.sin(y * 1.31 + 2.0), y]);
export const SULCI = [
  resample(midSulcus, 0.05),
  ...SUL_RIGHT.map(b => resample(crOpen(b, 12), 0.05)),
  ...SUL_RIGHT.map(b => resample(crOpen(mirror(b), 12), 0.05)),
];

// ------------------------------------------------------------------------------------ hollows (鑽鑿)
// J = where the heat meets the slot = the junction of the crack on the front. 鑿: a jujube-pit slot along y,
// centred a little below J; 鑽: a round drilled hollow cut into its side toward the midline.
const ZAO = { a: 0.80, b: 0.27, D: 0.42, dy: -0.22 };
const ZUAN = { R: 0.33, D: 0.30, dx: 0.36, dy: -0.10 };
function hollow(x, y, opts = {}) {
  const side = x < 0 ? 1 : -1;               // direction toward the midline
  return {
    J: [x, y], side,
    zao: { c: [x, y + ZAO.dy], a: ZAO.a * (opts.k ?? 1), b: ZAO.b, D: ZAO.D },
    zuan: { c: [x + side * ZUAN.dx, y + ZUAN.dy], R: ZUAN.R, D: ZUAN.D },
    used: opts.used ?? true, hero: !!opts.hero, mate: !!opts.mate,
  };
}
// columns per half (front-view x of the left half); rows by bone
const L_HOLLOWS = [
  [-2.55, 11.25], [-4.15, 10.45],                                    // 首甲
  [-0.95, 8.95],                                                     // 中甲
  [-1.75, 6.30], [-3.45, 6.30], [-5.00, 6.30],                       // 前甲
  [-1.75, 4.10], [-3.45, 4.10], [-5.00, 3.85], [-7.10, 4.00],
  [-1.75, 1.90], [-3.45, 1.90], [-5.00, 1.90], [-7.10, 1.80],
  [-1.75, -1.00], [-3.45, -1.00], [-5.00, -1.00], [-7.10, -0.80],    // 後甲
  [-1.75, -3.00], [-3.45, -3.00], [-5.00, -3.00], [-7.05, -2.75],
  [-1.75, -5.60], [-3.45, -5.60], [-4.95, -5.80],
  [-1.50, -8.75], [-3.10, -8.95],                                    // 尾甲
  [-1.45, -10.65], [-2.85, -11.05],
];
// hollows whose front is kept clear for inscriptions (unused), the hero (heated in the film) and its mate (the 對貞)
const CLEAR = new Set(['-1.75,6.3', '-3.45,6.3', '-1.75,4.1', '-3.45,4.1', '-1.75,1.9', '-3.45,1.9', '-1.75,-1', '-1.75,-3']);
export const HOLLOWS = [];
for (const [x, y] of L_HOLLOWS) {
  const key = `${x},${y}`;
  const hero = key === '-5,3.85';
  HOLLOWS.push(hollow(x, y, { used: !CLEAR.has(key) && !hero, hero }));
  HOLLOWS.push(hollow(-x, y, { used: !CLEAR.has(key), mate: hero }));
}
export const HERO = HOLLOWS.find(h => h.hero);

// depth of one hollow at (x, y) (cm into the back face), 0 outside
export function hollowDepth(h, x, y) {
  let d = 0;
  const z = h.zao, v = (y - z.c[1]) / z.a;
  if (v > -1 && v < 1) {
    const w = z.b * Math.pow(1 - v * v, 0.75), q = Math.abs(x - z.c[0]) / Math.max(w, 1e-4);
    if (q < 1) d = z.D * Math.pow(1 - q * q, 0.95) * Math.pow(1 - v * v * v * v, 0.45);
  }
  const u = h.zuan, r = Math.hypot(x - u.c[0], y - u.c[1]) / u.R;
  if (r < 1) d = Math.max(d, u.D * Math.pow(1 - r * r, 0.9));
  return d;
}
export const HOLLOW_GLSL = /* glsl */`
float hollowDepth(vec2 p, vec2 zc, float za, float zb, float zD, vec2 uc, float uR, float uD){
  float d = 0.0;
  float v = (p.y - zc.y) / za;
  if (abs(v) < 1.0) {
    float w = zb * pow(1.0 - v * v, 0.75);
    float q = abs(p.x - zc.x) / max(w, 1e-4);
    if (q < 1.0) d = zD * pow(1.0 - q * q, 0.95) * pow(1.0 - v * v * v * v, 0.45);
  }
  float r = length(p - uc) / uR;
  if (r < 1.0) d = max(d, uD * pow(1.0 - r * r, 0.9));
  return d;
}`;

// ------------------------------------------------------------------------------------ fields for textures
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
// signed distance to the outline (negative inside), exact within `band` cm of the edge, clamped beyond
function sdfField(W, H, band) {
  const { x0, x1, y0, y1 } = BBOX, sx = (x1 - x0) / W, sy = (y1 - y0) / H;
  const f = new Float32Array(W * H).fill(band);
  const P = OUTLINE;
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - band - x0) / sx)), i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + band - x0) / sx));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - band - y0) / sy)), j1 = Math.min(H - 1, Math.ceil((Math.max(ay, by) + band - y0) / sy));
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * sy;
      for (let k = i0; k <= i1; k++) {
        const d = pointSegDist(x0 + (k + 0.5) * sx, py, ax, ay, bx, by);
        const o = j * W + k;
        if (d < f[o]) f[o] = d;
      }
    }
  }
  // inside test by scanline crossings
  for (let j = 0; j < H; j++) {
    const py = y0 + (j + 0.5) * sy, xs = [];
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, ay] = P[i], [bx, by] = P[i + 1];
      if ((ay <= py && by > py) || (by <= py && ay > py)) xs.push(ax + (py - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const k0 = Math.max(0, Math.ceil((xs[m] - x0) / sx - 0.5)), k1 = Math.min(W - 1, Math.floor((xs[m + 1] - x0) / sx - 0.5));
      for (let k = k0; k <= k1; k++) f[j * W + k] = -f[j * W + k];
    }
  }
  return f;
}
// add a groove of depth `depth` and gaussian width `sig` along polylines (negative relief)
function grooves(field, W, H, lines, depth, sig) {
  const { x0, x1, y0, y1 } = BBOX, sx = (x1 - x0) / W, sy = (y1 - y0) / H, R = sig * 3;
  const dmin = new Float32Array(W * H).fill(1e9);
  for (const P of lines) for (let i = 0; i < P.length - 1; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - x0) / sx)), i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + R - x0) / sx));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - R - y0) / sy)), j1 = Math.min(H - 1, Math.ceil((Math.max(ay, by) + R - y0) / sy));
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * sy;
      for (let k = i0; k <= i1; k++) {
        const d = pointSegDist(x0 + (k + 0.5) * sx, py, ax, ay, bx, by), o = j * W + k;
        if (d < dmin[o]) dmin[o] = d;
      }
    }
  }
  for (let o = 0; o < W * H; o++) if (dmin[o] < R) field[o] -= depth * Math.exp(-dmin[o] * dmin[o] / (2 * sig * sig));
}
function gradient(h, W, H) {
  const { x0, x1, y0, y1 } = BBOX, sx = (x1 - x0) / W, sy = (y1 - y0) / H;
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let k = 0; k < W; k++) {
    const o = j * W + k;
    const l = h[j * W + Math.max(0, k - 1)], r = h[j * W + Math.min(W - 1, k + 1)];
    const d = h[Math.max(0, j - 1) * W + k], u = h[Math.min(H - 1, j + 1) * W + k];
    gx[o] = (r - l) / ((Math.min(W - 1, k + 1) - Math.max(0, k - 1)) * sx);
    gy[o] = (u - d) / ((Math.min(H - 1, j + 1) - Math.max(0, j - 1)) * sy);
  }
  return [gx, gy];
}

// Front relief (grooves of the sulci and sutures), back relief (hollows; the hero's is drawn analytically by the
// shader and left out here) with a burn mask for the hollows already used, and the outline SDF.
export function buildFields({ frontRes = [768, 1184], backRes = [1024, 1576], sdfRes = [400, 616] } = {}) {
  const t0 = performance.now();
  const { x0, x1, y0, y1 } = BBOX;
  // front
  let [W, H] = frontRes;
  const fh = new Float32Array(W * H);
  grooves(fh, W, H, SULCI, 0.032, 0.045);
  grooves(fh, W, H, SUTURE_BASE, 0.010, 0.03);
  const [fgx, fgy] = gradient(fh, W, H);
  const front = new Float32Array(W * H * 4);
  for (let o = 0; o < W * H; o++) { front[o * 4] = fh[o]; front[o * 4 + 1] = fgx[o]; front[o * 4 + 2] = fgy[o]; }
  // back
  const [BW, BH] = backRes, sx = (x1 - x0) / BW, sy = (y1 - y0) / BH;
  const bh = new Float32Array(BW * BH), burn = new Float32Array(BW * BH);
  for (const h of HOLLOWS) {
    if (h.hero) continue;
    const cx = (h.zao.c[0] + h.zuan.c[0]) / 2, cy = h.zao.c[1];
    const i0 = Math.max(0, Math.floor((cx - 0.9 - x0) / sx)), i1 = Math.min(BW - 1, Math.ceil((cx + 0.9 - x0) / sx));
    const j0 = Math.max(0, Math.floor((cy - 1.0 - y0) / sy)), j1 = Math.min(BH - 1, Math.ceil((cy + 1.0 - y0) / sy));
    const lim = Math.max(0.05, thickness(h.J[0], h.J[1]) - 0.09);
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * sy;
      for (let k = i0; k <= i1; k++) {
        const px = x0 + (k + 0.5) * sx, o = j * BW + k;
        const d = Math.min(lim, hollowDepth(h, px, py));
        if (d > bh[o]) bh[o] = d;
        if (h.used) {
          const r = Math.hypot(px - h.zuan.c[0], py - h.zuan.c[1]) / h.zuan.R;
          const rj = Math.hypot(px - h.J[0], (py - h.J[1]) * 0.7) / 0.32;
          const b = Math.max(1 - smooth(0.55, 1.0, r), 0.8 * (1 - smooth(0.4, 1.0, rj)));
          if (b > burn[o]) burn[o] = b;
        }
      }
    }
  }
  const [bgx, bgy] = gradient(bh, BW, BH);
  const back = new Float32Array(BW * BH * 4);
  for (let o = 0; o < BW * BH; o++) { back[o * 4] = bh[o]; back[o * 4 + 1] = bgx[o]; back[o * 4 + 2] = bgy[o]; back[o * 4 + 3] = burn[o]; }
  const sdf = sdfField(sdfRes[0], sdfRes[1], 0.6);
  return { front: { data: front, W, H }, back: { data: back, W: BW, H: BH }, sdf: { data: sdf, W: sdfRes[0], H: sdfRes[1] }, ms: performance.now() - t0 };
}
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
