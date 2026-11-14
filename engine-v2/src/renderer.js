export const worldWidthAtZoom = z => 1100 / z;
export function viewRect(camera, width, height) {
  const w = worldWidthAtZoom(camera.z), h = w * height / width;
  return { minX:camera.x-w/2, maxX:camera.x+w/2, minY:camera.y-h/2, maxY:camera.y+h/2 };
}
export class CanvasRenderer {
  constructor(canvas, scene) {
    this.canvas = canvas; this.scene = scene;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.cssWidth = 1; this.cssHeight = 1; this.dpr = 1;
  }
  resize() {
    const box = this.canvas.getBoundingClientRect();
    this.cssWidth = Math.max(1,box.width); this.cssHeight = Math.max(1,box.height);
    this.dpr = Math.min(2, window.devicePixelRatio||1);
    this.canvas.width = Math.round(this.cssWidth*this.dpr);
    this.canvas.height = Math.round(this.cssHeight*this.dpr);
  }
  scale(camera) { return this.cssWidth * camera.z / 1100; }
  screenToWorld(x,y,camera) {
    const s = this.scale(camera);
    return { x:camera.x+(x-this.cssWidth/2)/s, y:camera.y+(y-this.cssHeight/2)/s };
  }
  render(camera, ids, selectedId) {
    const t = performance.now(), ctx=this.ctx, s=this.scale(camera)*this.dpr;
    const w=this.canvas.width,h=this.canvas.height;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle="#07090e";ctx.fillRect(0,0,w,h);
    // Screen-space reference stars: cheap, consistent, and independent of curve count.
    ctx.fillStyle="#ffffff26";
    for(let i=0;i<42;i++){const x=((i*97.27)%1000)/1000*w,y=((i*61.13+37)%1000)/1000*h;ctx.fillRect(x,y,1.1*this.dpr,1.1*this.dpr)}
    ctx.setTransform(s,0,0,s,w/2-camera.x*s,h/2-camera.y*s);
    let drawn=0,unavailable=0;
    for(const id of ids) {
      const node=this.scene.byId.get(id);
      if(!node)continue;
      const art=node.artwork;
      const type=art?.type;
      if(node.kind==="boundary"&&!node.path)continue;
      ctx.save();
      // Paint geometry in the actual world coordinate system, inside ancestor boundaries.
      const parents=this.scene.lineage(id).slice(1).reverse();
      for(const pid of parents){
        const ancestor=this.scene.path(pid);
        if(ancestor)ctx.clip(ancestor,"evenodd");
      }
      const isRelated=this.scene.related(id,selectedId);
      ctx.globalAlpha=(selectedId&&!isRelated)?0.19:1;
      let didDraw=false;
      if(node.kind==="boundary"){
        const path=this.scene.path(id);
        if(path){
          ctx.fillStyle=node.color;ctx.fill(path,"evenodd");
          ctx.strokeStyle=node.depth===0?"#b6c4d633":"#ffffff2c";
          ctx.lineWidth=(node.depth<3?1:.6)*this.dpr/s;
          ctx.stroke(path);
          didDraw=true;
        }
      }else if(art){
        const transform=art.t||{x:0,y:0,s:1,r:0};
        const cx=Number.isFinite(art.cx)?art.cx:0,cy=Number.isFinite(art.cy)?art.cy:0;
        ctx.translate(cx+(transform.x||0),cy+(transform.y||0));
        ctx.rotate((transform.r||0)*Math.PI/180);
        ctx.scale(transform.s||1,transform.s||1);
        ctx.translate(-cx,-cy);
        if(type==="vector"){
          for(let j=0;j<(art.paths||[]).length;j++){
            const p=this.scene.path(id,j);
            if(!p)continue;
            ctx.fillStyle=art.paths[j].color||node.color;
            ctx.fill(p,"evenodd");
            didDraw=true;
          }
        }else if(type==="stroke"){
          const p=this.scene.path(id);
          if(p){
            ctx.strokeStyle=art.color||node.color;
            ctx.lineWidth=Math.max(.000001,art.w||1);
            ctx.lineCap="round";ctx.lineJoin="round";
            ctx.stroke(p);didDraw=true;
          }
        }else if(type==="image"){
          const image=this.scene.image(id);
          if(image&&Number.isFinite(art.x)&&Number.isFinite(art.y)&&art.w>0&&art.h>0) {
            ctx.drawImage(image,art.x,art.y,art.w,art.h);didDraw=true;
          }else if(this.scene.imageStatus(id)==="unavailable")unavailable++;
        }else unavailable++;
      }
      ctx.restore();
      if(didDraw)drawn++;
    }
    if(selectedId){
      const target=this.scene.path(selectedId);
      if(target){
        ctx.save();
        ctx.strokeStyle="#fbfcff";ctx.shadowColor="#87dfed";ctx.shadowBlur=16*this.dpr;
        ctx.lineWidth=2.2*this.dpr/s;
        ctx.stroke(target);ctx.restore();
      }
    }
    return { drawn, unavailable, ms: +(performance.now()-t).toFixed(1) };
  }
  pick(x,y,camera,ids){
    const p=this.screenToWorld(x,y,camera),ctx=this.ctx;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    try {
      for(let j=ids.length-1;j>=0;j--){
        const n=this.scene.byId.get(ids[j]);if(!n||n.kind!=="boundary")continue;
        const b=n.bbox;if(p.x<b.minX||p.x>b.maxX||p.y<b.minY||p.y>b.maxY)continue;
        const path=this.scene.path(n.id);if(!path||!ctx.isPointInPath(path,p.x,p.y,"evenodd"))continue;
        // Selection honors all ancestor clipping masks, even outside original curve bounds.
        let valid=true;for(const parentId of this.scene.lineage(n.id).slice(1)) {
          const parentPath=this.scene.path(parentId);if(parentPath&&!ctx.isPointInPath(parentPath,p.x,p.y,"evenodd")){valid=false;break}
        }
        if(valid)return n.id;
      }
      return null;
    } finally {ctx.restore()}
  }
}
