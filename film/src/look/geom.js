// Geometry helpers for line-art: polylines are flat Float32Arrays [x,y,z, x,y,z, ...].
import { Noise3 } from '../lib/cosmos.js';

export function polyLength(p) {
  let L = 0;
  for (let i = 3; i < p.length; i += 3) L += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
  return L;
}

// Resample a polyline to n evenly spaced points (by arc length).
export function resample(p, n) {
  const m = p.length / 3; const out = new Float32Array(n * 3);
  if (m < 2) { for (let i = 0; i < n; i++) out.set(p.subarray ? p.subarray(0, 3) : p.slice(0, 3), i * 3); return out; }
  const cum = new Float32Array(m); for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]);
  const L = cum[m - 1] || 1; let j = 0;
  for (let i = 0; i < n; i++) {
    const s = L * i / (n - 1);
    while (j < m - 2 && cum[j + 1] < s) j++;
    const k = (s - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = p[j * 3 + c] + (p[j * 3 + 3 + c] - p[j * 3 + c]) * k;
  }
  return out;
}

// Linear morph between two polylines of equal point count.
export function morph(a, b, k, out = new Float32Array(a.length)) {
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}

// Centripetal-ish Catmull-Rom through control points (flat array), `seg` samples per span.
export function catmull(p, seg = 8, closed = false) {
  const m = p.length / 3; const out = [];
  const P = i => { if (closed) i = (i + m) % m; else i = Math.max(0, Math.min(m - 1, i)); return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]; };
  const spans = closed ? m : m - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < seg; s++) {
      const t = s / seg, t2 = t * t, t3 = t2 * t;
      for (let c = 0; c < 3; c++) out.push(0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
    }
  }
  const last = closed ? P(0) : P(m - 1); out.push(...last);
  return new Float32Array(out);
}

// Circle / latitude-longitude lines of a sphere.
export function circle(cx, cy, cz, r, n = 128, axis = 'y') {
  const out = new Float32Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
    if (axis === 'y') out.set([cx + c, cy, cz + s], i * 3);
    else if (axis === 'z') out.set([cx + c, cy + s, cz], i * 3);
    else out.set([cx, cy + c, cz + s], i * 3);
  }
  return out;
}
export function sphereLines(r = 1, nLat = 12, nLon = 16, seg = 128) {
  const lines = [];
  for (let i = 1; i < nLat; i++) {
    const phi = -Math.PI / 2 + Math.PI * i / nLat;
    lines.push(circle(0, Math.sin(phi) * r, 0, Math.cos(phi) * r, seg, 'y'));
  }
  for (let j = 0; j < nLon; j++) {
    const th = Math.PI * j / nLon; const out = new Float32Array((seg + 1) * 3);
    for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; out.set([Math.cos(a) * Math.cos(th) * r, Math.sin(a) * r, Math.cos(a) * Math.sin(th) * r], i * 3); }
    lines.push(out);
  }
  return lines;
}

// Seeded curl noise field (divergence-free), returns [vx,vy,vz].
export function makeCurl(seed = 3, freq = 1) {
  const nx = new Noise3(seed), ny = new Noise3(seed + 17), nz = new Noise3(seed + 41); const e = 0.01;
  return (x, y, z) => {
    x *= freq; y *= freq; z *= freq;
    const dzdy = (nz.n(x, y + e, z) - nz.n(x, y - e, z)), dydz = (ny.n(x, y, z + e) - ny.n(x, y, z - e));
    const dxdz = (nx.n(x, y, z + e) - nx.n(x, y, z - e)), dzdx = (nz.n(x + e, y, z) - nz.n(x - e, y, z));
    const dydx = (ny.n(x + e, y, z) - ny.n(x - e, y, z)), dxdy = (nx.n(x, y + e, z) - nx.n(x, y - e, z));
    return [(dzdy - dydz) / (2 * e), (dxdz - dzdx) / (2 * e), (dydx - dxdy) / (2 * e)];
  };
}

// Integrate a streamline through a vector field fn(x,y,z)->[vx,vy,vz] (RK2), `steps` of size h.
export function streamline(fn, x, y, z, steps = 100, h = 0.05) {
  const out = new Float32Array((steps + 1) * 3); out.set([x, y, z], 0);
  for (let i = 1; i <= steps; i++) {
    const a = fn(x, y, z); const la = Math.hypot(a[0], a[1], a[2]) || 1;
    const mx = x + a[0] / la * h * 0.5, my = y + a[1] / la * h * 0.5, mz = z + a[2] / la * h * 0.5;
    const b = fn(mx, my, mz); const lb = Math.hypot(b[0], b[1], b[2]) || 1;
    x += b[0] / lb * h; y += b[1] / lb * h; z += b[2] / lb * h;
    out.set([x, y, z], i * 3);
  }
  return out;
}

// Marching squares: iso-lines of f(x,y) over a grid, joined into polylines (z = 0; map them yourself).
export function marchingSquares(f, x0, y0, x1, y1, nx, ny, iso = 0) {
  const vals = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const v = f(x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny) - iso; vals[j * (nx + 1) + i] = v === 0 ? 1e-9 : v; }
  const V = (i, j) => vals[j * (nx + 1) + i];
  const X = i => x0 + (x1 - x0) * i / nx, Y = j => y0 + (y1 - y0) * j / ny;
  const segs = [];
  const lerpP = (xa, ya, va, xb, yb, vb) => { const t = va / (va - vb); return [xa + (xb - xa) * t, ya + (yb - ya) * t]; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
    const idx = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const e = [];
    if ((a > 0) !== (b > 0)) e.push(lerpP(X(i), Y(j), a, X(i + 1), Y(j), b));
    if ((b > 0) !== (c > 0)) e.push(lerpP(X(i + 1), Y(j), b, X(i + 1), Y(j + 1), c));
    if ((c > 0) !== (d > 0)) e.push(lerpP(X(i + 1), Y(j + 1), c, X(i), Y(j + 1), d));
    if ((d > 0) !== (a > 0)) e.push(lerpP(X(i), Y(j + 1), d, X(i), Y(j), a));
    if (e.length === 2) segs.push(e);
    else if (e.length === 4) { segs.push([e[0], e[1]]); segs.push([e[2], e[3]]); }
  }
  // join segments into polylines
  const key = p => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const adj = new Map();
  segs.forEach((s, k) => { for (const e of [0, 1]) { const kk = key(s[e]); if (!adj.has(kk)) adj.set(kk, []); adj.get(kk).push(k); } });
  const used = new Uint8Array(segs.length); const lines = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue; used[k] = 1;
    const pts = [segs[k][0], segs[k][1]];
    for (const dirn of [1, 0]) {
      let guard = 0;
      while (guard++ < 100000) {
        const end = dirn ? pts[pts.length - 1] : pts[0];
        const cand = (adj.get(key(end)) || []).find(q => !used[q]);
        if (cand === undefined) break;
        used[cand] = 1; const s = segs[cand]; const nxt = key(s[0]) === key(end) ? s[1] : s[0];
        if (dirn) pts.push(nxt); else pts.unshift(nxt);
      }
    }
    if (pts.length > 2 || Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) > 1e-4 * Math.abs(x1 - x0) / nx) lines.push(pts);
  }
  return lines; // arrays of [x,y]
}

// Convert [[x,y],...] to a flat xyz polyline via a mapping function (x,y)->[X,Y,Z].
export function mapPoly(pts2, fn) { const out = new Float32Array(pts2.length * 3); pts2.forEach((p, i) => out.set(fn(p[0], p[1]), i * 3)); return out; }
