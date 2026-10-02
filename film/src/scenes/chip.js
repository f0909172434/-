// TEMP benchmark
import * as THREE from '../../vendor/three.module.js';
import { GlowLines } from '../look/lines.js';
import { FLines } from '../lib/flines.js';
import { SoftPoints } from '../look/points.js';
import { contourMaterial } from '../look/materials.js';
import { PAL } from '../look/palette.js';
import { Rand } from '../lib/random.js';

export default class Bench {
  constructor(ctx) { this.ctx = ctx; }
  init() {
    const { width, height } = this.ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 10); this.camera.lookAt(0, 0, 0);
    const mk = (n, len, w, F = false) => {
      const r = new Rand(3);
      const gl = F ? new FLines({ resolution: [width, height] }) : new GlowLines({ resolution: [width, height] });
      const pl = [];
      for (let i = 0; i < n; i++) {
        const x = r.range(-2.6, 2.6), y = r.range(-1.3, 1.3), a = r.range(0, 6.28);
        pl.push({ points: [x, y, 0, x + Math.cos(a) * len, y + Math.sin(a) * len, 0], color: PAL.line, intensity: 0.3, width: w });
      }
      gl.setPolylines(pl); return gl;
    };
    // world height visible at z=0: 2*10*tan(15deg)=5.36 -> 804px; 1 unit = 150 px
    this.cfg = {
      20: [mk(10000, 0.66, 1.2)],          // 10k x 100px
      21: [mk(50000, 0.2, 1.2)],           // 50k x 30px
      22: [mk(2000, 13, 1.2)],             // 2k x 2000px
      23: [mk(100000, 0.1, 1.0)],          // 100k x 15 px
    };
    const r = new Rand(5); const N = 15000;
    const sp = new SoftPoints({ count: N, resolution: [width, height], focus: 10, aperture: 0.6, maxSize: 60 });
    for (let i = 0; i < N; i++) { sp.positions.set([r.range(-6, 6), r.range(-3, 3), r.range(-10, 8)], i * 3); sp.colors.set([0.5, 0.5, 0.5], i * 3); sp.sizes[i] = 2; }
    sp.update();
    this.cfg[24] = [sp];
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(12, 6, 1, 1), contourMaterial({ color: PAL.line, spacing: 0.05, mode: 'both', dir: [1, 0, 0], dir2: [0, 1, 0], resolution: [width, height] }));
    this.cfg[25] = [{ mesh: plane }];
    this.cfg[26] = [];
    this.cfg[27] = [mk(10000, 0.66, 1.2, true)];
    this.cfg[28] = [mk(50000, 0.2, 1.2, true)];
    this.cfg[29] = [mk(100000, 0.1, 1.0, true)];
    this.cfg[30] = [mk(2000, 13, 1.2, true)];
    this.groups = {};
    for (const k of Object.keys(this.cfg)) { const g = new THREE.Group(); for (const o of this.cfg[k]) g.add(o.mesh); this.groups[k] = g; }
  }
  update(shot, t, T) {
    this.camera.aspect = shot._aspect; this.camera.updateProjectionMatrix();
    const k = Math.floor(T + 0.001);
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
    if (this.groups[k]) this.scene.add(this.groups[k]);
    return { scene: this.scene, camera: this.camera };
  }
}
