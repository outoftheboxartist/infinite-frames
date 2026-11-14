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
    let drawn=0;
    for(const id of ids){
      const node=this.scene.byId.get(id);
      if(!node)continue;
      const path=this.scene.path(id);
      if(!path)continue;
      ctx.save();
      const parents=this.scene.lineage(id).slice(1).reverse();
      for(const pid of parents){const ancestor=this.scene.path(pid);if(ancestor)ctx.clip(ancestor)}
      const isRelated=this.scene.related(id,selectedId);
      ctx.globalAlpha=selectedId&&!isRelated?.19:1;
      ctx.fillStyle=node.color;
      ctx.fill(path);
      ctx.strokeStyle=node.depth===0?"#b6c4d633":"#ffffff2c";
      ctx.lineWidth=(node.depth<3?1:.6)*this.dpr/s;
      ctx.stroke(path);
      ctx.restore(); drawn++;
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
    return { drawn, ms: +(performance.now()-t).toFixed(1) };
  }
  pick(x,y,camera,ids){
    const p=this.screenToWorld(x,y,camera),ctx=this.ctx;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    try {
      for(let j=ids.length-1;j>=0;j--){
        const n=this.scene.byId.get(ids[j]);if(!n)continue;
        const b=n.bbox;if(p.x<b.minX||p.x>b.maxX||p.y<b.minY||p.y>b.maxY)continue;
        if(!ctx.isPointInPath(this.scene.path(n.id),p.x,p.y))continue;
        // Selection honors all ancestor clipping masks, even outside original curve bounds.
        let valid=true;for(const parentId of this.scene.lineage(n.id).slice(1)) {
          if(!ctx.isPointInPath(this.scene.path(parentId),p.x,p.y)){valid=false;break}
        }
        if(valid)return n.id;
      }
      return null;
    } finally {ctx.restore()}
  }
}
