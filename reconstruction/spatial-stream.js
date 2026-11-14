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
  const b=meta.bbox||{x:0,y:0,w:1000,h:1000},span=Math.max(.001,Number(b.w)||.001,Number(b.h)||.001);
  const home=Math.max(0,Math.min(MAX_LEVEL,Math.floor(Math.log2(1000/span))));
  // Store a path in its exact-scale tile and two ancestor levels.
  // The ancestor records are *indexes only*, not simplified copies of geometry.
  // This prevents fine curves disappearing when a mobile viewport uses fewer tile reads.
  const levels=[...new Set([home,Math.max(0,home-2),Math.max(0,home-4)])];
  const out=[],seen=new Set();
  for(let level of levels){
    let cell=1000/2**level,x0=Math.floor(b.x/cell),y0=Math.floor(b.y/cell),
      x1=Math.floor((b.x+b.w-1e-8)/cell),y1=Math.floor((b.y+b.h-1e-8)/cell);
    while((x1-x0>1||y1-y0>1)&&level>0){
      level--;cell=1000/2**level;
      x0=Math.floor(b.x/cell);y0=Math.floor(b.y/cell);
      x1=Math.floor((b.x+b.w-1e-8)/cell);y1=Math.floor((b.y+b.h-1e-8)/cell);
    }
    for(let x=x0;x<=x1&&x<x0+3;x++)for(let y=y0;y<=y1&&y<y0+3;y++){
      const t=tileKey(meta.recordType,meta.frameN||1,level,x,y);
      const id=t+"|"+meta.key;
      if(!seen.has(id)){seen.add(id);out.push({id,tileKey:t,recordKey:meta.key})}
    }
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
  const pairs=await Promise.all(metadata.map(async m=>{
    const g=await this.geometry(m.key);
    const entry=S.join(m,g);if(m.recordType==="item"&&entry?.type==="vector"&&entry.preferOriginal&&entry.sourceRect){const src=await this.getOriginalSource(entry.id);if(src)entry.renderSrc=src}return {kind:m.recordType,entry};
  }));
  // Classify by the indexed recordType, NOT the optional artwork.type.
  // Founding boundaries ("Prism", etc.) have no `type` field in the original data.
  // They must remain exact hit-testable SVG boundaries after lazy hydration.
  return {
    boundaries:pairs.filter(p=>p.kind==="boundary"&&p.entry?.d).map(p=>p.entry),
    items:pairs.filter(p=>p.kind==="item"&&p.entry).map(p=>p.entry),
    count:pairs.length
  };
};
Store.prototype.getFramePreview=async function(frameN){
  await this.open();const t=this.db.transaction(["previews"],"readonly");
  const record=await idb(t.objectStore("previews").get("frame:"+frameN));return record?.version===3?record.url:null;
};
Store.prototype.invalidateFramePreview=async function(frameN){
  await this.open();const t=this.db.transaction(["previews"],"readwrite");
  t.objectStore("previews").delete("frame:"+frameN);await complete(t)
};
Store.prototype.makeFramePreview=async function(frameN,snapshot){
  await this.open();
  if(typeof document==="undefined"||typeof Path2D==="undefined")return null;
  const indexed=!snapshot,records=indexed?await this._all("records"):null;
  const boundaries=indexed?records.filter(x=>x.recordType==="boundary"):snapshot.boundaries||[];
  const items=indexed?records.filter(x=>x.recordType==="item"&&x.frameN===frameN):(snapshot.items||[]).filter(x=>x.frameN===frameN);
  const bMap=new Map(boundaries.map(x=>[x.id,x]));
  const canvas=document.createElement("canvas");canvas.width=640;canvas.height=640;
  const ctx=canvas.getContext("2d");if(!ctx)return null;ctx.scale(.64,.64);
  const load=async(x,kind)=>indexed?this.resolve(x.id,kind):x;
  const clippedAncestors=async boundary=>{
    let current=boundary,steps=0;
    while(current&&steps++<10){
      const region=await load(current,"boundary");
      if(region?.d)try{ctx.clip(new Path2D(region.d),"evenodd")}catch(e){}
      current=region?.clipParent?bMap.get(region.clipParent):null;
    }
  };
  let count=0;
  const yieldUI=async()=>{if(++count%40===0)await new Promise(resolve=>setTimeout(resolve,0))};
  for(const metadata of boundaries){
    // Outlines smaller than one preview pixel have no visual contribution at this LOD.
    const box=metadata.bbox||S.entityBox(metadata);
    if(Math.max(box.w,box.h)<.7)continue;
    const b=await load(metadata,"boundary");if(!b||!b.d)continue;
    ctx.save();if(b.clipParent&&bMap.has(b.clipParent))await clippedAncestors(bMap.get(b.clipParent));
    try{
      if(frameN===1){ctx.fillStyle="rgba(5,6,9,.66)";ctx.fill(new Path2D(b.d),"evenodd")}
      ctx.strokeStyle=b.color||"#aaa";ctx.globalAlpha=.3;ctx.lineWidth=1.3;ctx.stroke(new Path2D(b.d))
    }catch(err){}
    ctx.restore();await yieldUI();
  }
  const image=url=>new Promise((resolve,reject)=>{const img=new Image;img.onload=()=>resolve(img);img.onerror=reject;img.src=url});
  for(const meta of items){
    const x=await load(meta,"item");if(!x)continue;
    ctx.save();
    const b=bMap.get(x.b);
    if(b)await clippedAncestors(b);
    const tr=x.t;
    if(tr){
      ctx.translate((tr.x||0)+(x.cx||0),(tr.y||0)+(x.cy||0));
      ctx.rotate((tr.r||0)*Math.PI/180);ctx.scale(tr.s||1,tr.s||1);
      ctx.translate(-(x.cx||0),-(x.cy||0));
    }
    try{
      if(x.type==="vector"&&x.preferOriginal&&x.sourceRect){
        const src=await this.getOriginalSource(x.id);
        if(src){
          const img=await image(src),R=x.sourceRect,tr=x.sourceTransform||{x:0,y:0,s:1,r:0};
          const cx=x.sourceCx??R.x+R.w/2,cy=x.sourceCy??R.y+R.h/2;
          ctx.save();ctx.translate(cx+(tr.x||0),cy+(tr.y||0));ctx.rotate((tr.r||0)*Math.PI/180);ctx.scale(tr.s||1,tr.s||1);ctx.translate(-cx,-cy);
          const ratio=Math.max(R.w/img.width,R.h/img.height),iw=img.width*ratio,ih=img.height*ratio;
          ctx.beginPath();ctx.rect(R.x,R.y,R.w,R.h);ctx.clip();
          ctx.drawImage(img,R.x+(R.w-iw)/2,R.y+(R.h-ih)/2,iw,ih);ctx.restore();
        }else for(const p of x.paths||[]){ctx.fillStyle=p.color||"#fff";ctx.fill(new Path2D(p.d),"evenodd")}
      }
      else if(x.type==="vector")for(const p of x.paths||[]){ctx.fillStyle=p.color||"#fff";ctx.fill(new Path2D(p.d),"evenodd")}
      else if(x.type==="stroke"){ctx.strokeStyle=x.color||"#fff";ctx.lineWidth=x.w||1;ctx.lineJoin="round";ctx.lineCap="round";ctx.stroke(new Path2D(x.d))}
      else if(x.src){const img=await image(x.src);ctx.drawImage(img,x.x||0,x.y||0,x.w||100,x.h||100)}
    }catch(err){}
    ctx.restore();await yieldUI();
  }
  // This small preview is not a replacement for any stored path or source photo.
  const url=canvas.toDataURL("image/webp",.82);
  const t=this.db.transaction(["previews"],"readwrite");
  t.objectStore("previews").put({key:"frame:"+frameN,url,at:Date.now(),version:3});await complete(t);
  return url;
};
S.tileEntries=tileEntries;S.tileKeys=tileKeys;S.viewportRect=viewport;
})(typeof window!=="undefined"?window:globalThis);