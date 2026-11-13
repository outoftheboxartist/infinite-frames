/* Infinite Frames Spatial Engine v1. Browser-local, non-destructive. Full SVG paths in
   IndexedDB.geometry, lightweight region metadata in IndexedDB.records.
   The existing React art engine is initially hydrated for compatibility; viewport paging
   and the Supabase adapter are separate rollouts. */
(function(root){
"use strict";
const NAME="infinite-frames-spatial-v1", VERSION=1, LIMIT=200;
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error("IndexedDB request failed"))});
const completed=t=>new Promise((resolve,reject)=>{t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error||new Error("IndexedDB transaction failed"));t.onabort=()=>reject(t.error||new Error("IndexedDB transaction aborted"))});
const tidy=x=>String(x==null?"":x).toLocaleLowerCase().trim();
function boundsFromPath(d){
  if(!d||typeof d!=="string")return{x:0,y:0,w:1000,h:1000,cx:500,cy:500};
  const points=[...d.matchAll(/(-?(?:\d+\.?\d*|\.\d+))(?:[,\s]+)(-?(?:\d+\.?\d*|\.\d+))/g)];
  if(points.length===0)return{x:0,y:0,w:1000,h:1000,cx:500,cy:500};
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of points){const x=Number(p[1]),y=Number(p[2]);if(!Number.isFinite(x)||!Number.isFinite(y))continue;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
  if(!Number.isFinite(x0))return{x:0,y:0,w:1000,h:1000,cx:500,cy:500};
  return{x:x0,y:y0,w:Math.max(.01,x1-x0),h:Math.max(.01,y1-y0),cx:(x0+x1)/2,cy:(y0+y1)/2};
}
function entityBox(e){
  if(e.bbox&&Number.isFinite(e.bbox.x))return e.bbox;
  const b=e.type==="image"&&Number.isFinite(e.x)?
    {x:e.x,y:e.y,w:e.w||1,h:e.h||1,cx:e.x+(e.w||1)/2,cy:e.y+(e.h||1)/2}:
    e.type==="vector"?boundsFromPath((e.paths||[]).map(x=>x.d).join(" ")):boundsFromPath(e.d);
  const t=e.t;if(!t||(!t.x&&!t.y&&(t.s==null||t.s===1)&&!t.r))return b;
  const cx=Number.isFinite(e.cx)?e.cx:b.cx,cy=Number.isFinite(e.cy)?e.cy:b.cy;
  const sin=Math.sin((t.r||0)*Math.PI/180),cos=Math.cos((t.r||0)*Math.PI/180),scale=t.s||1;
  const corners=[[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]];
  const points=corners.map(([x,y])=>{const dx=(x-cx)*scale,dy=(y-cy)*scale;return[cx+(t.x||0)+dx*cos-dy*sin,cy+(t.y||0)+dx*sin+dy*cos]});
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
  return {x,y,w,h,cx:x+w/2,cy:y+h/2};
}
function intersects(box,view,padding=0){return box.x<=view.x+view.w+padding&&box.y<=view.y+view.h+padding&&box.x+box.w>=view.x-padding&&box.y+box.h>=view.y-padding}
function split(e,type){
  const key=(type==="boundary"?"b:":"i:")+e.id;
  const meta={...e,key,recordType:type,frameN:e.frameN||1,parentId:e.parentId||e.b||null,nameLower:tidy(e.name||e.fname||""),authorLower:tidy(e.author||e.founder||""),colorLower:tidy(e.color||(e.paths&&e.paths[0]&&e.paths[0].color)||""),bbox:entityBox(e)};
  const geom={key};
  if(typeof e.d==="string"){geom.d=e.d;delete meta.d}
  if(Array.isArray(e.paths)){geom.paths=e.paths;delete meta.paths}
  if(typeof e.src==="string"){geom.src=e.src;delete meta.src}
  // Never store the original raster inside metadata for traced vectors.
  if(e.orig){geom.orig=e.orig;delete meta.orig}
  if(e.regions){geom.regions=e.regions;delete meta.regions}
  return{meta,geom};
}
function join(meta,geom){if(!meta)return null;const{key,recordType,nameLower,authorLower,colorLower,...rest}=meta;return{...rest,...(geom||{}) ,key:undefined}}
class Store{
  constructor(){this.db=null;this.meta=null;this.openPromise=null;this.cache=new Map()}
  open(){if(this.openPromise)return this.openPromise;
    this.openPromise=new Promise((resolve,reject)=>{
      if(!root.indexedDB){reject(new Error("IndexedDB is unavailable"));return}
      const r=root.indexedDB.open(NAME,VERSION);
      r.onupgradeneeded=()=>{
        const db=r.result;
        if(!db.objectStoreNames.contains("records")){
          const v=db.createObjectStore("records",{keyPath:"key"});
          v.createIndex("by_name","nameLower");v.createIndex("by_author","authorLower");v.createIndex("by_color","colorLower");v.createIndex("by_frame","frameN");v.createIndex("by_parent","parentId");
        }
        if(!db.objectStoreNames.contains("geometry"))db.createObjectStore("geometry",{keyPath:"key"});
        if(!db.objectStoreNames.contains("state"))db.createObjectStore("state",{keyPath:"key"});
      };
      r.onerror=()=>reject(r.error||new Error("Could not open spatial database"));
      r.onsuccess=()=>{this.db=r.result;this.db.onversionchange=()=>this.db.close();resolve(this)};
    });return this.openPromise;
  }
  async state(){await this.open();const t=this.db.transaction(["state"],"readonly");return(await request(t.objectStore("state").get("world")))?.value||null}
  async importLegacy(snapshot){
    await this.open();if(await this.state())return false;
    const t=this.db.transaction(["records","geometry","state"],"readwrite");const rec=t.objectStore("records"),geom=t.objectStore("geometry");
    for(const e of snapshot.boundaries||[]){const {meta,geom:g}=split(e,"boundary");rec.put(meta);geom.put(g)}
    for(const e of snapshot.items||[]){const {meta,geom:g}=split(e,"item");rec.put(meta);geom.put(g)}
    const state={frames:snapshot.frames||[{n:1,status:"open"}],messages:snapshot.messages||[],votes:snapshot.votes||[],events:snapshot.events||[]};
    t.objectStore("state").put({key:"world",value:state,revision:1});await completed(t);this.meta=state;return true
  }
  async loadCompatible(){
    await this.open();const [state,records,geometry]=await Promise.all([
      this.state(),this._all("records"),this._all("geometry")
    ]);if(!state)return null;
    this.meta=state;
    const paths=new Map(geometry.map(g=>[g.key,g]));
    return {...state,boundaries:records.filter(x=>x.recordType==="boundary").map(x=>join(x,paths.get(x.key))),items:records.filter(x=>x.recordType==="item").map(x=>join(x,paths.get(x.key)))}
  }
  async _all(name){await this.open();const t=this.db.transaction([name],"readonly");return request(t.objectStore(name).getAll())}
  async putPublication({boundaries=[],items=[],events=[]},snapshot){
    await this.open();
    const next={...this.meta,...snapshot,events:snapshot.events||[...(this.meta?.events||[]),...events]};
    const t=this.db.transaction(["records","geometry","state"],"readwrite"),r=t.objectStore("records"),g=t.objectStore("geometry");
    for(const e of boundaries){const x=split(e,"boundary");r.put(x.meta);g.put(x.geom)}
    for(const e of items){const x=split(e,"item");r.put(x.meta);g.put(x.geom)}
    t.objectStore("state").put({key:"world",value:next,revision:1});await completed(t);this.meta=next;
    return true
  }
  async saveState(snapshot){await this.open();const next={...this.meta,...snapshot};const t=this.db.transaction(["state"],"readwrite");t.objectStore("state").put({key:"world",value:next,revision:1});await completed(t);this.meta=next}
  async metadata(id,type="boundary"){await this.open();const key=(type==="boundary"?"b:":"i:")+id;const t=this.db.transaction(["records"],"readonly");return request(t.objectStore("records").get(key))}
  async geometry(key){await this.open();if(this.cache.has(key)){const v=this.cache.get(key);this.cache.delete(key);this.cache.set(key,v);return v}
    const t=this.db.transaction(["geometry"],"readonly");const v=await request(t.objectStore("geometry").get(key));if(v){this.cache.set(key,v);if(this.cache.size>LIMIT)this.cache.delete(this.cache.keys().next().value)}return v}
  async resolve(id,type="boundary"){const key=(type==="boundary"?"b:":"i:")+id;const [m,g]=await Promise.all([this.metadata(id,type),this.geometry(key)]);return join(m,g)}
  async search(term,options={}){
    await this.open();const q=tidy(term);if(!q)return[];
    const max=Math.max(1,Math.min(80,options.limit||30));
    const out=[],seen=new Set;
    const collect=rows=>{for(const m of rows){if(m.recordType!=="boundary"||seen.has(m.key))continue;
      if(options.frameN&&m.frameN!==options.frameN)continue;
      seen.add(m.key);out.push({id:m.id,name:m.name||"Untitled curve",color:m.color||"",author:m.founder||m.author||"",frameN:m.frameN,bbox:m.bbox,parentId:m.parentId});if(out.length>=max)break}};
    for(const key of ["by_name","by_author","by_color"]){
      if(out.length>=max)break;
      const t=this.db.transaction(["records"],"readonly"),index=t.objectStore("records").index(key),lower=root.IDBKeyRange||IDBKeyRange;
      collect(await request(index.getAll(lower.bound(q,q+"\uffff"),max)))
    }
    return out.slice(0,max);
  }
  async viewport(view,options={}){
    await this.open();
    const frameN=options.frameN||1,limit=Math.max(1,Math.min(500,options.limit||120)),t=this.db.transaction(["records"],"readonly");
    const rows=await request(t.objectStore("records").index("by_frame").getAll(frameN));
    const relevant=rows.filter(m=>m.recordType==="boundary"&&intersects(m.bbox,view,options.padding||0))
      .sort((a,b)=>(a.bbox.w*a.bbox.h)-(b.bbox.w*b.bbox.h)).slice(0,limit);
    if(options.withGeometry===false)return relevant.map(m=>({id:m.id,bbox:m.bbox,name:m.name,color:m.color,frameN:m.frameN}));
    return Promise.all(relevant.map(m=>this.resolve(m.id)));
  }
  async count(){await this.open();const t=this.db.transaction(["records"],"readonly");return request(t.objectStore("records").count())}
}
root.IFSpatial={Store,split,join,boundsFromPath,entityBox,intersects};
})(typeof window!=="undefined"?window:globalThis);
