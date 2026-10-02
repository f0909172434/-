// Placeholder used until the real scene exists: a contour sphere + glow-line rings, with C and Si targets.
// Lets the whole timeline (engine, overlay, split, rewind) run end-to-end.
import * as THREE from '../../vendor/three.module.js';
import { GlowLines } from '../look/lines.js';
import { contourMaterial } from '../look/materials.js';
import { PAL } from '../look/palette.js';
import { sphereLines } from '../look/geom.js';

export function makeStub(name) {
  return class Stub {
    constructor(ctx) { this.ctx = ctx; }
    init() {
      const { width, height } = this.ctx;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
      this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1.2, 96, 64), contourMaterial({ color: PAL.line, intensity: 0.9, spacing: 0.06, mode: 'plane', dir: [0, 1, 0], rim: 0.8, resolution: [width, height] }));
      this.scene.add(this.sphere);
      this.lines = new GlowLines({ resolution: [width, height], flow: 0.6, flowFreq: 2, flowSpeed: 0.3 });
      this.lines.setPolylines(sphereLines(2.0, 6, 0, 160).map(p => ({ points: p, color: PAL.line, intensity: 0.35, width: 1.0 })));
      this.scene.add(this.lines.mesh);
    }
    update(shot, t, T) {
      const half = shot._half;
      const cx = half === 'L' ? -2.6 : half === 'R' ? 2.6 : 0;
      this.camera.aspect = shot._aspect || this.ctx.aspect; this.camera.updateProjectionMatrix();
      this.camera.position.set(0, 0.6, 8); this.camera.lookAt(0, 0, 0);
      this.sphere.position.set(cx, 0, 0); this.lines.mesh.position.set(cx, 0, 0);
      this.sphere.rotation.y = t * 0.3; this.lines.mesh.rotation.x = 0.4 + t * 0.1;
      this.lines.uniforms.uTime.value = t;
      return {
        scene: this.scene, camera: this.camera,
        targets: { C: new THREE.Vector3(cx - 0.8, 0.5, 1.0), Si: new THREE.Vector3(cx + 0.8, -0.2, 1.0) },
      };
    }
    dispose() { this.lines.dispose(); }
  };
}
