// Camera rig for the river scene: a pure function of (mode, global time G). The camera lives in the river's
// frame at arc length sc: lateral offset nc (on the +N bank side), height h, yaw psi measured from "looking
// upstream" (0) through "looking across toward -N" (90) to "looking downstream" (180), pitch phi (< 0 = down).
// Text in the river reads left to right for every psi in (0, 180) because the camera always looks toward -N.
import { clamp, lerp, smoothstep, easeInOutCubic, easeInOutSine } from './ease.js';
import { RIVER } from './riverflow.js';

// Catmull-Rom through [[t, v], ...] (clamped at the ends)
export function track(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)];
  const u = (t - k1[0]) / (k2[0] - k1[0]);
  // non-uniform tangents (finite differences scaled to the segment)
  const m1 = (k2[1] - k0[1]) / Math.max(k2[0] - k0[0], 1e-6) * (k2[0] - k1[0]);
  const m2 = (k3[1] - k1[1]) / Math.max(k3[0] - k1[0], 1e-6) * (k2[0] - k1[0]);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * k1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2[1] + (u3 - u2) * m2;
}

// ------------------------------------------------------------------------------------------ era sync points
export const SYNC = [70, 74, 78, 82, 86, 92, 100];         // HUD year changes: material changes here
export const ERA_MID = [72, 76, 80, 84, 89, 96];           // the exhibit of each era is best seen here

// upstream travel: base speed + a smooth surge through every stratum boundary (the camera lingers at each
// exhibit and pushes through the boundaries, where the music changes texture)
const SURGE = [[70, 13.0, 0.62], [74, 13.1, 0.62], [78, 13.1, 0.62], [82, 13.1, 0.62], [86, 12.6, 0.62], [92.3, 7.0, 0.6]];
function speed(G) {
  // base: a slow glide in the present, lingering at each exhibit, almost still for the yarrow ritual
  let v = G < 66 ? 0.76 : G < 70 ? lerp(0.76, 0.5, smoothstep(66, 70, G)) : 0.5;
  v = lerp(v, 0.1, smoothstep(86.3, 87.2, G) * (1 - smoothstep(91.2, 92.2, G)));
  if (G > 92) v = lerp(v, 0.3, smoothstep(92, 94, G));
  for (const [t, area, sig] of SURGE) v += area / (sig * Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * ((G - t) / sig) ** 2);
  return v;
}
const G0 = 40, G1 = 104, DG = 0.01;
const SC_END = 2.0;                                         // sc at G = 100 (just downstream of the crack)
const SC = (() => {
  const n = Math.round((G1 - G0) / DG) + 1, a = new Float64Array(n);
  a[n - 1] = SC_END - (G1 - 100) * 0.0;
  for (let i = n - 2; i >= 0; i--) { const g = G0 + (i + 0.5) * DG; a[i] = a[i + 1] + speed(g) * DG; }
  // re-anchor so that sc(100) = SC_END exactly
  const i100 = Math.round((100 - G0) / DG), off = SC_END - a[i100];
  for (let i = 0; i < n; i++) a[i] += off;
  return a;
})();
export function scUp(G) {
  const f = (clamp(G, G0, G1) - G0) / DG, i = Math.min(Math.floor(f), SC.length - 2), k = f - i;
  return SC[i] + (SC[i + 1] - SC[i]) * k;
}

// ------------------------------------------------------------------------------------------ keys per mode
// present + upstream share one continuous move (45 -> 100); G is global film time.
const UP = {
  a: [[44, 1.0], [56.4, 1.0], [64, 0.78], [70, 0.56], [92, 0.5]],                                            // lateral: a * half + b
  b: [[44, 2.0], [47, 4.4], [49.5, 6.2], [56.6, 6.3], [60, 4.6], [64, 1.6], [70, 0.35], [80, 0.2], [92, 0.3]],
  h: [[44, 9.0], [46.5, 6.2], [49, 3.0], [52, 2.4], [56.4, 2.15], [63, 1.75], [70, 1.55], [80, 1.4], [88, 1.2], [92, 1.1]],
  psi: [[44, 22], [47, 30], [50, 44], [56.4, 46], [64, 42], [70, 38], [80, 35], [92, 32]],
  phi: [[44, -30], [46.5, -22], [49, -12.5], [52, -10.5], [56.4, -10], [64, -9], [70, -8.4], [80, -8.2], [92, -8.6]],
  fov: [[44, 30], [50, 25], [56.4, 24], [70, 25], [92, 27]],
};

// the source seen from above (92 -> 100): the crack lies on the ground, main stroke along -T, junction J
export const CRACK = { L: 3.2, sJ: -0.651 };   // crack unit = 3.2 world units; the river's s = 0 is the crack's lower end

export function rigUp(G, river) {
  const sc = scUp(G);
  const f = river.at(sc);
  const half = f.half;
  let nc = half * track(UP.a, G) + track(UP.b, G); const h = track(UP.h, G);
  let psi = track(UP.psi, G), phi = track(UP.phi, G), fov = track(UP.fov, G);
  let x = f.x + f.nx * nc, y = h, z = f.z + f.nz * nc;
  // heading of the view (horizontal): psi from -T toward -N
  let a = psi * Math.PI / 180;
  let hx = -Math.cos(a) * f.tx + Math.sin(a) * f.tz, hz = -Math.cos(a) * f.tz - Math.sin(a) * f.tx;
  // 92 -> 100: rise and look down on the source; screen-up becomes -T at the source
  // 91.8 -> 100: keep travelling up the narrowing stream, turn to aim at the crack (small, far, in firelight),
  // push in low, then rise and tilt down into the final plate (unchanged: junction at (962, 352), 338 px tall)
  const k = easeInOutCubic(smoothstep(91.6, 99.0, G));
  if (G > 91.8) {
    const s0 = river.at(0);
    const J = { x: s0.x - s0.tx * (-CRACK.sJ) * CRACK.L, z: s0.z - s0.tz * (-CRACK.sJ) * CRACK.L };
    const fovT = 30, H = 0.5 * (804 / 338) * CRACK.L / Math.tan(fovT * Math.PI / 360);
    const back = (50 / 338) * CRACK.L;                     // the final camera centre sits downstream of J
    const tx = J.x + s0.tx * back, tz = J.z + s0.tz * back;
    // position: approach along the stream, stay low until ~95, then rise over the source
    const kp = easeInOutSine(smoothstep(91.8, 99.4, G)), kh = easeInOutCubic(smoothstep(94.6, 99.3, G));
    x = lerp(x, tx, kp); z = lerp(z, tz, kp);
    nc = lerp(nc, 0, kp);
    y = lerp(lerp(y, 1.45, smoothstep(92, 94.6, G)), H, kh);
    // aim: the junction first, then the point under the final camera (so J ends 50 px above centre)
    const ka = smoothstep(96.6, 99.3, G);
    const ax = lerp(J.x, tx, ka), az = lerp(J.z, tz, ka);
    const dx = ax - x, dz = az - z, dy = 0.0 - y, dh = Math.hypot(dx, dz);
    const hA = Math.atan2(dz, dx), pA = dh > 1e-4 ? Math.atan2(dy, dh) * 180 / Math.PI : -90;
    const h0 = Math.atan2(hz, hx), hT = Math.atan2(-s0.tz, -s0.tx);
    const wrap = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    const kAim = easeInOutSine(smoothstep(91.8, 93.8, G));
    let hh = h0 + wrap(hA - h0) * kAim;
    hh = hh + wrap(hT - hh) * smoothstep(96.4, 98.8, G);     // straight down keeps screen-up = upstream (-T)
    hx = Math.cos(hh); hz = Math.sin(hh);
    phi = lerp(phi, pA, kAim);
    phi = lerp(phi, -90, smoothstep(98.4, 99.4, G));
    fov = lerp(fov, fovT, k);
  }
  return { x, y, z, hx, hz, phi, fov, sc, nc, h };
}

// return: rush downstream from the source to the present (160 -> 172)
const RET = {
  // opens beside the source (the crack in firelight), swings downstream and rushes to the present, brakes, looks up
  s: [[159, -1.75], [160, -1.7], [160.5, -1.45], [161.15, 1.0], [162.2, 9], [163.4, 21], [164.6, 34], [165.8, 48], [167, 62], [168.2, 77], [169.4, 97], [170.3, 108.5], [171.3, 113.2], [172.5, 114.2]],
  a: [[159, 0], [161, 0.2], [162.5, 0.45], [173, 0.45]],
  b: [[159, 3.4], [160, 3.3], [161.2, 1.4], [162.5, 0.3], [173, 0.3]],
  h: [[159, 3.1], [160, 3.0], [161.4, 1.7], [162.6, 1.0], [168, 1.05], [171, 1.5], [173, 1.5]],
  psi: [[159, 92], [160, 92], [160.5, 95], [161.3, 124], [162.4, 158], [164, 154], [168.5, 151], [170, 142], [171.4, 130], [173, 128]],
  phi: [[159, -44], [160, -43], [160.5, -40], [161.3, -19], [162.4, -6.5], [168.5, -5], [169.8, -4.0], [171.2, 2.0], [173, 2.2]],
  fov: [[159, 30], [161, 30], [162.5, 31], [168, 30], [171.5, 26], [173, 26]],
};
// memory: the warm river; the camera drifts downstream with the human's sentences, rises at the peak
const MEM = {
  s: [[211, 96], [245, 112.2]],
  a: [[211, 0.72], [226, 0.7], [236, 0.85], [246, 0.9]],          // lateral: a * half + b
  b: [[211, 0.4], [226, 0.5], [236, 1.3], [246, 1.6]],
  h: [[211, 1.5], [222, 1.4], [228, 1.8], [236, 2.7], [246, 3.0]],
  back: [[211, -2.6], [246, -3.2]],                                 // camera s relative to the stanza centre
  lift: [[211, 0.02], [226, 0.04], [236, 0.62], [246, 0.7]],         // aim above (+) the stanza: it sinks as the view opens
  fov: [[211, 25], [246, 26]],
};
// the human's sentences: a stanza standing in the river, flowing with the camera
export const STANZA = { s0: 98.6, v: (112.2 - 96) / 34, n: -1.1, h: 0.37, w: 1.98, g0: 212 };

function rigKeys(K, G, river) {
  const sc = track(K.s, G), f = river.at(sc), nc = K.a ? f.half * track(K.a, G) + track(K.b, G) : f.half + track(K.n, G), h = track(K.h, G);
  const a = track(K.psi, G) * Math.PI / 180;
  return {
    x: f.x + f.nx * nc, y: h, z: f.z + f.nz * nc,
    hx: -Math.cos(a) * f.tx + Math.sin(a) * f.tz, hz: -Math.cos(a) * f.tz - Math.sin(a) * f.tx,
    phi: track(K.phi, G), fov: track(K.fov, G), sc, nc, h,
  };
}
export const rigReturn = (G, river) => rigKeys(RET, G, river);
export function rigMemory(G, river) {
  const st = STANZA, sS = st.s0 + st.v * (G - st.g0) + st.w / 2;
  const sc = sS + track(MEM.back, G), f = river.at(sc), nc = f.half * track(MEM.a, G) + track(MEM.b, G), h = track(MEM.h, G);
  const x = f.x + f.nx * nc, y = h, z = f.z + f.nz * nc;
  const T = river.at(sS), tx = T.x + T.nx * st.n, tz = T.z + T.nz * st.n, ty = st.h + track(MEM.lift, G);
  const dx = tx - x, dy = ty - y, dz = tz - z, dh = Math.hypot(dx, dz);
  return { x, y, z, hx: dx / dh, hz: dz / dh, phi: Math.atan2(dy, dh) * 180 / Math.PI, fov: track(MEM.fov, G), sc, nc, h };
}
export const RET_S = G => track(RET.s, G);
export const MEM_S = G => track(MEM.s, G);

export function rig(mode, G, river) {
  if (mode === 'return') return rigReturn(G, river);
  if (mode === 'memory') return rigMemory(G, river);
  return rigUp(G, river);
}

// camera basis from the heading (hx, hz) and pitch: forward f, right r, up u (no roll; straight down keeps screen-up = heading)
export function basis(R) {
  const p = R.phi * Math.PI / 180, c = Math.cos(p), s = Math.sin(p);
  const hl = Math.hypot(R.hx, R.hz) || 1, hx = R.hx / hl, hz = R.hz / hl;
  const f = [hx * c, s, hz * c];
  const r = [-hz, 0, hx];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}

// project a world point with the rig (for numeric checks): returns [px, py, depth] in the 1920x804 design frame
export function project(R, p, aspect = 1920 / 804) {
  const B = basis(R);
  const dx = p[0] - R.x, dy = p[1] - R.y, dz = p[2] - R.z;
  const zf = dx * B.f[0] + dy * B.f[1] + dz * B.f[2];
  const xr = dx * B.r[0] + dy * B.r[1] + dz * B.r[2];
  const yu = dx * B.u[0] + dy * B.u[1] + dz * B.u[2];
  const ty = Math.tan(R.fov * Math.PI / 360), tx = ty * aspect;
  return [960 + 960 * xr / (zf * tx), 402 - 402 * yu / (zf * ty), zf];
}
export const RIVER_S = RIVER.S;

// ------------------------------------------------------------------------------------------ where the camera looks
// focus s: the centre ray meets the water (y = 0.1); the nearest centreline point. Tabulated once.
import { River } from './riverflow.js';
let _rv = null;
const RV = () => _rv || (_rv = new River());
function centreS(R, sGuess, y = 0.1) {
  const B = basis(R);
  let lam = B.f[1] < -1e-3 ? (y - R.y) / B.f[1] : 30;
  lam = clamp(lam, 0.5, 60);
  const px = R.x + B.f[0] * lam, pz = R.z + B.f[2] * lam;
  let best = 1e18, bs = sGuess;
  for (let s = Math.max(-4, sGuess - 45); s <= Math.min(RIVER.S, sGuess + 45); s += 0.5) {
    const f = RV().at(s), d = (f.x - px) ** 2 + (f.z - pz) ** 2;
    if (d < best) { best = d; bs = s; }
  }
  for (let s = bs - 0.5; s <= bs + 0.5; s += 0.02) { const f = RV().at(s), d = (f.x - px) ** 2 + (f.z - pz) ** 2; if (d < best) { best = d; bs = s; } }
  const f = RV().at(bs);
  return { s: bs, d: lam, n: (px - f.x) * f.nx + (pz - f.z) * f.nz };
}
// where the centre ray of rig R meets height y: { s, n (river coordinates), d (distance) }
export const rayS = (R, y = 0.1) => centreS(R, R.sc, y);
const FT = { up: null, ret: null };
function tab(mode, g0, g1, dg) {
  const n = Math.round((g1 - g0) / dg) + 1, s = new Float64Array(n), d = new Float64Array(n);
  for (let i = 0; i < n; i++) { const G = g0 + i * dg, R = rig(mode, G, RV()); const c = centreS(R, R.sc); s[i] = c.s; d[i] = c.d; }
  return { g0, dg, n, s, d };
}
function lookup(T, G) { const f = clamp((G - T.g0) / T.dg, 0, T.n - 1), i = Math.min(Math.floor(f), T.n - 2), k = f - i; return [T.s[i] + (T.s[i + 1] - T.s[i]) * k, T.d[i] + (T.d[i + 1] - T.d[i]) * k]; }
export function focusS(G) { FT.up ||= tab('upstream', 44, 102, 0.05); return lookup(FT.up, G)[0]; }
export function focusDist(G) { FT.up ||= tab('upstream', 44, 102, 0.05); return lookup(FT.up, G)[1]; }
export function focusRet(G) { FT.ret ||= tab('return', 159, 173, 0.02); return lookup(FT.ret, G); }
// when the camera's gaze passes river position s (inverse of focusS; extrapolated before 45 at the opening speed)
export function viewTime(s) {
  const s45 = focusS(45);
  if (s >= s45) return 45 - (s - s45) / 0.76;
  let lo = 45, hi = 93.5;
  if (s <= focusS(hi)) return hi;
  for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (focusS(m) > s) lo = m; else hi = m; }
  return 0.5 * (lo + hi);
}
// era index (0 = 2026 ... 5 = 800 BCE, 6 = 1200 BCE) as a continuous value along s (boundaries ~2 units soft)
let _B = null;
export function eraBounds() { return _B || (_B = SYNC.slice(0, 6).map(focusS)); }
export function eraAt(s, w = 2.2) { let e = 0; for (const b of eraBounds()) e += smoothstep(b + w, b - w, s); return e; }
