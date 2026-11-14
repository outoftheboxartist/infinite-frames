/* Infinite Frames: shared Supabase publishing and lazy retrieval (v1).
   No service-role keys. Browser receives only the publishable key.
   Cloud records are immutable. All original geometry is stored as published.
   Local IndexedDB is preserved as an offline/rollback mirror. */
(function(root){
"use strict";
const MAX_REMOTE_ROWS=320,MAX_BUNDLE_BYTES=1500000,MAX_SINGLE_BYTES=45000000,WORLD="root";
const compact=x=>String(x==null?"":x).trim();
const randomId=()=>root.crypto&&root.crypto.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const enc=x=>encodeURIComponent(String(x));
const safePath=p=>String(p).split("/").map(enc).join("/");
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const storageKey="if-cloud-session-v1";
class Cache{
  constructor(){this.db=null;this.opening=null}
  async open(){
    if(this.opening)return this.opening;
    this.opening=new Promise((resolve,reject)=>{
      if(!root.indexedDB){resolve(null);return}
      const request=root.indexedDB.open("if-cloud-cache-v1",2);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("bundles"))request.result.createObjectStore("bundles",{keyPath:"path"});if(!request.result.objectStoreNames.contains("viewports"))request.result.createObjectStore("viewports",{keyPath:"key"})};
      request.onsuccess=()=>{this.db=request.result;resolve(this.db)};
      request.onerror=()=>{console.warn("Cloud bundle cache unavailable");resolve(null)};
    });return this.opening
  }
  async get(path){
    const db=await this.open();if(!db)return null;
    return new Promise(resolve=>{const req=db.transaction("bundles").objectStore("bundles").get(path);req.onsuccess=()=>resolve(req.result?.value||null);req.onerror=()=>resolve(null)})
  }
  async put(path,value){
    const db=await this.open();if(!db)return;
    try{
      const t=db.transaction("bundles","readwrite"),store=t.objectStore("bundles");
      store.put({path,value,at:Date.now(),bytes:JSON.stringify(value).length});
      // Keep the number of cached publication bundles bounded.
      const all=store.getAll();
      all.onsuccess=()=>{const rows=all.result||[];if(rows.length>48)rows.sort((a,b)=>a.at-b.at).slice(0,rows.length-48).forEach(x=>store.delete(x.path))};
    }catch(e){console.warn("Device storage full; skipping bundle cache",e)}
  }
}
Cache.prototype.getViewport=async function(key){
  const db=await this.open();if(!db)return null;
  return new Promise(resolve=>{const req=db.transaction("viewports").objectStore("viewports").get(key);req.onsuccess=()=>resolve(req.result?.rows||null);req.onerror=()=>resolve(null)})
};
Cache.prototype.putViewport=async function(key,rows){
  const db=await this.open();if(!db)return;
  try{
    const t=db.transaction("viewports","readwrite"),store=t.objectStore("viewports");
    store.put({key,rows,at:Date.now()});
    const all=store.getAll();
    all.onsuccess=()=>{const values=all.result||[];if(values.length>50)values.sort((a,b)=>a.at-b.at).slice(0,values.length-50).forEach(x=>store.delete(x.key))};
  }catch(e){console.warn("Skipping cached viewport metadata",e)}
};
class Cloud{
  constructor(config){
    this.base=config.url.replace(/\/$/,"");
    this.key=config.key;
    this.fetcher=config.fetch||root.fetch.bind(root);
    this.world=config.world||WORLD;
    this.cache=new Cache();
    this.memory=new Map();this.memoryBytes=0;this.inflight=new Map();
    this.remoteById=new Map();this.cloudLatest="";
    this.session=null;this.signedInListeners=new Set();
    try{this.session=JSON.parse(root.localStorage.getItem(storageKey)||"null")}catch(e){}
  }
  notify(){this.signedInListeners.forEach(fn=>{try{fn(this.session)}catch(e){}})}
  async request(path,options={}){
    const headers={apikey:this.key,...(options.headers||{})};
    let token=options.auth===false?null:await this.accessToken();
    if(token)headers.Authorization="Bearer "+token;
    if(options.json!==undefined){headers["Content-Type"]="application/json";options.body=JSON.stringify(options.json)}
    const ac=typeof AbortController!=="undefined"?new AbortController():null;
    const timer=ac?setTimeout(()=>ac.abort(),options.timeout||13000):null;
    let result;
    try{
      result=await this.fetcher(this.base+path,{method:options.method||"GET",headers,body:options.body,signal:ac?.signal,mode:"cors"});
    }catch(e){throw Error(e.name==="AbortError"?"Supabase took too long to respond":("Supabase network unavailable: "+e.message))}
    finally{if(timer)clearTimeout(timer)}
    if(!result.ok){const info=await result.text().catch(()=>"");let message=info;try{const j=JSON.parse(info);message=j.msg||j.message||j.error_description||j.error||info}catch(e){}
      throw Error("Cloud "+result.status+": "+String(message).slice(0,220))}
    if(options.response==="blob")return result.blob();
    if(options.response==="text")return result.text();
    if(result.status===204)return null;
    const raw=await result.text();if(!raw)return null;
    try{return JSON.parse(raw)}catch(e){return raw}
  }
  async accessToken(){
    if(!this.session?.access_token)return null;
    if(Date.now()<(this.session.expires_at||0)*1000-90000)return this.session.access_token;
    if(!this.session.refresh_token){this.saveSession(null);return null}
    if(!this.refreshing)this.refreshing=this.authRequest("/token?grant_type=refresh_token",{refresh_token:this.session.refresh_token}).then(r=>{this.saveSession(r);return this.session?.access_token}).catch(()=>{this.saveSession(null);return null}).finally(()=>this.refreshing=null);
    return this.refreshing
  }
  saveSession(payload){
    if(!payload){this.session=null;try{root.localStorage.removeItem(storageKey)}catch(e){};this.notify();return}
    const expiresAt=payload.expires_at||Math.floor(Date.now()/1000)+(payload.expires_in||3600);
    this.session={access_token:payload.access_token,refresh_token:payload.refresh_token,expires_at:expiresAt,user:payload.user};
    try{root.localStorage.setItem(storageKey,JSON.stringify(this.session))}catch(e){}
    this.notify()
  }
  async authRequest(path,body){
    const r=await this.fetcher(this.base+"/auth/v1"+path,{method:"POST",headers:{apikey:this.key,"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.msg||data.error_description||data.message||data.error||"Sign-in unavailable");
    return data
  }
  async signIn(email,password){
    const session=await this.authRequest("/token?grant_type=password",{email,password});this.saveSession(session);return this.session
  }
  async signUp(email,password){
    const data=await this.authRequest("/signup",{email,password});
    if(data.access_token)this.saveSession(data);
    return data
  }
  async sendOtp(email){
    return this.authRequest("/otp",{email,create_user:true,options:{email_redirect_to:root.location.origin}})
  }
  async verifyOtp(email,token){
    const data=await this.authRequest("/verify",{email,token,type:"email"});this.saveSession(data);return this.session
  }
  async signOut(){const tok=this.session?.access_token;this.saveSession(null);if(tok)try{await this.fetcher(this.base+"/auth/v1/logout",{method:"POST",headers:{apikey:this.key,Authorization:"Bearer "+tok}})}catch(e){}}
  async requireUser(){
    const token=await this.accessToken();const uid=this.session?.user?.id;
    if(!token||!uid)throw Error("Sign in to Cloud Sync before publishing. Your unpublished artwork is still safe.");
    return uid
  }
  async upload(bucket,path,body,mime){
    return this.request("/storage/v1/object/"+enc(bucket)+"/"+safePath(path),{method:"POST",body,headers:{"Content-Type":mime,"x-upsert":"false"},timeout:45000})
  }
  remember(path,data){
    const size=JSON.stringify(data).length;
    if(this.memory.has(path)){this.memoryBytes-=this.memory.get(path).size;this.memory.delete(path)}
    this.memory.set(path,{data,size});this.memoryBytes+=size;
    while(this.memory.size>20||this.memoryBytes>18000000){const old=this.memory.keys().next().value;const value=this.memory.get(old);this.memory.delete(old);this.memoryBytes-=value.size}
  }
  async bundle(path){
    if(!path||!/^[-0-9a-f]{30,}\/[-0-9a-z]+\.json$/i.test(path))throw Error("Unrecognized cloud geometry reference");
    if(this.memory.has(path)){const v=this.memory.get(path).data;this.remember(path,v);return v}
    if(this.inflight.has(path))return this.inflight.get(path);
    const work=(async()=>{
      const cached=await this.cache.get(path);
      if(cached?.v===1&&Array.isArray(cached.entries)){this.remember(path,cached);return cached}
      const b=await this.request("/storage/v1/object/authenticated/if-shared-bundles/"+safePath(path),{response:"text",timeout:26000});
      const decoded=JSON.parse(b);
      if(decoded.v!==1||!Array.isArray(decoded.entries))throw Error("Unrecognized shared geometry format");
      this.remember(path,decoded);this.cache.put(path,decoded);return decoded;
    })().finally(()=>this.inflight.delete(path));
    this.inflight.set(path,work);return work
  }
  metadata(node){
    return {id:node.id,name:node.name||"Untitled curve",author:node.author_display||"Contributor",
      frameN:node.frame_n,color:node.color,bbox:{x:node.min_x,y:node.min_y,w:node.max_x-node.min_x,h:node.max_y-node.min_y,cx:(node.min_x+node.max_x)/2,cy:(node.min_y+node.max_y)/2},
      parentId:node.parent_id,bundle_path:node.bundle_path,bundle_index:node.bundle_index};
  }
  async resolveNode(node){
    const blob=await this.bundle(node.bundle_path);
    const element=blob.entries[node.bundle_index];
    if(!element||element.data?.id!==node.id||element.kind!==node.kind)throw Error("Cloud geometry index mismatch");
    return element.data
  }
  async viewport(view,options={}){
    const box=root.IFSpatial.viewportRect(view,options.padding??.55);
    const frames=options.frameNs||[options.frameN||1];
    const z=Math.max(1,view.z||1),pixelWorld=1000/z/390;
    // Visually subpixel shapes stay in the database; load them at deeper zoom.
    const minExtent=options.minExtent??pixelWorld*.28;
    const pageSize=Math.min(MAX_REMOTE_ROWS,Math.max(80,options.limit||260));
    const cap=Math.max(pageSize,Math.min(4800,options.maxRecords||(z>40?2600:z>5?1300:520)));
    const key=[this.world,frames.join(","),box.x,box.y,box.w,box.h,minExtent,cap].map(String).join("|");
    let rows=[];
    try{
      for(let page=0;rows.length<cap;page++){
        const requested=Math.min(pageSize,cap-rows.length);
        const batch=await this.request("/rest/v1/rpc/if_shared_viewport_page",{method:"POST",json:{
          p_world:this.world,p_frames:frames,p_min_x:box.x,p_min_y:box.y,p_max_x:box.x+box.w,p_max_y:box.y+box.h,
          p_min_extent:minExtent,p_offset:rows.length,p_limit:requested
        },auth:false});
        if(!Array.isArray(batch))throw Error("Cloud spatial index returned an invalid page");
        rows.push(...batch);
        if(batch.length<requested||page>=25)break;
      }
      this.cache.putViewport(key,rows);
    }catch(err){
      const cached=await this.cache.getViewport(key);
      if(!cached)throw err;
      rows=cached;
      console.warn("Offline: using cached cloud spatial metadata",err.message);
    }
    if(rows.length===0)return{boundaries:[],items:[],count:0};
    rows.forEach(x=>this.remoteById.set(x.id,x));
    // Merge records by immutable publication bundle; limit 3 simultaneous downloads.
    const paths=[...new Set(rows.map(x=>x.bundle_path))],results=new Map();
    let offset=0;
    await Promise.all(Array.from({length:Math.min(3,paths.length)},async()=>{
      while(offset<paths.length){const path=paths[offset++];try{results.set(path,await this.bundle(path))}catch(e){console.warn("Geometry temporarily unavailable",path,e)}}
    }));
    const boundaries=[],items=[];
    for(const row of rows){
      const entry=results.get(row.bundle_path)?.entries?.[row.bundle_index];
      if(!entry||entry.data?.id!==row.id)continue;
      if(row.kind==="boundary")boundaries.push(entry.data);
      else items.push(entry.data)
    }
    return{boundaries,items,count:rows.length};
  }
  async frameSnapshot(frameN,localURL){
    if(!root.document||!root.Path2D||!root.Image)return localURL||null;
    // 3D overview is a derived texture; the original SVG remains in private
    // immutable bundles. Only visually relevant, bounded geometry is requested.
    const canvas=root.document.createElement("canvas");canvas.width=600;canvas.height=600;
    const ctx=canvas.getContext("2d");if(!ctx)return localURL||null;
    ctx.scale(.6,.6);
    const loadImg=url=>new Promise((resolve,reject)=>{const img=new root.Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url});
    if(localURL)try{const img=await loadImg(localURL);ctx.drawImage(img,0,0,1000,1000)}catch(e){}
    const frames=Array.from({length:Math.min(frameN,60)},(_,i)=>i+1);
    const data=await this.viewport({x:500,y:500,z:1},{frameNs:frames,padding:0,limit:260,maxRecords:550,minExtent:1.3});
    const boundaries=new Map(data.boundaries.map(b=>[b.id,b]));
    const clip=boundary=>{
      let b=boundary,steps=0;
      while(b&&steps++<12){try{ctx.clip(new root.Path2D(b.d),"evenodd")}catch(e){}b=b.clipParent?boundaries.get(b.clipParent):null}
    };
    let i=0;
    for(const item of data.items){
      if(item.frameN!==frameN)continue;
      ctx.save();const parent=boundaries.get(item.b);if(parent)clip(parent);
      const t=item.t;
      if(t){const cx=item.cx||0,cy=item.cy||0;ctx.translate(cx+(t.x||0),cy+(t.y||0));ctx.rotate((t.r||0)*Math.PI/180);ctx.scale(t.s||1,t.s||1);ctx.translate(-cx,-cy)}
      try{
        if(item.type==="vector")for(const p of item.paths||[]){ctx.fillStyle=p.color||"#ffffff";ctx.fill(new root.Path2D(p.d),"evenodd")}
        else if(item.type==="stroke"){ctx.strokeStyle=item.color||"#ffffff";ctx.lineWidth=item.w||1;ctx.stroke(new root.Path2D(item.d))}
      }catch(e){}
      ctx.restore();
      if(++i%25===0)await delay(0);
    }
    return canvas.toDataURL("image/webp",.83);
  }
  async search(term,limit=40){
    if(!compact(term))return[];
    const rows=await this.request("/rest/v1/rpc/if_shared_search",{method:"POST",json:{p_world:this.world,p_query:compact(term),p_limit:Math.min(80,limit)},auth:false});
    return (rows||[]).filter(x=>x.kind==="boundary").map(x=>{this.remoteById.set(x.id,x);return this.metadata(x)})
  }
  async browse(options={}){
    const count=Math.min(80,options.limit||48),params=new URLSearchParams({
      select:"id,name,author_display,color,frame_n,parent_id,bundle_path,bundle_index,min_x,min_y,max_x,max_y,kind",
      world_id:"eq."+this.world,kind:"eq.boundary",published:"eq.true",order:"id.asc",limit:String(count+1)
    });
    if(options.after)params.set("id","gt."+options.after);
    if(options.color&&/^#[a-f0-9]{6}$/i.test(options.color))params.set("color","eq."+options.color);
    const data=await this.request("/rest/v1/if_shared_nodes?"+params.toString(),{auth:false});
    const list=(data||[]).slice(0,count);
    list.forEach(x=>this.remoteById.set(x.id,x));
    return{items:list.map(x=>({...this.metadata(x),key:x.id})),hasMore:(data||[]).length>count,nextCursor:list.at(-1)?.id||null}
  }
  async palette(){
    const params=new URLSearchParams({select:"color",world_id:"eq."+this.world,kind:"eq.boundary",published:"eq.true",limit:"1000"});
    const rows=await this.request("/rest/v1/if_shared_nodes?"+params.toString(),{auth:false});
    return[...new Set((rows||[]).map(x=>x.color?.toLowerCase()).filter(x=>/^#[a-f0-9]{6}$/.test(x)))].slice(0,70)
  }
  async resolve(id){
    let row=this.remoteById.get(id);
    if(!row){const p=new URLSearchParams({select:"*",world_id:"eq."+this.world,id:"eq."+id,limit:"1"});row=(await this.request("/rest/v1/if_shared_nodes?"+p.toString(),{auth:false}))?.[0]}
    return row?this.resolveNode(row):null
  }
  async listFrames(){
    const query=new URLSearchParams({select:"frame_n,status",world_id:"eq."+this.world,order:"frame_n.asc",limit:"300"});
    return(await this.request("/rest/v1/if_shared_frames?"+query.toString(),{auth:false})||[]).map(x=>({n:x.frame_n,status:x.status}))
  }
  async listMessages(){
    const q=new URLSearchParams({select:"*",world_id:"eq."+this.world,order:"created_at.desc",limit:"120"});
    const rows=await this.request("/rest/v1/if_shared_messages?"+q.toString(),{auth:false});
    return (rows||[]).reverse().map(x=>({id:x.id,who:x.author_display,whoId:x.author_id,text:x.body,loc:x.location,idea:x.idea,frameN:x.frame_n}))
  }
  async listVotes(){
    const q=new URLSearchParams({select:"message_id,voter_id,kind",world_id:"eq."+this.world,limit:"500"});
    const rows=await this.request("/rest/v1/if_shared_votes?"+q.toString(),{auth:false});
    return(rows||[]).map(x=>({msgId:x.message_id,voterId:x.voter_id,kind:x.kind}))
  }
  async publish(payload){
    const uid=await this.requireUser();
    const sourceItems=(payload.items||[]),boundaries=payload.boundaries||[];
    const entries=[];
    const uploadSource=async data=>{
      const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(data||"");
      if(!match)throw Error("Unsupported original image format; export a PNG, JPEG, WebP, or GIF first");
      const mime=match[1],ext=mime.split("/")[1],blob=await(await this.fetcher(data)).blob();
      const path=uid+"/"+randomId()+"."+ext;
      await this.upload("if-shared-originals",path,blob,mime);
      return path;
    };
    for(const original of [...boundaries.map(b=>({kind:"boundary",data:b})),...sourceItems.map(i=>({kind:"item",data:i}))]){
      const data={...original.data};
      if(original.kind==="item"&&typeof data.originalImage==="string"){
        data.originalPath=await uploadSource(data.originalImage);
        delete data.originalImage;
      }
      delete data.renderSrc;
      entries.push({kind:original.kind,data});
    }
    if(entries.length===0)return;
    // Bound each download to approximately 1.5 MB, regardless of region count.
    const groups=[];let group=[],bytes=0;
    for(const item of entries){
      const length=JSON.stringify(item).length+6;
      if(length>MAX_SINGLE_BYTES)throw Error("A single SVG exceeds this storage provider’s per-file limit; it was not compressed or altered.");
      if((bytes+length>MAX_BUNDLE_BYTES||group.length>=120)&&group.length){groups.push(group);group=[];bytes=0}
      group.push(item);bytes+=length;
    }
    if(group.length)groups.push(group);
    const publication=[];
    for(const groupEntries of groups){
      const path=uid+"/"+randomId()+".json",value={v:1,entries:groupEntries};
      await this.upload("if-shared-bundles",path,JSON.stringify(value),"application/json");
      this.remember(path,value);this.cache.put(path,value);
      for(let i=0;i<groupEntries.length;i++){
        const entry=groupEntries[i],data=entry.data,box=root.IFSpatial.entityBox(data);
        const safe=n=>Number.isFinite(n)?Math.max(-1e12,Math.min(1e12,n)):0;
        const color=entry.kind==="boundary"?data.color:(data.color||data.paths?.[0]?.color);
        const sanitizedColor=/^#[0-9a-f]{6}$/i.test(color||"")?color:null;
        publication.push({world_id:this.world,id:data.id,kind:entry.kind,frame_n:data.frameN||1,
          parent_id:entry.kind==="boundary"?(data.clipParent||null):(data.b||null),
          name:String(data.name||data.pieceName||"Untitled curve").slice(0,160),
          color:sanitizedColor,author_id:uid,
          author_display:String(data.founder||data.author||"Contributor").slice(0,64),
          min_x:safe(box.x),min_y:safe(box.y),max_x:safe(box.x+box.w),
          max_y:safe(box.y+box.h),bundle_path:path,bundle_index:i});
      }
    }
    // One PostgREST bulk INSERT is one database transaction. Uploads are immutable
    // and completed first; a failed INSERT leaves only unreferenced private blobs.
    await this.request("/rest/v1/if_shared_nodes",{method:"POST",json:publication,headers:{Prefer:"return=minimal"},timeout:45000});
    // Ensure other devices can discover all frames in which art was published.
    const top=Math.max(...publication.map(x=>x.frame_n));
    const rows=Array.from({length:Math.min(top,200)},(_,i)=>({world_id:this.world,frame_n:i+1,status:i+1===top?"open":"published",created_by:uid}));
    try{await this.request("/rest/v1/if_shared_frames?on_conflict=world_id%2Cframe_n",{method:"POST",json:rows,headers:{Prefer:"resolution=ignore-duplicates,return=minimal"}})}catch(e){console.warn("Frame metadata will be reconciled next refresh",e)}
    this.cloudLatest=publication[publication.length-1]?.id||"";
    return {count:publication.length};
  }
  async sendMessage(m){
    const uid=await this.requireUser();
    const row={world_id:this.world,id:m.id,author_id:uid,author_display:String(m.who||"Contributor").slice(0,64),body:String(m.text||"").slice(0,500),frame_n:m.frameN||1,location:m.loc||null,idea:!!m.idea};
    await this.request("/rest/v1/if_shared_messages",{method:"POST",json:row,headers:{Prefer:"return=minimal"}});
  }
  async vote(v){
    const uid=await this.requireUser();
    const row={world_id:this.world,message_id:v.msgId,voter_id:uid,kind:v.kind};
    await this.request("/rest/v1/if_shared_votes",{method:"POST",json:row,headers:{Prefer:"return=minimal"}});
  }
  async openNextFrame(n){
    const uid=await this.requireUser();
    await this.request("/rest/v1/if_shared_frames?world_id=eq."+enc(this.world)+"&frame_n=eq."+n,{method:"PATCH",json:{status:"published"},headers:{Prefer:"return=minimal"}});
    await this.request("/rest/v1/if_shared_frames?on_conflict=world_id%2Cframe_n",{method:"POST",json:{world_id:this.world,frame_n:n+1,status:"open",created_by:uid},headers:{Prefer:"resolution=ignore-duplicates,return=minimal"}});
  }
  async latest(){
    const q=new URLSearchParams({select:"id,published_at",world_id:"eq."+this.world,order:"published_at.desc,id.desc",limit:"1"});
    const rows=await this.request("/rest/v1/if_shared_nodes?"+q.toString(),{auth:false});
    return rows?.[0]?.id||""
  }
}
function combine(base,cloud){
 const listeners=new Set();let connected=false,unsubscribe=null,poller=null,last="",authState=null;const previews=new Map(),previewJobs=new Map();
 const notify=e=>listeners.forEach(fn=>{try{fn(e)}catch(err){console.warn(err)}});
 async function warm(){
   try{
     const [frames,messages,votes]=await Promise.all([cloud.listFrames(),cloud.listMessages(),cloud.listVotes()]);
     for(const f of frames)notify({type:"frame",row:f});
     for(const m of messages)notify({type:"message",row:m});
     for(const v of votes)notify({type:"vote",row:v});
     last=await cloud.latest();cloud.cloudLatest=last;previews.clear();
     connected=true;notify({type:"cloud-status",row:{online:true,authenticated:!!cloud.session?.access_token}});
   }catch(e){connected=false;notify({type:"cloud-status",row:{online:false,error:e.message}});console.warn("Shared canvas will retry",e)}
 }
 const backend={
   mode:"local-spatial",
   cloud,
   get spatial(){return base.spatial},
   get cloudOnline(){return connected},
   get signedIn(){return !!cloud.session?.access_token},
   async load(){const snapshot=await base.load();warm();return snapshot},
   subscribe(fn){listeners.add(fn);const sub=base.subscribe(fn);return()=>{listeners.delete(fn);sub()}},
   onPresence:base.onPresence,
   places:base.places,
   async publish(payload){await cloud.publish(payload);previews.clear();backend._readyViewport=null;try{await base.publish(payload)}catch(e){console.warn("Cloud saved successfully, but offline mirror is unavailable",e)}notify({type:"cloud-status",row:{online:true,authenticated:true}})},
   async loadView(view,options){
     // Local geometry must never wait for a slow Supabase request.
     const frames=(options.frameNs||[options.frameN||1]).join(",");
     const width=1000/Math.max(1,view.z||1);
     const key=[frames,Math.round(view.x/(width*.2)),Math.round(view.y/(width*.2)),Math.round(Math.log2(Math.max(1,view.z||1))*8)].join(":");
     const local=base.loadView(view,options).catch(e=>({boundaries:[],items:[],count:0,error:e}));
     const combined=(a,b)=>{
       const dedupe=(x,y)=>{const map=new Map();for(const o of x||[])map.set(o.id,o);for(const o of y||[])map.set(o.id,o);return [...map.values()]};
       return{boundaries:dedupe(a.boundaries,b?.boundaries),items:dedupe(a.items,b?.items),count:(a.count||0)+(b?.count||0)};
     };
     if(backend._readyViewport&&backend._readyViewport.key===key){
       const data=backend._readyViewport.data;
       return combined(await local,data)
     }
     const remotePromise=cloud.viewport(view,options);
     const first=await Promise.race([
       remotePromise.then(data=>({data}),error=>({error})),
       delay(850).then(()=>({pending:true}))
     ]);
     const localData=await local;
     if(first.data){connected=true;backend._readyViewport={key,data:first.data};return combined(localData,first.data)}
     if(first.error){
       connected=false;console.warn("Shared viewport temporarily offline",first.error);
       return localData
     }
     // A late network response updates the in-memory spatial view and triggers
     // one subsequent paint. Superseded viewports are discarded.
     backend._pendingViewKey=key;
     remotePromise.then(data=>{
       if(backend._pendingViewKey===key){
         connected=true;backend._readyViewport={key,data};
         notify({type:"refresh",row:{}})
       }
     }).catch(e=>{connected=false;console.warn("Cloud viewport retry next navigation",e)});
     return localData
   },
   async regionById(id){
     const local=await base.regionById(id).catch(()=>null);
     if(local)return local;return cloud.resolve(id)
   },
   async searchRegions(q,opts={}){
     const [a,b]=await Promise.allSettled([base.searchRegions(q,opts),cloud.search(q,opts.limit||40)]);
     const map=new Map();for(const r of a.status==="fulfilled"?a.value:[])map.set(r.id,r);
     for(const r of b.status==="fulfilled"?b.value:[])map.set(r.id,r);
     return [...map.values()].slice(0,opts.limit||50)
   },
   async browseRegions(opts={}){
     const result=await cloud.browse(opts).catch(()=>null);
     if(result&&result.items.length)return result;
     return base.browseRegions(opts)
   },
   async availableColors(){
     const [a,b]=await Promise.allSettled([base.availableColors(),cloud.palette()]);
     return [...new Set([...(a.status==="fulfilled"?a.value:[]),...(b.status==="fulfilled"?b.value:[])])].slice(0,75)
   },
   async framePreview(frameN){
     const key=frameN+":"+(cloud.cloudLatest||"empty");
     if(previews.has(key))return previews.get(key);
     if(previewJobs.has(key))return previewJobs.get(key);
     const job=(async()=>{
       const localURL=await base.framePreview(frameN).catch(()=>null);
       const rendered=await cloud.frameSnapshot(frameN,localURL).catch(err=>{console.warn("Shared preview deferred",err);return localURL});
       if(rendered){previews.set(key,rendered);while(previews.size>12)previews.delete(previews.keys().next().value)}
       return rendered;
     })().finally(()=>previewJobs.delete(key));
     previewJobs.set(key,job);return job
   },
   async visibleRegions(rect,options){return base.visibleRegions(rect,options)},
   async regionCount(){return base.regionCount()},
   async currentSnapshot(){return base.currentSnapshot()},
   async openNextFrame(n,events){await cloud.openNextFrame(n);await base.openNextFrame(n,events)},
   async sendMessage(m){await cloud.sendMessage(m);await base.sendMessage(m)},
   async vote(v){await cloud.vote(v);await base.vote(v)},
   signIn:(email,password)=>cloud.signIn(email,password),
   signUp:(email,password)=>cloud.signUp(email,password),
   sendOtp:email=>cloud.sendOtp(email),
   verifyOtp:(email,token)=>cloud.verifyOtp(email,token),
   signOut:()=>cloud.signOut(),
   openAccount:()=>root.IFCloud.openAccount(backend)
 };
 cloud.signedInListeners.add(()=>notify({type:"cloud-status",row:{online:connected,authenticated:!!cloud.session?.access_token}}));
 let active=true;
 const poll=async()=>{if(!active)return;
   if(root.document?.visibilityState==="hidden")return;
   try{
     const id=await cloud.latest();
     if(id!==last){last=id;backend._readyViewport=null;previews.clear();notify({type:"refresh",row:{}});await warm()}
     else if(!connected)await warm();
   }catch(e){connected=false}
 };
 if(typeof root.setInterval==="function")poller=root.setInterval(poll,14000);
 if(root.addEventListener)root.addEventListener("beforeunload",()=>{active=false;if(poller)clearInterval(poller)});
 return backend;
}
function openAccount(backend){
 const layer=document.createElement("div");
 layer.style.cssText="position:fixed;inset:0;z-index:2147483645;background:rgba(0,2,9,.97);display:flex;align-items:center;justify-content:center;padding:16px;color:#eaf5fb;font:13px system-ui,sans-serif";
 const panel=document.createElement("div");
 panel.style.cssText="width:min(100%,420px);display:flex;flex-direction:column;gap:11px;background:#111923;border:1px solid #465e71;border-radius:18px;padding:20px;max-height:90vh;overflow:auto";
 const title=document.createElement("div");title.textContent="INFINITE FRAMES · SHARED CANVAS";title.style.cssText="font:800 15px system-ui;letter-spacing:.07em";
 const status=document.createElement("p");status.style.cssText="margin:0;color:#a5bed0;line-height:1.5";
 const input=(type,placeholder)=>{const x=document.createElement("input");x.type=type;x.placeholder=placeholder;x.style.cssText="height:44px;background:#060d13;color:#fff;border:1px solid #516779;border-radius:10px;padding:10px;font:13px system-ui;width:100%";return x};
 const email=input("email","Email address"),password=input("password","Password (at least 6 characters)"),code=input("text","Email verification code (if provided)");
 const button=(label,fn)=>{const b=document.createElement("button");b.textContent=label;b.style.cssText="min-height:43px;border:1px solid #52768b;border-radius:10px;background:#163043;color:#e1f9ff;font:700 12px system-ui;cursor:pointer";b.onclick=async()=>{b.disabled=true;status.textContent="Contacting Supabase…";try{await fn();if(backend.signedIn||status.textContent==="Contacting Supabase…")render()}catch(e){status.textContent=e.message}finally{b.disabled=false}};return b};
 const signin=button("Sign in",()=>backend.signIn(email.value.trim(),password.value));
 const signup=button("Create account",async()=>{const result=await backend.signUp(email.value.trim(),password.value);status.textContent=result.access_token?"Signed in":"Check your inbox to confirm your email, then sign in."});
 const otp=button("Email a sign-in link / code",async()=>{await backend.sendOtp(email.value.trim());status.textContent="Check your email. If a code is included, enter it here."});
 const verify=button("Verify emailed code",()=>backend.verifyOtp(email.value.trim(),code.value.trim()));
 const signout=button("Sign out",()=>backend.signOut());
 const close=button("Close",()=>layer.remove());
 function render(){
   const signed=backend.cloud.session?.user?.email;
   status.textContent=signed?"Signed in as "+signed+". New publications are shared between devices using this account.":"Published art is public to explore. Sign in to publish to the shared world. Local artwork stays safe.";
   for(const control of [email,password,code,signin,signup,otp,verify])control.style.display=signed?"none":"";
   signout.style.display=signed?"":"none";
 }
 panel.append(title,status,email,password,signin,signup,otp,code,verify,signout,close);
 layer.append(panel);document.body.append(layer);render();
 return()=>layer.remove()
}
root.IFCloud={Cloud,Cache,createBackend:combine,openAccount};
})(typeof window!=="undefined"?window:globalThis);
