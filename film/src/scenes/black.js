// Empty black stage, used for the boot sequence, title cards and credits (all drawn by the overlay).
import * as THREE from '../../vendor/three.module.js';
export default class Black {
  constructor(ctx) { this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(40, ctx.aspect, 0.1, 10); }
  update() { return { scene: this.scene, camera: this.camera, post: { bloomStrength: 0.0, streak: 0, grain: 0.035, vignette: 0, ca: 0 } }; }
}
