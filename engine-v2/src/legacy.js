// Explicit, read-only V1 archive bridge. Source geometry and authorship are not altered.
// The legacy file is JavaScript; extract its JSON literal without ever executing the script.
export const LEGACY_URL="./data/legacy-five-frames.json";
export function parseLegacyArchive(text) {
  const prefix="window.__ST=";
  if(typeof text!=="string")throw Error("Not an Infinite Frames archive");
  let obj;
  if(text.trimStart().startsWith("{"))obj=JSON.parse(text);
  else{
    if(!text.startsWith(prefix))throw Error("Not an Infinite Frames archive");
    const end=text.indexOf(";try{localStorage.clear()",prefix.length);
    if(end<0)throw Error("Archive does not have the expected format");
    obj=JSON.parse(text.slice(prefix.length,end));
  }
  if(!Array.isArray(obj.boundaries)||!Array.isArray(obj.items)||!Array.isArray(obj.frames))
    throw Error("Legacy archive is missing artwork collections");
  return obj;
}
export async function fetchLegacyArchive({url=LEGACY_URL,fetcher=fetch,signal}={}) {
  const response=await fetcher(url,{signal});
  if(!response.ok)throw Error("Could not download archived canvas: HTTP "+response.status);
  return parseLegacyArchive(await response.text());
}
const finite=n=>Number.isFinite(n);
const rectOf=(x,y,w,h)=>({minX:x,minY:y,maxX:x+w,maxY:y+h});
function pointsBox(d) {
  // Every cubic-Bézier segment is contained in the hull of its control points.
  // The archive uses absolute M/L/C pairs. Conservative bounds never simplify paths.
  const pairs=[...String(d||"").matchAll(/([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)\s*[,\s]\s*([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)/gi)];
  if(!pairs.length)return null;
  const box={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const pair of pairs){
    const x=+pair[1],y=+pair[2];
    if(!finite(x)||!finite(y))continue;
    box.minX=Math.min(box.minX,x);box.minY=Math.min(box.minY,y);
    box.maxX=Math.max(box.maxX,x);box.maxY=Math.max(box.maxY,y);
  }
  return finite(box.minX)?box:null;
}
function boxUnion(a,b) {
  if(!a)return b;if(!b)return a;
  return {minX:Math.min(a.minX,b.minX),minY:Math.min(a.minY,b.minY),maxX:Math.max(a.maxX,b.maxX),maxY:Math.max(a.maxY,b.maxY)};
}
function transformed(box,art){
  if(!box)return null;
  const t=art?.t||{}, s=finite(t.s)?t.s:1,angle=(t.r||0)*Math.PI/180,cx=finite(art.cx)?art.cx:0,cy=finite(art.cy)?art.cy:0;
  const co=Math.cos(angle),sn=Math.sin(angle);
  const out={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const x of [box.minX,box.maxX])for(const y of [box.minY,box.maxY]){
    const xx=(x-cx)*s,yy=(y-cy)*s;
    const tx=xx*co-yy*sn+cx+(t.x||0),ty=xx*sn+yy*co+cy+(t.y||0);
    out.minX=Math.min(out.minX,tx);out.minY=Math.min(out.minY,ty);
    out.maxX=Math.max(out.maxX,tx);out.maxY=Math.max(out.maxY,ty);
  }
  return out;
}
export function convertArchiveToScene(archive,frameN=5) {
  const visible=archive.items.filter(i=>Number(i.frameN||1)===Number(frameN));
  const nodes=[];
  let seq=0;
  const make=(a,kind,bbox)=>{
    if(!bbox||!Object.values(bbox).every(finite))return null;
    const color=String(a.color||a.paths?.[0]?.color||"#b2c6da");
    const node={
      id:String(a.id),parentId:a.clipParent||a.b||null,kind,
      name:String(a.name||a.fname||"Legacy artwork").slice(0,160),
      author:String(a.founder||a.author||"Contributor").slice(0,64),
      frame:Number(a.frameN||1),order:Number(a.at||seq++),depth:0,color,
      x:(bbox.minX+bbox.maxX)/2,y:(bbox.minY+bbox.maxY)/2,
      r:Math.max(bbox.maxX-bbox.minX,bbox.maxY-bbox.minY)/2,
      bbox,path:kind==="boundary"?a.d:(a.type==="stroke"?a.d:null),
      artwork:kind==="item"?a:null,outlineOnly:kind==="boundary"
    };
    return node;
  };
  for(const b of archive.boundaries){
    const node=make(b,"boundary",pointsBox(b.d));
    if(node)nodes.push(node);
  }
  for(const art of visible){
    let bbox=null;
    if(art.type==="image"&&[art.x,art.y,art.w,art.h].every(finite))
      bbox=rectOf(art.x,art.y,art.w,art.h);
    else if(art.type==="vector")
      for(const path of art.paths||[])bbox=boxUnion(bbox,pointsBox(path.d));
    else if(art.type==="stroke")bbox=pointsBox(art.d);
    const node=make(art,"item",transformed(bbox,art));
    if(node)nodes.push(node);
  }
  return nodes;
}
