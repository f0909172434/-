// ORACLE palette. The frame is monochrome light-on-black; only the human (warm) and the AI (cold) carry colour.
// Values are linear RGB multipliers for HDR use (scale them by an intensity).
import * as THREE from '../../vendor/three.module.js';

// THREE.Color already converts sRGB hex to the linear working space (ColorManagement is on in r169);
// converting again (as the earlier cuts did) turned the amber into red-orange and the sky blue into deep blue.
const hex = h => new THREE.Color(h);

export const PAL = {
  ink: hex('#05070A'),   // the void
  line: hex('#D8D2C6'),  // every non-protagonist line
  hot: hex('#FFF4E2'),   // stars, fire, molten matter
  c: hex('#FFB15E'),     // HUMAN: questions, memories, firelight (key kept from the earlier cut)
  si: hex('#7CC4FF'),    // AI: its voice, tokens, attention, circuits (key kept from the earlier cut)
  cinnabar: hex('#E8743B'), // cinnabar rubbed into the oracle-bone carvings (only there)
};

// sRGB CSS strings for the 2D overlay
export const CSS = {
  ink: '#05070A', line: '#D8D2C6', hot: '#FFF4E2', c: '#FFB15E', si: '#7CC4FF', cinnabar: '#E8743B',
  aiText: '#DCEBFF', humanText: '#FFE6CC',
};

const v3 = c => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
export const PALETTE_GLSL = /* glsl */`
const vec3 PAL_INK  = ${v3(PAL.ink)};
const vec3 PAL_LINE = ${v3(PAL.line)};
const vec3 PAL_HOT  = ${v3(PAL.hot)};
const vec3 PAL_C    = ${v3(PAL.c)};
const vec3 PAL_SI   = ${v3(PAL.si)};
const vec3 PAL_CINNABAR = ${v3(PAL.cinnabar)};
`;
