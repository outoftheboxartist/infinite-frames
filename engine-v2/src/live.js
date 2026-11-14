// Published-world reader. Zero write capabilities; never sends demo geometry to Supabase.
// This is an adapter for the existing if_shared_viewport_page + immutable bundle schema.
export const LIVE = Object.freeze({
  url: "https://xqfevafhjbdulhcqcmao.supabase.co",
  publishableKey: "sb_publishable_olDMWJAdn9VYjJLK9E29eA_BOIANXmO",
  world: "root"
});

const safeSegment = path => String(path).split("/").map(encodeURIComponent).join("/");
const validBundle = path => /^[0-9a-f-]{30,}\/[-a-z0-9]+\.json$/i.test(path||"");
const boxFrom = m => ({
  minX: +m.min_x, minY: +m.min_y, maxX: +m.max_x, maxY: +m.max_y
});
const positiveFinite = n => Number.isFinite(n) && n >= 0;
export class PublishedWorldReader {
  constructor({ url=LIVE.url, key=LIVE.publishableKey, world=LIVE.world, fetcher=fetch }={}) {
    this.url=url.replace(/\/$/,"");
    this.key=key;this.world=world;this.fetcher=fetcher;
    this.cache=new Map();this.loading=new Map();this.cacheLimit=40;
  }
  async request(path,{method="GET",body,signal}={}){
    const reply=await this.fetcher(this.url+path,{
      method,mode:"cors",signal,
      headers:{"apikey":this.key,...(body?{"Content-Type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(!reply.ok){
      const text=await reply.text().catch(()=>"");
      let reason=text;
      try{const parsed=JSON.parse(text);reason=parsed.message||parsed.error_description||parsed.error||text}catch{}
      const err=new Error("Supabase "+reply.status+": "+String(reason).slice(0,180));
      err.status=reply.status;throw err;
    }
    if(reply.status===204)return null;
    return reply.json();
  }
  async listFrames(signal) {
    const params=new URLSearchParams({
      world_id:"eq."+this.world,select:"frame_n,status",order:"frame_n.asc",limit:"1000"
    });
    const rows=await this.request("/rest/v1/if_shared_frames?"+params,{signal});
    return rows.length?rows:[{frame_n:1,status:"open"}];
  }
  async viewport(rect,frames=[1],minExtent=0,{max=1400,signal}={}){
    if(![rect.minX,rect.minY,rect.maxX,rect.maxY,minExtent].every(Number.isFinite))
      throw Error("Invalid viewport coordinates");
    const rows=[],limit=260;
    while(rows.length<max){
      const count=Math.min(limit,max-rows.length);
      const page=await this.request("/rest/v1/rpc/if_shared_viewport_page",{
        method:"POST",signal,
        body:{p_world:this.world,p_frames:frames,
          p_min_x:rect.minX,p_min_y:rect.minY,p_max_x:rect.maxX,p_max_y:rect.maxY,
          p_min_extent:Math.max(0,minExtent),p_offset:rows.length,p_limit:count}
      });
      if(!Array.isArray(page))throw Error("Invalid spatial viewport response");
      rows.push(...page);
      if(page.length<count)return{rows,truncated:false};
      if(page.length===0)break;
    }
    return{rows,truncated:rows.length===max};
  }
  async bundle(path,signal){
    if(!validBundle(path))throw Error("Invalid immutable geometry-bundle path");
    if(this.cache.has(path)){
      const value=this.cache.get(path);this.cache.delete(path);this.cache.set(path,value);
      return value;
    }
    if(this.loading.has(path))return this.loading.get(path);
    const task=(async()=>{
      // Existing published geometry is stored in a private bucket with RLS reads.
      const data=await this.request("/storage/v1/object/authenticated/if-shared-bundles/"+safeSegment(path),{signal});
      if(data?.v!==1||!Array.isArray(data.entries))throw Error("Invalid geometry-bundle format");
      this.cache.set(path,data);
      while(this.cache.size>this.cacheLimit)this.cache.delete(this.cache.keys().next().value);
      return data;
    })().finally(()=>this.loading.delete(path));
    this.loading.set(path,task);
    return task;
  }
  async hydrate(rows,{signal,onProgress}={}){
    const paths=[...new Set(rows.map(x=>x.bundle_path))];
    const blobs=new Map(),errors=[];
    let index=0;
    // Fetch only bundles addressed by returned viewport metadata.
    await Promise.all(Array.from({length:Math.min(paths.length,3)},async()=>{
      while(index<paths.length){
        const path=paths[index++];
        if(signal?.aborted)throw Error("Viewport request cancelled");
        try{blobs.set(path,await this.bundle(path,signal))}
        catch(error){errors.push({path,message:String(error.message||error)})}
        onProgress?.(blobs.size+errors.length,paths.length);
      }
    }));
    const nodes=[];
    for(const m of rows){
      const entry=blobs.get(m.bundle_path)?.entries?.[m.bundle_index];
      if(!entry||entry.data?.id!==m.id||entry.kind!==m.kind)continue;
      const node=convertPublishedEntry(m,entry.data);
      if(node)nodes.push(node);
    }
    return {nodes,errors,requested:rows.length,missing:rows.length-nodes.length,bundleCount:paths.length};
  }
  async load(rect,frames,minExtent,options={}){
    const {rows,truncated}=await this.viewport(rect,frames,minExtent,options);
    const result=await this.hydrate(rows,options);
    return {...result,truncated,metadataCount:rows.length};
  }
}
export function convertPublishedEntry(m,data){
  if(!m||!data||typeof data!=="object")return null;
  const bbox=boxFrom(m);
  if(![bbox.minX,bbox.minY,bbox.maxX,bbox.maxY].every(Number.isFinite)||bbox.minX>bbox.maxX||bbox.minY>bbox.maxY)return null;
  const kind=m.kind;
  const style=String(m.color||data.color||data.paths?.[0]?.color||"#8ca6c8");
  const node={
    id:String(m.id),parentId:m.parent_id||data.clipParent||data.b||null,
    kind,name:String(m.name||data.name||"Untitled").slice(0,160),
    author:String(m.author_display||data.founder||data.author||"Contributor").slice(0,64),
    frame:m.frame_n||1,order:m.published_at?Date.parse(m.published_at)||0:0,
    depth:0,color:style,bbox,
    x:(bbox.minX+bbox.maxX)/2,y:(bbox.minY+bbox.maxY)/2,
    r:Math.max(bbox.maxX-bbox.minX,bbox.maxY-bbox.minY)/2,
    path:kind==="boundary"?data.d||"":data.type==="stroke"?data.d||"":null,
    artwork:kind==="item"?data:null,outlineOnly:kind==="boundary"
  };
  if(kind==="boundary"&&!node.path)return null;
  if(kind==="item"&&!["vector","image","stroke"].includes(data.type))node.unsupported=true;
  if(kind!=="boundary"&&kind!=="item")return null;
  return node;
}
export function orderScene(nodes){
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const memo=new Map(),visiting=new Set();
  const depthOf=id=>{
    if(memo.has(id))return memo.get(id);
    const n=byId.get(id);if(!n)return 0;
    if(visiting.has(id))return 0;
    visiting.add(id);
    const p=n.parentId?byId.get(n.parentId):null;
    const depth=p?depthOf(p.id)+1:0;
    visiting.delete(id);memo.set(id,depth);return depth;
  };
  for(const node of nodes)node.depth=depthOf(node.id)+(node.kind==="item"?.5:0);
  return nodes.sort((a,b)=>a.depth-b.depth||a.order-b.order||a.id.localeCompare(b.id));
}
export function expandRect(rect,factor=1.5){
  const cx=(rect.minX+rect.maxX)/2,cy=(rect.minY+rect.maxY)/2;
  const hx=(rect.maxX-rect.minX)*factor/2,hy=(rect.maxY-rect.minY)*factor/2;
  return{minX:cx-hx,minY:cy-hy,maxX:cx+hx,maxY:cy+hy};
}
export function containsRect(outer,inner){
  return outer && inner.minX>=outer.minX && inner.maxX<=outer.maxX &&
    inner.minY>=outer.minY && inner.maxY<=outer.maxY;
}
