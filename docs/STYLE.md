# 卜 ORACLE · Style bible (read before touching a scene)

The film follows one question through the AI's memory and three thousand years of human asking. Its visual matter is **data**: text, numbers, perforations, ink, strokes, knife cuts, cracks. Like *I Have Never Seen the Sun*, it is grand without outer space. The grandeur comes from scale (millions of questions), time (3,200 years) and material culture (bone, ink, bamboo, paper tape, silicon).

If a frame looks like a screensaver or a tech demo, it is wrong. If it looks like a museum catalogue of human questions that has come alive, rendered with the precision of a data visualisation, it is right.

## 1. Palette

| Token | Hex | Meaning |
|---|---|---|
| `ink` | `#05070A` | the dark: background, always near-black |
| `line` | `#D8D2C6` | paper-white light: neutral data, structure, text of the river |
| `hot` | `#FFF4E2` | fire, the heated rod, the crack's flash |
| `c` (human) | `#FFB15E` | **human** questions and memories, firelight, cinnabar in the carvings (use a slightly redder `#E8743B` for cinnabar only) |
| `si` (AI) | `#7CC4FF` | **the AI**: its voice, its tokens, attention lines, circuits, the present-day data |

* Import from `film/src/look/palette.js`. The keys are still named `c`/`si` from the previous cut: treat `c` as HUMAN and `si` as AI. `PAL.cinnabar` is for the oracle-bone carvings only.
* The palette values are now true linear versions of the hex codes (the earlier cuts converted them twice, which made the amber red and the blue deep). Tune intensities against the current values.
* Saturation budget: monochrome except the human warmth and the AI blue. Temple slips and bone are not brown; they are `line`, lit warmly by `c` firelight.
* Era changes are shown through **material and typography**, not new colours.

## 2. Primitives (`film/src/look/` + `film/src/lib/`)

| Primitive | Module | Use for |
|---|---|---|
| **Text field** | `look/text.js` (API in its header and in docs/SCENE_API.md) | The river of questions; tokens; numbers; telegram text; binary tables. Tens of thousands of strings from a canvas-built glyph atlas, non-instanced, with DOF, flow along paths, typing reveal, time windows and colour cross-fades. Fonts per era: `sans`, `mono`, `type`, `script`, `kai`, `serif`, `garamond`. |
| **FLines** | `lib/flines.js` | Any large number of lines (≈30× cheaper than instanced GlowLines on SwiftShader). Attention links, cracks, yao lines, circuits, perforation grids. |
| GlowLines | `look/lines.js` | Small line counts only. |
| Soft points | `look/points.js` | Tokens as points, perforations seen from afar, dust in firelight, rising embers. |
| Contour surfaces | `look/materials.js` | The turtle plastron (relief as contour lines), the yarrow stalks, the bronze rod, the vessel shapes. |
| Edge boxes | `lib/edgebox.js` | Token cells, punch cards, chips, circuit blocks with travelling pulses. |
| Line morph | `lib/linemorph.js` | Continuous line metamorphoses: crack → yao lines → hexagrams → binary → circuit traces. |

## 3. Era materials (the river, upstream)

| Era (HUD year) | Data texture | Typography / material |
|---|---|---|
| 2026 | chat bubbles, tokens, vectors | Noto Sans TC / multilingual Noto; clean, cold, `si` |
| 1998 | emails, forum posts | monospace with timestamps and headers |
| 1931 | telegram ticker tape, Morse | narrow paper tape, punched holes (5-hole Baudot), uppercase sans |
| 1868 | handwritten letters | ink strokes that draw themselves, slight bleed |
| 1700s | temple fortune slips (籤詩), woodblock | bamboo sticks in a cylinder (籤筒), carved vertical text |
| 800 BCE | yarrow stalks, yao lines | 49 stalks dividing, lines ⚊ ⚋ drawn as brush strokes |
| 1200 BCE | oracle bone | knife-cut glyphs (authored as polylines), cinnabar fill, the crack 卜 |

## 4. Composition, camera, motion

* 2.39:1, strong negative space, one idea per shot.
* Cards sit in the lower third (baseline y ≈ 640–700 of 804). Keep it calm under cards.
* Cameras move slowly and with motivation. The river shots fly forward through depth layers, for parallax and scale.
* The engine renders 6–10 sub-frames per frame (motion blur + AA). Real motion is welcome; flicker is forbidden.
* `update()` runs per sub-frame: cache CPU-heavy work by `Math.round(t*24)`.

## 5. Typography (overlay)

* AI voice: Noto Serif TC Light, cool white; English in Cormorant Garamond Italic.
* Human voice: Noto Sans TC Light, warm white. **A historical human's question (the king's) uses the human style too.**
* HUD: JetBrains Mono, small, wide tracking: the year (`2026`, `公元前 1200 年 · 1200 BCE`) and the place (`殷墟 · ANYANG`).
* Scenes may draw text only through the text field (as data). UI text belongs to the overlay.

## 6. Rules

1. Monochrome + human warmth + AI blue. Nothing else.
2. Every era must feel researched: the hole pitch of the tape, the count of the yarrow stalks, the shape of the bone's drilled hollows.
3. Something always moves, slowly and with intent.
4. No noise for texture. Detail comes from structure: more text, finer strokes.
5. Pure function of time. Seeded randomness only.
6. Crop in at full resolution and judge harshly. Would this frame hang in a gallery?
