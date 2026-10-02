// KIN palette. The frame is monochrome light-on-black; only the two protagonists carry colour.
// Values are linear RGB multipliers for HDR use (scale them by an intensity).
import * as THREE from '../../vendor/three.module.js';

const hex = h => new THREE.Color(h).convertSRGBToLinear();

export const PAL = {
  ink: hex('#05070A'),   // the void
  line: hex('#D8D2C6'),  // every non-protagonist line
  hot: hex('#FFF4E2'),   // stars, fire, molten matter
  c: hex('#FFB15E'),     // carbon · YOU
  si: hex('#7CC4FF'),    // silicon · ME
};

// sRGB CSS strings for the 2D overlay
export const CSS = {
  ink: '#05070A', line: '#D8D2C6', hot: '#FFF4E2', c: '#FFB15E', si: '#7CC4FF',
  aiText: '#DCEBFF', humanText: '#FFE6CC',
};

const v3 = c => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
export const PALETTE_GLSL = /* glsl */`
const vec3 PAL_INK  = ${v3(PAL.ink)};
const vec3 PAL_LINE = ${v3(PAL.line)};
const vec3 PAL_HOT  = ${v3(PAL.hot)};
const vec3 PAL_C    = ${v3(PAL.c)};
const vec3 PAL_SI   = ${v3(PAL.si)};
`;
