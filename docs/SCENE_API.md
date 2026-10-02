# Scene authoring guide

Every picture in the film comes from a **scene module** in `film/src/scenes/<name>.js`. The engine (`film/src/engine.js`) chooses the scene for the shot at time `T`, asks it for a frame, then runs the shared post-processing and overlay passes on that frame.

## Contract

```js
import * as THREE from '../../vendor/three.module.js';
import { simplex3, hash, blackbody, softPoint } from '../lib/glsl.js';
import { Rand, fbm1, vnoise1 } from '../lib/random.js';
import { clamp, lerp, smoothstep, easeInOutCubic, ... } from '../lib/ease.js';

export default class MyScene {
  constructor(ctx) {}      // ctx = { THREE, renderer, width, height, aspect, scale, timeline }
  async init() {}          // build geometry/materials ONCE, deterministically (seeded Rand only)
  update(shot, t, T) {     // shot = the timeline entry (shot.mode selects the variant),
                           // t = seconds since shot.start, T = global film time
    return {
      scene, camera,                    // what to draw (rendered into a HalfFloat HDR target)
      target: THREE.Vector3 | null,     // world position of the tracked carbon atom (for the HUD reticle)
      post: { ... },                    // per-frame grading, see below
      // optional: render(renderer, target) { ... }  to do custom multi-pass rendering into `target`
    };
  }
  dispose() {}             // free GPU resources
}
```

### Hard rules
1. **`update()` must be a pure function of `(shot, t)`.** Frames are rendered out of order, by several workers in parallel. Nothing may accumulate between calls: no `+= dt`, no `Math.random()`, no `Date.now()`. Use seeded `Rand` in `init()`, and put motion in shaders as functions of a `uTime` uniform, or compute it in closed form from `t`.
2. Output **linear HDR**. Values above 1.0 are fine and wanted; that is what drives bloom. Do not tonemap or gamma-correct in the scene. Post does ACES, grain, vignette, chromatic aberration and the anamorphic streak.
3. `update()` may be called with `t` slightly **outside** `[0, shot duration]`. During a dissolve the previous shot is rendered past its end. Clamp or extrapolate gracefully.
4. Respect `ctx.width/height`. Previews run at `scale=0.5`, so size `gl_PointSize` relative to resolution (`* uScale` where `uScale = ctx.height / 804`).
5. Performance: rendering uses **SwiftShader (CPU)**. Budget about **≤ 1.5 s per full-res frame** (`--scale 1`). Prefer up to ~300–600k points with small sprites, raymarch only in limited screen areas or at low step counts, and use half-res offscreen targets for expensive volumetrics. Overdraw from huge additive sprites is the main thing to avoid.
6. Never modify `engine.js`, `post.js`, `overlay.js`, `main.js`, `timeline.json`. If you need an engine change, say so in your report.

### `post` keys (all optional, defaults in `post.js`)
`exposure, bloomStrength, bloomThreshold, bloomKnee, bloomRadius, streak, streakTint[3], ca, vignette, grain, saturation, contrast, tint[3], lift[3], flash, fade, shake`

* `flash`: white added before tonemapping (e.g. 3–8 for a supernova white-out).
* `shake`: 0–1 deterministic camera shake.
* `fade`: 0–1 to black.

The engine handles shot transitions (`in: cut | fade | white | dissolve`) and the HUD, cards and reticle. The scene only has to return its picture and the `target`.

## Preview workflow

```bash
node tools/render.mjs shot <shotId> --step 2          # half-res stills across the shot + contact sheet
node tools/render.mjs stills --times 43.5,45 --scale 1 # exact times at full res (prints ms/frame)
```
Outputs go to `out/stills/…`. Open the contact sheet PNG and look at it critically. Iterate until each frame looks like it belongs in a feature film.
