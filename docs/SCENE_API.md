# Scene authoring guide

Read `docs/PLAN.md`, `docs/STYLE.md` (the look) and `docs/SCREENPLAY.md` (the story) first. Use `lib/flines.js` for large line counts and `look/text.js` for text as data. Every picture comes from a **scene module** in `film/src/scenes/<name>.js`. The engine (`film/src/engine.js`) picks the scene for the shot at time `T` and calls it once per **sub-frame** (6–10 per frame, spread over a 180° shutter, each with a sub-pixel jitter). Then it runs the shared post-processing and the overlay (HUD, reticles, chat, cards). Scenes never draw text.

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

### Text as data: `look/text.js`
The full API is in the header of `film/src/look/text.js`. In short:

```js
import { TextField, FONT } from '../look/text.js';
// init()
this.tf = new TextField(this.ctx, { px: 48, atlasSize: 4096, focus: 12, aperture: 0.3, fade: [0.5, 1.5, 60, 90] });
const items = [
  { text: '她會好起來嗎？', pos: [0, 0, -8], billboard: true, size: 0.12, color: PAL.c, intensity: 1.2 },
  { text: 'هل ستشفى أمي؟', path: 0, s: 3.0, off: [0.2, 0], speed: -0.8, size: 0.1, color: PAL.line },
  { text: 'MOTHER GRAVELY ILL STOP', font: 'type', pos: [1, 0, -6], ax: [1, 0, 0], ay: [0, 1, 0], reveal: [2, 4] },
  { text: '婦好其\n有疾', font: 'kai', vertical: true, pos: [0, 1, -5], show: [1, 9, 0.5, 0.5] },
];
this.tf.setPaths([{ points: [...], up: [0, 1, 0] }]);   // before set() when strings use paths
await this.tf.prepare(items);                          // loads fonts, draws glyphs (async: only in init)
this.tf.set(items);                                    // builds the mesh; keep indices to update(i, {...}) later
this.scene.add(this.tf.mesh);
// update(shot, t, T)
this.tf.uniforms.uTime.value = t;                      // drift, flow, reveal, show and mix all run on this
this.tf.uniforms.uFocus.value = ...;                   // depth of field like SoftPoints
this.tf.cull(this.camera, t, Math.round(T * 24));      // big fields: drop hidden / off-screen strings once per frame
```

* Fonts (`FONT`): `sans` (Noto Sans TC), `latin` (Noto Sans), `serif` (Noto Serif TC, woodblock print), `mono` (JetBrains Mono),
  `type` (Courier Prime: typewriter, telegrams), `script` (Pinyon Script: 19th-century copperplate), `kai` (LXGW WenKai TC:
  brush handwriting), `garamond` (EB Garamond: 1703 print), `cormorant`. Japanese, Korean, Arabic, Hebrew, Devanagari and Thai
  pick their Noto face automatically; Arabic, Hebrew, Indic and Thai lines are drawn as one shaped image ("strip").
* All animation is on the GPU as a function of `uTime`: `vel` / `speed` (flow along a path), `reveal: [t0, t1]` (typing),
  `show: [t0, t1, fadeIn, fadeOut]`, `color2` + `mix: [t0, t1]`. For anything else, call `update(i, props)` (string data only,
  cheap) or `set(items)` again (rebuild; fine for a few thousand glyphs, cache by frame).
* Depth of field is energy conserving: mild blur samples the atlas mips; strong blur, and text smaller than ~2.6 px per em,
  becomes one soft bar per string. Faces are double-sided: a plane seen from behind reads mirrored.
* Cost (SwiftShader, full res): ~0.13 µs per vertex (4 per glyph) + covered pixels at ~40 Mpx/s. A 20k-string field with
  135k glyphs drawn costs ~0.25 s sharp. Big near strings and heavy defocus cost the most: keep them to a few hundred.
* Text is data inside the world. UI text (chat, HUD, cards) stays in the overlay.

### Hand-offs from the overlay
* **27.2 (open → mind):** the sent question's seven characters recede into the screen as points of light and gather in a small
  warm cluster at the frame centre (960, 402 in the 1920×804 design space), fading over 27.2–28.1 while the mind dissolves in.
  The mind scene should receive them there.
* **206.2 / 210.4 / 216.4 (lift):** each memory sentence dissolves left to right from the input line (y ≈ 660) into warm
  points that rise ~60–110 px and fade within ~3 s. The memory river (212–245) should show the same sentences arriving in it.
* **246.5 (title):** the crack snaps at the junction (962, 352) and draws 卜; flash and sparks are in the overlay.

### Tracked atoms (from the earlier cut; unused in ORACLE)
`targets.C` (carbon · YOU, amber) and `targets.Si` (silicon · ME, blue) are world positions. Return them whenever the timeline's `trace` has them active in your shot. The overlay draws reticles, labels (which extend ~260×90 px up-right, or up-left near the right edge or the split seam) and the dashed **distance line** between them. Keep tracked atoms out of the lower third (cards) and inside your half in the split screen. Make the atom itself visible: a small bright point in its colour (`PAL.c` / `PAL.si`, intensity 3–6).

## Preview workflow

```bash
node tools/render.mjs shot <shotId> --step 2                    # half-res, 1 sample, contact sheet
node tools/render.mjs stills --times 36.5,37 --scale 1 --samples 6   # final quality + ms per frame
```
Outputs go to `out/stills/…`. Look at them with the Read tool, crop into details (ffmpeg crop), and iterate until every frame could hang in a gallery.
