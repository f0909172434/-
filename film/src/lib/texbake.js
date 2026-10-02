// Offscreen texture baking: run a full-screen fragment shader ONCE into a render target
// (used in scene init() to precompute expensive procedural noise fields, so per-frame
// shaders only do texture lookups). Deterministic: the shader is a pure function of uv.
import * as THREE from '../../vendor/three.module.js';

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function bakeTexture(renderer, w, h, frag, uniforms = {}, { mipmaps = true, wrap = THREE.ClampToEdgeWrapping, type = THREE.HalfFloatType } = {}) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type, depthBuffer: false, generateMipmaps: mipmaps,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: wrap, wrapT: wrap,
  });
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevRT);
  mat.dispose(); quad.geometry.dispose();
  return rt; // use rt.texture; call rt.dispose() when done
}

// Tileable (periodic) value-noise fbm, for detail textures that repeat without seams.
export const periodicNoise = /* glsl */`
float ph(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float pvnoise(vec2 p, float P){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float a=ph(mod(i,P)), b=ph(mod(i+vec2(1,0),P)), c=ph(mod(i+vec2(0,1),P)), d=ph(mod(i+vec2(1,1),P));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float pfbm(vec2 p, float P){ float s=0.0,a=0.5; for(int i=0;i<6;i++){ s+=a*pvnoise(p,P); p*=2.0; P*=2.0; a*=0.5; } return s; }
`;
