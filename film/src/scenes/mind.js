// MIND · 27.2–45 s (mode 'tokens'). Inside the AI: not a cosmos but a measured space of cells, vectors and
// numbers, drawn like a plate in a catalogue. The warm question arrives from the overlay as a small cluster of
// light at the frame centre (27.2), unfolds into its seven characters, is cut into tokens (seven pings at
// 29.0 + 0.35 i), unrolls into vectors that pour down into a vast field of numbers (31–35), is read by attention
// (34–39), and at 40.0 a region deep in the field lights up warm: thousands of other people's questions.
// 43–45 the camera dives toward it; the river dissolves in over 45–47 (this scene keeps flying until 47).
//
// Everything is a pure function of the local time t (= T − 27.2). Colour: the question is human (PAL.c),
// structure and numbers are the AI (PAL.si) and paper white (PAL.line).
import * as THREE from '../../vendor/three.module.js';
import { PAL } from '../look/palette.js';
import { SoftPoints } from '../look/points.js';
import { TextField, GlyphAtlas } from '../look/text.js';
import { FLines } from '../lib/flines.js';
import { Rand, hash1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, easeOutCubic, easeInOutSine, easeInOutCubic } from '../lib/ease.js';
import { patch } from '../lib/atlas.js';

// ------------------------------------------------------------------------------------------- layout
const CH = ['她', '會', '好', '起', '來', '嗎', '？'];
const IDS = ['38512', '21437', '19260', '40981', '27604', '55139', '30842'];   // plausible ids, no real tokenizer
const N = 7;
const PITCH = 0.8;                 // token spacing (world units; ~150 px per unit at the start)
const HB = 0.29;                   // half size of a token cell
const DZ = 0.13;                   // half depth of a cell (the cells are thin wire cuboids)
const CHS = 0.34;                  // character size (em)
const tokX = i => (i - 3) * PITCH;
const Y_ID = -HB - 0.095, Y_BY = Y_ID - 0.08, Y_COL = Y_BY - 0.1;
const LH = 0.09;                   // vector row pitch
const NV = 28, NX = 16, NROW = NV + NX + 1;   // rows shown unrolled, rows that follow in the stream, the ellipsis
const VSZ = 0.068;                 // vector number size
const YF = -3.6;                   // the field plane
const R = [5.0, YF + 1.35, -21.0]; // the region that lights up (centre of the cloud)

// ------------------------------------------------------------------------------------------- timing (local t)
export const PING = i => 1.8 + 0.35 * i;          // 29.0 + 0.35 i: token i is boxed (7 pings)
const EXT0 = 3.8, EXT1 = 5.2;                     // 31.0–32.4 the vectors unroll under the tokens
const STR0 = 5.5, VMAX = 4.5, RAMP = 0.8;         // 32.7– they pour down into the field
const COLD = 0.07;                                // stagger between columns
const T_QUERY = 11.8;                             // 39.0 the question reaches into the field
const T_REGION = 12.8;                            // 40.0 the region lights up
const T_DIVE = 15.8;                              // 43.0 the dive
// attention (head 0): [key, query, weight, start]; information flows key -> query (pulses travel that way)
const LINKS = [
  [0, 2, 0.62, 6.8], [0, 3, 0.47, 7.3], [0, 4, 0.55, 7.8],                 // 她 -> 好 起 來 (strongest)
  [0, 5, 0.21, 8.8], [1, 5, 0.12, 9.15], [2, 5, 0.18, 9.5], [3, 5, 0.09, 9.85], [4, 5, 0.14, 10.2], [5, 6, 0.26, 10.55], // 嗎 <-> all
];
const ARC_DUR = 0.75;
const HEADS = 6, HEAD_T = 10.75;                  // the other heads light up behind (37.95–)

function headOff(t) {              // how far the head of a vector column has travelled below its token
  if (t <= EXT0) return 0;
  if (t < EXT1) return NV * LH * easeInOutSine((t - EXT0) / (EXT1 - EXT0));
  if (t <= STR0) return NV * LH;
  const x = (t - STR0) / RAMP;
  return NV * LH + VMAX * RAMP * (x < 1 ? x * x * x - 0.5 * x * x * x * x : x - 0.5);
}

// ------------------------------------------------------------------------------------------- camera
// keys: [t, position, look-at, optional velocity of position]; Hermite with Catmull-Rom tangents in time
const CAM = [
  [0.0, [0, 0, 10.6], [0, 0, 0]],
  [1.8, [0, 0, 10.15], [0, 0, 0]],
  [3.8, [0, 0.05, 9.9], [0, -0.1, 0]],
  [5.3, [0, 0.55, 10.25], [0, -1.35, 0]],
  [6.6, [-0.1, 1.25, 10.35], [0, -1.6, -0.8]],
  [8.6, [-0.35, 2.7, 9.8], [0, -0.75, -3.0]],
  [11.8, [0.3, 3.2, 9.35], [0.45, -0.95, -4.2]],
  [13.8, [0.75, 3.3, 9.0], [1.9, -1.45, -9.0], [0.18, 0, -0.25]],
  [T_DIVE, [1.1, 3.15, 8.3], [3.0, -1.75, -12.0], [0.25, -0.1, -0.8]],
  [17.8, [3.6, -0.15, -9.0], [4.9, -2.2, -21.0], [1.0, -1.25, -6.6]],
  [19.8, [4.75, -1.55, -16.6], [5.1, -2.35, -27.0], [0.35, -0.4, -2.6]],
];
function track(keys, idx, t) {
  const n = keys.length;
  const tan = j => {
    const m = idx === 1 ? keys[j][3] : null;
    if (m) return m;
    if (j === 0 || j === n - 1) return [0, 0, 0];
    const p = keys[j - 1], q = keys[j + 1];
    return [0, 1, 2].map(c => (q[idx][c] - p[idx][c]) / (q[0] - p[0]));
  };
  if (t <= keys[0][0]) return keys[0][idx].slice();
  if (t >= keys[n - 1][0]) { const m = tan(n - 1), d = t - keys[n - 1][0]; return keys[n - 1][idx].map((x, c) => x + m[c] * d); }
  let k = 0; while (k < n - 2 && t > keys[k + 1][0]) k++;
  const a = keys[k], b = keys[k + 1], h = b[0] - a[0], s = (t - a[0]) / h;
  const ma = tan(k), mb = tan(k + 1);
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return a[idx].map((x, c) => h00 * x + h10 * h * ma[c] + h01 * b[idx][c] + h11 * h * mb[c]);
}
export const camPos = t => track(CAM, 1, t);
export const camLook = t => track(CAM, 2, t);

// ------------------------------------------------------------------------------------------- the field shader
// One modulation shared by the field's numbers and lattice points: invisible until the vectors land, then
// revealed by expanding fronts from the seven landing points (cold rings), and at 40.0 a warm region (and a warm
// wave) around R. Pure function of uFT and the world position.
const FIELD_GLSL = /* glsl */`
uniform float uFT;
uniform vec4 uLand[7];     // landing point x, z, first landing, last landing (the stream pours in between)
uniform vec4 uReg;
uniform vec3 uRegC;
uniform vec3 uWaveC;
uniform float uFBase;
uniform float uFGain;
uniform vec4 uFFade;       // near0, near1, far0, far1 (view depth); the warm region is exempt from the far fade
vec3 fieldMod(vec3 col, vec3 wp, float z) {
  float on = uFBase, ring = 0.0, pour = 0.0;
  for (int i = 0; i < 7; i++) {
    float dt = uFT - uLand[i].z;
    if (dt > 0.0) {
      vec2 q = wp.xz - uLand[i].xy;
      float d = length(q);
      float r = dt * 6.0;
      on = max(on, 1.0 - smoothstep(r - 5.0, r, d));
      float x = (d - r) / (0.5 + 0.16 * dt);
      ring += exp(-x * x) * exp(-dt * 0.38);
      float w = smoothstep(0.0, 0.15, dt) * (1.0 - smoothstep(uLand[i].w - uLand[i].z, uLand[i].w - uLand[i].z + 0.6, dt));
      pour += w * exp(-dot(q, q) / 0.3);
    }
  }
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float nearK = uFFade.y > 0.0 ? smoothstep(uFFade.x, uFFade.y, z) : 1.0;
  float farK = uFFade.w > 0.0 ? 1.0 - smoothstep(uFFade.z, uFFade.w, z) : 1.0;
  vec3 c = (col * on + uWaveC * lum * (min(ring, 1.4) * 1.5 + min(pour, 1.0) * 2.5)) * farK;
  float dr = uFT - uReg.z;
  if (dr > 0.0) {
    float d = length(wp.xz - uReg.xy);
    float k = exp(-d * d / (uReg.w * uReg.w)) * smoothstep(0.0, 1.8, dr);
    float x = (d - dr * 4.0) / 1.0;
    float wave = exp(-x * x) * exp(-dr * 0.6);
    c = mix(c, uRegC * lum * 1.7, clamp(k, 0.0, 1.0)) + uRegC * lum * wave * 1.6 * max(farK, 0.5);
  }
  return c * nearK * uFGain;
}
`;

// ------------------------------------------------------------------------------------------- the questions
// Other people's questions (the warm cloud at 40.0). Short, many languages, the same fear.
const QS = [
  '她會好起來嗎', '他會沒事嗎', '媽媽會好嗎', '我爸會好起來嗎', '手術會成功嗎', '還有希望嗎', '會好的吧', '她還能回家嗎',
  '化療有用嗎', '能治好嗎', '奶奶會醒來嗎', '爸爸會好嗎', '妈妈会好起来吗', '他还能好起来吗', '会没事的吧',
  'Will she be okay?', 'Will he get better?', 'Is there still hope?', 'Will my mom be okay?', 'Can it be cured?',
  'Will the surgery work?', 'Is she going to make it?', 'Will he wake up?', 'Will my dad recover?', 'Is it treatable?',
  '¿Mi hijo va a estar bien?', '¿Se va a recuperar?', '¿Hay esperanza?', '¿Mi madre se va a curar?',
  'Ela vai ficar bem?', 'Meu pai vai melhorar?', 'Guarirà?', 'Mia madre starà bene?',
  'Va-t-elle guérir ?', 'Est-ce qu’il va s’en sortir ?', 'Ma mère va-t-elle aller mieux ?',
  'Wird er wieder gesund?', 'Wird sie wieder gesund?', 'Gibt es noch Hoffnung?',
  'Wordt ze weer beter?', 'Czy ona wyzdrowieje?', 'Annem iyileşecek mi?', 'Apakah ibu saya akan sembuh?',
  'Je, atapona?', 'Mẹ tôi có khỏi bệnh không?', 'Θα γίνει καλά;',
  'Он поправится?', 'Она выздоровеет?', 'Есть ли надежда?',
  'お母さんは助かりますか', '父は治りますか', '大丈夫でしょうか', '手術は成功しますか',
  '엄마 괜찮을까요?', '아빠는 나을 수 있을까요?', '수술이 잘 될까요?',
  'هل ستشفى أمي؟', 'هل سيتعافى؟', 'هل هناك أمل؟',
  'क्या वह ठीक हो जाएगी?', 'क्या मेरी माँ ठीक हो जाएगी?',
  'แม่จะหายป่วยไหม', 'האם היא תבריא?',
];
const isLatin = s => /^[\u0000-ɏͰ-ϿЀ-ӿḀ-ỿ’ ¿?]+$/.test(s);

const fmtV = v => (v < 0 ? '−' : ' ') + Math.abs(v).toFixed(4);
const fmtW = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
const bytesOf = ch => [...new TextEncoder().encode(ch)].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const col3 = (c, k) => [c.r * k, c.g * k, c.b * k];

function arcGeom(xa, xb, y0, z, h, f, n = 72) {
  const pts = [], xm = 0.5 * (xa + xb);
  const m = Math.max(2, Math.ceil(n * f) + 1);
  for (let k = 0; k < m; k++) {
    const th = Math.PI * f * k / (m - 1);
    pts.push(xm + (xa - xm) * Math.cos(th), y0 + h * Math.sin(th), z);
  }
  return pts;
}
function halfEllipse(a, b) { return 0.5 * Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); }
const arcH = span => 0.16 + 0.33 * span;

export default class Mind {
  constructor(ctx) { this.ctx = ctx; }

  async init() {
    const { width: W, height: H } = this.ctx;
    const res = [W, H];
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 500);

    // shared field uniforms (same objects in every patched material)
    this.fu = {
      uFT: { value: 0 },
      uLand: { value: Array.from({ length: N }, () => new THREE.Vector4(0, 0, 1e6, 0)) },
      uReg: { value: new THREE.Vector4(R[0], R[2], T_REGION, 5.0) },
      uRegC: { value: new THREE.Vector3(PAL.c.r, PAL.c.g, PAL.c.b) },
      uWaveC: { value: new THREE.Vector3(PAL.si.r, PAL.si.g, PAL.si.b) },
      uFBase: { value: 0 },
    };
    const fieldPatch = (mat, mainSig, find, repl, fade = [0, 0, 0, 0]) => {
      Object.assign(mat.uniforms, this.fu, { uFGain: { value: 1 }, uFFade: { value: new THREE.Vector4(...fade) } });
      patch(mat, 'vertexShader', mainSig, FIELD_GLSL + mainSig);
      patch(mat, 'vertexShader', find, repl);
    };
    // landing time of each column's head on the field plane
    this.tLand = [];
    for (let i = 0; i < N; i++) {
      let a = EXT0, b = 12;
      for (let it = 0; it < 50; it++) { const m = 0.5 * (a + b); if (headOff(m) >= Y_COL - YF) b = m; else a = m; }
      let a2 = EXT0, b2 = 20;     // ... and of its tail (the last row)
      for (let it = 0; it < 50; it++) { const m = 0.5 * (a2 + b2); if (headOff(m) - (NROW - 1) * LH >= Y_COL - YF) b2 = m; else a2 = m; }
      this.tLand.push(b + COLD * i);
      this.fu.uLand.value[i].set(tokX(i), 0, b + COLD * i, b2 + COLD * i);
    }

    this.atlas = new GlyphAtlas({ size: 4096, px: 48 });

    // ---- the seven characters (own fine atlas: they are large)
    this.hero = new TextField(this.ctx, { px: 160, atlasSize: 2048, aperture: 0.035, focus: 10, maxBlur: 30 });
    const heroItems = CH.map((c, i) => ({ text: c, font: 'sans', size: CHS, pos: [tokX(i), 0, 0], color: PAL.c, intensity: 2.0,
      show: [1.02 + 0.035 * i, 1e6, 0.62, 0] }));
    await this.hero.prepare(heroItems);
    const L0 = this.hero.measure(heroItems[0]);
    const ay = (0.38 - L0.ext[1]) / (L0.ext[3] - L0.ext[1]);     // the CJK em-box centre sits on y = 0
    heroItems.forEach(it => { it.anchor = [0.5, ay]; });
    this.hero.set(heroItems);
    this.scene.add(this.hero.mesh);
    const dxE = -(L0.ext[0] + (L0.ext[2] - L0.ext[0]) * 0.5), dyE = -(L0.ext[1] + (L0.ext[3] - L0.ext[1]) * ay);

    // ---- dot-matrix of each character (the cluster unfolds into these, then they give way to the glyphs)
    const S = 200, cv = document.createElement('canvas'); cv.width = 280; cv.height = 300;
    const g = cv.getContext('2d', { willReadFrequently: true });
    await document.fonts.load(`300 ${S}px NotoSansTC`, CH.join(''));
    this.dots = [];
    const step = S / 21;
    CH.forEach((ch, i) => {
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      g.font = `300 ${S}px "NotoSansTC", "NotoSans"`; g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
      const P0 = 40, B = 250;
      g.fillText(ch, P0, B);
      const img = g.getImageData(0, 0, cv.width, cv.height).data;
      let j = 0;
      for (let y = step / 2; y < cv.height; y += step) for (let x = step / 2; x < cv.width; x += step) {
        // coverage of the cell around the grid point
        let s = 0, c = 0;
        for (let yy = Math.max(0, Math.floor(y - step / 2)); yy < Math.min(cv.height, y + step / 2); yy += 2)
          for (let xx = Math.max(0, Math.floor(x - step / 2)); xx < Math.min(cv.width, x + step / 2); xx += 2) { s += img[(yy * cv.width + xx) * 4 + 3]; c++; }
        if (!c) continue;
        if (s / c / 255 < 0.3) continue;
        const u = (x - P0) / S, v = (B - y) / S;
        const h1 = hash1(i * 91.7 + j * 1.913), h2 = hash1(i * 13.1 + j * 7.77 + 1.1), h3 = hash1(j * 3.3 + i * 17.9 + 5.5);
        this.dots.push({ i, x: tokX(i) + (u + dxE) * CHS, y: (v + dyE) * CHS, h1, h2, h3 });
        j++;
      }
    });

    // ---- small text (labels, vectors, field numbers, cloud) shares one atlas
    const mono = { font: 'mono', weight: 400 };
    this.lab = new TextField(this.ctx, { atlas: this.atlas, aperture: 0.035, focus: 10, maxBlur: 20 });
    const labItems = [];
    for (let i = 0; i < N; i++) {
      const tp = PING(i);
      labItems.push({ ...mono, text: IDS[i], size: 0.07, pos: [tokX(i), Y_ID, DZ], color: PAL.si, intensity: 1.25,
        reveal: [tp + 0.02, tp + 0.2], show: [tp, 1e6, 0, 0] });
      labItems.push({ ...mono, weight: 300, text: bytesOf(CH[i]), size: 0.05, pos: [tokX(i), Y_BY, DZ], color: PAL.line, intensity: 0.5,
        show: [tp + 0.12, 1e6, 0.35, 0] });
    }
    this.labD = labItems.length;
    labItems.push({ ...mono, text: 'd = 4096', size: 0.066, pos: [tokX(0) - 0.53, Y_COL - NV * LH * 0.5, 0], anchor: [1, 0.5],
      color: PAL.si, intensity: 1.0, show: [EXT0 + 0.7, 7.3, 0.45, 0.6] });
    // attention weights at the apex of each arc
    this.arcs0 = LINKS.map(([a, b, w, t0]) => {
      const xa = tokX(a) + 0.05 + 0.025 * Math.min(b - a, 5), xb = tokX(b) - 0.05 - 0.025 * Math.min(b - a, 5);
      const h = arcH(Math.abs(xb - xa));
      return { a, b, w, t0, xa, xb, h, L: halfEllipse(Math.abs(xb - xa) / 2, h) };
    });
    for (const A of this.arcs0) {
      labItems.push({ ...mono, text: fmtW(A.w), size: 0.058, pos: [0.5 * (A.xa + A.xb), HB + A.h + 0.045, 0], anchor: [0.5, 0],
        color: PAL.si, intensity: 0.75 + 0.6 * A.w, show: [A.t0 + ARC_DUR * 0.8, 1e6, 0.4, 0] });
    }
    await this.lab.prepare(labItems);
    this.lab.set(labItems);
    this.scene.add(this.lab.mesh);

    // ---- the vectors: NROW strings per column, moved on the CPU every call (pure function of t)
    this.vec = new TextField(this.ctx, { atlas: this.atlas, aperture: 0.035, focus: 10, maxBlur: 20 });
    this.vals = [];
    const vecItems = [];
    for (let i = 0; i < N; i++) {
      const r = new Rand(7100 + i * 13), vs = [];
      for (let k = 0; k < NROW; k++) {
        const v = clamp(r.gauss() * 0.17, -0.6, 0.6);
        vs.push(v);
        vecItems.push({ ...mono, text: k === NROW - 1 ? '…' : fmtV(v), size: VSZ, pos: [tokX(i) + 0.155, Y_COL, 0], anchor: [1, 0.5],
          color: PAL.si, intensity: 1.0, alpha: 0 });
      }
      this.vals.push(vs);
    }
    await this.vec.prepare(vecItems);
    this.vec.set(vecItems);
    this.scene.add(this.vec.mesh);

    // ---- the field: a vast sheet of numbers on the plane y = YF over a lattice of points (no grid lines: restraint)
    const fr = new Rand(31337);
    const fieldItems = [];
    const FX = 0.6, FZ = 0.32;
    for (let zi = 0; zi < 190; zi++) {
      const z = 5.8 - zi * FZ;
      for (let xi = -25; xi < 25; xi++) {
        const x = (xi + 0.5) * FX;
        const v = clamp(fr.gauss() * 0.34, -0.99, 0.99);
        fieldItems.push({ ...mono, text: fmtW(v), size: 0.085, pos: [x, YF, z], ax: [1, 0, 0], ay: [0, 0, -1],
          color: PAL.line, intensity: 0.2 + 0.32 * Math.min(1, Math.abs(v) * 1.6) });
      }
    }
    this.fld = new TextField(this.ctx, { atlas: this.atlas, aperture: 0.06, focus: 10, maxBlur: 22, fade: [0.5, 1.0, 44, 46] });
    await this.fld.prepare(fieldItems);
    this.fld.set(fieldItems);
    fieldPatch(this.fld.material, 'void main() {', 'vCol = col.rgb * alpha * fade * uTint;', 'vCol = fieldMod(col.rgb * alpha * fade * uTint, s0.xyz, z);', [0.8, 2.6, 15, 38]);
    this.scene.add(this.fld.mesh);

    const PX = [], PZ = [];
    for (let xi = -50; xi <= 50; xi++) PX.push(xi * FX);
    for (let zi = 0; zi < 360; zi++) PZ.push(5.8 + FZ * 0.5 - zi * FZ);
    this.fpts = new SoftPoints({ count: PX.length * PZ.length, resolution: res, focus: 10, aperture: 0.09, maxSize: 26 });
    {
      let n = 0; const lc = col3(PAL.line, 0.3);
      for (const z of PZ) for (const x of PX) {
        this.fpts.positions.set([x, YF, z], n * 3); this.fpts.colors.set(lc, n * 3); this.fpts.sizes[n] = 1.5; n++;
      }
      this.fpts.update();
    }
    fieldPatch(this.fpts.material, 'void main(){', 'vCol = color * (base * base) / (s * s) * (1.0 + 2.0 * vBokeh);',
      'vCol = fieldMod(color, position, z) * (base * base) / (s * s) * (1.0 + 2.0 * vBokeh);', [1.2, 3.5, 15, 40]);
    this.scene.add(this.fpts.mesh);


    // ---- the region: other people's questions around R, drawn as an annotated scatter (a warm dot per question,
    // its words beside it), clumped like an embedding plot: islands of different sizes with gaps, no core.
    // Seven of them are the nearest: the question's seven threads end on them (40.0), each marked with a ring.
    const cr = new Rand(4242);
    this.nn = [];
    const NNQ = ['Will she be okay?', '媽媽會好嗎', '¿Mi madre se va a curar?', 'お母さんは助かりますか', '엄마 괜찮을까요?', 'Wird sie wieder gesund?', 'هل ستشفى أمي؟'];
    for (let i = 0; i < N; i++) {
      const a = -2.2 + i * 0.73 + 0.25 * (cr.next() - 0.5), r = 0.9 + 0.75 * cr.next();
      this.nn.push([R[0] + Math.sin(a) * r * 1.25, R[1] + 0.35 * (cr.next() - 0.35), R[2] + Math.cos(a) * r * 0.9]);
    }
    const subs = [];
    for (let k = 0; k < 46; k++) {
      // islands floating at different heights: a few large, many small, kept apart (gaps between them)
      let c, sz = 0.14 + 0.42 * Math.pow(cr.next(), 1.6), tries = 0;
      do {
        c = [(cr.next() * 2 - 1) * 6.0, (cr.next() * 2 - 1) * 1.35, (cr.next() * 2 - 1) * 4.8];
        tries++;
      } while (tries < 80 && (subs.some(q => Math.hypot(q.c[0] - c[0], (q.c[1] - c[1]) * 1.4, q.c[2] - c[2]) < (q.s + sz) * 2.5)
        || Math.hypot(c[0] / 6.0, c[1] / 1.5, c[2] / 4.8) > 1.0));
      subs.push({ c, s: sz, w: sz * sz * 2.2 + 0.03, el: [0.7 + 0.6 * cr.next(), 0.5 + 0.3 * cr.next(), 0.7 + 0.6 * cr.next()] });
    }
    const wsum = subs.reduce((q, x) => q + x.w, 0);
    const NCP = 4400;
    this.cloud = [];
    this.cpts = new SoftPoints({ count: NCP + N, resolution: res, focus: 30, aperture: 0.03, maxSize: 30 });
    const cloudItems = [];
    const tsOf = p => T_REGION + 0.04 + 0.55 * Math.pow(Math.min(Math.hypot((p[0] - R[0]) / 2.6, (p[2] - R[2]) / 2.2), 3.2), 0.9) + 0.12 * cr.next();
    for (let n = 0; n < NCP; n++) {
      let p;
      if (cr.next() < 0.08) p = [R[0] + (cr.next() * 2 - 1) * 7.0, R[1] + (cr.next() * 2 - 1) * 1.6, R[2] + (cr.next() * 2 - 1) * 5.8];   // sparse, between
      else {
        let u = cr.next() * wsum, sb = subs[0];
        for (const x of subs) { if (u < x.w) { sb = x; break; } u -= x.w; }
        p = [R[0] + sb.c[0] + cr.gauss() * sb.s * sb.el[0], R[1] + sb.c[1] + cr.gauss() * sb.s * sb.el[1], R[2] + sb.c[2] + cr.gauss() * sb.s * sb.el[2]];
      }
      p[1] = Math.max(p[1], YF + 0.1);
      const ts = tsOf(p);
      this.cloud.push({ ts, I: 0.4 + 0.45 * cr.next() });
      this.cpts.positions.set(p, n * 3); this.cpts.sizes[n] = 1.25 + 0.45 * cr.next();
      if (n % 3 === 0) {
        const text = QS[cr.int(0, QS.length - 1)];
        cloudItems.push({ text: '\u2002' + text, font: isLatin(text) ? 'latin' : 'sans', size: (isLatin(text) ? 0.058 : 0.064) * (0.8 + 0.45 * cr.next()),
          billboard: true, anchor: [0, 0.5], pos: p, color: PAL.c, intensity: 0.3 + 0.22 * cr.next(), show: [ts + 0.1, 1e6, 0.6, 0] });
      }
    }
    this.nn.forEach((p, i) => {
      const ts = T_REGION + 0.02 * i;
      this.cloud.push({ ts, I: 2.2, hot: true });
      this.cpts.positions.set(p, (NCP + i) * 3); this.cpts.sizes[NCP + i] = 2.2;
      const text = NNQ[i];
      cloudItems.push({ text: '\u2003' + text, font: isLatin(text) ? 'latin' : 'sans', size: 0.1, billboard: true, anchor: [0, 0.5], pos: p,
        color: PAL.hot, intensity: 0.95, show: [T_REGION + 0.25 + 0.05 * i, 1e6, 0.5, 0] });
    });
    this.cpts.update();
    this.scene.add(this.cpts.mesh);
    this.cld = new TextField(this.ctx, { atlas: this.atlas, aperture: 0.012, focus: 30, maxBlur: 18, fade: [0.6, 2.4, 0, 0] });
    await this.cld.prepare(cloudItems);
    this.cld.set(cloudItems);
    this.scene.add(this.cld.mesh);

    // ---- dynamic lines and points (rebuilt every call)
    this.dyn = new FLines({ resolution: res, aperture: 0.035, focus: 10, maxWidth: 14 });
    this.arc = new FLines({ resolution: res, flow: 1, flowFreq: 1.6, flowSpeed: 0.55, flowSharp: 8, flowBase: 0.3, aperture: 0.035, focus: 10, maxWidth: 14 });
    this.pts = new SoftPoints({ count: this.dots.length + 256, resolution: res, focus: 10, aperture: 0.035, maxSize: 60 });
    this.scene.add(this.dyn.mesh, this.arc.mesh, this.pts.mesh);

    // the other attention heads: sparse, faint, stacked behind the sequence
    this.heads = [];
    for (let h = 1; h <= HEADS; h++) {
      const r = new Rand(900 + h * 7), n = 4 + r.int(0, 3), used = new Set();
      for (let k = 0; k < n; k++) {
        let a = r.int(0, 5), b = r.int(a + 1, 6);
        if (used.has(a * 8 + b)) continue; used.add(a * 8 + b);
        const xa = tokX(a) + 0.06, xb = tokX(b) - 0.06, hh = arcH(xb - xa) * (0.8 + 0.35 * r.next());
        this.heads.push({ h, a, b, w: 0.08 + 0.45 * r.next() * r.next(), t0: HEAD_T + 0.16 * (h - 1) + 0.07 * k, xa, xb, hh, z: -0.42 * h, L: halfEllipse((xb - xa) / 2, hh) });
      }
    }
    // the question reaches into the field: one thread per token, all arriving at R at 40.0
    this.query = [];
    for (let i = 0; i < N; i++) {
      const P0 = [tokX(i), -HB, 0], P2 = this.nn[i], P1 = [lerp(tokX(i), P2[0], 0.3), YF + 0.55, lerp(0, P2[2], 0.42)];
      const pts = [];
      for (let k = 0; k <= 96; k++) {
        const s = k / 96, a = (1 - s) * (1 - s), b = 2 * s * (1 - s), c = s * s;
        pts.push(a * P0[0] + b * P1[0] + c * P2[0], a * P0[1] + b * P1[1] + c * P2[1], a * P0[2] + b * P1[2] + c * P2[2]);
      }
      let L = 0; for (let k = 3; k < pts.length; k += 3) L += Math.hypot(pts[k] - pts[k - 3], pts[k + 1] - pts[k - 2], pts[k + 2] - pts[k - 1]);
      this.query.push({ pts, L, t0: T_QUERY + 0.05 * i });
    }
    this._cullKey = null;
  }

  // a dot of the unfolding cluster at time t: [x, y, z, progress]
  dotAt(d, t) {
    const dep = 0.1 + 0.035 * Math.abs(d.i - 3) + 0.12 * d.h1, dur = 0.8 + 0.3 * d.h2;
    const u = clamp((t - dep) / dur), e = easeInOutCubic(u);
    const a = d.h3 * 6.2832, r0 = 0.012 + 0.03 * d.h1;
    const sx = Math.cos(a) * r0, sy = Math.sin(a) * r0;
    return [sx + (d.x - sx) * e, sy + (d.y - sy) * e, 0.75 * Math.sin(Math.PI * e) * (0.55 + 0.45 * d.h3), u];
  }

  // ----------------------------------------------------------------------------------------- per call
  update(shot, t, T) {
    const cam = this.camera;
    cam.aspect = shot._aspect || this.ctx.aspect;
    cam.fov = 30;
    const P = camPos(t), Lk = camLook(t);
    cam.position.set(P[0], P[1], P[2]); cam.up.set(0, 1, 0); cam.lookAt(Lk[0], Lk[1], Lk[2]);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();

    // focus: the token row, racked to the region after it lights up
    const dTok = Math.hypot(P[0], P[1] - 0.0, P[2]);
    const dReg = Math.hypot(P[0] - R[0], P[1] - R[1], P[2] - R[2]);
    const rack = smoothstep(T_REGION + 0.4, T_REGION + 2.2, t);
    const focus = lerp(dTok, dReg, rack);
    for (const o of [this.hero, this.lab, this.vec, this.fld, this.cld]) { o.uniforms.uTime.value = t; o.uniforms.uFocus.value = focus; }
    for (const o of [this.dyn, this.arc]) { o.uniforms.uTime.value = t; o.uniforms.uFocus.value = focus; }
    for (const o of [this.pts, this.fpts, this.cpts]) o.uniforms.uFocus.value = focus;
    this.fu.uFT.value = t;

    const gTok = (1 - smoothstep(15.6, 16.6, t)) * (1 - 0.42 * smoothstep(T_REGION, T_REGION + 1.8, t));
    this.hero.uniforms.uOpacity.value = gTok;
    this.lab.uniforms.uOpacity.value = gTok;
    this.arc.uniforms.uOpacity.value = 1;

    // ping response of each character
    for (let i = 0; i < N; i++) {
      const dt = t - PING(i);
      const k = dt > 0 ? 1 + 0.45 * Math.exp(-dt / 0.22) : 1;
      this.hero.update(i, { intensity: 2.0 * k });
    }

    const lines = [], arcs = [];
    const pts = this.pts; let np = 0;
    const putP = (x, y, z, c, I, size) => {
      if (I <= 1e-4 || np >= pts.count) return;
      pts.positions[np * 3] = x; pts.positions[np * 3 + 1] = y; pts.positions[np * 3 + 2] = z;
      pts.colors[np * 3] = c.r * I; pts.colors[np * 3 + 1] = c.g * I; pts.colors[np * 3 + 2] = c.b * I;
      pts.sizes[np] = size; np++;
    };

    // ---- 27.2–29.0: the cluster unfolds into the seven characters (dot-matrix of light -> glyphs)
    if (t < 2.0) {
      const glow = 1 - smoothstep(0.0, 0.8, t);
      putP(0, 0, 0, PAL.c, 0.35 * glow, 30); putP(0, 0, 0, PAL.hot, 1.4 * glow, 5);
      // each dot is drawn as the streak it travels during one sub-frame, so the sub-frames join into motion blur
      const pxs = this.ctx.height / 804, DTS = 0.5 / 24 / 6;
      for (const d of this.dots) {
        const a = this.dotAt(d, t), b = this.dotAt(d, t - DTS);
        const out = 1 - smoothstep(1.18 + 0.035 * d.i, 1.78 + 0.035 * d.i, t);
        const I = 1.5 * (0.1 + 0.9 * smoothstep(0.0, 0.3, a[3])) * out * (0.75 + 0.5 * d.h2);
        if (I <= 1e-3) continue;
        const col = d.h3 > 0.93 ? PAL.hot : PAL.c;
        const L = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 150 * pxs;
        if (L < 0.7) { putP(a[0], a[1], a[2], col, I, 1.7); continue; }
        const k = 1.9 / (L + 1.9);
        putP(a[0], a[1], a[2], col, I * k, 1.7);
        lines.push({ points: [b[0], b[1], b[2], a[0], a[1], a[2]], color: col, intensity: I * k * 1.25, width: 1.5 });
      }
    }

    // ---- 29.0–31.1: tokens. A wire cell snaps around each character with a ping, its id types in below.
    for (let i = 0; i < N; i++) {
      const dt = t - PING(i);
      if (dt < 0 || gTok <= 0) continue;
      const x = tokX(i);
      const snap = 1 + 0.17 * (1 - easeOutCubic(clamp(dt / 0.17)));
      const flash = 1 + 2.6 * Math.exp(-dt / 0.2);
      const hb = HB * snap, I = gTok * flash;
      const sq = (z, s, inten, w, col = PAL.si) => lines.push({ points: [x - s, -s, z, x + s, -s, z, x + s, s, z, x - s, s, z, x - s, -s, z], color: col, intensity: inten, width: w });
      sq(DZ, hb, 0.8 * I, 1.0);
      sq(-DZ, hb, 0.2 * I, 0.8);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        lines.push({ points: [x + sx * hb, sy * hb, DZ, x + sx * hb, sy * hb, -DZ], color: PAL.si, intensity: 0.2 * I, width: 0.8 });
        const o = hb + 0.035, arm = 0.075, cx = x + sx * o, cy = sy * o;
        lines.push({ points: [cx - sx * arm, cy, DZ, cx, cy, DZ, cx, cy - sy * arm, DZ], color: PAL.si, intensity: 1.35 * I, width: 1.2 });
      }
      if (dt < 0.65) {   // the ping ripple
        const u = dt / 0.65, s = HB * (1 + 0.8 * easeOutCubic(u));
        sq(DZ, s, 1.5 * (1 - u) * (1 - u) * gTok, 0.9);
      }
    }

    // ---- 31–35: vectors unroll under each token, then pour down into the field
    const vec = this.vec;
    for (let i = 0; i < N; i++) {
      const ti = t - COLD * i, off = headOff(ti), x = tokX(i), xa = x - 0.27;
      let yLo = Y_COL, yHi = null;
      for (let k = 0; k < NROW; k++) {
        const idx = i * NROW + k, s = off - k * LH, y = Y_COL - s;
        let a = 0, I = 1;
        if (s > 0 && y > YF) {
          a = smoothstep(0, 0.7 * LH, s) * smoothstep(YF, YF + 0.32, y);
          I = 0.95 * (1 + 1.3 * Math.exp(-s / (1.3 * LH)));
          if (yHi === null) yHi = Math.min(Y_COL, y + LH * 0.5);
          yLo = Math.min(yLo, y);
          if (k < NROW - 1 && a > 0.003) {
            const v = this.vals[i][k], f = smoothstep(0.2 * LH, 2.4 * LH, s);
            lines.push({ points: [xa, y, 0, xa + v * 0.15 * f, y, 0], color: PAL.si, intensity: 0.8 * a, width: 2.3 });
          }
        }
        const it = vec.items[idx];
        if (a !== it.alpha || (a > 0 && (it.pos[1] !== y || it.intensity !== I))) vec.update(idx, { pos: [x + 0.155, y, 0], alpha: a, intensity: I });
      }
      if (off > 0.02 && yLo < Y_COL) {
        const fade = 1 - smoothstep(7.0, 7.8, t);
        if (fade > 0) lines.push({ points: [xa, Y_COL + 0.02, 0, xa, Math.max(yLo - LH * 0.5, YF), 0], color: PAL.si, intensity: 0.22 * fade, width: 0.7 });
      }
    }
    // the dimension line of the vectors (d = 4096), left of the first column
    {
      const k = smoothstep(EXT0 + 0.5, EXT0 + 1.0, t) * (1 - smoothstep(6.7, 7.3, t));
      if (k > 0) {
        const xd = tokX(0) - 0.47, y0 = Y_COL - 0.01, y1 = Y_COL - Math.min(headOff(t), Y_COL - YF) + 0.01;
        lines.push({ points: [xd, y0, 0, xd, y1, 0], color: PAL.si, intensity: 0.55 * k, width: 0.8 });
        lines.push({ points: [xd - 0.035, y0, 0, xd + 0.035, y0, 0], color: PAL.si, intensity: 0.7 * k, width: 0.9 });
        lines.push({ points: [xd - 0.035, y1, 0, xd + 0.035, y1, 0], color: PAL.si, intensity: 0.7 * k, width: 0.9 });
      }
    }

    // ---- 34–39: attention. Arcs grow from key to query; pulses run along them; weights at the apex.
    const arcI = gTok;
    for (const A of this.arcs0) {
      const f = clamp((t - A.t0) / ARC_DUR);
      if (f <= 0 || arcI <= 0) continue;
      const e = easeInOutSine(f);
      const pts3 = arcGeom(A.xa, A.xb, HB + 0.005, 0, A.h, e);
      const bloom = 1 + 0.9 * Math.exp(-Math.max(0, t - A.t0 - ARC_DUR) / 0.45) * smoothstep(0.6, 1.0, f);
      arcs.push({ points: pts3, color: PAL.si, intensity: (0.42 + 1.2 * A.w) * bloom * arcI, width: 0.6 + 1.9 * A.w, u0: 0, u1: e * A.L, flowAmt: 0.45, phase: A.a * 0.37 });
      const n = pts3.length / 3 - 1;
      if (f < 1) putP(pts3[n * 3], pts3[n * 3 + 1], pts3[n * 3 + 2], PAL.si, 2.2 * arcI, 2.6);
      putP(A.xa, HB + 0.005, 0, PAL.si, 1.2 * arcI, 2.2);
      if (f >= 1) putP(A.xb, HB + 0.005, 0, PAL.si, 1.2 * arcI, 2.2);
    }
    for (const A of this.heads) {
      const f = clamp((t - A.t0) / 0.6);
      if (f <= 0 || arcI <= 0) continue;
      const e = easeInOutSine(f), fall = Math.pow(0.78, A.h);
      const pts3 = arcGeom(A.xa, A.xb, HB, A.z, A.hh, e, 48);
      arcs.push({ points: pts3, color: PAL.si, intensity: (0.22 + 0.7 * A.w) * fall * arcI, width: 0.55 + 1.3 * A.w, u0: 0, u1: e * A.L, flowAmt: 0.3, phase: A.h * 0.21 });
    }
    // anchor ticks of the heads' sequences (faint dots behind each token)
    {
      const k = smoothstep(HEAD_T, HEAD_T + 0.8, t) * arcI;
      if (k > 0) for (let h = 1; h <= HEADS; h++) for (let i = 0; i < N; i++) putP(tokX(i), HB, -0.42 * h, PAL.si, 0.5 * k * Math.pow(0.8, h), 1.6);
    }

    // ---- 39–40: the question reaches into the field; 40.0 the region lights up
    for (const Q of this.query) {
      const f = clamp((t - Q.t0) / (T_REGION - Q.t0));
      if (f <= 0) continue;
      const fade = 1 - smoothstep(T_REGION + 1.5, T_REGION + 3.2, t);
      if (fade <= 0) continue;
      const e = easeInOutSine(f), m = Math.max(2, Math.ceil(96 * e) + 1);
      const ptsQ = Q.pts.slice(0, m * 3), colors = [], alpha = [];
      for (let k = 0; k < m; k++) {
        const s = k / 96, c = smoothstep(0.35, 1.0, s);
        colors.push(lerp(PAL.si.r, PAL.c.r, c), lerp(PAL.si.g, PAL.c.g, c), lerp(PAL.si.b, PAL.c.b, c));
        alpha.push(smoothstep(0, 0.06, s));
      }
      arcs.push({ points: ptsQ, colors, alpha, intensity: 0.75 * fade * (1 + 0.8 * smoothstep(0.8, 1, f)), width: 0.85, u0: 0, u1: e * Q.L, flowAmt: 0.7, phase: 0.13 * Q.t0 });
      if (f < 1) putP(ptsQ[(m - 1) * 3], ptsQ[(m - 1) * 3 + 1], ptsQ[(m - 1) * 3 + 2], PAL.si, 2.0 * fade, 2.4);
    }
    // a small ring around each of the seven nearest questions
    {
      const k = smoothstep(T_REGION, T_REGION + 0.35, t) * (1 - smoothstep(18.6, 19.6, t));
      if (k > 0) {
        const e = this.camera.matrixWorld.elements, rx = [e[0], e[1], e[2]], uy = [e[4], e[5], e[6]];
        this.nn.forEach((p, i) => {
          const u = clamp((t - T_REGION - 0.03 * i) / 0.5), rad = 0.11 * (1 + 0.6 * (1 - easeOutCubic(u)));
          if (u <= 0) return;
          const ring = [];
          for (let q = 0; q <= 40; q++) { const a = q / 40 * Math.PI * 2, c = Math.cos(a) * rad, sn = Math.sin(a) * rad; ring.push(p[0] + rx[0] * c + uy[0] * sn, p[1] + rx[1] * c + uy[1] * sn, p[2] + rx[2] * c + uy[2] * sn); }
          lines.push({ points: ring, color: PAL.hot, intensity: 0.9 * k * (1 + 1.2 * (1 - u)), width: 0.9 });
        });
      }
    }
    // the region's ring on the field (dashed, draws itself round)
    {
      const f = clamp((t - T_REGION - 0.2) / 1.4);
      const k = smoothstep(0, 0.25, f) * (1 - smoothstep(16.6, 17.6, t));
      if (k > 0) {
        const rad = 5.6, nd = 96, e = easeInOutCubic(f);
        for (let d = 0; d < nd; d++) {
          const a0 = (d / nd) * Math.PI * 2, a1 = a0 + (0.55 / nd) * Math.PI * 2;
          if (d / nd > e) break;
          const seg = [];
          for (let q = 0; q <= 3; q++) { const a = lerp(a0, a1, q / 3); seg.push(R[0] + Math.cos(a) * rad, YF + 0.003, R[2] + Math.sin(a) * rad); }
          lines.push({ points: seg, color: PAL.c, intensity: 0.5 * k, width: 0.9 });
        }
        for (let q = 0; q < 4; q++) {   // four cardinal ticks
          const a = q * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
          lines.push({ points: [R[0] + c * (rad - 0.35), YF + 0.003, R[2] + s * (rad - 0.35), R[0] + c * (rad + 0.35), YF + 0.003, R[2] + s * (rad + 0.35)], color: PAL.c, intensity: 0.7 * k * smoothstep(0.85, 1, f), width: 1.0 });
        }
      }
    }

    // the region's dots light up from the centre outward
    if (t > T_REGION) {
      const C = this.cpts.colors;
      for (let n = 0; n < this.cloud.length; n++) {
        const q = this.cloud[n], k = smoothstep(q.ts, q.ts + 0.6, t);
        const c = q.hot ? PAL.hot : PAL.c, I = q.I * k;
        C[n * 3] = c.r * I; C[n * 3 + 1] = c.g * I; C[n * 3 + 2] = c.b * I;
      }
      this.cpts.update();
      this.cpts.mesh.visible = true;
    } else this.cpts.mesh.visible = false;

    this.dyn.setPolylines(lines);
    this.arc.setPolylines(arcs);
    pts.update(np);

    // big text fields: cull once per frame
    const fk = Math.round(T * 24);
    if (fk !== this._cullKey) { this._cullKey = fk; this.fld.cull(cam, t, fk); this.cld.cull(cam, t, fk); }

    return {
      scene: this.scene, camera: cam,
      post: { bloomStrength: 0.42, bloomThreshold: 1.0, halation: 0.04, streak: 0.02, vignette: 0.3, grain: 0.012, ca: 0.0006 },
    };
  }

  dispose() {
    for (const o of [this.hero, this.lab, this.vec, this.fld, this.cld, this.dyn, this.arc, this.pts, this.fpts, this.cpts]) o?.dispose();
  }
}
