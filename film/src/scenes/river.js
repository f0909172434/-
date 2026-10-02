// THE RIVER OF QUESTIONS · four modes of one scene (see docs/SCREENPLAY.md #4, #5, #8, #10).
//
// One river, laid out in river coordinates (lib/riverflow.js): it springs from a crack at s = 0 (1200 BCE) and
// widens downstream to the present (s ~ 70-150). Every line of text is someone's question, standing upright in
// the current and flowing downstream on the GPU (TextField path mode), with the parabolic speed profile of a real
// river. The camera watches from the +N bank, so every line reads left to right.
//
//   present  (45-70)   2026: multilingual questions, paper white with AI-blue accents; the warm question from the
//                      mind scene falls into the river; card 50-56.4 over a dark lower third.
//   upstream (70-100)  the camera lingers at one exhibit per era and surges through each stratum boundary at the
//                      HUD sync points 70 / 74 / 78 / 82 / 86 / 92: e-mail 1998, punched tape 1931, letters 1868,
//                      temple slips 1750, yarrow stalks 800 BCE, and the source: the crack, in firelight.
//   return   (160-172) the same river replayed downstream at speed (its strings are mapped back in time so every
//                      era is in place), converging into one warm line: 她會好起來嗎？
//   memory   (212-245) the river again, now mixed across all eras and slowly filled with warmth; the human's three
//                      sentences drift in it beside three thousand years of questions.
//
// update() is a pure function of (shot, t): G = shot.start + t is the film time; every motion is uTime on the GPU
// or an analytic function of G (lib/riverrig.js).
import * as THREE from '../../vendor/three.module.js';
import { PAL } from '../look/palette.js';
import { TextField, GlyphAtlas } from '../look/text.js';
import { FLines } from '../lib/flines.js';
import { PathLines } from '../lib/pathlines.js';
import { Rand, hash1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, easeInOutCubic, easeOutCubic, easeInOutSine, envelope } from '../lib/ease.js';
import { River, RIVER, flowSpeed } from '../lib/riverflow.js';
import { rig, basis, focusS, focusDist, focusRet, viewTime, eraAt, eraBounds, CRACK, MEM_S, STANZA } from '../lib/riverrig.js';
import { crackGeometry } from '../lib/crack.js';
import * as D from '../lib/riverdata.js';

const G_REF = 45;                       // uTime = tau - 45 for the river fields
const V_MAX = 0.5;                      // mid-stream speed (units / s)
const C = (c, k = 1) => [c.r * k, c.g * k, c.b * k];
const mixc = (a, b, k) => new THREE.Color(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k);
const WARM_LINE = mixc(PAL.line, PAL.c, 0.82);   // paper lit by fire / memory

export default class RiverScene {
  constructor(ctx) { this.ctx = ctx; }

  async init() {
    const ctx = this.ctx, W = ctx.width, H = ctx.height;
    this.res = [W, H];
    this.river = new River();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(25, W / H, 0.05, 500);
    this.atlas = new GlyphAtlas({ size: 4096, px: 48 });
    this.atlasBig = new GlyphAtlas({ size: 2048, px: 96 });
    const path = this.river.path(0.25);

    // ---- fields
    this.tfR = new TextField(ctx, { atlas: this.atlas, focus: 14, aperture: 0.04, maxBlur: 22, fade: [1.4, 3.4, 52, 84] });
    this.tfR.setPaths([path], { samples: 1200 });
    this.tfH = new TextField(ctx, { atlas: this.atlas, focus: 9, aperture: 0.05, maxBlur: 20, fade: [0.5, 1.5, 0, 0] });
    this.tfW = new TextField(ctx, { atlas: this.atlas, focus: 6, aperture: 0.06, maxBlur: 24, fade: [0.6, 1.8, 0, 0] });
    this.tfM = new TextField(ctx, { atlas: this.atlas, focus: 12, aperture: 0.045, maxBlur: 22, fade: [2.6, 5.2, 50, 80] });
    // the grain (tiny questions between the lanes) in fields of their own: invisible beyond ~30 units, so cut there
    this.tfG = new TextField(ctx, { atlas: this.atlas, focus: 14, aperture: 0.04, maxBlur: 22, fade: [1.4, 3.4, 18, 30] });
    this.tfG.setPaths([path], { samples: 1200 });
    this.tfMG = new TextField(ctx, { atlas: this.atlas, focus: 12, aperture: 0.045, maxBlur: 22, fade: [2.6, 5.2, 18, 30] });
    this.tfMG.setPaths([path], { samples: 1200 });
    this.tfM.setPaths([path], { samples: 1200 });
    this.tfB = new TextField(ctx, { atlas: this.atlasBig, focus: 10, aperture: 0.04, maxBlur: 20, fade: [0.4, 1.2, 0, 0] });
    this.tfB.setPaths([path], { samples: 1200 });
    this.tfL = new TextField(ctx, { atlas: this.atlasBig, focus: 6, aperture: 0, fade: [0.2, 0.6, 0, 0] });

    // fonts first (every candidate string, so measure() is exact), then build
    await this.atlas.load(this.corpusItems());
    await this.atlasBig.load([{ text: D.MEMORY.join('') + '她會好起來嗎？', font: 'sans', weight: 300 }]);
    this.measureHoles();

    const R = this.buildRiver();
    await this.tfR.prepare(R.items); this.tfR.set(R.items);
    await this.tfG.prepare(R.grain); this.tfG.set(R.grain);
    this.plR = new PathLines({ resolution: this.res, tf: this.tfR, aperture: 0.04, fade: [1.4, 3.4, 52, 84] });
    this.plR.set(R.segs);

    const M = this.buildMemory();
    await this.tfM.prepare(M.items); this.tfM.set(M.items);
    await this.tfMG.prepare(M.grain); this.tfMG.set(M.grain);
    this.plM = new PathLines({ resolution: this.res, tf: this.tfM, aperture: 0.045, fade: [2.6, 5.2, 50, 80] });
    this.plM.set(M.segs);

    const Wc = this.buildWarm();
    await this.tfW.prepare(Wc); this.tfW.set(Wc);

    const B = this.buildBig();
    await this.tfB.prepare(B.stanza); this.tfB.set(B.stanza);
    await this.tfL.prepare(B.line); this.tfL.set(B.line);

    this.ex = this.buildExhibits();
    await this.tfH.prepare(this.ex.items); this.tfH.set(this.ex.items);

    this.buildStreams();
    this.buildSource();
    this.buildConverge();

    for (const m of [this.streams.mesh, this.fire, this.crackGlow.mesh, this.crackCore.mesh, this.plR.mesh, this.plM.mesh,
      this.tfR.mesh, this.tfG.mesh, this.tfM.mesh, this.tfMG.mesh, this.tfH.mesh, this.exLines.mesh, this.stalks.mesh, this.yao.mesh, this.tfW.mesh,
      this.conv.mesh, this.tfB.mesh, this.tfL.mesh]) this.scene.add(m);
  }

  // ------------------------------------------------------------------------------------------ corpus / fonts
  corpusItems() {
    const out = [];
    for (const [lang, q] of D.Q2026) out.push({ text: q, font: D.LATIN.has(lang) ? 'latin' : 'sans', weight: 400 });
    const mono = [...D.MAIL_FROM, ...D.MAIL_DATE, ...D.MAIL_SUBJ, ...D.NEWS, ...D.MAIL_QUOTE, ...D.MAIL_RULE, ...D.MAIL_HERO,
      '●•─0123456789.,−-[]…·:→×÷= ', 'ITA2 · 5-UNIT CODE · 0.1 in', '1 2 3 4 5'];
    for (const t of mono) out.push({ text: t, font: 'mono' });
    for (const t of D.TELEGRAMS) out.push({ text: t, font: 'type' });
    out.push({ text: 'NEW YORK NY MAR 14 1931 312A CHICAGO ILL', font: 'type' });
    for (const t of [...D.LETTER_ZH, ...D.LETTER_HERO_ZH]) out.push({ text: t, font: 'kai' });
    for (const t of [...D.LETTER_EN, ...D.LETTER_HERO_EN]) out.push({ text: t, font: 'script' });
    for (const [h, p] of D.SLIP_POEMS) out.push({ text: h + p.join(''), font: 'serif' });
    for (const t of [...D.SLIP_ASK, D.GANZHI.join(''), D.XICI, D.HEX.name + D.HEX.judgement, '第一籤甲子四十九掛一揲四歸奇']) out.push({ text: t, font: 'serif' });
    for (const t of D.YARROW_ASK) out.push({ text: t, font: 'kai' });
    out.push({ text: '她會好起來嗎？', font: 'sans', weight: 300 });
    return out;
  }

  // punched-tape geometry from the real glyph metrics: code holes 0.072 in, feed holes 0.046 in, pitch 0.1 in
  measureHoles() {
    const g = t => { const L = this.tfR.measure({ text: t, font: 'mono' }); return { w: Math.max(0.1, L.ink[2] - L.ink[0]), cx: 0.5 * (L.ink[0] + L.ink[2]), cy: 0.5 * (L.ink[1] + L.ink[3]), desc: -L.ext[1] }; };
    this.hole = { big: g('●'), small: g('•') };
  }
  // a tape of `cols` (ITA2 columns) with pitch p, as mono rows: tracks 1, 2, feed, 3, 4, 5 (top to bottom)
  // Each row is placed with anchor [0, 0] at (x + dx, y + dy) so that hole c is centred at (x + (c + 0.5) p, y).
  tapeRows(cols, p) {
    const rows = [];
    const bits = [0, 1, -1, 2, 3, 4];
    for (let r = 0; r < 6; r++) {
      const b = bits[r], g = b < 0 ? this.hole.small : this.hole.big;
      const str = cols.map(c => b < 0 ? '•' : (c.code[b] === '1' ? '●' : ' ')).join('');
      const size = (b < 0 ? 0.46 : 0.72) * p / g.w;
      rows.push({ text: str, size, tracking: p / size - 0.6, y: (2.5 - r) * p, dx: 0.5 * p - g.cx * size, dy: -(g.desc + g.cy) * size, feed: b < 0 });
    }
    return rows;
  }

  // ------------------------------------------------------------------------------------------ the river (present + eras)
  buildRiver() {
    const r = new Rand(1234), items = [], segs = [], grain = [];
    const R = this.river;
    const B = eraBounds();
    // era of a string at s (a soft boundary decided per string)
    const eraOf = s => { const e = eraAt(s); const i = Math.floor(e), f = e - i; return f > 0 && r.next() < f ? i + 1 : i; };
    // place: s_view (where it is when the camera looks at it), lateral n, height h
    const place = (it, sView, n, h, era) => {
      const half = R.at(sView).half, speed = flowSpeed(n, half, V_MAX);
      const Tv = viewTime(sView);
      it.path = 0; it.s = sView - speed * (Tv - G_REF); it.off = [h, n]; it.speed = speed;
      if (era > 0) it.show = [Tv - G_REF - (era >= 5 ? 7 : 9), Tv - G_REF + (era >= 5 ? 5 : 6.5), 1.2, 1.2];
      if (it.reveal) it.reveal = [it.reveal[0] + Tv - G_REF, it.reveal[1] + Tv - G_REF];
      items.push(it);
      return { speed, Tv, s0: it.s };
    };
    const seg = (sView, Tv, speed, a, b, w, color, I, show) => {
      const s0 = sView - speed * (Tv - G_REF);
      segs.push({ a: [s0 + a[0], a[1], a[2]], b: [s0 + b[0], b[1], b[2]], w, color, intensity: I, speed, show });
    };
    const pickQ = () => {
      let tot = 0; for (const [l] of D.Q2026) tot += D.LANG_W[l] ?? 0.7;
      let x = r.next() * tot;
      for (const [l, q] of D.Q2026) { x -= D.LANG_W[l] ?? 0.7; if (x <= 0) return [l, q]; }
      return D.Q2026[0];
    };
    const qItem = (size, I, alpha = 1) => {
      const [lang, q] = pickQ();
      const ai = r.next() < 0.03;
      return { text: q, font: D.LATIN.has(lang) ? 'latin' : 'sans', weight: 400, size, anchor: [0, 0], color: ai ? PAL.si : PAL.line, intensity: I * (ai ? 1.1 : 1), alpha };
    };
    const width = it => this.tfR.measure(it).width * it.size;
    const embed = () => {
      const k = r.int(5, 8), v = [];
      for (let i = 0; i < k; i++) { const x = r.gauss() * 0.31; v.push((x < 0 ? '−' : '') + Math.abs(x).toFixed(4)); }
      return '[' + v.join(', ') + ', …]';
    };
    const embeds = Array.from({ length: 48 }, embed);
    const stamp = () => `0${r.int(0, 4)}:${String(r.int(0, 59)).padStart(2, '0')}`;

    // lanes in normalised lateral coordinate u = n / half; heroes on a few, fill everywhere
    const heroU = [-0.84, -0.58, -0.3, -0.05, 0.22, 0.47, 0.71].map(u => u + r.range(-0.05, 0.05));
    // fill lanes: random, denser mid-stream (the current carries most of the questions), never closer than 0.012
    const fillU = [];
    while (fillU.length < 62) { const u = Math.sin((r.next() * 2 - 1) * Math.PI / 2) * 0.99; if (fillU.every(v => Math.abs(v - u) > 0.012)) fillU.push(u); }
    fillU.sort((a, b) => a - b);
    const S0 = 0.6, S1 = RIVER.S - 1;

    // walk a lane: generator(era, s, u) returns { len } after pushing its items, or null to skip a gap
    const walk = (u, gen, gap0, gap1, stride) => {
      let s = S0 + r.next() * 3;
      while (s < S1) {
        const e = eraOf(s);
        const res = gen(e, s, u);
        s += (res ? res.len : 0.4) + r.range(gap0, gap1) * (stride?.(e) ?? 1);
      }
    };

    // ---------------- era generators
    const holeCols = {};
    const tapeOf = msg => holeCols[msg] || (holeCols[msg] = D.ita2Columns(msg));
    const gens = {
      hero: (e, s, u) => {
        const half = R.at(s).half, n = u * half;
        if (e === 0) {
          const it = qItem(r.range(0.15, 0.2), r.range(0.95, 1.2));
          const len = width(it);
          const P = place(it, s, n, r.range(0.0, 0.05), 0);
          // the AI's annotation under some lines: its embedding, or the hour it was asked
          const k = r.next();
          if (k < 0.24) items.push({ text: embeds[r.int(0, embeds.length - 1)], font: 'mono', size: it.size * 0.3, anchor: [0, 1], path: 0, s: P.s0, off: [it.off[0] - 0.012, n], speed: P.speed, color: PAL.si, intensity: 0.4 });
          else if (k < 0.5) items.push({ text: stamp(), font: 'mono', size: it.size * 0.34, anchor: [0, 1], path: 0, s: P.s0, off: [it.off[0] - 0.012, n], speed: P.speed, color: PAL.line, intensity: 0.4 });
          return { len };
        }
        return gens.fill(e, s, u, true);
      },
      fill: (e, s, u, big = false) => {
        const half = R.at(s).half, n = u * half + r.range(-0.03, 0.03) * half;
        const h = big ? r.range(0, 0.04) : Math.pow(r.next(), 3) * 0.22;
        const z = big ? 1.5 : 1;
        if (e === 0) {
          const it = qItem(r.range(0.065, 0.11) * (big ? 1.6 : 1), r.range(0.45, 0.85));
          if (r.next() < 0.03) { it.text = embeds[r.int(0, embeds.length - 1)]; it.font = 'mono'; it.weight = undefined; it.color = PAL.si; it.intensity = 0.4; }
          const len = width(it); place(it, s, n, h, 0); return { len };
        }
        if (e === 1) {   // 1998: e-mail and Usenet / BBS lines in monospace
          const k = r.next();
          let text, I;
          if (k < 0.34) { text = D.MAIL_SUBJ[r.int(0, D.MAIL_SUBJ.length - 1)]; I = 0.85; }
          else if (k < 0.56) { text = (r.next() < 0.5 ? D.MAIL_FROM : D.MAIL_DATE)[r.int(0, 5)]; I = 0.5; }
          else if (k < 0.8) { text = D.MAIL_QUOTE[r.int(0, D.MAIL_QUOTE.length - 1)]; I = 0.68; }
          else if (k < 0.92) { text = D.NEWS[r.int(0, D.NEWS.length - 1)]; I = 0.55; }
          else { text = D.MAIL_RULE[r.int(0, D.MAIL_RULE.length - 1)]; I = 0.35; }
          if (r.next() < 0.14) { text = [D.MAIL_FROM[r.int(0, 9)], D.MAIL_DATE[r.int(0, 5)], D.MAIL_SUBJ[r.int(0, 9)]].join('\n'); I = 0.7; }
          const it = { text, font: 'mono', size: r.range(0.06, 0.1) * z, anchor: [0, 0], lineHeight: 1.35, color: PAL.line, intensity: I };
          const len = width(it); place(it, s, n, h, 1); return { len };
        }
        if (e === 2) {   // 1931: punched tape (ITA2) and printed strips
          if (r.next() < 0.36) {
            const m1 = r.int(0, D.TELEGRAMS.length - 1), msg = D.TELEGRAMS[m1] + ' ' + D.TELEGRAMS[(m1 + 5) % D.TELEGRAMS.length], cols = tapeOf(msg);
            const p = r.range(0.03, 0.04) * (big ? 1.25 : 1), len = cols.length * p;
            const h0 = 0.05 + 3.5 * p + h;
            const rows = this.tapeRows(cols, p);
            let P = null;
            for (const row of rows) {
              const it = { text: row.text, font: 'mono', size: row.size, tracking: row.tracking, anchor: [0, 0], color: PAL.line, intensity: row.feed ? 0.28 : 0.55 };
              const q = place(it, s + row.dx, n, h0 + row.y + row.dy, 2); P = P || q;
            }
            const show = items[items.length - 1].show;
            for (const y of [3.44, -3.44]) seg(s, P.Tv, P.speed, [0, h0 + y * p, n], [len, h0 + y * p, n], 0.003, PAL.line, 0.42, show);
            if (r.next() < 0.5) {   // the printed strip under it
              const sz = 0.75 * p / 0.6;
              const it = { text: msg, font: 'type', size: sz, tracking: p / sz - 0.6, anchor: [0, 0.5], color: PAL.line, intensity: 0.75 };
              const y = h0 - 3.44 * p - 0.06 - 0.5 * sz;
              place(it, s, n, y, 2);
              for (const dy of [0.85, -0.85]) seg(s, P.Tv, P.speed, [0, y + dy * sz, n], [len, y + dy * sz, n], 0.003, PAL.line, 0.35, show);
            }
            return { len };
          }
          const msg = r.next() < 0.3 ? 'NEW YORK NY MAR 14 1931 312A' : D.TELEGRAMS[r.int(0, D.TELEGRAMS.length - 1)];
          const it = { text: msg, font: 'type', size: r.range(0.06, 0.09) * z, anchor: [0, 0], color: PAL.line, intensity: 0.72 };
          const len = width(it); place(it, s, n, h, 2); return { len };
        }
        if (e === 3) {   // 1868: handwriting that writes itself
          if (r.next() < 0.55) {
            const text = D.LETTER_ZH[r.int(0, D.LETTER_ZH.length - 1)], size = r.range(0.07, 0.11) * z;
            const nch = [...text].length, dur = 0.09 * nch, t0 = r.range(-5, 1.5);
            const it = { text, font: 'kai', vertical: true, size, anchor: [0.5, 0], color: PAL.line, intensity: 0.85, reveal: [t0, t0 + dur] };
            place(it, s, n, h + 0.02, 3);
            return { len: size * 1.6 };
          }
          const text = D.LETTER_EN[r.int(0, D.LETTER_EN.length - 1)], size = r.range(0.1, 0.15) * z;
          const t0 = r.range(-5, 1.5);
          const it = { text, font: 'script', size, anchor: [0, 0], color: PAL.line, intensity: 0.85, reveal: [t0, t0 + 0.05 * text.length] };
          const len = width(it); place(it, s, n, h + 0.02, 3); return { len };
        }
        if (e === 4) {   // 1750: woodblock slips, bamboo sticks, the worshippers' questions
          const k = r.next();
          if (k < 0.34) {
            const [hd, poem] = D.SLIP_POEMS[r.int(0, D.SLIP_POEMS.length - 1)], size = r.range(0.045, 0.065) * z;
            const it = { text: poem.join('\n'), font: 'serif', vertical: true, size, lineHeight: 1.45, anchor: [0.5, 0], color: PAL.line, intensity: 0.85 };
            const P = place(it, s, n, h + 0.035, 4);
            // the slip's frame: a printed double border
            const w = 4 * 1.45 * size + 0.04, hh = 7 * size + 0.07, show = it.show;
            for (const g of [0, 0.012]) {
              const x0 = -w / 2 - g, x1 = w / 2 + g, y0 = h + 0.0 - g, y1 = h + hh + g;
              const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
              for (let i = 0; i < 4; i++) seg(s, P.Tv, P.speed, [c[i][0], c[i][1], n], [c[i + 1][0], c[i + 1][1], n], 0.0022, PAL.line, 0.42, show);
            }
            return { len: w + 0.06 };
          }
          if (k < 0.72) {   // a few sticks, leaning, as if poured from the cylinder
            const nS = r.int(2, 6), P = place({ text: ' ', font: 'mono', size: 0.01, anchor: [0, 0], color: PAL.line, intensity: 0 }, s, n, 0, 4);
            const show = items[items.length - 1].show;
            let x = 0;
            const tilt = r.range(-0.05, 0.05);
            for (let j = 0; j < nS; j++) {
              const L = r.range(0.55, 0.7) * z, x0 = r.range(0, 0.06), y0 = h + 0.012 + j * 0.022;
              seg(s, P.Tv, P.speed, [x0, y0, n], [x0 + L, y0 + L * tilt, n], 0.008, PAL.line, 0.42, show);
              x = Math.max(x, x0 + L);
            }
            return { len: x + 0.2 };
          }
          const text = D.SLIP_ASK[r.int(0, D.SLIP_ASK.length - 1)], size = r.range(0.05, 0.075) * z;
          const it = { text, font: 'serif', vertical: true, size, anchor: [0.5, 0], color: PAL.line, intensity: 0.7 };
          place(it, s, n, h + 0.02, 4);
          return { len: size * 1.8 };
        }
        if (e === 5) {   // 800 BCE: yarrow stalks drifting, hexagrams drawn in the water, the diviner's question
          const k = r.next();
          const warm = WARM_LINE;
          if (k < 0.45) {
            const nS = r.int(3, 9), P = place({ text: ' ', font: 'mono', size: 0.01, anchor: [0, 0], color: PAL.line, intensity: 0 }, s, n, 0, 5);
            const show = items[items.length - 1].show;
            let L = 0;
            for (let j = 0; j < nS; j++) {
              const len = r.range(0.5, 0.85) * z, x0 = r.range(0, 0.25), y0 = h + j * 0.012;
              seg(s, P.Tv, P.speed, [x0, y0, n + r.range(-0.04, 0.04)], [x0 + len, y0 + r.range(-0.03, 0.03), n + r.range(-0.04, 0.04)], 0.0035, warm, 0.42, show);
              L = Math.max(L, x0 + len);
            }
            return { len: L };
          }
          if (k < 0.75) {   // a hexagram: six yao, yang solid, yin broken
            const P = place({ text: ' ', font: 'mono', size: 0.01, anchor: [0, 0], color: PAL.line, intensity: 0 }, s, n, 0, 5);
            const show = items[items.length - 1].show, w = 0.24 * z, th = 0.011 * z, g = 0.045 * z;
            for (let j = 0; j < 6; j++) {
              const y = h + 0.03 + j * 0.055 * z, yang = r.next() < 0.5;
              if (yang) seg(s, P.Tv, P.speed, [0, y, n], [w, y, n], th, warm, 0.5, show);
              else { seg(s, P.Tv, P.speed, [0, y, n], [(w - g) / 2, y, n], th, warm, 0.5, show); seg(s, P.Tv, P.speed, [(w + g) / 2, y, n], [w, y, n], th, warm, 0.5, show); }
            }
            return { len: w + 0.1 };
          }
          const text = D.YARROW_ASK[r.int(0, D.YARROW_ASK.length - 1)], size = r.range(0.055, 0.08) * z;
          const it = { text, font: 'kai', vertical: true, size, anchor: [0.5, 0], color: warm, intensity: 0.8 };
          place(it, s, n, h + 0.02, 5);
          return { len: size * 1.8 };
        }
        return null;     // the source: only light (streams, the crack)
      },
    };
    // density per era (gap multiplier): older eras are sparser
    const sparse = e => [1, 1.6, 2.3, 2.6, 3.0, 3.6, 99][e];
    for (const u of heroU) walk(u, gens.hero, 0.5, 3.2, sparse);
    for (const u of fillU) walk(u, (e, s, uu) => gens.fill(e, s, uu), 0.15, 1.3, sparse);
    // the grain of the present river: thousands of tiny, dim questions between the lanes (finer strokes, not noise)
    const fineU = [];
    while (fineU.length < 120) { const u = Math.sin((r.next() * 2 - 1) * Math.PI / 2) * 0.985; if (fineU.every(v => Math.abs(v - u) > 0.005)) fineU.push(u); }
    for (const u of fineU) {
      let s = 66 + r.next() * 2;
      while (s < RIVER.S - 1) {
        if (eraOf(s) !== 0) { s += 0.7; continue; }
        const half = R.at(s).half, it = qItem(r.range(0.03, 0.048), r.range(0.16, 0.3) * (1 - 0.6 * smoothstep(0.3, 0.9, u)));
        const len = width(it);
        place(it, s, u * half + r.range(-0.01, 0.01) * half, Math.pow(r.next(), 3) * 0.1, 0);
        grain.push(items.pop());
        s += len + r.range(0.08, 0.8);
      }
    }
    return { items, segs, grain };
  }

  // ------------------------------------------------------------------------------------------ memory river
  buildMemory() {
    const r = new Rand(777), items = [], segs = [], grain = [];
    const R = this.river;
    const memS = STANZA.s0 + STANZA.v * 10 + 1, memN = STANZA.n;   // where the human's sentences float at uTime 10
    const warmOf = (s, n) => {   // the warmth spreads from the sentences, upstream and downstream
      const d = Math.hypot((s - memS) * 0.55, (n - memN) * 1.0);
      const t0 = 8.5 + d * 0.75 + r.range(-1.5, 2.0);
      return [t0, t0 + r.range(3.5, 6)];
    };
    const put = (it, s, n, h) => {
      const half = R.at(s).half, speed = flowSpeed(n, half, V_MAX);
      it.path = 0; it.s = s - speed * 10; it.off = [h, n]; it.speed = speed;
      const [a, b] = warmOf(s, n);
      const I = it.intensity ?? 1;
      if (it.color === PAL.si) { it.color2 = WARM_LINE; it.intensity2 = I * 0.7; it.alpha2 = 0.0; }   // the AI's cold recedes
      else { it.color2 = r.next() < 0.3 ? PAL.c : WARM_LINE; it.intensity2 = I * 1.25; }
      it.mix = [a, b];
      items.push(it);
      return { speed, s0: it.s, mix: [a, b] };
    };
    const seg = (P, a, b, w, I) => segs.push({ a: [P.s0 + a[0], a[1], a[2]], b: [P.s0 + b[0], b[1], b[2]], w, color: WARM_LINE, intensity: I, speed: P.speed });
    const pickQ = () => D.Q2026[r.int(0, D.Q2026.length - 1)];
    const lanes = []; for (let i = 0; i < 40; i++) lanes.push(-0.97 + 1.94 * (i + 0.5) / 40);
    // grain: tiny dim questions between the lanes, warming with the rest
    for (let i = 0; i < 90; i++) {
      const u = Math.sin((r.next() * 2 - 1) * Math.PI / 2) * 0.98;
      let s = 84 + r.next() * 2;
      while (s < 148) {
        const half = R.at(s).half, n = u * half;
        if (Math.abs(n - memN) < 0.75 && s > memS - 9 && s < memS + 9) { s += 0.6; continue; }
        const [lang, q] = pickQ();
        const it = { text: q, font: D.LATIN.has(lang) ? 'latin' : 'sans', weight: 400, size: r.range(0.03, 0.046), anchor: [0, 0], color: PAL.line, intensity: r.range(0.2, 0.34) };
        const len = this.tfM.measure(it).width * it.size; put(it, s, n, Math.pow(r.next(), 3) * 0.1);
        grain.push(items.pop());
        s += len + r.range(0.1, 0.9);
      }
    }
    for (const u of lanes) {
      let s = 84 + r.next() * 2;
      while (s < 148) {
        const half = R.at(s).half, n = u * half + r.range(-0.04, 0.04) * half;
        if (Math.abs(n - memN) < 0.75 && s > memS - 9 && s < memS + 9) { s += 0.6; continue; }   // keep the sentences' lane clear
        const h = Math.pow(r.next(), 3) * 0.18, k = r.next();
        let len = 0.5;
        if (k < 0.5) {
          const [lang, q] = pickQ(), hero = r.next() < 0.18;
          const it = { text: q, font: D.LATIN.has(lang) ? 'latin' : 'sans', weight: 400, size: hero ? r.range(0.13, 0.17) : r.range(0.065, 0.1), anchor: [0, 0],
            color: r.next() < 0.04 ? PAL.si : PAL.line, intensity: hero ? 0.9 : r.range(0.42, 0.7) };
          len = this.tfM.measure(it).width * it.size; put(it, s, n, h);
        } else if (k < 0.62) {
          const it = { text: D.MAIL_SUBJ[r.int(0, 9)], font: 'mono', size: r.range(0.06, 0.09), anchor: [0, 0], color: PAL.line, intensity: 0.65 };
          len = this.tfM.measure(it).width * it.size; put(it, s, n, h);
        } else if (k < 0.72) {
          const it = { text: D.TELEGRAMS[r.int(0, 11)], font: 'type', size: r.range(0.06, 0.085), anchor: [0, 0], color: PAL.line, intensity: 0.65 };
          len = this.tfM.measure(it).width * it.size; put(it, s, n, h);
        } else if (k < 0.82) {
          if (r.next() < 0.5) {
            const text = D.LETTER_ZH[r.int(0, 8)], size = r.range(0.07, 0.1);
            const it = { text, font: 'kai', vertical: true, size, anchor: [0.5, 0], color: PAL.line, intensity: 0.75 };
            put(it, s, n, h + 0.02); len = size * 1.6;
          } else {
            const it = { text: D.LETTER_EN[r.int(0, 6)], font: 'script', size: r.range(0.1, 0.14), anchor: [0, 0], color: PAL.line, intensity: 0.75 };
            len = this.tfM.measure(it).width * it.size; put(it, s, n, h);
          }
        } else if (k < 0.9) {
          const [, poem] = D.SLIP_POEMS[r.int(0, 2)], size = r.range(0.045, 0.06);
          const it = { text: poem.join('\n'), font: 'serif', vertical: true, size, lineHeight: 1.45, anchor: [0.5, 0], color: PAL.line, intensity: 0.75 };
          put(it, s, n, h + 0.03); len = 4 * 1.45 * size + 0.1;
        } else if (k < 0.95) {
          const text = D.YARROW_ASK[r.int(0, 3)], size = r.range(0.06, 0.08);
          const it = { text, font: 'kai', vertical: true, size, anchor: [0.5, 0], color: PAL.line, intensity: 0.7 };
          put(it, s, n, h + 0.02); len = size * 1.8;
        } else {
          const P = put({ text: ' ', font: 'mono', size: 0.01, anchor: [0, 0], color: PAL.line, intensity: 0 }, s, n, 0);
          const nS = r.int(3, 7); let L = 0;
          for (let j = 0; j < nS; j++) { const l = r.range(0.45, 0.8), x0 = r.range(0, 0.2); seg(P, [x0, h + j * 0.01, n], [x0 + l, h + j * 0.01 + r.range(-0.02, 0.02), n], 0.0045, 0.5); L = Math.max(L, x0 + l); }
          len = L;
        }
        s += len + r.range(0.2, 1.4);
      }
    }
    return { items, segs, grain };
  }

  // ------------------------------------------------------------------------------------------ warm cloud + the question
  buildWarm() {
    const r = new Rand(4242), items = [];
    // other people's questions, warm, along the camera's first two seconds (the mind's dive continues through them)
    for (let i = 0; i < 150; i++) {
      const g = r.range(44.6, 47.4), R = rig('present', g, this.river), Bs = basis(R);
      const d = r.range(2.2, 7.5), x = r.gauss() * 0.42 * d, y = r.gauss() * 0.2 * d;
      const p = [R.x + Bs.f[0] * d + Bs.r[0] * x + Bs.u[0] * y, R.y + Bs.f[1] * d + Bs.r[1] * x + Bs.u[1] * y, R.z + Bs.f[2] * d + Bs.r[2] * x + Bs.u[2] * y];
      const [lang, q] = D.Q2026[r.int(0, D.Q2026.length - 1)];
      items.push({ text: q, font: D.LATIN.has(lang) ? 'latin' : 'sans', weight: 400, pos: p, billboard: true, size: r.range(0.03, 0.055),
        color: r.next() < 0.2 ? PAL.hot : PAL.c, intensity: r.range(0.55, 1.1), show: [-1e6, 47.6 - G_REF + r.range(0, 1.2), 0, 0.9] });
    }
    this.qIdx = items.length;
    items.push({ text: '她會好起來嗎？', font: 'sans', weight: 300, pos: [0, 0, 0], billboard: 'upright', size: 0.2, color: PAL.c, intensity: 1.55 });
    return items;
  }
  // the warm question: from the cloud (ahead of the camera) down into the river, then with the current
  questionAt(G) {
    const R = this.river;
    const g0 = 45.4, g1 = 49.4, sQ = 90.0, nQ = 3.0, hQ = 0.06;
    const speed = flowSpeed(nQ, R.at(sQ).half, V_MAX);
    const riverP = g => R.world(sQ + speed * (g - g1), hQ, nQ);
    if (G >= g1) return riverP(G);
    const Rg = rig('present', g0, R), Bs = basis(Rg), d = 4.2;
    const a = [Rg.x + Bs.f[0] * d - Bs.u[0] * 0.25, Rg.y + Bs.f[1] * d - Bs.u[1] * 0.25, Rg.z + Bs.f[2] * d - Bs.u[2] * 0.25];
    if (G <= g0) return a;
    const k = easeInOutCubic((G - g0) / (g1 - g0)), b = riverP(G);
    const lift = Math.sin(Math.PI * k) * 0.6;
    return [lerp(a[0], b[0], k), lerp(a[1], b[1], k) + lift, lerp(a[2], b[2], k)];
  }

  // ------------------------------------------------------------------------------------------ big text: memory + return line
  buildBig() {
    const items = [];
    // the human's three sentences, a stanza standing in the river (flowing with the camera)
    this.memIdx = items.length;
    const vCam = (MEM_S(245) - MEM_S(211)) / 34;
    this.memSpeed = vCam;
    const s0 = STANZA.s0;                // left edge at uTime 0 (the memory camera aims at the stanza's centre)
    const hs = [0.62, 0.37, 0.12], t0 = [4.6, 5.9, 7.6];
    D.MEMORY.forEach((m, i) => items.push({ text: m, font: 'sans', weight: 300, size: 0.178, anchor: [0, 0], path: 0, s: s0, off: [hs[i] * 1.08 - 0.08, STANZA.n], speed: STANZA.v,
      color: PAL.c, intensity: 2.0, reveal: [t0[i], t0[i] + 1.3], show: [t0[i] - 0.2, 1e6, 0.4, 0] }));
    // the return line (plane, placed per frame in front of the camera)
    const line = [{ text: '她會好起來嗎？', font: 'sans', weight: 300, size: 0.15, pos: [0, 0, 0], ax: [1, 0, 0], ay: [0, 1, 0], anchor: [0.5, 0.5],
      color: PAL.c, intensity: 1.7, alpha: 0 }];
    return { stanza: items, line };
  }

  // ------------------------------------------------------------------------------------------ exhibits (one per era)
  // A plate is anchored in the world where the camera looks at time Tk, facing the camera, like an object in a vitrine.
  plate(Tk, depth, sx, sy) {
    const R = rig('upstream', Tk, this.river), Bs = basis(R);
    const ty = Math.tan(R.fov * Math.PI / 360), tx = ty * (1920 / 804);
    const kx = (sx - 960) / 960 * tx, ky = (402 - sy) / 402 * ty;
    const O = [0, 1, 2].map(i => [R.x, R.y, R.z][i] + depth * (Bs.f[i] + Bs.r[i] * kx + Bs.u[i] * ky));
    const ax = [Bs.r[0], 0, Bs.r[2]], l = Math.hypot(ax[0], ax[2]); ax[0] /= l; ax[2] /= l;
    return { O, ax, ay: [0, 1, 0], P: (x, y) => [O[0] + ax[0] * x, O[1] + y, O[2] + ax[2] * x] };
  }
  buildExhibits() {
    const items = [], lines = [];
    const T = g => g - G_REF;                      // uTime of the exhibit field
    const add = (pl, it, x, y) => { items.push({ ...it, pos: pl.P(x, y), ax: pl.ax, ay: pl.ay }); return items.length - 1; };
    const poly = (pl, pts, o) => lines.push({ points: pts.flatMap(([x, y]) => pl.P(x, y)), ...o });
    const ticks = (pl, x0, y0, x1, y1, show, k = 0.07) => {   // catalogue corner marks
      for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]])
        poly(pl, [[x + sx * k, y], [x, y], [x, y + sy * k]], { color: PAL.line, intensity: 0.32, width: 0.9, show });
    };
    const ex = {};

    // E1 · 1998 · e-mail (types itself like a terminal)
    {
      const pl = this.plate(72, 6.2, 930, 392), show = [T(69.9), T(74.3), 0.6, 0.7];
      const sz = 0.098, adv = 0.6 * sz, x0 = -24 * adv;
      const hdr = [['From:', 'Karen Whitfield <kwhitfield@aol.com>'], ['Date:', 'Sat, 21 Mar 1998 02:14:09 -0500'], ['Subject:', "Re: Mom's biopsy results"]];
      let t = 70.45;
      hdr.forEach(([k, v], i) => {
        const y = 0.36 - i * 0.155;
        add(pl, { text: k, font: 'mono', size: sz, anchor: [0, 0.5], color: PAL.line, intensity: 0.5, show, reveal: [T(t), T(t + 0.1)] }, x0, y);
        add(pl, { text: v, font: 'mono', size: sz, anchor: [0, 0.5], color: PAL.line, intensity: i === 2 ? 1.05 : 0.8, show, reveal: [T(t + 0.08), T(t + 0.08 + v.length * 0.012)] }, x0 + 9 * adv, y);
        t += 0.32;
      });
      poly(pl, [[x0, -0.09], [x0 + 46 * adv, -0.09]], { color: PAL.line, intensity: 0.3, width: 0.8, show: [T(71.4), T(74.3), 0.4, 0.7] });
      const q = ['> They want to wait two more weeks.', '> Is it serious? Will she be okay?'];
      t = 71.55;
      q.forEach((v, i) => { add(pl, { text: v, font: 'mono', size: sz, anchor: [0, 0.5], color: PAL.line, intensity: i ? 1.1 : 0.72, show, reveal: [T(t), T(t + v.length * 0.022)] }, x0, -0.24 - i * 0.155); t += 0.85; });
      ticks(pl, x0 - 0.16, -0.5, x0 + 46 * adv + 0.12, 0.5, show);
      ex.mail = pl;
    }

    // E2 · 1931 · punched tape (ITA2) and the printed strip, column for column
    {
      const pl = this.plate(76, 5.7, 960, 398), show = [T(73.9), T(78.3), 0.6, 0.7];
      const cols = D.ita2Columns(D.TELEGRAM_HERO), p = 0.066, N = cols.length, x0 = -N * p / 2;
      const yc = 0.2, tp0 = 74.55, tp1 = 77.0;
      for (const row of this.tapeRows(cols, p)) {
        add(pl, { text: row.text, font: 'mono', size: row.size, tracking: row.tracking, anchor: [0, 0], color: row.feed ? PAL.line : PAL.hot,
          intensity: row.feed ? 0.5 : 0.95, show, reveal: row.feed ? undefined : [T(tp0), T(tp1)] }, x0 + row.dx, yc + row.y + row.dy);
      }
      for (const y of [3.44, -3.44]) poly(pl, [[x0 - 0.2, yc + y * p], [x0 + N * p + 0.25, yc + y * p]], { color: PAL.line, intensity: 0.42, width: 0.9, show });
      // printed strip
      const sz = 0.082, ys = yc - 3.44 * p - 0.16;
      add(pl, { text: D.TELEGRAM_HERO, font: 'type', size: sz, tracking: p / sz - 0.6, anchor: [0, 0.5], color: PAL.line, intensity: 1.0, show,
        reveal: [T(tp0 + 0.15), T(tp1 + 0.15)] }, x0 + (p - 0.6 * sz) / 2, ys);
      for (const dy of [0.085, -0.085]) poly(pl, [[x0 - 0.04, ys + dy], [x0 + N * p + 0.04, ys + dy]], { color: PAL.line, intensity: 0.3, width: 0.8, show });
      // track numbers, caption
      ['1', '2', '', '3', '4', '5'].forEach((k, i) => { if (k) add(pl, { text: k, font: 'mono', size: 0.032, anchor: [1, 0.5], color: PAL.line, intensity: 0.4, show }, x0 - 0.06, yc + (2.5 - i) * p); });
      add(pl, { text: 'ITA2 · 5-UNIT CODE · 0.1 in', font: 'mono', size: 0.034, anchor: [0, 0.5], color: PAL.line, intensity: 0.38, show }, x0, ys - 0.17);
      ticks(pl, x0 - 0.24, ys - 0.27, x0 + N * p + 0.24, yc + 3.44 * p + 0.12, show);
      ex.tape = pl;
    }

    // E3 · 1868 · a family letter on eight-column paper, written column by column; an English letter beside it
    {
      const pl = this.plate(80, 5.5, 1020, 392), show = [T(77.9), T(82.3), 0.6, 0.7];
      const cw = 0.15, ncol = 8, wS = ncol * cw, hS = 1.32, xR = wS / 2, yT = hS / 2;
      poly(pl, [[-wS / 2, -hS / 2], [wS / 2, -hS / 2], [wS / 2, hS / 2], [-wS / 2, hS / 2], [-wS / 2, -hS / 2]], { color: PAL.line, intensity: 0.32, width: 0.9, show });
      for (let i = 1; i < ncol; i++) poly(pl, [[xR - i * cw, -hS / 2 + 0.06], [xR - i * cw, hS / 2 - 0.06]], { color: PAL.line, intensity: 0.13, width: 0.7, show });
      let t = 78.35;
      D.LETTER_HERO_ZH.forEach((col, i) => {
        const nch = [...col].length, sz = i >= 5 ? 0.09 : 0.112;
        add(pl, { text: col, font: 'kai', vertical: true, size: sz, anchor: [0.5, 1], color: PAL.line, intensity: 1.05, show, reveal: [T(t), T(t + nch * 0.075)] },
          xR - (i + 0.5) * cw, yT - 0.1 - (i === 6 ? 0.25 : 0));
        t += nch * 0.075 + 0.07;
      });
      // the English letter, to the left and a little behind
      const xE = -wS / 2 - 1.75;
      let te = 78.6;
      D.LETTER_HERO_EN.forEach((l, i) => {
        add(pl, { text: l, font: 'script', size: 0.1, anchor: [0, 0.5], color: PAL.line, intensity: 0.85, show, reveal: [T(te), T(te + l.length * 0.022)] },
          xE + (i === 0 ? 0.55 : i === 4 ? 0.5 : 0), 0.42 - i * 0.2 - (i >= 1 ? 0.05 : 0));
        te += l.length * 0.022 + 0.12;
      });
      ticks(pl, xE - 0.15, -hS / 2 - 0.12, wS / 2 + 0.15, hS / 2 + 0.12, show);
      ex.letter = pl;
    }

    // E4 · 1750 · the cylinder of bamboo sticks; one stick rises; the woodblock slip
    {
      const pl = this.plate(84, 5.2, 960, 400), show = [T(81.9), T(86.25), 0.6, 0.6];
      const cx = -0.62, cy = -0.55, rw = 0.2, rh = 0.055, ch = 0.62;
      const ell = (y, a0, a1) => { const p = []; for (let i = 0; i <= 32; i++) { const a = lerp(a0, a1, i / 32); p.push([cx + Math.cos(a) * rw, y + Math.sin(a) * rh]); } return p; };
      poly(pl, ell(cy + ch, 0, 2 * Math.PI), { color: PAL.line, intensity: 0.5, width: 1.0, show });
      poly(pl, ell(cy, Math.PI, 2 * Math.PI), { color: PAL.line, intensity: 0.5, width: 1.0, show });
      poly(pl, [[cx - rw, cy], [cx - rw, cy + ch]], { color: PAL.line, intensity: 0.5, width: 1.0, show });
      poly(pl, [[cx + rw, cy], [cx + rw, cy + ch]], { color: PAL.line, intensity: 0.5, width: 1.0, show });
      // bamboo nodes on the cylinder
      for (const f of [0.3, 0.72]) poly(pl, ell(cy + ch * f, Math.PI * 1.02, Math.PI * 1.98).map(([x, y]) => [x, y]), { color: PAL.line, intensity: 0.18, width: 0.8, show });
      this.stickRig = { pl, cx, cy: cy + ch, rw, rh, n: 34, show };
      // the slip
      const sx = 0.55, sw = 0.82, sh = 1.12, sy = 0.0;
      for (const g of [0, 0.022]) poly(pl, [[sx - sw / 2 - g, sy - sh / 2 - g], [sx + sw / 2 + g, sy - sh / 2 - g], [sx + sw / 2 + g, sy + sh / 2 + g], [sx - sw / 2 - g, sy + sh / 2 + g], [sx - sw / 2 - g, sy - sh / 2 - g]],
        { color: PAL.line, intensity: g ? 0.3 : 0.55, width: g ? 0.8 : 1.0, show: [T(83.55), T(86.25), 0.35, 0.6] });
      poly(pl, [[sx - sw / 2, sy + sh / 2 - 0.2], [sx + sw / 2, sy + sh / 2 - 0.2]], { color: PAL.line, intensity: 0.35, width: 0.8, show: [T(83.55), T(86.25), 0.35, 0.6] });
      const sshow = [T(83.6), T(86.25), 0.45, 0.6];
      add(pl, { text: '第一籤　甲子', font: 'serif', size: 0.07, tracking: 0.15, anchor: [0.5, 0.5], color: PAL.line, intensity: 0.95, show: sshow }, sx, sy + sh / 2 - 0.1);
      D.SLIP_POEMS[0][1].forEach((ln, i) => add(pl, { text: ln, font: 'serif', vertical: true, size: 0.098, anchor: [0.5, 1], color: PAL.line, intensity: 1.05, show: [T(83.75 + 0.12 * i), T(86.25), 0.4, 0.6] },
        sx + 0.27 - i * 0.18, sy + sh / 2 - 0.27));
      add(pl, { text: '甲子', font: 'serif', vertical: true, size: 0.05, anchor: [0.5, 1], color: PAL.hot, intensity: 0.0, show }, cx, cy + ch + 0.5);   // label on the chosen stick (placed per frame)
      this.stickLabel = items.length - 1;
      ticks(pl, cx - rw - 0.25, cy - 0.2, sx + sw / 2 + 0.2, sy + sh / 2 + 0.2, show);
      ex.temple = pl;
    }

    // E5 · 800 BCE · forty-nine stalks: divided, hung, counted by fours; six lines drawn: 未濟
    {
      const pl = this.plate(90.6, 5.0, 900, 405), show = [T(86.0), T(92.6), 0.5, 0.8];
      this.yarrowPl = pl;
      add(pl, { text: D.XICI, font: 'serif', size: 0.055, tracking: 0.25, anchor: [0, 0.5], color: PAL.line, intensity: 0.55, show: [T(86.3), T(92.6), 0.6, 0.8] }, -1.42, 0.62);
      this.yarrowNotes = [];
      const note = (text, x, y, t0, t1, I = 0.6, font = 'mono', size = 0.045) => { this.yarrowNotes.push(add(pl, { text, font, size, anchor: [0, 0.5], color: PAL.line, intensity: I, show: [T(t0), T(t1), 0.2, 0.3] }, x, y)); };
      note('50', -1.42, -0.62, 86.4, 87.0);
      note('49', -1.42, -0.62, 87.0, 92.6);
      note('49 − 9 = 40', -0.98, -0.62, 88.55, 92.6, 0.62);
      note('40 − 4 = 36', -0.98, -0.7, 89.15, 92.6, 0.5);
      note('36 − 4 = 32 = 4 × 8', -0.98, -0.78, 89.7, 92.6, 0.5);
      // hexagram lines (values) and name
      const hx = 0.62, hy = -0.42, step = 0.15;
      this.hexPos = { hx, hy, step, w: 0.56 };
      D.HEX.lines.forEach((v, i) => note(String(v), hx + 0.66, hy + i * step, YAO_T[i] + 0.15, 92.6, 0.45, 'mono', 0.04));
      add(pl, { text: D.HEX.name, font: 'serif', vertical: true, size: 0.13, anchor: [0.5, 1], color: PAL.line, intensity: 1.05, show: [T(91.15), T(92.6), 0.45, 0.8] }, hx + 0.92, hy + 5 * step + 0.06);
      add(pl, { text: D.HEX.judgement, font: 'serif', vertical: true, size: 0.045, anchor: [0.5, 1], color: PAL.line, intensity: 0.5, show: [T(91.35), T(92.6), 0.45, 0.8] }, hx + 1.08, hy + 5 * step + 0.06);
      ex.yarrow = pl;
    }
    this.exLines = new FLines({ resolution: this.res, aperture: 0.05, focus: 8 });
    // FLines has no per-line time window: keep the exhibits' static lines with their show windows and set them per frame
    this.exLineDefs = lines;
    this.stalks = new FLines({ resolution: this.res, aperture: 0.05, focus: 7 });
    this.yao = new FLines({ resolution: this.res, aperture: 0.05, focus: 7 });
    return { items, ex };
  }

  // ------------------------------------------------------------------------------------------ streams, source, convergence
  buildStreams() {
    const R = this.river, polys = [];
    const N = 13;
    for (let i = 0; i < N; i++) {
      const u = Math.sin((-1 + 2 * (i + 0.5) / N) * Math.PI / 2 * 0.96);
      const pts = [];
      for (let s = -0.2; s <= RIVER.S; s += 0.5) { const f = R.at(Math.max(0, s)); pts.push(f.x + f.nx * u * f.half, 0.0, f.z + f.nz * u * f.half); }
      polys.push({ points: pts, color: PAL.line, intensity: 0.03 + 0.018 * hash1(i), width: 0.6, u0: 0, u1: RIVER.S, phase: hash1(i * 3.1) * 7, flowAmt: 1 });
    }
    this.streams = new FLines({ resolution: this.res, flow: 0.55, flowFreq: 1 / 7, flowSpeed: V_MAX / 7, flowSharp: 8, flowBase: 0.3, fade: [70, 130] });
    this.streams.setPolylines(polys);
  }

  buildSource() {
    const R = this.river, s0 = R.at(0), L = CRACK.L;
    // crack unit frame: y up = -T (upstream), x right = -N; the lower end (0.018, -0.651) sits at s = 0
    const Cg = crackGeometry();
    const P = ([x, y]) => { const yy = y - (-0.651); return [s0.x - s0.tx * yy * L - s0.nx * (x - 0.018) * L, 0.002, s0.z - s0.tz * yy * L - s0.nz * (x - 0.018) * L]; };
    const glow = [], core = [];
    for (const ln of Cg.lines) {
      const pts = ln.pts.flatMap(P), m = ln.pts.length;
      const widths = ln.pts.map((_, i) => (ln.w0 + (ln.w1 - ln.w0) * Math.pow(ln.cum[i] / ln.L, 0.7)));
      core.push({ points: pts, color: PAL.hot, intensity: 1.15 * ln.glow, widths: widths.map(w => 2.0 * w + 0.35) });
      glow.push({ points: pts, color: PAL.c, intensity: 0.16 * ln.glow, widths: widths.map(w => 7 * w + 2) });
      if (m < 2) continue;
    }
    this.crackCore = new FLines({ resolution: this.res }); this.crackCore.setPolylines(core);
    this.crackGlow = new FLines({ resolution: this.res }); this.crackGlow.setPolylines(glow);
    const J = P([0, 0]);
    this.J = J;
    // firelight: a breathing pool of warm light on the ground around the source
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.fire = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 }, uC: { value: new THREE.Vector3(...C(PAL.c)) }, uH: { value: new THREE.Vector3(...C(PAL.hot)) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uI; uniform vec3 uC, uH; varying vec2 vUv;
        void main(){ vec2 p = (vUv - 0.5) * 2.0; float r2 = dot(p, p);
          float edge = 1.0 - smoothstep(0.55, 1.0, sqrt(r2));
          vec3 c = uC * (0.55 * exp(-r2 * 7.0) + 0.22 * exp(-r2 * 2.4) * edge) + uH * 0.35 * exp(-r2 * 40.0);
          gl_FragColor = vec4(c * uI, 1.0); }`,
    }));
    this.fire.position.set(J[0], -0.01, J[2]);
    this.fire.scale.set(10, 1, 10);
  }

  buildConverge() {
    this.conv = new FLines({ resolution: this.res });
    const r = new Rand(99);
    this.convDefs = Array.from({ length: 64 }, (_, i) => ({ y: r.range(-0.42, 0.5), x0: r.range(-1.1, 0.2), len: r.range(0.3, 1.2), t: r.range(0, 0.35), I: r.range(0.06, 0.2), lane: -1 + 2 * (i + 0.5) / 64 }));
  }

  // ------------------------------------------------------------------------------------------ per-frame helpers
  setCamera(R, shot) {
    const cam = this.camera, Bs = basis(R);
    cam.aspect = shot._aspect || this.ctx.aspect; cam.fov = R.fov; cam.updateProjectionMatrix();
    cam.position.set(R.x, R.y, R.z);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...Bs.r), new THREE.Vector3(...Bs.u), new THREE.Vector3(-Bs.f[0], -Bs.f[1], -Bs.f[2]));
    cam.quaternion.setFromRotationMatrix(m);
    cam.updateMatrixWorld();
    return Bs;
  }

  // exhibit lines that are visible at uTime ut (FLines has no time windows, so filter on the CPU per frame)
  exhibitLines(ut) {
    const out = [];
    for (const L of this.exLineDefs) {
      const [a, b, fi, fo] = L.show;
      const k = Math.min(fi > 0 ? smoothstep(a, a + fi, ut) : (ut >= a ? 1 : 0), fo > 0 ? 1 - smoothstep(b - fo, b, ut) : (ut <= b ? 1 : 0));
      if (k > 0.002) out.push({ ...L, intensity: L.intensity * k });
    }
    return out;
  }

  stickLines(G) {
    const S = this.stickRig, out = [];
    if (!S) return out;
    const ut = G - G_REF, [a, b, fi, fo] = S.show;
    const vis = Math.min(smoothstep(a, a + fi, ut), 1 - smoothstep(b - fo, b, ut));
    if (vis <= 0.002) { if (this.stickTop) this.stickTop = { ...this.stickTop, vis: 0, rise: 0 }; return out; }
    const shake = G > 82.2 && G < 83.4 ? Math.sin((G - 82.2) * 34) * Math.exp(-Math.pow(G - 82.8, 2) * 6) : 0;
    const rise = easeInOutCubic(smoothstep(83.25, 83.95, G));
    for (let i = 0; i < S.n; i++) {
      const h1 = hash1(i * 7.13), h2 = hash1(i * 3.71 + 1), h3 = hash1(i * 1.37 + 5);
      const x = S.cx + (h1 * 2 - 1) * S.rw * 0.78, ang = (h2 - 0.5) * 0.42 + shake * 0.06 * (h3 - 0.5) * 2;
      const len = 0.55 + 0.32 * h3 + (i === 7 ? 0.42 * rise : 0);
      const y0 = S.cy + (h3 - 0.5) * S.rh * 1.2;
      const top = [x + Math.sin(ang) * len, y0 + Math.cos(ang) * len];
      const chosen = i === 7;
      out.push({ points: [...S.pl.P(x, y0), ...S.pl.P(top[0], top[1])], color: chosen && rise > 0 ? mixc(PAL.line, PAL.hot, rise) : PAL.line,
        intensity: (chosen ? 0.75 + 0.5 * rise : 0.48) * vis, width: 2.2 });
      if (chosen) this.stickTop = { x: top[0] - Math.sin(ang) * 0.08, y: top[1] - 0.05, rise, vis };
    }
    return out;
  }

  // the yarrow ritual, as a pure function of G (see riverdata.js YARROW_CHANGES)
  stalkLines(G) {
    const pl = this.yarrowPl, out = [];
    const vis = smoothstep(86.0, 86.5, G) * (1 - smoothstep(92.0, 92.6, G));
    if (vis <= 0.002) return out;
    const sp = 0.034, N = 50;
    const st = Array.from({ length: N }, (_, j) => ({ x: (j - 24.5) * sp, y: 0, I: 0.62, out: false }));
    // phase 1: one stalk set aside
    const kA = easeInOutCubic(smoothstep(86.8, 87.3, G));
    st[0].x = lerp(st[0].x, -0.97, kA); st[0].y = lerp(0, 0.18, kA); st[0].I = lerp(0.62, 0.25, kA);
    // the 49 close up, then the three changes
    const live = Array.from({ length: 49 }, (_, j) => j + 1);
    const pile = [];   // removed stalks (to the lower left)
    const changes = D.YARROW_CHANGES, tc = [87.3, 88.65, 89.25], dur = [1.25, 0.6, 0.6];
    let pool = live.slice();
    for (let c = 0; c < 3; c++) {
      const t0 = tc[c], d = dur[c];
      const n = pool.length, [nl] = changes[c];
      const ks = easeInOutCubic(smoothstep(t0, t0 + d * 0.3, G));        // split
      const kh = easeInOutCubic(smoothstep(t0 + d * 0.3, t0 + d * 0.45, G)); // hang one from the right
      const kc = easeInOutCubic(smoothstep(t0 + d * 0.45, t0 + d * 0.8, G)); // count by fours
      const kr = easeInOutCubic(smoothstep(t0 + d * 0.8, t0 + d, G));       // remainders away, close up
      if (G < t0) break;
      const Lg = pool.slice(0, nl), Rg = pool.slice(nl);
      const hung = Rg[0], Rc = Rg.slice(1);
      const remL = Lg.length % 4 || 4, remR = Rc.length % 4 || 4;
      const gap = 0.16 * ks;
      const place = (grp, side) => grp.forEach((j, i) => {
        const base = (pool.indexOf(j) - (n - 1) / 2) * sp;
        const bundle = Math.floor(i / 4), cnt = grp.length;
        const isRem = i >= cnt - (side < 0 ? remL : remR);
        const bx = base + side * gap + side * 0 + (bundle - (cnt / 4) / 2) * 0.022 * kc * (side < 0 ? 1 : 1);
        st[j].x = bx; st[j].y = 0; st[j].I = 0.62 + (isRem ? 0.5 * kc : 0);
        if (isRem) { st[j].y = -0.22 * kc; st[j].remove = true; }
      });
      place(Lg, -1); place(Rc, 1);
      st[hung].x = lerp((pool.indexOf(hung) - (n - 1) / 2) * sp + gap, 0, kh); st[hung].y = lerp(0, 0.28, kh); st[hung].I = 0.62 + 0.4 * kh; st[hung].remove = true;
      // removed stalks go to the pile at the lower left, the rest close up
      const removed = pool.filter(j => st[j].remove), kept = pool.filter(j => !st[j].remove);
      if (kr > 0) {
        removed.forEach((j, i) => { const px = -0.97 + 0.012 * (pile.length + i), py = -0.36; st[j].x = lerp(st[j].x, px, kr); st[j].y = lerp(st[j].y, py, kr); st[j].I = lerp(st[j].I, 0.22, kr); });
        kept.forEach((j, i) => { st[j].x = lerp(st[j].x, (i - (kept.length - 1) / 2) * sp, kr); st[j].y = lerp(st[j].y, 0, kr); });
      }
      if (G >= t0 + d) { removed.forEach(j => { st[j].x = -0.97 + 0.012 * pile.length; st[j].y = -0.36; st[j].I = 0.22; pile.push(j); }); pool = kept; for (const j of pool) st[j].remove = false; }
      else break;
    }
    // after the third change: 32 stalks in eight bundles of four
    const kb = easeInOutCubic(smoothstep(89.85, 90.15, G));
    if (kb > 0 && pool.length === 32) pool.forEach((j, i) => { st[j].x += Math.floor(i / 4) * 0.02 * kb - 0.07 * kb; st[j].I = 0.62 + 0.15 * kb; });
    // lines 2..6: the stalks gather and divide again, quickly (abbreviated)
    for (let i = 1; i < 6; i++) {
      const k = Math.sin(Math.PI * clamp((G - (YAO_T[i] - 0.28)) / 0.32, 0, 1));
      if (k > 0) pool.forEach((j, q) => { st[j].x += (q < pool.length / 2 ? -1 : 1) * 0.07 * k; });
    }
    st.forEach((q, j) => {
      const h1 = hash1(j * 5.17), h2 = hash1(j * 2.31 + 4);
      const len = 0.62 + 0.1 * h1, bow = (h2 - 0.5) * 0.03, x = q.x - 0.45, y = q.y - 0.12;
      const pts = [];
      for (let k = 0; k <= 5; k++) { const v = k / 5; pts.push(...pl.P(x + bow * Math.sin(Math.PI * v) + (h1 - 0.5) * 0.02 * v, y + v * len)); }
      out.push({ points: pts, color: WARM_LINE, intensity: q.I * vis, width: 1.25 });
    });
    return out;
  }

  // brush strokes of the six lines (bundles of hairlines with uneven ends: the dry-brush 飛白)
  yaoLines(G) {
    const pl = this.yarrowPl, out = [];
    const vis = 1 - smoothstep(92.0, 92.6, G);
    if (vis <= 0.002) return out;
    const { hx, hy, step, w } = this.hexPos;
    D.HEX.lines.forEach((v, i) => {
      const t0 = YAO_T[i], k = easeOutCubic(smoothstep(t0, t0 + 0.26, G));
      if (k <= 0) return;
      const yang = v % 2 === 1, y = hy + i * step;
      const parts = yang ? [[0, w]] : [[0, w * 0.43], [w * 0.57, w]];
      parts.forEach(([a, b], pi) => {
        for (let hline = 0; hline < 9; hline++) {
          const hh = hash1(i * 31.7 + pi * 7.1 + hline * 1.93), hh2 = hash1(i * 13.3 + hline * 5.7 + pi);
          const dy = (hline - 4) / 4 * 0.022 * (0.85 + 0.3 * hh);
          const xa = a + (hh - 0.5) * 0.02 + (Math.abs(dy) > 0.016 ? 0.02 : 0), xbFull = b - hh2 * 0.035 * (Math.abs(dy) / 0.022);
          const xb = lerp(xa, xbFull, clamp((k * (b - 0) - a) / Math.max(b - a, 1e-3) * 1.0 + (pi === 1 ? 0 : 0), 0, 1));
          if (xb - xa < 0.005) continue;
          const pts = [];
          for (let q = 0; q <= 6; q++) { const u = q / 6, x = lerp(xa, xb, u); pts.push(...pl.P(hx + x, y + dy + Math.sin(u * 3.1 + hh * 6) * 0.003)); }
          out.push({ points: pts, color: WARM_LINE, intensity: (0.5 + 0.35 * hh2) * vis * (Math.abs(dy) > 0.018 ? 0.5 : 1), width: 1.1 });
        }
      });
    });
    return out;
  }

  // ------------------------------------------------------------------------------------------ update
  update(shot, t) {
    const mode = shot.mode || 'present';
    const G = shot.start + t;
    const fk = Math.round(G * 24);
    let R, tau = G;
    if (mode === 'return') { R = rig('return', G, this.river); tau = returnTau(G); }
    else if (mode === 'memory') R = rig('memory', G, this.river);
    else R = rig('upstream', clamp(G, 44, 104), this.river);
    this.setCamera(R, shot);
    const cam = this.camera;
    const all = [this.streams.mesh, this.fire, this.crackGlow.mesh, this.crackCore.mesh, this.plR.mesh, this.plM.mesh, this.tfR.mesh, this.tfG.mesh, this.tfM.mesh, this.tfMG.mesh,
      this.tfH.mesh, this.exLines.mesh, this.stalks.mesh, this.yao.mesh, this.tfW.mesh, this.conv.mesh, this.tfB.mesh, this.tfL.mesh];
    for (const m of all) m.visible = false;
    let post;

    if (mode === 'memory') post = this.updateMemory(G, R, fk);
    else {
      // ---- the river (present + eras), shared by present, upstream and return
      const ut = tau - G_REF;
      const fd = mode === 'return' ? focusRet(clamp(G, 159, 173))[1] : focusDist(clamp(G, 44, 104));
      const focus = mode === 'return' ? fd * 0.9 : fd * 0.88;
      for (const f of [this.tfR, this.tfG, this.plR]) { f.uniforms.uTime.value = ut; f.uniforms.uFocus.value = focus; f.uniforms.uAperture.value = mode === 'return' ? 0.05 : lerp(0.07, 0.05, smoothstep(70, 86, G)); }
      // dim the river for the convergence (return) and as the source takes over (upstream)
      let op = 1;
      if (mode === 'return') op = 1 - 0.95 * smoothstep(169.8, 171.2, G);
      else {
        let hold = 0;
        for (const tk of [72, 76, 80, 84]) hold = Math.max(hold, envelope(G, tk - 1.9, tk + 1.7, 0.6, 0.5));
        hold = Math.max(hold, envelope(G, 86.6, 92.0, 0.6, 0.6));
        op = (1 - 0.42 * hold) * (1 - 0.55 * smoothstep(94, 99.5, G));
      }
      this.tfR.uniforms.uOpacity.value = op; this.plR.uniforms.uOpacity.value = op; this.tfG.uniforms.uOpacity.value = op;
      this.tfR.cull(cam, ut, mode === 'return' ? fk * 2 + 1 : fk);
      this.tfG.cull(cam, ut, mode === 'return' ? fk * 2 + 1 : fk);
      this.tfR.mesh.visible = true; this.plR.mesh.visible = true; this.tfG.mesh.visible = true;
      this.streams.uniforms.uTime.value = ut;
      this.streams.uniforms.uOpacity.value = mode === 'return' ? op : 1;
      this.streams.mesh.visible = true;

      // the source: firelight and the crack (from the yarrow era on, and at the start of the return)
      const fireK = mode === 'return' ? 0.45 * (1 - smoothstep(160.6, 162.0, G)) : smoothstep(88.5, 95.5, G);
      if (fireK > 0.002) {
        const breathe = 1 + 0.1 * Math.sin(G * 2 * Math.PI / 4.1) + 0.05 * Math.sin(G * 2 * Math.PI / 2.63 + 1.3);
        this.fire.material.uniforms.uI.value = 0.3 * fireK * breathe;
        this.crackCore.uniforms.uOpacity.value = fireK * (0.9 + 0.1 * Math.sin(G * 2 * Math.PI / 3.3));
        this.crackGlow.uniforms.uOpacity.value = fireK * breathe;
        this.fire.visible = this.crackCore.mesh.visible = this.crackGlow.mesh.visible = true;
      }

      if (mode !== 'return') {
        // exhibits
        const ue = G - G_REF;
        this.tfH.uniforms.uTime.value = ue;
        if (G > 69 && G < 93) {
          const pls = this.ex.ex, keys = [[72, pls.mail], [76, pls.tape], [80, pls.letter], [84, pls.temple], [89.5, pls.yarrow]];
          let best = keys[0][1], bd = 1e9; for (const [tk, pl] of keys) if (Math.abs(G - tk) < bd) { bd = Math.abs(G - tk); best = pl; }
          const ef = Math.hypot(best.O[0] - R.x, best.O[1] - R.y, best.O[2] - R.z);
          this.tfH.uniforms.uFocus.value = ef;
          for (const f of [this.exLines, this.stalks, this.yao]) f.uniforms.uFocus.value = ef;
          this.exLines.setPolylines([...this.exhibitLines(ue), ...this.stickLines(G)]);
          const st = this.stickTop;   // set by stickLines() for this G (zero intensity outside the temple)
          if (st) this.tfH.update(this.stickLabel, { pos: this.stickRig.pl.P(st.x, st.y), intensity: 0.9 * st.rise * st.vis });
          this.stalks.setPolylines(this.stalkLines(G)); this.yao.setPolylines(this.yaoLines(G));
          this.tfH.cull(cam, ue, fk);
          this.tfH.mesh.visible = this.exLines.mesh.visible = this.stalks.mesh.visible = this.yao.mesh.visible = true;
        }
        // the warm cloud and the warm question
        if (G < 61) {
          this.tfW.uniforms.uTime.value = G - G_REF;
          this.tfW.update(this.qIdx, { pos: this.questionAt(G), alpha: 1 - smoothstep(58.5, 61, G) });
          this.tfW.uniforms.uFocus.value = lerp(4.5, fd * 0.9, smoothstep(45.5, 49.5, G));
          this.tfW.mesh.visible = true;
        }
      } else {
        // convergence into the one line (170 -> 172)
        this.updateConverge(G, R);
      }
      post = mode === 'return'
        ? { bloomStrength: 0.4, bloomThreshold: 0.9, streak: 0.0, halation: 0.05, vignette: 0.4, grain: 0.014 }
        : { bloomStrength: lerp(0.32, 0.5, fireK), bloomThreshold: 0.95, streak: 0.0, halation: lerp(0.03, 0.12, fireK), vignette: 0.38, grain: 0.014 };
    }
    return { scene: this.scene, camera: cam, post };
  }

  updateConverge(G, R) {
    const k = smoothstep(169.6, 171.0, G);
    if (G < 169.4) return;
    const Bs = basis(R), d = 6;
    const ty = Math.tan(R.fov * Math.PI / 360), tx = ty * (1920 / 804);
    const yL = (402 - 330) / 402 * ty * d;
    const O = [0, 1, 2].map(i => [R.x, R.y, R.z][i] + d * Bs.f[i] + Bs.u[i] * yL);
    const at = (x, y) => [O[0] + Bs.r[0] * x + Bs.u[0] * y, O[1] + Bs.r[1] * x + Bs.u[1] * y, O[2] + Bs.r[2] * x + Bs.u[2] * y];
    const lineW = 0.15 * 7 * 1.0;   // width of the line in world units (7 glyphs at 1 em)
    const polys = [];
    for (const c of this.convDefs) {
      const kk = easeInOutCubic(clamp((k - c.t) / (1 - c.t * 0.6), 0, 1));
      const y = lerp(c.y * tx * d * 0.42, c.lane * 0.068, kk);
      const xa = lerp(c.x0 * tx * d * 0.9, -lineW / 2 * (0.92 + 0.08 * hash1(c.lane * 9)), kk), xb = lerp(xa + c.len * tx * d * 0.5, lineW / 2 * (0.92 + 0.08 * hash1(c.lane * 7)), kk);
      const I = c.I * smoothstep(169.4, 170.0, G) * (1 - smoothstep(170.75, 171.45, G)) * (0.7 + 0.5 * kk);
      if (I <= 0.003) continue;
      polys.push({ points: [...at(xa, y), ...at(xb, y)], color: mixc(PAL.line, PAL.c, kk), intensity: I, width: 0.7 });
    }
    this.conv.setPolylines(polys); this.conv.mesh.visible = polys.length > 0;
    // the line itself
    const a = smoothstep(170.6, 171.3, G);
    this.tfL.update(0, { pos: O, ax: [Bs.r[0], Bs.r[1], Bs.r[2]], ay: [Bs.u[0], Bs.u[1], Bs.u[2]], alpha: a, reveal: [170.6 - 160, 171.4 - 160] });
    this.tfL.uniforms.uTime.value = G - 160;
    this.tfL.mesh.visible = true;
  }

  updateMemory(G, R, fk) {
    const ut = G - 212;
    // focus on the stanza (the camera follows it)
    const sS = STANZA.s0 + STANZA.v * (G - STANZA.g0) + STANZA.w / 2, Pst = this.river.world(sS, STANZA.h, STANZA.n);
    const fd = Math.hypot(Pst[0] - R.x, Pst[1] - R.y, Pst[2] - R.z) / 0.92;
    for (const f of [this.tfM, this.tfMG, this.plM]) { f.uniforms.uTime.value = ut; f.uniforms.uFocus.value = fd * 0.92; }
    // dark under the chat (212-219), then the river comes up; brightest around 232
    const op = lerp(0.15, 0.82, smoothstep(218.5, 225, G)) * (1 + 0.16 * envelope(G, 226, 240, 5, 6));
    this.tfM.uniforms.uOpacity.value = op; this.plM.uniforms.uOpacity.value = op; this.tfMG.uniforms.uOpacity.value = op;
    this.tfM.cull(this.camera, ut, fk); this.tfMG.cull(this.camera, ut, fk);
    this.tfM.mesh.visible = this.plM.mesh.visible = this.tfMG.mesh.visible = true;
    this.streams.uniforms.uTime.value = ut;
    this.streams.uniforms.uOpacity.value = op * 0.8;
    this.streams.mesh.visible = true;
    // the stanza
    this.tfB.uniforms.uTime.value = ut;
    this.tfB.uniforms.uFocus.value = fd * 0.92;
    this.tfB.mesh.visible = true;
    return { bloomStrength: 0.48, bloomThreshold: 0.9, streak: 0.0, halation: 0.09, vignette: 0.42, grain: 0.014, lift: [0.0018, 0.0014, 0.0010] };
  }

  dispose() {
    for (const f of [this.tfR, this.tfG, this.tfH, this.tfW, this.tfM, this.tfMG, this.tfB, this.tfL, this.plR, this.plM, this.streams, this.exLines, this.stalks, this.yao, this.crackCore, this.crackGlow, this.conv]) f?.dispose();
  }
}

// The return replays the river backwards in time, in step with the camera, so every era is in place when the camera
// passes it: tau = the moment the upstream journey looked at the same spot. Braking into the convergence, tau
// eases into real time so the current flows downstream again.
const tauMap = G => viewTime(focusRet(clamp(G, 159, 173))[0]);
function returnTau(G) {
  const g = 168.4;
  if (G <= g) return tauMap(G);
  const slope = (tauMap(g) - tauMap(g - 0.2)) / 0.2;      // < 0
  const x = G - g, k = smoothstep(0, 1.6, x);
  return tauMap(g) + slope * x * (1 - k) * 0.5 + x * k;
}

// when each of the six lines is brushed in (the first after three full changes)
const YAO_T = [89.95, 90.3, 90.62, 90.94, 91.26, 91.58];
