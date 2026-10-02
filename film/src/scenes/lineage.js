// LINEAGE (130–160 s): one continuous line drawing that walks from the oracle-bone crack back to the AI.
//
//   130.0  the crack 卜 (lib/crack.js), complete and frontal, warm; its two strokes straighten:
//          the vertical stroke (up + down, which meet at the junction) becomes the broken line ⚋, the gap
//          opening exactly at the junction; the branch becomes the unbroken line ⚊.            (131.5)
//   131.5  the two lines divide, Shao Yong's "doubling" (加一倍法): 兩儀 → 四象 → 八卦 → 16 → 32 → 64.
//          Each figure splits into two; each child grows a new top line, yin on the left, yang on the right,
//          so the row is always in binary order (= Zhu Xi's 伏羲六十四卦次序, read left to right).
//   137.0  the row of 64 is cut into eight rows of eight: the square (方圖), reading across and down 0..63.
//   138.25 every hexagram sends a copy along a thread to its place on the circle (圓圖), in pairs (v, v+32):
//          both halves of the circle rise from the bottom (坤 | 復) and close at the top (乾 | 姤) at 140.0.
//   143.5  the hexagrams turn into 0 and 1 in binary order: ⚊ → 1, ⚋ → 0, written the way Leibniz's printer
//          set them under the trigrams (digits turned on their side, the bottom line first).
//   145.0  Leibniz's TABLE DES NOMBRES (Mémoires de l'Académie royale des sciences, 1703, p. 86): the square's
//          numerals 0..32 fly into it one by one, with his small leading zeros and period rules; beside it
//          his addition examples (p. 86).
//   150.0  the table becomes punched tape (5-hole teleprinter tape, 0.1" pitch, feed holes between channels
//          2 and 3); the tape runs and accelerates; after the "&c." it carries a program.
//   151.3  1948: the Manchester Baby's store on its Williams-tube monitor, 32 words × 32 bits (dot = 0,
//          dash = 1, least significant bit on the left), filled with a program in its instruction format.
//   153.0  the tube's face becomes a chip package; traces fan out from its pins (PCB); pulses run.
//   155.0  push into the die: a glowing network (cold).
//   157.0  dolly-zoom out of the die into the mind: layers of cells, vectors and numbers; the camera
//          flies forward, accelerating, into the cut to the river at 160.
//
// Everything is a pure function of t. Lines: lib/seglines.js (exact anti-aliased ends). Text: look/text.js.
import * as THREE from '../../vendor/three.module.js';
import { PAL } from '../look/palette.js';
import { TextField } from '../look/text.js';
import { SegLines } from '../lib/seglines.js';
import { crackGeometry } from '../lib/crack.js';
import { clamp, lerp, smoothstep, easeInOutCubic, easeOutCubic, easeInCubic, easeInOutSine } from '../lib/ease.js';
import { hash1 } from '../lib/random.js';
import { TRIGRAM, TRIGRAM_NATURE, BIGRAM, MONOGRAM, HEX, line as yao, ringAngle, TAU } from '../lib/yijing.js';

// ------------------------------------------------------------------------------------------------ frame
const PX = 0.01;                                    // world units per design pixel (1920 × 804 design frame)
const FOV0 = 20;
const DIST = 4.02 / Math.tan(THREE.MathUtils.degToRad(FOV0 / 2));
const wx = X => (X - 960) * PX, wy = Y => (402 - Y) * PX;

const sat = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const ramp = (t, a, b) => sat((t - a) / (b - a));
const ease = (t, a, b) => easeInOutCubic(ramp(t, a, b));
const eout = (t, a, b) => easeOutCubic(ramp(t, a, b));
const win = (t, a, b, fi, fo) => Math.min(smoothstep(a, a + fi, t), 1 - smoothstep(b - fo, b, t));
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const C3 = c => [c.r, c.g, c.b];

const LINE = C3(PAL.line), WARM = C3(PAL.c), AI = C3(PAL.si), HOT = C3(PAL.hot);
const YAO = mixc(LINE, WARM, 0.5);                  // the lines people asked heaven with: paper light, warmed

// cards over this shot (lower third must be calm under them)
const CARDS = [[128.0, 134.2], [137.0, 143.4], [145.0, 151.4], [152.6, 159.4]];
const cardOn = T => { let k = 0; for (const [a, b] of CARDS) k = Math.max(k, win(T, a - 0.5, b + 0.5, 0.6, 0.6)); return k; };

// ------------------------------------------------------------------------------------------------ timing (local t = T − 130)
const STEPS = [[1.62, 0.9], [2.55, 1.0], [4.5, 0.75], [5.3, 0.72], [6.08, 0.8]];   // [t0, D] for level n → n+1
const NOTE = (n, c, t0, D) => t0 + D * (0.42 + 0.48 * c / ((2 << n) - 1));        // arrival of child c's new line
const RESHAPE = 7.0;
const RING0 = 8.25, RING_STEP = 0.04, RING_FLY = 0.5;                              // pair v lands at RING0 + v·step + fly
const CLIMAX = 10.0;
const FLIP0 = 13.5, FLIP_STEP = 0.021, FLIP_DUR = 0.26;
const MOVE = [15.05, 16.15];                                                        // diagram slides left, table appears
const FLY0 = 15.55, FLY_STEP = 0.112, FLY_DUR = 0.58;                              // numerals 0..32 into the table
const TAPE0 = 20.0, TAPE_RUN = 20.7;
const CRT0 = 21.3;
const PCB0 = 23.0;
const DIE0 = 25.0;
const MIND0 = 27.0;

// ------------------------------------------------------------------------------------------------ geometry
const YMID = 372;
// mitosis levels n = 1..6: pitch, line length, gap, spacing, width
const LV = [null,
  { p: 300, L: 210, g: 24, s: 0, w: 3.2 },
  { p: 196, L: 138, g: 18, s: 26, w: 2.9 },
  { p: 128, L: 90, g: 13, s: 19, w: 2.6 },
  { p: 82, L: 56, g: 9.5, s: 12.5, w: 2.2 },
  { p: 47, L: 32, g: 6.5, s: 7.6, w: 1.9 },
  { p: 25, L: 17, g: 4.4, s: 4.6, w: 1.6 },
];
const lvX = (n, v) => 960 + (v - ((1 << n) - 1) / 2) * LV[n].p;
const lvY = (n, k, s = LV[n].s) => YMID + ((n - 1) / 2 - k) * s;   // k = 0 bottom

// diagram (square + circle), design px, centre DC
const DCX = 960, DCY = 330;
const SQ_D = 31, SQ_L = 17, SQ_G = 4.4, SQ_S = 4.4, SQ_W = 1.6;
const R0 = 205, RS = 8.0, RW = 1.75;                // ring: first line radius, line spacing
const R_NAME = 262;
const ringLen = r => 0.7 * r * TAU / 64;

// Leibniz table (design px)
const TB = { x0: 952, cw: 9.4, y0: 124, rh: 14, em: 13, emSmall: 8.2, dec: 1022 };
const TB_COLX = j => TB.x0 + j * TB.cw;
const TB_ROWY = v => TB.y0 + v * TB.rh;

// tape (5-hole teleprinter tape: 11/16" wide, 0.1" pitch, feed holes between channels 2 and 3)
const TP = { P: 16, x1: 760 };
const CH_OFF = [-2.5, -1.5, 0.5, 1.5, 2.5];          // channels for table columns 1..5 (16, 8, 4, 2, 1)
const FEED_OFF = -0.5;

// CRT / chip
const CRT = { x: 1180, y: 330, half: 200, pitch: 10.5 };
const CHIP = { half: 100, pins: 20, pinPitch: 8, die: 64 };

// The Manchester Baby's store (21 June 1948 machine, 32 words × 32 bits; instruction = line number in bits
// 0–4, function in bits 13–15: 0 JMP, 1 JRP, 2 LDN, 3 STO, 4 SUB, 6 CMP, 7 STP). The listing follows the form
// of Kilburn's highest-factor routine (factorising 2^18); data words in two's complement.
function babyStore() {
  const LDN = 2, STO = 3, SUB = 4, CMP = 6, JRP = 1, JMP = 0, STP = 7;
  const prog = [[1, LDN, 24], [2, STO, 26], [3, LDN, 26], [4, STO, 27], [5, LDN, 23], [6, SUB, 27], [7, CMP, 0], [8, JRP, 20],
    [9, SUB, 26], [10, STO, 25], [11, LDN, 25], [12, CMP, 0], [13, STP, 0], [14, LDN, 26], [15, SUB, 21], [16, STO, 27],
    [17, LDN, 27], [18, STO, 26], [19, JMP, 22]];
  const w = new Uint32Array(32);
  for (const [l, f, s] of prog) w[l] = (s | (f << 13)) >>> 0;
  w[20] = (-3) >>> 0; w[21] = 1; w[22] = 4; w[23] = (-262144) >>> 0; w[24] = 262143;
  w[26] = 262143; w[27] = 131071; w[25] = (-131071) >>> 0;
  const bits = new Uint8Array(1024);
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) bits[r * 32 + c] = (w[r] >>> c) & 1;   // LSB on the left
  return bits;
}

// ------------------------------------------------------------------------------------------------ scene
export default class Lineage {
  constructor(ctx) { this.ctx = ctx; }

  async init() {
    const { width, height } = this.ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV0, width / height, 0.05, 400);
    this.sl = new SegLines({ resolution: [width, height], capacity: 6000 });
    this.scene.add(this.sl.mesh);
    this.tf = new TextField(this.ctx, { px: 64, atlasSize: 2048, focus: DIST, aperture: 0, revealSoft: 0.05 });
    this.tf.mesh.renderOrder = 2;
    this.scene.add(this.tf.mesh);
    this.buildCrack();
    this.store = babyStore();
    this.buildPCB();
    this.buildMind();
    await this.buildText();
  }

  // ---------------------------------------------------------------------------------------------- data
  buildCrack() {
    const C = crackGeometry();
    const S = 338, X0 = 962, Y0 = 352;
    const toPx = ([x, y]) => [X0 + x * S, Y0 - y * S];
    const N = 96;
    const resample = (pts, n) => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = cum[cum.length - 1], out = [];
      let j = 0;
      for (let i = 0; i < n; i++) {
        const s = L * i / (n - 1);
        while (j < pts.length - 2 && cum[j + 1] < s) j++;
        const k = (s - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9);
        out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * k, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * k]);
      }
      return out;
    };
    const lines = C.lines.map(P => ({ ...P, px: P.pts.map(toPx), Lpx: P.L * S }));
    // the three strokes, resampled; targets on the level-1 figures
    const n1 = LV[1], xL = lvX(1, 0), xR = lvX(1, 1), y1 = lvY(1, 0);
    const tgt = {
      up: [[xL - n1.g / 2, y1], [xL - n1.L / 2, y1]],         // junction end → outer end
      down: [[xL + n1.g / 2, y1], [xL + n1.L / 2, y1]],
      branch: [[xR - n1.L / 2, y1], [xR + n1.L / 2, y1]],
    };
    this.crack = lines.map((P, i) => {
      const main = i < 3;
      const pts = main ? resample(P.px, N) : P.px;
      return { kind: P.kind, pts, parent: P.parent, at: P.at / P.L, frac: P.parent >= 0 ? P.at / lines[P.parent].L : 0,
        w0: P.w0, w1: P.w1, glow: P.glow, tgt: main ? tgt[P.kind] : null };
    });
    this._crackCur = this.crack.map(P => P.pts.map(p => [p[0], p[1]]));
  }

  buildPCB() {
    // fan-out traces from the four sides of the package (design px relative to the chip centre)
    const H = CHIP.half, n = CHIP.pins, pp = CHIP.pinPitch;
    const traces = [];
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2);
        const spread = 17 + 3 * hash1(side * 31 + i * 0.7);
        const a = o * pp, b = o * spread;
        const esc = 16 + 3 * (i % 3);
        const d = Math.abs(b - a);
        // local frame: along = outward normal, across = tangent
        const pts = [[H + 2, a], [H + esc, a], [H + esc + d, b], [H + 1500, b]];
        const rot = ([u, v]) => side === 0 ? [u, v] : side === 1 ? [-u, -v] : side === 2 ? [v, -u] : [-v, u];
        const P = pts.map(rot);
        const cum = [0];
        for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
        traces.push({ side, i, pts: P, cum, L: cum[cum.length - 1], ph: hash1(side * 7.7 + i * 1.3), sp: 0.6 + 0.8 * hash1(i * 3.1 + side) });
      }
    }
    this.traces = traces;
  }

  buildMind() {
    // layers of cells behind the die plane (world units), with lit cells, numbers and links
    const layers = [];
    for (let l = 1; l <= 9; l++) {
      const z = -l * 3.2, cells = [];
      const pitch = 0.36, nx = 34, ny = 18;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const h = hash1(l * 97.1 + i * 13.7 + j * 7.3);
        if (h < 0.55) continue;
        cells.push({ x: (i - (nx - 1) / 2) * pitch, y: (j - (ny - 1) / 2) * pitch, lit: h > 0.93 ? 1 : 0, h });
      }
      layers.push({ z, pitch, cells, nx, ny });
    }
    this.layers = layers;
  }

  async buildText() {
    const items = [];
    const add = it => { items.push(it); return items.length - 1; };
    const tf = this.tf;
    // digit anchor: centre of the ink
    const m0 = tf.measure({ text: '0', font: 'garamond' });
    const ext = m0.ext, ink = m0.ink;
    this.digitAnchor = [((ink[0] + ink[2]) / 2 - ext[0]) / (ext[2] - ext[0]), ((ink[1] + ink[3]) / 2 - ext[1]) / (ext[3] - ext[1])];
    const DA = this.digitAnchor;
    const warmText = mixc(WARM, LINE, 0.25);
    const hidden = [-1e6, -1e5, 0, 0];
    // captions of the early levels
    this.lab = [];
    MONOGRAM.forEach((s, v) => this.lab.push(add({ text: s, font: 'serif', size: 22 * PX, pos: [wx(lvX(1, v)), wy(YMID + 40), 0], color: warmText, intensity: 0.9,
      show: [1.35, STEPS[0][0] + 0.3, 0.45, 0.35] })));
    BIGRAM.forEach((s, v) => this.lab.push(add({ text: s, font: 'serif', size: 17 * PX, tracking: 0.2, pos: [wx(lvX(2, v)), wy(YMID + 13 + 34), 0], color: warmText, intensity: 0.85,
      show: [STEPS[0][0] + STEPS[0][1] - 0.15, STEPS[1][0] + 0.3, 0.4, 0.35] })));
    const t8a = STEPS[1][0] + STEPS[1][1] - 0.1, t8b = STEPS[2][0] + 0.35;
    TRIGRAM.forEach((s, v) => {
      this.lab.push(add({ text: s, font: 'serif', size: 23 * PX, pos: [wx(lvX(3, v)), wy(YMID + 19 + 40), 0], color: warmText, intensity: 0.95, show: [t8a, t8b, 0.45, 0.4] }));
      this.lab.push(add({ text: TRIGRAM_NATURE[v], font: 'serif', size: 13 * PX, pos: [wx(lvX(3, v)), wy(YMID + 19 + 68), 0], color: warmText, intensity: 0.6, show: [t8a + 0.15, t8b, 0.45, 0.4] }));
    });
    // hexagram names around the circle (tops outward; two-character names read inward)
    this.names = [];
    for (let v = 0; v < 64; v++) {
      const name = HEX[v], chars = [...name];
      chars.forEach((ch, k) => {
        const r = chars.length === 1 ? R_NAME : R_NAME + (chars.length - 1 - 2 * k) * 6.6;
        this.names.push({ v, r, i: add({ text: ch, font: 'serif', size: 12.5 * PX, pos: [0, 0, 0], color: warmText, intensity: 0.78, show: hidden }) });
      });
    }
    // digits: ring (64 × 6) and square (64 × 6)
    this.ringDig = []; this.sqDig = [];
    for (let v = 0; v < 64; v++) for (let k = 0; k < 6; k++) {
      const b = yao(v, 6, k);
      this.ringDig.push(add({ text: String(b), font: 'garamond', size: 12.5 * PX, anchor: DA, pos: [0, 0, 0], color: LINE, intensity: 1.0, show: hidden }));
      this.sqDig.push(add({ text: String(b), font: 'garamond', size: 8.6 * PX, anchor: DA, pos: [0, 0, 0], color: LINE, intensity: 1.0, show: hidden }));
    }
    // the table: header, decimals, &c.
    const tcx = (TB_COLX(0) + TB.dec + 14) / 2;
    this.tbHead = [
      add({ text: 'TABLE', font: 'garamond', size: 12.5 * PX, tracking: 0.25, pos: [wx(tcx), wy(TB.y0 - 50), 0], color: LINE, intensity: 0.95, show: hidden }),
      add({ text: 'DES NOMBRES.', font: 'garamond', size: 10.5 * PX, tracking: 0.2, pos: [wx(tcx), wy(TB.y0 - 31), 0], color: LINE, intensity: 0.85, show: hidden }),
    ];
    this.tbDec = [];
    for (let v = 0; v <= 32; v++) this.tbDec.push(add({ text: String(v), font: 'garamond', size: TB.em * PX, anchor: [0, DA[1]], pos: [wx(TB.dec), wy(TB_ROWY(v)), 0], color: LINE, intensity: 0.9, show: hidden }));
    this.tbEtc = add({ text: '&c.', font: 'garamond', size: TB.em * PX, pos: [wx(TB_COLX(2.5)), wy(TB_ROWY(33) + 2), 0], color: LINE, intensity: 0.85, show: hidden });
    // Leibniz's addition examples (p. 86): 110+111=1101 (6+7=13), 101+1011=10000 (5+11=16), 1110+10001=11111 (14+17=31)
    this.addText = [];
    const AX = 1290, AY = 236, ex = [[['110', '111', '1101'], [6, 7, 13]], [['101', '1011', '10000'], [5, 11, 16]], [['1110', '10001', '11111'], [14, 17, 31]]];
    this.addText.push(add({ text: "Pour l'Addition", font: { family: 'EBGaramond', weight: 400, style: 'italic' }, size: 15 * PX, anchor: [0, 0.5], pos: [wx(AX - 20), wy(AY - 58), 0], color: LINE, intensity: 0.85, show: hidden }));
    this.addText.push(add({ text: 'par exemple.', font: { family: 'EBGaramond', weight: 400, style: 'italic' }, size: 15 * PX, anchor: [0, 0.5], pos: [wx(AX - 20), wy(AY - 38), 0], color: LINE, intensity: 0.85, show: hidden }));
    this.addRules = [];
    ex.forEach(([bins, decs], e) => {
      const x = AX + e * 118, rowsY = [AY, AY + 18, AY + 40];
      bins.forEach((s, r) => this.addText.push(add({ text: s, font: 'garamond', size: 13 * PX, anchor: [1, DA[1]], pos: [wx(x + 44), wy(rowsY[r]), 0], color: LINE, intensity: 0.9, show: hidden })));
      decs.forEach((d, r) => this.addText.push(add({ text: String(d), font: 'garamond', size: 13 * PX, anchor: [0, DA[1]], pos: [wx(x + 58), wy(rowsY[r]), 0], color: LINE, intensity: 0.75, show: hidden })));
      this.addRules.push({ x0: x + 6, x1: x + 80, y: AY + 29, xv: x + 51, y0: AY - 9, y1: AY + 48 });
    });
    // mind numbers (vector components on lit cells)
    this.mindNum = [];
    let q = 0;
    for (const L of this.layers) for (const c of L.cells) {
      if (!c.lit) continue;
      const val = (hash1(c.h * 91.7 + q) * 2 - 1);
      const s = (val < 0 ? '−' : ' ') + Math.abs(val).toFixed(4);
      this.mindNum.push({ L, c, i: add({ text: s, font: 'mono', size: 0.06, anchor: [0, 0.5], pos: [c.x + 0.05, c.y - 0.02, L.z], color: AI, intensity: 0.9, show: hidden }) });
      q++;
    }
    this.items = items;
    await tf.prepare(items);
    tf.set(items);
    this.hidden = hidden;
  }

  // ---------------------------------------------------------------------------------------------- drawing helpers
  // 2D segment in design px on the z = 0 plane, with the lower-third mask applied by screen position
  L(X1, Y1, X2, Y2, w, col, I, a = 1, cap = 0) {
    if (I <= 0 || a <= 0) return;
    const ym = this.cam.cy + ((Y1 + Y2) / 2 - this.cam.cy) * this.cam.zoom + (402 - this.cam.cy) * 0;
    const ys = 402 + ((Y1 + Y2) / 2 - this.cam.cy) * this.cam.zoom;
    const m = 1 - this.mask * smoothstep(560, 640, ys);
    const k = I * m * this.gain;
    if (k <= 0.0005) return;
    this.sl.seg(wx(X1), wy(Y1), 0, wx(X2), wy(Y2), 0, w, col[0] * k, col[1] * k, col[2] * k, a, cap);
  }
  // long line drawn in pieces so that the mask grades smoothly along it
  LL(X1, Y1, X2, Y2, w, col, I, a = 1, piece = 40) {
    const n = Math.max(1, Math.ceil(Math.hypot(X2 - X1, Y2 - Y1) / piece));
    for (let i = 0; i < n; i++) this.L(lerp(X1, X2, i / n), lerp(Y1, Y2, i / n), lerp(X1, X2, (i + 1) / n), lerp(Y1, Y2, (i + 1) / n), w, col, I, a);
  }
  // one yao line centred at (x, y) along unit direction (dx, dy): yang = one bar, yin = two bars around a gap
  yaoLine(x, y, dx, dy, len, gap, w, col, I, a = 1) {
    const h = len / 2;
    if (gap <= 0.05) { this.L(x - dx * h, y - dy * h, x + dx * h, y + dy * h, w, col, I, a); return; }
    const g = Math.min(gap / 2, h);
    this.L(x - dx * h, y - dy * h, x - dx * g, y - dy * g, w, col, I, a);
    this.L(x + dx * g, y + dy * g, x + dx * h, y + dy * h, w, col, I, a);
  }
  // a whole hexagram in a pose: centre (x, y), up vector (ux, uy) in design px (y down), spacing s,
  // lengths per line len(k), gap fraction gf, width w
  hexagram(v, P, col, I, a = 1, flash = null) {
    const rx = -P.uy, ry = P.ux;      // line direction: up rotated clockwise on screen (right of up)
    for (let k = 0; k < 6; k++) {
      const o = (k - 2.5) * P.s;
      const x = P.x + P.ux * o, y = P.y + P.uy * o;
      const len = P.len(k), b = yao(v, 6, k);
      const ii = flash ? I * flash(k) : I;
      this.yaoLine(x, y, rx, ry, len, b ? 0 : len * P.gf, P.w, col, ii, a);
    }
  }

  // ---------------------------------------------------------------------------------------------- poses
  sqCell(v) { const r = v >> 3, c = v & 7; return [DCX + (c - 3.5) * SQ_D, DCY + (r - 3.5) * SQ_D]; }
  sqPose(v) { const [x, y] = this.sqCell(v); return { x, y, ux: 0, uy: -1, s: SQ_S, len: () => SQ_L, gf: SQ_G / SQ_L, w: SQ_W }; }
  ringPose(v) {
    const th = ringAngle(v), c = Math.cos(th), s = Math.sin(th);
    const rm = R0 + 2.5 * RS;
    return { x: DCX + c * rm, y: DCY - s * rm, ux: c, uy: -s, s: RS, len: k => ringLen(R0 + k * RS), gf: 0.26, w: RW, th };
  }
  lerpPose(A, B, f) {
    const aA = Math.atan2(A.uy, A.ux), aB = Math.atan2(B.uy, B.ux);
    let d = aB - aA; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    const ang = aA + d * f;
    return { x: lerp(A.x, B.x, f), y: lerp(A.y, B.y, f), ux: Math.cos(ang), uy: Math.sin(ang), s: lerp(A.s, B.s, f),
      len: k => lerp(A.len(k), B.len(k), f), gf: lerp(A.gf, B.gf, f), w: lerp(A.w, B.w, f) };
  }
  // the diagram's placement in the frame: scale and centre (it slides left when the table appears)
  diag(t) {
    const e = ease(t, MOVE[0], MOVE[1]);
    return { s: lerp(1, 0.76, e), x: lerp(DCX, 575, e), y: DCY };
  }
  dp(X, Y, D) { return [D.x + (X - DCX) * D.s, D.y + (Y - DCY) * D.s]; }
  scalePose(P, D) {
    const [x, y] = this.dp(P.x, P.y, D);
    return { ...P, x, y, s: P.s * D.s, len: k => P.len(k) * D.s, w: P.w * Math.sqrt(D.s) };
  }

  // ---------------------------------------------------------------------------------------------- update
  update(shot, t, T) {
    t = clamp(t, -1, 31);
    T = 130 + t;
    const cam = this.camera;
    this.mask = cardOn(T);
    this.gain = 1;
    this.textUpd = [];
    const tf = this.tf;
    // ---- camera (2D framing: centre + zoom; the mind stage takes over with a 3D path)
    const c2 = this.camera2D(t);
    this.cam = c2;
    cam.aspect = shot._aspect || this.ctx.aspect;
    cam.fov = FOV0;
    cam.up.set(0, 1, 0);
    cam.position.set(wx(c2.cx), wy(c2.cy), DIST / c2.zoom);
    cam.lookAt(wx(c2.cx), wy(c2.cy), 0);
    cam.updateProjectionMatrix();
    this.sl.begin();
    if (t < 1.5) this.drawCrack(t);
    if (t >= 1.5 && t < RESHAPE) this.drawLevels(t);
    if (t >= RESHAPE && t < TAPE0 + 1.2) this.drawDiagram(t);
    if (t >= MOVE[0] - 0.1 && t < TAPE0 + 2.0) this.drawTable(t);
    if (t >= TAPE0 && t < PCB0 + 1.2) this.drawTape(t);
    if (t >= CRT0 && t < DIE0 + 0.5) this.drawCRT(t);
    if (t >= PCB0 && t < MIND0 + 1.0) this.drawChip(t);
    if (t >= MIND0 - 0.05) this.drawMind(t);
    this.sl.end();
    this.updateText(t);
    tf.uniforms.uTime.value = t;
    // ---- grade: warm at the bone, neutral paper light for Leibniz, cold for the machine
    const warm = 1 - smoothstep(18, 23, t);
    const post = {
      bloomStrength: 0.42, bloomThreshold: 0.95, bloomRadius: 0.8,
      halation: 0.05 * warm, streak: 0.0, ca: 0.0006, vignette: 0.34, grain: 0.012,
      lift: [0.001, 0.0013, 0.002],
    };
    return { scene: this.scene, camera: cam, post };
  }

  camera2D(t) {
    // slow dolly on the diagram, recentring on the chip, push into the die
    let cx = 960, cy = 402, zoom = 1;
    zoom *= 1 + 0.018 * ease(t, 10.0, 13.5);
    if (t > PCB0) {
      const e = ease(t, PCB0 + 0.2, PCB0 + 1.6);
      cx = lerp(960, CRT.x, e); cy = lerp(402, CRT.y, e);
    }
    if (t > DIE0) {
      const k = ramp(t, DIE0, MIND0 + 0.3);
      zoom *= Math.exp(Math.log(16) * easeInOutSine(k));
    }
    return { cx, cy, zoom };
  }

  // ---------------------------------------------------------------------------------------------- 130.0 the crack
  drawCrack(t) {
    const s1 = ease(t, 0.3, 1.05);           // straighten
    const s2 = ease(t, 0.55, 1.5);           // fly to the two figures
    const r = ease(t, 0.15, 0.8);            // twigs retract into their parents
    const crackCol = WARM, n1 = LV[1];
    const col = mixc(mixc(WARM, HOT, 0.25), YAO, s2);
    const I = lerp(2.1, 1.25, s2);
    const cur = this._crackCur;
    this.crack.forEach((P, i) => {
      const pts = P.pts, n = pts.length, out = cur[i];
      if (P.tgt) {
        const A0 = pts[0], B0 = pts[n - 1];
        const A = [lerp(A0[0], P.tgt[0][0], s2), lerp(A0[1], P.tgt[0][1], s2)];
        const B = [lerp(B0[0], P.tgt[1][0], s2), lerp(B0[1], P.tgt[1][1], s2)];
        for (let j = 0; j < n; j++) {
          const u = j / (n - 1);
          const rx = pts[j][0] - lerp(A0[0], B0[0], u), ry = pts[j][1] - lerp(A0[1], B0[1], u);
          out[j][0] = lerp(A[0], B[0], u) + (1 - s1) * rx;
          out[j][1] = lerp(A[1], B[1], u) + (1 - s1) * ry;
        }
      } else {
        // twig: follow the parent's current point, shrink into it
        const par = cur[P.parent], m = par.length;
        const f = clamp(P.frac, 0, 1) * (m - 1), j0 = Math.min(m - 2, Math.floor(f)), kk = f - j0;
        const bx = lerp(par[j0][0], par[j0 + 1][0], kk), by = lerp(par[j0][1], par[j0 + 1][1], kk);
        const b0 = pts[0];
        for (let j = 0; j < n; j++) { out[j][0] = bx + (pts[j][0] - b0[0]) * (1 - r); out[j][1] = by + (pts[j][1] - b0[1]) * (1 - r); }
      }
      if (!P.tgt && r >= 0.999) return;
      const a = P.tgt ? 1 : Math.pow(1 - r, 0.6);
      const wTarget = n1.w;
      for (let j = 0; j < n - 1; j++) {
        const u = (j + 0.5) / (n - 1);
        const wc = lerp(P.w0, P.w1, Math.pow(u, 0.7)) * 2.7;
        const w = P.tgt ? lerp(wc, wTarget, s2) : wc;
        const ii = (P.tgt ? I : I * P.glow);
        this.L(out[j][0], out[j][1], out[j + 1][0], out[j + 1][1], w, col, ii, a);
        // faint warm glow around the fresh crack
        if (s2 < 0.98) this.L(out[j][0], out[j][1], out[j + 1][0], out[j + 1][1], w * 4.5 + 3, crackCol, 0.05 * (1 - s2) * (P.tgt ? 1 : P.glow), a);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------- 131.5 the doubling
  drawLevels(t) {
    let n = 1, prog = -1, st = null;
    for (let i = 0; i < STEPS.length; i++) {
      const [t0, D] = STEPS[i];
      if (t >= t0) { if (t < t0 + D) { n = i + 1; prog = t - t0; st = STEPS[i]; } else n = i + 2; }
    }
    if (prog < 0) {   // a settled level
      const G = LV[n], N = 1 << n;
      for (let v = 0; v < N; v++) for (let k = 0; k < n; k++) {
        const b = yao(v, n, k);
        this.yaoLine(lvX(n, v), lvY(n, k), 1, 0, G.L, b ? 0 : G.g, G.w, YAO, 1.2 * this.noteFlash(t, n, v, k));
      }
      return;
    }
    // transition n → n+1
    const [t0, D] = st, A = LV[n], B = LV[n + 1], N2 = 2 << (n - 1) << 1 >> 1;
    const e1 = easeInOutCubic(sat(prog / (0.62 * D)));
    const L = lerp(A.L, B.L, e1), g = lerp(A.g, B.g, e1), w = lerp(A.w, B.w, e1);
    const NC = 1 << (n + 1);
    for (let c = 0; c < NC; c++) {
      const v = c >> 1;
      const x = lerp(lvX(n, v), lvX(n + 1, c), e1);
      for (let k = 0; k < n; k++) {
        const y = lerp(lvY(n, k), lvY(n + 1, k), e1);
        const b = yao(v, n, k);
        // the parent's lines are shared by both children at the start: draw the second copy only as it separates
        const a = (c & 1) ? sat(e1 * 6) : 1;
        this.yaoLine(x, y, 1, 0, L, b ? 0 : g, w, YAO, 1.2 * (k === n - 1 ? this.noteFlash(t, n, v, k) : 1), a);
      }
      // the new top line: buds from the current top line and slides up
      const ta = NOTE(n, c, t0, D);
      const e2 = easeOutCubic(sat((t - (ta - 0.24)) / 0.24));
      if (t < ta - 0.24) continue;
      const yTop = lerp(lvY(n, n - 1), lvY(n + 1, n - 1), e1);
      const y = lerp(yTop, lvY(n + 1, n), e2);
      const from = yao(v, n, n - 1) ? 0 : 1, to = (c & 1) ? 0 : 1;     // 1 = broken
      const gg = g * lerp(from, to, easeInOutCubic(sat((e2 - 0.15) / 0.7)));
      this.yaoLine(x, y, 1, 0, L, gg, w, YAO, 1.2 * (1 + 0.9 * Math.exp(-Math.max(0, t - ta) / 0.2) * (t >= ta ? 1 : 0)), sat(e2 * 3));
    }
  }
  // brightness accent for a line that just arrived (decays after its note)
  noteFlash(t, n, v, k) {
    if (k !== n - 1 || n < 2) return 1;
    const [t0, D] = STEPS[n - 2];
    const ta = NOTE(n - 1, v, t0, D);
    return t >= ta ? 1 + 0.9 * Math.exp(-(t - ta) / 0.2) : 1;
  }

  // ---------------------------------------------------------------------------------------------- 137 square, 138 circle, 143.5 digits
  drawDiagram(t) {
    const D = this.diag(t);
    const fade = 1 - ease(t, TAPE0, TAPE0 + 0.9);
    if (fade <= 0) return;
    const warmK = 1 - 0.45 * ease(t, FLIP0, MOVE[1]);
    const col = mixc(LINE, YAO, warmK);
    const sweep = t > CLIMAX ? 0.22 * Math.exp(-sq((t - 11.8) / 1.4)) : 0;
    const sweepX = lerp(500, 1450, ramp(t, 10.4, 13.2));
    const bloom = t > CLIMAX ? 0.55 * Math.exp(-(t - CLIMAX) / 1.1) : 0;
    const G6 = LV[6];
    // ---- the square: reshape the row of 64 into 8 × 8
    for (let v = 0; v < 64; v++) {
      const r = v >> 3, c = v & 7;
      const eA = ease(t, RESHAPE + 0.04 * r, RESHAPE + 0.04 * r + 0.62);
      const eB = ease(t, RESHAPE + 0.5 + 0.035 * Math.abs(r - 3.5), RESHAPE + 1.25 + 0.035 * Math.abs(r - 3.5));
      const [sx, sy] = this.sqCell(v);
      const x0 = lvX(6, v), y0 = YMID;
      const P = { x: lerp(x0, sx, eB), y: lerp(y0, sy, eA), ux: 0, uy: -1, s: lerp(G6.s, SQ_S, eB), len: () => lerp(G6.L, SQ_L, eB), gf: lerp(G6.g / G6.L, SQ_G / SQ_L, eB), w: lerp(G6.w, SQ_W, eB) };
      const flip = this.flipK(t, v);
      if (flip >= 1) continue;
      const Ps = this.scalePose(P, D);
      if (flip > 0) this.shrinkToDigits(v, Ps, flip, col, 1.15 * fade);
      else this.hexagram(v, Ps, col, 1.15 * fade * (1 + sweep * gauss((Ps.x - sweepX) / 260)));
    }
    if (t < RING0) return;
    // ---- copies fly along threads to the circle, in pairs (v, v + 32), closing at the top at CLIMAX
    for (let h = 0; h < 64; h++) {
      const v = h & 31, td = RING0 + v * RING_STEP;
      if (t < td) continue;
      const f = easeInOutCubic(sat((t - td) / RING_FLY));
      const A = this.sqPose(h), B = this.ringPose(h);
      const P = this.scalePose(this.lerpPose(A, B, f), D);
      const ta = td + RING_FLY;
      // thread
      const [cx0, cy0] = this.dp(A.x, A.y, D);
      const ta2 = t - ta;
      const thA = (f < 1 ? 0.2 : 0.2 * Math.exp(-ta2 / 0.55)) * fade;
      if (thA > 0.004) this.L(cx0, cy0, P.x, P.y, 0.7, LINE, thA);
      const flip = this.flipK(t, h);
      if (flip >= 1) continue;
      const arrive = t >= ta ? 1 + 0.8 * Math.exp(-ta2 / 0.25) : 1;
      const I = 1.2 * fade * arrive * (1 + bloom) * (1 + sweep * gauss((P.x - sweepX) / 260));
      if (flip > 0) this.shrinkToDigits(h, P, flip, col, I);
      else this.hexagram(h, P, col, I, sat(f * 5));
    }
    // ---- precision: guide circles drawn from the top, both ways, as the circle closes
    const gk = ease(t, CLIMAX - 0.45, CLIMAX + 0.9);
    if (gk > 0) {
      for (const [R, I] of [[R0 - 9, 0.2], [R0 + 5 * RS + 8, 0.2]]) {
        const n = 96, span = Math.PI * gk;
        for (const sgn of [-1, 1]) for (let i = 0; i < n; i++) {
          const a0 = Math.PI / 2 + sgn * span * i / n, a1 = Math.PI / 2 + sgn * span * (i + 1) / n;
          const [x0, y0] = this.dp(DCX + Math.cos(a0) * R, DCY - Math.sin(a0) * R, D);
          const [x1, y1] = this.dp(DCX + Math.cos(a1) * R, DCY - Math.sin(a1) * R, D);
          this.L(x0, y0, x1, y1, 0.75, LINE, I * fade);
        }
      }
      // 64 sector ticks on the outer guide
      for (let v = 0; v < 64; v++) {
        const a = ringAngle(v) + TAU / 128;
        const dd = Math.abs(((a - Math.PI / 2) % TAU + TAU + Math.PI) % TAU - Math.PI);
        if (dd > Math.PI * gk) continue;
        const R1 = R0 + 5 * RS + 8, R2 = R1 + 4;
        const [x0, y0] = this.dp(DCX + Math.cos(a) * R1, DCY - Math.sin(a) * R1, D);
        const [x1, y1] = this.dp(DCX + Math.cos(a) * R2, DCY - Math.sin(a) * R2, D);
        this.L(x0, y0, x1, y1, 0.7, LINE, 0.22 * fade);
      }
      // the square's frame
      const hs = 4 * SQ_D + 6, fr = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs], [-hs, -hs]];
      for (let i = 0; i < 4; i++) {
        const [x0, y0] = this.dp(DCX + fr[i][0], DCY + fr[i][1], D), [x1, y1] = this.dp(DCX + fr[i + 1][0], DCY + fr[i + 1][1], D);
        const k = sat(gk * 1.3 - 0.3);
        if (k > 0) this.L(x0, y0, lerp(x0, x1, k), lerp(y0, y1, k), 0.7, LINE, 0.16 * fade);
      }
    }
  }
  flipK(t, v) { return sat((t - (FLIP0 + v * FLIP_STEP)) / FLIP_DUR); }
  // the lines contract onto the digits they become (the digits themselves fade in, in updateText)
  shrinkToDigits(v, P, f, col, I) {
    const e = easeInOutCubic(sat(f / 0.75));
    const digitLen = 0.62 * 12.5 * (P.s / RS);
    const Q = { ...P, len: k => lerp(P.len(k), Math.min(P.len(k), digitLen), e), gf: lerp(P.gf, 0, e) };
    this.hexagram(v, Q, col, I * (1 + 0.6 * Math.sin(Math.PI * sat(f / 0.6))), 1 - smoothstep(0.45, 0.95, f));
  }

  // ---------------------------------------------------------------------------------------------- 145 the table
  drawTable(t) {
    const out = 1 - ease(t, TAPE0, TAPE0 + 0.7);
    const tape = ease(t, TAPE0, TAPE0 + 0.7);
    const I0 = 0.55;
    // rows that have arrived
    const arr = v => FLY0 + v * FLY_STEP + FLY_DUR;
    const rowsIn = v => t >= arr(v);
    let last = -1;
    for (let v = 0; v <= 32; v++) if (rowsIn(v)) last = v;
    if (last >= 0 && out > 0) {
      const yTop = TB_ROWY(0) - TB.rh / 2;
      const yAt = v => TB_ROWY(v) + TB.rh / 2;
      const grow = v => yAt(v - 1) + TB.rh * eout(t, arr(v), arr(v) + 0.15);
      const yEnd = r => grow(Math.min(last, r));
      // vertical rules to the right of each column while it holds small zeros: rows 0 .. 2^(5-j) - 1
      for (let j = 0; j < 5; j++) {
        const rmax = (1 << (5 - j)) - 1;
        const x = TB_COLX(j) + TB.cw / 2;
        this.L(x, yTop, x, yEnd(rmax), 0.75, LINE, I0 * out);
      }
      // the double rule
      const xd = TB_COLX(5) + TB.cw / 2 + 4;
      const yd = last >= 32 ? lerp(yEnd(32), TB_ROWY(33) + 8, eout(t, arr(32) + 0.1, arr(32) + 0.5)) : yEnd(32);
      this.L(xd, yTop, xd, yd, 0.75, LINE, I0 * out);
      this.L(xd + 3, yTop, xd + 3, yd, 0.75, LINE, I0 * out);
      // period rules under rows 1, 3, 7, 15, 31 across the significant columns
      for (let k = 1; k <= 5; k++) {
        const v = (1 << k) - 1;
        if (!rowsIn(v)) continue;
        const e = eout(t, arr(v), arr(v) + 0.3);
        const x0 = TB_COLX(6 - k) - TB.cw / 2, x1 = TB_COLX(5) + TB.cw / 2;
        this.L(x0, TB_ROWY(v) + TB.rh / 2, lerp(x0, x1, e), TB_ROWY(v) + TB.rh / 2, 0.75, LINE, I0 * out);
      }
      // the sums' rules (addition examples)
      const ak = ease(t, 17.4, 18.6) * out;
      if (ak > 0) for (const R of this.addRules) {
        this.L(R.x0, R.y, lerp(R.x0, R.x1, ak), R.y, 0.7, LINE, 0.45 * ak);
        this.L(R.xv, R.y0, R.xv, lerp(R.y0, R.y1, ak), 0.7, LINE, 0.4 * ak);
      }
    }
    // the numerals as holes once the table turns into tape
    if (tape > 0 && t < TAPE0 + 2.0) {
      // drawn by drawTape (positions shared)
    }
  }

  // ---------------------------------------------------------------------------------------------- 150 tape
  tapeX(t) { return lerp(TB_COLX(3) - 0.3 * TB.cw, TP.x1, ease(t, TAPE0 + 0.75, TAPE0 + 1.6)); }
  tapeOffset(t) { return t <= TAPE_RUN ? 0 : 1.2 * (Math.exp((t - TAPE_RUN) / 0.45) - 1); }
  tapeBits(f) {
    if (f < 0) return -1;
    if (f <= 32) return f & 31;
    if (f < 41) return 0;
    const b0 = (f - 41) * 5;
    if (b0 >= 1024) return 0;
    let code = 0;
    for (let c = 0; c < 5; c++) code |= (this.store[b0 + c] || 0) << (4 - c);
    return code;
  }
  drawTape(t) {
    const k = ease(t, TAPE0, TAPE0 + 0.7);                 // table → tape
    const P = TP.P, X = this.tapeX(t);
    const O = this.tapeOffset(t);
    const fade = 1 - ease(t, PCB0 + 0.2, PCB0 + 1.1);
    if (fade <= 0) return;
    const col = mixc(LINE, AI, 0.35 * ease(t, TAPE0 + 0.5, CRT0 + 1));
    const speed = t <= TAPE_RUN ? 0 : 1.2 / 0.45 * Math.exp((t - TAPE_RUN) / 0.45) * P;   // px / s
    const blur = Math.min(speed * 0.0035, 60);
    const yRead = 330;
    // edges
    const hw = 3.4375 * P;
    const eY0 = lerp(TB_ROWY(0) - TB.rh / 2, -40, k), eY1 = lerp(TB_ROWY(33) + 8, 860, k);
    const xL = lerp(TB_COLX(0) + TB.cw / 2, X - hw, k), xR = lerp(TB_COLX(5) + TB.cw / 2 + 5.5, X + hw, k);
    this.LL(xL, eY0, xL, eY1, 0.9, col, 0.55 * k * fade);
    this.LL(xR, eY0, xR, eY1, 0.9, col, 0.55 * k * fade);
    // frames
    const f0 = Math.max(0, Math.floor(O - 20)), f1 = Math.ceil(O + 60);
    for (let f = f0; f <= f1; f++) {
      const yT = TB_ROWY(0) + (f - O) * P;
      if (yT < -30 || yT > 840) continue;
      const fromTable = f <= 32;
      const y = fromTable ? lerp(TB_ROWY(f), yT, k) : yT;
      const appear = fromTable ? 1 : k;
      const code = this.tapeBits(f);
      const read = Math.exp(-sq((y - yRead) / 7)) * smoothstep(TAPE_RUN, TAPE_RUN + 0.3, t);
      // feed hole
      const fx = X + FEED_OFF * P;
      this.dot(fx, y, 2.9 * k, blur, col, (0.55 + 0.6 * read) * appear * fade);
      for (let c = 0; c < 5; c++) {
        if (!((code >> (4 - c)) & 1)) continue;
        const tx = X + CH_OFF[c] * P;
        const x = fromTable ? lerp(TB_COLX(c + 1), tx, k) : tx;
        const r = lerp(fromTable ? 1.2 : 0, 4.4, k);
        this.dot(x, y, r, blur, col, (1.05 + 1.6 * read) * appear * fade);
      }
    }
    // the reading head: a hairline across the tape, with brackets
    const hk = ease(t, TAPE_RUN - 0.2, TAPE_RUN + 0.4) * fade;
    if (hk > 0) {
      this.L(X - hw - 14, yRead, X - hw - 3, yRead, 0.8, col, 0.6 * hk);
      this.L(X + hw + 3, yRead, X + hw + 14, yRead, 0.8, col, 0.6 * hk);
      this.L(X - hw, yRead, X + hw, yRead, 0.5, col, 0.25 * hk);
    }
  }
  // a hole / dot, elongated vertically by motion blur within a sub-frame
  dot(x, y, r, blur, col, I) {
    if (r <= 0.05 || I <= 0) return;
    if (blur > 0.5) this.L(x, y - blur / 2, x, y + blur / 2, 2 * r, col, I * (2 * r) / (2 * r + blur), 1, 1);
    else this.L(x, y, x, y, 2 * r, col, I, 1, 1);
  }

  // ---------------------------------------------------------------------------------------------- 151.3 the Baby
  drawCRT(t) {
    const k = ease(t, CRT0, CRT0 + 0.7);
    const toChip = ease(t, PCB0, PCB0 + 0.9);
    const H = lerp(CRT.half, CHIP.half, toChip);
    const rad = lerp(34, 0, toChip);
    const col = mixc(mixc(LINE, AI, 0.45), AI, toChip);
    const fadeOut = 1 - ease(t, DIE0 + 0.1, DIE0 + 0.5);
    // face outline (rounded square), drawn on
    const pts = roundedRect(CRT.x, CRT.y, H, rad, 12);
    const n = pts.length - 1, upto = n * k;
    for (let i = 0; i < n; i++) {
      if (i >= upto) break;
      const u = Math.min(1, upto - i);
      this.L(pts[i][0], pts[i][1], lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u), 1.1, col, 0.8 * fadeOut);
    }
    // the store: bits written by the beam, line by line
    const pitch = lerp(CRT.pitch, (2 * CHIP.die) / 32, toChip);
    const tw0 = CRT0 + 0.35, tw1 = CRT0 + 1.55;
    const nb = Math.floor(1024 * ramp(t, tw0, tw1));
    for (let b = 0; b < Math.min(nb + 1, 1024); b++) {
      const r = b >> 5, c = b & 31;
      const x = CRT.x + (c - 15.5) * pitch, y = CRT.y + (r - 15.5) * pitch;
      const bit = this.store[b];
      const age = (t - lerp(tw0, tw1, b / 1024));
      if (age < 0) continue;
      const fl = 1 + 2.2 * Math.exp(-age / 0.06);
      const I = (bit ? 1.25 : 0.55) * fl * fadeOut;
      if (bit) { const hl = lerp(2.6, 0.45 * pitch * 0.5, toChip); this.L(x - hl, y, x + hl, y, lerp(1.9, 1.2, toChip), col, I); }
      else this.L(x, y, x, y, lerp(2.4, 1.1, toChip), col, I, 1, 1);
    }
    // the read line from the tape's head into the store
    const rk = win(t, CRT0 + 0.2, PCB0, 0.3, 0.4);
    if (rk > 0) {
      const xs = this.tapeX(t) + 3.4375 * TP.P + 16, xe = CRT.x - CRT.half - 6;
      this.L(xs, 330, xe, 330, 0.6, col, 0.35 * rk);
      const ph = (t * 3.2) % 1;
      for (let q = 0; q < 3; q++) { const u = (ph + q / 3) % 1; const x = lerp(xs, xe, u); this.L(x - 7, 330, x + 7, 330, 1.2, col, 0.9 * rk); }
    }
  }

  // ---------------------------------------------------------------------------------------------- 153 the board, 155 the die
  drawChip(t) {
    const col = AI;
    const fadeOut = 1 - ease(t, MIND0 + 0.2, MIND0 + 0.9);
    if (fadeOut <= 0) return;
    const grow = ease(t, PCB0 + 0.4, PCB0 + 1.8);
    const cx = CRT.x, cy = CRT.y;
    const zoom = this.cam.zoom;
    // pins
    const pk = ease(t, PCB0 + 0.5, PCB0 + 1.0);
    if (pk > 0) for (const tr of this.traces) {
      const [a, b] = tr.pts;
      this.L(cx + a[0], cy + a[1], cx + lerp(a[0], b[0], pk), cy + lerp(a[1], b[1], pk), 1.4, col, 0.8 * fadeOut);
    }
    // traces grow outward, with pulses travelling on them
    if (grow > 0) for (const tr of this.traces) {
      const Lg = tr.L * grow * (0.75 + 0.25 * tr.ph);
      polyline(tr.pts, tr.cum, 0, Lg, (x0, y0, x1, y1) => this.L(cx + x0, cy + y0, cx + x1, cy + y1, 0.9, col, 0.42 * fadeOut));
      // pulses
      const sp = 180 * tr.sp;
      for (let q = 0; q < 2; q++) {
        const s = ((t * sp + tr.ph * 900 + q * 450) % 900);
        if (s > Lg) continue;
        polyline(tr.pts, tr.cum, Math.max(0, s - 14), s, (x0, y0, x1, y1) => this.L(cx + x0, cy + y0, cx + x1, cy + y1, 1.6, col, 1.6 * fadeOut));
      }
    }
    // the die: bond wires, pads, a grid that reveals finer levels as we push in
    const dk = ease(t, PCB0 + 0.6, PCB0 + 1.4);
    if (dk <= 0) return;
    const d = CHIP.die;
    // die outline
    const dr = [[-d, -d], [d, -d], [d, d], [-d, d], [-d, -d]];
    for (let i = 0; i < 4; i++) this.L(cx + dr[i][0], cy + dr[i][1], cx + dr[i + 1][0], cy + dr[i + 1][1], 1.0, col, 0.7 * dk * fadeOut);
    // bond wires from pads to pins
    for (const tr of this.traces) {
      const [a] = tr.pts;
      const u = (tr.i - (CHIP.pins - 1) / 2) / CHIP.pins;
      const pad = tr.side === 0 ? [d - 3, u * 2 * d * 0.9] : tr.side === 1 ? [-(d - 3), -u * 2 * d * 0.9] : tr.side === 2 ? [u * 2 * d * 0.9, -(d - 3)] : [-u * 2 * d * 0.9, d - 3];
      this.L(cx + pad[0], cy + pad[1], cx + a[0] - Math.sign(a[0]) * 2 * (tr.side < 2 ? 1 : 0), cy + a[1] - Math.sign(a[1]) * 2 * (tr.side >= 2 ? 1 : 0), 0.5, col, 0.35 * dk * fadeOut);
      this.L(cx + pad[0], cy + pad[1], cx + pad[0], cy + pad[1], 2.2, col, 0.9 * dk * fadeOut, 1, 1);
    }
    // level grids: spacing in design px, visible when the on-screen spacing is comfortable
    const levels = [[d / 4, 0.55], [d / 16, 0.45], [d / 64, 0.38]];
    const vx0 = this.cam.cx - 980 / zoom, vx1 = this.cam.cx + 980 / zoom, vy0 = this.cam.cy - 420 / zoom, vy1 = this.cam.cy + 420 / zoom;
    for (const [sp, I] of levels) {
      const on = sp * zoom;
      const a = smoothstep(3.5, 9, on) * (1 - smoothstep(160, 400, on)) * dk * fadeOut;
      if (a <= 0.01) continue;
      const nLines = Math.round(2 * d / sp);
      for (let i = 0; i <= nLines; i++) {
        const o = -d + i * sp;
        const X = cx + o, Y = cy + o;
        if (X >= vx0 && X <= vx1) this.L(X, Math.max(cy - d, vy0), X, Math.min(cy + d, vy1), 0.6, col, I * a);
        if (Y >= vy0 && Y <= vy1) this.L(Math.max(cx - d, vx0), Y, Math.min(cx + d, vx1), Y, 0.6, col, I * a);
      }
      // pulses on this level's wires
      const np = 40;
      for (let q = 0; q < np; q++) {
        const h = hash1(q * 7.13 + sp), horiz = h < 0.5;
        const li = Math.floor(hash1(q * 3.7 + sp * 1.3) * (nLines + 1));
        const o = -d + li * sp;
        const s = ((t * (0.35 + 0.5 * hash1(q * 1.9)) * 2 * d + hash1(q * 5.3) * 2 * d) % (2 * d)) - d;
        const len = sp * 1.6;
        if (horiz) { const Y = cy + o; if (Y < vy0 || Y > vy1) continue; this.L(cx + s - len, Y, cx + s, Y, 1.3, col, 1.4 * a); }
        else { const X = cx + o; if (X < vx0 || X > vx1) continue; this.L(X, cy + s - len, X, cy + s, 1.3, col, 1.4 * a); }
      }
    }
    // the store's bits become the die's lit cells
    const cellP = 2 * d / 32;
    const ck = dk * fadeOut;
    for (let b = 0; b < 1024; b++) {
      if (!this.store[b]) continue;
      const r = b >> 5, c = b & 31;
      const X = cx - d + (c + 0.5) * cellP, Y = cy - d + (r + 0.5) * cellP;
      if (X < vx0 - cellP || X > vx1 + cellP || Y < vy0 - cellP || Y > vy1 + cellP) continue;
      const hs = cellP * 0.32;
      const on = cellP * zoom;
      const I = 0.9 * ck * (1 + 0.5 * Math.sin(t * 3 + b));
      if (on < 6) this.L(X - hs, Y, X + hs, Y, 1.2, col, I);
      else { const q = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs], [-hs, -hs]]; for (let i = 0; i < 4; i++) this.L(X + q[i][0], Y + q[i][1], X + q[i + 1][0], Y + q[i + 1][1], 0.9, col, I); }
    }
  }

  // ---------------------------------------------------------------------------------------------- 157 the mind
  drawMind(t) {
    // dolly-zoom away from the die (the die stays framed, the layers behind open up), then fly forward
    const cam = this.camera;
    const z0 = DIST / this.camera2D(MIND0).zoom;          // the die framing at the end of the push-in
    const H0 = 2 * z0 * Math.tan(THREE.MathUtils.degToRad(FOV0 / 2));
    const dz = ease(t, MIND0, MIND0 + 1.1);
    const fov = lerp(FOV0, 62, dz);
    let camZ = H0 / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    const fly = t > MIND0 + 0.9 ? Math.pow(t - (MIND0 + 0.9), 2.2) * 7.5 : 0;
    camZ -= fly;
    const cx = wx(CRT.x), cy = wy(CRT.y);
    cam.fov = fov;
    cam.position.set(cx + 0.15 * Math.sin(t * 0.7) * dz, cy + 0.1 * dz, camZ);
    cam.up.set(Math.sin(0.06 * fly * 0.1), 1, 0).normalize();
    cam.lookAt(cx, cy, camZ - 10);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.mindCam = { camZ };
    const k = ease(t, MIND0 + 0.2, MIND0 + 1.0);
    if (k <= 0) return;
    const col = AI;
    const pv = new THREE.Vector3();
    const projY = (x, y, z) => { pv.set(x, y, z).project(cam); return (1 - (pv.y * 0.5 + 0.5)) * 804; };
    for (const Lr of this.layers) {
      const z = Lr.z;
      if (z > camZ - 0.2) continue;
      const depth = camZ - z;
      const I0 = k * (1 - smoothstep(14, 30, depth)) * smoothstep(0.2, 1.5, depth);
      if (I0 <= 0.01) continue;
      const hs = Lr.pitch * 0.36;
      for (const c of Lr.cells) {
        const X = cx + c.x, Y = cy + c.y;
        const ys = projY(X, Y, z);
        const m = 1 - this.mask * smoothstep(560, 640, ys);
        const I = I0 * m * (c.lit ? 1.3 : 0.32);
        if (I <= 0.01) continue;
        const r = c.lit ? hs : hs * 0.8;
        const q = [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]];
        for (let i = 0; i < 4; i++) this.sl.seg(X + q[i][0], Y + q[i][1], z, X + q[i + 1][0], Y + q[i + 1][1], z, c.lit ? 1.0 : 0.7, col[0] * I, col[1] * I, col[2] * I, 1, 0);
      }
      // links from lit cells to the next layer (attention)
      for (const c of Lr.cells) {
        if (!c.lit || c.h < 0.965) continue;
        const X = cx + c.x, Y = cy + c.y;
        const I = 0.25 * I0;
        this.sl.seg(X, Y, z, X + (c.h - 0.98) * 40, Y + Math.sin(c.h * 50) * 0.8, z - 3.2, 0.6, col[0] * I, col[1] * I, col[2] * I, 1, 0);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- text
  updateText(t) {
    const tf = this.tf, H = this.hidden;
    const D = this.diag(t);
    const diagOn = t >= RING0 && t < TAPE0 + 1.2;
    const fadeDiag = 1 - ease(t, TAPE0, TAPE0 + 0.9);
    const warmText = mixc(WARM, LINE, 0.25);
    // names around the circle: appear as each copy lands, move with the diagram
    for (const N of this.names) {
      const it = this.items[N.i];
      if (!diagOn) { if (it.show !== H) tf.update(N.i, { show: H }); continue; }
      const v = N.v, ta = RING0 + (v & 31) * RING_STEP + RING_FLY;
      const th = ringAngle(v), c = Math.cos(th), s = Math.sin(th);
      const [x, y] = this.dp(DCX + c * N.r, DCY - s * N.r, D);
      // character up = outward; reading direction = clockwise tangent
      tf.update(N.i, { pos: [wx(x), wy(y), 0], ax: [s, -c, 0], ay: [c, s, 0], size: 12.5 * PX * D.s,
        show: [ta + 0.05, 1e6, 0.45, 0], intensity: 0.78 * fadeDiag, color: warmText });
    }
    // digits
    const flyOn = t >= FLY0 - 0.1;
    for (let v = 0; v < 64; v++) {
      const fv = FLIP0 + v * FLIP_STEP;
      const show = t >= fv && diagOn;
      // ring
      const R = this.ringPose(v);
      for (let k = 0; k < 6; k++) {
        const i = this.ringDig[v * 6 + k];
        if (!show) { if (this.items[i].show !== H) tf.update(i, { show: H }); continue; }
        const o = (k - 2.5) * RS;
        const [x, y] = this.dp(R.x + R.ux * o, R.y + R.uy * o, D);
        const ux = R.ux, uy = -R.uy;                         // to world (y up)
        tf.update(i, { pos: [wx(x), wy(y), 0], ax: [ux, uy, 0], ay: [-uy, ux, 0], size: 12.5 * PX * D.s,
          show: [fv + 0.1, 1e6, 0.16, 0], intensity: 1.05 * fadeDiag });
      }
      // square (numerals 0..32 later fly to the table)
      const [sx, sy] = this.sqCell(v);
      const flies = v <= 32;
      const d0 = FLY0 + v * FLY_STEP;
      const f = flies && flyOn ? easeInOutCubic(sat((t - d0) / FLY_DUR)) : 0;
      for (let k = 0; k < 6; k++) {
        const i = this.sqDig[v * 6 + k];
        const tableOn = flies && t < TAPE0 + 1.0;
        if (!show && !(tableOn && t >= d0)) { if (this.items[i].show !== H) tf.update(i, { show: H }); continue; }
        const o = (k - 2.5) * SQ_S;
        const [x0, y0] = this.dp(sx, sy - o, D);
        let x = x0, y = y0, ang = Math.PI / 2, size = 8.6 * D.s, I = 1.0 * fadeDiag;
        if (flies && f > 0) {
          const big = (v === 0 && k === 5) || (v > 0 && k >= 6 - (v.toString(2).length));
          const x1 = TB_COLX(k), y1 = TB_ROWY(v);
          x = lerp(x0, x1, f); y = lerp(y0, y1, f) - 34 * Math.sin(Math.PI * f);
          ang = lerp(Math.PI / 2, 0, f);
          size = lerp(size, big ? TB.em : TB.emSmall, f);
          I = lerp(I, big ? 1.0 : 0.62, f);
          if (t >= TAPE0) {
            // into the tape: the 1s become holes (drawTape), the rest fade
            const kk = ease(t, TAPE0, TAPE0 + 0.6);
            I *= 1 - kk;
          }
        }
        const ca = Math.cos(ang), sa = Math.sin(ang);
        tf.update(i, { pos: [wx(x), wy(y), 0], ax: [ca, sa, 0], ay: [-sa, ca, 0], size: size * PX,
          show: [fv + 0.1, 1e6, 0.16, 0], intensity: I });
      }
    }
    // table furniture
    const tOut = 1 - ease(t, TAPE0, TAPE0 + 0.6);
    const tabOn = t >= MOVE[0] && t < TAPE0 + 1.0;
    this.tbHead.forEach(i => tf.update(i, { show: tabOn ? [15.6, 1e6, 0.7, 0] : H, intensity: (i === this.tbHead[0] ? 0.95 : 0.85) * tOut }));
    this.tbDec.forEach((i, v) => tf.update(i, { show: tabOn ? [FLY0 + v * FLY_STEP + FLY_DUR - 0.05, 1e6, 0.3, 0] : H, intensity: 0.9 * tOut }));
    tf.update(this.tbEtc, { show: tabOn ? [FLY0 + 32 * FLY_STEP + FLY_DUR + 0.25, 1e6, 0.5, 0] : H, intensity: 0.85 * tOut });
    const aOut = 1 - ease(t, TAPE0, TAPE0 + 0.7);
    this.addText.forEach((i, j) => {
      const t0 = j < 2 ? 16.9 + 0.25 * j : 17.4 + 0.12 * (j - 2);
      tf.update(i, { show: tabOn ? [t0, 1e6, 0.5, 0] : H, intensity: (j < 2 ? 0.8 : 0.85) * aOut });
    });
    // mind numbers
    const mk = ease(t, MIND0 + 0.4, MIND0 + 1.2);
    for (const M of this.mindNum) {
      if (mk <= 0) { if (this.items[M.i].show !== H) tf.update(M.i, { show: H }); continue; }
      const camZ = this.mindCam ? this.mindCam.camZ : 10;
      const depth = camZ - M.L.z;
      const I = 0.85 * mk * (1 - smoothstep(10, 22, depth)) * smoothstep(0.3, 1.5, depth);
      tf.update(M.i, { pos: [wx(CRT.x) + M.c.x + 0.07, wy(CRT.y) + M.c.y, M.L.z], show: [-1e6, 1e6, 0, 0], intensity: I });
    }
  }

  dispose() { this.sl.dispose(); this.tf.dispose(); }
}

// ------------------------------------------------------------------------------------------------ helpers
function sq(x) { return x * x; }
function gauss(x) { return Math.exp(-x * x); }
function roundedRect(cx, cy, h, r, seg) {
  const pts = [];
  const corners = [[h - r, -(h - r), -Math.PI / 2], [h - r, h - r, 0], [-(h - r), h - r, Math.PI / 2], [-(h - r), -(h - r), Math.PI]];
  // start at the top centre, clockwise on screen (y down)
  pts.push([cx, cy - h]);
  for (const [ox, oy, a0] of corners) for (let i = 0; i <= seg; i++) {
    const a = a0 + (Math.PI / 2) * i / seg;
    pts.push([cx + ox + Math.cos(a) * r, cy + oy + Math.sin(a) * r]);
  }
  pts.push([cx, cy - h]);
  return pts;
}
// emit the sub-polyline between arc lengths s0 and s1
function polyline(pts, cum, s0, s1, emit) {
  for (let i = 1; i < pts.length; i++) {
    const a = cum[i - 1], b = cum[i];
    if (b <= s0) continue;
    if (a >= s1) break;
    const u0 = Math.max(0, (s0 - a) / (b - a)), u1 = Math.min(1, (s1 - a) / (b - a));
    const P = pts[i - 1], Q = pts[i];
    emit(P[0] + (Q[0] - P[0]) * u0, P[1] + (Q[1] - P[1]) * u0, P[0] + (Q[0] - P[0]) * u1, P[1] + (Q[1] - P[1]) * u1);
  }
}
