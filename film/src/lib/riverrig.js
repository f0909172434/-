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
const SURGE = [[70, 13.0, 0.62], [74, 13.1, 0.62], [78, 13.1, 0.62], [82, 13.1, 0.62], [86, 12.6, 0.62], [92, 7.0, 0.8]];
function speed(G) {
  let v = G < 66 ? 0.76 : G < 70 ? lerp(0.76, 0.5, smoothstep(66, 70, G)) : lerp(0.5, 0.3, smoothstep(86, 94, G));
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
  n: [[44, 3.0], [47, 6.0], [50, 9.0], [56.4, 8.6], [64, 6.6], [70, 5.2], [78, 3.6], [86, 2.4], [92, 1.6]],    // metres outside the near bank
  h: [[44, 9.0], [46.5, 6.2], [49, 3.2], [52, 2.4], [56.4, 2.1], [63, 1.45], [70, 1.25], [80, 1.05], [88, 0.9], [92, 0.85]],
  psi: [[44, 22], [47, 30], [50, 44], [56.4, 47], [64, 42], [70, 36], [80, 33], [92, 30]],
  phi: [[44, -30], [46.5, -22], [49, -11], [52, -8.0], [56.4, -7.0], [64, -5.6], [70, -5.0], [80, -5.4], [92, -6.5]],
  fov: [[44, 30], [50, 25], [56.4, 24], [70, 25], [92, 27]],
};

// the source seen from above (92 -> 100): the crack lies on the ground, main stroke along -T, junction J
export const CRACK = { L: 3.2, sJ: -0.651 };   // crack unit = 3.2 world units; the river's s = 0 is the crack's lower end

export function rigUp(G, river) {
  const sc = scUp(G);
  const f = river.at(sc);
  const half = f.half;
  const nc = half + track(UP.n, G), h = track(UP.h, G);
  let psi = track(UP.psi, G), phi = track(UP.phi, G), fov = track(UP.fov, G);
  let x = f.x + f.nx * nc, y = h, z = f.z + f.nz * nc;
  // heading of the view (horizontal): psi from -T toward -N
  let a = psi * Math.PI / 180;
  let hx = -Math.cos(a) * f.tx + Math.sin(a) * f.tz, hz = -Math.cos(a) * f.tz - Math.sin(a) * f.tx;
  // 92 -> 100: rise and look down on the source; screen-up becomes -T at the source
  const k = easeInOutCubic(smoothstep(91.6, 99.0, G));
  if (k > 0) {
    const s0 = river.at(0);
    const J = { x: s0.x - s0.tx * (-CRACK.sJ) * CRACK.L, z: s0.z - s0.tz * (-CRACK.sJ) * CRACK.L };
    // frame the crack like the title: junction 50 px above centre, 338 px tall (crack unit = 338 / 804 of the frame)
    const fovT = 30, H = 0.5 * (804 / 338) * CRACK.L / Math.tan(fovT * Math.PI / 360);
    const back = (50 / 338) * CRACK.L;                     // the camera centre sits downstream of J
    const tx = J.x + s0.tx * back, tz = J.z + s0.tz * back;
    // a gentle arc: rise first, then swing over
    const kp = easeInOutSine(smoothstep(91.6, 99.4, G)), kh = smoothstep(91.4, 97.5, G);
    x = lerp(x, tx, kp); z = lerp(z, tz, kp); y = lerp(y, H, kh);
    // heading turns to look upstream along the crack, pitch goes to straight down
    const hT = Math.atan2(-s0.tz, -s0.tx), h0 = Math.atan2(hz, hx);
    let dh = hT - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    const hh = h0 + dh * k;
    hx = Math.cos(hh); hz = Math.sin(hh);
    phi = lerp(phi, -90, easeInOutCubic(smoothstep(92.5, 99.6, G)));
    fov = lerp(fov, fovT, k);
  }
  return { x, y, z, hx, hz, phi, fov, sc, nc, h };
}

// return: rush downstream from the source to the present (160 -> 172)
const RET = {
  // sc as a function of G (accelerate out of the cut, cruise, brake into the convergence)
  s: [[159, 6], [160, 9], [161.5, 22], [168.5, 104], [170.3, 116.5], [171.3, 118.4], [172.5, 119]],
  n: [[159, 2.2], [164, 3.0], [168, 3.6], [171, 4.4], [173, 4.4]],
  h: [[159, 0.9], [164, 1.1], [168, 1.4], [171, 1.7], [173, 1.7]],
  psi: [[159, 104], [166, 100], [169.5, 96], [171, 90], [173, 90]],
  phi: [[159, -3.5], [168, -4.5], [171, -6.5], [173, -6.5]],
  fov: [[159, 27], [168, 26], [171.5, 24], [173, 24]],
};
// memory: the warm river; the camera drifts downstream with the human's sentences, rises at the peak
const MEM = {
  s: [[211, 96], [245, 112.2]],
  n: [[211, 4.6], [222, 3.8], [232, 4.2], [246, 4.8]],
  h: [[211, 1.6], [222, 1.35], [228, 1.9], [235, 3.4], [246, 4.2]],
  psi: [[211, 112], [222, 106], [232, 98], [246, 94]],
  phi: [[211, -5.5], [222, -5.0], [230, -7.0], [236, -11.5], [246, -13]],
  fov: [[211, 25], [246, 26]],
};

function rigKeys(K, G, river) {
  const sc = track(K.s, G), f = river.at(sc), nc = f.half + track(K.n, G), h = track(K.h, G);
  const a = track(K.psi, G) * Math.PI / 180;
  return {
    x: f.x + f.nx * nc, y: h, z: f.z + f.nz * nc,
    hx: -Math.cos(a) * f.tx + Math.sin(a) * f.tz, hz: -Math.cos(a) * f.tz - Math.sin(a) * f.tx,
    phi: track(K.phi, G), fov: track(K.fov, G), sc, nc, h,
  };
}
export const rigReturn = (G, river) => rigKeys(RET, G, river);
export const rigMemory = (G, river) => rigKeys(MEM, G, river);
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
