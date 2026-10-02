// Cinematic post-processing pipeline.
// HDR scene -> (dissolve blend) -> bloom mip chain + anamorphic streak -> grade/composite -> screen.
import * as THREE from '../vendor/three.module.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DEFAULTS = {
  exposure: 1.0,
  bloomStrength: 0.6, bloomThreshold: 0.9, bloomKnee: 0.6, bloomRadius: 0.85,
  streak: 0.15, streakTint: [0.55, 0.75, 1.0],
  ca: 0.0018, vignette: 0.35, grain: 0.045,
  saturation: 1.0, contrast: 1.0, tint: [1, 1, 1], lift: [0, 0, 0],
  flash: 0.0, fade: 0.0, shake: 0.0,
};
export const POST_DEFAULTS = DEFAULTS;

export class Post {
  constructor(renderer, W, H) {
    this.r = renderer; this.W = W; this.H = H;
    const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
    this.hdrA = new THREE.WebGLRenderTarget(W, H, rtOpts);
    this.hdrB = new THREE.WebGLRenderTarget(W, H, rtOpts);
    this.hdrMix = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, depthBuffer: false });
    const mk = (w, h) => new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), { ...rtOpts, depthBuffer: false });
    this.mips = []; this.ups = [];
    let w = W / 2, h = H / 2;
    for (let i = 0; i < 6; i++) { this.mips.push(mk(w, h)); this.ups.push(mk(w, h)); w /= 2; h /= 2; }
    this.streakA = mk(W / 4, H / 8); this.streakB = mk(W / 4, H / 8);

    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene(); this.qscene.add(this.quad);

    const m = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });

    this.mBlend = m(/* glsl */`
      uniform sampler2D tA, tB; uniform float mixAmt, expA, expB; varying vec2 vUv;
      void main(){ gl_FragColor = vec4(mix(texture2D(tA,vUv).rgb*expA, texture2D(tB,vUv).rgb*expB, mixAmt), 1.0); }`,
      { tA: { value: null }, tB: { value: null }, mixAmt: { value: 0 }, expA: { value: 1 }, expB: { value: 1 } });

    const down13 = /* glsl */`
      vec3 down13(sampler2D t, vec2 uv, vec2 px){
        vec3 a=texture2D(t,uv+px*vec2(-2,-2)).rgb, b=texture2D(t,uv+px*vec2(0,-2)).rgb, c=texture2D(t,uv+px*vec2(2,-2)).rgb;
        vec3 d=texture2D(t,uv+px*vec2(-2,0)).rgb,  e=texture2D(t,uv).rgb,               f=texture2D(t,uv+px*vec2(2,0)).rgb;
        vec3 g=texture2D(t,uv+px*vec2(-2,2)).rgb,  h=texture2D(t,uv+px*vec2(0,2)).rgb,  i=texture2D(t,uv+px*vec2(2,2)).rgb;
        vec3 j=texture2D(t,uv+px*vec2(-1,-1)).rgb, k=texture2D(t,uv+px*vec2(1,-1)).rgb, l=texture2D(t,uv+px*vec2(-1,1)).rgb, mm=texture2D(t,uv+px*vec2(1,1)).rgb;
        return e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+mm)*0.125;
      }`;
    this.mPrefilter = m(down13 + /* glsl */`
      uniform sampler2D tSrc; uniform vec2 px; uniform float threshold, knee, expo; varying vec2 vUv;
      void main(){
        vec3 c = min(down13(tSrc, vUv, px) * expo, vec3(64.0));
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - threshold + knee, 0.0, 2.0*knee); rq = rq*rq/(4.0*knee+1e-4);
        float w = max(rq, br - threshold) / max(br, 1e-4);
        gl_FragColor = vec4(c * w, 1.0);
      }`, { tSrc: { value: null }, px: { value: new THREE.Vector2() }, threshold: { value: 1 }, knee: { value: 0.5 }, expo: { value: 1 } });
    this.mDown = m(down13 + /* glsl */`
      uniform sampler2D tSrc; uniform vec2 px; varying vec2 vUv;
      void main(){ gl_FragColor = vec4(down13(tSrc, vUv, px), 1.0); }`,
      { tSrc: { value: null }, px: { value: new THREE.Vector2() } });
    this.mUp = m(/* glsl */`
      uniform sampler2D tLow, tCur; uniform vec2 px; uniform float radius; varying vec2 vUv;
      void main(){
        vec3 s = texture2D(tLow, vUv).rgb*4.0;
        s += (texture2D(tLow, vUv+px*vec2(-1,0)).rgb + texture2D(tLow, vUv+px*vec2(1,0)).rgb + texture2D(tLow, vUv+px*vec2(0,-1)).rgb + texture2D(tLow, vUv+px*vec2(0,1)).rgb)*2.0;
        s += texture2D(tLow, vUv+px*vec2(-1,-1)).rgb + texture2D(tLow, vUv+px*vec2(1,-1)).rgb + texture2D(tLow, vUv+px*vec2(-1,1)).rgb + texture2D(tLow, vUv+px*vec2(1,1)).rgb;
        gl_FragColor = vec4(texture2D(tCur, vUv).rgb + s/16.0*radius, 1.0);
      }`, { tLow: { value: null }, tCur: { value: null }, px: { value: new THREE.Vector2() }, radius: { value: 0.85 } });
    this.mStreak = m(/* glsl */`
      uniform sampler2D tSrc; uniform vec2 px; uniform float stepSize; varying vec2 vUv;
      void main(){
        vec3 s = vec3(0.0); float wsum = 0.0;
        for(int i=-6;i<=6;i++){ float fi=float(i); float w = exp(-fi*fi/18.0); s += texture2D(tSrc, vUv + vec2(px.x*fi*stepSize, 0.0)).rgb*w; wsum += w; }
        gl_FragColor = vec4(s/wsum, 1.0);
      }`, { tSrc: { value: null }, px: { value: new THREE.Vector2() }, stepSize: { value: 1 } });

    this.mFinal = m(/* glsl */`
      uniform sampler2D tHDR, tBloom, tStreak, tOverlay;
      uniform vec2 res; uniform float expo, bloomStrength, streak, ca, vignette, grain, frame;
      uniform float saturation, contrast, flash, fade, overlayOn;
      uniform vec3 streakTint, tint, lift;
      varying vec2 vUv;
      vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
      vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }
      float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
      void main(){
        vec2 uv = vUv; vec2 cc = uv - 0.5; cc.x *= res.x/res.y;
        float r2 = dot(cc, cc);
        vec2 dir = (uv - 0.5) * ca * (0.4 + 2.5*r2);
        vec3 col;
        col.r = texture2D(tHDR, uv + dir).r;
        col.g = texture2D(tHDR, uv).g;
        col.b = texture2D(tHDR, uv - dir).b;
        col *= expo;
        col += texture2D(tBloom, uv).rgb * bloomStrength;
        col += texture2D(tStreak, uv).rgb * streakTint * streak;
        col *= tint; col += lift;
        col += vec3(flash);
        col = aces(col);
        float l = dot(col, vec3(0.2126,0.7152,0.0722));
        col = mix(vec3(l), col, saturation);
        col = clamp((col - 0.5)*contrast + 0.5, 0.0, 1.0);
        col *= mix(1.0, smoothstep(1.25, 0.15, length(cc)*1.05), vignette);
        col = toSRGB(col);
        // film grain, luminance-weighted, also acts as dither against banding
        float g = h12(uv*res + vec2(frame*13.7, frame*7.3)) + h12(uv*res*0.5 + frame*3.1) - 1.0;
        col += g * grain * (0.35 + 0.65*(1.0-l)) ;
        col += (h12(uv*res + frame) - 0.5) / 255.0;
        col *= (1.0 - fade);
        vec4 ov = texture2D(tOverlay, uv);
        col = mix(col, ov.rgb, ov.a * overlayOn);
        gl_FragColor = vec4(clamp(col,0.0,1.0), 1.0);
      }`, {
        tHDR: { value: null }, tBloom: { value: null }, tStreak: { value: null }, tOverlay: { value: null },
        res: { value: new THREE.Vector2(W, H) }, expo: { value: 1 }, bloomStrength: { value: 0.6 }, streak: { value: 0.1 },
        ca: { value: 0.002 }, vignette: { value: 0.3 }, grain: { value: 0.04 }, frame: { value: 0 },
        saturation: { value: 1 }, contrast: { value: 1 }, flash: { value: 0 }, fade: { value: 0 }, overlayOn: { value: 1 },
        streakTint: { value: new THREE.Vector3(0.55, 0.75, 1) }, tint: { value: new THREE.Vector3(1, 1, 1) }, lift: { value: new THREE.Vector3() },
      });
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qscene, this.cam);
  }

  // Blend two HDR frames for a dissolve. Returns the mixed target, exposure already applied.
  blend(a, b, mixAmt, expA, expB) {
    const u = this.mBlend.uniforms;
    u.tA.value = a.texture; u.tB.value = b.texture; u.mixAmt.value = mixAmt; u.expA.value = expA; u.expB.value = expB;
    this.pass(this.mBlend, this.hdrMix);
    return this.hdrMix;
  }

  finish(src, p, overlayTex, frame) {
    p = { ...DEFAULTS, ...p };
    // bloom
    const pf = this.mPrefilter.uniforms;
    pf.tSrc.value = src.texture; pf.px.value.set(1 / this.W, 1 / this.H);
    pf.threshold.value = p.bloomThreshold; pf.knee.value = p.bloomKnee; pf.expo.value = p.exposure;
    this.pass(this.mPrefilter, this.mips[0]);
    for (let i = 1; i < this.mips.length; i++) {
      const d = this.mDown.uniforms; const s = this.mips[i - 1];
      d.tSrc.value = s.texture; d.px.value.set(1 / s.width, 1 / s.height);
      this.pass(this.mDown, this.mips[i]);
    }
    let low = this.mips[this.mips.length - 1];
    for (let i = this.mips.length - 2; i >= 0; i--) {
      const u = this.mUp.uniforms;
      u.tLow.value = low.texture; u.tCur.value = this.mips[i].texture; u.px.value.set(1 / low.width, 1 / low.height); u.radius.value = p.bloomRadius;
      this.pass(this.mUp, this.ups[i]); low = this.ups[i];
    }
    // anamorphic streak from the 1/4 mip
    let sSrc = this.mips[1];
    const st = this.mStreak.uniforms;
    const steps = [1, 3, 9];
    let ping = this.streakA, pong = this.streakB;
    for (let i = 0; i < steps.length; i++) {
      st.tSrc.value = sSrc.texture; st.px.value.set(1 / ping.width, 1 / ping.height); st.stepSize.value = steps[i];
      this.pass(this.mStreak, ping); sSrc = ping; [ping, pong] = [pong, ping];
    }
    // final
    const f = this.mFinal.uniforms;
    f.tHDR.value = src.texture; f.tBloom.value = this.ups[0].texture; f.tStreak.value = sSrc.texture; f.tOverlay.value = overlayTex;
    f.expo.value = p.exposure; f.bloomStrength.value = p.bloomStrength; f.streak.value = p.streak;
    f.ca.value = p.ca; f.vignette.value = p.vignette; f.grain.value = p.grain; f.frame.value = frame % 997;
    f.saturation.value = p.saturation; f.contrast.value = p.contrast; f.flash.value = p.flash; f.fade.value = p.fade;
    f.streakTint.value.fromArray(p.streakTint); f.tint.value.fromArray(p.tint); f.lift.value.fromArray(p.lift);
    f.overlayOn.value = overlayTex ? 1 : 0;
    this.pass(this.mFinal, null);
  }
}
