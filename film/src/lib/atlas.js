// Small helpers shared by the drift / earth / stone scenes ("the atlas" look).
//
//  frameCamera(cam, shot, ctx)   lens-shift the full-frame camera so its optical axis lands at x = 25% (L) / 75% (R)
//                                of the frame in the split screen, and at the centre otherwise. Uses PerspectiveCamera
//                                .filmOffset, which survives the engine's jitter (setViewOffset) and is used when the
//                                engine projects targets, so a subject placed on the camera axis is framed correctly.
//  patch(material, key, find, replace)   checked string patch of a library shader (throws if the anchor moved).
//  AtomGlow                      a protagonist atom: a crisp core + a soft halo (SoftPoints), optionally drawn on top.
import * as THREE from '../../vendor/three.module.js';
import { SoftPoints } from '../look/points.js';

export function frameCamera(cam, shot, ctx, fov = null) {
  cam.aspect = shot._aspect || ctx.aspect;
  if (fov != null) cam.fov = fov;
  const shift = shot._half === 'L' ? 0.25 : shot._half === 'R' ? -0.25 : 0;
  // three: left += near * filmOffset / filmWidth ; frustum width at near = aspect * 2 * near * tan(fov/2)
  cam.filmOffset = shift * cam.aspect * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.getFilmWidth();
  cam.updateProjectionMatrix();
}

export function patch(material, key, find, replace) {
  const src = material[key];
  if (!src.includes(find)) throw new Error(`atlas.patch: anchor not found in ${key}: ${find.slice(0, 60)}`);
  material[key] = src.replace(find, replace);
  material.needsUpdate = true;
}

// Project a world point to render-target pixels (gl_FragCoord convention: origin bottom-left).
const _v = new THREE.Vector3();
export function toFragCoord(p, cam, W, H, out = new THREE.Vector2()) {
  _v.copy(p).project(cam);
  return out.set((_v.x * 0.5 + 0.5) * W, (_v.y * 0.5 + 0.5) * H);
}

// A protagonist atom: core point (size ~3.4 px, intensity 3–6) + soft halo.
export class AtomGlow {
  constructor(ctx, { onTop = false } = {}) {
    this.sp = new SoftPoints({ count: 3, resolution: [ctx.width, ctx.height], depthTest: !onTop, maxSize: 80 });
    this.mesh = this.sp.mesh;
    this.mesh.renderOrder = onTop ? 10 : 2;
  }
  set(p, color, { core = 4.5, size = 3.4, halo = 0.22, haloSize = 22, wide = 0.035, wideSize = 70 } = {}) {
    const s = this.sp;
    for (let i = 0; i < 3; i++) s.positions.set([p.x, p.y, p.z], i * 3);
    const put = (i, k, sz) => { s.colors.set([color.r * k, color.g * k, color.b * k], i * 3); s.sizes[i] = sz; };
    put(0, core, size); put(1, halo, haloSize); put(2, wide, wideSize);
    s.update();
  }
  dispose() { this.sp.dispose(); }
}
