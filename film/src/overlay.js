// 2D overlay: chat interface, trace reticles + distance line, minimal HUD, split seam, cards, title.
// Everything is a pure function of global time T, drawn in a 1920x804 design space.
import { clamp, lerp, smoothstep, envelope, easeOutBack, easeOutCubic, easeInOutCubic, easeInCubic } from './lib/ease.js';
import { hash1 } from './lib/random.js';
import { crackGeometry, crackReach } from './lib/crack.js';
import { CSS } from './look/palette.js';

const BW = 1920, BH = 804, M = 56;
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const WHITE = a => rgba(CSS.line, a);
const COL = { c: CSS.c, si: CSS.si };
const MONO = (w, px) => `${w} ${px}px JBMono, NotoSansTC`;
const SANS = (w, px) => `${w} ${px}px NotoSansTC`;
const SERIF = (w, px) => `${w} ${px}px NotoSerifTC`;
const CORMI = (w, px) => `italic ${w} ${px}px CormorantItalic`;
const CINZEL = (w, px) => `${w} ${px}px Cinzel`;

const inAny = (T, ranges) => (ranges || []).some(([a, b]) => T >= a && T <= b);
const rangeAlpha = (T, ranges, f = 0.4) => { for (const [a, b] of ranges || []) if (T >= a - f && T <= b + f) return envelope(T, a - 0.001, b, f, f); return 0; };
function sup(n) { const m = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }; return String(n).split('').map(c => m[c] ?? c).join(''); }
const fmtInt = n => Math.round(n).toLocaleString('en-US');

// keyframe interpolation; log-space when both values are positive and far apart
function keyInterp(keys, T, log = true) {
  if (T <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (T <= t1) {
      const k = easeInOutCubic(clamp((T - t0) / Math.max(t1 - t0, 1e-6)));
      if (log && v0 > 0 && v1 > 0) return Math.exp(lerp(Math.log(v0), Math.log(v1), k));
      return lerp(v0, v1, k);
    }
  }
  return keys[keys.length - 1][1];
}
function fmtDist(d) {
  if (d <= 0.00005) return '0.0 mm';
  if (d < 0.01) return `${(d * 1000).toFixed(1)} mm`;
  if (d < 1) return `${(d * 100).toFixed(1)} cm`;
  if (d < 1000) return `${d.toFixed(1)} m`;
  if (d < 1e14) return `${fmtInt(d / 1000)} km`;
  return `${(d / 9.4607e15).toFixed(1)} 光年 · LY`;
}

export class Overlay {
  constructor(timeline, width, height) {
    this.tl = timeline; this.W = width; this.H = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width; this.canvas.height = height;
    this.g = this.canvas.getContext('2d');
    this.s = width / BW;
    this.trace = [...(timeline.trace || [])].sort((a, b) => a.t - b.t);
    this.firstSplit = (timeline.shots.find(s => s.split) || {}).start;
  }

  draw(info) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.setTransform(this.s, 0, 0, this.s, 0, 0);
    g.textBaseline = 'alphabetic';
    const { T, shot } = info;
    if (shot.split) this.drawSeam(T, shot);
    this.drawHUD(T);
    this.drawChat(T);
    this.drawToData(T);
    this.drawLift(T);
    this.drawTrace(T, info.targets || {});
    for (const c of this.tl.cards || []) if (T >= c.start - 0.01 && T <= c.end + 0.01) this.drawCard(c, T);
    return this.canvas;
  }

  // ---------------------------------------------------------------- helpers
  text(str, x, y, font, color, { align = 'left', ls = 0, shadow = 0 } = {}) {
    const g = this.g;
    g.font = font; g.fillStyle = color; g.textAlign = align; g.letterSpacing = `${ls}px`;
    if (shadow) { g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = shadow * this.s; } else { g.shadowColor = 'transparent'; g.shadowBlur = 0; }
    const dx = align === 'center' ? ls / 2 : align === 'right' ? ls : 0;
    g.fillText(str, x + dx, y);
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.letterSpacing = '0px';
  }
  width(str, font, ls = 0) { const g = this.g; g.font = font; g.letterSpacing = `${ls}px`; const w = g.measureText(str).width; g.letterSpacing = '0px'; return w; }
  line(x1, y1, x2, y2, color, w = 1, dash = null) {
    const g = this.g; g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
  }

  // ---------------------------------------------------------------- split seam
  drawSeam(T, shot) {
    const x = (this.tl.split?.seam ?? 0.5) * BW;
    let a = 0.5;
    const sf = shot.split.seamFade; if (sf) a *= 1 - smoothstep(sf[0], sf[1], T);
    const grow = this.firstSplit != null ? easeInOutCubic(clamp((T - this.firstSplit) / 1.4)) : 1;
    if (a <= 0.002) return;
    const h = BH * grow;
    this.line(x, BH / 2 - h / 2, x, BH / 2 + h / 2, WHITE(a), 1);
    for (let y = 22; y < BH; y += 40) if (Math.abs(y - BH / 2) < h / 2) this.line(x - 3, y, x + 3, y, WHITE(a * 0.4), 1);
    const la = a * smoothstep(0.6, 1.6, T - (this.firstSplit ?? 0));
    this.text('你 · YOU', x - 18, 50, MONO(400, 12), rgba(CSS.c, la * 1.6), { align: 'right', ls: 3 });
    this.text('我 · ME', x + 18, 50, MONO(400, 12), rgba(CSS.si, la * 1.6), { ls: 3 });
  }

  // ---------------------------------------------------------------- HUD
  drawHUD(T) {
    const h = this.tl.hud; if (!h) return;
    // chat clock (top centre, tiny)
    for (const [a, b, txt] of h.clock || []) {
      const ca = envelope(T, a, b, 0.6, 0.4);
      if (ca > 0.002) this.text(txt, BW / 2, 46, MONO(300, 12), WHITE(0.45 * ca), { align: 'center', ls: 4 });
    }
    const a = rangeAlpha(T, h.show, 0.5);
    if (a <= 0.002) return;
    // viewfinder corners
    const cl = 16, ci = 28, ca = 0.26 * a;
    for (const [x, y, sx, sy] of [[ci, ci, 1, 1], [BW - ci, ci, -1, 1], [ci, BH - ci, 1, -1], [BW - ci, BH - ci, -1, -1]]) {
      this.line(x, y, x + cl * sx, y, WHITE(ca)); this.line(x, y, x, y + cl * sy, WHITE(ca));
    }
    // top-left: the year (CE / BCE), linear in time between keys so it rolls like an odometer
    if (h.year) {
      const y0 = Math.round(keyInterp(h.year, T, false)), y = y0 === 0 ? 1 : y0;   // there is no year 0
      const s = y > 0 ? `${y}` : `公元前 ${-y} 年 · ${-y} BCE`;
      this.g.fillStyle = rgba(CSS.si, 0.9 * a); this.g.beginPath(); this.g.arc(M + 4, M - 4.5, 3.2, 0, Math.PI * 2); this.g.fill();
      this.text('YEAR · 年', M + 16, M, MONO(400, 11), WHITE(0.6 * a), { ls: 3 });
      this.text(s, M, M + 28, MONO(300, 18), WHITE(0.9 * a), { ls: 2 });
      this.line(M, M + 42, M + 260, M + 42, WHITE(0.2 * a));
    }
    // place label under the year
    for (const [p0, p1, zh, en] of h.place || []) {
      const pa = a * envelope(T, p0, p1, 0.6, 0.6);
      if (pa > 0.002) { this.text(zh, M, M + 70, SANS(300, 16), WHITE(0.85 * pa), { ls: 3 }); this.text(en, M, M + 90, MONO(300, 10), WHITE(0.55 * pa), { ls: 3 }); }
    }
  }

  // ---------------------------------------------------------------- chat
  msgState(m, T) {
    let text = '', caret = null, sentAt = null, lastKey = -1, typeStart = null, liftAt = null, liftText = null;
    for (const op of m.ops) {
      const [kind, t0] = op;
      if (kind === 'caret') { if (T >= t0) caret = t0; }
      else if (kind === 'type') {
        const str = [...op[2]], d = op[3];
        let ti = t0;
        if (typeStart == null) typeStart = t0;
        for (let i = 0; i < str.length; i++) {
          if (i > 0) ti += Array.isArray(d) ? (d[i] ?? d[d.length - 1]) : d;
          if (T >= ti) { text += str[i]; lastKey = ti; }
        }
      } else if (kind === 'del') {
        for (let i = 0; i < op[2]; i++) { const ti = t0 + i * op[3]; if (T >= ti) { text = [...text].slice(0, -1).join(''); lastKey = ti; } }
      } else if (kind === 'send') { if (T >= t0) sentAt = t0; }
      else if (kind === 'sent') { if (T >= t0) { text = op[2]; sentAt = -1e9; } }
      else if (kind === 'lift') { if (T >= t0) { liftAt = t0; liftText = text; text = ''; } }   // the line leaves the input box
    }
    return { text, caret, sentAt, lastKey, typeStart, liftAt, liftText };
  }

  drawChat(T) {
    const msgs = this.tl.chat?.messages || [];
    // which AI/human message currently owns the caret: the latest started one of each role
    const startOf = m => Math.min(...m.ops.map(o => o[1]));
    for (const m of msgs) {
      const [s0, s1] = m.show;
      if (T < s0 - 0.01 || T > s1 + 0.01) continue;
      const vis = envelope(T, s0, s1, 0.35, 0.25);
      const st = this.msgState(m, T);
      // a newer message of the same role takes the caret; the AI's caret also yields once the human starts again
      const later = msgs.some(o => o !== m && (o.role === m.role || m.role === 'ai') && startOf(o) > startOf(m) && T >= startOf(o));
      const human = m.role === 'human';
      const font = human ? SANS(300, 34) : SERIF(300, 32);
      const col = human ? CSS.humanText : CSS.aiText;
      const caretCol = human ? CSS.c : CSS.si;
      let y, alpha = vis * (m.dim ?? 1);
      let lineA = 0;
      if (human) {
        const inY = m.slot.input ?? m.slot.sent, sentY = m.slot.sent ?? inY;
        if (st.sentAt != null) {
          const k = easeOutCubic(clamp((T - st.sentAt) / 0.55));
          y = lerp(inY, sentY, k); alpha *= lerp(1, 0.78, k); lineA = 1 - clamp((T - st.sentAt) / 0.3);
        } else { y = inY; lineA = 1; }
      } else y = m.slot.line;

      // period → reticle: everything but the final 。 fades; the 。 grows into a ring and flies to centre
      let pr = null;
      if (m.periodToReticle) {
        const [pa, pb] = m.periodToReticle;
        if (T >= pa) { pr = clamp((T - pa) / (pb - pa)); alpha *= 1 - smoothstep(0, 0.55, pr); }
      }
      // input underline
      if (human && lineA > 0) {
        const w = 300 * easeOutCubic(clamp((T - s0) / 0.6));
        this.line(BW / 2 - w, y + 22, BW / 2 + w, y + 22, WHITE(0.22 * lineA * vis));
      }
      const txt = st.text;
      const tw = this.width(txt, font, 4);
      const x0 = BW / 2 - tw / 2;
      const shownTxt = pr != null ? [...txt].slice(0, -1).join('') : txt;
      const dataK = m.toData ? smoothstep(m.toData[0], m.toData[0] + 0.5, T) : 0;   // drawToData takes the glyphs over
      if (shownTxt && alpha > 0.002 && !(m.toData && T >= m.toData[0])) this.text(shownTxt, x0, y, font, rgba(col, alpha), { ls: 4 });
      // caret
      if (st.caret != null && st.sentAt == null && st.liftAt == null && !later && !pr) {
        const typing = T - st.lastKey < 0.45;
        const blink = typing || ((T - st.caret) % 1.06) < 0.53;
        if (blink) { this.g.fillStyle = rgba(caretCol, 0.95 * vis); this.g.fillRect(BW / 2 + tw / 2 + 6, y - 30, 2, 38); }
      }
      // english line (crossfades on change); drawLift carries it away after a lift
      if (m.en && m.en.length && st.liftAt == null) {
        let cur = null, prev = null;
        for (const e of m.en) if (T >= e[0]) { prev = cur; cur = e; }
        if (cur) {
          const reveal = cur[2] != null;                       // typed along with the Chinese
          const k = reveal ? 1 : clamp((T - cur[0]) / 0.3);
          const enY = y + 40, ea = alpha * (1 - dataK);
          if (prev && prev[1] && k < 1) this.enLine(prev[1], enY, rgba(col, 0.62 * ea * (1 - k)), 1);
          if (cur[1] && ea > 0.002) this.enLine(cur[1], enY, rgba(col, 0.62 * ea * k), reveal ? clamp((T - cur[0]) / Math.max(cur[2] - cur[0], 1e-3)) : 1);
        }
      }
      if (pr != null && pr < 1) {
        const last = [...txt].slice(-1)[0];
        const wb = this.width([...txt].slice(0, -1).join(''), font, 4);
        const gx = x0 + wb + 32 * 0.27, gy = y - 32 * 0.13;
        const k = easeInOutCubic(pr);
        const cx = lerp(gx, BW / 2, k), cy = lerp(gy, BH / 2, k), r = lerp(4.6, 36, k);
        this.g.strokeStyle = rgba(CSS.si, 0.95 * vis); this.g.lineWidth = lerp(2.2, 1.4, k);
        this.g.beginPath(); this.g.arc(cx, cy, r, 0, Math.PI * 2); this.g.stroke();
        if (last !== '。') { /* nothing */ }
      }
    }
  }

  // ---------------------------------------------------------------- particles from glyphs
  // Points covering each character of `str` (drawn in `font` with letter spacing `ls`), sampled every `step`
  // design px. Per character: { ch, x (pen offset), pts: [[dx, dy], ...] relative to the pen on the baseline }.
  glyphPoints(str, font, ls, step = 1.6) {
    this._gp = this._gp || new Map();
    const key = `${font}|${ls}|${step}|${str}`;
    if (this._gp.has(key)) return this._gp.get(key);
    const S = 3, c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
    const out = [];
    const chars = [...str];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      g.font = font; g.letterSpacing = '0px';
      const m = g.measureText(ch);
      const l = Math.ceil(m.actualBoundingBoxLeft) + 2, r = Math.ceil(m.actualBoundingBoxRight) + 2;
      const a = Math.ceil(m.actualBoundingBoxAscent) + 2, d = Math.ceil(m.actualBoundingBoxDescent) + 2;
      const w = Math.max(1, (l + r) * S), h = Math.max(1, (a + d) * S);
      c.width = w; c.height = h;
      g.setTransform(S, 0, 0, S, 0, 0); g.font = font; g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
      g.fillText(ch, l, a);
      const px = g.getImageData(0, 0, w, h).data, pts = [];
      const st = step * S;
      for (let y = st / 2; y < h; y += st) for (let x = st / 2; x < w; x += st) {
        if (px[(Math.floor(y) * w + Math.floor(x)) * 4 + 3] > 110) pts.push([x / S - l, y / S - a]);
      }
      out.push({ ch, x: this.width(chars.slice(0, i).join(''), font, ls), pts });
    }
    this._gp.set(key, out);
    return out;
  }

  // soft round sprite (gaussian falloff) in a given colour, cached
  dot(color) {
    this._dots = this._dots || {};
    if (this._dots[color]) return this._dots[color];
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    for (const [o, a] of [[0, 1], [0.18, 0.75], [0.4, 0.28], [0.7, 0.06], [1, 0]]) grd.addColorStop(o, rgba(color, a));
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    return (this._dots[color] = c);
  }

  // The sent question leaves the dialog: each of its seven characters turns into a dot-matrix of light in place,
  // then recedes into the screen, turning slowly into a small warm cluster at the frame centre (where the mind
  // scene picks it up at 27.2). Character i lights up at toData[0] + 0.09 i and leaves ~0.3 s later (audio ticks).
  drawToData(T) {
    for (const m of this.tl.chat?.messages || []) {
      if (!m.toData) continue;
      const [a, b] = m.toData;
      if (T < a || T > b + 1.0) continue;
      const str = this.msgState(m, T).text;
      const font = SANS(300, 34), ls = 4;
      const tw = this.width(str, font, ls), x0 = BW / 2 - tw / 2, y0 = m.slot.sent ?? m.slot.input;
      const G = this.glyphPoints(str, font, ls, 2.1), n = G.length, g = this.g;
      const vx = BW / 2, vy = BH / 2;
      const endA = 1 - smoothstep(b, b + 0.9, T);
      // the glyph bodies give way to their points (each character becomes a dot-matrix of light in place)
      for (let i = 0; i < n; i++) {
        const tI = a + 0.09 * i;
        const ga = 0.78 * (1 - smoothstep(tI, tI + 0.32, T));
        if (ga > 0.003) this.text(G[i].ch, x0 + G[i].x, y0, font, rgba(CSS.humanText, ga));
      }
      g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      const sprW = this.dot(CSS.humanText), sprC = this.dot(CSS.c);
      for (let i = 0; i < n; i++) {
        const tI = a + 0.09 * i, P = G[i].pts;
        for (let j = 0; j < P.length; j++) {
          const h1 = hash1(i * 97.13 + j * 1.371), h2 = hash1(i * 31.7 + j * 7.113 + 3.3), h3 = hash1(j * 3.171 + i * 11.3 + 9.1);
          const sx = x0 + G[i].x + P[j][0], sy = y0 + P[j][1];
          const on = smoothstep(tI + 0.04, tI + 0.3, T);          // the dot-matrix lights up
          if (on <= 0.003) continue;
          const rel = tI + 0.3 + 0.14 * h1, dur = 1.1 + 0.18 * h2;
          // recede toward the vanishing point (perspective scale 1 -> 0.09), turning slowly, dispersing a little
          const at = tt => {
            const u = clamp((tt - rel) / dur);
            const e = easeInCubic(u) * 0.55 + easeInOutCubic(u) * 0.45;
            const sc = 1 / (1 + 10 * e), th = (0.62 + 0.12 * h3) * e;
            const dx = (sx - vx) * sc + (h3 - 0.5) * 10 * Math.sin(Math.PI * u), dy = (sy - vy) * sc + (h2 - 0.5) * 10 * Math.sin(Math.PI * u);
            const cs = Math.cos(th), sn = Math.sin(th);
            return [vx + dx * cs - dy * sn, vy + dx * sn + dy * cs, sc, u];
          };
          const [px, py, sc, u] = at(T);
          const al = endA * on * (0.42 + 0.18 * h2) * (1 + 0.6 * smoothstep(0.5, 1, u));
          if (al <= 0.003) continue;
          const r = 0.75 + 0.55 * Math.sqrt(sc);
          const warm = u > 0.35 || h3 > 0.7;
          if (u > 0 && u < 1) {
            const [qx, qy] = at(T - 0.022);
            if (Math.hypot(px - qx, py - qy) > 1.2) { g.globalAlpha = al * 0.35; g.strokeStyle = warm ? CSS.c : CSS.humanText; g.lineWidth = r; g.beginPath(); g.moveTo(qx, qy); g.lineTo(px, py); g.stroke(); }
          }
          g.globalAlpha = al;
          g.drawImage(warm ? sprC : sprW, px - r * 1.6, py - r * 1.6, r * 3.2, r * 3.2);
        }
      }
      // the cluster: a soft warm glow that builds as the points arrive
      const ck = smoothstep(a + 1.2, b + 0.2, T) * endA;
      if (ck > 0.003) { g.globalAlpha = 0.32 * ck; g.drawImage(sprC, vx - 22, vy - 22, 44, 44); g.globalAlpha = 0.3 * ck; g.drawImage(this.dot(CSS.hot), vx - 5, vy - 5, 10, 10); }
      g.restore();
    }
  }

  // A memory sentence leaves the input box: it rises, and dissolves from left to right into warm points of
  // light that drift upward like embers and fade (about four seconds).
  drawLift(T) {
    for (const m of this.tl.chat?.messages || []) {
      const op = m.ops.find(o => o[0] === 'lift');
      if (!op) continue;
      const tL = op[1];
      if (T < tL || T > tL + 5.0) continue;
      const str = this.msgState(m, tL).liftText || '';
      if (!str) continue;
      const font = SANS(300, 34), ls = 4, y0 = m.slot.input ?? 660;
      const tw = this.width(str, font, ls), x0 = BW / 2 - tw / 2;
      const rise = tt => -42 * easeInOutCubic(clamp((tt - tL) / 1.8));
      const g = this.g;
      // the body, wiped from the left by the release front
      const front = (T - tL - 0.15) / 0.75;          // 0..1 across the line
      const bodyA = 1 - smoothstep(tL + 0.9, tL + 1.4, T);
      if (bodyA > 0.003 && front < 1.1) {
        const fx = x0 + front * tw;
        const grd = g.createLinearGradient(fx - 40, 0, fx + 40, 0);
        grd.addColorStop(0, rgba(CSS.humanText, 0)); grd.addColorStop(1, rgba(CSS.humanText, bodyA));
        g.font = font; g.fillStyle = grd; g.textAlign = 'left'; g.letterSpacing = '4px';
        g.fillText(str, x0, y0 + rise(T)); g.letterSpacing = '0px';
      }
      const en = m.en && m.en.length ? m.en[m.en.length - 1][1] : null;
      const enA = 0.62 * (1 - smoothstep(tL + 0.2, tL + 1.0, T));
      if (en && enA > 0.003) this.enLine(en, y0 + 40 + rise(T) * 0.8, rgba(CSS.humanText, enA), 1);
      // the points
      const G = this.glyphPoints(str, font, ls, 2.2);
      g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      const sprC = this.dot(CSS.c), sprH = this.dot(CSS.hot);
      for (let i = 0; i < G.length; i++) {
        const P = G[i].pts;
        for (let j = 0; j < P.length; j++) {
          const h1 = hash1(i * 57.31 + j * 1.913 + tL), h2 = hash1(i * 13.7 + j * 5.31 + 1.7), h3 = hash1(j * 2.71 + i * 7.9 + 4.4);
          const bx = x0 + G[i].x + P[j][0];
          const rel = tL + 0.15 + 0.75 * clamp((bx - x0) / tw) + 0.1 * h1;
          if (T < rel) continue;
          const tau = T - rel;
          const sy0 = y0 + P[j][1] + rise(rel);
          const v = 16 + 34 * h2;
          const pos = tt => [bx + (h3 - 0.5) * 18 * tt + Math.sin(tt * (1.1 + 0.8 * h1) + h2 * 6.283) * 3 * Math.min(tt, 1),
            sy0 - v * 1.2 * (1 - Math.exp(-tt / 1.2)) - 7 * tt];
          const [px, py] = pos(tau), [qx, qy] = pos(Math.max(0, tau - 0.05));
          const al = smoothstep(0, 0.12, tau) * Math.exp(-tau / (0.75 + 1.0 * h3)) * 0.6;
          if (al <= 0.003) continue;
          const r = 0.9 + 1.0 * h2;
          g.globalAlpha = al * 0.4; g.strokeStyle = CSS.c; g.lineWidth = r * 0.8;
          g.beginPath(); g.moveTo(qx, qy); g.lineTo(px, py); g.stroke();
          g.globalAlpha = al;
          g.drawImage(h1 > 0.965 ? sprH : sprC, px - r * 1.7, py - r * 1.7, r * 3.4, r * 3.4);
        }
      }
      g.restore();
    }
  }

  enLine(str, y, color, reveal = 1) {
    const font = CORMI(400, 23);
    const parts = []; const re = /~~(.+?)~~/g; let last = 0, mm;
    while ((mm = re.exec(str))) { if (mm.index > last) parts.push([str.slice(last, mm.index), false]); parts.push([mm[1], true]); last = re.lastIndex; }
    if (last < str.length) parts.push([str.slice(last), false]);
    const plain = parts.map(p => p[0]).join('');
    const total = this.width(plain, font, 1);
    let x = BW / 2 - total / 2, shown = Math.round(plain.length * reveal), used = 0;
    for (const [txt, strike] of parts) {
      const vis = txt.slice(0, Math.max(0, shown - used)); used += txt.length;
      const w = this.width(txt, font, 1);
      if (vis) this.text(vis, x, y, font, color, { ls: 1 });
      if (strike && vis.length === txt.length) { this.line(x - 2, y - 7, x + w - 1, y - 7, color, 1.2); }
      x += w;
    }
  }

  // ---------------------------------------------------------------- trace
  traceState(name, T) {
    let cur = null;
    for (const e of this.trace) { if (e.t > T) break; if (e.target === name) cur = e; }
    return cur;
  }

  drawTrace(T, targets) {
    const defs = this.tl.targets || {};
    const pos = {};
    for (const name of Object.keys(defs)) {
      const st = this.traceState(name, T);
      if (!st) continue;
      const dt = T - st.t;
      const def = defs[name];
      const color = COL[def.color] || CSS.line;
      let p = targets[name];
      if (st.type === 'seek' || st.type === 'rewind') p = p && p.on ? p : { x: BW / 2, y: BH / 2, on: true };
      if (!p || !p.on) continue;
      if (st.type === 'release') {
        const a = 1 - clamp(dt / 0.45); if (a <= 0) continue;
        this.reticle(p.x, p.y, color, 1, a, null);
        continue;
      }
      if (st.type === 'merge') { pos[name] = { ...p, merge: dt }; continue; }
      pos[name] = p;
      if (st.type === 'seek') {
        const a = smoothstep(0, 0.3, dt);
        const g = this.g; g.save(); g.translate(p.x, p.y); g.rotate(T * 0.6);
        g.strokeStyle = rgba(color, 0.9 * a); g.lineWidth = 1.4; g.beginPath(); g.arc(0, 0, 36 + 2 * Math.sin(T * 3), 0, Math.PI * 2); g.stroke();
        for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); this.line(0, -44, 0, -52, rgba(color, 0.8 * a), 1.2); }
        g.restore();
        this.text('SEARCHING · 搜尋中', p.x, p.y + 70, MONO(300, 10), rgba(color, 0.6 * a), { align: 'center', ls: 3 });
        continue;
      }
      const lock = clamp(dt / 0.6);
      const sc = st.type === 'rewind' ? 1 + 0.06 * Math.sin(T * 40) : lerp(2.2, 1, easeOutBack(lock, 1.3));
      const label = st.type === 'rewind' ? { code: def.code, zh: '回溯中', en: 'REWINDING' } : { code: def.code, zh: def.zh, en: def.en };
      this.reticle(p.x, p.y, color, sc, smoothstep(0, 0.15, dt), label, smoothstep(0.25, 0.7, dt), p.half);
    }
    // merged contact reticle
    if (pos.C && pos.Si && pos.C.merge != null) {
      const k = easeInOutCubic(clamp(pos.C.merge / 1.2));
      const mx = (pos.C.x + pos.Si.x) / 2, my = (pos.C.y + pos.Si.y) / 2;
      if (k < 1) {
        this.reticle(lerp(pos.C.x, mx, k), lerp(pos.C.y, my, k), CSS.c, 1, 1 - k, null);
        this.reticle(lerp(pos.Si.x, mx, k), lerp(pos.Si.y, my, k), CSS.si, 1, 1 - k, null);
      }
      this.reticle(mx, my, '#FFFFFF', lerp(1.3, 1.0, k), k, { code: 'C · Si', zh: '接觸', en: 'CONTACT' }, smoothstep(0.3, 1, k));
      return;
    }
    // distance line
    const D = this.tl.distance;
    if (D && pos.C && pos.Si && inAny(T, D.show.map(([a, b]) => [a, b + 0.4]))) {
      const a = rangeAlpha(T, D.show, 0.4);
      const d = T >= (D.contactAt ?? 1e9) ? 0 : keyInterp(D.keys, T, true);
      const x1 = pos.C.x, y1 = pos.C.y, x2 = pos.Si.x, y2 = pos.Si.y;
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (L > 60) {
        const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
        const g = this.g;
        const grad = g.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, rgba(CSS.c, 0.6 * a)); grad.addColorStop(1, rgba(CSS.si, 0.6 * a));
        g.strokeStyle = grad; g.lineWidth = 1; g.setLineDash([3, 5]);
        g.beginPath(); g.moveTo(x1 + ux * 30, y1 + uy * 30); g.lineTo(x2 - ux * 30, y2 - uy * 30); g.stroke(); g.setLineDash([]);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const off = uy * ux < 0 ? -1 : 1;
        this.text('DISTANCE · 距離', mx, my - 26, MONO(300, 10), WHITE(0.5 * a), { align: 'center', ls: 3 });
        this.text(fmtDist(d), mx, my - 8, MONO(400, 14), WHITE(0.92 * a), { align: 'center', ls: 2 });
      } else {
        this.text(fmtDist(d), (x1 + x2) / 2, Math.min(y1, y2) - 40, MONO(400, 14), WHITE(0.92 * a), { align: 'center', ls: 2 });
      }
    }
  }

  reticle(x, y, color, scale, alpha, label, labelA = 1, half) {
    if (alpha <= 0.002) return;
    const g = this.g; const s = 20 * scale, c = 8;
    g.save(); g.translate(x, y); g.strokeStyle = rgba(color, 0.95 * alpha); g.lineWidth = 1.4;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.beginPath(); g.moveTo(sx * s, sy * (s - c)); g.lineTo(sx * s, sy * s); g.lineTo(sx * (s - c), sy * s); g.stroke();
    }
    g.fillStyle = rgba(color, alpha); g.beginPath(); g.arc(0, 0, 1.7, 0, Math.PI * 2); g.fill();
    g.restore();
    if (!label || labelA <= 0.002) return;
    const la = alpha * labelA;
    const limit = half === 'L' ? (this.tl.split?.seam ?? 0.5) * BW : BW;
    const flip = (x + s + 240 > limit - 12) ? -1 : 1;
    const x1 = x + flip * (s + 3), y1 = y - (s + 3), x2 = x1 + flip * 26, y2 = y1 - 26;
    const len = 170 * easeOutCubic(labelA);
    g.strokeStyle = rgba(color, 0.7 * la); g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x2 + flip * len, y2); g.stroke();
    const tx = flip > 0 ? x2 + 2 : x2 - 2, al = flip > 0 ? 'left' : 'right';
    this.text(label.code, tx, y2 - 8, MONO(400, 11), rgba(color, 0.85 * la), { align: al, ls: 2 });
    const zhW = this.width(label.zh, SANS(300, 22), 2);
    if (flip > 0) {
      this.text(label.zh, tx, y2 + 26, SANS(300, 22), rgba(color, la), { ls: 2 });
      this.text(label.en, tx + zhW + 10, y2 + 25, MONO(400, 11), rgba(color, 0.8 * la), { ls: 3 });
    } else {
      const enW = this.width(label.en, MONO(400, 11), 3);
      this.text(label.en, tx, y2 + 25, MONO(400, 11), rgba(color, 0.8 * la), { align: 'right', ls: 3 });
      this.text(label.zh, tx - enW - 10, y2 + 26, SANS(300, 22), rgba(color, la), { align: 'right', ls: 2 });
    }
  }

  // ---------------------------------------------------------------- cards
  drawCard(c, T) {
    const lt = T - c.start, dur = c.end - c.start;
    switch (c.style) {
      case 'ai': case 'ai-left': case 'ai-right': case 'human': {
        const x = c.style === 'ai-left' ? BW * 0.25 : c.style === 'ai-right' ? BW * 0.75 : BW / 2;
        const a = envelope(T, c.start, c.end, 1.1, 1.0);
        const rise = (1 - easeOutCubic(clamp(lt / 1.4))) * 8;
        const two = !!c.zh2;
        const y0 = two ? 612 : 652;
        const human = c.style === 'human';
        const tc = human ? CSS.humanText : CSS.aiText;
        this.text(c.zh, x, y0 + rise, human ? SANS(300, 32) : SERIF(300, two ? 28 : 30), rgba(tc, 0.96 * a), { align: 'center', ls: 6, shadow: 14 });
        this.text(c.en, x, y0 + 36 + rise, CORMI(400, 23), rgba(tc, 0.72 * a), { align: 'center', ls: 1, shadow: 10 });
        if (two) {
          const t2 = c.start + dur * 0.42;
          const a2 = envelope(T, t2, c.end, 1.0, 1.0);
          const r2 = (1 - easeOutCubic(clamp((T - t2) / 1.4))) * 8;
          this.text(c.zh2, x, y0 + 88 + r2, SERIF(300, 28), rgba(CSS.aiText, 0.96 * a2), { align: 'center', ls: 6, shadow: 14 });
          this.text(c.en2, x, y0 + 124 + r2, CORMI(400, 23), rgba(CSS.aiText, 0.72 * a2), { align: 'center', ls: 1, shadow: 10 });
        }
        break;
      }
      case 'kin': this.drawKin(c, T); break;
      case 'oracle-title': this.drawOracleTitle(c, T); break;
      case 'credits': {
        const a = envelope(T, c.start, c.end, 1.4, 1.6);
        this.text(c.zh, BW / 2, 400, SERIF(300, 22), WHITE(0.86 * a), { align: 'center', ls: 8 });
        this.text(c.en, BW / 2, 436, CORMI(400, 20), WHITE(0.6 * a), { align: 'center', ls: 1 });
        if (c.sources) {
          const sa = envelope(T, c.start + 1.6, c.end, 1.4, 1.6);
          this.text(c.sources, BW / 2, 520, SANS(300, 13), WHITE(0.5 * sa), { align: 'center', ls: 3 });
          this.text(c.sourcesEn, BW / 2, 542, MONO(300, 10), WHITE(0.38 * sa), { align: 'center', ls: 2 });
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- title: the crack 卜
  // The same crack as the bone and lineage scenes (lib/crack.js), mapped to the design frame: junction at
  // (962, 352), 338 px tall, 1.0 relative width = 2.7 px.
  buildCrack() {
    const C = crackGeometry(), X = 962, Y = 352, S = 338, Wpx = 2.7;
    const lines = C.lines.map(P => ({ ...P, pts: P.pts.map(([x, y]) => [X + x * S, Y - y * S]), cum: P.cum.map(c => c * S), L: P.L * S,
      w0: P.w0 * Wpx, w1: P.w1 * Wpx, reach: s => crackReach(P, s / S) }));
    return { J: [X, Y], lines };
  }

  // title: in the dark a point heats up (246.0), the crack snaps (246.5) and draws 卜 in light, white-hot where
  // it is fresh and cooling to amber; a flash and a few sparks at the snap; ORACLE fades in below.
  drawOracleTitle(c, T) {
    const lt = T - c.start, out = 1 - smoothstep(c.end - 2.0, c.end, T);
    if (out <= 0.002) return;
    const g = this.g, C = this.crack || (this.crack = this.buildCrack());
    const t = lt - 0.5;                       // seconds since the snap
    const [jx, jy] = C.J;
    const K = 1 - Math.exp(-5);
    g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
    // the heated point
    const heatPt = smoothstep(-0.5, 0, t) * (t < 0 ? 1 : 0.35 + 0.65 * Math.exp(-t / 0.6));
    if (heatPt > 0.003) {
      const r = 5 + 14 * heatPt;
      g.globalAlpha = 0.7 * heatPt * out; g.drawImage(this.dot(CSS.c), jx - r, jy - r, 2 * r, 2 * r);
      g.globalAlpha = 0.9 * heatPt * out; g.drawImage(this.dot(CSS.hot), jx - 3, jy - 3, 6, 6);
    }
    if (t >= 0) {
      const flash = Math.exp(-t * 7);
      const heat = 0.6 + 0.4 * Math.exp(-t / 1.6);
      if (flash > 0.01) {
        g.globalAlpha = 0.035 * flash * out; g.fillStyle = CSS.hot; g.fillRect(0, 0, BW, BH);
        const R = 90 + 240 * (1 - flash);
        g.globalAlpha = 0.8 * flash * out; g.drawImage(this.dot(CSS.hot), jx - R, jy - R, 2 * R, 2 * R);
      }
      for (const P of C.lines) {
        const tt = t - P.t0;
        if (tt <= 0) continue;
        const front = P.L * Math.min(1, (1 - Math.exp(-tt / P.tau)) / K);
        // the visible part as one path for the glow layers
        const path = new Path2D();
        path.moveTo(P.pts[0][0], P.pts[0][1]);
        let last = 0;
        for (let i = 1; i < P.pts.length; i++) {
          const s0 = P.cum[i - 1];
          if (s0 >= front) break;
          const A = P.pts[i - 1], B = P.pts[i], u = Math.min(1, (front - s0) / Math.max(P.cum[i] - s0, 1e-6));
          path.lineTo(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u);
          last = i;
        }
        // soft glow: nested strokes of falling alpha approximate a gaussian falloff (no canvas blur: too slow)
        const wm = 0.5 * (P.w0 + P.w1);
        g.strokeStyle = CSS.c;
        for (const [wk, wa, al] of [[9, 16, 0.014], [6, 10, 0.022], [3.6, 5, 0.04], [2.0, 2, 0.08]]) {
          g.globalAlpha = al * heat * P.glow * out; g.lineWidth = wm * wk + wa; g.stroke(path);
        }
        // the core, tapered, white-hot where the front just passed
        for (let i = 1; i <= last; i++) {
          const s0 = P.cum[i - 1], s1 = Math.min(P.cum[i], front);
          const A = P.pts[i - 1], B = P.pts[i], u = (s1 - s0) / Math.max(P.cum[i] - s0, 1e-6);
          const sm = 0.5 * (s0 + s1) / P.L;
          const w = lerp(P.w0, P.w1, Math.pow(sm, 0.7));
          const age = t - P.reach(0.5 * (s0 + s1));
          const hot = Math.exp(-Math.max(age, 0) / 0.4);
          g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u);
          g.lineWidth = w; g.globalAlpha = 0.75 * out; g.strokeStyle = CSS.c; g.stroke();
          g.lineWidth = w * 0.6; g.globalAlpha = (0.3 + 0.7 * hot) * heat * out; g.strokeStyle = CSS.hot; g.stroke();
        }
      }
      // sparks thrown from the junction
      for (let k = 0; k < 22; k++) {
        const h1 = hash1(k * 7.31 + 0.5), h2 = hash1(k * 3.17 + 1.9), h3 = hash1(k * 5.51 + 2.7);
        const life = 0.3 + 0.55 * h3;
        if (t > life) continue;
        const ang = -Math.PI / 2 + (h1 - 0.5) * Math.PI * 1.7, v = 140 + 360 * h2;
        const p = tt => [jx + Math.cos(ang) * v * tt, jy + Math.sin(ang) * v * tt + 450 * tt * tt];
        const [x1, y1] = p(t), [x0, y0] = p(Math.max(0, t - 0.03));
        g.globalAlpha = Math.pow(1 - t / life, 1.5) * 0.8 * out; g.strokeStyle = h3 > 0.5 ? CSS.hot : CSS.c; g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
    g.restore();
    const ta = smoothstep(3.0, 4.6, lt) * out;
    if (ta > 0.002) this.text('ORACLE', BW / 2, 650, CINZEL(400, 28), WHITE(0.86 * ta), { align: 'center', ls: 26 });
  }

  // periodic-table title: [6 C] over [14 Si], group 14, 同族 · KIN
  drawKin(c, T) {
    const lt = T - c.start;
    const out = 1 - smoothstep(c.end - 2.0, c.end, T);
    const g = this.g;
    const tile = (x, y, num, sym, zh, mass, color, t0) => {
      const k = easeInOutCubic(clamp((lt - t0) / 1.0));
      if (k <= 0) return;
      const sz = 132;
      g.strokeStyle = rgba(color, 0.9 * out); g.lineWidth = 1.4;
      g.beginPath();
      const per = 4 * sz, L = per * k;
      const pts = [[x, y], [x + sz, y], [x + sz, y + sz], [x, y + sz], [x, y]];
      g.moveTo(x, y); let acc = 0;
      for (let i = 1; i < pts.length && acc < L; i++) {
        const seg = Math.min(sz, L - acc); const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        g.lineTo(ax + (bx - ax) * seg / sz, ay + (by - ay) * seg / sz); acc += sz;
      }
      g.stroke();
      const ta = smoothstep(0.5, 1.3, lt - t0) * out;
      this.text(String(num), x + 12, y + 24, MONO(400, 15), rgba(color, 0.85 * ta), { ls: 1 });
      this.text(sym, x + sz / 2, y + 84, SERIF(300, 54), rgba(color, ta), { align: 'center' });
      this.text(zh, x + sz - 14, y + 26, SANS(300, 18), rgba(color, 0.85 * ta), { align: 'right' });
      this.text(mass, x + sz / 2, y + sz - 12, MONO(300, 11), rgba(color, 0.6 * ta), { align: 'center', ls: 1 });
    };
    const tx = 720, ty = 252;
    tile(tx, ty, 6, 'C', '碳', '12.011', CSS.c, 0.2);
    tile(tx, ty + 150, 14, 'Si', '矽', '28.085', CSS.si, 0.7);
    const ga = smoothstep(1.4, 2.2, lt) * out;
    this.text('14', tx + 66, ty - 22, MONO(400, 13), WHITE(0.7 * ga), { align: 'center', ls: 2 });
    this.line(tx - 22, ty, tx - 22, ty + 282, WHITE(0.35 * ga));
    this.line(tx - 22, ty, tx - 14, ty, WHITE(0.35 * ga)); this.line(tx - 22, ty + 282, tx - 14, ty + 282, WHITE(0.35 * ga));
    this.text('第十四族 · GROUP 14', tx + 66, ty + 318, MONO(300, 11), WHITE(0.6 * ga), { align: 'center', ls: 3 });
    const ka = smoothstep(2.5, 4.0, lt) * out;
    const kr = (1 - easeOutCubic(clamp((lt - 2.5) / 2.5))) * 10;
    this.text('同族', 930 + kr, 430, SERIF(300, 120), WHITE(0.97 * ka), { ls: 30 });
    this.text('KIN', 936 + kr, 490, CINZEL(400, 30), WHITE(0.85 * ka), { ls: 26 });
  }
}
