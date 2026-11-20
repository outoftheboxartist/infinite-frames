/* Infinite Frames canvas engine.
 * Ported from the Foveated Zoom prototype (claude.ai artifact PfnF7xLT52Wcu6hzNNLWDj): nested
 * 1000x1000 canvases every 8x zoom (floating origin), detail levels by distance from your finger,
 * WebGL prism / blocks edge styles. Changes from the prototype: hooks for live strokes and cursors,
 * and an API for drawing other people's strokes as they arrive.
 */
export function createEngine(hooks = {}) {
/* ---------- constants ---------- */
const LV = 8, CELL = 1000 / LV;          // each canvas splits into 8×8 child canvases; zoom 8× = one level
const MINPX = 16;                         // don't descend into a child canvas smaller than this on screen
const MAXDPR = 2;
const BG = "#0a0a0c", INK = "#f2efe6", RED = "#e3262d", YEL = "#f6cf1a", BLU = "#1f4fd0";
const PRIM = [RED, YEL, BLU];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- seeded randomness ---------- */
function hstr(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

/* ---------- strokes ---------- */
function makeStroke(p, w, c, by){
  const s = {p, w, c, by: by || null, bb: [1e9,1e9,-1e9,-1e9], lod: [], live: false};
  for (let i = 0; i < p.length; i += 2) grow(s, p[i], p[i+1]);
  return s;
}
function grow(s, x, y){const b=s.bb;if(x<b[0])b[0]=x;if(y<b[1])b[1]=y;if(x>b[2])b[2]=x;if(y>b[3])b[3]=y;}
function rdp(p, tol){
  const n = p.length >> 1; if (n < 3) return p;
  const keep = new Uint8Array(n); keep[0] = keep[n-1] = 1;
  const st = [0, n-1], t2 = tol*tol;
  while (st.length){
    const b = st.pop(), a = st.pop();
    const ax=p[2*a], ay=p[2*a+1], dx=p[2*b]-ax, dy=p[2*b+1]-ay, L=dx*dx+dy*dy;
    let md=-1, mi=-1;
    for (let i=a+1;i<b;i++){
      const px=p[2*i]-ax, py=p[2*i+1]-ay;
      let d; if (L===0) d=px*px+py*py; else { const c=px*dy-py*dx; d=c*c/L; }
      if (d>md){md=d;mi=i;}
    }
    if (md>t2){keep[mi]=1; st.push(a,mi,mi,b);}
  }
  const o=[]; for(let i=0;i<n;i++) if(keep[i]) o.push(p[2*i],p[2*i+1]); return o;
}
// level k keeps detail down to 0.15·2^k canvas units; built lazily from the level below it
function lod(s, k){
  if (s.lod[k]) return s.lod[k];
  const base = k === 0 ? s.p : lod(s, k-1);
  return (s.lod[k] = rdp(base, 0.15 * Math.pow(2, k)));
}

/* ---------- procedural seed art, so every canvas has something to find ---------- */
function rosette(r){const cx=330+r()*340,cy=330+r()*340,R=170+r()*230,k=2+Math.floor(r()*7),ph=r()*6.283,N=420,a=[];for(let n=0;n<=N;n++){const t=n/N*6.2832,rr=R*(.55+.45*Math.cos(k*t+ph));a.push(cx+rr*Math.cos(t),cy+rr*Math.sin(t));}return [a];}
function spiral(r){const cx=300+r()*400,cy=300+r()*400,R=160+r()*260,turns=3+r()*4,N=520,dir=r()<.5?1:-1,a=[];for(let n=0;n<=N;n++){const u=n/N,t=dir*turns*6.2832*u;a.push(cx+R*u*Math.cos(t),cy+R*u*Math.sin(t));}return [a];}
function rings(r){const cx=280+r()*440,cy=280+r()*440,R=120+r()*260,m=3+Math.floor(r()*4),out=[];for(let j=1;j<=m;j++){const rr=R*j/m,a=[];for(let n=0;n<=96;n++){const t=n/96*6.2832;a.push(cx+rr*Math.cos(t),cy+rr*Math.sin(t));}out.push(a);}return out;}
function waves(r){const m=2+Math.floor(r()*3),y0=200+r()*300,gap=50+r()*80,A=30+r()*70,f=2+r()*5,ph=r()*6.28,out=[];for(let j=0;j<m;j++){const a=[];for(let n=0;n<=160;n++){const x=60+n/160*880;a.push(x,y0+j*gap+A*Math.sin(x/1000*f*6.2832+ph+j*.6));}out.push(a);}return out;}
function liss(r){const A=1+Math.floor(r()*4),B=A+1+Math.floor(r()*3),R=200+r()*200,ph=r()*3.14,N=600,a=[];for(let n=0;n<=N;n++){const t=n/N*6.2832;a.push(500+R*Math.sin(A*t+ph),500+R*Math.sin(B*t));}return [a];}
const PATTERNS=[rosette,spiral,rings,waves,liss];
function seedArt(node, r){
  const count = node.depth === 0 ? 3 : 2;
  for (let k=0;k<count;k++){
    const pat = node.depth === 0 && k === 0 ? rosette : PATTERNS[Math.floor(r()*PATTERNS.length)];
    const col = k === 0 || r() < .5 ? INK : PRIM[Math.floor(r()*3)];
    const w = 3 + r()*4;
    for (const pts of pat(r)) node.strokes.push(makeStroke(pts, w, col, null));
  }
}

/* ---------- nested canvases (the floating origin) ---------- */
class Node{
  constructor(parent, i, j){
    this.parent=parent; this.i=i; this.j=j; this.depth=parent?parent.depth+1:0;
    this.id=parent?parent.id+"/"+i+","+j:"root";
    this.strokes=[]; this.kids=new Map();
    const r=rng(hstr(this.id));
    const keys=new Set(); const n=4+Math.floor(r()*4);
    if (!parent){keys.add(3*LV+3);keys.add(4*LV+4);}
    while(keys.size<n) keys.add(Math.floor(r()*LV)*LV+Math.floor(r()*LV));
    this.keys=[...keys];
    seedArt(this, r);
  }
  kid(i,j){
    const k=i*LV+j; let c=this.kids.get(k);
    if(!c){c=new Node(this,i,j);this.kids.set(k,c);if(!this.keys.includes(k))this.keys.push(k);}
    return c;
  }
}
const ROOT = new Node(null,0,0);

// map node coords -> ancestor coords:  P = o + s·p
function toAnc(n, anc){let ox=0,oy=0,s=1;while(n!==anc){ox=n.i*CELL+ox/LV;oy=n.j*CELL+oy/LV;s/=LV;n=n.parent;}return{ox,oy,s};}
// map any node's coords into the current canvas's coords
function rel(n){
  let a=n, b=cur;
  while(a.depth>b.depth)a=a.parent; while(b.depth>a.depth)b=b.parent;
  while(a!==b){a=a.parent;b=b.parent;}
  const A=toAnc(n,a), C=toAnc(cur,a);
  return {ox:(A.ox-C.ox)/C.s, oy:(A.oy-C.oy)/C.s, s:A.s/C.s};
}

/* ---------- view state ---------- */
const stage=document.getElementById("stage"), c2d=document.getElementById("c2d"), cgl=document.getElementById("cgl");
const g2=c2d.getContext("2d",{alpha:false});
let W=0,H=0,dpr=1,fit=1;
let cur=ROOT; const cam={x:0,y:0}; let scale=1;         // screen = cam + scale·p  (p in cur's 0–1000 coords)
let dirty=true, style=2, mode="move", ink=INK, glS=1;
const STYLES=["Off","Blocks","Prism"];
let lastInk=null;
const focus={x:0,y:0,tx:0,ty:0,lastX:-1e9,lastY:-1e9};
let focusR=200;

function resize(){
  const ow=W, oh=H;
  W=innerWidth; H=innerHeight; dpr=Math.min(devicePixelRatio||1,MAXDPR);
  c2d.width=Math.round(W*dpr); c2d.height=Math.round(H*dpr);
  if(!ow) glS=dpr; sizeGL();
  fit=Math.min(W,H)/1000; focusR=Math.max(120,.36*Math.min(W,H));
  if(!ow){home();focus.x=focus.tx=W/2;focus.y=focus.ty=H/2;}
  else {cam.x+=(W-ow)/2;cam.y+=(H-oh)/2;}
  dirty=true;
}
function sizeGL(){cgl.width=Math.round(W*glS);cgl.height=Math.round(H*glS);}
function home(){cur=ROOT;scale=fit*.92;cam.x=W/2-500*scale;cam.y=H/2-500*scale;dirty=true;}

function zoomAt(px,py,f){
  const min=fit*.35; if(cur===ROOT&&scale*f<min)f=min/scale;
  cam.x=px-(px-cam.x)*f; cam.y=py-(py-cam.y)*f; scale*=f; dirty=true; normalize();
}
function pan(dx,dy){cam.x+=dx;cam.y+=dy;dirty=true;normalize();}

// Re-root: keep the current canvas between 0.9× and 8× of "fits the screen".
function normalize(){
  if(drawing) return;
  for(let guard=0;guard<24;guard++){
    const px=(W/2-cam.x)/scale, py=(H/2-cam.y)/scale;
    const outside = px<0||py<0||px>=1000||py>=1000;
    if((scale<fit*.9||outside)&&cur.parent){
      const i=cur.i,j=cur.j; scale*=LV;
      cam.x-=i*CELL*scale; cam.y-=j*CELL*scale; cur=cur.parent; continue;
    }
    if(scale>fit*LV&&!outside){
      const i=Math.min(LV-1,Math.max(0,Math.floor(px/CELL))), j=Math.min(LV-1,Math.max(0,Math.floor(py/CELL)));
      cam.x+=i*CELL*scale; cam.y+=j*CELL*scale; scale/=LV; cur=cur.kid(i,j); continue;
    }
    break;
  }
}

/* ---------- 2D render: only visible canvases, only visible strokes, detail by distance from focus ---------- */
const stats={nodes:0,drawn:0,culled:0,pts:0,ms:0};
function smooth(a,b,x){const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);}
function render(){
  const t0=performance.now();
  stats.nodes=stats.drawn=stats.culled=stats.pts=0;
  g2.setTransform(1,0,0,1,0,0); g2.fillStyle=BG; g2.fillRect(0,0,c2d.width,c2d.height);
  g2.lineCap="round"; g2.lineJoin="round";
  let top=cur; for(let k=0;k<2&&top.parent;k++) top=top.parent;   // draw from two levels up so neighbours show at the edges
  const T=rel(top); drawNode(top,T.ox,T.oy,T.s);
  stats.ms=performance.now()-t0;
  focus.lastX=focus.x; focus.lastY=focus.y;
}
function drawNode(n,ox,oy,s){
  const a=scale*s, bx=cam.x+scale*ox, by=cam.y+scale*oy, size=a*1000;
  if(bx>W||by>H||bx+size<0||by+size<0) return;
  stats.nodes++;
  for(const st of n.strokes){
    const b=st.bb, x0=bx+a*b[0]-20, y0=by+a*b[1]-20, x1=bx+a*b[2]+20, y1=by+a*b[3]+20;
    if(x0>W||y0>H||x1<0||y1<0||(x1-x0<44&&y1-y0<44)){stats.culled++;continue;}
    let tolPx=.45;
    if(style>0){
      const dx=Math.max(x0-focus.x,0,focus.x-x1), dy=Math.max(y0-focus.y,0,focus.y-y1);
      tolPx=.45+5*smooth(.6,1.8,Math.hypot(dx,dy)/focusR);
    }
    let k=Math.floor(Math.log2(tolPx/a/.15)); k=k<0?0:k>16?16:k;
    const p=st.live?st.p:lod(st,k);
    const wpx=st.w*a, lw=wpx<8?Math.max(wpx,.7):8+3*Math.log2(wpx/8);
    g2.setTransform(dpr*a,0,0,dpr*a,dpr*bx,dpr*by);
    g2.lineWidth=lw/a; g2.strokeStyle=st.c;
    g2.beginPath(); g2.moveTo(p[0],p[1]);
    if(p.length<=4){g2.lineTo((p.length>2?p[2]:p[0])+.01/a,p.length>2?p[3]:p[1]);}
    else{for(let i=2;i<p.length-2;i+=2)g2.quadraticCurveTo(p[i],p[i+1],(p[i]+p[i+2])/2,(p[i+1]+p[i+3])/2);g2.lineTo(p[p.length-2],p[p.length-1]);}
    g2.stroke();
    stats.drawn++; stats.pts+=p.length>>1;
  }
  const kidPx=a*CELL; if(kidPx<MINPX) return;
  for(const key of n.keys){
    const i=(key/LV)|0, j=key%LV, cx=bx+a*i*CELL, cy=by+a*j*CELL;
    if(cx>W||cy>H||cx+kidPx<0||cy+kidPx<0) continue;
    drawNode(n.kid(i,j),ox+s*i*CELL,oy+s*j*CELL,s/LV);
  }
}

/* ---------- WebGL pass: foveated edges (prism sparkle, or dithered blocks) ---------- */
const FS=`
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
}`;
const VS="attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
let gl=null, U={}, tex=null, gtex=null;
const gMid=document.createElement("canvas"), gSm=document.createElement("canvas");
const gMidC=gMid.getContext("2d"), gSmC=gSm.getContext("2d");
function initGL(){
  try{gl=cgl.getContext("webgl",{antialias:false,alpha:false,premultipliedAlpha:false,powerPreference:"high-performance"});}catch(e){gl=null;}
  if(!gl){stage.classList.add("nogl");return;}
  const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o;};
  try{
    const pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,VS));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(pr,"p");gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    for(const n of["u_tex","u_glow","u_gt","u_res","u_f","u_t","u_style","u_dpr"])U[n]=gl.getUniformLocation(pr,n);
    tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.uniform1i(U.u_tex,0);
    gtex=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,gtex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.u_glow,1);gl.activeTexture(gl.TEXTURE0);
  }catch(e){console.warn("WebGL off:",e);gl=null;stage.classList.add("nogl");}
}
const foci=new Float32Array(16);
function drawGL(t){
  if(!gl) return;
  gl.viewport(0,0,cgl.width,cgl.height);
  gl.uniform2f(U.u_res,cgl.width,cgl.height);
  gl.uniform4fv(U.u_f,foci);
  gl.uniform2f(U.u_gt,1/Math.max(1,gSm.width),1/Math.max(1,gSm.height));
  gl.uniform1f(U.u_t,reduceMotion?0:t/1000);
  gl.uniform1f(U.u_style,style);
  gl.uniform1f(U.u_dpr,glS);
  gl.drawArrays(gl.TRIANGLES,0,3);
}
function upload(){
  if(!gl) return;
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c2d);
  if(style===2){
    const mw=Math.max(1,Math.ceil(W/3)), mh=Math.max(1,Math.ceil(H/3)), sw=Math.max(1,Math.ceil(W/6)), sh=Math.max(1,Math.ceil(H/6));
    if(gMid.width!==mw||gMid.height!==mh){gMid.width=mw;gMid.height=mh;}
    if(gSm.width!==sw||gSm.height!==sh){gSm.width=sw;gSm.height=sh;}
    gMidC.imageSmoothingQuality="high"; gSmC.imageSmoothingQuality="high";
    gMidC.drawImage(c2d,0,0,mw,mh); gSmC.drawImage(gMid,0,0,sw,sh);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,gtex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,gSm);
    gl.activeTexture(gl.TEXTURE0);
  }
}

/* ---------- simulated collaborators ---------- */
const cursorsEl=document.getElementById("cursors");
const SIM_COLLAB=false;   // no collaborators yet: solo mode
const bots=(SIM_COLLAB?[
  {name:"Ana", c:RED, role:"with you"},
  {name:"Kofi",c:YEL, role:"below you"},
  {name:"Mei", c:BLU, role:"around you"},
]:[]).map((b,k)=>{
  const r=rng(77+k*991);
  const el=document.createElement("div");el.className="cur";el.innerHTML=`<i style="background:${b.c}"></i><span>${b.name}</span>`;cursorsEl.appendChild(el);
  return Object.assign(b,{r,el,node:k===1?ROOT.kid(4,3):ROOT,x:300+r()*400,y:300+r()*400,h:r()*6.28,drawing:false,st:null,timer:r()*1.5,hop:6+r()*6,last:-1e9,sx:-99,sy:-99,vis:false,glow:0});
});
function hopBot(b){
  endBotStroke(b);
  if(b.role==="with you") b.node=cur;
  else if(b.role==="below you"){
    const vis=[];
    for(const key of cur.keys){const i=(key/LV)|0,j=key%LV,x=cam.x+scale*i*CELL,y=cam.y+scale*j*CELL,s=scale*CELL;if(x>-s*.2&&y>60&&x+s<W+s*.2&&y+s<H-80)vis.push([i,j]);}
    const pick=vis.length?vis[Math.floor(b.r()*vis.length)]:[Math.floor(b.r()*LV),Math.floor(b.r()*LV)];
    b.node=cur.kid(pick[0],pick[1]);
  } else b.node=cur.parent||cur.kid(Math.floor(b.r()*LV),Math.floor(b.r()*LV));
  b.x=250+b.r()*500; b.y=250+b.r()*500; b.hop=7+b.r()*8;
}
function endBotStroke(b){if(b.st){b.st.live=false;b.st.lod=[];b.st=null;}b.drawing=false;}
function updateBot(b,dt,now){
  b.hop-=dt; if(b.hop<0) hopBot(b);
  const r=b.r;
  b.h+=(Math.sin(now*.0009*(1+b.name.length*.1))*1.6+(r()-.5)*2)*dt;
  const toC=Math.atan2(500-b.y,500-b.x), edge=Math.max(Math.abs(b.x-500),Math.abs(b.y-500));
  if(edge>330){let d=toC-b.h;d=Math.atan2(Math.sin(d),Math.cos(d));b.h+=d*Math.min(1,dt*3);}
  const sp=b.drawing?210:320;
  b.x+=Math.cos(b.h)*sp*dt; b.y+=Math.sin(b.h)*sp*dt;
  b.timer-=dt;
  if(b.drawing){
    const p=b.st.p, lx=p[p.length-2], ly=p[p.length-1];
    if(Math.hypot(b.x-lx,b.y-ly)>3){p.push(b.x,b.y);grow(b.st,b.x,b.y);}
    b.last=now;
    if(b.timer<0){endBotStroke(b);b.timer=.6+r()*1.4;}
  } else if(b.timer<0){
    const st=makeStroke([b.x,b.y],4+r()*3,r()<.7?b.c:INK,b.name);st.live=true;
    const n=b.node; n.strokes.push(st);
    const mine=n.strokes.filter(s=>s.by===b.name); if(mine.length>70) n.strokes.splice(n.strokes.indexOf(mine[0]),1);
    b.st=st; b.drawing=true; b.timer=1.4+r()*2.6;
  }
  const T=rel(b.node);
  b.sx=cam.x+scale*(T.ox+T.s*b.x); b.sy=cam.y+scale*(T.oy+T.s*b.y); b.size=scale*T.s*1000;
  b.vis=b.sx>-20&&b.sy>-20&&b.sx<W+20&&b.sy<H+20&&b.size>MINPX*2;
  if(b.vis&&b.drawing) dirty=true;
  const active=now-b.last<1500?1:0; b.glow+=(active-b.glow)*Math.min(1,dt*2.5);
}

/* ---------- input ---------- */
const ptrs=new Map(); let drawing=null, panning=false, vel={x:0,y:0}, lastMove=0, hoverAt=-1e9, pinch=null;
const toCur=(x,y)=>[(x-cam.x)/scale,(y-cam.y)/scale];
function startStroke(x,y){const [px,py]=toCur(x,y);drawing=makeStroke([px,py],4/scale,ink,"you");drawing.live=true;drawing.sid=newSid();cur.strokes.push(drawing);dirty=true;hooks.start&&hooks.start({sid:drawing.sid,node:cur.id,c:ink,w:4/scale,p:[px,py]});}
function endStroke(){if(!drawing)return;hooks.end&&hooks.end(drawing.sid);{const q=drawing.p;lastInk={node:cur,x:q[q.length-2],y:q[q.length-1],t:performance.now()};}drawing.live=false;drawing.lod=[];drawing=null;dirty=true;normalize();}
stage.addEventListener("pointerdown",e=>{
  stage.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  vel.x=vel.y=0; hideHint();
  if(ptrs.size===2){
    if(drawing){const n=drawing.p.length;endStroke();if(n<8){const s=cur.strokes;s.splice(s.length-1,1);}}
    const [a,b]=[...ptrs.values()]; pinch={d:Math.hypot(a.x-b.x,a.y-b.y),x:(a.x+b.x)/2,y:(a.y+b.y)/2}; panning=false;
  } else if(ptrs.size===1){
    const wantsPan=mode==="move"||e.button===1||e.button===2;
    if(wantsPan) panning=true; else startStroke(e.clientX,e.clientY);
  }
  focus.tx=e.clientX; focus.ty=e.clientY;
});
stage.addEventListener("pointermove",e=>{
  const now=performance.now();
  if(hooks.cursor){const [cx0,cy0]=toCur(e.clientX,e.clientY);hooks.cursor(cur.id,cx0,cy0);}
  if(!ptrs.has(e.pointerId)){ if(e.pointerType==="mouse"){focus.tx=e.clientX;focus.ty=e.clientY;hoverAt=now;} return; }
  const p=ptrs.get(e.pointerId), dx=e.clientX-p.x, dy=e.clientY-p.y; p.x=e.clientX; p.y=e.clientY;
  if(ptrs.size>=2&&pinch){
    const [a,b]=[...ptrs.values()], d=Math.hypot(a.x-b.x,a.y-b.y), mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
    pan(mx-pinch.x,my-pinch.y); if(pinch.d>0&&d>0) zoomAt(mx,my,d/pinch.d);
    pinch={d,x:mx,y:my}; focus.tx=mx; focus.ty=my;
  } else if(drawing){
    const [px,py]=toCur(e.clientX,e.clientY), q=drawing.p;
    if(Math.hypot((px-q[q.length-2])*scale,(py-q[q.length-1])*scale)>1.5){q.push(px,py);grow(drawing,px,py);dirty=true;hooks.point&&hooks.point(drawing.sid,px,py);}
    focus.tx=e.clientX; focus.ty=e.clientY;
  } else if(panning){
    pan(dx,dy); const dtm=Math.max(1,now-lastMove);
    vel.x=vel.x*.6+.4*dx/dtm; vel.y=vel.y*.6+.4*dy/dtm;
    // look ahead: new content enters from the side opposite the drag
    focus.tx=Math.min(W,Math.max(0,e.clientX-vel.x*260)); focus.ty=Math.min(H,Math.max(0,e.clientY-vel.y*260));
  }
  lastMove=now; hoverAt=now;
});
function up(e){
  if(!ptrs.has(e.pointerId))return;
  ptrs.delete(e.pointerId);
  if(ptrs.size<2) pinch=null;
  if(ptrs.size===0){ if(drawing)endStroke(); if(performance.now()-lastMove>80){vel.x=vel.y=0;} panning=false; hoverAt=performance.now(); }
  else if(ptrs.size===1&&mode==="move") panning=true;
}
stage.addEventListener("pointerup",up); stage.addEventListener("pointercancel",up);
stage.addEventListener("pointerleave",e=>{if(e.pointerType==="mouse"&&!ptrs.size)hoverAt=-1e9;});
stage.addEventListener("contextmenu",e=>e.preventDefault());
stage.addEventListener("wheel",e=>{e.preventDefault();hideHint();const k=e.ctrlKey?.01:.0015;zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*k));focus.tx=e.clientX;focus.ty=e.clientY;hoverAt=performance.now();},{passive:false});
for(const ev of["gesturestart","gesturechange"])document.addEventListener(ev,e=>e.preventDefault());

/* ---------- toolbar ---------- */
const $=id=>document.getElementById(id);
function setMode(m){mode=m;$("mMove").setAttribute("aria-pressed",m==="move");$("mDraw").setAttribute("aria-pressed",m==="draw");$("sw").classList.toggle("off",m!=="draw");}
$("mMove").onclick=()=>setMode("move"); $("mDraw").onclick=()=>setMode("draw");
for(const b of $("sw").querySelectorAll("button")) b.onclick=()=>{ink=b.dataset.c;for(const o of $("sw").querySelectorAll("button"))o.setAttribute("aria-pressed",o===b);setMode("draw");};
function setStyle(v){style=v;if(v===2)dirty=true;const b=$("bDither");b.textContent=STYLES[v];b.setAttribute("aria-pressed",v>0);$("focus").hidden=!v;dirty=true;}
$("bDither").onclick=()=>setStyle((style+2)%3);
$("bHome").onclick=home;
addEventListener("keydown",e=>{if(e.target.tagName==="INPUT")return;const k=e.key.toLowerCase();if(k==="d")setStyle((style+2)%3);else if(k==="h")home();else if(k==="m")setMode(mode==="move"?"draw":"move");});
let hintHidden=false; function hideHint(){if(hintHidden)return;hintHidden=true;setTimeout(()=>{$("hint").style.opacity="0";},5000);}

/* ---------- HUD ---------- */
function fmtMag(m){if(m<1000)return m.toFixed(m<10?1:0);const u=["K","M","G","T","P","E"];let i=-1;while(m>=1000&&i<u.length-1){m/=1000;i++;}return m.toFixed(m<10?1:0)+u[i];}
let fps=60, hudT=0;
function hud(now){
  if(now-hudT<250)return; hudT=now;
  $("depth").textContent=cur.depth;
  const inLevel=scale/fit, mag=Math.pow(LV,cur.depth)*inLevel;
  $("mag").textContent=`×${fmtMag(mag)} total · ${inLevel.toFixed(2)} of 8×`;
  const parts=cur.id.split("/"); $("crumb").textContent=(parts.length>4?"… / ":"")+parts.slice(-4).join(" / ");
  $("perf").textContent=`${Math.round(fps)} fps · ${stats.ms.toFixed(1)} ms · ${stats.drawn} curves · ${stats.nodes} canvases`;
  $("people").innerHTML=bots.map(b=>`<div class="chip"><i style="background:${b.c}"></i><b>${b.name}</b> ${b.node===cur?"here":b.node.depth>cur.depth?"below":"above"}</div>`).join("");
}

/* ---------- main loop ---------- */
let last=performance.now(), qT=performance.now();
function frame(now){
  const dt=Math.min(.05,(now-last)/1000); last=now; fps=fps*.92+.08/Math.max(dt,1e-3);
  // fling
  if(!ptrs.size&&(Math.abs(vel.x)+Math.abs(vel.y))>.01){pan(vel.x*dt*1000,vel.y*dt*1000);const k=Math.exp(-dt*1000/280);vel.x*=k;vel.y*=k;}
  for(const b of bots) updateBot(b,dt,now);
  // focus: follow the finger; when idle, drift to whoever is drawing, else back to centre
  const engaged=ptrs.size>0||now-hoverAt<1200||(Math.abs(vel.x)+Math.abs(vel.y))>.05;
  let rate=14;
  if(!engaged){
    let best=null; for(const b of bots) if(b.vis&&b.glow>.3&&(!best||b.last>best.last)) best=b;
    if(best){focus.tx=best.sx;focus.ty=best.sy;}
    else if(lastInk&&now-lastInk.t<8000){const T=rel(lastInk.node);focus.tx=cam.x+scale*(T.ox+T.s*lastInk.x);focus.ty=cam.y+scale*(T.oy+T.s*lastInk.y);}
    else {const m=.22*Math.min(W,H),u=reduceMotion?0:now/1000;focus.tx=W/2+m*Math.sin(u*.13);focus.ty=H/2+m*Math.sin(u*.17+1.3);}
    rate=.7;
  }
  const k=1-Math.exp(-dt*rate); focus.x+=(focus.tx-focus.x)*k; focus.y+=(focus.ty-focus.y)*k;
  if(style>0&&Math.hypot(focus.x-focus.lastX,focus.y-focus.lastY)>28) dirty=true;
  // shader foci: you (big window) + up to 3 collaborators (small windows)
  foci.fill(0);
  foci[0]=focus.x*glS; foci[1]=(H-focus.y)*glS; foci[2]=focusR*glS; foci[3]=1;
  let fi=1; for(const b of bots){ if(fi>3)break; if(!b.vis||b.glow<.02)continue; const o=fi*4; foci[o]=b.sx*glS; foci[o+1]=(H-b.sy)*glS; foci[o+2]=Math.max(40,Math.min(.16*Math.min(W,H),b.size*.25))*glS; foci[o+3]=b.glow; fi++; }
  if(now-qT>2500){qT=now;if(fps<40&&glS>1){glS=Math.max(1,glS*.67);sizeGL();}}
  if(dirty){dirty=false;render();upload();}
  drawGL(now);
  $("focus").style.transform=`translate(${focus.x}px,${focus.y}px)`;
  for(const b of bots){b.el.style.display=b.vis?"flex":"none";if(b.vis)b.el.style.transform=`translate(${b.sx-4}px,${b.sy-4}px)`;}
  hud(now);
  requestAnimationFrame(frame);
}
addEventListener("resize",resize);
resize(); initGL(); requestAnimationFrame(frame);
window.__fz={get cur(){return cur},get scale(){return scale},stats,zoomAt,pan,home,get W(){return W},get H(){return H}};

/* ---------- live collaboration API (used by live.js) ---------- */
function newSid(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36);}
const remote=new Map();
const okColor=c=>typeof c==="string"&&/^#[0-9a-fA-F]{6}$/.test(c);
const okNum=v=>typeof v==="number"&&isFinite(v)&&Math.abs(v)<1e6;
function nodeById(id){
  if(typeof id!=="string"||id.length>400)return null;
  const parts=id.split("/"); if(parts[0]!=="root")return null;
  let n=ROOT;
  for(let k=1;k<parts.length;k++){const ij=parts[k].split(",").map(Number);if(!(ij[0]>=0&&ij[0]<LV&&ij[1]>=0&&ij[1]<LV))return null;n=n.kid(ij[0],ij[1]);}
  return n;
}
function remoteStart(m){
  if(!m||typeof m.sid!=="string"||!okColor(m.c)||!okNum(m.w)||!Array.isArray(m.p)||m.p.length<2||!okNum(m.p[0])||!okNum(m.p[1]))return;
  const n=nodeById(m.node); if(!n)return;
  const st=makeStroke([m.p[0],m.p[1]],m.w,m.c,String(m.by||"peer").slice(0,40)); st.live=true;
  n.strokes.push(st); remote.set(m.sid,st); dirty=true;
}
function remotePoints(sid,pts){
  const st=remote.get(sid); if(!st||!Array.isArray(pts))return;
  for(let i=0;i+1<pts.length&&st.p.length<40000;i+=2){if(!okNum(pts[i])||!okNum(pts[i+1]))continue;st.p.push(pts[i],pts[i+1]);grow(st,pts[i],pts[i+1]);}
  dirty=true;
}
function remoteEnd(sid){const st=remote.get(sid);if(!st)return;st.live=false;st.lod=[];remote.delete(sid);dirty=true;}
function toScreen(id,x,y){const n=nodeById(id);if(!n||!okNum(x)||!okNum(y))return null;const T=rel(n);return{x:cam.x+scale*(T.ox+T.s*x),y:cam.y+scale*(T.oy+T.s*y),size:scale*T.s*1000};}
function setInk(c){if(okColor(c))ink=c;}
return {remoteStart,remotePoints,remoteEnd,toScreen,setInk,get node(){return cur.id;}};
}
