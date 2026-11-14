import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const src = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)),"utf8");
function extract(start,end) {
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"expected original app method: "+start);
 return src.slice(a,b);
}
const IFViewportQuadtree=new Function("window",extract("class IFViewportQuadtree{","class Nc extends")+";return IFViewportQuadtree")({IFSpatial:{entityBox:n=>n.bbox}});
test("quadtree returns viewport candidates without changing the source artwork",()=>{
 const entries=[
 {id:"window1",bbox:{x:0,y:0,w:1000,h:1000}},
 {id:"nested",bbox:{x:200,y:200,w:100,h:100}},
 {id:"detail",bbox:{x:220,y:220,w:20,h:20}},
 {id:"far",bbox:{x:750,y:750,w:50,h:50}}
 ];
 const sourceSnapshot=JSON.stringify(entries);
 const tree=new IFViewportQuadtree(entries);
 assert.deepEqual(new Set(tree.query({x:224,y:224,w:2,h:2}).map(x=>x.id)),new Set(["window1","nested","detail"]));
 assert.deepEqual(new Set(tree.query({x:760,y:760,w:2,h:2}).map(x=>x.id)),new Set(["window1","far"]));
 assert.equal(tree.query({x:-100,y:-100,w:10,h:10}).length,0);
 assert.equal(JSON.stringify(entries),sourceSnapshot,"unchanged original geometry metadata");
});
test("mobile tap position uses the actual letterboxed SVG viewport",()=>{
 const fn=new Function("DOMPoint","return ({"+extract("world(n){","prismWrap(")+"}).world")(undefined);
 const ctx={state:{view:{x:500,y:500,z:1}},svgEl:{
  getScreenCTM:()=>null,getBoundingClientRect:()=>({left:0,top:0,width:360,height:780})
 }};
 assert.deepEqual(fn.call(ctx,{clientX:180,clientY:390}),{x:500,y:500});
 assert.deepEqual(fn.call(ctx,{clientX:180,clientY:210}),{x:500,y:0});
});
test("clicking nested visible curves selects the smallest actual hit, not Window 1",()=>{
 const fn=new Function("return ({"+extract("tap(n){\n const radius=","select(n){")+"}).tap")();
 const regions=[
 {id:"window1",name:"Window 1",bbox:{x:0,y:0,w:1000,h:1000},d:"window1"},
 {id:"nested",bbox:{x:200,y:200,w:100,h:100},d:"nested"},
 {id:"detail",bbox:{x:220,y:220,w:20,h:20},d:"detail"}
 ];
 const tree=new IFViewportQuadtree(regions);
 const selected=[];
 const context={
  state:{view:{z:1},B:regions,drafts:[],selected:null,tool:"pan"},
  svgEl:{clientWidth:390},
  indexedVisible:(_,rect)=>tree.query(rect),
  allB:()=>regions,
  boundaryHit:(r,n)=>n.x>=r.bbox.x&&n.x<=r.bbox.x+r.bbox.w&&n.y>=r.bbox.y&&n.y<=r.bbox.y+r.bbox.h,
  bbox:d=>regions.find(r=>r.id===d).bbox,
  select:id=>selected.push(id),hitImg:()=>null,setState:()=>{}
 };
 fn.call(context,{x:225,y:225});
 fn.call(context,{x:50,y:50});
 assert.deepEqual(selected,["detail","window1"]);
});
test("Find curve searches current loaded geometry when shared-world catalog is empty",async()=>{
 const fn=new Function("window","return ({"+extract("curveSearchBackend(){","openCurveSearch(){")+"}).curveSearchBackend")({
  IFSpatial:{boundsFromPath:()=>({x:1,y:1,w:5,h:5})}
 });
 const rows=[
  {id:"w1",name:"Window 1",color:"#ff0000",founder:"Alpha",frameN:1,d:"M0 0L10 0Z"},
  {id:"heart",name:"Little Heart",color:"#00ffff",founder:"Beta",frameN:2,d:"M2 2L4 2Z"}
 ];
 const backend=fn.call({allB:()=>rows,props:{backend:{
  searchRegions:async()=>[],browseRegions:async()=>({items:[],hasMore:false}),
  availableColors:async()=>[],regionById:async()=>null
 }}});
 assert.deepEqual((await backend.searchRegions("heart")).map(x=>x.id),["heart"]);
 assert.deepEqual((await backend.searchRegions("beta")).map(x=>x.id),["heart"]);
 assert.equal((await backend.regionById("heart")).d,"M2 2L4 2Z");
 assert.equal((await backend.browseRegions({limit:48})).items.length,2);
 const last=(await backend.browseRegions({limit:48})).nextCursor;
 assert.equal((await backend.browseRegions({limit:48,after:last})).items.length,0);
 assert.deepEqual(await backend.availableColors(),["#00ffff","#ff0000"]);
});
test("viewport optimization retains an off-screen parent for visible clipped content",()=>{
 const fn=new Function("return ({"+extract("visibleCurves(rect){","isLive(){")+"}).visibleCurves")();
 const parent={id:"outer",d:"M0 0Z",bbox:{x:0,y:0,w:10,h:10}};
 const image={id:"image",b:"outer",bbox:{x:100,y:100,w:20,h:20}};
 const app={
  state:{B:[parent],drafts:[],frames:[{n:1,items:[image]}],viewing:0,onion:false,view:{z:1},selected:null},
  svgEl:{clientWidth:390},
  indexedVisible:(rows,rect,minWorld=0)=>rows.filter(x=>
   x.bbox.x<=rect.x+rect.w&&x.bbox.x+x.bbox.w>=rect.x&&
   x.bbox.y<=rect.y+rect.h&&x.bbox.y+x.bbox.h>=rect.y&&
   Math.max(x.bbox.w,x.bbox.h)>=minWorld)
 };
 const result=fn.call(app,{x:100,y:100,w:50,h:50});
 assert.ok(result.some(x=>x.id==="outer"),"ancestor clip required for a visible child");
});
