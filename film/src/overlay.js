// 2D overlay layer: observation HUD, tracking reticle, title cards, boot sequence.
// Everything is a pure function of global time T, drawn in a 1920x804 design space.
import { clamp, lerp, smoothstep, envelope, easeOutBack, easeOutCubic, easeInOutCubic } from './lib/ease.js';
import { hash1 } from './lib/random.js';

const BW = 1920, BH = 804, M = 56;
const C_HUD = (a) => `rgba(236,232,222,${a})`;
const C_DIM = (a) => `rgba(236,232,222,${a * 0.55})`;
const C_AMBER = (a) => `rgba(255,192,118,${a})`;
const C_RED = (a) => `rgba(255,78,62,${a})`;
const C_GOLD = (a) => `rgba(255,224,160,${a})`;
const MONO = (w, px) => `${w} ${px}px JBMono, NotoSansTC`;
const SANS = (w, px) => `${w} ${px}px NotoSansTC`;
const SERIF = (w, px) => `${w} ${px}px NotoSerifTC`;
const CORM = (w, px) => `${w} ${px}px Cormorant`;
const CORMI = (w, px) => `italic ${w} ${px}px CormorantItalic`;
const CINZEL = (w, px) => `${w} ${px}px Cinzel`;
const SCRAMBLE = '01#%&*+=<>/\\|ΔΣΩ∞ABCDEFXYZ';

function sup(n) { const m = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }; return String(n).split('').map(c => m[c] ?? c).join(''); }
function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
function timecode(T, fps) { const f = Math.floor(T * fps + 1e-6); const s = Math.floor(f / fps); const p = (x) => String(x).padStart(2, '0'); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f % fps)}`; }
function scramble(str, k, seed) { // k=1 fully scrambled, 0 clean
  if (k <= 0) return str;
  return str.split('').map((c, i) => (c === ' ' || hash1(i * 7.1 + seed) > k) ? c : SCRAMBLE[Math.floor(hash1(i * 3.3 + seed * 1.7) * SCRAMBLE.length)]).join('');
}

export class Overlay {
  constructor(timeline, width, height) {
    this.tl = timeline; this.W = width; this.H = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width; this.canvas.height = height;
    this.g = this.canvas.getContext('2d');
    this.buf = document.createElement('canvas'); this.buf.width = width; this.buf.height = height;
    this.bg = this.buf.getContext('2d');
    this.s = width / BW;
    this.reticleEvents = [...(timeline.reticle || [])].sort((a, b) => a.t - b.t);
  }

  // info: { T, shot, lt, frame, reticle: {x,y,on} | null }  (x,y in design px)
  draw(info) {
    const g = this.g; const { T, shot, lt } = info;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.setTransform(this.s, 0, 0, this.s, 0, 0);
    g.textBaseline = 'alphabetic';
    if (shot.scene === 'boot') this.drawBoot(lt, info.frame);
    if (shot.hud && shot.hud.visible > 0) this.drawHUD(shot, lt, T, info.frame);
    this.drawReticle(T, info.reticle, info.frame);
    for (const c of this.tl.cards) if (T >= c.start - 0.01 && T <= c.end + 0.01) this.drawCard(c, T);
    return this.canvas;
  }

  // ---------- helpers ----------
  text(str, x, y, font, color, { align = 'left', ls = 0, blur = 0, shadow = null, glow = null } = {}) {
    const g = this.g;
    g.font = font; g.fillStyle = color; g.textAlign = align; g.letterSpacing = `${ls}px`;
    g.filter = blur > 0.05 ? `blur(${blur * this.s}px)` : 'none';
    // letterSpacing adds trailing space after the last glyph; compensate for centred text
    const dx = align === 'center' ? ls / 2 : align === 'right' ? ls : 0;
    if (glow) { g.shadowColor = glow.color; g.shadowBlur = glow.blur * this.s; g.fillText(str, x + dx, y); }
    if (shadow) { g.shadowColor = shadow.color; g.shadowBlur = shadow.blur * this.s; }
    else g.shadowColor = 'transparent';
    g.fillText(str, x + dx, y);
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.filter = 'none'; g.letterSpacing = '0px';
  }
  line(x1, y1, x2, y2, color, w = 1) { const g = this.g; g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }

  // ---------- HUD ----------
  drawHUD(shot, lt, T, frame) {
    const h = shot.hud, dur = shot.end - shot.start;
    // power-on flicker at each shot start
    const on = smoothstep(0.05, 0.55, lt);
    const flick = lt < 0.5 ? (hash1(Math.floor(lt * 24) * 9.1 + shot.start) > 0.35 ? 1 : 0.25) : 1;
    const a = h.visible * on * flick;
    if (a <= 0.001) return;
    const scr = clamp(1 - lt / 0.6); // value scramble on lock-in
    const seed = Math.floor(T * 24);

    // viewfinder corners
    const cl = 18, ci = 28;
    for (const [x, y, sx, sy] of [[ci, ci, 1, 1], [BW - ci, ci, -1, 1], [ci, BH - ci, 1, -1], [BW - ci, BH - ci, -1, -1]]) {
      this.line(x, y, x + cl * sx, y, C_HUD(0.35 * a)); this.line(x, y, x, y + cl * sy, C_HUD(0.35 * a));
    }
    // top-left: log id + timecode
    const blink = (Math.floor(T * 2) % 2 === 0) ? 1 : 0.25;
    this.g.fillStyle = C_RED(0.9 * a * blink); this.g.beginPath(); this.g.arc(M + 4, M - 4.5, 3.6, 0, Math.PI * 2); this.g.fill();
    this.text('REC', M + 14, M, MONO(400, 12), C_HUD(0.8 * a), { ls: 2 });
    this.text('OBS-LOG  ¹²C #0001', M + 58, M, MONO(300, 12), C_HUD(0.8 * a), { ls: 2 });
    this.text(`TC ${timecode(T, this.tl.fps)}`, M, M + 20, MONO(300, 11), C_DIM(a), { ls: 2 });
    this.line(M, M + 32, M + 230, M + 32, C_HUD(0.25 * a));
    this.line(M, M + 29, M, M + 35, C_HUD(0.4 * a));

    // top-right: universe age / life age / counters
    const R = BW - M; const k = clamp(lt / dur);
    if (h.lifeAge) {
      const la = h.lifeAge; const kk = easeInOutCubic(clamp(lt / la.endAt));
      const v = Math.round(lerp(la.from, la.to, kk));
      this.text(`${la.en} · ${la.zh}`, R, M, MONO(300, 12), C_DIM(a), { align: 'right', ls: 2 });
      this.text(scramble(`${v} YR`, scr, seed), R, M + 34, MONO(300, 30), C_HUD(0.92 * a), { align: 'right', ls: 1 });
    } else if (h.age) {
      const v = lerp(h.age.from, h.age.to, easeInOutCubic(k));
      this.text('UNIVERSE AGE · 宇宙年齡', R, M, MONO(300, 12), C_DIM(a), { align: 'right', ls: 2 });
      this.text(scramble(`${v.toFixed(2)} × 10⁹ YR`, scr, seed), R, M + 34, MONO(300, 28), C_HUD(0.92 * a), { align: 'right', ls: 1 });
    }
    this.line(R - 230, M + 46, R, M + 46, C_HUD(0.25 * a));
    if (h.counter) {
      const c = h.counter; const kk = smoothstep(0.08, 0.95, k);
      const v = Math.exp(lerp(Math.log(c.from), Math.log(c.to), kk * kk));
      this.text(`${c.en} · ${c.zh}`, R, M + 70, MONO(300, 12), C_DIM(a), { align: 'right', ls: 2 });
      this.text(scramble(fmtInt(v), scr, seed + 3), R, M + 96, MONO(300, 22), C_AMBER(0.95 * a), { align: 'right', ls: 1 });
    }

    // bottom-left: scale ruler + temperature
    const by = BH - M;
    if (h.scale) {
      this.text('SCALE · 尺度', M, by - 46, MONO(300, 11), C_DIM(a), { ls: 2 });
      this.text(scramble(h.scale, scr, seed + 5), M + 120, by - 46, MONO(400, 13), C_HUD(0.9 * a), { ls: 1 });
      this.line(M, by - 30, M + 200, by - 30, C_HUD(0.6 * a));
      for (let i = 0; i <= 10; i++) { const x = M + i * 20, tl = i % 5 === 0 ? 8 : 4; this.line(x, by - 30, x, by - 30 - tl, C_HUD(0.6 * a)); }
    }
    if (h.temp) {
      this.text('TEMP · 溫度', M, by, MONO(300, 11), C_DIM(a), { ls: 2 });
      this.text(scramble(h.temp, scr, seed + 7), M + 120, by, MONO(400, 13), C_HUD(0.9 * a), { ls: 1 });
    }

    // bottom-right: location
    if (h.location) {
      this.text('LOCATION · 位置', R, by - 52, MONO(300, 11), C_DIM(a), { align: 'right', ls: 2 });
      this.text(h.location.zh, R, by - 22, SANS(300, 21), C_HUD(0.95 * a), { align: 'right', ls: 4 });
      this.text(scramble(h.location.en, scr, seed + 9), R, by, MONO(300, 11), C_HUD(0.7 * a), { align: 'right', ls: 3 });
    }

    // warning banner
    if (h.warn && lt >= h.warn.start) {
      const wl = lt - h.warn.start;
      const wb = (Math.floor(wl * 3) % 2 === 0) ? 1 : 0.45;
      const wa = a * smoothstep(0, 0.2, wl) * wb;
      const cx = BW / 2, y = M + 10;
      this.g.strokeStyle = C_RED(0.8 * wa); this.g.lineWidth = 1; this.g.strokeRect(cx - 230, y - 22, 460, 48);
      this.g.fillStyle = C_RED(0.10 * wa); this.g.fillRect(cx - 230, y - 22, 460, 48);
      this.text(`▲  ${h.warn.en}`, cx, y - 1, MONO(500, 13), C_RED(wa), { align: 'center', ls: 3 });
      let sub = h.warn.zh;
      if (h.warn.countdownTo != null) { const rem = Math.max(0, h.warn.countdownTo - lt); sub += `   T−${rem.toFixed(2).padStart(5, '0')} s`; }
      this.text(sub, cx, y + 18, MONO(300, 12), C_RED(0.85 * wa), { align: 'center', ls: 3 });
    }
  }

  // ---------- reticle ----------
  reticleState(T) {
    let cur = null, status = null;
    for (const e of this.reticleEvents) {
      if (e.t > T) break;
      if (e.type === 'status') status = e; else { cur = e; status = null; }
    }
    return { cur, status };
  }

  drawReticle(T, pos, frame) {
    const { cur, status } = this.reticleState(T);
    if (!cur) return;
    const dt = T - cur.t;
    let next = this.reticleEvents.find(e => e.t > cur.t && e.type !== 'status');
    if (cur.type === 'release') return;
    if (!pos || !pos.on) { if (cur.type !== 'lost') return; pos = this._lastPos || { x: BW / 2, y: BH / 2, on: true }; }
    this._lastPos = pos;
    const g = this.g; const { x, y } = pos;
    // fade out ahead of a release
    let a = 1;
    if (next && next.type === 'release') a *= 1 - smoothstep(next.t - 0.3, next.t, T);
    if (cur.type === 'lost') {
      const lostA = (1 - smoothstep(2.6, 3.4, dt)) * ((Math.floor(dt * 5) % 2 === 0) ? 1 : 0.35);
      const jit = 6 * (1 - smoothstep(0, 2.5, dt));
      const jx = (hash1(frame * 1.3) - 0.5) * jit, jy = (hash1(frame * 2.7) - 0.5) * jit;
      const sz = 26 + dt * 16;
      this.brackets(x + jx, y + jy, sz, 0, C_RED(0.9 * lostA));
      this.text(`✕  ${cur.en}`, x, y - sz - 22, MONO(500, 13), C_RED(lostA), { align: 'center', ls: 4 });
      this.text(cur.zh, x, y - sz - 4, SANS(400, 13), C_RED(0.85 * lostA), { align: 'center', ls: 4 });
      return;
    }
    const lock = clamp(dt / 0.7);
    const sc = lerp(3.0, 1.0, easeOutBack(lock, 1.4));
    const rot = lerp(Math.PI / 4, 0, easeOutCubic(lock));
    const fl = lock < 1 ? ((Math.floor(dt * 30) % 3 === 0) ? 0.4 : 1) : 1;
    const breathe = 1 + 0.05 * Math.sin(T * 2.4);
    const col = cur.type === 'reacquire' ? C_GOLD : C_AMBER;
    const sz = 22 * sc * breathe;
    this.brackets(x, y, sz, rot, col(0.95 * a * fl));
    g.fillStyle = col(a); g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill();
    // pulse rings at lock
    const rings = cur.type === 'reacquire' ? 3 : 1;
    for (let i = 0; i < rings; i++) {
      const rt = dt - i * 0.35; if (rt < 0 || rt > 1.6) continue;
      const rr = 8 + easeOutCubic(rt / 1.6) * (cur.type === 'reacquire' ? 160 : 70);
      g.strokeStyle = col(0.6 * (1 - rt / 1.6) * a); g.lineWidth = 1; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke();
    }
    // leader + label
    const la = a * smoothstep(0.35, 0.8, dt);
    if (la <= 0) return;
    const flip = x > BW - 360 ? -1 : 1;
    const x1 = x + flip * (sz + 4), y1 = y - (sz + 4);
    const x2 = x1 + flip * 46, y2 = y1 - 46;
    const len = 210 * easeOutCubic(clamp((dt - 0.35) / 0.5));
    g.strokeStyle = col(0.7 * la); g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x2 + flip * len, y2); g.stroke();
    const tx = flip > 0 ? x2 + 4 : x2 - 4, al = flip > 0 ? 'left' : 'right';
    const lab = cur.label || '¹²C #0001';
    this.text(scramble(lab, clamp(1 - (dt - 0.4) / 0.5), Math.floor(T * 24)), tx, y2 - 8, MONO(400, 14), col(la), { align: al, ls: 2 });
    const st = status && (T - status.t) >= 0 ? status : cur;
    const sa = status ? la * smoothstep(0, 0.6, T - status.t) : la;
    this.text(st.en, tx, y2 + 18, MONO(300, 11), col(0.85 * sa), { align: al, ls: 3 });
    this.text(st.zh, tx, y2 + 37, SANS(300, 13), col(0.85 * sa), { align: al, ls: 3 });
  }

  brackets(x, y, s, rot, color) {
    const g = this.g; const c = s * 0.42;
    g.save(); g.translate(x, y); g.rotate(rot); g.strokeStyle = color; g.lineWidth = 1.3;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.beginPath(); g.moveTo(sx * s, sy * (s - c)); g.lineTo(sx * s, sy * s); g.lineTo(sx * (s - c), sy * s); g.stroke();
    }
    g.restore();
  }

  // ---------- cards ----------
  drawCard(c, T) {
    const lt = T - c.start, dur = c.end - c.start;
    const shadow = { color: 'rgba(0,0,0,0.65)', blur: 22 };
    switch (c.style) {
      case 'presents': {
        const a = envelope(T, c.start, c.end, 1.2, 1.0);
        const ls = lerp(14, 20, lt / dur);
        this.text(c.en, BW / 2, 400, CINZEL(400, 24), C_HUD(0.9 * a), { align: 'center', ls });
        this.text(c.zh, BW / 2, 440, SERIF(300, 15), C_HUD(0.55 * a), { align: 'center', ls: 10 });
        break;
      }
      case 'location': {
        const a = envelope(T, c.start, c.end, 0.3, 1.2);
        const nz = Math.floor(clamp(lt / 1.0) * c.zh.length), ne = Math.floor(clamp((lt - 0.4) / 1.2) * c.en.length);
        const cur = (Math.floor(lt * 3) % 2 === 0 && lt < 2.2) ? '▍' : '';
        this.text(c.zh.slice(0, nz), M, 600, SERIF(300, 30), C_HUD(0.95 * a), { ls: 8, shadow });
        this.text(c.en.slice(0, ne) + cur, M, 632, MONO(300, 13), C_HUD(0.75 * a), { ls: 5, shadow });
        break;
      }
      case 'subtitle': case 'final': {
        const fin = 1.4, fout = 1.2;
        const a = envelope(T, c.start, c.end, fin, fout);
        const blur = lerp(10, 0, easeOutCubic(clamp(lt / fin))) + lerp(0, 6, clamp((lt - (dur - fout)) / fout));
        const y0 = c.style === 'final' ? 390 : 590;
        const zls = lerp(10, 13, lt / dur);
        this.text(c.zh, BW / 2, y0, SERIF(300, c.style === 'final' ? 40 : 34), C_HUD(0.96 * a), { align: 'center', ls: zls, blur, shadow });
        this.text(c.en, BW / 2, y0 + (c.style === 'final' ? 50 : 42), CORMI(400, c.style === 'final' ? 27 : 25), C_HUD(0.8 * a), { align: 'center', ls: 1.5, blur: blur * 0.8, shadow });
        break;
      }
      case 'title': case 'endtitle': {
        const big = c.style === 'title';
        const a = envelope(T, c.start, c.end, 2.2, 2.0);
        const rev = easeOutCubic(clamp(lt / 3.0));
        const blur = lerp(24, 0, rev) + lerp(0, 10, clamp((lt - (dur - 2.0)) / 2.0));
        const sc = lerp(1.07, 1.0, rev) * (1 + 0.012 * lt);
        const g = this.g; g.save(); g.translate(BW / 2, 400); g.scale(sc, sc); g.translate(-BW / 2, -400);
        const zs = big ? 150 : 104;
        this.text(c.zh, BW / 2, big ? 405 : 395, SERIF(300, zs), C_HUD(0.97 * a), { align: 'center', ls: big ? 70 : 50, blur, shadow: { color: 'rgba(0,0,0,0.55)', blur: 40 }, glow: { color: `rgba(255,236,210,${0.35 * a})`, blur: 50 } });
        const lw = 300 * easeInOutCubic(clamp((lt - 0.8) / 2.0));
        this.line(BW / 2 - lw, big ? 448 : 430, BW / 2 + lw, big ? 448 : 430, C_HUD(0.45 * a));
        this.text(c.en, BW / 2, big ? 492 : 470, CINZEL(400, big ? 26 : 20), C_HUD(0.88 * a), { align: 'center', ls: lerp(16, 22, lt / dur), blur: blur * 0.6, shadow });
        g.restore();
        break;
      }
      case 'credits': {
        let y = 402 - (c.lines.length - 1) * 45;
        c.lines.forEach((ln, i) => {
          const a = envelope(T, c.start + i * 1.4, c.end, 1.4, 1.6);
          if (ln.name) { this.text(ln.name, BW / 2, y, CINZEL(400, 34), C_HUD(0.95 * a), { align: 'center', ls: 16 }); y += 44; }
          if (ln.role) { this.text(ln.role, BW / 2, y, SERIF(300, 16), C_HUD(0.75 * a), { align: 'center', ls: 6 }); y += 28; }
          if (ln.roleEn) { this.text(ln.roleEn, BW / 2, y, MONO(300, 11), C_DIM(a), { align: 'center', ls: 4 }); y += 26; }
          y += 34;
        });
        break;
      }
    }
  }

  // ---------- boot sequence ----------
  drawBoot(lt, frame) {
    const b = this.tl.boot; const g = this.g;
    if (lt >= b.cutAt) return;
    const glitch = lt >= b.glitchAt ? (lt - b.glitchAt) / (b.cutAt - b.glitchAt) : 0;
    // frame lines draw from centre outward
    const fl = easeInOutCubic(clamp(lt / 1.2));
    const cy = 402, x0 = 360, x1 = 1560;
    this.line(BW / 2 - (BW / 2 - x0) * fl, cy - 150, BW / 2 + (x1 - BW / 2) * fl, cy - 150, C_HUD(0.35));
    this.line(BW / 2 - (BW / 2 - x0) * fl, cy + 170, BW / 2 + (x1 - BW / 2) * fl, cy + 170, C_HUD(0.35));
    // atom glyph (Bohr schematic) top-left of the block
    const ga = smoothstep(0.6, 1.4, lt);
    if (ga > 0) {
      const ax = x0 + 46, ay = cy - 92;
      g.save(); g.translate(ax, ay);
      for (let i = 0; i < 3; i++) {
        g.save(); g.rotate(i * Math.PI / 3 + lt * 0.4);
        g.strokeStyle = C_HUD(0.45 * ga); g.lineWidth = 1; g.beginPath(); g.ellipse(0, 0, 30, 10, 0, 0, Math.PI * 2); g.stroke();
        const ea = lt * (2.2 + i * 0.7) + i;
        g.fillStyle = C_AMBER(ga); g.beginPath(); g.arc(Math.cos(ea) * 30, Math.sin(ea) * 10, 2.2, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      g.fillStyle = C_AMBER(ga); g.beginPath(); g.arc(0, 0, 3.2, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    // typed lines
    let y = cy - 82; const tx = x0 + 110;
    b.lines.forEach((ln, i) => {
      const tt = lt - ln.t; if (tt < 0) return;
      const n = Math.floor(clamp(tt * 46 / ln.text.length) * ln.text.length);
      let s = ln.text.slice(0, n);
      const done = n >= ln.text.length;
      const last = i === b.lines.length - 1 || lt < b.lines[i + 1].t;
      if (last && (!done || Math.floor(lt * 2.5) % 2 === 0)) s += '█';
      const font = i === 0 ? MONO(400, 18) : MONO(300, 15);
      this.text(s, tx, y, font, i === 0 ? C_HUD(0.95) : C_HUD(0.82), { ls: i === 0 ? 6 : 2 });
      y += i === 0 ? 46 : 34;
    });
    // progress bar
    const pa = smoothstep(6.8, 7.2, lt);
    if (pa > 0) {
      const p = easeInOutCubic(clamp((lt - 7.0) / 1.5));
      g.strokeStyle = C_HUD(0.5 * pa); g.strokeRect(tx, cy + 120, 600, 8);
      g.fillStyle = C_AMBER(0.9 * pa); g.fillRect(tx + 2, cy + 122, 596 * p, 4);
      this.text(`SYNCHRONISING TEMPORAL AXIS  ${Math.floor(p * 100).toString().padStart(3, ' ')}%`, tx + 620, cy + 129, MONO(300, 12), C_HUD(0.7 * pa), { ls: 2 });
    }
    // glitch: slice-shift the drawn content
    if (glitch > 0) {
      this.bg.setTransform(1, 0, 0, 1, 0, 0); this.bg.clearRect(0, 0, this.W, this.H); this.bg.drawImage(this.canvas, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.W, this.H);
      const n = 26; const sh = this.H / n;
      for (let i = 0; i < n; i++) {
        const r = hash1(i * 11.3 + frame * 3.1);
        const off = (r > 0.6 ? (hash1(i + frame) - 0.5) * 260 * glitch : 0) * this.s;
        if (r < 0.12 * glitch) continue;
        g.globalAlpha = 1 - glitch * 0.6 * hash1(i * 5 + frame);
        g.drawImage(this.buf, 0, i * sh, this.W, sh, off, i * sh, this.W, sh);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.buf, 6 * glitch * this.s, 0); // ghost
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 6; i++) { const r = hash1(frame * 7 + i); if (r > glitch) continue; g.fillStyle = C_HUD(0.2 + 0.5 * hash1(i + frame * 1.7)); g.fillRect(hash1(i * 3 + frame) * this.W, hash1(i * 9 + frame) * this.H, (20 + 300 * hash1(i * 13 + frame)) * this.s, 3 * this.s); }
      g.setTransform(this.s, 0, 0, this.s, 0, 0);
    }
  }
}
