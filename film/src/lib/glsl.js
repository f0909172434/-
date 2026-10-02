// Shared GLSL chunks. Import and concatenate into shader sources.

// Ashima / Stefan Gustavson simplex noise (MIT).
export const simplex3 = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm3(vec3 p){float s=0.0,a=0.5;for(int i=0;i<5;i++){s+=a*snoise(p);p=p*2.02+vec3(17.1,9.2,3.7);a*=0.5;}return s;}
float ridged3(vec3 p){float s=0.0,a=0.5;for(int i=0;i<5;i++){s+=a*(1.0-abs(snoise(p)));p=p*2.03+vec3(5.3,1.7,8.1);a*=0.5;}return s;}
vec3 curl3(vec3 p){
  const float e=0.1;
  vec3 dx=vec3(e,0,0),dy=vec3(0,e,0),dz=vec3(0,0,e);
  vec3 a=vec3(snoise(p),snoise(p+vec3(31.4,7.1,2.9)),snoise(p+vec3(-9.7,23.3,11.1)));
  float x1=snoise(p+dy+vec3(-9.7,23.3,11.1))-snoise(p-dy+vec3(-9.7,23.3,11.1));
  float x2=snoise(p+dz+vec3(31.4,7.1,2.9))-snoise(p-dz+vec3(31.4,7.1,2.9));
  float y1=snoise(p+dz)-snoise(p-dz);
  float y2=snoise(p+dx+vec3(-9.7,23.3,11.1))-snoise(p-dx+vec3(-9.7,23.3,11.1));
  float z1=snoise(p+dx+vec3(31.4,7.1,2.9))-snoise(p-dx+vec3(31.4,7.1,2.9));
  float z2=snoise(p+dy)-snoise(p-dy);
  return vec3(x1-x2,y1-y2,z1-z2)/(2.0*e);
}
`;

export const hash = /* glsl */`
float hash11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec3 hash33(vec3 p3){p3=fract(p3*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yxz+33.33);return fract((p3.xxy+p3.yxx)*p3.zyx);}
`;

// Physically-inspired blackbody colour (approx, Kelvin -> linear RGB), handy for stars.
export const blackbody = /* glsl */`
vec3 blackbody(float K){
  K=clamp(K,1000.0,40000.0)/100.0; vec3 c;
  c.r = K<=66.0 ? 1.0 : clamp(1.29293618606*pow(K-60.0,-0.1332047592),0.0,1.0);
  c.g = K<=66.0 ? clamp(0.39008157876*log(K)-0.63184144378,0.0,1.0) : clamp(1.12989086089*pow(K-60.0,-0.0755148492),0.0,1.0);
  c.b = K>=66.0 ? 1.0 : (K<=19.0 ? 0.0 : clamp(0.54320678911*log(K-10.0)-1.19625408914,0.0,1.0));
  return pow(c, vec3(2.2));
}
`;

// Standard soft round sprite for gl_PointCoord based particles.
export const softPoint = /* glsl */`
float softDisc(vec2 pc){ float d=length(pc-0.5)*2.0; return exp(-d*d*4.0)*(1.0-smoothstep(0.85,1.0,d)); }
`;
