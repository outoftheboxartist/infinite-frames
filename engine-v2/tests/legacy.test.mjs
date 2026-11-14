import test from "node:test";
import assert from "node:assert/strict";
import { parseLegacyArchive, convertArchiveToScene, fetchLegacyArchive } from "../src/legacy.js";
const source={boundaries:[
 {id:"b1",type:"boundary",d:"M0 0L200 0L200 200L0 200Z",name:"Main",frameN:1}
 ],frames:[{n:1},{n:2}],items:[
 {id:"vector1",type:"vector",frameN:1,b:"b1",cx:100,cy:100,t:{x:20,y:10,r:90,s:2},paths:[{d:"M90 90L110 90L110 110Z",color:"#ffffff"}]},
 {id:"image2",type:"image",frameN:2,b:"b1",src:"data:image/png;base64,AAAA",x:10,y:20,w:50,h:40}
 ]};
const script="window.__ST="+JSON.stringify(source)+";try{localStorage.clear()}catch(e){}";
test("archive reader parses the JSON only, never runs the original JavaScript side effects",()=>{
 const before=globalThis.localStorage;
 globalThis.localStorage={clear(){throw Error("Legacy JavaScript executed!")}};
 try {assert.deepEqual(parseLegacyArchive(script),source)}
 finally {if(before===undefined)delete globalThis.localStorage;else globalThis.localStorage=before}
});
test("legacy scene retains exact SVG and frame-specific content",()=>{
 const one=convertLegacySnapshot(1),two=convertLegacySnapshot(2);
 function convertLegacySnapshot(frame){return convertArchiveToScene(source,frame)}
 assert.equal(one.length,2);assert.equal(two.length,2);
 assert.equal(one[0].path,source.boundaries[0].d);
 assert.equal(one[1].artwork.t.r,90);
 assert.equal(one[1].parentId,"b1");
 assert.ok(one[1].bbox.maxX>110,"transformed bounding box expanded");
 assert.equal(two[1].artwork.src,"data:image/png;base64,AAAA");
 assert.ok(one.every(n=>Object.values(n.bbox).every(Number.isFinite)));
});
test("strict expected archive format rejects arbitrary scripts",()=>{
 assert.throws(()=>parseLegacyArchive("alert('evil')"),/Not an Infinite Frames archive/);
 assert.throws(()=>parseLegacyArchive("window.__ST={};alert(2)"),/expected format/);
});
test("remote archive can be fetched but never evaluated",async()=>{
 const fetcher=async()=>({ok:true,status:200,text:async()=>script});
 const got=await fetchLegacyArchive({fetcher});
 assert.equal(got.items.length,2);
});
