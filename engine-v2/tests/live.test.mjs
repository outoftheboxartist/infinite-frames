import test from "node:test";
import assert from "node:assert/strict";
import { PublishedWorldReader,convertPublishedEntry,orderScene,containsRect,expandRect } from "../src/live.js";

const bundlePath="00000000-0000-4000-8000-000000000001/geometry-one.json";
const rows=[
 {id:"curve1",world_id:"root",kind:"boundary",frame_n:1,parent_id:null,
  name:"Original region",author_display:"The founder",published_at:"2026-11-14T10:00:00Z",
  color:"#ffffff",min_x:10,min_y:20,max_x:160,max_y:180,bundle_path:bundlePath,bundle_index:0},
 {id:"shape1",world_id:"root",kind:"item",frame_n:1,parent_id:"curve1",
  name:"Inside region",author_display:"Another artist",published_at:"2026-11-14T10:01:00Z",
  color:"#5acaca",min_x:30,min_y:40,max_x:140,max_y:160,bundle_path:bundlePath,bundle_index:1}
];
const document={v:1,entries:[
 {kind:"boundary",data:{id:"curve1",type:"boundary",d:"M10 20L160 20L160 180L10 180Z"}},
 {kind:"item",data:{id:"shape1",type:"vector",b:"curve1",paths:[{d:"M30 40L140 40L140 160Z",color:"#5acaca"}],t:{x:10,y:0,r:20,s:1.4}}}
]};
function mockReader({denied=false,missing=false}={}){
 const calls=[];
 const fetcher=async (url,options)=>{
   calls.push({url,method:options.method,body:options.body});
   if(url.includes("/if_shared_frames"))return{ok:true,status:200,json:async()=>[{frame_n:1,status:"open"}]};
   if(url.includes("/rpc/if_shared_viewport_page"))return{ok:true,status:200,json:async()=>missing?[]:rows};
   if(url.includes("/storage/v1/object/"))return denied?{
      ok:false,status:403,text:async()=>JSON.stringify({message:"access denied"})
   }:{ok:true,status:200,json:async()=>document};
   throw Error("Unexpected request "+url);
 };
 return {reader:new PublishedWorldReader({fetcher,url:"https://demo.supabase.co",key:"sb_publishable_test"}),calls};
}
const rect={minX:0,minY:0,maxX:200,maxY:200};
test("existing immutable bundles hydrate matching real-world vector and boundary records",async()=>{
 const {reader,calls}=mockReader();
 assert.equal((await reader.listFrames()).length,1);
 const v=await reader.load(rect,[1],1,{max:1400});
 assert.equal(v.metadataCount,2);
 assert.equal(v.missing,0);assert.equal(v.bundleCount,1);
 assert.equal(v.nodes.length,2);
 const sorted=orderScene(v.nodes);
 assert.equal(sorted[0].path,"M10 20L160 20L160 180L10 180Z");
 assert.equal(sorted[1].artwork.t.s,1.4);
 assert.equal(sorted[1].parentId,"curve1");
 assert.ok(sorted[0].depth<sorted[1].depth);
 assert.ok(calls.every(x=>x.method==="GET"||x.url.includes("/rpc/if_shared_viewport_page")));
 assert.equal(calls.filter(x=>x.url.includes("/storage/v1/object/")).length,1);
 await reader.bundle(bundlePath);
 assert.equal(calls.filter(x=>x.url.includes("/storage/v1/object/")).length,1,"immutable bundle cached");
});
test("blocked private bundle access reports missing geometry instead of fake art",async()=>{
 const {reader}=mockReader({denied:true});
 const v=await reader.load(rect,[1],1);
 assert.equal(v.nodes.length,0);assert.equal(v.missing,2);
 assert.equal(v.errors.length,1);assert.match(v.errors[0].message,/403/);
});
test("empty published world is valid and distinct from a permissions failure",async()=>{
 const {reader}=mockReader({missing:true});
 const v=await reader.load(rect,[1],1);
 assert.equal(v.nodes.length,0);assert.equal(v.metadataCount,0);
 assert.equal(v.errors.length,0);assert.equal(v.missing,0);
});
test("scene normalization rejects invalid bounds and does not change exact original paths",()=>{
 const original=rows[0];
 const node=convertPublishedEntry(original,document.entries[0].data);
 assert.equal(node.path,document.entries[0].data.d);
 assert.equal(convertPublishedEntry({...original,min_x:NaN},document.entries[0].data),null);
 assert.equal(convertPublishedEntry({...original,min_x:200,max_x:10},document.entries[0].data),null);
});
test("viewport prefetch permits camera motion before re-querying",()=>{
 const bigger=expandRect(rect,1.7);
 assert.ok(containsRect(bigger,rect));
 assert.equal(containsRect(rect,bigger),false);
});
