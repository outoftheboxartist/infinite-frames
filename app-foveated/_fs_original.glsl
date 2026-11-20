
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_tex, u_glow; uniform vec2 u_res, u_gt; uniform vec4 u_f[4]; uniform float u_t, u_style, u_dpr;
const vec3 BG=vec3(.039,.039,.047), WH=vec3(.949,.937,.902);
const vec3 RD=vec3(.89,.149,.176), YL=vec3(.965,.812,.102), BL=vec3(.122,.31,.816);
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float b2(vec2 a){a=floor(a);return fract(dot(a,vec2(.5,a.y*.75)));}
float b8(vec2 a){return b2(.25*a)*.0625+b2(.5*a)*.25+b2(a);}
float sat(vec3 c){return max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));}
vec3 prim(vec3 c,float pick){
  if(sat(c)<.25) return pick<.333?RD:(pick<.667?YL:BL);
  float dR=distance(c,RD),dY=distance(c,YL),dB=distance(c,BL);
  return dR<dY?(dR<dB?RD:BL):(dY<dB?YL:BL);
}
float disc(float d,float r){return (1.-smoothstep(r*.45,r,d))*(.7+.6*smoothstep(r*.2,r*.9,d));}
vec3 blocks(vec2 fc,float fall){
  float lv=floor(clamp((fall-.16)/.84,0.,.999)*4.);
  float bs=exp2(lv)*u_dpr;
  vec2 cell=floor(fc/bs), cuv=(cell+.5)*bs/u_res, o=vec2(.25*bs)/u_res;
  vec3 c1=texture2D(u_tex,cuv+o).rgb, c2=texture2D(u_tex,cuv-o).rgb, c3=texture2D(u_tex,cuv+vec2(o.x,-o.y)).rgb, c4=texture2D(u_tex,cuv+vec2(-o.x,o.y)).rgb;
  vec3 mx=max(max(c1,c2),max(c3,c4)), av=(c1+c2+c3+c4)*.25;
  vec3 da=av-BG; float L=clamp((max(da.r,max(da.g,da.b))-.03)*1.9,0.,1.);
  float hc=h21(cell+lv*17.);
  float th=fract(b8(cell)+.16*sin(u_t*1.1+hc*6.283));
  float drop=h21(cell+floor(u_t*.9+hc*7.)*3.1);
  float dropP=smoothstep(.5,1.,fall)*.72;
  vec3 outc=BG;
  if(L>th&&drop>dropP){
    float pick=h21(cell*.731+floor(u_t*.35+hc*5.));
    bool toPrim=h21(cell+9.7)<smoothstep(.28,.72,fall);
    outc=(toPrim||sat(mx)>.25)?prim(mx,pick):WH;
  }
  return outc;
}
// Prism: lens-like colour split that grows outward, a soft glow haze, and lines that
// dissolve into twinkling bokeh sparkles with rainbow rims, drifting toward primaries.
vec3 prismFx(vec2 fc,float fall,vec3 src){
  vec2 dv=fc-u_f[0].xy; float dl=length(dv); vec2 dir=dl>.5?dv/dl:vec2(1.,0.);
  float px=u_dpr;
  float ca=(.3+3.5*fall)*px;
  vec3 split=vec3(texture2D(u_tex,(fc-dir*ca)/u_res).r, src.g, texture2D(u_tex,(fc+dir*ca)/u_res).b);
  vec2 uv=fc/u_res, go=u_gt*(1.+1.5*fall);
  vec3 glow=vec3(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 w=vec2(float(x),float(y));glow+=texture2D(u_glow,uv+w*go).rgb*(x==0&&y==0?.2:(x==0||y==0?.125:.075));}
  glow=max(glow-BG,0.);
  glow=1.-exp(-glow*(.9+1.3*fall));
  glow*=.55;
  float m=smoothstep(.16,.6,fall);
  vec3 sp=vec3(0.);
  if(m>0.){
    float lv=fall<.55?0.:(fall<.8?1.:2.);
    float bs=(3.5+lv*2.5)*px;
    vec2 base=floor(fc/bs);
    float sca=(1.+3.*fall)*px;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      vec2 c=base+vec2(float(x),float(y));
      float h1=h21(c+lv*13.1),h2=h21(c*1.37+7.1),h3=h21(c*.71+3.3);
      vec2 ctr=(c+.5+(vec2(h1,h2)-.5)*.8)*bs;
      vec3 s=max(texture2D(u_tex,ctr/u_res).rgb,texture2D(u_tex,(ctr+vec2(.3*bs,0.))/u_res).rgb);
      float ink=max(s.r,max(s.g,s.b))-.08;
      if(ink<=0.)continue;
      if(h3>ink*(1.7-.9*fall))continue;
      float tw=.5+.5*sin(u_t*(1.3+h1*2.6)+h2*6.283);
      float r=bs*(.3+.5*h2*h2)*(.6+.4*tw)*(h1>.93?2.2:1.);
      vec2 d=fc-ctr;
      vec3 k=vec3(disc(length(d-dir*sca),r),disc(length(d),r),disc(length(d+dir*sca),r));
      vec3 col=mix(s,prim(s,h1),smoothstep(.4,.9,fall)*.65);
      sp+=k*col*(.55+.75*tw);
    }
  }
  return mix(split,BG+sp,m)+glow*vec3(.85,.92,1.05);
}
void main(){
  vec2 fc=gl_FragCoord.xy;
  vec3 src=texture2D(u_tex,fc/u_res).rgb;
  if(u_style<.5){gl_FragColor=vec4(src,1.);return;}
  float sharp=0.;
  for(int i=0;i<4;i++){vec4 f=u_f[i];if(f.w<=0.)continue;float d=distance(fc,f.xy)/f.z;sharp=max(sharp,f.w*(1.-smoothstep(.55,1.45,d)));}
  float fall=1.-sharp+(h21(floor(fc/(4.*u_dpr)))-.5)*.09;
  if(u_style<1.5){gl_FragColor=vec4(fall<.16?src:blocks(fc,fall),1.);return;}
  gl_FragColor=vec4(min(prismFx(fc,clamp(fall,0.,1.),src),vec3(1.)),1.);
}