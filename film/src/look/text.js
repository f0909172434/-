// TextField: text as data. Tens of thousands of strings drawn as ONE merged, non-instanced quad mesh
// (SwiftShader pays ~20 µs per instance, so instancing is out), sampling a glyph atlas built once with
// Canvas 2D. Every string is a pure function of uTime on the GPU: it can drift, flow along a path,
// type itself out, fade in and out, change colour, and go out of focus.
//
//   import { TextField, FONT } from '../look/text.js';
//   const tf = new TextField(ctx, { px: 48, atlasSize: 4096, focus: 12, aperture: 0.5 });
//   await tf.prepare(items);          // init(): loads the fonts, draws every glyph the items need
//   tf.set(items);                    // builds the mesh (sync; fine per frame for a few thousand glyphs)
//   scene.add(tf.mesh);
//   // update(shot, t):
//   tf.uniforms.uTime.value = t;      // all motion below is a function of this
//   tf.cull(camera, t, Math.round(T * 24));   // optional, big fields: frustum / LOD culling once per frame
//
// Item (one string; '\n' makes a multi-line block):
//   text        the string
//   font        FONT key ('sans' | 'latin' | 'serif' | 'mono' | 'type' | 'script' | 'kai' | 'garamond' | 'cormorant')
//               or { family, weight, style }. Japanese, Korean, Arabic, Hebrew, Devanagari and Thai pick their
//               Noto face automatically; mixed or complex scripts are drawn as one shaped image ("strip").
//   weight      override the font weight
//   size        world units per em (default 0.1)
//   anchor      [ax, ay] point of the text block placed at the origin: ax 0 = left … 1 = right, ay 0 = bottom … 1 = top
//               (default [0.5, 0.5], the centre). Fixed once set (update() cannot change it).
//   tracking    extra advance in em (default 0)        lineHeight  em between lines / columns (default 1.5)
//   vertical    top-to-bottom CJK columns (lines become columns, right to left)
//   strip       force one shaped image per line (automatic for Arabic, Hebrew, Indic, Thai, combining marks)
//   placement, one of:
//     pos [x,y,z] + ax [1,0,0] + ay [0,1,0]   a plane in the mesh's space (ax = reading direction, ay = up)
//     pos + billboard: true                   always faces the camera   (billboard: 'upright' keeps world up)
//     path i + s + off [up, normal]           follows path i (see setPaths): s = arc length of the string's origin,
//                                             off = offset along the path's text-up and normal vectors
//   vel [x,y,z]   drift (world units / s)       speed   flow along the path (world units / s)   wrap  loop on the path
//   color (THREE.Color | [r,g,b], linear), intensity, alpha
//   color2, intensity2, alpha2, mix: [t0, t1]  cross-fade to a second colour / alpha between t0 and t1
//   show: [t0, t1, fadeIn, fadeOut]             visibility window
//   reveal: [t0, t1]                            types itself out: first glyph at t0, last at t1 (strips sweep)
// Faces are double-sided: a plane seen from behind reads mirrored, so orient ax/ay (or the path) toward the camera.
//
// Depth of field (uFocus, uAperture: same circle-of-confusion model as SoftPoints and FLines) is energy
// conserving: mild defocus samples the atlas mip chain; strong defocus becomes the glyph's (or, off a
// path, the whole string's) analytic blurred box, so far-out-of-focus text turns into soft bars of light.
// Text smaller than lodPx (2.6 px per em at 804p) is drawn the same way, as one faint bar per string.
//
// Cost on SwiftShader (1920×804): ~0.13 µs per vertex (4 per glyph; cull() removes hidden / off-screen strings
// and sends one quad for barred ones) plus covered pixels at ~40 Mpx/s (additive HalfFloat blending). In a
// 20k-string test, 135k drawn glyphs cost ~0.25 s sharp. Big near strings and strong defocus are what get
// expensive: keep those to a few hundred and fade the rest with uFade [near0, near1, far0, far1].
import * as THREE from '../../vendor/three.module.js';

export const FONT = {
  sans: { family: 'NotoSansTC', weight: 300 },        // the present: chat, questions (multilingual fallbacks)
  latin: { family: 'NotoSans', weight: 300 },         // Latin / Cyrillic / Greek first
  serif: { family: 'NotoSerifTC', weight: 300 },      // AI voice, woodblock print (Ming / Song style)
  mono: { family: 'JBMono', weight: 300 },            // tokens, vectors, e-mail headers, timestamps
  type: { family: 'CourierPrime', weight: 400 },      // typewriter, telegrams
  script: { family: 'PinyonScript', weight: 400 },    // 19th-century copperplate handwriting
  kai: { family: 'LXGWWenKaiTC', weight: 300 },       // brush handwriting (letters, temple slips)
  garamond: { family: 'EBGaramond', weight: 400 },    // 1703 print (Leibniz)
  cormorant: { family: 'Cormorant', weight: 400 },
};
const BASE_FALLBACK = ['NotoSansTC', 'NotoSans'];

// script detection: [regex, Noto family, needs shaping (strip), right-to-left]
const SCRIPTS = [
  [/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/, 'NotoSansArabic', true, true],
  [/[֐-׿יִ-ﭏ]/, 'NotoSansHebrew', true, true],
  [/[ऀ-ॿ]/, 'NotoSansDevanagari', true, false],
  [/[฀-๿]/, 'NotoSansThai', true, false],
  [/[぀-ヿㇰ-ㇿ]/, 'NotoSansJP', false, false],
  [/[가-힯ᄀ-ᇿ㄰-㆏]/, 'NotoSansKR', false, false],
];
const COMBINING = /[̀-ͯ᪰-᫿⃐-⃿]/;
const VERT_PUNCT = '，。、．：；！？';

function resolveFont(item) {
  const f = typeof item.font === 'object' && item.font ? item.font : (FONT[item.font || 'sans'] || { family: item.font, weight: 400 });
  const text = item.text || '';
  let script = null;
  for (const s of SCRIPTS) if (s[0].test(text)) { script = s; break; }
  const families = [f.family];
  if (script && !families.includes(script[1])) families.push(script[1]);
  for (const b of BASE_FALLBACK) if (!families.includes(b)) families.push(b);
  const weight = item.weight ?? f.weight ?? 400, style = f.style || 'normal';
  const strip = item.strip ?? !!((script && script[2]) || COMBINING.test(text));
  const rtl = !!(script && script[3]);
  const stack = families.map(n => `"${n}"`).join(', ');
  return { families, weight, style, stack, strip, rtl, key: `${style}|${weight}|${stack}` };
}

// ------------------------------------------------------------------------------------------- atlas
export class GlyphAtlas {
  // px: texels per em. pad: texels of empty margin around every glyph (mip blur and defocus need it).
  constructor({ size = 4096, px = 48, pad = Math.round(px * 0.25) } = {}) {
    this.S = size; this.px = px; this.pad = pad;
    this.canvas = document.createElement('canvas');
    this.canvas.width = size; this.canvas.height = size;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
    this.data = new Uint8Array(size * size);
    this.texture = new THREE.DataTexture(this.data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.LinearMipmapLinearFilter; this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true; this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
    this.entries = new Map(); this.layouts = new Map(); this.metrics = new Map(); this.loaded = new Set();
    this.shelfX = 0; this.shelfY = 0; this.shelfH = 0;
    this.pending = [];               // entries drawn but not yet read back
    this.dirty = [size, 0];          // row range to read back
  }

  // Load every font face the items need (all families of each fallback stack, with the exact characters).
  async load(items) {
    const want = new Map();
    for (const it of items) {
      const f = resolveFont(it);
      for (const fam of f.families) {
        const k = `${f.style} ${f.weight} ${this.px}px "${fam}"`;
        if (!want.has(k)) want.set(k, new Set());
        const set = want.get(k);
        for (const ch of it.text || '') set.add(ch);
      }
    }
    await Promise.all([...want].map(([spec, chars]) => {
      const sample = [...chars].join('');
      const key = spec + '|' + sample;
      if (this.loaded.has(key)) return null;
      this.loaded.add(key);
      return document.fonts.load(spec, sample || 'A').catch(() => null);
    }));
  }

  _font(f) { this.g.font = `${f.style} ${f.weight} ${this.px}px ${f.stack}`; }

  fontMetrics(f) {
    let m = this.metrics.get(f.key);
    if (!m) {
      this._font(f);
      const t = this.g.measureText('永M');
      const asc = (t.fontBoundingBoxAscent ?? this.px * 0.88) / this.px, desc = (t.fontBoundingBoxDescent ?? this.px * 0.12) / this.px;
      // CJK em box: 0.88 up / 0.12 down in Noto CJK; use it for vertical cells
      m = { asc, desc, emAsc: 0.88, emDesc: 0.12 };
      this.metrics.set(f.key, m);
    }
    return m;
  }

  _alloc(w, h) {
    if (w > this.S) throw new Error(`GlyphAtlas: entry ${w}px wider than the atlas`);
    if (this.shelfX + w > this.S) { this.shelfY += this.shelfH; this.shelfX = 0; this.shelfH = 0; }
    if (this.shelfY + h > this.S) throw new Error(`GlyphAtlas: full (${this.S}², ${this.entries.size} entries); use a bigger atlas or a smaller px`);
    const x = this.shelfX, y = this.shelfY;
    this.shelfX += w; this.shelfH = Math.max(this.shelfH, h);
    return [x, y];
  }

  // Draw `str` (a glyph or a whole shaped line) into a fresh cell. Returns the entry.
  // Lines too wide for the atlas are drawn at a smaller pixel size (same em metrics, fewer texels).
  _draw(f, str, rtl) {
    const g = this.g, P = this.pad + 1;
    let px = this.px;
    this._font(f);
    g.direction = rtl ? 'rtl' : 'ltr'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.letterSpacing = '0px';
    let m = g.measureText(str);
    const full = Math.ceil(m.actualBoundingBoxLeft) + Math.ceil(m.actualBoundingBoxRight) + 2 * P;
    if (full > this.S) {
      px = Math.floor(this.px * (this.S - 2 * P - 4) / (full - 2 * P));
      g.font = `${f.style} ${f.weight} ${px}px ${f.stack}`;
      m = g.measureText(str);
    }
    const adv = m.width / px;
    const bl = Math.ceil(m.actualBoundingBoxLeft), br = Math.ceil(m.actualBoundingBoxRight);
    const ba = Math.ceil(m.actualBoundingBoxAscent), bd = Math.ceil(m.actualBoundingBoxDescent);
    const e = { adv, ink: bl + br > 0 && ba + bd > 0, px };
    if (!e.ink) return e;
    const cw = bl + br + 2 * P, ch = ba + bd + 2 * P;
    const [cx, cy] = this._alloc(cw, ch);
    const ox = cx + P + bl, oy = cy + P + ba;     // pen origin in texels (integer aligned)
    g.fillStyle = '#fff'; g.fillText(str, ox, oy);
    const S = this.S;
    e.box = [-m.actualBoundingBoxLeft / px, -m.actualBoundingBoxDescent / px, m.actualBoundingBoxRight / px, m.actualBoundingBoxAscent / px];
    e.mask = [(cx - ox) / px, (oy - (cy + ch)) / px, (cx + cw - ox) / px, (oy - cy) / px];
    e.uv = [cx / S, (cy + ch) / S, (cx + cw) / S, cy / S];
    e.cell = [cx, cy, cw, ch];
    e.den = 0.5;
    this.pending.push(e);
    this.dirty[0] = Math.min(this.dirty[0], cy); this.dirty[1] = Math.max(this.dirty[1], cy + ch);
    return e;
  }

  glyph(f, ch) {
    const k = f.key + '\u0001' + ch;
    let e = this.entries.get(k);
    if (!e) { e = this._draw(f, ch, false); this.entries.set(k, e); }
    return e;
  }

  strip(f, str, rtl) {
    const k = f.key + '\u0002' + (rtl ? 'r' : 'l') + str;
    let e = this.entries.get(k);
    if (!e) { e = this._draw(f, str, rtl); this.entries.set(k, e); }
    return e;
  }

  // Read new cells back into the R8 texture data and measure each glyph's ink density.
  flush() {
    if (!this.pending.length) return false;
    const S = this.S, y0 = this.dirty[0], y1 = this.dirty[1];
    const img = this.g.getImageData(0, y0, S, y1 - y0).data;
    for (let y = y0; y < y1; y++) {
      const row = (y - y0) * S * 4, out = y * S;
      for (let x = 0; x < S; x++) this.data[out + x] = img[row + x * 4 + 3];
    }
    for (const e of this.pending) {
      const px2 = e.px * e.px;
      const [cx, cy, cw, ch] = e.cell;
      let sum = 0;
      for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) sum += this.data[y * S + x];
      const area = Math.max((e.box[2] - e.box[0]) * (e.box[3] - e.box[1]) * px2, 1);
      e.den = Math.min(1, sum / 255 / area);
    }
    this.pending.length = 0; this.dirty = [S, 0];
    this.texture.needsUpdate = true;
    return true;
  }

  // Layout of one item (cached): quads relative to the pen origin, in em.
  layout(item) {
    const f = resolveFont(item);
    const vertical = !!item.vertical, tracking = item.tracking ?? 0, lh = item.lineHeight ?? 1.5;
    const text = item.text ?? '';
    const key = `${f.key}|${vertical ? 1 : 0}|${tracking}|${lh}|${f.strip ? 1 : 0}|${text}`;
    let L = this.layouts.get(key);
    if (L) return L;
    const m = this.fontMetrics(f);
    const lines = text.split('\n');
    const quads = [];
    let width = 0, nGlyph = 0;
    const total = [...text.replace(/\n/g, '')].length;
    const ordOf = i => total > 1 ? i / (total - 1) : 0;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    const addQuad = (e, px0, py0, x0, x1, ordL, ordR, maskX0, maskX1) => {
      // e: atlas entry; (px0, py0): pen; [x0, x1]: horizontal slice of the entry's box (strips are sliced)
      const box = [px0 + x0, py0 + e.box[1], px0 + x1, py0 + e.box[3]];
      const mx0 = maskX0 ?? e.mask[0], mx1 = maskX1 ?? e.mask[2];
      const mask = [px0 + mx0, py0 + e.mask[1], px0 + mx1, py0 + e.mask[3]];
      const mw = e.mask[2] - e.mask[0];
      const u0 = e.uv[0] + (e.uv[2] - e.uv[0]) * (mx0 - e.mask[0]) / mw, u1 = e.uv[0] + (e.uv[2] - e.uv[0]) * (mx1 - e.mask[0]) / mw;
      quads.push({ box, mask, uv: [u0, e.uv[1], u1, e.uv[3]], e, ordL, ordR });
      bx0 = Math.min(bx0, box[0]); by0 = Math.min(by0, box[1]); bx1 = Math.max(bx1, box[2]); by1 = Math.max(by1, box[3]);
    };
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (f.strip && !vertical) {
        const e = this.strip(f, line, f.rtl);
        const py = -li * lh;
        if (e.ink) {
          // slice into ~1.5 em chunks so defocus and path bending stay local
          const x0 = e.box[0], x1 = e.box[2], n = Math.max(1, Math.ceil((x1 - x0) / 1.5));
          const n0 = nGlyph, nl = [...line].length;
          for (let j = 0; j < n; j++) {
            const xa = x0 + (x1 - x0) * j / n, xb = x0 + (x1 - x0) * (j + 1) / n;
            const ua = (xa - x0) / (x1 - x0), ub = (xb - x0) / (x1 - x0);
            const oa = f.rtl ? 1 - ua : ua, ob = f.rtl ? 1 - ub : ub;
            const g0 = ordOf(n0), g1 = ordOf(n0 + nl - 1);
            addQuad(e, 0, py, xa, xb, g0 + (g1 - g0) * oa, g0 + (g1 - g0) * ob, j === 0 ? e.mask[0] : xa, j === n - 1 ? e.mask[2] : xb);
          }
        }
        nGlyph += [...line].length;
        width = Math.max(width, e.adv);
        continue;
      }
      const chars = [...line];
      if (vertical) {
        const colX = -li * lh, adv = 1 + tracking;
        chars.forEach((ch, j) => {
          const e = this.glyph(f, ch);
          if (e.ink) {
            let px0 = colX - e.adv / 2, py0 = -j * adv - m.emAsc;
            if (VERT_PUNCT.includes(ch)) { px0 += 0.55; py0 += 0.62; }
            addQuad(e, px0, py0, e.box[0], e.box[2], ordOf(nGlyph), ordOf(nGlyph));
          }
          nGlyph++;
        });
        width = Math.max(width, chars.length * adv);
        continue;
      }
      // horizontal glyph run: pen positions from prefix widths (keeps the font's kerning)
      this._font(f); this.g.direction = 'ltr'; this.g.letterSpacing = '0px';
      let prefix = '';
      const py = -li * lh;
      chars.forEach((ch, j) => {
        const penX = this.g.measureText(prefix).width / this.px + j * tracking;
        const e = this.glyph(f, ch);
        if (e.ink) addQuad(e, penX, py, e.box[0], e.box[2], ordOf(nGlyph), ordOf(nGlyph));
        prefix += ch; nGlyph++;
      });
      width = Math.max(width, this.g.measureText(line).width / this.px + Math.max(0, chars.length - 1) * tracking);
    }
    // block extents for anchoring
    const nl = lines.length;
    let ext;
    if (vertical) {
      const longest = Math.max(...lines.map(l => [...l].length)) * (1 + tracking);
      ext = [-(nl - 1) * lh - 0.5, -longest, 0.5, 0];
    } else ext = [0, -(nl - 1) * lh - m.desc, width, m.asc];
    L = { quads, width, ext, ink: quads.length ? [bx0, by0, bx1, by1] : [0, 0, 0, 0], rtl: f.rtl, nGlyph, den: -1 };
    this.layouts.set(key, L);
    return L;
  }
}

// ------------------------------------------------------------------------------------------- shaders
const SPT = 10;    // texels of string data per string
const SW = 2048;   // string data texture width

const VERT = /* glsl */`
precision highp float;
precision highp sampler2D;
uniform sampler2D uStr;
uniform sampler2D uPath;
uniform int uPathN;
uniform float uTime, uPxScale, uResY, uFocus, uAperture, uMaxBlur, uPadEm, uRevealSoft, uOpacity, uLodPx;
uniform vec4 uFade;
uniform vec3 uTint;
in vec4 aMask;
in vec4 aUV;
in vec4 aBox;
in float aS;                 // string index (+0.5 on the string's first quad)
// position = (ink density, reveal order at box left, reveal order at box right)
flat out vec4 vMask;
flat out vec4 vUV;
flat out vec4 vBox;
flat out float vBias;
flat out float vW;
flat out float vBar;
flat out float vDen;
out vec2 vLocal;
out vec3 vCol;
out float vRev;

int sIdx;
vec4 SD(int k) { int i = sIdx * ${SPT} + k; return texelFetch(uStr, ivec2(i % ${SW}, i / ${SW}), 0); }
float win(float t, float a, float f) { if (f <= 0.0) return step(a, t); float s = clamp((t - a) / f, 0.0, 1.0); return s * s * (3.0 - 2.0 * s); }

void pathEval(int p, float L, float s, float wrap, out vec3 P, out vec3 T, out vec3 U) {
  float n1 = float(uPathN - 1);
  float f = s / L * n1;
  if (wrap > 0.5) f = mod(f, n1);
  float fc = clamp(f, 0.0, n1 - 1e-3);
  int i0 = int(fc); float k = fc - float(i0);
  vec3 p0 = texelFetch(uPath, ivec2(2 * i0, p), 0).xyz;
  vec3 p1 = texelFetch(uPath, ivec2(2 * i0 + 2, p), 0).xyz;
  vec3 u0 = texelFetch(uPath, ivec2(2 * i0 + 1, p), 0).xyz;
  vec3 u1 = texelFetch(uPath, ivec2(2 * i0 + 3, p), 0).xyz;
  T = normalize(p1 - p0);
  P = mix(p0, p1, k) + T * (f - fc) * (L / n1);   // straight extrapolation past the ends
  U = normalize(mix(u0, u1, k));
}

// view-space position of the local point l (em) of the current string
vec3 viewPos(vec2 l, vec4 s0, vec4 s1, vec4 s2, vec4 s3) {
  float kind = s1.w, size = s0.w, t = uTime;
  if (kind > 2.5) {
    vec3 P, T, U;
    pathEval(int(s3.x + 0.5), s3.y, s0.x + s3.z * t + l.x * size, s3.w, P, T, U);
    vec3 w = P + U * (s0.y + l.y * size) + cross(T, U) * s0.z;
    return (modelViewMatrix * vec4(w, 1.0)).xyz;
  }
  vec3 o = s0.xyz + s3.xyz * t;
  if (kind < 0.5) return (modelViewMatrix * vec4(o + (s1.xyz * l.x + s2.xyz * l.y) * size, 1.0)).xyz;
  vec3 c = (modelViewMatrix * vec4(o, 1.0)).xyz;
  if (kind < 1.5) return c + vec3(l * size, 0.0);
  vec3 up = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 rt = normalize(cross(up, normalize(-c)));
  return c + (rt * l.x + up * l.y) * size;
}

// pixels per em and blur (circle of confusion, px) at view position v
void blurAt(vec3 v, float size, out float emPx, out float wPx, out float z) {
  z = -v.z;
  vec4 clip = projectionMatrix * vec4(v, 1.0);
  emPx = size * projectionMatrix[1][1] * 0.5 * uResY / max(clip.w, 1e-4);
  float coc = uAperture * abs(z - uFocus) / max(z, 1e-3) * uPxScale * 100.0;
  wPx = min(coc, uMaxBlur * uPxScale);
}

void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); vRev = 0.0; }

void main() {
  sIdx = int(aS);
  bool first = fract(aS) > 0.25;
  float t = uTime;
  // timing and colour first, so hidden strings cost as little as possible
  vec4 s6 = SD(6), s7 = SD(7);
  float vis = win(t, s6.z, s7.x) * (1.0 - win(t, s6.w - s7.y, s7.y));
  if (vis <= 0.0) { cull(); return; }
  vec4 s4 = SD(4), s5 = SD(5);
  vec4 col = mix(s4, s5, win(t, s6.x, s6.y - s6.x));
  float alpha = col.a * vis * uOpacity;
  if (alpha <= 1e-5) { cull(); return; }
  vec4 s0 = SD(0), s1 = SD(1), s2 = SD(2), s3 = SD(3), s8 = SD(8), s9 = SD(9);
  bool onPath = s1.w > 2.5;
  // blur and level of detail are decided per string (per glyph on paths, which bend through depth)
  vec2 lc = onPath ? 0.5 * (aBox.xy + aBox.zw) : 0.5 * (s8.xy + s8.zw);
  vec3 vc = viewPos(lc, s0, s1, s2, s3);
  float emPx, wPx, z;
  blurAt(vc, s0.w, emPx, wPx, z);
  float fade = (uFade.y > 0.0 ? smoothstep(uFade.x, uFade.y, z) : step(1e-3, z)) * (uFade.w > 0.0 ? 1.0 - smoothstep(uFade.z, uFade.w, z) : 1.0);
  if (alpha * fade <= 1e-5 || z <= 1e-3) { cull(); return; }
  float wEm = wPx / max(emPx, 1e-5);
  float bar = smoothstep(0.5 * uPadEm, uPadEm, 0.5 * wEm);
  vec4 box = aBox;
  float den = position.x, oL = position.y, oR = position.z;
  if (!onPath && (bar > 0.999 || emPx < uLodPx)) {
    // the whole string as one (blurred) bar, drawn by its first quad: far-out-of-focus or too small to read
    if (!first) { cull(); return; }
    box = s8; den = s9.x; bar = 1.0;
    wEm = max(wEm, 0.35);
    oL = s9.y > 0.5 ? 1.0 : 0.0; oR = 1.0 - oL;
  }
  // quad = ink box + the blur's reach (+1 px for filtering), never more than the atlas padding unless barred
  float e = max(1.0 / max(emPx, 1e-3), 0.6 * wEm);
  if (bar < 0.001) e = min(e, uPadEm);
  vec2 k = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 l = mix(box.xy - e, box.zw + e, k);
  vec3 vp = viewPos(l, s0, s1, s2, s3);
  gl_Position = projectionMatrix * vec4(vp, 1.0);
  vLocal = l;
  vMask = aMask; vUV = aUV; vBox = box; vDen = den;
  vBias = log2(max(wPx, 1.0)); vW = max(wEm, 1e-4); vBar = bar;
  vCol = col.rgb * alpha * fade * uTint;
  float ord = mix(oL, oR, clamp((l.x - box.x) / max(box.z - box.x, 1e-5), -0.5, 1.5));
  vRev = (t - mix(s7.z, s7.w, ord)) / max(uRevealSoft, 1e-4);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uAtlas;
flat in vec4 vMask;
flat in vec4 vUV;
flat in vec4 vBox;
flat in float vBias;
flat in float vW;
flat in float vBar;
flat in float vDen;
in vec2 vLocal;
in vec3 vCol;
in float vRev;
out vec4 fragColor;
void main() {
  float rev = clamp(vRev, 0.0, 1.0);
  vec2 q = (vLocal - vMask.xy) / (vMask.zw - vMask.xy);
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  float cov = texture(uAtlas, mix(vUV.xy, vUV.zw, clamp(q, 0.0, 1.0)), vBias).r * inside * (1.0 - vBar);
  if (vBar > 0.001) {
    vec2 g = smoothstep(-0.5, 0.5, (vLocal - vBox.xy) / vW) - smoothstep(-0.5, 0.5, (vLocal - vBox.zw) / vW);
    cov += vBar * vDen * g.x * g.y;
  }
  cov *= rev;
  if (cov < 0.0015) discard;
  fragColor = vec4(vCol * cov, 1.0);
}`;

// ------------------------------------------------------------------------------------------- field
const toRGB = c => c == null ? null : Array.isArray(c) ? c : [c.r, c.g, c.b];
const ATTRS = [['position', 3], ['aMask', 4], ['aUV', 4], ['aBox', 4], ['aS', 1]];
const _m4 = new THREE.Matrix4();

export class TextField {
  // ctx: the scene ctx ({ width, height }) or { resolution: [w, h] } in opts.
  constructor(ctx, { px = 48, atlasSize = 4096, pad, atlas = null, focus = 10, aperture = 0, maxBlur = 40, fade = [0, 0, 0, 0],
    revealSoft = 0.06, opacity = 1, depthTest = true, anisotropy = 1, resolution = null, lodPx = 2.6 } = {}) {
    const W = resolution ? resolution[0] : ctx.width, H = resolution ? resolution[1] : ctx.height;
    this.atlas = atlas || new GlyphAtlas({ size: atlasSize, px, pad });
    if (ctx && ctx.renderer && anisotropy > 1) this.atlas.texture.anisotropy = Math.min(anisotropy, ctx.renderer.capabilities.getMaxAnisotropy());
    this.uniforms = {
      uAtlas: { value: this.atlas.texture },
      uStr: { value: null }, uPath: { value: null }, uPathN: { value: 2 },
      uTime: { value: 0 }, uPxScale: { value: H / 804 }, uResY: { value: H },
      uFocus: { value: focus }, uAperture: { value: aperture }, uMaxBlur: { value: maxBlur },
      uPadEm: { value: this.atlas.pad / this.atlas.px }, uRevealSoft: { value: revealSoft }, uOpacity: { value: opacity },
      uLodPx: { value: lodPx * H / 804 },
      uFade: { value: new THREE.Vector4(...fade) }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    };
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.capQ = 0; this.capS = 0; this.count = 0; this.strings = 0;
    this._allocQuads(256); this._allocStrings(64);
    this.setPaths([]);
  }

  // ---- buffers
  _allocQuads(n) {
    if (n <= this.capQ) return;
    const cap = Math.max(n, Math.ceil(this.capQ * 1.5));
    const g = this.geometry;
    const mk = k => { const a = new THREE.BufferAttribute(new Float32Array(cap * 4 * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.master = {};
    for (const [name, k] of ATTRS) { g.setAttribute(name, mk(k)); this.master[name] = new Float32Array(cap * 4 * k); }
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) { const v = i * 4; idx[i * 6] = v; idx[i * 6 + 1] = v + 1; idx[i * 6 + 2] = v + 2; idx[i * 6 + 3] = v + 2; idx[i * 6 + 4] = v + 1; idx[i * 6 + 5] = v + 3; }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.capQ = cap;
  }
  _allocStrings(n) {
    if (n <= this.capS) return;
    const cap = Math.max(n, Math.ceil(this.capS * 1.5));
    const rows = Math.max(1, Math.ceil(cap * SPT / SW));
    const data = new Float32Array(SW * rows * 4);
    if (this.sdata) data.set(this.sdata.subarray(0, Math.min(this.sdata.length, data.length)));
    this.sdata = data;
    this.stex?.dispose();
    this.stex = new THREE.DataTexture(data, SW, rows, THREE.RGBAFormat, THREE.FloatType);
    this.stex.minFilter = THREE.NearestFilter; this.stex.magFilter = THREE.NearestFilter; this.stex.generateMipmaps = false;
    this.stex.needsUpdate = true;
    this.uniforms.uStr.value = this.stex;
    this.capS = cap;
  }

  // ---- paths: [{ points: [x,y,z,...], up: [x,y,z] | normal: [x,y,z] | normals: [...per point] }]
  // Text on a path reads along the tangent T. Its up vector U is either `up` made perpendicular to T
  // (up = [0,1,0]: the text stands upright along the path, like a sign) or cross(normal, T)
  // (normal = [0,1,0]: the text lies flat, like writing on water; on a circle in the XY plane with
  // normal = [0,0,1] the letters' tops point at the centre for counter-clockwise points).
  setPaths(paths, { samples = 512 } = {}) {
    const N = paths.length ? samples : 2, rows = Math.max(1, paths.length);
    const data = new Float32Array(2 * N * rows * 4);
    this.pathLen = []; this.pathXYZ = [];
    paths.forEach((p, r) => {
      const pts = p.points, m = pts.length / 3;
      const cum = [0];
      for (let i = 1; i < m; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]));
      const L = cum[m - 1] || 1e-6;
      this.pathLen.push(L);
      let j = 0;
      const P = [];
      for (let i = 0; i < N; i++) {
        const s = L * i / (N - 1);
        while (j < m - 2 && cum[j + 1] < s) j++;
        const k = Math.min(1, Math.max(0, (s - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9)));
        const x = pts[j * 3] + (pts[j * 3 + 3] - pts[j * 3]) * k, y = pts[j * 3 + 1] + (pts[j * 3 + 4] - pts[j * 3 + 1]) * k, z = pts[j * 3 + 2] + (pts[j * 3 + 5] - pts[j * 3 + 2]) * k;
        let n = p.normal || [0, 1, 0];
        if (p.normals) { const a = p.normals, q = j * 3; n = [a[q] + (a[q + 3] - a[q]) * k, a[q + 1] + (a[q + 4] - a[q + 1]) * k, a[q + 2] + (a[q + 5] - a[q + 2]) * k]; }
        P.push([x, y, z, n]);
      }
      const xyz = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { xyz[i * 3] = P[i][0]; xyz[i * 3 + 1] = P[i][1]; xyz[i * 3 + 2] = P[i][2]; }
      this.pathXYZ.push(xyz);
      for (let i = 0; i < N; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)];
        let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const n = P[i][3];
        let ux, uy, uz;
        if (p.up) { const u = p.up, k = u[0] * tx + u[1] * ty + u[2] * tz; ux = u[0] - tx * k; uy = u[1] - ty * k; uz = u[2] - tz * k; }
        else { ux = n[1] * tz - n[2] * ty; uy = n[2] * tx - n[0] * tz; uz = n[0] * ty - n[1] * tx; }
        const ul = Math.hypot(ux, uy, uz) || 1;
        const o = (r * 2 * N + 2 * i) * 4;
        data[o] = P[i][0]; data[o + 1] = P[i][1]; data[o + 2] = P[i][2];
        data[o + 4] = ux / ul; data[o + 5] = uy / ul; data[o + 6] = uz / ul;
      }
    });
    this.ptex?.dispose();
    this.ptex = new THREE.DataTexture(data, 2 * N, rows, THREE.RGBAFormat, THREE.FloatType);
    this.ptex.minFilter = THREE.NearestFilter; this.ptex.magFilter = THREE.NearestFilter; this.ptex.generateMipmaps = false;
    this.ptex.needsUpdate = true;
    this.uniforms.uPath.value = this.ptex; this.uniforms.uPathN.value = N;
  }

  // ---- content
  async prepare(items) {
    await this.atlas.load(items);
    for (const it of items) this.atlas.layout(it);
    this.atlas.flush();
  }
  async setAsync(items) { await this.prepare(items); return this.set(items); }

  // Width / extents of an item in em (anchor not applied): { width, ext: [x0, y0, x1, y1], ink }
  measure(item) { return this.atlas.layout(item); }

  set(items) {
    const lays = items.map(it => this.atlas.layout(it));
    this.atlas.flush();
    let nq = 0;
    for (const L of lays) {
      nq += L.quads.length;
      if (L.den < 0) {   // mean ink density over the string's ink box (for the far-out-of-focus bar)
        let ink = 0;
        for (const Q of L.quads) ink += Q.e.den * (Q.box[2] - Q.box[0]) * (Q.box[3] - Q.box[1]);
        L.den = Math.min(1, ink / Math.max((L.ink[2] - L.ink[0]) * (L.ink[3] - L.ink[1]), 1e-6));
      }
    }
    this._allocQuads(Math.max(nq, 1)); this._allocStrings(Math.max(items.length, 1));
    const M = this.master;
    const POS = M.position, MK = M.aMask, UV = M.aUV, BX = M.aBox, SI = M.aS;
    this.q0 = new Int32Array(items.length + 1);
    let q = 0;
    for (let s = 0; s < items.length; s++) {
      const it = items[s], L = lays[s];
      const an = it.anchor || [0.5, 0.5];
      const dx = -(L.ext[0] + (L.ext[2] - L.ext[0]) * an[0]), dy = -(L.ext[1] + (L.ext[3] - L.ext[1]) * an[1]);
      this._writeString(s, it, L, dx, dy);
      this.q0[s] = q;
      for (let j = 0; j < L.quads.length; j++, q++) {
        const Q = L.quads[j];
        const sv = s + (j === 0 ? 0.5 : 0);
        for (let v = 0; v < 4; v++) {
          const o = q * 4 + v;
          POS[o * 3] = Q.e.den; POS[o * 3 + 1] = Q.ordL; POS[o * 3 + 2] = Q.ordR;
          MK[o * 4] = Q.mask[0] + dx; MK[o * 4 + 1] = Q.mask[1] + dy; MK[o * 4 + 2] = Q.mask[2] + dx; MK[o * 4 + 3] = Q.mask[3] + dy;
          UV[o * 4] = Q.uv[0]; UV[o * 4 + 1] = Q.uv[1]; UV[o * 4 + 2] = Q.uv[2]; UV[o * 4 + 3] = Q.uv[3];
          BX[o * 4] = Q.box[0] + dx; BX[o * 4 + 1] = Q.box[1] + dy; BX[o * 4 + 2] = Q.box[2] + dx; BX[o * 4 + 3] = Q.box[3] + dy;
          SI[o] = sv;
        }
      }
    }
    this.q0[items.length] = q;
    this.total = q; this.strings = items.length;
    this.items = items; this.lays = lays;
    this.stex.needsUpdate = true;
    this.cullKey = undefined;
    this._copy([[0, q]], q);
    return q;
  }

  // copy quad ranges [[q0, q1], ...] from the master arrays into the draw buffers
  _copy(ranges, n) {
    const g = this.geometry, M = this.master;
    for (const [name, k] of ATTRS) {
      const dst = g.attributes[name].array, src = M[name], w = 4 * k;
      let o = 0;
      for (const [a, b] of ranges) { dst.set(src.subarray(a * w, b * w), o * w); o += b - a; }
      const at = g.attributes[name];
      at.clearUpdateRanges(); at.addUpdateRange(0, Math.max(n, 1) * w); at.needsUpdate = true;
    }
    g.setDrawRange(0, n * 6);
    this.count = n;
  }

  // Optional per-frame culling and level of detail on the CPU (call in update(), after placing the camera).
  // Drops strings that are hidden, outside the frustum or faded out, and sends only one quad for strings that
  // the shader will draw as a single bar anyway (too small to read, or far out of focus). Saves vertex work:
  // ~0.13 µs per vertex on SwiftShader. `key` (e.g. Math.round(T * 24)) skips the work when unchanged; the
  // margins keep the result valid across the sub-frames of one frame.
  cull(camera, t, key = null) {
    if (!this.items) return this.count;
    if (key != null && key === this.cullKey) return this.count;
    this.cullKey = key;
    camera.updateMatrixWorld(); this.mesh.updateMatrixWorld();
    _m4.multiplyMatrices(camera.matrixWorldInverse, this.mesh.matrixWorld);
    const e = _m4.elements, P = camera.projectionMatrix.elements;
    const persp = P[15] === 0;
    const tx = persp ? 1 / P[0] : 1, ty = persp ? 1 / P[5] : 1;
    const U = this.uniforms, H = U.uResY.value, pxs = U.uPxScale.value, lod = U.uLodPx.value * 0.85;
    const ap = U.uAperture.value, foc = U.uFocus.value, maxB = U.uMaxBlur.value * pxs, pad = U.uPadEm.value;
    const F = U.uFade.value, d = this.sdata, n = this.items.length;
    const ranges = [];
    let q = 0, last = null;
    const push = (a, b) => { if (last && last[1] === a) last[1] = b; else { last = [a, b]; ranges.push(last); } q += b - a; };
    for (let s = 0; s < n; s++) {
      const o = s * SPT * 4, a = this.q0[s], b = this.q0[s + 1];
      if (a === b) continue;
      // time window and alpha (both colours)
      const s0 = d[o + 26], s1 = d[o + 27];
      if (t < s0 || t > s1) continue;
      if (d[o + 19] <= 0 && d[o + 23] <= 0) continue;
      const kind = d[o + 7], size = d[o + 3];
      const bx0 = d[o + 32], by0 = d[o + 33], bx1 = d[o + 34], by1 = d[o + 35];
      const cxl = 0.5 * (bx0 + bx1), cyl = 0.5 * (by0 + by1);
      let r = 0.5 * Math.hypot(bx1 - bx0, by1 - by0) * size;
      let x, y, z;
      if (kind > 2.5) {
        const pi = d[o + 12], xyz = this.pathXYZ[pi];
        if (!xyz) continue;
        const N = xyz.length / 3, L = d[o + 13];
        let f = (d[o] + d[o + 14] * t + cxl * size) / L * (N - 1);
        if (d[o + 15] > 0.5) f = ((f % (N - 1)) + (N - 1)) % (N - 1);
        const fc = Math.min(Math.max(f, 0), N - 1 - 1e-3), i0 = Math.floor(fc), k = fc - i0, ex = f - fc;
        const ax = xyz[i0 * 3], ay = xyz[i0 * 3 + 1], az = xyz[i0 * 3 + 2], bx = xyz[i0 * 3 + 3], by = xyz[i0 * 3 + 4], bz = xyz[i0 * 3 + 5];
        x = ax + (bx - ax) * (k + ex); y = ay + (by - ay) * (k + ex); z = az + (bz - az) * (k + ex);
        r += Math.abs(d[o + 1]) + Math.abs(d[o + 2]) + 0.25 * (bx1 - bx0) * size;
      } else {
        x = d[o] + d[o + 12] * t; y = d[o + 1] + d[o + 13] * t; z = d[o + 2] + d[o + 14] * t;
        if (kind < 0.5) { x += (d[o + 4] * cxl + d[o + 8] * cyl) * size; y += (d[o + 5] * cxl + d[o + 9] * cyl) * size; z += (d[o + 6] * cxl + d[o + 10] * cyl) * size; }
        else r += Math.hypot(cxl, cyl) * size;
      }
      const vx = e[0] * x + e[4] * y + e[8] * z + e[12], vy = e[1] * x + e[5] * y + e[9] * z + e[13], vz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const zz = -vz;
      r *= 1.15;
      if (zz < -r) continue;
      if (persp && (Math.abs(vx) > (zz * tx + r * 1.2) * 1.08 || Math.abs(vy) > (zz * ty + r * 1.2) * 1.08)) continue;
      if (F.y > 0 && zz + r < F.x) continue;
      if (F.w > 0 && zz - r > F.w) continue;
      let barOnly = false;
      if (kind < 2.5 && zz > r) {
        const emPx = size * P[5] * 0.5 * H / (persp ? zz : 1);
        const coc = ap * Math.abs(zz - foc) / zz * pxs * 100, wEm = Math.min(coc, maxB) / emPx;
        barOnly = emPx < lod || 0.5 * wEm > pad * 1.1;
      }
      push(a, barOnly ? a + 1 : b);
    }
    this._copy(ranges, q);
    return q;
  }

  // Change per-string properties without rebuilding glyphs (any item keys except text, font, anchor and layout keys).
  update(i, props) {
    const it = Object.assign(this.items[i], props);
    const L = this.lays[i];
    const an = it.anchor || [0.5, 0.5];
    this._writeString(i, it, L, -(L.ext[0] + (L.ext[2] - L.ext[0]) * an[0]), -(L.ext[1] + (L.ext[3] - L.ext[1]) * an[1]));
    this.stex.needsUpdate = true;
  }

  _writeString(s, it, L, dx, dy) {
    const d = this.sdata, o = s * SPT * 4;
    const size = it.size ?? 0.1;
    let kind = 0;
    if (it.path != null) kind = 3; else if (it.billboard === 'upright') kind = 2; else if (it.billboard) kind = 1;
    const pos = it.pos || [0, 0, 0], ax = it.ax || [1, 0, 0], ay = it.ay || [0, 1, 0];
    if (kind === 3) { const off = it.off || [0, 0]; d[o] = it.s ?? 0; d[o + 1] = off[0]; d[o + 2] = off[1]; }
    else { d[o] = pos[0]; d[o + 1] = pos[1]; d[o + 2] = pos[2]; }
    d[o + 3] = size;
    d[o + 4] = ax[0]; d[o + 5] = ax[1]; d[o + 6] = ax[2]; d[o + 7] = kind;
    d[o + 8] = ay[0]; d[o + 9] = ay[1]; d[o + 10] = ay[2]; d[o + 11] = it.phase ?? 0;
    if (kind === 3) { d[o + 12] = it.path; d[o + 13] = this.pathLen[it.path] ?? 1; d[o + 14] = it.speed ?? 0; }
    else { const v = it.vel || [0, 0, 0]; d[o + 12] = v[0]; d[o + 13] = v[1]; d[o + 14] = v[2]; }
    d[o + 15] = it.wrap ? 1 : 0;
    const c = toRGB(it.color) || [1, 1, 1], I = it.intensity ?? 1, A = it.alpha ?? 1;
    d[o + 16] = c[0] * I; d[o + 17] = c[1] * I; d[o + 18] = c[2] * I; d[o + 19] = A;
    const c2 = toRGB(it.color2) || c, I2 = it.intensity2 ?? I, A2 = it.alpha2 ?? A;
    d[o + 20] = c2[0] * I2; d[o + 21] = c2[1] * I2; d[o + 22] = c2[2] * I2; d[o + 23] = A2;
    const mix = it.mix || [1e6, 1e6 + 1], show = it.show || [-1e6, 1e6, 0, 0], rev = it.reveal || [-1e6, -1e6];
    d[o + 24] = mix[0]; d[o + 25] = mix[1]; d[o + 26] = show[0]; d[o + 27] = show[1];
    d[o + 28] = show[2] ?? 0; d[o + 29] = show[3] ?? 0; d[o + 30] = rev[0]; d[o + 31] = rev[1];
    d[o + 32] = L.ink[0] + dx; d[o + 33] = L.ink[1] + dy; d[o + 34] = L.ink[2] + dx; d[o + 35] = L.ink[3] + dy;
    d[o + 36] = L.den; d[o + 37] = L.rtl ? 1 : 0; d[o + 38] = 0; d[o + 39] = 0;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); this.stex?.dispose(); this.ptex?.dispose(); }
}
