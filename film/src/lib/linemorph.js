// Line-morph toolkit for continuous line-drawing metamorphoses (used by scenes/life.js).
//
// A "form" is a drawing made of a fixed, ordered list of strokes. Every stroke is resampled to NP
// points by arc length, so any stroke of one form can flow into any stroke of the next.
// Between two forms, strokes are paired by an optimal assignment (Hungarian algorithm on shape
// distance); strokes without a partner split off from (or merge into) their nearest neighbour,
// so nothing ever pops in or out of existence.
//
// Everything here is deterministic and allocation-light: forms write into preallocated buffers.

export const NP = 160;                        // points per stroke

// ------------------------------------------------------------------ small vector helpers
export const TAU = Math.PI * 2;

// ------------------------------------------------------------------ curve building
// Centripetal Catmull-Rom through control points (flat xyz), `seg` samples per span, into `out` (JS array).
export function crDense(c, seg, closed, out) {
  out.length = 0;
  const m = c.length / 3;
  if (m < 2) { for (let i = 0; i < c.length; i++) out.push(c[i]); return out; }
  const spans = closed ? m : m - 1;
  const idx = i => closed ? ((i % m) + m) % m : Math.max(0, Math.min(m - 1, i));
  for (let s = 0; s < spans; s++) {
    const i0 = idx(s - 1), i1 = idx(s), i2 = idx(s + 1), i3 = idx(s + 2);
    let x0 = c[i0 * 3], y0 = c[i0 * 3 + 1], z0 = c[i0 * 3 + 2];
    const x1 = c[i1 * 3], y1 = c[i1 * 3 + 1], z1 = c[i1 * 3 + 2];
    const x2 = c[i2 * 3], y2 = c[i2 * 3 + 1], z2 = c[i2 * 3 + 2];
    let x3 = c[i3 * 3], y3 = c[i3 * 3 + 1], z3 = c[i3 * 3 + 2];
    // phantom end points for open curves (reflect)
    if (!closed && s === 0) { x0 = 2 * x1 - x2; y0 = 2 * y1 - y2; z0 = 2 * z1 - z2; }
    if (!closed && s === spans - 1) { x3 = 2 * x2 - x1; y3 = 2 * y2 - y1; z3 = 2 * z2 - z1; }
    const d01 = Math.pow(Math.hypot(x1 - x0, y1 - y0, z1 - z0), 0.5) || 1e-4;
    const d12 = Math.pow(Math.hypot(x2 - x1, y2 - y1, z2 - z1), 0.5) || 1e-4;
    const d23 = Math.pow(Math.hypot(x3 - x2, y3 - y2, z3 - z2), 0.5) || 1e-4;
    // tangents (Barry-Goldman form, rescaled to the [t1,t2] span)
    const m1x = d12 * ((x1 - x0) / d01 - (x2 - x0) / (d01 + d12)) + (x2 - x1);
    const m1y = d12 * ((y1 - y0) / d01 - (y2 - y0) / (d01 + d12)) + (y2 - y1);
    const m1z = d12 * ((z1 - z0) / d01 - (z2 - z0) / (d01 + d12)) + (z2 - z1);
    const m2x = d12 * ((x3 - x2) / d23 - (x3 - x1) / (d12 + d23)) + (x2 - x1);
    const m2y = d12 * ((y3 - y2) / d23 - (y3 - y1) / (d12 + d23)) + (y2 - y1);
    const m2z = d12 * ((z3 - z2) / d23 - (z3 - z1) / (d12 + d23)) + (z2 - z1);
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push(h00 * x1 + h10 * m1x + h01 * x2 + h11 * m2x,
        h00 * y1 + h10 * m1y + h01 * y2 + h11 * m2y,
        h00 * z1 + h10 * m1z + h01 * z2 + h11 * m2z);
    }
  }
  const e = closed ? idx(0) : m - 1;
  out.push(c[e * 3], c[e * 3 + 1], c[e * 3 + 2]);
  return out;
}

// Resample a dense polyline (flat xyz, any length >= 2 points) to n points by arc length, into out (Float32Array).
const _cum = new Float64Array(1 << 16);
export function resampleInto(p, pl, n, out) {
  const m = pl / 3;
  if (m < 2) { for (let i = 0; i < n; i++) { out[i * 3] = p[0] || 0; out[i * 3 + 1] = p[1] || 0; out[i * 3 + 2] = p[2] || 0; } return 0; }
  const cum = m <= _cum.length ? _cum : new Float64Array(m);
  cum[0] = 0;
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]);
  const L = cum[m - 1];
  if (L < 1e-9) { for (let i = 0; i < n; i++) { out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2]; } return 0; }
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = L * i / (n - 1);
    while (j < m - 2 && cum[j + 1] < s) j++;
    const k = (s - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-12);
    out[i * 3] = p[j * 3] + (p[j * 3 + 3] - p[j * 3]) * k;
    out[i * 3 + 1] = p[j * 3 + 1] + (p[j * 3 + 4] - p[j * 3 + 1]) * k;
    out[i * 3 + 2] = p[j * 3 + 2] + (p[j * 3 + 5] - p[j * 3 + 2]) * k;
  }
  return L;
}

// ------------------------------------------------------------------ stroke buffers
// A Stroke holds one resampled stroke and its drawing attributes.
export class Stroke {
  constructor() {
    this.p = new Float32Array(NP * 3);
    this.I = 0;          // intensity
    this.w = 1.2;        // width px @804p
    this.closed = false;
    this.t0 = 0.12;      // taper fraction at start (width+alpha), open strokes
    this.t1 = 0.12;      // taper fraction at end
    this.tw = 0.25;      // width at the tapered tip (fraction)
    this.amber = 0;      // 0..1 tint towards PAL.c ("you")
    this.len = 0;
  }
}

// The emitter forms write into. Each call fills the next stroke, in a fixed order.
const _dense = [];
export class Emitter {
  constructor(count) { this.s = Array.from({ length: count }, () => new Stroke()); this.n = 0; }
  reset() { this.n = 0; }
  _next(o) {
    const st = this.s[this.n++];
    if (!st) throw new Error('Emitter overflow');
    st.I = o.I ?? 0.8; st.w = o.w ?? 1.2; st.closed = !!o.closed;
    st.t0 = o.t0 ?? (st.closed ? 0 : 0.12); st.t1 = o.t1 ?? (st.closed ? 0 : 0.12); st.tw = o.tw ?? 0.3;
    st.amber = o.amber ?? 0;
    return st;
  }
  // catmull-rom through control points
  cr(ctrl, o = {}) {
    const st = this._next(o);
    crDense(ctrl, o.seg ?? 12, st.closed, _dense);
    st.len = resampleInto(_dense, _dense.length, NP, st.p);
    return st;
  }
  // already dense polyline
  poly(dense, o = {}) {
    const st = this._next(o);
    if (st.closed) {
      // make sure it is closed
      const n = dense.length;
      if (Math.hypot(dense[0] - dense[n - 3], dense[1] - dense[n - 2], dense[2] - dense[n - 1]) > 1e-6) {
        _dense.length = 0; for (let i = 0; i < n; i++) _dense.push(dense[i]); _dense.push(dense[0], dense[1], dense[2]);
        st.len = resampleInto(_dense, _dense.length, NP, st.p); return st;
      }
    }
    st.len = resampleInto(dense, dense.length, NP, st.p);
    return st;
  }
  // an invisible placeholder that keeps the stroke order stable
  none(x = 0, y = 0, z = 0) {
    const st = this._next({ I: 0 });
    for (let i = 0; i < NP; i++) { st.p[i * 3] = x; st.p[i * 3 + 1] = y; st.p[i * 3 + 2] = z; }
    st.len = 0; return st;
  }
}

// ------------------------------------------------------------------ alignment + matching
// Alignment op for putting stroke b into correspondence with a: reverse and (closed only) cyclic shift.
export function applyAlign(src, rev, shift, closed, out) {
  const n = NP;
  if (!rev && !shift) { out.set(src); return out; }
  if (closed) {
    const u = n - 1; // unique points
    for (let i = 0; i < u; i++) {
      let j = rev ? (u - i) % u : i;
      j = (j + shift) % u;
      out[i * 3] = src[j * 3]; out[i * 3 + 1] = src[j * 3 + 1]; out[i * 3 + 2] = src[j * 3 + 2];
    }
    out[u * 3] = out[0]; out[u * 3 + 1] = out[1]; out[u * 3 + 2] = out[2];
  } else {
    for (let i = 0; i < n; i++) {
      const j = rev ? n - 1 - i : i;
      out[i * 3] = src[j * 3]; out[i * 3 + 1] = src[j * 3 + 1]; out[i * 3 + 2] = src[j * 3 + 2];
    }
  }
  return out;
}

const NC = 40; // coarse resolution for matching
function coarse(p) {
  const o = new Float32Array(NC * 3);
  for (let i = 0; i < NC; i++) {
    const f = i / (NC - 1) * (NP - 1), j = Math.min(NP - 2, Math.floor(f)), k = f - j;
    for (let c = 0; c < 3; c++) o[i * 3 + c] = p[j * 3 + c] * (1 - k) + p[j * 3 + 3 + c] * k;
  }
  return o;
}

// best alignment of b (stroke) onto a (slot geometry): returns {cost, rev, shift}
// shift is in units of NP-1 unique points for closed b.
export function bestAlign(a, b, bClosed) {
  const A = coarse(a), B = coarse(b);
  let best = { cost: Infinity, rev: false, shift: 0 };
  const evalCost = (rev, sh) => {
    let s = 0;
    for (let i = 0; i < NC; i++) {
      let j;
      if (bClosed) { const u = NC - 1; j = rev ? (u - i) % u : i; j = (j + sh) % u; }
      else j = rev ? NC - 1 - i : i;
      const dx = A[i * 3] - B[j * 3], dy = A[i * 3 + 1] - B[j * 3 + 1], dz = A[i * 3 + 2] - B[j * 3 + 2];
      s += dx * dx + dy * dy + dz * dz;
    }
    return s / NC;
  };
  if (bClosed) {
    for (const rev of [false, true]) for (let sh = 0; sh < NC - 1; sh++) {
      const c = evalCost(rev, sh);
      if (c < best.cost) best = { cost: c, rev, shift: sh };
    }
    best.shift = Math.round(best.shift * (NP - 1) / (NC - 1)) % (NP - 1);
  } else {
    for (const rev of [false, true]) { const c = evalCost(rev, 0); if (c < best.cost) best = { cost: c, rev, shift: 0 }; }
  }
  best.cost = Math.sqrt(best.cost);
  return best;
}

// Hungarian algorithm (min cost perfect assignment), square matrix n x n (array of arrays). Returns col for each row.
export function hungarian(C) {
  const n = C.length, INF = 1e18;
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF), used = new Uint8Array(n + 1);
    do {
      used[j0] = 1; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = C[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = new Int32Array(n);
  for (let j = 1; j <= n; j++) if (p[j]) ans[p[j] - 1] = j - 1;
  return ans;
}

// ------------------------------------------------------------------ smoothing along a stroke
const _wts = new Float64Array(64);
export function smoothInto(src, dst, sigma, closed) {
  const n = NP;
  if (sigma < 0.25) { dst.set(src); return dst; }
  const R = Math.min(30, Math.ceil(sigma * 2.6));
  let ws = 0;
  for (let d = 0; d <= R; d++) { _wts[d] = Math.exp(-d * d / (2 * sigma * sigma)); ws += d ? 2 * _wts[d] : _wts[d]; }
  const u = n - 1;
  const lx = src[u * 3], ly = src[u * 3 + 1], lz = src[u * 3 + 2];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, sz = 0;
    for (let d = -R; d <= R; d++) {
      const w = _wts[d < 0 ? -d : d];
      let j = i + d, x, y, z;
      if (closed) {
        j = ((j % u) + u) % u; x = src[j * 3]; y = src[j * 3 + 1]; z = src[j * 3 + 2];
      } else if (j < 0) {
        const q = Math.min(u, -j); x = 2 * src[0] - src[q * 3]; y = 2 * src[1] - src[q * 3 + 1]; z = 2 * src[2] - src[q * 3 + 2];
      } else if (j > u) {
        const q = Math.max(0, 2 * u - j); x = 2 * lx - src[q * 3]; y = 2 * ly - src[q * 3 + 1]; z = 2 * lz - src[q * 3 + 2];
      } else { x = src[j * 3]; y = src[j * 3 + 1]; z = src[j * 3 + 2]; }
      sx += w * x; sy += w * y; sz += w * z;
    }
    dst[i * 3] = sx / ws; dst[i * 3 + 1] = sy / ws; dst[i * 3 + 2] = sz / ws;
  }
  if (closed) { dst[u * 3] = dst[0]; dst[u * 3 + 1] = dst[1]; dst[u * 3 + 2] = dst[2]; }
  return dst;
}
