// Deterministic 3D value noise for init-time JS work (particle placement etc.). Pure functions.
function h3(x, y, z) { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); }
export function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => h3(ix + i, iy + j, iz + k);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), ux), l(c(0, 1, 0), c(1, 1, 0), ux), uy),
    l(l(c(0, 0, 1), c(1, 0, 1), ux), l(c(0, 1, 1), c(1, 1, 1), ux), uy), uz) * 2 - 1;
}
export function fbm3(x, y, z, oct = 4) { let s = 0, a = 0.5; for (let i = 0; i < oct; i++) { s += a * vnoise3(x, y, z); x = x * 2.03 + 5.1; y = y * 2.03 + 1.7; z = z * 2.03 + 9.3; a *= 0.5; } return s; }
export function ridge3(x, y, z, oct = 4) { let s = 0, a = 0.5; for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(vnoise3(x, y, z))); x = x * 2.07 + 3.3; y = y * 2.07 + 8.1; z = z * 2.07 + 2.9; a *= 0.5; } return s; }
