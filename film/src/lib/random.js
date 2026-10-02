// Deterministic PRNG utilities. Every random number in the film comes from here,
// so any frame can be rendered independently and identically on any worker.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rand {
  constructor(seed = 1) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  sign() { return this.r() < 0.5 ? -1 : 1; }
  gauss() { // Box–Muller
    let u = 0, v = 0;
    while (u === 0) u = this.r();
    while (v === 0) v = this.r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  onSphere(out = [0, 0, 0]) {
    const z = this.range(-1, 1), a = this.range(0, Math.PI * 2), r = Math.sqrt(1 - z * z);
    out[0] = r * Math.cos(a); out[1] = r * Math.sin(a); out[2] = z; return out;
  }
  inSphere(out = [0, 0, 0]) {
    this.onSphere(out); const k = Math.cbrt(this.r());
    out[0] *= k; out[1] *= k; out[2] *= k; return out;
  }
}

// Stateless hash noise for JS-side animation (camera drift etc.), pure function of inputs.
export function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
export function vnoise1(x) { // smooth 1D value noise in [-1,1]
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (hash1(i) * (1 - u) + hash1(i + 1) * u) * 2 - 1;
}
export function fbm1(x, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise1(x * f + i * 17.3); f *= 2; a *= 0.5; } return s; }
