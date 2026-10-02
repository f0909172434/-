// The river as a coordinate system. Everything in the river scene lives in river coordinates (s, h, n):
//   s  arc length along the centreline, 0 at the source (the crack, 1200 BCE) growing downstream to the present
//   h  height above the water plane (y)
//   n  lateral offset along N = T x U (the text faces +N; the camera always watches from the +N side)
// The centreline lies in the xz-plane; T = (cos th, 0, sin th), U = (0, 1, 0), N = (-sin th, 0, cos th).
// Pure JS (no DOM): the scene uses it, and so can a Node script that checks compositions numerically.
import { smoothstep, clamp, lerp } from './ease.js';

export const RIVER = {
  S: 150,          // centreline length (units)
  DS: 0.125,       // sampling step
  // half-width of the river: a crack at the source, a thin stream in 800 BCE, wide in the present
  half: s => 0.03 + 6.6 * Math.pow(clamp(s / 105, 0, 1), 0.9) * smoothstep(-1, 8, s),
};

// heading (radians) along the river: long gentle meanders, straight at the source
function heading(s) {
  const k = smoothstep(4, 30, s);
  return k * (0.36 * Math.sin(2 * Math.PI * (s - 30) / 118) + 0.10 * Math.sin(2 * Math.PI * (s + 11) / 41)) - 0.05;
}

export class River {
  constructor() {
    const { S, DS } = RIVER;
    const n = Math.round(S / DS) + 1;
    this.n = n; this.ds = DS;
    this.x = new Float64Array(n); this.z = new Float64Array(n); this.th = new Float64Array(n);
    let x = 0, z = 0;
    for (let i = 0; i < n; i++) {
      const s = i * DS, th = heading(s);
      this.th[i] = th; this.x[i] = x; this.z[i] = z;
      // midpoint rule for the next step
      const tm = heading(s + DS / 2);
      x += Math.cos(tm) * DS; z += Math.sin(tm) * DS;
    }
  }
  // frame at arc length s (linear between samples, straight extrapolation past the ends)
  at(s, o = {}) {
    const f = s / this.ds, i = clamp(Math.floor(f), 0, this.n - 2), k = f - i;
    const th = this.th[i] + (this.th[i + 1] - this.th[i]) * clamp(k, 0, 1);
    const tx = Math.cos(th), tz = Math.sin(th);
    if (k < 0 || k > 1) {
      const e = k < 0 ? 0 : this.n - 1, ds = (s - e * this.ds);
      o.x = this.x[e] + Math.cos(this.th[e]) * ds; o.z = this.z[e] + Math.sin(this.th[e]) * ds;
    } else { o.x = this.x[i] + (this.x[i + 1] - this.x[i]) * k; o.z = this.z[i] + (this.z[i + 1] - this.z[i]) * k; }
    o.th = th; o.tx = tx; o.tz = tz; o.nx = -tz; o.nz = tx; o.half = RIVER.half(s);
    return o;
  }
  // world position of river coordinates
  world(s, h, n, out = [0, 0, 0]) {
    const f = this.at(s, _f);
    out[0] = f.x + f.nx * n; out[1] = h; out[2] = f.z + f.nz * n;
    return out;
  }
  // polyline (flat xyz) along the river at fixed (h, n), from s0 to s1
  line(s0, s1, h, n, step = 0.5) {
    const m = Math.max(2, Math.ceil(Math.abs(s1 - s0) / step) + 1), out = new Float32Array(m * 3), p = [0, 0, 0];
    for (let i = 0; i < m; i++) { this.world(lerp(s0, s1, i / (m - 1)), h, n, p); out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2]; }
    return out;
  }
  // the centreline as a TextField path (text reads downstream, stands upright, faces +N)
  path(step = 0.25) { return { points: Array.from(this.line(0, RIVER.S, 0, 0, step)), up: [0, 1, 0] }; }
}
const _f = {};

// parabolic velocity profile across the river (fastest mid-stream), units / s
export function flowSpeed(n, half, vmax = 0.55) {
  const u = clamp(Math.abs(n) / Math.max(half, 1e-3), 0, 1);
  return vmax * (0.18 + 0.82 * (1 - u * u));
}
