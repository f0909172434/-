# KIN · Style bible (read before touching a scene)

The film is an AI's answer to "What are you?". **Every image is the AI's reconstruction of the world**, so the whole film is drawn the way an instrument would see it: **lines of light on black**. Scan lines, contour lines, cross-sections, streamlines, wireframes. The lines are luminous, thin, calm and precise. Nothing is noisy, nothing glitters for its own sake.

If a frame looks like a screensaver or a VFX demo, it is wrong. If it looks like a page from a beautiful scientific atlas that has come alive, it is right.

## 1. Palette (non-negotiable)

| Token | Hex | Linear-ish HDR use | Meaning |
|---|---|---|---|
| `ink` | `#05070A` | background | the void, always near-black, very slightly blue |
| `line` | `#D8D2C6` | 0.15–1.2 | **everything** that is not a protagonist: warm grey-white lines |
| `hot` | `#FFF4E2` | 2–40 | stars, fire, molten matter, flashes: white with a hint of warmth |
| `c` (carbon · YOU) | `#FFB15E` | 0.8–6 | **only** the carbon atom, its path and the human's text and things that are "you" (the hand, the fingerprint) |
| `si` (silicon · ME) | `#7CC4FF` | 0.8–6 | **only** the silicon atom, its path, the AI's text and things that are "me" (the chip, the crystal, the grain of sand) |

* Import from `film/src/look/palette.js` (JS `PAL`, GLSL `PALETTE_GLSL`). Never invent new hues.
* **Saturation budget:** the frame is monochrome except for `c` and `si`. A forest is not green. The sea is not blue. Fire is `hot`, not orange. The Earth is `line`.
* Use brightness, density and depth falloff (lines fading into `ink` with distance) for drama, not colour.

## 2. Drawing primitives (use the shared library: `film/src/look/`)

| Primitive | Module | Use for |
|---|---|---|
| **Contour surfaces** | `contourMaterial()` in `look/materials.js` | Any solid: hands, fingertips, mountains, the Earth, the star's shells, the crystal ingot, chip packages. The surface is black and occludes; light only lives in the **iso-lines** (planar slices) and the **rim**. Like a CT scan or a topographic map. |
| **Glow lines** | `GlowLines` in `look/lines.js` | Polylines: streamlines of gas, debris filaments, circuits, lattice bonds, waves, orbits, wireframes. Anti-aliased screen-space ribbons with a soft core, width in px. |
| **Soft points** | `SoftPoints` in `look/points.js` | Atoms, sand grains, dust, sparks. Round, soft, never sparkly. Out-of-focus points become large dim bokeh discs (energy-conserving). |
| **Helpers** | `look/geom.js` | Sphere latitude lines, polyline resampling/morphing, streamlines through curl noise, marching squares, catmull-rom. |

Line weights at 1080p (scale with `ctx.height/804`): hairline 0.8 px, standard 1.2 px, emphasis 2 px. Rarely more.

## 3. Composition and camera

* 2.39:1. Respect negative space. One subject per frame.
* Cards sit in the lower third (baseline around y 640–700 of 804). Keep the lower third calm when a card is up (see `cards` in the timeline).
* The tracked atoms (`targets.C`, `targets.Si`) must be on screen and **not** in the lower third while tracked; the reticle labels extend up-right by about 260×90 px.
* Camera moves are slow, eased (`easeInOutSine`/`easeInOutCubic`), motivated. No random shake except physically motivated (the supernova). No handheld jitter.
* **Split screen** (88–146): you get `shot._half` = `'L'` or `'R'` and `shot._aspect` = the full-frame aspect (you render with the full-frame camera; the engine scissors your half). Frame your subject at x ≈ 25% (L) or 75% (R) of the frame. Without `_half` (e.g. in the rewind montage) centre the subject.

## 4. Motion

* The engine renders **6–10 sub-frames per frame** with a 180° shutter and sub-pixel jitter. Motion blur and anti-aliasing are free. So: real motion is welcome, and **flicker is forbidden** (anything that changes per sub-frame without real motion becomes mush).
* `update(shot, t, T)` is called once per sub-frame. Keep it cheap. Heavy CPU work (marching cubes, re-meshing) must be cached by a key derived from `t` quantised to the frame (`Math.round(t*24)`) and computed deterministically.
* Lines may "flow" (dashes or pulses travelling along them). That's the house style for energy and life.

## 5. Light

* HDR. Lines sit at 0.15–1.2. The `c`/`si` protagonists reach 2–6 so they bloom slightly. `hot` sources reach 10–40 and drive bloom, halation and the anamorphic streak.
* Post (bloom, halation, ACES, grain, vignette) is shared. Choose per-shot `post` values modestly; the defaults are already tuned. Never crank bloom to hide weak drawing.

## 6. Typography (overlay, not scenes)

* AI voice: Noto Serif TC Light, cool white tinted `si`; English in Cormorant Garamond Italic.
* Human voice: Noto Sans TC Light, warm white tinted `c`.
* HUD: JetBrains Mono Light, small, 45–70% white, wide tracking.
* Scenes never draw text.

## 7. The rules

1. Monochrome lines + two accent colours. Nothing else.
2. Every shot has one idea. If you need to explain it, simplify it.
3. Something always moves, slowly and with intent.
4. No noise for texture. Detail must come from structure (more lines, finer contours), not from random speckle.
5. Pure function of time. No `Math.random()`, no state between frames. Use seeded `Rand`.
6. Look at your frames at full resolution, crop in, and be your harshest critic. Would this frame hang in a gallery?
