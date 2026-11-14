/* Infinite Frames disposable guest world. No writes to production if_shared_* data. */
(function(root){
"use strict";
const API="https://xqfevafhjbdulhcqcmao.supabase.co",KEY="sb_publishable_olDMWJAdn9VYjJLK9E29eA_BOIANXmO";
const PROFILE_KEY="if-sandbox-profiles",ACTIVE_KEY="if-sandbox-active",WORLD_KEY="if-sandbox-world";
const colours=["#3fd8ff","#ff52b9","#a866ff","#ff9147","#ffe07a","#66e3b2"];
const empty=()=>({frames:[{n:1,status:"open"}],boundaries:[],items:[],messages:[],votes:[],events:[]});
const read=(key,otherwise)=>{try{return JSON.parse(root.localStorage.getItem(key)||"null")??otherwise}catch{return otherwise}};
const write=(key,data)=>root.localStorage.setItem(key,JSON.stringify(data));
const randomHex=bytes=>{const data=new Uint8Array(bytes);root.crypto.getRandomValues(data);return Array.from(data,x=>x.toString(16).padStart(2,"0")).join("")};
const validWorld=id=>/^if-test-[a-f0-9]{32}$/.test(id||"");
const worldFromLink=()=>{try{return new URL(root.location.href).searchParams.get("testWorld")}catch{return null}};
let world=worldFromLink();if(!validWorld(world))world=read(WORLD_KEY,null);
if(!validWorld(world))world="if-test-"+randomHex(16);
write(WORLD_KEY,world);
const profiles=()=>read(PROFILE_KEY,[]);
const active=()=>profiles().find(p=>p.id===read(ACTIVE_KEY,null))||null;
const el=(tag,label,style)=>{const v=root.document.createElement(tag);if(label!==null)v.textContent=label;if(style)v.style.cssText=style;return v};
const btn="min-height:39px;border:1px solid #50667f;border-radius:10px;background:#203246;color:#eaf3ff;font:700 12px system-ui;padding:9px;cursor:pointer";
const panelCss="width:min(440px,100%);max-height:87vh;overflow:auto;border:1px solid #566a8299;border-radius:19px;background:#111723;color:#f4f8ff;padding:19px;display:flex;flex-direction:column;gap:12px;font:13px system-ui";
const info={local:false,cloud:false,message:"Not saved yet"};
let current=null,entryButton=null;
function showStatus(message,cloud){
 info.message=message;info.cloud=!!cloud;
 if(entryButton){const p=active();entryButton.textContent="◉ "+(p?p.name:"GUEST")+" · "+(cloud?"CLOUD":"LOCAL");entryButton.title=message+" | Open test profiles"}
}
function switchProfile(p,reload){
 const previous=active();
 if(previous){
  const list=profiles(),old=list.find(x=>x.id===previous.id);
  if(old){old.avatar=read("if-avatar",null);write(PROFILE_KEY,list)}
 }
 write(ACTIVE_KEY,p.id);write("if-name",p.name);write("if-avatar",p.avatar||null);
 root.localStorage.setItem("if-uid",p.id);
 if(reload)root.location.reload();
}
function profileDialog(required){
 return new Promise(resolve=>{
  const overlay=el("div",null,"position:fixed;inset:0;z-index:2147483643;background:#040710ed;backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:center;padding:15px");
  const panel=el("div",null,panelCss),label=el("strong","INFINITE FRAMES · TEST PROFILES","font-size:15px;letter-spacing:.08em");
  const msg=el("div","Passwordless test identities. Artwork is stored locally and backed up in a separate Supabase sandbox when connected.","font:12px/1.5 system-ui;color:#aab9ce");
  const status=el("div",info.message,"font:11px/1.5 system-ui;color:#a5e4ef;overflow-wrap:anywhere");
  overlay.append(panel);panel.append(label,msg);
  const list=profiles();
  if(list.length){
   panel.append(el("div","SWITCH ARTIST","font:700 10px system-ui;color:#a3b4c7;letter-spacing:.12em"));
   const choices=el("div",null,"display:flex;flex-wrap:wrap;gap:8px");
   for(const p of list){const b=el("button",p.name,btn+";color:"+p.color+";border-color:"+p.color);
    b.onclick=()=>{switchProfile(p,!required);overlay.remove();resolve(p)};choices.append(b)}
   panel.append(choices);
  }
  panel.append(el("div","CREATE DUMMY PROFILE","font:700 10px system-ui;color:#a3b4c7;letter-spacing:.12em"));
  const name=el("input",null,"height:43px;border:1px solid #62758d;border-radius:10px;background:#090e18;color:#fff;padding:11px;font:14px system-ui");
  name.placeholder="Artist nickname";name.maxLength=32;name.value="Test Artist "+(list.length+1);
  panel.append(name);
  const swatches=el("div",null,"display:flex;gap:10px;flex-wrap:wrap"),buttons=[];
  let color=colours[0];
  for(const c of colours){const b=el("button","", "width:32px;height:32px;border:3px solid "+(c===color?"white":"#111723")+";border-radius:50%;background:"+c+";cursor:pointer");
   b.title=c;b.setAttribute("aria-label","Choose "+c);b.onclick=()=>{color=c;for(const p of buttons)p.node.style.borderColor=p.color===color?"white":"#111723"};
   buttons.push({node:b,color:c});swatches.append(b)}
  panel.append(swatches);
  const create=el("button","CREATE PROFILE & ENTER",btn+";background:#c9e9ff;color:#121720");
  create.onclick=()=>{const value=name.value.trim().replace(/\s+/g," ").slice(0,32);if(!value){status.textContent="Enter a profile name.";return}
   const p={id:"guest-"+randomHex(10),name:value,color,createdAt:Date.now(),avatar:null};
   write(PROFILE_KEY,[...profiles(),p]);switchProfile(p,!required);
   overlay.remove();resolve(p);
  };
  panel.append(create);
  if(!required){
   const copy=el("button","COPY LINK TO THIS TEST WORLD",btn);
   copy.onclick=async()=>{const url=new URL(root.location.href);url.searchParams.set("testWorld",world);
    try{await root.navigator.clipboard.writeText(url.toString());status.textContent="Test link copied."}catch(e){status.textContent=url.toString()}
   };
   const sync=el("button","SAVE TO SUPABASE NOW",btn);sync.onclick=async()=>{
    status.textContent="Synchronizing…";
    try{const ok=await current?.sync();status.textContent=ok?"Test artwork saved to Supabase.":info.message}
    catch(e){status.textContent=e.message}
   };
   const reset=el("button","RESET TEST CANVAS",btn+";color:#ffc8c8;border-color:#a66");
   let armed=false;reset.onclick=async()=>{
    if(!armed){armed=true;reset.textContent="CONFIRM RESET TEST ART";return}
    reset.disabled=true;status.textContent="Clearing test art…";
    try{await current.reset();root.location.reload()}catch(e){status.textContent=e.message;reset.disabled=false}
   };
   const close=el("button","BACK TO CANVAS",btn);
   close.onclick=()=>{overlay.remove();resolve(active())};
   panel.append(copy,sync,reset,close);
  }
  panel.append(status,el("div","Disposable sandbox. Anyone with this world link can view or edit its test artwork. Do not add private information.","font:10px/1.5 system-ui;color:#94a3b6"));
  root.document.body.append(overlay);name.focus();
 });
}
async function start(){
 let p=active();if(!p)p=await profileDialog(true);
 if(!p)throw Error("No test identity selected");
 entryButton=el("button","", "position:fixed;right:10px;top:calc(env(safe-area-inset-top) + 67px);z-index:2100000;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:30px;border:1px solid #61859b;border-radius:20px;padding:5px 10px;background:#0c1420ee;color:#d0efff;font:700 10px system-ui;cursor:pointer");
 entryButton.onclick=()=>profileDialog(false);root.document.body.append(entryButton);
 showStatus("Ready for testing; local storage active",false);
 return p;
}
let databasePromise=null;
function database(){
 if(databasePromise)return databasePromise;
 databasePromise=new Promise((resolve,reject)=>{
  const request=root.indexedDB.open("if-guest-test-db",1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("worlds"))request.result.createObjectStore("worlds")};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });return databasePromise;
}
async function localRead(){
 try{const db=await database();return await new Promise((resolve,reject)=>{
  const q=db.transaction("worlds","readonly").objectStore("worlds").get(world);
  q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);
 })}catch(e){return read("if-guest-local-"+world,null)}
}
async function localWrite(snapshot){
 try{const db=await database();await new Promise((resolve,reject)=>{
  const tr=db.transaction("worlds","readwrite");tr.objectStore("worlds").put(snapshot,world);
  tr.oncomplete=resolve;tr.onerror=()=>reject(tr.error);tr.onabort=()=>reject(tr.error);
 })}catch(e){try{write("if-guest-local-"+world,snapshot)}catch(err){throw Error("Unable to save test data: "+err.message)}}
}
const validDoc=d=>d&&["boundaries","items","frames","messages","votes","events"].every(k=>Array.isArray(d[k]));
const unique=(a,b,identity)=>{const rows=[],seen=new Set();for(const item of [...a,...b]){const id=identity(item);if(seen.has(id))continue;seen.add(id);rows.push(item)}return rows};
function merge(a,b){
 const result={...empty()};
 for(const k of ["boundaries","items","messages","votes","events"])result[k]=unique(a[k]||[],b[k]||[],v=>k==="votes"?v.msgId+"|"+v.voterId:v.id);
 const frames=new Map((b.frames||[]).map(x=>[x.n,x]));
 for(const f of a.frames||[])frames.set(f.n,{...(frames.get(f.n)||{}),...f});
 result.frames=[...frames.values()].sort((x,y)=>x.n-y.n);
 if(!result.frames.length)result.frames=[{n:1,status:"open"}];
 return result;
}
async function request(method,body){
 const headers={"apikey":KEY,"x-if-guest-world":world,"Content-Type":"application/json"};
 if(body)headers.Prefer="resolution=merge-duplicates,return=minimal";
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
 try{
  const query=method==="GET"?"?id=eq."+encodeURIComponent(world)+"&select=doc,revision":"?on_conflict=id";
  const res=await root.fetch(API+"/rest/v1/if_guest_test_worlds"+query,{method,mode:"cors",signal:controller.signal,headers,...(body?{body:JSON.stringify(body)}:{})});
  if(!res.ok){let error=await res.text();try{error=JSON.parse(error).message||error}catch{}throw Error("Supabase "+res.status+": "+String(error).slice(0,180))}
  return method==="GET"?res.json():true;
 }finally{clearTimeout(timer)}
}
function createBackend(){
 let state=empty(),rev=0,synced=false,loaded=false,channel=null;
 const subscribers=new Set();
 const notify=e=>{for(const fn of subscribers)try{fn(e)}catch(err){console.warn("Guest event listener",err)}};
 const mark=(message,cloud)=>{synced=cloud;info.local=loaded;showStatus(message,cloud)};
 const loadRemote=async()=>{const rows=await request("GET");const item=rows?.[0];return item&&validDoc(item.doc)?{doc:item.doc,revision:item.revision||0}:null};
 async function load(){
  const local=await localRead();
  if(validDoc(local?.doc)){state=local.doc;rev=local.revision||0}
  try{
   const remote=await loadRemote();
   if(remote){state=merge(state,remote.doc);rev=Math.max(rev,remote.revision);await localWrite({doc:state,revision:rev});mark("Shared test world loaded from Supabase",true)}
   else mark("Test canvas loaded; cloud backup on next save",true);
  }catch(e){mark("Local testing: "+e.message,false)}
  loaded=true;
  if(typeof BroadcastChannel!=="undefined"){
   channel=new BroadcastChannel("if-guest-"+world);
   channel.onmessage=async event=>{
    if(event.data?.type!=="update")return;
    const latest=await localRead();
    if(latest?.revision>rev){
     const old=state;state=merge(latest.doc,state);rev=latest.revision;
     for(const [key,type] of [["boundaries","boundary"],["items","item"],["messages","message"],["votes","vote"],["events","event"]]){
      const seen=new Set((old[key]||[]).map(x=>x.id||x.msgId+"|"+x.voterId));
      for(const x of state[key])if(!seen.has(x.id||x.msgId+"|"+x.voterId))notify({type,row:x});
     }
     const prior=new Map(old.frames.map(x=>[x.n,x.status]));
     for(const frame of state.frames)if(prior.get(frame.n)!==frame.status)notify({type:"frame",row:frame});
    }
   };
  }
  return state;
 }
 async function sync(replace=false){
  let cloud;
  try{cloud=await loadRemote()}catch(e){mark("Saved locally; cloud unavailable: "+e.message,false);return false}
  if(cloud){if(!replace)state=merge(state,cloud.doc);rev=Math.max(rev,cloud.revision)+1;await localWrite({doc:state,revision:rev})}
  try{
   await request("POST",{id:world,doc:state,revision:rev,updated_at:new Date().toISOString()});
   mark("Saved to isolated Supabase test world",true);return true;
  }catch(e){mark("Saved locally; cloud unavailable: "+e.message,false);return false}
 }
 async function save(replace=false){
  rev++;await localWrite({doc:state,revision:rev});loaded=true;
  mark("Saved on this device",false);
  channel?.postMessage({type:"update"});
  await sync(replace);
 }
 function append(key,rows){state[key]=unique(state[key],rows,key==="votes"?v=>v.msgId+"|"+v.voterId:v=>v.id)}
 const backend={
  mode:"guest-sandbox",guestTest:true,cloud:false,canonicalCloud:false,world,
  get signedIn(){return true},get cloudOnline(){return synced},
  load,subscribe(fn){subscribers.add(fn);return()=>subscribers.delete(fn)},
  onPresence(fn){fn(1);return()=>{}},
  async publish({boundaries=[],items=[],events=[]}){
   append("boundaries",boundaries);append("items",items);append("events",events);
   await save();
  },
  async sendMessage(message){append("messages",[message]);await save();notify({type:"message",row:message})},
  async vote(vote){append("votes",[vote]);await save();notify({type:"vote",row:vote})},
  async openNextFrame(n,events=[]){
   state.frames=state.frames.map(x=>x.n===n?{...x,status:"published"}:x);
   if(!state.frames.some(x=>x.n===n+1))state.frames.push({n:n+1,status:"open"});
   append("events",events);await save();
   notify({type:"frame",row:{n:n+1,status:"open"}});
  },
  async reset(){state=empty();await save(true);return true},
  async regionById(id){return state.boundaries.find(x=>x.id===id)||null},
  async searchRegions(query,{limit=40}={}){
   const q=String(query||"").toLowerCase();
   return state.boundaries.filter(x=>[x.name,x.founder,x.color].some(v=>String(v||"").toLowerCase().includes(q))).slice(0,limit).map(x=>({...x,author:x.founder}));
  },
  async browseRegions({limit=48,after,color}={}){
   const rows=state.boundaries.filter(x=>!color||String(x.color||"").toLowerCase()===String(color).toLowerCase()).map(x=>({...x,key:"b:"+x.id,author:x.founder||x.author})).sort((a,b)=>a.key.localeCompare(b.key));
   const offset=after?rows.findIndex(x=>x.key>after):0,start=offset<0?rows.length:offset,items=rows.slice(start,start+limit);
   return{items,hasMore:start+limit<rows.length,nextCursor:items.at(-1)?.key||null};
  },
  async availableColors(){return [...new Set(state.boundaries.map(x=>x.color).filter(c=>/^#[0-9a-f]{6}$/i.test(c||"")))]},
  getSnapshot:()=>state,sync,
  openAccount:()=>profileDialog(false)
 };
 current=backend;return backend;
}
root.IFGuest={start,createBackend,openProfiles:()=>profileDialog(false),active,world,getStatus:()=>({...info})};
})(typeof window!=="undefined"?window:globalThis);