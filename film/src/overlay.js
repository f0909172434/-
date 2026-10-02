// 2D overlay: chat interface, trace reticles + distance line, minimal HUD, split seam, cards, title.
// Everything is a pure function of global time T, drawn in a 1920x804 design space.
import { clamp, lerp, smoothstep, envelope, easeOutBack, easeOutCubic, easeInOutCubic } from './lib/ease.js';
import { hash1 } from './lib/random.js';
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
    const a = rangeAlpha(T, h.show, 0.35);
    if (a <= 0.002) return;
    const boot = h.boot || [0, 0];
    const bk = clamp((T - boot[0]) / (boot[1] - boot[0]));
    // viewfinder corners
    const cl = 16, ci = 28, ca = 0.28 * a * smoothstep(0, 0.4, bk);
    for (const [x, y, sx, sy] of [[ci, ci, 1, 1], [BW - ci, ci, -1, 1], [ci, BH - ci, 1, -1], [BW - ci, BH - ci, -1, -1]]) {
      this.line(x, y, x + cl * sx, y, WHITE(ca)); this.line(x, y, x, y + cl * sy, WHITE(ca));
    }
    // top-left: trace header + time
    const head = 'TRACE · 溯源';
    const n = Math.floor(clamp(bk * 2.2) * head.length);
    this.g.fillStyle = rgba(CSS.si, 0.9 * a); this.g.beginPath(); this.g.arc(M + 4, M - 4.5, 3.2, 0, Math.PI * 2); this.g.fill();
    this.text(head.slice(0, n), M + 16, M, MONO(400, 12), WHITE(0.8 * a), { ls: 3 });
    const la = a * smoothstep(0.45, 0.9, bk);
    if (la > 0) {
      const y = keyInterp(h.yearsAgo, T, true);
      const s = y < 0.5 ? 'NOW · 現在' : `T − ${fmtInt(y)} YR`;
      this.text(s, M, M + 26, MONO(300, 15), WHITE(0.85 * la), { ls: 2 });
      this.line(M, M + 40, M + 260 * smoothstep(0.5, 1, bk), M + 40, WHITE(0.22 * la));
    }
    if (h.origin && inAny(T, h.origin.show)) {
      const oa = a * rangeAlpha(T, h.origin.show, 0.25) * (Math.floor(T * 2.4) % 2 === 0 ? 1 : 0.45);
      this.text(`${h.origin.en} · ${h.origin.zh}`, M, M + 64, MONO(400, 12), rgba(CSS.si, 0.9 * oa), { ls: 3 });
    }
    // bottom-left: scale ruler
    if (h.scale && inAny(T, h.scale.show.map(([x, y]) => [x - 0.4, y + 0.4]))) {
      const sa = a * rangeAlpha(T, h.scale.show, 0.4);
      const e = keyInterp(h.scale.keys, T, false);
      const ei = Math.round(e), frac = e - Math.floor(e);
      const by = BH - M;
      this.text('SCALE · 尺度', M, by - 30, MONO(300, 11), WHITE(0.55 * sa), { ls: 2 });
      this.text(`10${sup(ei)} m`, M + 118, by - 30, MONO(400, 13), WHITE(0.9 * sa), { ls: 1 });
      this.line(M, by - 12, M + 200, by - 12, WHITE(0.5 * sa));
      for (let i = 0; i <= 20; i++) {
        const x = M + ((i * 10 + frac * 100) % 200);
        this.line(x, by - 12, x, by - 12 - (i % 5 === 0 ? 7 : 3), WHITE(0.45 * sa));
      }
    }
  }

  // ---------------------------------------------------------------- chat
  msgState(m, T) {
    let text = '', caret = null, sentAt = null, lastKey = -1, typeStart = null;
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
    }
    return { text, caret, sentAt, lastKey, typeStart };
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
      const later = msgs.some(o => o !== m && o.role === m.role && startOf(o) > startOf(m) && T >= startOf(o));
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
      if (shownTxt && alpha > 0.002) this.text(shownTxt, x0, y, font, rgba(col, alpha), { ls: 4 });
      // caret
      if (st.caret != null && st.sentAt == null && !later && !pr) {
        const typing = T - st.lastKey < 0.45;
        const blink = typing || ((T - st.caret) % 1.06) < 0.53;
        if (blink) { this.g.fillStyle = rgba(caretCol, 0.95 * vis); this.g.fillRect(BW / 2 + tw / 2 + 6, y - 30, 2, 38); }
      }
      // english line (crossfades on change)
      if (m.en && m.en.length) {
        let cur = null, prev = null;
        for (const e of m.en) if (T >= e[0]) { prev = cur; cur = e; }
        if (cur) {
          const reveal = cur[2] != null;                       // typed along with the Chinese
          const k = reveal ? 1 : clamp((T - cur[0]) / 0.3);
          const enY = y + 40;
          if (prev && prev[1] && k < 1) this.enLine(prev[1], enY, rgba(col, 0.62 * alpha * (1 - k)), 1);
          if (cur[1]) this.enLine(cur[1], enY, rgba(col, 0.62 * alpha * k), reveal ? clamp((T - cur[0]) / Math.max(cur[2] - cur[0], 1e-3)) : 1);
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
      case 'ai': case 'ai-left': case 'ai-right': {
        const x = c.style === 'ai-left' ? BW * 0.25 : c.style === 'ai-right' ? BW * 0.75 : BW / 2;
        const a = envelope(T, c.start, c.end, 1.1, 1.0);
        const rise = (1 - easeOutCubic(clamp(lt / 1.4))) * 8;
        const two = !!c.zh2;
        const y0 = two ? 612 : 652;
        this.text(c.zh, x, y0 + rise, SERIF(300, two ? 28 : 30), rgba(CSS.aiText, 0.96 * a), { align: 'center', ls: 6, shadow: 14 });
        this.text(c.en, x, y0 + 36 + rise, CORMI(400, 23), rgba(CSS.aiText, 0.72 * a), { align: 'center', ls: 1, shadow: 10 });
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
      case 'credits': {
        const a = envelope(T, c.start, c.end, 1.4, 1.6);
        this.text(c.zh, BW / 2, 400, SERIF(300, 22), WHITE(0.86 * a), { align: 'center', ls: 8 });
        this.text(c.en, BW / 2, 436, CORMI(400, 20), WHITE(0.6 * a), { align: 'center', ls: 1 });
        break;
      }
    }
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
