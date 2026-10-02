// The crack 卜: one deterministic geometry shared by the whole film. It bursts on the plastron in the bone
// scene (105.5 s), its two strokes straighten into the yin and yang lines at the start of the lineage scene
// (130 s), and it draws the title (overlay, 246.5 s).
//
//   import { crackGeometry, crackFront, toPx } from '../lib/crack.js';
//   const C = crackGeometry();          // { J: [0, 0], lines: [...] } in a unit frame
//   for (const P of C.lines) { const s = crackFront(P, t); ... draw P.pts up to arc length s ... }
//
// Unit frame: y up, the junction J (where the heat touched the hollow) at the origin. The main crack runs from
// the top (-0.024, 0.349) through J to the bottom (0.018, -0.651), so it is 1 unit tall; the branch leaves J to
// the right and slightly down to (0.391, -0.225), like the second stroke of 卜. Fine twigs split off both.
//
// Each polyline P: { kind: 'up' | 'down' | 'branch' | 'twig', pts: [[x, y], ...], cum: [arc length], L,
//                    t0 (s after the snap when it starts), tau (growth time constant), w0, w1 (relative width at
//                    its start and tip), glow (relative brightness), parent (index or -1), at (arc length on the parent) }
// Growth: front(t) = L (1 - e^(-(t - t0)/tau)) / (1 - e^-5), complete at t0 + 5 tau; the whole crack exists
// within ~0.45 s of the snap. Widths are relative: the overlay draws w = 2.7 px for 1.0 at a 338 px tall crack.
import { hash1 } from './random.js';

const K = 1 - Math.exp(-5);

function jag(x0, y0, x1, y1, seed, rough, levels) {
  let pts = [[x0, y0], [x1, y1]];
  for (let l = 0; l < levels; l++) {
    const nx = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
      const off = (hash1(seed + l * 101.3 + i * 7.77) - 0.5) * 2 * rough * L;
      const t = 0.5 + (hash1(seed + l * 13.1 + i * 3.3) - 0.5) * 0.35;
      nx.push([ax + dx * t - dy / L * off, ay + dy * t + dx / L * off], [bx, by]);
    }
    pts = nx;
  }
  return pts;
}

function line(kind, pts, t0, tau, w0, w1, glow, parent = -1, at = 0) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { kind, pts, cum, L: cum[cum.length - 1], t0, tau, w0, w1, glow, parent, at };
}

// arc length revealed t seconds after the snap
export function crackFront(P, t) {
  const tt = t - P.t0;
  if (tt <= 0) return 0;
  return P.L * Math.min(1, (1 - Math.exp(-tt / P.tau)) / K);
}

// time (after the snap) when the front reaches arc length s
export function crackReach(P, s) {
  return P.t0 - P.tau * Math.log(Math.max(1e-4, 1 - (s / P.L) * K));
}

// point and direction at arc length s
export function crackAt(P, s) {
  let i = 1;
  while (i < P.cum.length - 1 && P.cum[i] < s) i++;
  const A = P.pts[i - 1], B = P.pts[i], u = Math.min(1, Math.max(0, (s - P.cum[i - 1]) / Math.max(P.cum[i] - P.cum[i - 1], 1e-9)));
  return { x: A[0] + (B[0] - A[0]) * u, y: A[1] + (B[1] - A[1]) * u, dir: Math.atan2(B[1] - A[1], B[0] - A[0]) };
}

// relative width at arc length s
export function crackWidth(P, s) { return P.w0 + (P.w1 - P.w0) * Math.pow(Math.min(1, s / P.L), 0.7); }

const cache = new Map();
export function crackGeometry({ seed = 0, twigs = true } = {}) {
  const key = `${seed}|${twigs}`;
  if (cache.has(key)) return cache.get(key);
  const S = 1 / 338, sd = seed * 1000;
  const lines = [];
  lines.push(line('up', jag(0, 0, -8 * S, 118 * S, 11.3 + sd, 0.10, 6), 0, 0.07, 1.0, 0.2, 1));
  lines.push(line('down', jag(0, 0, 6 * S, -220 * S, 23.9 + sd, 0.09, 7), 0, 0.08, 1.0, 0.19, 1));
  lines.push(line('branch', jag(0, 0, 132 * S, -76 * S, 37.1 + sd, 0.12, 6), 0.06, 0.07, 0.85, 0.19, 0.9));
  if (twigs) {
    const grow = (pi, sseed, n, maxLen, depth) => {
      const P = lines[pi];
      for (let k = 0; k < n; k++) {
        const s = P.L * (0.1 + 0.82 * hash1(sseed + k * 3.71));
        const { x, y, dir } = crackAt(P, s);
        const side = hash1(sseed + k * 9.13) < 0.5 ? -1 : 1;
        const ang = dir + side * (0.4 + 0.65 * hash1(sseed + k * 5.37));
        const len = maxLen * (0.3 + 0.7 * hash1(sseed + k * 2.93)) * (1 - 0.55 * s / P.L);
        const T0 = crackReach(P, s) + 0.015 + 0.06 * hash1(sseed + k * 1.1);
        lines.push(line('twig', jag(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, sseed + k * 17.7, 0.2, 3), T0, 0.05,
          Math.max(0.17, P.w0 * (0.5 - 0.3 * s / P.L)), 0.09, 0.45, pi, s));
        if (depth > 0 && hash1(sseed + k * 4.4) < 0.45) grow(lines.length - 1, sseed + k * 31.3, 1, len * 0.45, depth - 1);
      }
    };
    grow(0, 101 + sd, 7, 34 * S, 1); grow(1, 202 + sd, 10, 40 * S, 1); grow(2, 303 + sd, 6, 26 * S, 1);
  }
  const C = { J: [0, 0], lines };
  cache.set(key, C);
  return C;
}
