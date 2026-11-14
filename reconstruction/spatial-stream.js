/* Infinite Frames Spatial Stream v1
   Full SVG paths remain in geometry object store. This module indexes metadata
   into a hierarchical tile grid and retrieves only visible/nearby paths.
   Frame images are *derived previews*, never replacements for original paths. */
(function(root){
"use strict";
if(!root.IFSpatial)return;
const S=root.IFSpatial,Store=S.Store,MAX_LEVEL=9;
const tileKey=(type,frame,level,x,y)=>(type==="boundary"?"b":"i"+frame)+":"+level+":"+x+":"+y;
function tileEntries(meta){
  const b=meta.bbox||{x:0,y:0,w:1000,h:1000},size=Math.max(.001,Number(b.w)||.001,Number(b.h)||.001);
  let level=Math.max(0,Math.min(MAX_LEVEL,Math.floor(Math.log2(1000/size))));
  // A bounding box may cross an internal cell boundary. Index into at most 4 cells.
  let cell=1000/2**level,x0=Math.floor(b.x/cell),y0=Math.floor(b.y/cell),
      x1=Math.floor((b.x+b.w-1e-8)/cell),y1=Math.floor((b.y+b.h-1e-8)/cell);
  while((x1-x0>1||y1-y0>1)&&level>0){
    level--;cell=1000/2**level;
    x0=Math.floor(b.x/cell);y0=Math.floor(b.y/cell);
    x1=Math.floor((b.x+b.w-1e-8)/cell);y1=Math.floor((b.y+b.h-1e-8)/cell);
  }
  const out=[];
  for(let x=x0;x<=x1&&x<x0+3;x++)for(let y=y0;y<=y1&&y<y0+3;y++){
    const t=tileKey(meta.recordType,meta.frameN||1,level,x,y);
    out.push({id:t+"|"+meta.key,tileKey:t,recordKey:meta.key});
  }
  return out;
}
function viewport(view,padding=.45){
  const z=Math.max(1,Math.min(256,view.z||1)),width=1000/z,extra=width*padding;
  return {x:view.x-width/2-extra,y:view.y-width/2-extra,w:width+2*extra,h:width+2*extra};
}
function tileKeys(rect,frameNs,zoom,budget=320){
  const out=[],z=Math.max(1,zoom||1),max=Math.min(MAX_LEVEL,Math.max(0,Math.floor(Math.log2(z*8)))),
        prefixes=["b",...new Set(frameNs||[1])].map(n=>typeof n==="number"?"i"+n:n);
  for(let level=0;level<=max;level++){
    const size=1000/2**level;
    let x0=Math.floor(rect.x/size),x1=Math.floor((rect.x+rect.w)/size),y0=Math.floor(rect.y/size),y1=Math.floor((rect.y+rect.h)/size);
    const cells=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);
    if(cells*prefixes.length>Math.max(0,budget-out.length))break;
    for(const prefix of prefixes)for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)out.push(prefix+":"+level+":"+x+":"+y);
  }
  return out;
}
const idb=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error("IndexedDB request failed"))});
const complete=t=>new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onerror=()=>reject(t.error||Error("Transaction failed"));t.onabort=()=>reject(t.error||Error("Transaction aborted"))});
Store.prototype.loadShell=async function(){
  const state=await this.state();if(!state)return null;
  this.meta=state;
  return {...state,boundaries:[],items:[],spatialStreaming:true};
};
Store.prototype.visibleMetadata=async function(view,options={}){
  await this.open();const frames=options.frameNs||[options.frameN||1];
  const rect=viewport(view,options.padding??.45),keys=tileKeys(rect,frames,view.z,options.tileBudget||320);
  if(!keys.length)return[];
  const t=this.db.transaction(["tiles"],"readonly"),idx=t.objectStore("tiles").index("by_tile");
  const lists=await Promise.all(keys.map(key=>idb(idx.getAll(key))));
  const metaKeys=[...new Set(lists.flat().map(x=>x.recordKey))];
  if(!metaKeys.length)return[];
  const mt=this.db.transaction(["records"],"readonly"),records=mt.objectStore("records");
  const metadata=(await Promise.all(metaKeys.map(key=>idb(records.get(key))))).filter(Boolean);
  const allowed=new Set(frames);
  const intersect=S.intersects;
  return metadata.filter(m=>(m.recordType==="boundary"||allowed.has(m.frameN))&&intersect(m.bbox,rect))
    .sort((a,b)=>{
      // Stable z-order: prefer boundaries first for clipping, then nearest artwork.
      if(a.recordType!==b.recordType)return a.recordType==="boundary"?-1:1;
      const A=a.bbox,B=b.bbox,areaA=A.w*A.h,areaB=B.w*B.h;
      return areaB-areaA||String(a.key).localeCompare(String(b.key));
    }).slice(0,Math.max(40,Math.min(600,options.limit||240)));
};
Store.prototype.loadViewport=async function(view,options={}){
  const metadata=await this.visibleMetadata(view,options);
  const chunks=await Promise.all(metadata.map(async m=>{
    const g=await this.geometry(m.key);return S.join(m,g);
  }));
  return {boundaries:chunks.filter(x=>x?.type==="boundary"),items:chunks.filter(x=>x?.type!=="boundary"),count:chunks.length};
};
Store.prototype.getFramePreview=async function(frameN){
  await this.open();const t=this.db.transaction(["previews"],"readonly");
  return (await idb(t.objectStore("previews").get("frame:"+frameN)))?.url||null;
};
Store.prototype.invalidateFramePreview=async function(frameN){
  await this.open();const t=this.db.transaction(["previews"],"readwrite");
  t.objectStore("previews").delete("frame:"+frameN);await complete(t)
};
Store.prototype.makeFramePreview=async function(frameN,snapshot){
  await this.open();
  if(typeof document==="undefined"||typeof Path2D==="undefined")return null;
  const data=snapshot||await this.loadCompatible();
  if(!data)return null;
  const canvas=document.createElement("canvas");canvas.width=640;canvas.height=640;
  const ctx=canvas.getContext("2d");if(!ctx)return null;
  ctx.scale(.64,.64);
  const boundaryById=new Map((data.boundaries||[]).map(x=>[x.id,x]));
  const queue=(data.items||[]).filter(x=>x.frameN===frameN);
  ctx.save();
  for(const b of data.boundaries||[]){
    try{ctx.fillStyle="rgba(5,6,9,.66)";if(frameN===1)ctx.fill(new Path2D(b.d),"evenodd");
      ctx.strokeStyle=b.color||"#aaa";ctx.globalAlpha=.3;ctx.lineWidth=1.3;ctx.stroke(new Path2D(b.d))}catch(e){}
  }
  ctx.restore();
  const loadImg=url=>new Promise((resolve,reject)=>{const img=new Image;img.onload=()=>resolve(img);img.onerror=reject;img.src=url});
  for(const x of queue){
    ctx.save();
    const b=boundaryById.get(x.b);
    if(b){try{ctx.clip(new Path2D(b.d),"evenodd")}catch(e){}}
    const tr=x.t;
    if(tr){
      ctx.translate((tr.x||0)+(x.cx||0),(tr.y||0)+(x.cy||0));
      ctx.rotate((tr.r||0)*Math.PI/180);ctx.scale(tr.s||1,tr.s||1);
      ctx.translate(-(x.cx||0),-(x.cy||0));
    }
    try{
      if(x.type==="vector")for(const p of x.paths||[]){ctx.fillStyle=p.color||"#fff";ctx.fill(new Path2D(p.d),"evenodd")}
      else if(x.type==="stroke"){ctx.strokeStyle=x.color||"#fff";ctx.lineWidth=x.w||1;ctx.lineJoin="round";ctx.lineCap="round";ctx.stroke(new Path2D(x.d))}
      else if(x.src){const img=await loadImg(x.src);ctx.drawImage(img,x.x||0,x.y||0,x.w||100,x.h||100)}
    }catch(e){}
    ctx.restore();
  }
  const url=canvas.toDataURL("image/webp",.82);
  const t=this.db.transaction(["previews"],"readwrite");t.objectStore("previews").put({key:"frame:"+frameN,url,at:Date.now()});await complete(t);
  return url;
};
S.tileEntries=tileEntries;S.tileKeys=tileKeys;S.viewportRect=viewport;
})(typeof window!=="undefined"?window:globalThis);