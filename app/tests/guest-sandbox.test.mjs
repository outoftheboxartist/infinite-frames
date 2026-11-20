import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createContext,runInContext} from "node:vm";
import {webcrypto} from "node:crypto";
const source=readFileSync(fileURLToPath(new URL("../guest-sandbox.js",import.meta.url)),"utf8");
const curve={id:"small",name:"Tiny Heart",d:"M0 0L10 0L10 10Z",frameN:1,color:"#ff52b9"};
function harness(){
 let online=true;const store=new Map(),cloud=new Map(),calls=[];
 const win={
  location:{href:"https://test.local/",search:"",reload(){}},
  crypto:webcrypto,localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
  fetch:async(url,req)=>{
   calls.push({url,method:req.method});
   assert.ok(url.includes("/rest/v1/if_guest_test_worlds"),"must NEVER write production");
   if(!online)throw Error("offline");
   const id=req.headers["x-if-guest-world"];
   assert.match(id,/^if-test-[a-f0-9]{32}$/);
   if(req.method==="GET")return{ok:true,status:200,json:async()=>cloud.has(id)?[cloud.get(id)]:[]};
   const body=JSON.parse(req.body);assert.equal(body.id,id);cloud.set(id,body);
   return{ok:true,status:201,text:async()=>""};
  }
 };
 runInContext(source,createContext({window:win,URL,Uint8Array,AbortController,setTimeout,clearTimeout,console}));
 return{guest:win.IFGuest,cloud,store,calls,setOnline:v=>online=v};
}
test("guest publishes unchanged SVG to local and isolated Supabase",async()=>{
 const h=harness(),b=h.guest.createBackend();
 assert.equal(b.cloud,false);assert.equal(b.guestTest,true);
 await b.load();await b.publish({boundaries:[curve],items:[],events:[]});
 assert.equal(b.cloudOnline,true);
 assert.equal(h.cloud.get(h.guest.world).doc.boundaries[0].d,curve.d);
 assert.ok(h.store.has("if-guest-local-"+h.guest.world));
 assert.ok(h.calls.some(x=>x.method==="POST"));
});
test("reset overwrites test world and leaves production untouched",async()=>{
 const h=harness(),b=h.guest.createBackend();
 await b.load();await b.publish({boundaries:[curve],items:[],events:[]});
 await b.reset();
 assert.equal(h.cloud.get(h.guest.world).doc.boundaries.length,0);
 const reopened=h.guest.createBackend();await reopened.load();
 assert.equal(reopened.getSnapshot().boundaries.length,0);
});
test("offline reset stays empty after reload and syncs the reset when online",async()=>{
 const h=harness(),b=h.guest.createBackend();
 await b.load();await b.publish({boundaries:[curve],items:[],events:[]});
 h.setOnline(false);await b.reset();
 const reopened=h.guest.createBackend();await reopened.load();
 assert.equal(reopened.getSnapshot().boundaries.length,0);
 h.setOnline(true);assert.equal(await reopened.sync(),true);
 assert.equal(h.cloud.get(h.guest.world).doc.boundaries.length,0);
});
test("anonymous test comments, votes and frames persist",async()=>{
 const h=harness(),b=h.guest.createBackend();await b.load();
 await b.sendMessage({id:"m1",who:"Guest",text:"More hearts"});
 await b.vote({msgId:"m1",voterId:"guest1",kind:"agree"});
 await b.openNextFrame(1,[{id:"e1",text:"Frame 2"}]);
 const doc=h.cloud.get(h.guest.world).doc;
 assert.equal(doc.messages.length,1);assert.equal(doc.votes.length,1);
 assert.equal(doc.frames.length,2);assert.equal(doc.frames[0].status,"published");
});
