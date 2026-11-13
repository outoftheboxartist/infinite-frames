/* Infinite Frames local spatial backend.
   Replaces the localStorage-only fallback, retaining existing app events and data format.
   Legacy localStorage key stays untouched as migration backup. */
(function(root){
"use strict";
if(!root.IFSpatial)return;
root.IFSpatial.createBackend=function(config){
  const listeners=new Set(),presences=new Set(),peers=new Map();
  const id=Math.random().toString(36).slice(2);
  const channel=typeof root.BroadcastChannel==="function"?new root.BroadcastChannel("if-spatial-channel-v1"):null;
  let fallback=null,initializing=null,snapshot=null,spatial=null;
  const latest=()=>snapshot||{boundaries:[],items:[],frames:[{n:1,status:"open"}],messages:[],votes:[],events:[]};
  const notify=event=>listeners.forEach(fn=>{try{fn(event)}catch(e){console.warn("Spatial listener failed",e)}});
  const applyEvent=(event)=>{
    if(!snapshot)return;
    const {type,row}=event;
    const push=(key,compare="id")=>{if(!snapshot[key].some(x=>x[compare]===row[compare]))snapshot[key].push(row)};
    if(type==="boundary")push("boundaries");
    if(type==="item")push("items");
    if(type==="message")push("messages");
    if(type==="event")push("events");
    if(type==="vote"&&!snapshot.votes.some(v=>v.msgId===row.msgId&&v.voterId===row.voterId))snapshot.votes.push(row);
    if(type==="frame"){const x=snapshot.frames.find(f=>f.n===row.n);x?x.status=row.status:snapshot.frames.push(row)}
  };
  const publishEvent=event=>{notify(event);if(channel)channel.postMessage({kind:"event",event})};
  if(channel){
    channel.onmessage=e=>{
      const m=e.data||{};
      if(m.kind==="event"){applyEvent(m.event);notify(m.event)}
      if(m.kind==="heartbeat")peers.set(m.id,Date.now());
      if(m.kind==="bye")peers.delete(m.id);
    };
    const heartbeat=()=>channel.postMessage({kind:"heartbeat",id});
    heartbeat();const timer=setInterval(heartbeat,2000);
    root.addEventListener&&root.addEventListener("beforeunload",()=>{clearInterval(timer);channel.postMessage({kind:"bye",id});channel.close()});
  }
  function presence(fn){const f=()=>{const now=Date.now();let count=1;peers.forEach(t=>{if(now-t<6500)count++});fn(count)};
    presences.add(fn);f();const timer=setInterval(f,1500);return()=>{presences.delete(fn);clearInterval(timer)}}
  async function init(){
    if(initializing)return initializing;
    initializing=(async()=>{
      try{
        spatial=new (config.Store||root.IFSpatial.Store)();
        await spatial.open();
        snapshot=await spatial.loadCompatible();
        if(!snapshot){
          const legacy=await config.legacyLoad();
          await spatial.importLegacy(legacy);
          snapshot=await spatial.loadCompatible();
        }
        if(!snapshot)throw Error("Spatial migration did not produce a readable snapshot");
        return snapshot;
      }catch(err){
        console.warn("Spatial storage not available, using original local mode:",err);
        spatial=null;
        fallback=config.fallback();
        for(const handler of listeners)fallback.subscribe(handler);
        snapshot=await fallback.load();
        return snapshot;
      }
    })();return initializing;
  }
  async function commit(payload){
    await init();
    if(fallback)return fallback.publish(payload);
    const current=latest();
    const boundaries=[...current.boundaries],items=[...current.items],events=[...current.events];
    for(const b of payload.boundaries||[])if(!boundaries.some(x=>x.id===b.id))boundaries.push(b);
    for(const i of payload.items||[])if(!items.some(x=>x.id===i.id))items.push(i);
    for(const e of payload.events||[])if(!events.some(x=>x.id===e.id))events.push(e);
    const next={...current,boundaries,items,events};
    await spatial.putPublication(payload,{frames:next.frames,messages:next.messages,votes:next.votes,events:next.events});
    snapshot=next;
    for(const b of payload.boundaries||[])publishEvent({type:"boundary",row:b});
    for(const i of payload.items||[])publishEvent({type:"item",row:i});
    for(const e of payload.events||[])publishEvent({type:"event",row:e});
  }
  const backend={
    mode:"local-spatial",
    get spatial(){return spatial},
    load:init,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
    onPresence:presence,
    async publish(payload){return commit(payload)},
    async openNextFrame(n,events){
      await init();if(fallback)return fallback.openNextFrame(n,events);
      const next={...latest(),frames:latest().frames.map(f=>f.n===n?{...f,status:"published"}:f),events:[...latest().events]};
      if(!next.frames.some(f=>f.n===n+1))next.frames.push({n:n+1,status:"open"});
      for(const e of events||[])if(!next.events.some(x=>x.id===e.id))next.events.push(e);
      await spatial.saveState({frames:next.frames,events:next.events});snapshot=next;
      publishEvent({type:"frame",row:{n,status:"published"}});
      publishEvent({type:"frame",row:{n:n+1,status:"open"}});
      (events||[]).forEach(e=>publishEvent({type:"event",row:e}));
    },
    async sendMessage(message){
      await init();if(fallback)return fallback.sendMessage(message);
      const messages=[...latest().messages];
      if(!messages.some(m=>m.id===message.id))messages.push(message);
      await spatial.saveState({messages});snapshot={...latest(),messages};publishEvent({type:"message",row:message});
    },
    async vote(vote){
      await init();if(fallback)return fallback.vote(vote);
      const votes=[...latest().votes];
      if(!votes.some(v=>v.msgId===vote.msgId&&v.voterId===vote.voterId))votes.push(vote);
      await spatial.saveState({votes});snapshot={...latest(),votes};publishEvent({type:"vote",row:vote});
    },
    async searchRegions(query,options){
      await init();
      if(spatial)return spatial.search(query,options);
      const q=String(query||"").toLowerCase();return latest().boundaries.filter(r=>String(r.name||"").toLowerCase().startsWith(q)).slice(0,30).map(x=>({id:x.id,name:x.name,frameN:x.frameN,bbox:root.IFSpatial.boundsFromPath(x.d),color:x.color}))
    },
    async regionById(id){await init();return spatial?spatial.resolve(id):latest().boundaries.find(b=>b.id===id)},
    async visibleRegions(rect,options){await init();return spatial?spatial.viewport(rect,options):latest().boundaries.filter(b=>root.IFSpatial.intersects(root.IFSpatial.boundsFromPath(b.d),rect)).slice(0,120)},
    async regionCount(){await init();return spatial?spatial.count():latest().boundaries.length},
    async currentSnapshot(){await init();return latest()}
  };
  return backend;
};
})(typeof window!=="undefined"?window:globalThis);
