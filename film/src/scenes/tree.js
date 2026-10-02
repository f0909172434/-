// #11 TREE OF LIFE (T 138–152).
// A single glowing seed ignites; luminous fibrous branches race upward, branching recursively,
// cooling from a white-hot growth front to emerald at the root and gold toward the canopy,
// until tens of thousands of glowing leaves (species) hang in the dark.
import * as THREE from '../../vendor/three.module.js';
import { Rand, fbm1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, smootherstep, easeInOutCubic, easeInOutSine } from '../lib/ease.js';

// ---------------------------------------------------------------- growth clock
// u = "growth units" (path length divided by per-level speed). The shader compares each vertex's birth u with uGrow.
const T_SEED = 0.7, T_FULL = 13.15;
export function growthAt(t, Umax) {
  const x = clamp((t - T_SEED) / (T_FULL - T_SEED), 0, 1.2);
  // slow, deliberate trunk -> explosive radiation
  return Umax * (0.55 * Math.pow(x, 2.6) + 0.45 * Math.pow(x, 1.5));
}

// ---------------------------------------------------------------- deterministic tree generator
export function buildTree(seed = 2026) {
  const rnd = new Rand(seed);
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const MAXL = 9;
  const branches = []; // {pts:[V], us:[u], rad:[r], level, parent, id}
  const leaves = [];   // {p:V, u, k}
  const queue = [];
  const speed = (lv) => lv === 0 ? 1.8 : 1.0 + 0.22 * lv;

  function perp(d) {
    const a = Math.abs(d.y) < 0.9 ? UP : V(1, 0, 0);
    return V().crossVectors(d, a).normalize();
  }

  function grow(job) {
    const { p0, dir, len, rad0, level, u0, phi, parent, pIndex } = job;
    const segL = level < 2 ? 0.22 : (level < 5 ? 0.3 : 0.4);
    const n = Math.max(3, Math.round(len / segL));
    const pts = [p0.clone()], us = [u0], rads = [rad0];
    const d = dir.clone();
    let p = p0.clone(), u = u0;
    const wob = V(rnd.range(-1, 1), rnd.range(-1, 1), rnd.range(-1, 1));
    for (let i = 1; i <= n; i++) {
      // organic bending: smooth wander + tropism up/outward (a spreading crown)
      const w = V(rnd.gauss(), rnd.gauss() * 0.5, rnd.gauss()).multiplyScalar(level === 0 ? 0.035 : 0.07);
      w.addScaledVector(wob, 0.02);
      const hor = V(p.x, 0, p.z); const hl = hor.length();
      const out = hl > 1e-3 ? hor.multiplyScalar(1 / hl) : V();
      const trop = V().addScaledVector(UP, level === 0 ? 0.05 : 0.016).addScaledVector(out, level < 1 ? 0.0 : 0.026);
      // the crown flattens out up high
      if (p.y < 4 && level > 0) trop.addScaledVector(UP, 0.03 * (4 - p.y));
      if (p.y > 19) trop.addScaledVector(UP, -0.04 * (p.y - 19) / 8).addScaledVector(out, 0.02);
      d.add(w).add(trop).normalize();
      const step = len / n;
      p = p.clone().addScaledVector(d, step);
      u += step / speed(level);
      pts.push(p); us.push(u);
      rads.push(rad0 * lerp(1, 0.62, i / n));
    }
    const id = branches.length;
    branches.push({ pts, us, rads, level, parent, id, pIndex, tipDir: d.clone() });

    // children
    const childLen = (k) => len * rnd.range(0.70, 0.86) * k;
    if (level >= MAXL || len < 0.35) {
      // leaf cluster: the species at the tips
      const tip = pts[pts.length - 1], tu = us[us.length - 1];
      const nl = 4 + Math.floor(rnd.next() * 5);
      for (let i = 0; i < nl; i++) {
        const o = V(rnd.gauss(), rnd.gauss() * 0.7, rnd.gauss()).multiplyScalar(0.28 + 0.1 * rnd.next());
        o.addScaledVector(d, 0.15 * rnd.next());
        leaves.push({ p: tip.clone().add(o), u: tu + 0.05 + rnd.next() * 0.9, k: rnd.next() });
      }
      return;
    }
    let nc = level === 0 ? 3 : (rnd.next() < (level < 3 ? 0.35 : 0.08) ? 3 : 2);
    const ax0 = perp(d);
    for (let c = 0; c < nc; c++) {
      const ph = phi + c * (Math.PI * 2 / nc) + rnd.range(-0.5, 0.5);
      const th = (level === 0 ? rnd.range(34, 48) : rnd.range(22, 42)) * Math.PI / 180;
      const ax = ax0.clone().applyAxisAngle(d, ph);
      const cd = d.clone().applyAxisAngle(ax, th).normalize();
      queue.push({ p0: pts[pts.length - 1], dir: cd, len: childLen(level === 0 ? 0.95 : 1), rad0: rads[rads.length - 1] * (level === 0 ? 0.7 : 0.8), level: level + 1,
        u0: us[us.length - 1], phi: ph + 2.39996, parent: id, pIndex: pts.length - 1 });
    }
    // lateral shoots along the branch
    const nlat = level === 0 ? 3 : (level < MAXL - 1 && rnd.next() < (level < 4 ? 0.6 : 0.35) ? 1 : 0);
    for (let k = 0; k < nlat; k++) {
      const f = level === 0 ? rnd.range(0.45, 0.85) : rnd.range(0.35, 0.75);
      const i = Math.floor(f * (pts.length - 1));
      const ph = rnd.range(0, Math.PI * 2);
      const ax = ax0.clone().applyAxisAngle(d, ph);
      const cd = d.clone().applyAxisAngle(ax, rnd.range(35, 55) * Math.PI / 180).normalize();
      queue.push({ p0: pts[i], dir: cd, len: len * rnd.range(0.5, 0.7), rad0: rads[i] * 0.6, level: level + 1, u0: us[i], phi: ph, parent: id, pIndex: i });
    }
  }
  queue.push({ p0: V(0, 0, 0), dir: V(0.03, 1, 0.02).normalize(), len: 8.0, rad0: 0.85, level: 0, u0: 0, phi: 0.3, parent: -1, pIndex: 0 });
  while (queue.length) grow(queue.shift());
  // roots: a few luminous strands creeping out over the ground from the seed
  function root(p0, dir, len, depth, u0) {
    const n = Math.max(3, Math.round(len / 0.25));
    const pts = [p0.clone()], us = [u0], rads = [0.06];
    const d = dir.clone(); let p = p0.clone(), u = u0;
    for (let i = 1; i <= n; i++) {
      d.add(V(rnd.gauss() * 0.12, 0, rnd.gauss() * 0.12)); d.y = -0.04; d.normalize();
      p = p.clone().addScaledVector(d, len / n); p.y = Math.max(p.y, -0.15);
      u += (len / n) / 0.9;
      pts.push(p); us.push(u); rads.push(0.05);
    }
    branches.push({ pts, us, rads, level: 4 + depth, parent: -1, id: branches.length, pIndex: 0, root: true });
    if (depth < 3) for (let c = 0; c < 2; c++) {
      const i = Math.floor(rnd.range(0.4, 1.0) * n);
      root(pts[i], d.clone().applyAxisAngle(UP, rnd.range(0.3, 0.8) * (c ? 1 : -1)), len * rnd.range(0.5, 0.7), depth + 1, us[i]);
    }
  }
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + rnd.range(-0.3, 0.3);
    root(V(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3), V(Math.cos(a), -0.05, Math.sin(a)).normalize(), rnd.range(2.5, 4.5), 0, 0.1);
  }
  let Umax = 0; for (const l of leaves) Umax = Math.max(Umax, l.u);
  return { branches, leaves, Umax };
}

// ---------------------------------------------------------------- shared GLSL
const PAL = /* glsl */`
uniform float uGrow, uUmax, uTime, uScale, uFocal, uSurge;
// emerald root -> teal -> jade -> gold crown
vec3 basePal(float h){
  vec3 c0 = vec3(0.008, 0.30, 0.12);
  vec3 c1 = vec3(0.015, 0.42, 0.30);
  vec3 c2 = vec3(0.22, 0.62, 0.26);
  vec3 c3 = vec3(1.10, 0.66, 0.18);
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.22, h));
  c = mix(c, c2, smoothstep(0.2, 0.5, h));
  c = mix(c, c3, smoothstep(0.45, 0.85, h));
  return c;
}
vec3 hotPal(float heat){
  // white-hot head cooling through gold
  return mix(vec3(1.6, 0.85, 0.30), vec3(3.2, 2.9, 2.4), smoothstep(0.35, 1.0, heat));
}
`;

export default class Tree {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, ctx.aspect, 0.05, 600);
  }

  async init() {
    const ctx = this.ctx;
    const T = buildTree(2026);
    this.T = T;
    const H = 30; // height normaliser for colour
    this.U = {
      uGrow: { value: 0 }, uUmax: { value: T.Umax }, uTime: { value: 0 }, uScale: { value: ctx.height / 804 },
      uFocal: { value: 1 }, uSurge: { value: 0 }, uSeed: { value: 0 }, uFocus: { value: 10 }, uCoc: { value: 0 },
    };
    const U = this.U;
    const rnd = new Rand(77);

    // ---- A. luminous fibres (LineSegments with per-vertex birth)
    {
      const pos = [], birth = [], info = [], offs = [];
      const NF = [28, 12, 6, 3];
      for (const b of T.branches) {
        const nf = b.level < 4 ? NF[b.level] : 1;
        const n = b.pts.length;
        // parallel-transported frame
        const tang = [], nor = [];
        for (let i = 0; i < n; i++) {
          const a = b.pts[Math.max(0, i - 1)], c = b.pts[Math.min(n - 1, i + 1)];
          tang.push(c.clone().sub(a).normalize());
        }
        let nv = new THREE.Vector3(1, 0, 0); nv.sub(tang[0].clone().multiplyScalar(nv.dot(tang[0]))); if (nv.lengthSq() < 1e-4) nv.set(0, 0, 1); nv.normalize();
        for (let i = 0; i < n; i++) { nv.sub(tang[i].clone().multiplyScalar(nv.dot(tang[i]))).normalize(); nor.push(nv.clone()); }
        for (let f = 0; f < nf; f++) {
          const a0 = (f / nf) * Math.PI * 2 + rnd.range(-0.3, 0.3);
          const rr = nf === 1 ? 0 : 0.25 + 0.75 * Math.sqrt(rnd.next());
          const tw = rnd.range(0.6, 1.4) * (rnd.next() < 0.5 ? -1 : 1);
          const r4 = rnd.next();
          let prev = null;
          let s = 0;
          for (let i = 0; i < n; i++) {
            if (i > 0) s += b.pts[i].distanceTo(b.pts[i - 1]);
            const ang = a0 + s * tw * 0.35;
            const bn = new THREE.Vector3().crossVectors(tang[i], nor[i]);
            const flare = b.level === 0 ? 1 + 0.6 * Math.exp(-s / 0.4) : 1;
            const off = nor[i].clone().multiplyScalar(Math.cos(ang)).addScaledVector(bn, Math.sin(ang)).multiplyScalar(b.rads[i] * rr * flare);
            // fibres flare apart a little where a branch leaves its parent
            const p = b.pts[i].clone().add(off);
            const cur = [p.x, p.y, p.z, off.x, off.y, off.z, b.us[i] + rr * (b.level === 0 ? 0.3 : (b.level < 4 ? 0.25 : 0.0)), b.level / 9, p.y / H, r4, b.root ? -1 : rr];
            if (prev) { for (const v of [prev, cur]) { pos.push(v[0] - v[3], v[1] - v[4], v[2] - v[5]); offs.push(v[3], v[4], v[5]); birth.push(v[6]); info.push(v[7], v[8], v[9], v[10]); } }
            prev = cur;
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aBirth', new THREE.Float32BufferAttribute(birth, 1));
      g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
      g.setAttribute('aOff', new THREE.Float32BufferAttribute(offs, 3));
      const m = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        vertexShader: PAL + /* glsl */`
        attribute float aBirth; attribute vec4 aInfo; attribute vec3 aOff;
        varying float vAge; varying vec3 vBase; varying float vLv; varying float vB; varying float vHeatK;
        void main(){
          vAge = uGrow - aBirth; vB = aBirth; vHeatK = aInfo.w < 0.0 ? 0.25 : 1.0;
          vBase = basePal(aInfo.y);
          vLv = aInfo.x;
          // fibres gather into a spearhead at the growth front and relax into the bundle behind it
          vec3 pp = position + aOff * mix(0.12, 1.0, smoothstep(0.0, 1.4, vAge));
          vec4 mv = modelViewMatrix * vec4(pp, 1.0);
          gl_Position = projectionMatrix * mv;
          // thinner, dimmer twigs; thick limbs get many fibres instead
          float z = -mv.z;
          vBase *= 0.42 * mix(1.3, 0.55, aInfo.x) * (0.75 + 0.5 * aInfo.z) * clamp(9.0 / z, 0.55, 1.6);
        }`,
        fragmentShader: /* glsl */`
        uniform float uGrow, uTime;
        varying float vAge; varying vec3 vBase; varying float vLv; varying float vB; varying float vHeatK;
        void main(){
          if (vAge < 0.0) discard;
          float heat = exp(-vAge / mix(0.55, 0.30, vLv));
          // sap pulses running up the limbs
          float pulse = pow(0.5 + 0.5 * sin(vB * 5.0 - uTime * 7.0), 10.0) * smoothstep(0.0, 1.5, vAge);
          vec3 hot = mix(vec3(1.6, 0.85, 0.30), vec3(3.4, 3.0, 2.5), smoothstep(0.4, 1.0, heat));
          vec3 c = vBase * (1.0 + 0.9 * pulse) + hot * heat * mix(0.7, 1.4, step(0.4, vLv)) * vHeatK;
          gl_FragColor = vec4(c, 1.0);
        }` });
      const L = new THREE.LineSegments(g, m); L.frustumCulled = false; L.renderOrder = 10;
      this.scene.add(L);
    }

    // ---- A2. translucent luminous tubes for the great limbs (gives the trunk body; fibres ride on top)
    {
      const pos = [], nrm = [], at = [], idx = [];
      const RS = 14;
      for (const br of T.branches) {
        if (br.level > 2 || br.root) continue;
        const n = br.pts.length; const base = pos.length / 3;
        let nv = new THREE.Vector3(1, 0, 0);
        let s = 0;
        for (let i = 0; i < n; i++) {
          const a = br.pts[Math.max(0, i - 1)], c = br.pts[Math.min(n - 1, i + 1)];
          const tg = c.clone().sub(a).normalize();
          nv.sub(tg.clone().multiplyScalar(nv.dot(tg))); if (nv.lengthSq() < 1e-6) nv.set(0, 0, 1); nv.normalize();
          const bn = new THREE.Vector3().crossVectors(tg, nv);
          if (i > 0) s += br.pts[i].distanceTo(br.pts[i - 1]);
          const flare = br.level === 0 ? 1 + 0.5 * Math.exp(-s / 0.35) : 1;
          const r = br.rads[i] * 0.78 * flare;
          for (let k = 0; k < RS; k++) {
            const ang = k / RS * Math.PI * 2;
            const dir = nv.clone().multiplyScalar(Math.cos(ang)).addScaledVector(bn, Math.sin(ang));
            const p = br.pts[i].clone().addScaledVector(dir, r);
            pos.push(p.x, p.y, p.z); nrm.push(dir.x, dir.y, dir.z);
            at.push(br.us[i], p.y / H, s, k / RS);
          }
        }
        for (let i = 0; i < n - 1; i++) for (let k = 0; k < RS; k++) {
          const a = base + i * RS + k, b = base + i * RS + (k + 1) % RS, c = a + RS, d = b + RS;
          idx.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 4));
      g.setIndex(idx);
      const m = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
        vertexShader: PAL + /* glsl */`
        attribute vec4 aT; varying vec3 vN, vV; varying vec4 vT;
        void main(){
          vT = aT;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
        fragmentShader: PAL + /* glsl */`
        varying vec3 vN, vV; varying vec4 vT;
        void main(){
          float age = uGrow - vT.x;
          if (age < 0.0) discard;
          float nv = abs(dot(normalize(vN), normalize(vV)));
          float rim = pow(1.0 - nv, 2.5);
          // living striations running along the limb
          float str = 0.6 + 0.4 * sin(vT.w * 6.2832 * 7.0 + vT.z * 1.3 + sin(vT.z * 0.7 + vT.w * 20.0));
          float flow = pow(0.5 + 0.5 * sin(vT.z * 2.2 - uTime * 3.0 + vT.w * 6.2832), 6.0);
          vec3 c = basePal(vT.y) * (0.04 + 0.38 * rim) * (str + 0.6 * flow);
          c *= smoothstep(0.4, 2.2, age);
          gl_FragColor = vec4(c, 1.0);
        }` });
      const M = new THREE.Mesh(g, m); M.frustumCulled = false; M.renderOrder = 8;
      this.scene.add(M);
    }

    // ---- B. glow sprites along the limbs (volume / thickness) + growth heads
    {
      const pos = [], at = [];
      for (const b of T.branches) {
        if (b.level > 6) continue;
        const stepI = b.level < 2 ? 1 : 2;
        for (let i = 0; i < b.pts.length; i += stepI) {
          const p = b.pts[i];
          pos.push(p.x, p.y, p.z); at.push(b.us[i], b.rads[i], p.y / H, b.level / 9);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aG', new THREE.Float32BufferAttribute(at, 4));
      const m = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        vertexShader: PAL + /* glsl */`
        attribute vec4 aG; varying vec3 vC; varying float vA;
        void main(){
          float age = uGrow - aG.x;
          vec4 mv = modelViewMatrix * vec4(position, 1.0); float z = -mv.z;
          gl_Position = projectionMatrix * mv;
          float heat = exp(-max(age, 0.0) / 0.4);
          float head = exp(-max(age, 0.0) / 0.10);
          float px = aG.y * 2.6 * uFocal / z;
          float cap = aG.w < 0.12 ? 110.0 : 30.0;
          float vol = clamp(px, 2.0 * uScale, cap * uScale);
          float hs = clamp(px * 0.35, 3.0 * uScale, 14.0 * uScale) * (1.0 + head);
          gl_PointSize = mix(vol, hs, smoothstep(0.15, 0.5, head));
          vC = mix(basePal(aG.z) * (aG.w < 0.12 ? 0.04 : 0.06) + hotPal(heat) * heat * 0.06, vec3(2.4, 2.0, 1.5) * head * 0.9, smoothstep(0.15, 0.5, head));
          vA = step(0.0, age);
        }`,
        fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main(){ if (vA < 0.5) discard; vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0) discard;
          gl_FragColor = vec4(vC * exp(-r * 3.5), 1.0); }` });
      const P = new THREE.Points(g, m); P.frustumCulled = false; P.renderOrder = 5;
      this.scene.add(P);
    }

    // ---- C. leaves: the species
    {
      const N = T.leaves.length;
      const pos = new Float32Array(N * 3), at = new Float32Array(N * 4);
      T.leaves.forEach((l, i) => { pos[i * 3] = l.p.x; pos[i * 3 + 1] = l.p.y; pos[i * 3 + 2] = l.p.z; at[i * 4] = l.u; at[i * 4 + 1] = l.k; at[i * 4 + 2] = l.p.y / H; at[i * 4 + 3] = rnd.next(); });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aL', new THREE.BufferAttribute(at, 4));
      const m = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        vertexShader: PAL + /* glsl */`
        attribute vec4 aL; varying vec3 vC; varying float vA;
        void main(){
          float age = uGrow - aL.x;
          vec3 p = position + vec3(sin(uTime * 0.9 + aL.w * 40.0), cos(uTime * 0.7 + aL.w * 23.0), sin(uTime * 0.8 + aL.w * 17.0)) * 0.04;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); float z = -mv.z;
          gl_Position = projectionMatrix * mv;
          float pop = exp(-max(age, 0.0) * 2.2);
          float sz = (1.3 + 2.2 * aL.y * aL.y) * uScale * clamp(14.0 / z, 0.6, 2.2);
          gl_PointSize = sz * (1.0 + 1.0 * pop);
          // mostly warm gold/white, a scatter of pale cyan and coral species
          vec3 gold = mix(vec3(1.25, 0.78, 0.30), vec3(1.6, 1.35, 0.9), aL.y);
          vec3 c = gold;
          if (aL.w < 0.14) c = vec3(0.45, 1.25, 1.25);
          else if (aL.w > 0.93) c = vec3(1.5, 0.55, 0.45);
          float tw = 0.75 + 0.25 * sin(uTime * (2.0 + 3.0 * aL.y) + aL.w * 60.0);
          vC = c * tw * (0.9 + 0.5 * aL.z) * 0.75 * (1.0 + 0.45 * uSurge) + vec3(3.0, 2.7, 2.2) * pop * 0.8;
          vA = smoothstep(0.0, 0.08, age);
        }`,
        fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main(){ if (vA <= 0.0) discard; vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0) discard;
          gl_FragColor = vec4(vC * vA * exp(-r * 3.0), 1.0); }` });
      const P = new THREE.Points(g, m); P.frustumCulled = false; P.renderOrder = 20;
      this.scene.add(P);
    }

    // ---- D. dust motes drifting in the dark, catching the tree's light
    {
      const N = 14000; const r2 = new Rand(5);
      const pos = new Float32Array(N * 3), sd = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = r2.range(-60, 60); pos[i * 3 + 1] = r2.range(-4, 52); pos[i * 3 + 2] = r2.range(-60, 50); sd[i] = r2.next();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aS', new THREE.BufferAttribute(sd, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        vertexShader: PAL + /* glsl */`
        attribute float aS; uniform float uFocus, uCoc; varying vec3 vC; varying float vA, vSoft;
        void main(){
          vec3 p = position + vec3(sin(uTime * 0.11 + aS * 30.0) * 0.6, uTime * (0.05 + 0.1 * aS), cos(uTime * 0.13 + aS * 20.0) * 0.6);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); float z = -mv.z;
          gl_Position = projectionMatrix * mv;
          float base = (0.9 + 1.2 * aS) * uScale;
          float coc = abs(1.0 / max(z, 0.1) - 1.0 / uFocus) * uCoc * uScale;
          float sz = max(base, coc); gl_PointSize = min(sz, 40.0 * uScale);
          vSoft = clamp(coc / base / 4.0, 0.0, 1.0);
          float grown = clamp(uGrow / uUmax, 0.0, 1.0);
          float nearTree = exp(-length(p.xz) / 18.0) * smoothstep(-4.0, 6.0, p.y);
          float nearCrown = exp(-length(p - vec3(0.0, 24.0, 0.0)) / 20.0);
          vec3 c = mix(vec3(0.15, 0.5, 0.42), vec3(1.0, 0.72, 0.38), smoothstep(8.0, 26.0, p.y));
          vC = c * (0.04 + 0.35 * nearTree * (0.2 + grown) + 0.6 * nearCrown * grown * grown);
          vA = (base * base) / (sz * sz) * smoothstep(0.5, 3.0, z);
        }`,
        fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA, vSoft;
        void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
          float a = mix(exp(-r * r * 3.0), smoothstep(1.0, 0.8, r) * 0.8, vSoft);
          gl_FragColor = vec4(vC * vA * a, 1.0); }` });
      const P = new THREE.Points(g, m); P.frustumCulled = false; P.renderOrder = 1;
      this.scene.add(P);
    }

    // ---- E. the seed + ground mist lit by the root
    {
      const m = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`varying vec2 vP; void main(){ vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */`
        uniform float uSeed, uTime, uGrow, uUmax; varying vec2 vP;
        float h12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h12(i), h12(i+vec2(1,0)), f.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), f.x), f.y); }
        void main(){
          float r = length(vP);
          float mist = 0.55 * vn(vP * 0.25 + vec2(uTime * 0.05, 0.0)) + 0.45 * vn(vP * 0.6 - vec2(0.0, uTime * 0.04));
          float grown = clamp(uGrow / uUmax, 0.0, 1.0);
          float pool = exp(-r * 0.35) * (0.6 * uSeed + 0.5) + exp(-r * 0.06) * 0.25 * grown;
          vec3 c = vec3(0.03, 0.30, 0.22) * pool * (0.4 + 0.9 * mist) * 0.5;
          gl_FragColor = vec4(c * (1.0 - smoothstep(30.0, 60.0, r)), 1.0);
        }` });
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), m);
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.renderOrder = 0; ground.frustumCulled = false;
      void ground;
      // seed sprite
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.02, 0], 3));
      const sm = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`uniform float uSeed, uScale, uFocal; varying float vI;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(0.9 * uFocal / -mv.z, 10.0 * uScale, 160.0 * uScale); vI = uSeed; }`,
        fragmentShader: /* glsl */`varying float vI; void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
          float core = exp(-r * r * 60.0) * 4.0 + exp(-r * r * 10.0) * 0.7 + exp(-r * 4.0) * 0.15;
          gl_FragColor = vec4(mix(vec3(0.5, 1.6, 1.2), vec3(1.0, 1.0, 0.9), exp(-r * r * 50.0)) * core * vI * (1.0 - smoothstep(0.7, 1.0, r)), 1.0); }` });
      const seed = new THREE.Points(sg, sm); seed.frustumCulled = false; seed.renderOrder = 30;
      this.scene.add(seed);
    }

    // ---- G. faint atmosphere behind the tree: its own light scattered in the dark air
    {
      const m = new THREE.ShaderMaterial({
        uniforms: { ...U, uC: { value: new THREE.Vector2() }, uR: { value: 1 }, uAsp: { value: ctx.aspect } },
        depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`varying vec2 vN; void main(){ vN = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */`
        uniform vec2 uC; uniform float uR, uAsp, uGrow, uUmax, uSurge; varying vec2 vN;
        void main(){
          vec2 d = (vN - uC) * vec2(uAsp, 1.0) / uR;
          float g = clamp(uGrow / uUmax, 0.0, 1.0);
          float r2 = dot(d, d);
          vec3 c = vec3(0.022, 0.020, 0.012) * exp(-r2 * 0.6) + vec3(0.006, 0.018, 0.016) * exp(-r2 * 0.25);
          gl_FragColor = vec4(c * 0.6 * g * g * (1.0 + 0.5 * uSurge), 1.0);
        }` });
      this.haze = m;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); q.frustumCulled = false; q.renderOrder = -1;
      this.scene.add(q);
    }

    // ---- F. spores: gold motes drifting up out of the crown once it has bloomed
    {
      const N = 5000; const r3 = new Rand(19);
      const pos = new Float32Array(N * 3), at = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const l = T.leaves[Math.floor(r3.next() * T.leaves.length)];
        pos[i * 3] = l.p.x + r3.gauss() * 0.8; pos[i * 3 + 1] = l.p.y + r3.gauss() * 0.5; pos[i * 3 + 2] = l.p.z + r3.gauss() * 0.8;
        at[i * 3] = l.u + 0.3 + r3.next() * 2.0; at[i * 3 + 1] = r3.next(); at[i * 3 + 2] = r3.next();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSp', new THREE.BufferAttribute(at, 3));
      const m = new THREE.ShaderMaterial({
        uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        vertexShader: PAL + /* glsl */`
        attribute vec3 aSp; varying vec3 vC;
        void main(){
          float age = uGrow - aSp.x;
          float tt = max(age, 0.0) * 0.6 + uTime * 0.05;
          vec3 p = position + vec3(sin(tt * 1.3 + aSp.y * 20.0) * 0.6, tt * (0.6 + aSp.z), cos(tt * 1.1 + aSp.z * 20.0) * 0.6);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); float z = -mv.z;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.2 + 1.8 * aSp.z) * uScale * clamp(20.0 / z, 0.6, 1.6);
          vC = mix(vec3(1.2, 0.75, 0.3), vec3(0.4, 1.1, 0.9), step(0.8, aSp.y)) * 0.55 * smoothstep(0.0, 0.5, age) * (0.6 + 0.4 * sin(uTime * 3.0 + aSp.y * 50.0));
        }`,
        fragmentShader: /* glsl */`
        varying vec3 vC;
        void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0 || vC.r <= 0.0) discard; gl_FragColor = vec4(vC * exp(-r * 3.0), 1.0); }` });
      const P = new THREE.Points(g, m); P.frustumCulled = false; P.renderOrder = 25;
      this.scene.add(P);
    }

    // ---- target lineage: the climb of one particular tip
    {
      let best = null, bs = -1e9;
      for (const b of T.branches) {
        if (b.level < 7) continue;
        const tip = b.pts[b.pts.length - 1];
        // high in the crown, near the axis, on the camera side
        const sc = tip.y - 0.9 * Math.hypot(tip.x - 2, tip.z - 6);
        if (sc > bs) { bs = sc; best = b; }
      }
      const chain = [];
      let b = best, endIdx = best.pts.length - 1;
      while (b) { chain.push({ b, end: endIdx }); endIdx = b.pIndex; b = b.parent >= 0 ? T.branches[b.parent] : null; }
      chain.reverse();
      const P = [], Uu = [];
      for (const { b, end } of chain) for (let i = 0; i <= end; i++) { P.push(b.pts[i]); Uu.push(b.us[i]); }
      this.lineage = { P, U: Uu };
    }
  }

  lineageAt(u) {
    const { P, U } = this.lineage;
    if (u <= U[0]) return P[0].clone();
    for (let i = 1; i < U.length; i++) if (U[i] >= u) {
      const k = (u - U[i - 1]) / Math.max(1e-6, U[i] - U[i - 1]);
      return P[i - 1].clone().lerp(P[i], k);
    }
    return P[P.length - 1].clone();
  }

  camKeys() {
    // [t, pos, look]
    return [
      [-1.0, [0.0, 0.35, 6.2], [-0.6, -0.57, 0]],
      [0.0, [0.0, 0.35, 6.2], [-0.6, -0.57, 0]],
      [1.2, [0.1, 0.45, 6.4], [-0.3, 0.1, 0]],
      [2.5, [0.4, 1.0, 7.0], [0, 1.8, 0]],
      [5.0, [1.5, 2.8, 10.5], [0, 5.0, 0]],
      [7.5, [3.0, 4.5, 17.0], [0, 9.5, 0]],
      [10.0, [4.0, 4.5, 32.0], [0, 14.5, 0]],
      [12.5, [3.4, 3.0, 44.0], [0, 16.5, 0]],
      [15.0, [3.0, 2.6, 47.0], [0, 17.0, 0]],
    ];
  }

  camAt(t) {
    const K = this.camKeys();
    let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const k0 = K[Math.max(0, i - 1)], k1 = K[i], k2 = K[i + 1], k3 = K[Math.min(K.length - 1, i + 2)];
    const u = clamp((t - k1[0]) / (k2[0] - k1[0]));
    const cr = (a, b, c, d) => { // catmull-rom
      const u2 = u * u, u3 = u2 * u;
      return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
    };
    const pos = new THREE.Vector3(...[0, 1, 2].map(j => cr(k0[1][j], k1[1][j], k2[1][j], k3[1][j])));
    const look = new THREE.Vector3(...[0, 1, 2].map(j => cr(k0[2][j], k1[2][j], k2[2][j], k3[2][j])));
    return { pos, look };
  }

  update(shot, t, T) {
    const U = this.U;
    const ug = growthAt(t, this.T.Umax);
    U.uGrow.value = ug; U.uTime.value = t;
    // seed: a breath of light before the first growth, then it stays as the root's ember
    U.uSeed.value = smoothstep(-0.6, 0.5, t) * (1 + 0.6 * Math.exp(-Math.pow((t - T_SEED) / 0.25, 2))) * lerp(1, 0.45, smoothstep(2, 6, t));

    const cam = this.camera;
    const { pos, look } = this.camAt(t);
    const tip = this.lineageAt(ug);
    // follow the growth front with the lineage tip (lagged), settle on the crown at the end
    const fw = 0.6 * smoothstep(1.0, 3.0, t) * (1 - smoothstep(9.0, 12.5, t));
    look.lerp(tip, fw);
    pos.x += fbm1(t * 0.3 + 4) * 0.15; pos.y += fbm1(t * 0.3 + 8) * 0.1;
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    cam.fov = lerp(40, 46, smoothstep(3, 11, t));
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    U.uFocal.value = this.ctx.height / (2 * Math.tan(cam.fov * Math.PI / 360));
    U.uFocus.value = pos.distanceTo(look); U.uCoc.value = 30;

    // haze centred on the projected crown
    const hc = new THREE.Vector3(0, 17, 0).project(cam);
    this.haze.uniforms.uC.value.set(hc.x, hc.y);
    this.haze.uniforms.uR.value = Math.max(0.3, 2 * 16 / (cam.position.distanceTo(new THREE.Vector3(0, 17, 0)) * Math.tan(cam.fov * Math.PI / 360) * 2));
    const grown = clamp(ug / this.T.Umax);
    const surge = smoothstep(11.6, 13.7, t); U.uSurge.value = surge;
    const post = {
      exposure: 1.0 + 0.12 * surge,
      bloomStrength: lerp(0.8, 0.65, grown) + 0.15 * surge, bloomThreshold: 1.0, bloomKnee: 0.6, bloomRadius: 0.9,
      streak: 0.22, streakTint: [1.0, 0.78, 0.45],
      ca: 0.0004, vignette: 0.45, grain: 0.045,
      saturation: 1.12, contrast: 1.08, tint: [1.0, 1.0, 0.97], lift: [0.0, 0.004, 0.004],
    };
    return { scene: this.scene, camera: cam, target: t > 0.3 ? tip : new THREE.Vector3(0, 0.02, 0), post };
  }

  dispose() { this.scene.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
}
