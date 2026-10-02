# Scene authoring guide

Read `docs/PLAN.md`, `docs/STYLE.md` (the look) and `docs/SCREENPLAY.md` (the story) first. Use `lib/flines.js` for large line counts and `look/text.js` (once built) for text as data. Every picture comes from a **scene module** in `film/src/scenes/<name>.js`. The engine (`film/src/engine.js`) picks the scene for the shot at time `T` and calls it once per **sub-frame** (6–10 per frame, spread over a 180° shutter, each with a sub-pixel jitter). Then it runs the shared post-processing and the overlay (HUD, reticles, chat, cards). Scenes never draw text.

## Contract

```js
import * as THREE from '../../vendor/three.module.js';
import { PAL } from '../look/palette.js';
import { GlowLines } from '../look/lines.js';
import { SoftPoints } from '../look/points.js';
import { contourMaterial } from '../look/materials.js';
import { resample, morph, catmull, sphereLines, makeCurl, streamline, marchingSquares } from '../look/geom.js';
import { Rand, fbm1 } from '../lib/random.js';
import { Noise3 } from '../lib/cosmos.js';
import { clamp, lerp, smoothstep, easeInOutSine, easeInOutCubic } from '../lib/ease.js';

export default class MyScene {
  constructor(ctx) {}      // ctx = { THREE, renderer, width, height, aspect, scale, timeline }
  async init() {}          // build everything ONCE, deterministically (seeded Rand only)
  update(shot, t, T) {
    // shot: the timeline entry (shot.mode selects the variant)
    //   shot._aspect : full-frame aspect, always set camera.aspect = shot._aspect
    //   shot._half   : 'L' | 'R' in the split screen (render full-frame, frame your subject at x≈25%/75%)
    //   shot._rewind : true when replayed backwards in the rewind montage (40–49 s)
    // t: seconds since the (source) shot start, T: global film time
    return {
      scene, camera,
      targets: { C: Vector3?, Si: Vector3? },   // world positions of the tracked atoms (see timeline "trace")
      post: { ... },                             // per-shot grading, see post.js POST_DEFAULTS
    };
  }
  dispose() {}
}
```

### Hard rules
1. **`update()` must be a pure function of `(shot, t)`.** No accumulation between calls (`+= dt`), no `Math.random()`, no `Date.now()`. Frames render out of order on several workers.
2. `update()` runs 6–10× per frame, so keep it light. Cache expensive CPU work (re-meshing, marching squares) by a key such as `Math.round(t*24)` (deterministic, not "state").
3. Output **linear HDR**. No tonemapping or gamma in scenes.
4. Handle `t` outside the shot range gracefully (clamp or extrapolate): dissolves render the previous shot past its end, and the rewind montage replays your shot backwards from its end to its start.
5. Size lines and points in px relative to 804p (the library does this from `resolution: [ctx.width, ctx.height]`).
6. **Budget:** one `update()` + render ≤ **0.35 s** at full res on SwiftShader (the CPU). A full frame (6 sub-frames + post) should stay under ~3 s. Measure with `--scale 1 --samples 6`.
7. Never edit `engine.js`, `post.js`, `overlay.js`, `main.js`, `timeline.json` or `look/*`. If you need a change there, say so in your report. You may add new helper files in `film/src/lib/` (new files only).
8. Use the palette and primitives from `film/src/look/`. No other colours, no particle noise for texture, no grain or sparkle.

### Tracked atoms
`targets.C` (carbon · YOU, amber) and `targets.Si` (silicon · ME, blue) are world positions. Return them whenever the timeline's `trace` has them active in your shot. The overlay draws reticles, labels (which extend ~260×90 px up-right, or up-left near the right edge or the split seam) and the dashed **distance line** between them. Keep tracked atoms out of the lower third (cards) and inside your half in the split screen. Make the atom itself visible: a small bright point in its colour (`PAL.c` / `PAL.si`, intensity 3–6).

## Preview workflow

```bash
node tools/render.mjs shot <shotId> --step 2                    # half-res, 1 sample, contact sheet
node tools/render.mjs stills --times 36.5,37 --scale 1 --samples 6   # final quality + ms per frame
```
Outputs go to `out/stills/…`. Look at them with the Read tool, crop into details (ffmpeg crop), and iterate until every frame could hang in a gallery.
